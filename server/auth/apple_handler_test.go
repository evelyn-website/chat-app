package auth

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"chat-app-server/auth/apple"
	"chat-app-server/auth/oidc"
	"chat-app-server/db"

	"crypto/ecdsa"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// fakeVerifier lets tests bypass the real OIDC id_token verification and
// feed synthetic claims to the handler. The plan's `/auth/apple` idempotency
// tests don't care about Apple's JWKS path — they care about the DB + refresh
// token state machine — so stubbing the verifier is both faster and more
// focused.
type fakeVerifier struct {
	claims *oidc.Claims
	err    error
}

func (f *fakeVerifier) Verify(ctx context.Context, rawIDToken, rawNonce string) (*oidc.Claims, error) {
	return f.claims, f.err
}

// newAppleTestHandler wires an AuthHandler against a real Postgres pool,
// swapping in a fake verifier plus (optionally) a stub Apple client backed by
// an httptest server. The stub Apple server tracks how many times
// /auth/token was hit so the tests can assert the "don't re-exchange on retry"
// behavior.
type appleStub struct {
	srv           *httptest.Server
	exchangeCalls int
	failExchange  bool
}

func newAppleStub(t *testing.T) *appleStub {
	t.Helper()
	s := &appleStub{}
	s.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/auth/token" {
			s.exchangeCalls++
			if s.failExchange {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"refresh_token":"r.apple.rt","expires_in":3600,"token_type":"Bearer"}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(s.srv.Close)
	return s
}

func newTestAppleHandler(t *testing.T, verifier *fakeVerifier, stub *appleStub) (*AuthHandler, *db.Queries, *pgxpool.Pool, func()) {
	t.Helper()
	dbURL := os.Getenv("DB_URL")
	if dbURL == "" {
		t.Skip("DB_URL not set; skipping apple handler tests")
	}
	// Tests need a JWT_SECRET to mint access tokens.
	if os.Getenv("JWT_SECRET") == "" {
		t.Setenv("JWT_SECRET", "test-jwt-secret-do-not-use-in-prod")
		jwtSecret = []byte(os.Getenv("JWT_SECRET"))
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	q := db.New(pool)
	h := NewAuthHandler(q, ctx, pool)
	h.appleVerifier = verifier

	// Build a minimal ES256 Apple client pointed at the stub.
	if stub != nil {
		ecKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		h.appleClient = apple.NewClient(apple.ClientSecretConfig{
			TeamID: "T", KeyID: "K", ServicesID: "com.example.signin", PrivateKey: ecKey,
		})
		h.appleClient.TokenURL = stub.srv.URL + "/auth/token"
		h.appleClient.RevokeURL = stub.srv.URL + "/auth/revoke"

		encKey := make([]byte, 32)
		_, _ = rand.Read(encKey)
		h.appleEncKey = encKey
	}

	cleanup := func() { pool.Close() }
	return h, q, pool, cleanup
}

// makeReq builds an AppleSignInRequest with generated device keys so the
// handler's decoding/length checks pass.
func makeReq(t *testing.T, deviceID, authCode string) AppleSignInRequest {
	t.Helper()
	// Real-shape 32-byte Curve25519 public key (we just need well-formed base64).
	pub := make([]byte, 32)
	_, _ = rand.Read(pub)
	_, ed25519Priv, _ := ed25519.GenerateKey(rand.Reader)
	_ = ed25519Priv // unused — we only need the public half
	edPub := ed25519Priv.Public().(ed25519.PublicKey)
	return AppleSignInRequest{
		IDToken:           "fake-id-token",
		AuthorizationCode: authCode,
		Nonce:             "client-nonce",
		DeviceIdentifier:  deviceID,
		PublicKey:         base64.StdEncoding.EncodeToString(pub),
		SigningPublicKey:  base64.StdEncoding.EncodeToString(edPub),
	}
}

// doSignIn invokes the handler via httptest and returns the response body.
func doSignIn(t *testing.T, h *AuthHandler, req AppleSignInRequest) (int, AuthResponse) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/auth/apple", h.AppleSignIn)

	body, _ := json.Marshal(req)
	httpReq := httptest.NewRequest(http.MethodPost, "/auth/apple", bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	engine.ServeHTTP(rec, httpReq)

	var out AuthResponse
	if rec.Code == http.StatusOK {
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
	}
	return rec.Code, out
}

// cleanupIdentity removes the test user + identity rows so tests don't
// pollute the shared dev DB. Identity row has ON DELETE CASCADE via user_id,
// so deleting the user is enough.
func cleanupIdentity(t *testing.T, q *db.Queries, userID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	_, _ = q.DeleteUser(ctx, userID)
}

func TestAppleSignIn_FirstTime_CreatesUser(t *testing.T) {
	stub := newAppleStub(t)
	verifier := &fakeVerifier{claims: &oidc.Claims{
		Provider: "apple", Subject: "sub-first-" + uuid.NewString(),
		Email: "me@example.com", EmailVerified: true,
	}}
	h, q, _, cleanup := newTestAppleHandler(t, verifier, stub)
	defer cleanup()

	full := &AppleFullName{Given: "Jane", Family: "Roe"}
	req := makeReq(t, "dev-"+uuid.NewString(), "code-1")
	req.FullName = full

	code, resp := doSignIn(t, h, req)
	if code != http.StatusOK {
		t.Fatalf("status: got %d want 200", code)
	}
	t.Cleanup(func() { cleanupIdentity(t, q, resp.UserID) })

	if resp.UserID == uuid.Nil {
		t.Fatal("user_id empty")
	}
	if resp.UsernameSet {
		t.Error("brand-new user should have username_set=false")
	}
	if resp.FullName != "Jane Roe" {
		t.Errorf("full_name: got %q want %q", resp.FullName, "Jane Roe")
	}
	if resp.AccessToken == "" || resp.RefreshToken == "" {
		t.Error("tokens missing from response")
	}
	if stub.exchangeCalls != 1 {
		t.Errorf("expected 1 /auth/token call, got %d", stub.exchangeCalls)
	}
}

// Idempotency: two calls for the same (provider, subject) land on the same
// user row, do NOT create duplicates, and do NOT re-run authorization_code
// exchange (Apple codes are one-time-use). This is the test called out in
// plan §9.3 and implementation-steps §1.5.
func TestAppleSignIn_Idempotent_Repeat(t *testing.T) {
	stub := newAppleStub(t)
	sub := "sub-repeat-" + uuid.NewString()
	verifier := &fakeVerifier{claims: &oidc.Claims{
		Provider: "apple", Subject: sub, Email: "x@y", EmailVerified: true,
	}}
	h, q, _, cleanup := newTestAppleHandler(t, verifier, stub)
	defer cleanup()

	req := makeReq(t, "dev-"+uuid.NewString(), "code-1")
	_, first := doSignIn(t, h, req)
	t.Cleanup(func() { cleanupIdentity(t, q, first.UserID) })
	if stub.exchangeCalls != 1 {
		t.Fatalf("first call exchange: got %d want 1", stub.exchangeCalls)
	}

	// Second call with the same device, same subject (simulating a retry after
	// a client-side crash before tokens were persisted) and a *different*
	// authorization_code — we already hold one, so we must NOT re-exchange.
	req2 := makeReq(t, req.DeviceIdentifier, "code-2")
	_, second := doSignIn(t, h, req2)
	if second.UserID != first.UserID {
		t.Fatalf("idempotency: second call produced a different user_id (%v vs %v)", second.UserID, first.UserID)
	}
	if stub.exchangeCalls != 1 {
		t.Errorf("re-exchange: got %d calls, expected 1 (code already stored)", stub.exchangeCalls)
	}
}

// If Apple rejects the authorization_code (expired / reused), the handler
// should still return a valid session — only the Apple /auth/revoke capability
// is degraded.
func TestAppleSignIn_ExchangeFails_SessionStillIssued(t *testing.T) {
	stub := newAppleStub(t)
	stub.failExchange = true
	sub := "sub-fail-" + uuid.NewString()
	verifier := &fakeVerifier{claims: &oidc.Claims{
		Provider: "apple", Subject: sub,
	}}
	h, q, _, cleanup := newTestAppleHandler(t, verifier, stub)
	defer cleanup()

	req := makeReq(t, "dev-"+uuid.NewString(), "code-expired")
	code, resp := doSignIn(t, h, req)
	if code != http.StatusOK {
		t.Fatalf("status: got %d want 200 (exchange failure should be non-fatal)", code)
	}
	t.Cleanup(func() { cleanupIdentity(t, q, resp.UserID) })
	if resp.UserID == uuid.Nil {
		t.Fatal("expected a user_id even though exchange failed")
	}
}

func TestAppleSignIn_InvalidIDToken_Rejected(t *testing.T) {
	verifier := &fakeVerifier{err: oidc.ErrSignatureInvalid}
	h, _, _, cleanup := newTestAppleHandler(t, verifier, nil)
	defer cleanup()

	req := makeReq(t, "dev", "")
	code, _ := doSignIn(t, h, req)
	if code != http.StatusUnauthorized {
		t.Fatalf("status: got %d want 401", code)
	}
}

func TestAppleSignIn_MalformedPublicKey_Rejected(t *testing.T) {
	verifier := &fakeVerifier{claims: &oidc.Claims{Provider: "apple", Subject: "s"}}
	h, _, _, cleanup := newTestAppleHandler(t, verifier, nil)
	defer cleanup()

	req := makeReq(t, "dev", "")
	req.PublicKey = "!!! not base64 !!!"
	code, _ := doSignIn(t, h, req)
	if code != http.StatusBadRequest {
		t.Fatalf("status: got %d want 400", code)
	}
}

// Silence unused-import warnings if the file grows over time and some helpers
// temporarily fall out of use.
var _ = pem.EncodeToMemory
var _ = x509.MarshalPKCS8PrivateKey
