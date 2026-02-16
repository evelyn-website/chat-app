package ws

import (
	"chat-app-server/db"
	"chat-app-server/util"
	"database/sql"
	"errors"
	"log"
	"math"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func (h *Handler) CreateInvite(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := util.GetUser(c, h.db)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not found or unauthorized"})
		return
	}

	var req CreateInviteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.MaxUses > math.MaxInt32 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "max_uses is too large"})
		return
	}

	// Verify user is admin of the group
	userGroup, err := h.db.GetUserGroupByGroupIDAndUserID(ctx, db.GetUserGroupByGroupIDAndUserIDParams{
		UserID:  &user.ID,
		GroupID: &req.GroupID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
			c.JSON(http.StatusForbidden, gin.H{"error": "User not part of the group"})
		} else {
			log.Printf("Error checking admin status for invite creation: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check user permissions"})
		}
		return
	}
	if !userGroup.Admin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only admins can create invite links"})
		return
	}

	// Fetch group to check end_time
	group, err := h.db.GetGroupById(ctx, req.GroupID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Group not found"})
		} else {
			log.Printf("Error fetching group for invite creation: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve group"})
		}
		return
	}

	// Reject if group already ended
	if group.EndTime.Valid && group.EndTime.Time.Before(time.Now()) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot create invite for an ended group"})
		return
	}

	// Calculate expiry: min(now + 7 days, group.EndTime)
	expiresAt := time.Now().Add(7 * 24 * time.Hour)
	if group.EndTime.Valid && group.EndTime.Time.Before(expiresAt) {
		expiresAt = group.EndTime.Time
	}

	// Generate invite code
	code, err := util.GenerateInviteCode(20)
	if err != nil {
		log.Printf("Error generating invite code: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate invite code"})
		return
	}

	maxUses := int32(req.MaxUses)
	invite, err := h.db.InsertInvite(ctx, db.InsertInviteParams{
		Code:      code,
		GroupID:   req.GroupID,
		CreatedBy: user.ID,
		ExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true},
		MaxUses:   maxUses,
	})
	if err != nil {
		log.Printf("Error inserting invite: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create invite"})
		return
	}

	inviteBaseURL := os.Getenv("INVITE_BASE_URL")
	if inviteBaseURL == "" {
		inviteBaseURL = "myapp://invite"
	}
	inviteURL := inviteBaseURL + "/" + invite.Code

	c.JSON(http.StatusOK, CreateInviteResponse{
		Code:      invite.Code,
		ExpiresAt: expiresAt,
		MaxUses:   req.MaxUses,
		InviteURL: inviteURL,
	})
}

func (h *Handler) ValidateInvite(c *gin.Context) {
	ctx := c.Request.Context()
	code := c.Param("code")

	invite, err := h.db.GetInviteByCode(ctx, code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Invite not found"})
		} else {
			log.Printf("Error looking up invite by code: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to look up invite"})
		}
		return
	}

	// Check expired by time
	if invite.ExpiresAt.Valid && invite.ExpiresAt.Time.Before(time.Now()) {
		c.JSON(http.StatusGone, gin.H{"error": "Invite has expired"})
		return
	}

	// Check expired by max uses
	if invite.MaxUses > 0 && invite.UseCount >= invite.MaxUses {
		c.JSON(http.StatusGone, gin.H{"error": "Invite has reached maximum uses"})
		return
	}

	// Get group preview
	groupPreview, err := h.db.GetGroupPreviewByID(ctx, invite.GroupID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Group no longer exists"})
		} else {
			log.Printf("Error fetching group preview for invite: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve group info"})
		}
		return
	}

	response := InvitePreviewResponse{
		GroupID:     groupPreview.ID,
		GroupName:   groupPreview.Name,
		MemberCount: groupPreview.MemberCount,
		ExpiresAt:   invite.ExpiresAt.Time,
	}

	if groupPreview.Description.Valid {
		response.Description = &groupPreview.Description.String
	}
	if groupPreview.ImageUrl.Valid {
		response.ImageUrl = &groupPreview.ImageUrl.String
	}
	if groupPreview.Blurhash.Valid {
		response.Blurhash = &groupPreview.Blurhash.String
	}
	if groupPreview.StartTime.Valid {
		response.StartTime = &groupPreview.StartTime.Time
	}
	if groupPreview.EndTime.Valid {
		response.EndTime = &groupPreview.EndTime.Time
	}

	c.JSON(http.StatusOK, response)
}

func (h *Handler) AcceptInvite(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := util.GetUser(c, h.db)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not found or unauthorized"})
		return
	}

	code := c.Param("code")

	invite, err := h.db.GetInviteByCode(ctx, code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Invite not found"})
		} else {
			log.Printf("Error looking up invite for acceptance: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to look up invite"})
		}
		return
	}

	// Check expired by time
	if invite.ExpiresAt.Valid && invite.ExpiresAt.Time.Before(time.Now()) {
		c.JSON(http.StatusGone, gin.H{"error": "Invite has expired"})
		return
	}

	// Check expired by max uses
	if invite.MaxUses > 0 && invite.UseCount >= invite.MaxUses {
		c.JSON(http.StatusGone, gin.H{"error": "Invite has reached maximum uses"})
		return
	}

	// Check group still exists
	_, err = h.db.GetGroupById(ctx, invite.GroupID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Group no longer exists"})
		} else {
			log.Printf("Error fetching group for invite acceptance: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check group"})
		}
		return
	}

	// Check if user is already a member
	isMember, err := util.UserInGroup(ctx, user.ID, invite.GroupID, h.db)
	if err != nil {
		log.Printf("Error checking group membership for invite acceptance: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check membership"})
		return
	}
	if isMember {
		c.JSON(http.StatusOK, AcceptInviteResponse{
			GroupID: invite.GroupID,
			Message: "Already a member",
		})
		return
	}

	// Check block conflicts
	hasConflict, err := h.db.CheckBlockConflictWithGroup(ctx, db.CheckBlockConflictWithGroupParams{
		BlockedID: user.ID,
		GroupID:   &invite.GroupID,
	})
	if err != nil {
		log.Printf("Error checking block conflict for invite acceptance: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify eligibility"})
		return
	}
	if hasConflict {
		c.JSON(http.StatusForbidden, gin.H{"error": "Unable to join"})
		return
	}

	// Transaction: add user to group + increment use count
	tx, err := h.conn.Begin(ctx)
	if err != nil {
		log.Printf("Failed to begin transaction for invite acceptance: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to start operation"})
		return
	}
	defer tx.Rollback(ctx)

	qtx := h.db.WithTx(tx)

	_, err = qtx.InsertUserGroup(ctx, db.InsertUserGroupParams{
		UserID:  &user.ID,
		GroupID: &invite.GroupID,
		Admin:   false,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// ON CONFLICT DO NOTHING — already in group (race condition)
			c.JSON(http.StatusOK, AcceptInviteResponse{
				GroupID: invite.GroupID,
				Message: "Already a member",
			})
			return
		}
		log.Printf("Error inserting user_group via invite: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to join group"})
		return
	}

	rowsAffected, err := qtx.IncrementInviteUseCount(ctx, invite.ID)
	if err != nil {
		log.Printf("Error incrementing invite use count: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process invite"})
		return
	}
	if rowsAffected != 1 {
		c.JSON(http.StatusGone, gin.H{"error": "Invite has reached maximum uses"})
		return
	}

	if err := tx.Commit(ctx); err != nil {
		log.Printf("Failed to commit invite acceptance transaction: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to finalize joining group"})
		return
	}

	// Notify hub — same pattern as InviteUsersToGroup
	select {
	case h.hub.AddUserToGroupChan <- &AddClientToGroupMsg{UserID: user.ID, GroupID: invite.GroupID}:
		log.Printf("Sent request to hub to process user %s addition to group %s via invite", user.ID.String(), invite.GroupID.String())
	case <-ctx.Done():
		log.Printf("Context cancelled while sending AddUserToGroupChan for invite acceptance")
	case <-time.After(2 * time.Second):
		log.Printf("Warning: Timed out sending AddUserToGroupChan for invite acceptance user %s group %s", user.ID, invite.GroupID)
	}

	groupID := invite.GroupID
	c.JSON(http.StatusOK, AcceptInviteResponse{
		GroupID: groupID,
		Message: "Successfully joined group",
	})
}
