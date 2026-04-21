package oidc

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

// jwk is the subset of the JWK spec we care about for RSA signing keys. Apple
// and Google both ship RSA keys; if that ever changes we extend here.
type jwk struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	Alg string `json:"alg"`
	N   string `json:"n"`
	E   string `json:"e"`
}

type jwkSet struct {
	Keys []jwk `json:"keys"`
}

// JWKS is a goroutine-safe cache of RSA public keys keyed by `kid`. It fetches
// on miss and exposes a Refresh() for a periodic background poll. The plan
// calls for "sync.Map cache + periodic refresh" — that's what this is.
type JWKS struct {
	url        string
	httpClient *http.Client
	// keys is *map[string]*rsa.PublicKey stored atomically. Swapped wholesale on
	// refresh so readers see a consistent snapshot without locking.
	keys       atomic.Pointer[map[string]*rsa.PublicKey]
	// fetchMu serializes concurrent miss-driven fetches so ten handlers hitting
	// an unknown kid produce one network call, not ten.
	fetchMu    sync.Mutex
	lastFetch  atomic.Int64 // unix seconds
	minRefresh time.Duration
}

// NewJWKS constructs a JWKS cache pointed at url. Call Refresh to prime or
// manually update the cache, or rely on lazy/on-miss fetching via Get.
func NewJWKS(url string, httpClient *http.Client) *JWKS {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 10 * time.Second}
	}
	return &JWKS{
		url:        url,
		httpClient: httpClient,
		minRefresh: 5 * time.Minute, // don't hammer the provider on lookup misses
	}
}

// Get returns the public key for kid, fetching the JWKS if we've never loaded
// it or if kid is unknown in our current snapshot (providers rotate keys).
func (j *JWKS) Get(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	if kid == "" {
		return nil, ErrUnknownKeyID
	}

	if k := j.lookup(kid); k != nil {
		return k, nil
	}

	// Miss → fetch, but throttle to avoid a storm if the token's kid legitimately
	// isn't published (malformed/malicious tokens).
	if err := j.refreshIfAllowed(ctx); err != nil {
		return nil, fmt.Errorf("jwks refresh: %w", err)
	}

	if k := j.lookup(kid); k != nil {
		return k, nil
	}
	return nil, ErrUnknownKeyID
}

// Refresh forces a JWKS fetch. Exposed so a startup goroutine or test can
// prime/refresh the cache deterministically.
func (j *JWKS) Refresh(ctx context.Context) error {
	j.fetchMu.Lock()
	defer j.fetchMu.Unlock()
	return j.fetchLocked(ctx)
}

func (j *JWKS) lookup(kid string) *rsa.PublicKey {
	snapshot := j.keys.Load()
	if snapshot == nil {
		return nil
	}
	if k, ok := (*snapshot)[kid]; ok {
		return k
	}
	return nil
}

func (j *JWKS) refreshIfAllowed(ctx context.Context) error {
	j.fetchMu.Lock()
	defer j.fetchMu.Unlock()

	// Re-check after taking the lock: another goroutine may have fetched while
	// we were blocked. ts==0 means never fetched; time.Unix(0,0) is 1970 and
	// IsZero() returns false for it, so check ts explicitly.
	if ts := j.lastFetch.Load(); ts != 0 && time.Since(time.Unix(ts, 0)) < j.minRefresh {
		// Throttled — trust the snapshot.
		return nil
	}
	// Stamp now before the attempt so repeated failures are also throttled.
	// fetchLocked overwrites this on success with a fresh timestamp.
	j.lastFetch.Store(time.Now().Unix())
	return j.fetchLocked(ctx)
}

func (j *JWKS) fetchLocked(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, j.url, nil)
	if err != nil {
		return err
	}
	resp, err := j.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("jwks endpoint returned %d: %s", resp.StatusCode, string(body))
	}

	var set jwkSet
	if err := json.NewDecoder(resp.Body).Decode(&set); err != nil {
		return fmt.Errorf("decode jwks: %w", err)
	}

	parsed := make(map[string]*rsa.PublicKey, len(set.Keys))
	for _, k := range set.Keys {
		if k.Kty != "RSA" {
			continue // skip EC / OKP keys — Apple and Google ship RSA
		}
		pub, err := rsaPublicKeyFromJWK(k)
		if err != nil {
			// Skip individual bad keys instead of failing the whole refresh —
			// one malformed key shouldn't DoS verification.
			continue
		}
		parsed[k.Kid] = pub
	}

	if len(parsed) == 0 {
		// Preserve the previous good snapshot rather than wiping it; a CDN hiccup
		// or truncated JSON shouldn't lock verification into ErrUnknownKeyID for
		// the full minRefresh window.
		return fmt.Errorf("jwks refresh: no usable keys parsed from %d entries", len(set.Keys))
	}
	j.keys.Store(&parsed)
	j.lastFetch.Store(time.Now().Unix())
	return nil
}

func rsaPublicKeyFromJWK(k jwk) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(k.N)
	if err != nil {
		return nil, fmt.Errorf("decode n: %w", err)
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(k.E)
	if err != nil {
		return nil, fmt.Errorf("decode e: %w", err)
	}

	// e is typically 3 bytes (65537). Big-endian.
	var e int
	for _, b := range eBytes {
		e = e<<8 | int(b)
	}
	if e == 0 {
		return nil, fmt.Errorf("zero exponent")
	}

	return &rsa.PublicKey{
		N: new(big.Int).SetBytes(nBytes),
		E: e,
	}, nil
}
