package oidc

import (
	"context"
	"errors"
)

// Claims are the subset of OIDC id_token claims the app cares about. Both
// Apple and Google verifiers populate the same struct so handlers don't need
// provider-specific parsing.
type Claims struct {
	Provider       string // "apple" | "google"
	Subject        string // provider-scoped opaque user id (the `sub` claim)
	Email          string // informational; may be an Apple private relay
	EmailVerified  bool
	Name           string // Google only; Apple returns name out-of-band on first sign-in
	GivenName      string
	FamilyName     string
	Audience       string // the aud claim we validated against
	IssuedAt       int64
	ExpiresAt      int64
}

// IDTokenVerifier verifies a provider-issued id_token against its JWKS and the
// per-provider issuer/audience rules. `nonce` is the raw (unhashed) nonce the
// client generated; Apple embeds the SHA-256 hash of it.
type IDTokenVerifier interface {
	Verify(ctx context.Context, rawIDToken string, nonce string) (*Claims, error)
}

// Sentinel errors. Wrapped with fmt.Errorf("...%w", ...) at call sites so
// handlers can log the cause but return a generic 401 to the client.
var (
	ErrMalformedToken    = errors.New("oidc: malformed id_token")
	ErrSignatureInvalid  = errors.New("oidc: signature verification failed")
	ErrIssuerMismatch    = errors.New("oidc: issuer mismatch")
	ErrAudienceMismatch  = errors.New("oidc: audience mismatch")
	ErrTokenExpired      = errors.New("oidc: token expired")
	ErrNonceMismatch     = errors.New("oidc: nonce mismatch")
	ErrUnknownKeyID      = errors.New("oidc: kid not present in JWKS")
	ErrMissingSubject    = errors.New("oidc: sub claim missing")
	// ErrJWKSFetchFailure indicates the JWKS endpoint could not be reached or
	// returned an unusable response. Unlike ErrUnknownKeyID (which means the
	// key exists in the provider but not in our cache), this is a transient
	// infrastructure error that callers may treat as retryable / 503.
	ErrJWKSFetchFailure  = errors.New("oidc: JWKS fetch failed")
)
