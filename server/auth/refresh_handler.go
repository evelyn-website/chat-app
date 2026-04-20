package auth

import (
	"errors"
	"log"
	"net/http"

	"chat-app-server/auth/refresh"

	"github.com/gin-gonic/gin"
)

// Refresh handles POST /auth/refresh. The refresh token IS the credential here
// — there is no Authorization header. See plan §2.3 for the state machine.
func (h *AuthHandler) Refresh(c *gin.Context) {
	ctx := c.Request.Context()
	var req RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Invalid request: " + err.Error()})
		return
	}

	userAgent := c.Request.UserAgent()
	result, err := h.refresh.Rotate(ctx, req.RefreshToken, req.DeviceIdentifier, userAgent)
	if err != nil {
		// Any failure returns 401 with a single generic message. The distinct
		// sentinels are for logs only — we don't want an enumeration oracle
		// that tells the client whether a token is unknown vs revoked vs
		// expired vs stolen.
		switch {
		case errors.Is(err, refresh.ErrTheftDetected):
			log.Printf("Refresh: THEFT detected for device %q — family revoked", req.DeviceIdentifier)
		case errors.Is(err, refresh.ErrNotFound),
			errors.Is(err, refresh.ErrAlreadyRevoked),
			errors.Is(err, refresh.ErrExpired),
			errors.Is(err, refresh.ErrDeviceMismatch):
			log.Printf("Refresh rejected (%v) for device %q", err, req.DeviceIdentifier)
		default:
			log.Printf("Refresh error for device %q: %v", req.DeviceIdentifier, err)
		}
		c.JSON(http.StatusUnauthorized, gin.H{"message": "Invalid refresh token."})
		return
	}

	accessToken, ttlSeconds, err := IssueAccessToken(result.UserID, result.DeviceIdentifier)
	if err != nil {
		log.Printf("Refresh: failed to issue access token for user %s: %v", result.UserID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Failed to issue access token"})
		return
	}

	user, err := h.db.GetUserIdentityFields(ctx, result.UserID)
	if err != nil {
		// User row missing but a refresh token existed → likely a DELETE USER
		// race. Treat as invalid credential.
		log.Printf("Refresh: user %s not found after valid rotation: %v", result.UserID, err)
		c.JSON(http.StatusUnauthorized, gin.H{"message": "Invalid refresh token."})
		return
	}

	c.JSON(http.StatusOK, AuthResponse{
		AccessToken:     accessToken,
		RefreshToken:    result.NewPlaintext,
		AccessExpiresIn: ttlSeconds,
		UserID:          result.UserID,
		Username:        user.Username,
		FullName:        user.FullName.String,
		UsernameSet:     user.UsernameSet,
	})
}

// Logout handles POST /auth/logout. Idempotent by design — an already-revoked
// or unknown token still returns 204 so double-submits don't spam client error
// handling, and the endpoint doesn't become an enumeration oracle.
func (h *AuthHandler) Logout(c *gin.Context) {
	ctx := c.Request.Context()
	var req LogoutRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Invalid request: " + err.Error()})
		return
	}
	if err := h.refresh.Revoke(ctx, req.RefreshToken); err != nil {
		// Revoke swallows not-found / already-revoked; any error here is internal.
		// Log it but still return 204 — logout is idempotent by contract.
		log.Printf("Logout: revoke error (non-fatal): %v", err)
	}
	c.Status(http.StatusNoContent)
}
