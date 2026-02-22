package server

import (
	"chat-app-server/util"
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type ClientDeviceKeyInfo struct {
	DeviceIdentifier string `json:"device_identifier"`
	PublicKey        string `json:"public_key"`
	SigningPublicKey string `json:"signing_public_key"`
}
type UserWithDeviceKeys struct {
	UserID     uuid.UUID             `json:"user_id"`
	DeviceKeys []ClientDeviceKeyInfo `json:"device_keys"`
}

func (api *API) WhoAmI(c *gin.Context) {
	user, err := util.GetUser(c, api.db)

	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not found"})
		return
	}

	c.JSON(http.StatusOK, user)

}
func (api *API) GetRelevantDeviceKeys(c *gin.Context) {
	user, err := util.GetUser(c, api.db)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not found or unauthorized"})
		return
	}

	relevantUserRows, err := api.db.GetRelevantUserDeviceKeys(c.Request.Context(), &user.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusOK, []UserWithDeviceKeys{})
			return
		}
		log.Printf("Error loading relevant device keys for user %s: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load relevant device keys"})
		return
	}

	// If relevantUserRows is nil but no error (can happen if query returns 0 rows not as ErrNoRows)
	if relevantUserRows == nil {
		c.JSON(http.StatusOK, []UserWithDeviceKeys{})
		return
	}

	response := make([]UserWithDeviceKeys, 0, len(relevantUserRows))
	for _, row := range relevantUserRows {
		var deviceKeyInfos []ClientDeviceKeyInfo
		if len(row.DeviceKeys) > 0 {
			if err := json.Unmarshal(row.DeviceKeys, &deviceKeyInfos); err != nil {
				log.Printf("Error unmarshalling device_keys JSON for user %s: %v. JSON: %s", row.UserID, err, string(row.DeviceKeys))
				continue
			}
		}

		response = append(response, UserWithDeviceKeys{
			UserID:     *row.UserID,
			DeviceKeys: deviceKeyInfos,
		})
	}

	c.JSON(http.StatusOK, response)
}
