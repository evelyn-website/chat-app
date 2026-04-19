// Package apple implements Apple's server-to-server authentication ritual:
//
//  1. Build an ES256-signed "client secret" JWT using APPLE_TEAM_ID /
//     APPLE_KEY_ID / APPLE_PRIVATE_KEY (the .p8 private key downloaded from
//     the Apple developer console).
//  2. POST it to https://appleid.apple.com/auth/token to exchange a SIWA
//     authorization_code for Apple's own refresh_token.
//  3. POST it to https://appleid.apple.com/auth/revoke when the user deletes
//     their account.
//
// Apple's client_secret JWT format is documented at
// https://developer.apple.com/documentation/sign_in_with_apple/generate_and_validate_tokens.
// Summary:
//
//	header:  { "alg": "ES256", "kid": <APPLE_KEY_ID> }
//	payload: { "iss": <APPLE_TEAM_ID>, "iat": <now>, "exp": <now + ≤ 6 months>,
//	           "aud": "https://appleid.apple.com", "sub": <APPLE_SERVICES_ID> }
//
// We cap TTL at 1 hour — it's only ever used inline with a token/revoke call,
// so a short-lived secret is fine and limits the blast radius of a leak.
package apple

import (
	"crypto/ecdsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// ClientSecretTTL is how long a generated client_secret JWT is valid.
// Apple allows up to 6 months; we pick 1 hour because the JWT is minted
// on demand for a single HTTP call.
const ClientSecretTTL = time.Hour

// ClientSecretConfig holds the Apple-issued credentials needed to sign a
// client_secret JWT. ServicesID is the audience-in-our-tokens / sub in the
// JWT — typically the app's bundle identifier or a dedicated Services ID.
type ClientSecretConfig struct {
	TeamID     string // APPLE_TEAM_ID — 10-char alphanumeric
	KeyID      string // APPLE_KEY_ID — 10-char alphanumeric, matches the .p8 file
	ServicesID string // APPLE_SERVICES_ID — the "client_id" Apple expects
	PrivateKey *ecdsa.PrivateKey
}

// ParsePrivateKey decodes a PEM-encoded Apple .p8 private key. The .p8
// payload is a PKCS#8-wrapped ECDSA P-256 key.
func ParsePrivateKey(pemBytes []byte) (*ecdsa.PrivateKey, error) {
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, errors.New("apple: private key is not PEM-encoded")
	}
	keyAny, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("apple: parse PKCS#8: %w", err)
	}
	ecKey, ok := keyAny.(*ecdsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("apple: expected ECDSA key, got %T", keyAny)
	}
	return ecKey, nil
}

// BuildClientSecret mints a freshly-signed client_secret JWT.
func BuildClientSecret(cfg ClientSecretConfig, now time.Time) (string, error) {
	if cfg.TeamID == "" || cfg.KeyID == "" || cfg.ServicesID == "" {
		return "", errors.New("apple: missing team_id / key_id / services_id")
	}
	if cfg.PrivateKey == nil {
		return "", errors.New("apple: missing private key")
	}
	claims := jwt.MapClaims{
		"iss": cfg.TeamID,
		"iat": now.Unix(),
		"exp": now.Add(ClientSecretTTL).Unix(),
		"aud": "https://appleid.apple.com",
		"sub": cfg.ServicesID,
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
	tok.Header["kid"] = cfg.KeyID
	signed, err := tok.SignedString(cfg.PrivateKey)
	if err != nil {
		return "", fmt.Errorf("apple: sign client_secret: %w", err)
	}
	return signed, nil
}
