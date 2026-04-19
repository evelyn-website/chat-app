package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
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
