package notifications

import (
	"bytes"
	"chat-app-server/db"
	"chat-app-server/rediskeys"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"time"

	expo "github.com/oliveroneill/exponent-server-sdk-golang/sdk"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/redis/go-redis/v9"
)

const (
	redisClientServerPrefix = rediskeys.ClientServerPrefix
	redisGroupMembersPrefix = rediskeys.GroupMembersPrefix

	// Expo API allows up to 100 notifications per request
	maxBatchSize = 100

	// Expo receipts API endpoint
	expoReceiptsURL = "https://exp.host/--/api/v2/push/getReceipts"
)

// tokenPattern validates Expo push token format
var tokenPattern = regexp.MustCompile(`^Expo(nent)?PushToken\[.+\]$`)

// NotificationService handles sending push notifications via Expo
type NotificationService struct {
	client      *expo.PushClient
	db          *db.Queries
	redisClient *redis.Client
	httpClient  *http.Client
}

// NewNotificationService creates a new notification service
func NewNotificationService(dbQueries *db.Queries, redisClient *redis.Client) *NotificationService {
	return &NotificationService{
		client:      expo.NewPushClient(nil),
		db:          dbQueries,
		redisClient: redisClient,
		httpClient:  &http.Client{Timeout: 30 * time.Second},
	}
}

// ValidateToken checks if a push token has valid Expo format
func ValidateToken(token string) bool {
	return tokenPattern.MatchString(token)
}

// SendMessageNotification sends push notifications to offline group members
func (s *NotificationService) SendMessageNotification(
	ctx context.Context,
	groupID uuid.UUID,
	groupName string,
	senderID uuid.UUID,
	senderName string,
	messagePreview string,
) {
	// Get group members from Redis
	groupMembersKey := redisGroupMembersPrefix + groupID.String() + ":members"
	memberIDsStr, err := s.redisClient.SMembers(ctx, groupMembersKey).Result()
	if err != nil {
		log.Printf("NotificationService: Error getting group members from Redis: %v", err)
		return
	}

	if len(memberIDsStr) == 0 {
		return
	}

	// Filter out sender and check online status
	var offlineUserIDs []uuid.UUID
	for _, memberIDStr := range memberIDsStr {
		memberID, err := uuid.Parse(memberIDStr)
		if err != nil {
			continue
		}

		// Skip the sender
		if memberID == senderID {
			continue
		}

		// Check if user is online (has active WebSocket connection)
		clientKey := redisClientServerPrefix + memberIDStr + ":server_id"
		exists, err := s.redisClient.Exists(ctx, clientKey).Result()
		if err != nil {
			log.Printf("NotificationService: Error checking online status for user %s: %v", memberIDStr, err)
			continue
		}

		// If key doesn't exist, user is offline
		if exists == 0 {
			offlineUserIDs = append(offlineUserIDs, memberID)
		}
	}

	if len(offlineUserIDs) == 0 {
		log.Printf("NotificationService: No offline users to notify for group %s", groupID.String())
		return
	}

	// Filter out users who have muted this group
	mutedUserIDs, err := s.db.GetMutedUserIDsForGroup(ctx, &groupID)
	if err != nil {
		log.Printf("NotificationService: Error getting muted users for group %s: %v", groupID.String(), err)
		// Continue without filtering — better to over-notify than silently fail
	} else if len(mutedUserIDs) > 0 {
		mutedSet := make(map[uuid.UUID]bool, len(mutedUserIDs))
		for _, id := range mutedUserIDs {
			if id != nil {
				mutedSet[*id] = true
			}
		}
		filtered := offlineUserIDs[:0]
		for _, uid := range offlineUserIDs {
			if !mutedSet[uid] {
				filtered = append(filtered, uid)
			}
		}
		offlineUserIDs = filtered
	}

	if len(offlineUserIDs) == 0 {
		log.Printf("NotificationService: All offline users have muted group %s", groupID.String())
		return
	}

	// Get push tokens for offline users
	tokens, err := s.db.GetPushTokensForUsers(ctx, offlineUserIDs)
	if err != nil {
		log.Printf("NotificationService: Error getting push tokens: %v", err)
		return
	}

	if len(tokens) == 0 {
		log.Printf("NotificationService: No push tokens found for offline users in group %s", groupID.String())
		return
	}

	// Build notification messages
	var messages []expo.PushMessage
	tokenMap := make(map[int]string) // Index to token for receipt tracking

	title := groupName
	body := fmt.Sprintf("%s: %s", senderName, messagePreview)

	for _, tokenRow := range tokens {
		if !tokenRow.ExpoPushToken.Valid {
			continue
		}
		token := tokenRow.ExpoPushToken.String

		// Validate token format
		if !ValidateToken(token) {
			log.Printf("NotificationService: Invalid token format for user %s, skipping", tokenRow.UserID.String())
			continue
		}

		pushToken, err := expo.NewExponentPushToken(token)
		if err != nil {
			log.Printf("NotificationService: Error creating push token: %v", err)
			continue
		}

		tokenMap[len(messages)] = token
		messages = append(messages, expo.PushMessage{
			To:       []expo.ExponentPushToken{pushToken},
			Title:    title,
			Body:     body,
			Sound:    "default",
			Priority: expo.DefaultPriority,
			Data: map[string]string{
				"groupId": groupID.String(),
			},
		})
	}

	if len(messages) == 0 {
		return
	}

	// Send in batches of 100
	for i := 0; i < len(messages); i += maxBatchSize {
		end := i + maxBatchSize
		if end > len(messages) {
			end = len(messages)
		}
		batch := messages[i:end]

		responses, err := s.client.PublishMultiple(batch)
		if err != nil {
			log.Printf("NotificationService: Error sending batch: %v", err)
			continue
		}

		// Process responses and store receipts for later verification
		for j, response := range responses {
			if response.Status == expo.SuccessStatus {
				// Store receipt for later checking
				if response.ID != "" {
					token := tokenMap[i+j]
					if err := s.db.InsertPushReceipt(ctx, db.InsertPushReceiptParams{
						TicketID:  response.ID,
						PushToken: token,
					}); err != nil {
						log.Printf("NotificationService: Error storing receipt: %v", err)
					}
				}
			} else {
				// Handle immediate errors
				log.Printf("NotificationService: Push failed for token: %s, error: %s",
					batch[j].To[0], response.Message)

				// If token is invalid, remove it
				if response.Details != nil && response.Details["error"] == expo.ErrorDeviceNotRegistered {
					token := tokenMap[i+j]
					if err := s.db.DeletePushTokenByValue(ctx, pgtype.Text{String: token, Valid: true}); err != nil {
						log.Printf("NotificationService: Error removing invalid token: %v", err)
					} else {
						log.Printf("NotificationService: Removed invalid token: %s", token)
					}
				}
			}
		}
	}

	log.Printf("NotificationService: Sent %d notifications for group %s", len(messages), groupID.String())
}

// receiptRequest is the request body for the Expo receipts API
type receiptRequest struct {
	IDs []string `json:"ids"`
}

// receiptResponse is the response from the Expo receipts API
type receiptResponse struct {
	Data map[string]struct {
		Status  string            `json:"status"`
		Message string            `json:"message,omitempty"`
		Details map[string]string `json:"details,omitempty"`
	} `json:"data"`
}

// ProcessReceipts checks pending receipts and removes invalid tokens
func (s *NotificationService) ProcessReceipts(ctx context.Context) error {
	// Get pending receipts (older than 15 minutes)
	receipts, err := s.db.GetPendingReceipts(ctx)
	if err != nil {
		return fmt.Errorf("error getting pending receipts: %w", err)
	}

	if len(receipts) == 0 {
		return nil
	}

	// Build ticket ID to token map
	ticketToToken := make(map[string]string)
	var ticketIDs []string
	for _, r := range receipts {
		ticketToToken[r.TicketID] = r.PushToken
		ticketIDs = append(ticketIDs, r.TicketID)
	}

	// Fetch receipts from Expo in batches
	processedTickets := []string{}
	for i := 0; i < len(ticketIDs); i += maxBatchSize {
		end := i + maxBatchSize
		if end > len(ticketIDs) {
			end = len(ticketIDs)
		}
		batch := ticketIDs[i:end]

		// Make HTTP request to Expo receipts API
		reqBody, err := json.Marshal(receiptRequest{IDs: batch})
		if err != nil {
			log.Printf("NotificationService: Error marshalling receipt request: %v", err)
			continue
		}

		req, err := http.NewRequestWithContext(ctx, "POST", expoReceiptsURL, bytes.NewBuffer(reqBody))
		if err != nil {
			log.Printf("NotificationService: Error creating receipt request: %v", err)
			continue
		}
		req.Header.Set("Content-Type", "application/json")

		resp, err := s.httpClient.Do(req)
		if err != nil {
			log.Printf("NotificationService: Error fetching receipts: %v", err)
			continue
		}

		var receiptResp receiptResponse
		if err := json.NewDecoder(resp.Body).Decode(&receiptResp); err != nil {
			resp.Body.Close()
			log.Printf("NotificationService: Error decoding receipt response: %v", err)
			continue
		}
		resp.Body.Close()

		for ticketID, receipt := range receiptResp.Data {
			processedTickets = append(processedTickets, ticketID)

			if receipt.Status != "ok" {
				// Check if device is not registered
				if receipt.Details != nil && receipt.Details["error"] == expo.ErrorDeviceNotRegistered {
					token := ticketToToken[ticketID]
					if err := s.db.DeletePushTokenByValue(ctx, pgtype.Text{String: token, Valid: true}); err != nil {
						log.Printf("NotificationService: Error removing invalid token: %v", err)
					} else {
						log.Printf("NotificationService: Removed unregistered device token: %s", token)
					}
				}
			}
		}
	}

	// Delete processed receipts
	if len(processedTickets) > 0 {
		if err := s.db.DeleteReceipts(ctx, processedTickets); err != nil {
			log.Printf("NotificationService: Error deleting processed receipts: %v", err)
		}
	}

	// Clean up old receipts (older than 24 hours)
	if err := s.db.DeleteOldReceipts(ctx); err != nil {
		log.Printf("NotificationService: Error deleting old receipts: %v", err)
	}

	log.Printf("NotificationService: Processed %d receipts", len(processedTickets))
	return nil
}
