package oidc

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// testRig builds a deterministic-ish fixture: one RSA key, an httptest JWKS
// endpoint, and helpers to mint tokens signed with that key. We don't want to
// hit live Apple in tests (the whole point of the "recorded JWKS fixture"
// directive in the plan); generating the JWKS from an in-process key is the
// clean equivalent.
type testRig struct {
	t        *testing.T
	priv     *rsa.PrivateKey
	kid      string
	jwksSrv  *httptest.Server
	verifier *AppleVerifier
}

func newTestRig(t *testing.T, allowedAudiences []string) *testRig {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rsa key: %v", err)
	}
	rig := &testRig{
		t:    t,
		priv: priv,
		kid:  "test-kid-1",
	}
	rig.jwksSrv = httptest.NewServer(http.HandlerFunc(rig.serveJWKS))
	t.Cleanup(rig.jwksSrv.Close)

	rig.verifier = NewAppleVerifier(rig.jwksSrv.URL, allowedAudiences)
	return rig
}

// serveJWKS publishes the fixture's single key as a JWKS. Mirrors the wire
// shape Apple returns.
func (r *testRig) serveJWKS(w http.ResponseWriter, _ *http.Request) {
	n := base64.RawURLEncoding.EncodeToString(r.priv.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(r.priv.E)).Bytes())
	set := jwkSet{Keys: []jwk{{Kty: "RSA", Kid: r.kid, Use: "sig", Alg: "RS256", N: n, E: e}}}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(set)
}

type tokenOpts struct {
	iss, aud, sub, email, nonce string
	kid                         string
	exp                         time.Time
	iat                         time.Time
	emailVerified               any // nil | bool | string
	signingKey                  *rsa.PrivateKey
}

func (r *testRig) mint(opts tokenOpts) string {
	r.t.Helper()
	if opts.iss == "" {
		opts.iss = AppleIssuer
	}
	if opts.exp.IsZero() {
		opts.exp = time.Now().Add(5 * time.Minute)
	}
	if opts.iat.IsZero() {
		opts.iat = time.Now().Add(-1 * time.Minute)
	}
	if opts.kid == "" {
		opts.kid = r.kid
	}
	if opts.signingKey == nil {
		opts.signingKey = r.priv
	}
	claims := jwt.MapClaims{
		"iss": opts.iss,
		"aud": opts.aud,
		"sub": opts.sub,
		"iat": opts.iat.Unix(),
		"exp": opts.exp.Unix(),
	}
	if opts.email != "" {
		claims["email"] = opts.email
	}
	if opts.emailVerified != nil {
		claims["email_verified"] = opts.emailVerified
	}
	if opts.nonce != "" {
		claims["nonce"] = opts.nonce
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = opts.kid
	signed, err := tok.SignedString(opts.signingKey)
	if err != nil {
		r.t.Fatalf("sign token: %v", err)
	}
	return signed
}

func hashedNonce(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func TestAppleVerifier_HappyPath(t *testing.T) {
	rig := newTestRig(t, []string{"com.evelynnelson.chatapp"})
	rawNonce := "client-nonce-abc"

	token := rig.mint(tokenOpts{
		aud:           "com.evelynnelson.chatapp",
		sub:           "001234.abcd",
		email:         "relay@privaterelay.appleid.com",
		emailVerified: true,
		nonce:         hashedNonce(rawNonce),
	})

	claims, err := rig.verifier.Verify(context.Background(), token, rawNonce)
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	if claims.Subject != "001234.abcd" {
		t.Errorf("subject: got %q want %q", claims.Subject, "001234.abcd")
	}
	if claims.Provider != "apple" {
		t.Errorf("provider: got %q want apple", claims.Provider)
	}
	if !claims.EmailVerified {
		t.Error("email_verified should be true")
	}
	if claims.Email != "relay@privaterelay.appleid.com" {
		t.Errorf("email: got %q", claims.Email)
	}
}

func TestAppleVerifier_EmailVerifiedAsString(t *testing.T) {
	rig := newTestRig(t, []string{"aud-1"})
	rawNonce := "n"
	token := rig.mint(tokenOpts{
		aud:           "aud-1",
		sub:           "s",
		emailVerified: "true",
		nonce:         hashedNonce(rawNonce),
	})
	claims, err := rig.verifier.Verify(context.Background(), token, rawNonce)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !claims.EmailVerified {
		t.Error("email_verified=\"true\" should parse as true")
	}
}

func TestAppleVerifier_FailureCases(t *testing.T) {
	// Independent foreign key to simulate a signature forged by a rotated or
	// attacker-controlled key.
	otherKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("other key: %v", err)
	}

	tests := []struct {
		name    string
		mutate  func(*tokenOpts)
		wantErr error
		nonce   string
	}{
		{
			name:    "expired",
			mutate:  func(o *tokenOpts) { o.exp = time.Now().Add(-1 * time.Minute) },
			wantErr: ErrTokenExpired,
			nonce:   "raw",
		},
		{
			name:    "wrong issuer",
			mutate:  func(o *tokenOpts) { o.iss = "https://accounts.google.com" },
			wantErr: ErrIssuerMismatch,
			nonce:   "raw",
		},
		{
			name:    "wrong audience",
			mutate:  func(o *tokenOpts) { o.aud = "some-other-app" },
			wantErr: ErrAudienceMismatch,
			nonce:   "raw",
		},
		{
			name:    "wrong signature",
			mutate:  func(o *tokenOpts) { o.signingKey = otherKey },
			wantErr: ErrSignatureInvalid,
			nonce:   "raw",
		},
		{
			name:    "unknown kid",
			mutate:  func(o *tokenOpts) { o.kid = "kid-that-isnt-in-jwks" },
			wantErr: ErrUnknownKeyID,
			nonce:   "raw",
		},
		{
			name:    "nonce mismatch",
			mutate:  func(o *tokenOpts) { o.nonce = hashedNonce("tampered") },
			wantErr: ErrNonceMismatch,
			nonce:   "raw", // verifier re-hashes "raw" → won't match "tampered"
		},
		{
			name:    "missing subject",
			mutate:  func(o *tokenOpts) { o.sub = "" },
			wantErr: ErrMissingSubject,
			nonce:   "raw",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rig := newTestRig(t, []string{"aud-1"})
			opts := tokenOpts{aud: "aud-1", sub: "001"}
			if tc.nonce != "" && tc.name != "nonce mismatch" {
				opts.nonce = hashedNonce(tc.nonce)
			} else if tc.name == "nonce mismatch" {
				// Mutate will overwrite with the tampered hash.
			}
			tc.mutate(&opts)
			token := rig.mint(opts)
			_, err := rig.verifier.Verify(context.Background(), token, tc.nonce)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("err: got %v want %v", err, tc.wantErr)
			}
		})
	}
}

func TestAppleVerifier_MalformedToken(t *testing.T) {
	rig := newTestRig(t, []string{"aud"})
	_, err := rig.verifier.Verify(context.Background(), "not-a-jwt", "n")
	if !errors.Is(err, ErrMalformedToken) {
		t.Fatalf("err: got %v want %v", err, ErrMalformedToken)
	}

	_, err = rig.verifier.Verify(context.Background(), "", "n")
	if !errors.Is(err, ErrMalformedToken) {
		t.Fatalf("empty: got %v want %v", err, ErrMalformedToken)
	}
}

func TestAppleVerifier_NonceSkippedWhenEmpty(t *testing.T) {
	// If callers don't supply a nonce (not our case, but API shape allows it),
	// we should not reject tokens that also omit it. Confirms the "only check
	// when rawNonce is supplied" branch.
	rig := newTestRig(t, []string{"aud"})
	token := rig.mint(tokenOpts{aud: "aud", sub: "sub"})
	if _, err := rig.verifier.Verify(context.Background(), token, ""); err != nil {
		t.Fatalf("expected verify ok when nonce not enforced, got %v", err)
	}
}

func TestAppleVerifier_JWKSFetchFailure(t *testing.T) {
	// Stand up a JWKS endpoint that always returns 500, then point a fresh
	// verifier at it. The verifier must surface ErrJWKSFetchFailure rather
	// than ErrUnknownKeyID so callers can return a retryable 503 instead of
	// treating it as a bad credential.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)

	// Mint a structurally valid JWT using a throwaway key. We only need it to
	// carry a kid header so the verifier gets past the "kid=="" guard and
	// attempts to fetch the JWKS.
	rig := newTestRig(t, []string{"aud"})
	token := rig.mint(tokenOpts{aud: "aud", sub: "sub"})

	v := NewAppleVerifier(srv.URL, []string{"aud"})
	_, err := v.Verify(context.Background(), token, "")
	if !errors.Is(err, ErrJWKSFetchFailure) {
		t.Fatalf("got %v want ErrJWKSFetchFailure", err)
	}
}
