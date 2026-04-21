package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"chat-app-server/auth/refresh"
	"chat-app-server/db"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func newTestRefreshSetup(t *testing.T) (*AuthHandler, *refresh.Store, *db.Queries, func()) {
	t.Helper()
	dbURL := os.Getenv("DB_URL")
	if dbURL == "" {
		t.Skip("DB_URL not set; skipping refresh handler tests")
	}
	if os.Getenv("JWT_SECRET") == "" {
		t.Setenv("JWT_SECRET", "test-jwt-secret-do-not-use-in-prod")
		jwtSecret = []byte("test-jwt-secret-do-not-use-in-prod")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	q := db.New(pool)
	h := NewAuthHandler(q, ctx, pool)
	// Independent store pointing at the same DB so tests can issue tokens
	// without going through the Apple sign-in flow.
	store := refresh.NewStore(q, pool)
	return h, store, q, pool.Close
}

func insertRefreshTestUser(t *testing.T, q *db.Queries) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	user, err := q.InsertUserOIDC(ctx, db.InsertUserOIDCParams{
		Username: "rt-" + uuid.NewString()[:8],
	})
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() { _, _ = q.DeleteUser(ctx, user.ID) })
	return user.ID
}

func doRefresh(t *testing.T, h *AuthHandler, token, deviceID string) (int, AuthResponse) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/auth/refresh", h.Refresh)

	body, _ := json.Marshal(RefreshRequest{RefreshToken: token, DeviceIdentifier: deviceID})
	req := httptest.NewRequest(http.MethodPost, "/auth/refresh", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	engine.ServeHTTP(rec, req)

	var out AuthResponse
	if rec.Code == http.StatusOK {
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
	}
	return rec.Code, out
}

func doLogout(t *testing.T, h *AuthHandler, token string) int {
	t.Helper()
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/auth/logout", h.Logout)

	body, _ := json.Marshal(LogoutRequest{RefreshToken: token})
	req := httptest.NewRequest(http.MethodPost, "/auth/logout", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	engine.ServeHTTP(rec, req)
	return rec.Code
}

func TestRefresh_HappyPath(t *testing.T) {
	h, store, q, cleanup := newTestRefreshSetup(t)
	defer cleanup()

	userID := insertRefreshTestUser(t, q)
	deviceID := "dev-" + uuid.NewString()[:8]
	plaintext, err := store.Issue(context.Background(), userID, deviceID, "")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	code, resp := doRefresh(t, h, plaintext, deviceID)
	if code != http.StatusOK {
		t.Fatalf("status: got %d want 200", code)
	}
	if resp.AccessToken == "" {
		t.Error("access_token missing")
	}
	if resp.RefreshToken == "" {
		t.Error("refresh_token missing")
	}
	if resp.RefreshToken == plaintext {
		t.Error("refresh_token should be rotated, not reused")
	}
	if resp.UserID != userID {
		t.Errorf("user_id: got %v want %v", resp.UserID, userID)
	}
	if resp.AccessExpiresIn <= 0 {
		t.Errorf("access_expires_in: got %d", resp.AccessExpiresIn)
	}
}

func TestRefresh_InvalidToken_Returns401(t *testing.T) {
	h, _, _, cleanup := newTestRefreshSetup(t)
	defer cleanup()

	bogus, _, err := refresh.Generate()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	code, _ := doRefresh(t, h, bogus, "device-x")
	if code != http.StatusUnauthorized {
		t.Fatalf("status: got %d want 401", code)
	}
}

// TestRefresh_TheftDetected_Returns401 ensures the handler returns 401 when a
// consumed token is replayed — the same theft signal the state machine tests
// verify at the store level, now confirmed through the HTTP surface.
func TestRefresh_TheftDetected_Returns401(t *testing.T) {
	h, store, q, cleanup := newTestRefreshSetup(t)
	defer cleanup()

	userID := insertRefreshTestUser(t, q)
	deviceID := "dev-" + uuid.NewString()[:8]
	original, err := store.Issue(context.Background(), userID, deviceID, "")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	// Legitimate rotation consumes original.
	if _, err := store.Rotate(context.Background(), original, deviceID, ""); err != nil {
		t.Fatalf("rotate: %v", err)
	}

	// Replaying the original through the HTTP handler must return 401.
	code, _ := doRefresh(t, h, original, deviceID)
	if code != http.StatusUnauthorized {
		t.Fatalf("theft replay: got %d want 401", code)
	}
}

func TestLogout_HappyPath(t *testing.T) {
	h, store, q, cleanup := newTestRefreshSetup(t)
	defer cleanup()

	userID := insertRefreshTestUser(t, q)
	plaintext, err := store.Issue(context.Background(), userID, "dev-1", "")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	if code := doLogout(t, h, plaintext); code != http.StatusNoContent {
		t.Fatalf("status: got %d want 204", code)
	}
}

// TestLogout_UnknownToken_StillReturns204 confirms the idempotency contract:
// the handler must not leak whether a token was valid, already-revoked, or
// never issued.
func TestLogout_UnknownToken_StillReturns204(t *testing.T) {
	h, _, _, cleanup := newTestRefreshSetup(t)
	defer cleanup()

	bogus, _, err := refresh.Generate()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if code := doLogout(t, h, bogus); code != http.StatusNoContent {
		t.Fatalf("status: got %d want 204", code)
	}
}
