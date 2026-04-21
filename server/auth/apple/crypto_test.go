package apple

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"os"
	"testing"
)

func randomKey(t *testing.T) []byte {
	t.Helper()
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatalf("rand: %v", err)
	}
	return key
}

func TestEncryptDecrypt_RoundTrip(t *testing.T) {
	key := randomKey(t)
	plain := []byte("r.apple.refresh.token.value")
	blob, err := Encrypt(key, plain)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if len(blob) < 12+len(plain) {
		t.Fatalf("blob too short: %d bytes", len(blob))
	}
	got, err := Decrypt(key, blob)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if !bytes.Equal(got, plain) {
		t.Fatalf("roundtrip: got %q want %q", got, plain)
	}
}

func TestEncrypt_NonceChangesPerCall(t *testing.T) {
	key := randomKey(t)
	a, err := Encrypt(key, []byte("same"))
	if err != nil {
		t.Fatalf("encrypt a: %v", err)
	}
	b, err := Encrypt(key, []byte("same"))
	if err != nil {
		t.Fatalf("encrypt b: %v", err)
	}
	if bytes.Equal(a, b) {
		t.Fatal("two encryptions of the same plaintext produced identical blobs (nonce reuse)")
	}
}

func TestDecrypt_TamperedBlob(t *testing.T) {
	key := randomKey(t)
	blob, err := Encrypt(key, []byte("secret"))
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	blob[len(blob)-1] ^= 0x01 // flip last byte — lives inside the GCM tag
	if _, err := Decrypt(key, blob); err == nil {
		t.Fatal("decrypt accepted tampered ciphertext")
	}
}

func TestDecrypt_WrongKey(t *testing.T) {
	k1, k2 := randomKey(t), randomKey(t)
	blob, err := Encrypt(k1, []byte("secret"))
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if _, err := Decrypt(k2, blob); err == nil {
		t.Fatal("decrypt accepted blob with wrong key")
	}
}

func TestLoadEncryptionKey(t *testing.T) {
	// Valid
	key := randomKey(t)
	t.Setenv(EncryptionKeyEnvVar, base64.StdEncoding.EncodeToString(key))
	got, err := LoadEncryptionKey()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if !bytes.Equal(got, key) {
		t.Fatal("loaded key mismatch")
	}

	// Wrong length
	t.Setenv(EncryptionKeyEnvVar, base64.StdEncoding.EncodeToString([]byte("too short")))
	if _, err := LoadEncryptionKey(); err == nil {
		t.Fatal("expected error for short key")
	}

	// Not base64
	t.Setenv(EncryptionKeyEnvVar, "!!!not base64!!!")
	if _, err := LoadEncryptionKey(); err == nil {
		t.Fatal("expected error for malformed base64")
	}

	// Missing
	_ = os.Unsetenv(EncryptionKeyEnvVar)
	if _, err := LoadEncryptionKey(); err == nil {
		t.Fatal("expected error for missing env var")
	}
}
