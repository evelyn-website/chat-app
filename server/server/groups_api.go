package server

import (
	"chat-app-server/db"
	"chat-app-server/util"
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (api *API) ToggleGroupMuted(c *gin.Context) {
	user, err := util.GetUser(c, api.db)
	if err != nil {
		c.JSON(http.StatusUnauthorized,
			gin.H{"error": "User not found or unauthorized"})
		return
	}

	groupID, err := uuid.Parse(c.Param("groupID"))
	if err != nil {
		c.JSON(http.StatusBadRequest,
			gin.H{"error": "Invalid group ID"})
		return
	}

	ctx := c.Request.Context()

	result, err := api.db.ToggleGroupMuted(ctx, db.ToggleGroupMutedParams{
		UserID:  &user.ID,
		GroupID: &groupID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound,
				gin.H{"error": "User is not a member of this group"})
			return
		}
		log.Printf("Error toggling mute for user %s in group %s: %v", user.ID, groupID, err)
		c.JSON(http.StatusInternalServerError,
			gin.H{"error": "Failed to toggle mute"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"muted": result.Muted})
}

func (api *API) ReserveGroup(c *gin.Context) {
  user, err := util.GetUser(c, api.db)
  if err != nil {
    c.JSON(http.StatusUnauthorized,
      gin.H{"error": "User not found or unauthorized"})
    return
  }

  id, err := uuid.Parse(c.Param("groupID"))
  if err != nil {
    c.JSON(http.StatusBadRequest,
      gin.H{"error": "Invalid group ID"})
    return
  }

  ctx := c.Request.Context()

  if _, err := api.db.GetGroupById(ctx, id); err == nil {
    c.JSON(http.StatusConflict,
      gin.H{"error": "Group already exists"})
    return
  } else if !errors.Is(err, pgx.ErrNoRows) {
    log.Printf("db error checking group %s: %v", id, err)
    c.JSON(http.StatusInternalServerError,
      gin.H{"error": "Internal error"})
    return
  }

  resv, err := api.db.GetGroupReservation(ctx, id)
  if err == nil {
    if resv.UserID == user.ID {
      c.JSON(http.StatusOK,
        gin.H{"message": "Group already reserved"})
    } else {
      c.JSON(http.StatusConflict,
        gin.H{"error": "Group ID already reserved"})
    }
    return
  } else if !errors.Is(err, pgx.ErrNoRows) {
    log.Printf("db error checking reservation %s: %v", id, err)
    c.JSON(http.StatusInternalServerError,
      gin.H{"error": "Internal error"})
    return
  }

  if _, err := api.db.ReserveGroup(ctx, db.ReserveGroupParams{
    GroupID: id,
    UserID:  user.ID,
  }); err != nil {
    log.Printf("db error inserting reservation %s: %v", id, err)
    c.JSON(http.StatusInternalServerError,
      gin.H{"error": "Could not reserve group"})
    return
  }

  c.JSON(http.StatusCreated,
    gin.H{"message": "Group reserved successfully"})
}