package notifications

import (
	"chat-app-server/db"
	"chat-app-server/util"
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"
)

// NotificationHandler handles push notification related HTTP requests
type NotificationHandler struct {
	db  *db.Queries
	ctx context.Context
}

// NewNotificationHandler creates a new notification handler
func NewNotificationHandler(dbQueries *db.Queries, ctx context.Context) *NotificationHandler {
	return &NotificationHandler{
		db:  dbQueries,
		ctx: ctx,
	}
}

type registerTokenRequest struct {
	DeviceIdentifier string `json:"deviceIdentifier" binding:"required"`
	ExpoPushToken    string `json:"expoPushToken" binding:"required"`
}

type clearTokenRequest struct {
	DeviceIdentifier string `json:"deviceIdentifier" binding:"required"`
}

// RegisterPushToken registers or updates a push token for a device
func (h *NotificationHandler) RegisterPushToken(c *gin.Context) {
	// Get user from JWT (set by JWTAuthMiddleware)
	user, err := util.GetUser(c, h.db)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not found or unauthorized"})
		return
	}

	var req registerTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	// Validate token format
	if !ValidateToken(req.ExpoPushToken) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid push token format"})
		return
	}

	ctx := c.Request.Context()

	// Update the device's push token
	_, err = h.db.UpdateDevicePushToken(ctx, db.UpdateDevicePushTokenParams{
		UserID:           user.ID,
		DeviceIdentifier: req.DeviceIdentifier,
		ExpoPushToken:    pgtype.Text{String: req.ExpoPushToken, Valid: true},
	})

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to register push token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Push token registered successfully"})
}

// ClearPushToken removes the push token for a device (used on logout)
func (h *NotificationHandler) ClearPushToken(c *gin.Context) {
	// Get user from JWT (set by JWTAuthMiddleware)
	user, err := util.GetUser(c, h.db)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not found or unauthorized"})
		return
	}

	var req clearTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	ctx := c.Request.Context()

	// Clear the device's push token
	err = h.db.ClearDevicePushToken(ctx, db.ClearDevicePushTokenParams{
		UserID:           user.ID,
		DeviceIdentifier: req.DeviceIdentifier,
	})

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to clear push token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Push token cleared successfully"})
}
