package auth

import (
	"net/http"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	limiter "github.com/ulule/limiter/v3"
	mw "github.com/ulule/limiter/v3/drivers/middleware/gin"
	memstore "github.com/ulule/limiter/v3/drivers/store/memory"
)

// Rate-limit budgets per plan §2.6. Each budget is a token bucket with a
// refill window. In-memory storage is fine for single-instance dev; swap for
// Redis-backed storage when we deploy multi-instance.
//
//	/auth/apple    — 10/min/IP (verifying id_tokens is cheap but creates users)
//	/auth/refresh  — 30/min/IP (credential-stuffing target; legit usage ≤ 1/15min/device)
//	/auth/logout   — 20/min/IP (hygiene)
//	authenticated  — 10/min per user_id (link/unlink, revoke-others, etc.)
var (
	RateSignInPerIP        = "10-M"
	RateRefreshPerIP       = "30-M"
	RateLogoutPerIP        = "20-M"
	RateAuthenticatedPerUser = "10-M"
)

// ipLimiters memoizes per-IP limiters by rate string so endpoints sharing a
// budget share a bucket. Without this, RateLimitByIP(RateSignInPerIP) applied
// to three sign-in endpoints would give each IP 3x the intended budget across
// the sign-in surface.
//
// c.ClientIP() trust is governed by gin.Engine.SetTrustedProxies, independent
// of middleware ordering.
var (
	ipLimitersMu   sync.Mutex
	ipLimiters     = map[string]*limiter.Limiter{}
	userLimitersMu sync.Mutex
	userLimiters   = map[string]*limiter.Limiter{}
)

// limiterFor is the shared factory for both IP and user limiters: lazy-init
// with a mutex, memoize by rate string, panic on misconfigured format so bad
// configs are caught at startup rather than silently failing open.
func limiterFor(mu *sync.Mutex, cache map[string]*limiter.Limiter, rate string) *limiter.Limiter {
	mu.Lock()
	defer mu.Unlock()
	if lim, ok := cache[rate]; ok {
		return lim
	}
	r, err := limiter.NewRateFromFormatted(rate)
	if err != nil {
		panic("auth: invalid rate format " + rate + ": " + err.Error())
	}
	lim := limiter.New(memstore.NewStore(), r)
	cache[rate] = lim
	return lim
}

func ipLimiterFor(rate string) *limiter.Limiter  { return limiterFor(&ipLimitersMu, ipLimiters, rate) }
func userLimiterFor(rate string) *limiter.Limiter { return limiterFor(&userLimitersMu, userLimiters, rate) }

// RateLimitByIP returns a middleware that rate-limits the current request's
// client IP against the given token-bucket budget. Limiters are memoized by
// rate string, so multiple endpoints sharing the same rate share one bucket.
func RateLimitByIP(rate string) gin.HandlerFunc {
	return mw.NewMiddleware(ipLimiterFor(rate))
}

// RateLimitByUser returns a middleware that rate-limits by authenticated
// user_id. Must run AFTER JWTAuthMiddleware so the userID key is set in
// context. Falls back to IP if for some reason userID isn't present (which
// would indicate a misordered middleware chain). Limiters are memoized by
// rate string so multiple endpoints sharing the same rate share one bucket.
func RateLimitByUser(rate string) gin.HandlerFunc {
	lim := userLimiterFor(rate)

	return func(c *gin.Context) {
		key := userKeyFromContext(c)
		ctx, err := lim.Get(c.Request.Context(), key)
		if err != nil {
			c.Next()
			return
		}
		// Advertise budget headers so clients can self-throttle.
		c.Header("X-RateLimit-Limit", itoa(ctx.Limit))
		c.Header("X-RateLimit-Remaining", itoa(ctx.Remaining))
		c.Header("X-RateLimit-Reset", itoa(ctx.Reset))
		if ctx.Reached {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"message": "Rate limit exceeded"})
			return
		}
		c.Next()
	}
}

func userKeyFromContext(c *gin.Context) string {
	if raw, ok := c.Get("userID"); ok {
		if uid, ok := raw.(uuid.UUID); ok && uid != uuid.Nil {
			return "user:" + uid.String()
		}
	}
	// Defense in depth: if we somehow got here without auth middleware having
	// populated userID, key off IP instead — better than a global key that
	// would throttle every request to this endpoint together.
	return "ip:" + strings.Split(c.ClientIP(), ",")[0]
}

// itoa avoids pulling strconv into a file that otherwise wouldn't need it.
func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
