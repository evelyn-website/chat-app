package apple

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// genP256 returns a fresh P-256 ECDSA key and its PEM-encoded PKCS#8 form,
// mimicking Apple's .p8 file layout.
func genP256(t *testing.T) (*ecdsa.PrivateKey, []byte) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("gen key: %v", err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("marshal pkcs8: %v", err)
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
	return key, pemBytes
}

func TestParsePrivateKey_RoundTrip(t *testing.T) {
	key, pemBytes := genP256(t)
	parsed, err := ParsePrivateKey(pemBytes)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if parsed.D.Cmp(key.D) != 0 {
		t.Fatal("parsed key differs from original")
	}
}

func TestParsePrivateKey_NotPEM(t *testing.T) {
	if _, err := ParsePrivateKey([]byte("not a pem block")); err == nil {
		t.Fatal("expected error on non-PEM input")
	}
}

func TestBuildClientSecret_ClaimsAndHeader(t *testing.T) {
	key, _ := genP256(t)
	cfg := ClientSecretConfig{
		TeamID:     "TEAMID1234",
		KeyID:      "KEYID12345",
		ServicesID: "com.example.signin",
		PrivateKey: key,
	}
	now := time.Now()
	tok, err := BuildClientSecret(cfg, now)
	if err != nil {
		t.Fatalf("build: %v", err)
	}

	parsed, err := jwt.Parse(tok, func(t *jwt.Token) (any, error) {
		return &key.PublicKey, nil
	}, jwt.WithValidMethods([]string{"ES256"}))
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if kid, _ := parsed.Header["kid"].(string); kid != cfg.KeyID {
		t.Errorf("kid: got %q want %q", kid, cfg.KeyID)
	}
	claims := parsed.Claims.(jwt.MapClaims)
	if iss, _ := claims["iss"].(string); iss != cfg.TeamID {
		t.Errorf("iss: got %q want %q", iss, cfg.TeamID)
	}
	if sub, _ := claims["sub"].(string); sub != cfg.ServicesID {
		t.Errorf("sub: got %q want %q", sub, cfg.ServicesID)
	}
	if aud, _ := claims["aud"].(string); aud != "https://appleid.apple.com" {
		t.Errorf("aud: got %q", aud)
	}
	if iat, _ := claims["iat"].(float64); int64(iat) != now.Unix() {
		t.Errorf("iat: got %v want %v", iat, now.Unix())
	}
	if exp, _ := claims["exp"].(float64); int64(exp) != now.Add(ClientSecretTTL).Unix() {
		t.Errorf("exp: got %v want %v", exp, now.Add(ClientSecretTTL).Unix())
	}
}

func TestBuildClientSecret_MissingFields(t *testing.T) {
	key, _ := genP256(t)
	cases := []struct {
		name string
		cfg  ClientSecretConfig
	}{
		{"no team", ClientSecretConfig{KeyID: "K", ServicesID: "S", PrivateKey: key}},
		{"no key", ClientSecretConfig{TeamID: "T", ServicesID: "S", PrivateKey: key}},
		{"no services", ClientSecretConfig{TeamID: "T", KeyID: "K", PrivateKey: key}},
		{"no private key", ClientSecretConfig{TeamID: "T", KeyID: "K", ServicesID: "S"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, err := BuildClientSecret(c.cfg, time.Now()); err == nil {
				t.Fatal("expected error")
			}
		})
	}
}
