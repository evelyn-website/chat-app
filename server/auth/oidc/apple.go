package oidc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

const (
	AppleIssuer  = "https://appleid.apple.com"
	AppleJWKSURL = "https://appleid.apple.com/auth/keys"
)

// AppleVerifier verifies id_tokens issued by Sign In With Apple.
//
// Audience: Apple audiences are Services IDs. In the iOS native flow the
// audience is the bundle identifier; additional audiences (web Services ID,
// future Android client IDs) can be added via allowedAudiences. We accept if
// the token's aud matches any entry.
type AppleVerifier struct {
	jwks             *JWKS
	allowedAudiences map[string]struct{}
}

// NewAppleVerifier wires a verifier. jwksURL is normally oidc.AppleJWKSURL;
// tests override it to point at an httptest.Server.
func NewAppleVerifier(jwksURL string, allowedAudiences []string) *AppleVerifier {
	audSet := make(map[string]struct{}, len(allowedAudiences))
	for _, a := range allowedAudiences {
		if a != "" {
			audSet[a] = struct{}{}
		}
	}
	return &AppleVerifier{
		jwks:             NewJWKS(jwksURL, nil),
		allowedAudiences: audSet,
	}
}

// WithJWKS swaps the JWKS fetcher. Used by tests to inject an httptest-backed
// cache. Returns the receiver for chaining.
func (v *AppleVerifier) WithJWKS(j *JWKS) *AppleVerifier {
	v.jwks = j
	return v
}

// Verify parses and validates the id_token. rawNonce is the pre-image the
// client used; pass the raw string, not the digest.
func (v *AppleVerifier) Verify(ctx context.Context, rawIDToken string, rawNonce string) (*Claims, error) {
	if rawIDToken == "" {
		return nil, ErrMalformedToken
	}

	parser := jwt.NewParser(jwt.WithValidMethods([]string{"RS256"}))

	// First parse unverified so we can pull the kid and fetch the key.
	unverified, _, err := parser.ParseUnverified(rawIDToken, jwt.MapClaims{})
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrMalformedToken, err)
	}
	kid, _ := unverified.Header["kid"].(string)
	if kid == "" {
		return nil, ErrMalformedToken
	}

	pub, err := v.jwks.Get(ctx, kid)
	if err != nil {
		return nil, err
	}

	// Second parse with signature verification and the built-in exp check.
	token, err := parser.Parse(rawIDToken, func(t *jwt.Token) (any, error) {
		return pub, nil
	})
	if err != nil {
		switch {
		case errors.Is(err, jwt.ErrTokenExpired):
			return nil, ErrTokenExpired
		case errors.Is(err, jwt.ErrTokenSignatureInvalid):
			return nil, ErrSignatureInvalid
		case errors.Is(err, jwt.ErrTokenMalformed):
			return nil, ErrMalformedToken
		default:
			return nil, fmt.Errorf("apple verify: %w", err)
		}
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return nil, ErrMalformedToken
	}

	// iss
	iss, _ := claims["iss"].(string)
	if iss != AppleIssuer {
		return nil, ErrIssuerMismatch
	}

	// aud — Apple sends a string, not an array.
	aud, _ := claims["aud"].(string)
	if _, ok := v.allowedAudiences[aud]; !ok {
		return nil, ErrAudienceMismatch
	}

	// sub
	sub, _ := claims["sub"].(string)
	if sub == "" {
		return nil, ErrMissingSubject
	}

	// rawNonce is the pre-hash string; we SHA-256 + hex-encode to match
	// expo-crypto.digestStringAsync output. EqualFold guards against casing differences.
	if rawNonce != "" {
		expectedHash := sha256.Sum256([]byte(rawNonce))
		expected := hex.EncodeToString(expectedHash[:])
		got, _ := claims["nonce"].(string)
		if got == "" || !strings.EqualFold(got, expected) {
			return nil, ErrNonceMismatch
		}
	}

	out := &Claims{
		Provider: "apple",
		Subject:  sub,
		Audience: aud,
	}
	if email, ok := claims["email"].(string); ok {
		out.Email = email
	}
	// Apple encodes email_verified as either a string ("true") or a bool.
	switch ev := claims["email_verified"].(type) {
	case bool:
		out.EmailVerified = ev
	case string:
		out.EmailVerified = ev == "true"
	}
	if iat, ok := claims["iat"].(float64); ok {
		out.IssuedAt = int64(iat)
	}
	if exp, ok := claims["exp"].(float64); ok {
		out.ExpiresAt = int64(exp)
	}
	return out, nil
}
