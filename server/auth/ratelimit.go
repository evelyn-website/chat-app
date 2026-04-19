package auth

import (
	"net/http"
	"strings"

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

// rateByIP constructs a per-IP limiter for one of the public auth endpoints.
// gin-contrib's cors middleware already ran by the time we reach these, so
// c.ClientIP() honors X-Forwarded-For from our trusted proxy set.
func rateByIP(rate string) gin.HandlerFunc {
	r, err := limiter.NewRateFromFormatted(rate)
	if err != nil {
		// Misconfigured code path — fail loud at startup.
		panic("auth: invalid rate format " + rate + ": " + err.Error())
	}
	store := memstore.NewStore()
	lim := limiter.New(store, r)
	return mw.NewMiddleware(lim)
}

// RateLimitByIP returns a middleware that rate-limits the current request's
// client IP against the given token-bucket budget.
func RateLimitByIP(rate string) gin.HandlerFunc {
	return rateByIP(rate)
}

// RateLimitByUser returns a middleware that rate-limits by authenticated
// user_id. Must run AFTER JWTAuthMiddleware so the userID key is set in
// context. Falls back to IP if for some reason userID isn't present (which
// would indicate a misordered middleware chain).
func RateLimitByUser(rate string) gin.HandlerFunc {
	r, err := limiter.NewRateFromFormatted(rate)
	if err != nil {
		panic("auth: invalid rate format " + rate + ": " + err.Error())
	}
	store := memstore.NewStore()
	lim := limiter.New(store, r)

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
