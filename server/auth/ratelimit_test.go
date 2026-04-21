package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Exercise the per-IP token bucket. The ulule middleware returns 429 once the
// bucket is empty. We fire 12 requests from the same synthetic IP against a
// "10-M" budget and assert that at least one gets throttled. This keeps the
// test resistant to clock skew and internal burst-allowance details of the
// limiter library.
func TestRateLimitByIP_ThrottlesBurst(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/x", RateLimitByIP("10-M"), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	statuses := make(map[int]int)
	for i := 0; i < 12; i++ {
		req := httptest.NewRequest(http.MethodPost, "/x", nil)
		req.RemoteAddr = "10.0.0.1:12345"
		rec := httptest.NewRecorder()
		engine.ServeHTTP(rec, req)
		statuses[rec.Code]++
	}

	if statuses[http.StatusTooManyRequests] == 0 {
		t.Fatalf("expected at least one 429 in %d requests, got statuses=%v", 12, statuses)
	}
	if statuses[http.StatusOK] == 0 {
		t.Fatalf("expected at least one 200, got statuses=%v", statuses)
	}
}

// Different IPs have independent budgets, so hammering IP-A must not starve
// IP-B. Proves the middleware keys on the request's client IP.
func TestRateLimitByIP_DistinctIPsIndependent(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/x", RateLimitByIP("2-M"), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	burn := func(ip string) {
		for i := 0; i < 5; i++ {
			req := httptest.NewRequest(http.MethodPost, "/x", nil)
			req.RemoteAddr = ip + ":1"
			engine.ServeHTTP(httptest.NewRecorder(), req)
		}
	}
	burn("10.0.0.1")

	// First request from a fresh IP should still pass.
	req := httptest.NewRequest(http.MethodPost, "/x", nil)
	req.RemoteAddr = "10.0.0.2:1"
	rec := httptest.NewRecorder()
	engine.ServeHTTP(rec, req)
	if rec.Code == http.StatusTooManyRequests {
		t.Fatalf("independent IP should not be throttled; got %d", rec.Code)
	}
}

// TestRateLimitByUser_ThrottlesBurst verifies that per-user throttling kicks
// in once the budget is exhausted. Uses a unique user ID per test run so the
// in-memory store from prior tests doesn't bleed over.
func TestRateLimitByUser_ThrottlesBurst(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	uid := uuid.New()
	// Inject userID into context the same way JWTAuthMiddleware does.
	setUser := func(c *gin.Context) { c.Set("userID", uid); c.Next() }
	engine.POST("/x", setUser, RateLimitByUser("2-M"), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	statuses := make(map[int]int)
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodPost, "/x", nil)
		req.RemoteAddr = "10.0.0.1:1"
		rec := httptest.NewRecorder()
		engine.ServeHTTP(rec, req)
		statuses[rec.Code]++
	}

	if statuses[http.StatusTooManyRequests] == 0 {
		t.Fatalf("expected 429 after budget exhausted, got statuses=%v", statuses)
	}
	if statuses[http.StatusOK] == 0 {
		t.Fatalf("expected some 200s before throttle, got statuses=%v", statuses)
	}
}

// TestRateLimitByUser_FallsBackToIP confirms the middleware degrades to IP
// keying when no userID is present in the context (misordered middleware chain
// or unauthenticated request that somehow reaches this middleware).
func TestRateLimitByUser_FallsBackToIP(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	// No setUser middleware — userID absent from context.
	engine.POST("/x", RateLimitByUser("2-M"), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	statuses := make(map[int]int)
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodPost, "/x", nil)
		req.RemoteAddr = "10.1.1.1:1"
		rec := httptest.NewRecorder()
		engine.ServeHTTP(rec, req)
		statuses[rec.Code]++
	}

	// The IP fallback should throttle — proving the middleware didn't skip
	// rate-limiting entirely when userID was absent.
	if statuses[http.StatusTooManyRequests] == 0 {
		t.Fatalf("expected 429 via IP fallback, got statuses=%v", statuses)
	}
}
