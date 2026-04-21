package apple

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
)

// EncryptionKeyEnvVar names the env var that holds the AES-256 key used to
// wrap Apple refresh tokens. The value is 32 random bytes, base64-encoded.
const EncryptionKeyEnvVar = "APPLE_REFRESH_TOKEN_ENCRYPTION_KEY"

// LoadEncryptionKey decodes the env-configured AES-256 key. Returns the raw
// 32-byte key or an error if the env var is missing / malformed.
func LoadEncryptionKey() ([]byte, error) {
	raw := os.Getenv(EncryptionKeyEnvVar)
	if raw == "" {
		return nil, fmt.Errorf("%s not set", EncryptionKeyEnvVar)
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf("%s: base64 decode: %w", EncryptionKeyEnvVar, err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("%s: expected 32 bytes, got %d", EncryptionKeyEnvVar, len(key))
	}
	return key, nil
}

func newGCM(key []byte) (cipher.AEAD, error) {
	if len(key) != 32 {
		return nil, errors.New("apple: encryption key must be 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// Encrypt wraps plaintext with AES-256-GCM. The layout of the returned blob is
// [12-byte nonce || ciphertext || 16-byte auth tag]. Decrypt expects the same.
//
// A fresh nonce is generated with crypto/rand on every call; never reuse a
// nonce for the same key.
func Encrypt(key, plaintext []byte) ([]byte, error) {
	gcm, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	// Seal appends the ciphertext+tag to the first arg; prepend nonce so it
	// rides along with the stored blob.
	return gcm.Seal(nonce, nonce, plaintext, nil), nil
}

// Decrypt reverses Encrypt.
func Decrypt(key, blob []byte) ([]byte, error) {
	gcm, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	if len(blob) < gcm.NonceSize() {
		return nil, errors.New("apple: ciphertext blob too short")
	}
	nonce, ct := blob[:gcm.NonceSize()], blob[gcm.NonceSize():]
	pt, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return nil, fmt.Errorf("apple: gcm open: %w", err)
	}
	return pt, nil
}
