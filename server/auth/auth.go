package auth

import (
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func JWTAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(
				http.StatusUnauthorized,
				gin.H{"error": "Authorization header required"},
			)
			c.Abort()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
			c.JSON(
				http.StatusUnauthorized,
				gin.H{"error": "Authorization header format must be Bearer {token}"},
			)
			c.Abort()
			return
		}

		tokenString := parts[1]
		if tokenString == "" {
			c.JSON(
				http.StatusUnauthorized,
				gin.H{"error": "Bearer token is missing"},
			)
			c.Abort()
			return
		}

		validated, err := ValidateToken(tokenString)

		if err != nil {
			var statusCode int
			var clientMessage string

			if errors.Is(err, jwt.ErrTokenMalformed) {
				statusCode = http.StatusUnauthorized
				clientMessage = "Invalid token format."
			} else if errors.Is(err, jwt.ErrTokenExpired) {
				statusCode = http.StatusUnauthorized
				clientMessage = "Token has expired."
			} else if errors.Is(err, jwt.ErrTokenNotValidYet) {
				statusCode = http.StatusUnauthorized
				clientMessage = "Token not yet valid."
			} else if errors.Is(err, jwt.ErrTokenSignatureInvalid) {
				statusCode = http.StatusUnauthorized
				clientMessage = "Invalid token signature."
			} else {
				statusCode = http.StatusUnauthorized
				clientMessage = "Invalid token."
				log.Printf("Token validation failed with unexpected error: %v", err)
			}

			c.JSON(statusCode, gin.H{"error": clientMessage})
			c.Abort()
			return
		}

		c.Set("userID", validated.UserID)
		c.Set("deviceID", validated.DeviceID)

		c.Next()
	}
}
