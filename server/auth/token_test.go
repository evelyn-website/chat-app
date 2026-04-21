package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func setupJWTSecret(t *testing.T) {
	t.Helper()
	t.Setenv("JWT_SECRET", "test-secret-do-not-use-in-prod")
	jwtSecret = []byte("test-secret-do-not-use-in-prod")
	t.Cleanup(func() { jwtSecret = []byte{} })
}

// mintExpired creates a signed JWT that is already past its expiry.
func mintExpired(t *testing.T, userID uuid.UUID) string {
	t.Helper()
	now := time.Now()
	claims := Claims{
		UserID: userID,
		Typ:    TokenTypeAccess,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID.String(),
			IssuedAt:  jwt.NewNumericDate(now.Add(-2 * time.Hour)),
			ExpiresAt: jwt.NewNumericDate(now.Add(-1 * time.Hour)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, err := tok.SignedString(jwtSecret)
	if err != nil {
		t.Fatalf("mintExpired: %v", err)
	}
	return s
}

// mintWrongSig signs with a key that doesn't match the server secret.
func mintWrongSig(t *testing.T, userID uuid.UUID) string {
	t.Helper()
	now := time.Now()
	claims := Claims{
		UserID: userID,
		Typ:    TokenTypeAccess,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(AccessTokenTTL)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, err := tok.SignedString([]byte("wrong-secret"))
	if err != nil {
		t.Fatalf("mintWrongSig: %v", err)
	}
	return s
}

// makeProtectedEngine returns a Gin engine with JWTAuthMiddleware on GET /ping.
// The handler echos the userID and deviceID from context so tests can assert
// that the middleware wired them correctly.
func makeProtectedEngine() *gin.Engine {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.GET("/ping", JWTAuthMiddleware(), func(c *gin.Context) {
		uid, _ := c.Get("userID")
		did, _ := c.Get("deviceID")
		c.JSON(http.StatusOK, gin.H{"userID": uid, "deviceID": did})
	})
	return engine
}

func doProtected(engine *gin.Engine, authHeader string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/ping", nil)
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	rec := httptest.NewRecorder()
	engine.ServeHTTP(rec, req)
	return rec
}

// ── JWTAuthMiddleware ──────────────────────────────────────────────────────

func TestJWTAuthMiddleware_MissingHeader_Returns401(t *testing.T) {
	setupJWTSecret(t)
	rec := doProtected(makeProtectedEngine(), "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("got %d want 401", rec.Code)
	}
}

func TestJWTAuthMiddleware_WrongScheme_Returns401(t *testing.T) {
	setupJWTSecret(t)
	rec := doProtected(makeProtectedEngine(), "Basic dXNlcjpwYXNz")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("got %d want 401", rec.Code)
	}
}

func TestJWTAuthMiddleware_BearerNoToken_Returns401(t *testing.T) {
	setupJWTSecret(t)
	rec := doProtected(makeProtectedEngine(), "Bearer ")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("got %d want 401", rec.Code)
	}
}

func TestJWTAuthMiddleware_Malformed_Returns401(t *testing.T) {
	setupJWTSecret(t)
	rec := doProtected(makeProtectedEngine(), "Bearer not.a.jwt")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("got %d want 401", rec.Code)
	}
}

func TestJWTAuthMiddleware_Expired_Returns401(t *testing.T) {
	setupJWTSecret(t)
	userID := uuid.New()
	token := mintExpired(t, userID)
	rec := doProtected(makeProtectedEngine(), "Bearer "+token)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("got %d want 401", rec.Code)
	}
}

func TestJWTAuthMiddleware_WrongSignature_Returns401(t *testing.T) {
	setupJWTSecret(t)
	userID := uuid.New()
	token := mintWrongSig(t, userID)
	rec := doProtected(makeProtectedEngine(), "Bearer "+token)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("got %d want 401", rec.Code)
	}
}

func TestJWTAuthMiddleware_ValidToken_PassesContext(t *testing.T) {
	setupJWTSecret(t)
	userID := uuid.New()
	deviceID := "dev-abc"
	token, _, err := IssueAccessToken(userID, deviceID)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	rec := doProtected(makeProtectedEngine(), "Bearer "+token)
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d want 200 — body: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, userID.String()) {
		t.Errorf("userID %v not found in response body: %s", userID, body)
	}
	if !strings.Contains(body, deviceID) {
		t.Errorf("deviceID %q not found in response body: %s", deviceID, body)
	}
}

// ── IssueAccessToken / ValidateToken ──────────────────────────────────────

func TestIssueAccessToken_HappyPath(t *testing.T) {
	setupJWTSecret(t)
	userID := uuid.New()
	deviceID := "phone-1"

	tokenStr, ttl, err := IssueAccessToken(userID, deviceID)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if tokenStr == "" {
		t.Fatal("expected non-empty token")
	}
	if ttl != int(AccessTokenTTL.Seconds()) {
		t.Errorf("ttl: got %d want %d", ttl, int(AccessTokenTTL.Seconds()))
	}

	validated, err := ValidateToken(tokenStr)
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if validated.UserID != userID {
		t.Errorf("userID: got %v want %v", validated.UserID, userID)
	}
	if validated.DeviceID != deviceID {
		t.Errorf("deviceID: got %q want %q", validated.DeviceID, deviceID)
	}
	if validated.Typ != TokenTypeAccess {
		t.Errorf("typ: got %q want %q", validated.Typ, TokenTypeAccess)
	}
}

func TestIssueAccessToken_NoSecret_ReturnsError(t *testing.T) {
	jwtSecret = []byte{}
	t.Cleanup(func() { jwtSecret = []byte{} })

	_, _, err := IssueAccessToken(uuid.New(), "dev")
	if err == nil {
		t.Fatal("expected error when jwtSecret is empty")
	}
}

func TestValidateToken_EmptyString_ReturnsError(t *testing.T) {
	setupJWTSecret(t)
	_, err := ValidateToken("")
	if err == nil {
		t.Fatal("expected error for empty token")
	}
}

func TestValidateToken_LegacyEmptyTyp_Accepted(t *testing.T) {
	setupJWTSecret(t)
	userID := uuid.New()
	// Mint a token with Typ="" to simulate tokens issued before typ was added.
	now := time.Now()
	claims := Claims{
		UserID: userID,
		Typ:    "", // legacy
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(AccessTokenTTL)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, err := tok.SignedString(jwtSecret)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	validated, err := ValidateToken(s)
	if err != nil {
		t.Fatalf("legacy typ= should be accepted, got %v", err)
	}
	if validated.UserID != userID {
		t.Errorf("userID: got %v want %v", validated.UserID, userID)
	}
}

func TestValidateToken_WrongTyp_Rejected(t *testing.T) {
	setupJWTSecret(t)
	userID := uuid.New()
	now := time.Now()
	claims := Claims{
		UserID: userID,
		Typ:    "refresh", // not "access"
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(AccessTokenTTL)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, err := tok.SignedString(jwtSecret)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	_, err = ValidateToken(s)
	if err == nil {
		t.Fatal("expected error for typ=refresh, got nil")
	}
}
