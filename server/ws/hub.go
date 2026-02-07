package ws

import (
	"chat-app-server/db"
	"chat-app-server/notifications"
	"chat-app-server/rediskeys"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type Group struct {
	ID      uuid.UUID             `json:"id"`
	Name    string                `json:"name"`
	Clients map[uuid.UUID]*Client `json:"clients"`
	mutex   sync.RWMutex
}

type RemoveClientFromGroupMsg struct {
	UserID  uuid.UUID
	GroupID uuid.UUID
}

type AddClientToGroupMsg struct {
	UserID  uuid.UUID
	GroupID uuid.UUID
}

type InitializeGroupMsg struct {
	GroupID uuid.UUID
	Name    string
	AdminID uuid.UUID
}

type DeleteHubGroupMsg struct {
	GroupID uuid.UUID
}

type PubSubMessage struct {
	Type           string      `json:"type"`
	Payload        interface{} `json:"payload"`
	OriginServerID string      `json:"origin_server_id"`
}

type ChatMessagePayload struct {
	Message *RawMessageE2EE `json:"message"`
}

type UserGroupEventPayload struct {
	UserID  uuid.UUID `json:"user_id"`
	GroupID uuid.UUID `json:"group_id"`
}
type GroupEventPayload struct {
	GroupID uuid.UUID `json:"group_id"`
	Name    string    `json:"name,omitempty"`
	AdminID uuid.UUID `json:"admin_id,omitempty"`
}

type GroupUpdateEventPayload struct {
	GroupID uuid.UUID `json:"group_id"`
	Name    string    `json:"name,omitempty"`
}

type Hub struct {
	Clients                 map[uuid.UUID]*Client
	Groups                  map[uuid.UUID]*Group
	Register                chan *Client
	Unregister              chan *Client
	Broadcast               chan *RawMessageE2EE
	RemoveUserFromGroupChan chan *RemoveClientFromGroupMsg
	AddUserToGroupChan      chan *AddClientToGroupMsg
	InitializeGroupChan     chan *InitializeGroupMsg
	DeleteHubGroupChan      chan *DeleteHubGroupMsg
	UpdateGroupInfoChan     chan *GroupUpdateEventPayload
	mutex                   sync.RWMutex
	redisClient             *redis.Client
	serverID                string
	db                      *db.Queries
	pgxPool                 *pgxpool.Pool
	ctx                     context.Context
	notificationService     *notifications.NotificationService
}

const (
	redisClientServerPrefix  = rediskeys.ClientServerPrefix
	redisServerClientsPrefix = rediskeys.ServerClientsPrefix
	redisUserGroupsPrefix    = rediskeys.UserGroupsPrefix
	redisGroupMembersPrefix  = rediskeys.GroupMembersPrefix
	redisGroupInfoPrefix     = rediskeys.GroupInfoPrefix

	pubSubGroupMessagesChannel = rediskeys.PubSubGroupMessagesChannel
	pubSubGroupEventsChannel   = rediskeys.PubSubGroupEventsChannel
)

func NewHub(
	dbQueries *db.Queries,
	ctx context.Context,
	conn *pgxpool.Pool,
	redisClient *redis.Client,
	serverID string,
	notificationService *notifications.NotificationService,
) *Hub {
	hub := &Hub{
		Clients:                 make(map[uuid.UUID]*Client),
		Groups:                  make(map[uuid.UUID]*Group),
		Register:                make(chan *Client),
		Unregister:              make(chan *Client),
		Broadcast:               make(chan *RawMessageE2EE, 256),
		RemoveUserFromGroupChan: make(chan *RemoveClientFromGroupMsg),
		AddUserToGroupChan:      make(chan *AddClientToGroupMsg),
		InitializeGroupChan:     make(chan *InitializeGroupMsg),
		DeleteHubGroupChan:      make(chan *DeleteHubGroupMsg),
		UpdateGroupInfoChan:     make(chan *GroupUpdateEventPayload),
		redisClient:             redisClient,
		serverID:                serverID,
		db:                      dbQueries,
		pgxPool:                 conn,
		ctx:                     ctx,
		notificationService:     notificationService,
	}

	// Populate Redis from DB on startup
	// This should ideally only be done by ONE instance in a scaled environment,
	// or be an idempotent operation if all instances do it.
	// For simplicity now, let's assume one instance does it or it's idempotent.
	// A better approach for scaled envs might be a leader election or a separate seeding service.
	if err := hub.synchronizeDbToRedis(); err != nil {
		// Log the error, but the hub might still be able to function,
		// relying on runtime updates to Redis.
		// However, this could lead to inconsistencies if Redis was empty.
		log.Printf("Hub %s: CRITICAL - Failed to synchronize DB to Redis on startup: %v. Redis might be out of sync.", serverID, err)
	} else {
		log.Printf("Hub %s: Successfully synchronized DB to Redis (or verified sync).", serverID)
	}

	go hub.listenPubSub()
	return hub
}

func (h *Hub) listenPubSub() {
	groupMessagesPattern := pubSubGroupMessagesChannel + ":*"
	pubsub := h.redisClient.Subscribe(h.ctx, pubSubGroupEventsChannel)
	if err := pubsub.PUnsubscribe(h.ctx); err != nil {
		log.Printf("Hub %s: PUnsubscribe failed", h.serverID)
		return
	}
	if err := pubsub.PSubscribe(h.ctx, groupMessagesPattern); err != nil {
		log.Printf("Hub %s: Error PSubscribing to %s: %v", h.serverID, groupMessagesPattern, err)
		return
	}
	defer pubsub.Close()

	ch := pubsub.Channel()
	log.Printf("Hub %s listening to Redis Pub/Sub (Events: %s, Messages: %s)", h.serverID, pubSubGroupEventsChannel, groupMessagesPattern)

	for {
		select {
		case <-h.ctx.Done():
			log.Printf("Hub %s: Context cancelled, stopping PubSub listener.", h.serverID)
			return
		case msg, ok := <-ch:
			if !ok {
				log.Printf("Hub %s: PubSub channel closed.", h.serverID)
				return
			}

			var pubSubMsg PubSubMessage
			if err := json.Unmarshal([]byte(msg.Payload), &pubSubMsg); err != nil {
				log.Printf("Hub %s: Error unmarshalling pubsub message from channel %s: %v. Payload: %s",
					h.serverID, msg.Channel, err, msg.Payload)
				continue
			}

			log.Printf("Hub %s received from Redis PubSub channel %s: Type %s", h.serverID, msg.Channel, pubSubMsg.Type)

			switch pubSubMsg.Type {
			case "chat_message":
				var payload ChatMessagePayload
				if err := mapToStruct(pubSubMsg.Payload, &payload); err != nil {
					log.Printf("Error decoding chat_message payload: %v", err)
					continue
				}
				h.deliverChatMessage(payload.Message)
			case "user_added_to_group":
				var payload UserGroupEventPayload
				if err := mapToStruct(pubSubMsg.Payload, &payload); err != nil {
					log.Printf("Error decoding user_added_to_group payload: %v", err)
					continue
				}
				h.handleUserAddedToGroupEvent(payload.UserID, payload.GroupID)
			case "user_removed_from_group":
				var payload UserGroupEventPayload
				if err := mapToStruct(pubSubMsg.Payload, &payload); err != nil {
					log.Printf("Error decoding user_removed_from_group payload: %v", err)
					continue
				}
				h.handleUserRemovedFromGroupEvent(payload.UserID, payload.GroupID)
			case "group_created":
				var payload GroupEventPayload
				if err := mapToStruct(pubSubMsg.Payload, &payload); err != nil {
					log.Printf("Error decoding group_created payload: %v", err)
					continue
				}
				h.handleGroupCreatedEvent(payload.GroupID, payload.Name, payload.AdminID)
			case "group_deleted":
				var payload GroupEventPayload
				if err := mapToStruct(pubSubMsg.Payload, &payload); err != nil {
					log.Printf("Error decoding group_deleted payload: %v", err)
					continue
				}
				h.handleGroupDeletedEvent(payload.GroupID)
			case "group_updated":
				var payload GroupUpdateEventPayload
				if err := mapToStruct(pubSubMsg.Payload, &payload); err != nil {
					log.Printf("Hub %s: Error decoding group_updated payload: %v", h.serverID, err)
					continue
				}
				h.handleGroupUpdatedEvent(payload.GroupID, payload.Name)
			}
		}
	}
}

func (h *Hub) synchronizeDbToRedis() error {
	log.Printf("Hub %s: Starting DB to Redis synchronization...", h.serverID)

	dbGroups, err := h.db.GetAllGroups(h.ctx)
	if err != nil {
		return fmt.Errorf("error fetching all groups from DB: %w", err)
	}

	pipe := h.redisClient.Pipeline()
	for _, dbGroup := range dbGroups {
		groupInfoKey := redisGroupInfoPrefix + dbGroup.ID.String()
		pipe.HSet(h.ctx, groupInfoKey, "id", dbGroup.ID.String())
		pipe.HSet(h.ctx, groupInfoKey, "name", dbGroup.Name)
		log.Printf("Hub %s: Queued sync for groupinfo:%s", h.serverID, dbGroup.ID.String())
	}

	allUserGroupLinks, err := h.db.GetAllUserGroups(h.ctx)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			log.Printf("Hub %s: No user_group entries found in DB to sync.", h.serverID)
		} else {
			return fmt.Errorf("error fetching all user_group links from DB: %w", err)
		}
	}

	for _, link := range allUserGroupLinks {
		if *link.UserID == uuid.Nil || *link.GroupID == uuid.Nil {
			log.Printf("Hub %s: Skipping sync for invalid UserGroupLink: UserID Valid: %t, GroupID Valid: %t from link: %+v",
				h.serverID, *link.UserID == uuid.Nil, *link.GroupID == uuid.Nil, link)
			continue
		}

		userIDStr := link.UserID.String()
		groupIDStr := link.GroupID.String()

		userGroupsKey := redisUserGroupsPrefix + userIDStr + ":groups"
		groupMembersKey := redisGroupMembersPrefix + groupIDStr + ":members"

		pipe.SAdd(h.ctx, userGroupsKey, groupIDStr)

		pipe.SAdd(h.ctx, groupMembersKey, userIDStr)

		log.Printf("Hub %s: Queued sync: user:%s:groups ADD %s | group:%s:members ADD %s",
			h.serverID, userIDStr, groupIDStr, groupIDStr, userIDStr)
	}

	_, execErr := pipe.Exec(h.ctx)
	if execErr != nil {
		return fmt.Errorf("error executing Redis pipeline for DB sync: %w", execErr)
	}

	log.Printf("Hub %s: DB to Redis synchronization pipeline executed.", h.serverID)
	return nil
}

func mapToStruct(data interface{}, result interface{}) error {
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, result)
}

func (h *Hub) deliverChatMessage(message *RawMessageE2EE) {
	h.mutex.RLock()
	group, groupExists := h.Groups[message.GroupID]
	h.mutex.RUnlock()

	if !groupExists {
		return
	}

	group.mutex.RLock()
	defer group.mutex.RUnlock()

	for clientID, client := range group.Clients {
		h.mutex.RLock()
		_, stillConnected := h.Clients[clientID]
		h.mutex.RUnlock()

		if stillConnected {
			select {
			case client.Message <- message:
			default:
				log.Printf("Hub %s: Client %s message channel full for group %s. E2EE Message ID %s dropped.", h.serverID, client.User.ID.String(), message.GroupID.String(), message.ID)
			}
		}
	}
}

func (h *Hub) handleUserAddedToGroupEvent(userID uuid.UUID, groupID uuid.UUID) {
	h.mutex.Lock()
	defer h.mutex.Unlock()

	client, clientConnectedToThisInstance := h.Clients[userID]
	if clientConnectedToThisInstance {
		client.AddGroup(groupID)
		h.addClientToLocalGroupStructLocked(client, groupID)
		log.Printf("Hub %s: Updated local state for user %s added to group %s", h.serverID, userID.String(), groupID.String())
	}
}

func (h *Hub) handleUserRemovedFromGroupEvent(userID uuid.UUID, groupID uuid.UUID) {
	h.mutex.Lock()
	defer h.mutex.Unlock()

	client, clientConnectedToThisInstance := h.Clients[userID]
	if clientConnectedToThisInstance {
		h.removeClientFromLocalGroupStructLocked(client, groupID)
		client.RemoveGroup(groupID)
		log.Printf("Hub %s: Updated local state for user %s removed from group %s", h.serverID, userID.String(), groupID.String())
	}
}

func (h *Hub) handleGroupCreatedEvent(groupID uuid.UUID, name string, adminID uuid.UUID) {
	h.mutex.Lock()
	defer h.mutex.Unlock()

	if _, exists := h.Groups[groupID]; !exists {
		h.Groups[groupID] = &Group{
			ID:      groupID,
			Name:    name,
			Clients: make(map[uuid.UUID]*Client),
		}
		log.Printf("Hub %s: Cached new group %s (%s)", h.serverID, groupID.String(), name)
	} else {
		h.Groups[groupID].Name = name
	}

	if admin, ok := h.Clients[adminID]; ok {
		// Ensure group exists in h.Groups before trying to add client
		if g, gExists := h.Groups[groupID]; gExists {
			g.mutex.Lock()
			g.Clients[adminID] = admin
			g.mutex.Unlock()
			admin.AddGroup(groupID)
			log.Printf("Hub %s: Added admin %s to local cache for new group %s", h.serverID, adminID.String(), groupID.String())
		}
	}
}

func (h *Hub) handleGroupDeletedEvent(groupID uuid.UUID) {
	h.mutex.Lock()
	defer h.mutex.Unlock()

	if group, exists := h.Groups[groupID]; exists {
		group.mutex.Lock()
		for clientID, client := range group.Clients {
			client.RemoveGroup(groupID)
			log.Printf("Hub %s: Client %s removed from local cache of deleted group %s", h.serverID, clientID.String(), groupID.String())
		}
		group.mutex.Unlock()
		delete(h.Groups, groupID)
		log.Printf("Hub %s: Removed group %s from local cache", h.serverID, groupID.String())
	}
}

func (h *Hub) handleGroupUpdatedEvent(groupID uuid.UUID, newName string) {
	h.mutex.Lock()
	defer h.mutex.Unlock()

	if group, exists := h.Groups[groupID]; exists {
		if newName != "" {
			oldName := group.Name
			group.Name = newName
			log.Printf("Hub %s: Updated local cache for group %s name from '%s' to '%s'", h.serverID, groupID.String(), oldName, newName)
		}
	} else {
		log.Printf("Hub %s: Received group_updated event for group %s not in local cache.", h.serverID, groupID.String())
	}
}

func (h *Hub) Run() {
	log.Printf("Hub %s Run loop started", h.serverID)
	refreshDuration := 30 * time.Second
	refreshTicker := time.NewTicker(refreshDuration)
	defer refreshTicker.Stop()

	for {
		select {
		case <-h.ctx.Done():
			log.Printf("Hub %s: Context cancelled, shutting down Run loop.", h.serverID)
			return
		case <-refreshTicker.C:
			h.refreshClientRegistrations()
		case client := <-h.Register:
			h.mutex.Lock()
			h.Clients[client.User.ID] = client
			h.mutex.Unlock()

			clientKey := redisClientServerPrefix + client.User.ID.String() + ":server_id"
			serverClientsKey := redisServerClientsPrefix + h.serverID + ":clients"

			pipe := h.redisClient.Pipeline()
			pipe.Set(h.ctx, clientKey, h.serverID, 120*time.Second)
			pipe.SAdd(h.ctx, serverClientsKey, client.User.ID.String())
			_, err := pipe.Exec(h.ctx)
			if err != nil {
				log.Printf("Hub %s: Error registering client %s in Redis: %v", h.serverID, client.User.ID.String(), err)
			} else {
				log.Printf("Hub %s: Registered client %s to this server in Redis", h.serverID, client.User.ID.String())
			}

			userGroupsKey := redisUserGroupsPrefix + client.User.ID.String() + ":groups"
			groupIDsStr, err := h.redisClient.SMembers(h.ctx, userGroupsKey).Result()
			if err != nil {
				log.Printf("Hub %s: Error fetching groups for user %s from Redis: %v", h.serverID, client.User.ID.String(), err)
			} else {
				h.mutex.Lock()
				for _, groupIDStr := range groupIDsStr {
					groupID, convErr := uuid.Parse(groupIDStr)
					if convErr != nil {
						// Fallback for legacy entries stored as raw 16-byte UUIDs
						if len(groupIDStr) == 16 {
							if gid, err2 := uuid.FromBytes([]byte(groupIDStr)); err2 == nil {
								groupID = gid
							} else {
								log.Printf("Hub %s: Failed to decode binary groupID; len=16, err=%v", h.serverID, err2)
								continue
							}
						} else {
							log.Printf("Hub %s: Error converting groupID %q to uuid: %v", h.serverID, groupIDStr, convErr)
							continue
						}
					}
					client.AddGroup(groupID)
					h.addClientToLocalGroupStructLocked(client, groupID)
				}
				h.mutex.Unlock()
				log.Printf("Hub %s: Client %s joined %d groups locally based on Redis state.", h.serverID, client.User.ID.String(), len(groupIDsStr))
			}

		case client := <-h.Unregister:
			h.mutex.Lock()
			if _, ok := h.Clients[client.User.ID]; ok {
				delete(h.Clients, client.User.ID)

				clientKey := redisClientServerPrefix + client.User.ID.String() + ":server_id"
				serverClientsKey := redisServerClientsPrefix + h.serverID + ":clients"

				pipe := h.redisClient.Pipeline()
				pipe.Del(h.ctx, clientKey)
				pipe.SRem(h.ctx, serverClientsKey, client.User.ID.String(), client.User.ID)
				_, err := pipe.Exec(h.ctx)
				if err != nil {
					log.Printf("Hub %s: Error unregistering client %s in Redis: %v", h.serverID, client.User.ID.String(), err)
				} else {
					log.Printf("Hub %s: Unregistered client %s from this server in Redis", h.serverID, client.User.ID.String())
				}

				client.mutex.RLock()
				for groupID := range client.Groups {
					h.removeClientFromLocalGroupStructLocked(client, groupID)
				}
				client.mutex.RUnlock()
				close(client.Message)
				log.Printf("Hub %s: Client %s unregistered locally.", h.serverID, client.User.ID.String())
			}
			h.mutex.Unlock()

		case message := <-h.Broadcast:
			cipherBytes, err := base64.StdEncoding.DecodeString(message.Ciphertext)
			if err != nil {
				log.Printf("Error decoding ciphertext base64 for message in group %s: %v", message.GroupID, err)
				continue
			}
			nonceBytes, err := base64.StdEncoding.DecodeString(message.MsgNonce)
			if err != nil {
				log.Printf("Error decoding msgNonce base64 for message in group %s: %v", message.GroupID, err)
				continue
			}

			keyEnvelopesJSON, err := json.Marshal(message.Envelopes)
			if err != nil {
				log.Printf("Error marshalling key_envelopes for message in group %s: %v", message.GroupID, err)
				continue
			}

			insertParams := db.InsertMessageParams{
				ID:           message.ID,
				UserID:       &message.SenderID,
				GroupID:      &message.GroupID,
				Ciphertext:   cipherBytes,
				MessageType:  message.MessageType,
				MsgNonce:     nonceBytes,
				KeyEnvelopes: keyEnvelopesJSON,
			}

			savedMessage, err := h.db.InsertMessage(h.ctx, insertParams)
			if err != nil {
				log.Printf("Error saving E2EE message: %v", err)
				continue
			}

			message.ID = savedMessage.ID
			message.Timestamp = savedMessage.CreatedAt.Time.Format(time.RFC3339Nano)

			payload := ChatMessagePayload{Message: message}
			pubSubMsg := PubSubMessage{
				Type:           "chat_message",
				Payload:        payload,
				OriginServerID: h.serverID,
			}
			serializedMsg, err := json.Marshal(pubSubMsg)
			if err != nil {
				log.Printf("Hub %s: Error marshalling E2EE chat message for PubSub: %v", h.serverID, err)
				continue
			}
			channel := pubSubGroupMessagesChannel + ":" + message.GroupID.String()
			if err := h.redisClient.Publish(h.ctx, channel, serializedMsg).Err(); err != nil {
				log.Printf("Hub %s: Error publishing E2EE message to Redis PubSub channel %s: %v", h.serverID, channel, err)
			} else {
				log.Printf("Hub %s: Published E2EE message for group %s to Redis PubSub channel %s", h.serverID, message.GroupID.String(), channel)
			}

			// Send push notifications to offline users asynchronously
			if h.notificationService != nil {
				go func(msg *RawMessageE2EE) {
					// Get group name from Redis
					groupInfoKey := redisGroupInfoPrefix + msg.GroupID.String()
					groupName, err := h.redisClient.HGet(h.ctx, groupInfoKey, "name").Result()
					if err != nil {
						groupName = "Group"
					}

					// Get sender's username from DB
					senderName := "Someone"
					if sender, err := h.db.GetUserById(h.ctx, msg.SenderID); err == nil {
						senderName = sender.Username
					}

					h.notificationService.SendMessageNotification(
						h.ctx,
						msg.GroupID,
						groupName,
						msg.SenderID,
						senderName,
						"sent a message",
					)
				}(message)
			}

		case removeMsg := <-h.RemoveUserFromGroupChan:
			groupMembersKey := redisGroupMembersPrefix + removeMsg.GroupID.String() + ":members"
			userGroupsKey := redisUserGroupsPrefix + removeMsg.UserID.String() + ":groups"

			pipe := h.redisClient.Pipeline()
			pipe.SRem(h.ctx, groupMembersKey, removeMsg.UserID.String())
			pipe.SRem(h.ctx, userGroupsKey, removeMsg.GroupID.String())
			_, err := pipe.Exec(h.ctx)

			if err != nil {
				log.Printf("Hub %s: Error removing user %s from group %s in Redis: %v", h.serverID, removeMsg.UserID.String(), removeMsg.GroupID.String(), err)
			} else {
				log.Printf("Hub %s: Removed user %s from group %s in Redis", h.serverID, removeMsg.UserID.String(), removeMsg.GroupID.String())
				eventPayload := UserGroupEventPayload{UserID: removeMsg.UserID, GroupID: removeMsg.GroupID}
				pubSubEvt := PubSubMessage{Type: "user_removed_from_group", Payload: eventPayload, OriginServerID: h.serverID}
				serializedEvt, err := json.Marshal(pubSubEvt)
				if err != nil {
					log.Printf("Hub %s: Error marshalling user_removed_from_group event: %v", h.serverID, err)
				} else {
					h.redisClient.Publish(h.ctx, pubSubGroupEventsChannel, serializedEvt)
				}
			}

		case addMsg := <-h.AddUserToGroupChan:
			groupMembersKey := redisGroupMembersPrefix + addMsg.GroupID.String() + ":members"
			userGroupsKey := redisUserGroupsPrefix + addMsg.UserID.String() + ":groups"

			pipe := h.redisClient.Pipeline()
			pipe.SAdd(h.ctx, groupMembersKey, addMsg.UserID.String())
			pipe.SAdd(h.ctx, userGroupsKey, addMsg.GroupID.String())
			_, err := pipe.Exec(h.ctx)

			if err != nil {
				log.Printf("Hub %s: Error adding user %s to group %s in Redis: %v", h.serverID, addMsg.UserID.String(), addMsg.GroupID.String(), err)
			} else {
				log.Printf("Hub %s: Added user %s to group %s in Redis", h.serverID, addMsg.UserID.String(), addMsg.GroupID.String())
				eventPayload := UserGroupEventPayload{UserID: addMsg.UserID, GroupID: addMsg.GroupID}
				pubSubEvt := PubSubMessage{Type: "user_added_to_group", Payload: eventPayload, OriginServerID: h.serverID}
				serializedEvt, err := json.Marshal(pubSubEvt)
				if err != nil {
					log.Printf("Hub %s: Error marshalling user_added_to_group event: %v", h.serverID, err)
				} else {
					h.redisClient.Publish(h.ctx, pubSubGroupEventsChannel, serializedEvt)
				}
			}

		case initMsg := <-h.InitializeGroupChan:
			groupInfoKey := redisGroupInfoPrefix + initMsg.GroupID.String()
			groupMembersKey := redisGroupMembersPrefix + initMsg.GroupID.String() + ":members"
			adminUserGroupsKey := redisUserGroupsPrefix + initMsg.AdminID.String() + ":groups"

			pipe := h.redisClient.Pipeline()
			pipe.HSet(h.ctx, groupInfoKey, "name", initMsg.Name, "id", initMsg.GroupID.String())
			pipe.SAdd(h.ctx, groupMembersKey, initMsg.AdminID.String())
			pipe.SAdd(h.ctx, adminUserGroupsKey, initMsg.GroupID.String())
			_, err := pipe.Exec(h.ctx)

			if err != nil {
				log.Printf("Hub %s: Error initializing group %s in Redis: %v", h.serverID, initMsg.GroupID.String(), err)
			} else {
				log.Printf("Hub %s: Initialized group %s in Redis", h.serverID, initMsg.GroupID.String())
				eventPayload := GroupEventPayload{GroupID: initMsg.GroupID, Name: initMsg.Name, AdminID: initMsg.AdminID}
				pubSubEvt := PubSubMessage{Type: "group_created", Payload: eventPayload, OriginServerID: h.serverID}
				serializedEvt, err := json.Marshal(pubSubEvt)
				if err != nil {
					log.Printf("Hub %s: Error marshalling group_created event: %v", h.serverID, err)
				} else {
					h.redisClient.Publish(h.ctx, pubSubGroupEventsChannel, serializedEvt)
				}
			}
		case delMsg := <-h.DeleteHubGroupChan:
			groupIDStr := delMsg.GroupID.String()
			groupInfoKey := redisGroupInfoPrefix + groupIDStr
			groupMembersKey := redisGroupMembersPrefix + groupIDStr + ":members"

			members, err := h.redisClient.SMembers(h.ctx, groupMembersKey).Result()
			if err != nil && err != redis.Nil {
				log.Printf("Hub %s: Error getting members for group %s deletion: %v", h.serverID, delMsg.GroupID.String(), err)
			}

			pipe := h.redisClient.Pipeline()
			for _, memberIDStr := range members {
				userGroupsKey := redisUserGroupsPrefix + memberIDStr + ":groups"
				pipe.SRem(h.ctx, userGroupsKey, delMsg.GroupID.String())
			}
			pipe.Del(h.ctx, groupMembersKey)
			pipe.Del(h.ctx, groupInfoKey)
			_, execErr := pipe.Exec(h.ctx)

			if execErr != nil {
				log.Printf("Hub %s: Error deleting group %s from Redis: %v", h.serverID, delMsg.GroupID.String(), execErr)
			} else {
				log.Printf("Hub %s: Deleted group %s from Redis", h.serverID, delMsg.GroupID.String())
				eventPayload := GroupEventPayload{GroupID: delMsg.GroupID}
				pubSubEvt := PubSubMessage{Type: "group_deleted", Payload: eventPayload, OriginServerID: h.serverID}
				serializedEvt, err := json.Marshal(pubSubEvt)
				if err != nil {
					log.Printf("Hub %s: Error marshalling group_deleted event: %v", h.serverID, err)
				} else {
					h.redisClient.Publish(h.ctx, pubSubGroupEventsChannel, serializedEvt)
				}
			}
		case updateMsg := <-h.UpdateGroupInfoChan:
			log.Printf("Hub %s: Received request to process group info update for group %s", h.serverID, updateMsg.GroupID.String())

			if updateMsg.Name != "" {
				groupInfoKey := redisGroupInfoPrefix + updateMsg.GroupID.String()
				err := h.redisClient.HSet(h.ctx, groupInfoKey, "name", updateMsg.Name).Err()
				if err != nil {
					log.Printf("Hub %s: Error updating group name in Redis for group %s: %v", h.serverID, updateMsg.GroupID.String(), err)
				} else {
					log.Printf("Hub %s: Updated group name in Redis for group %s to '%s'", h.serverID, updateMsg.GroupID.String(), updateMsg.Name)
				}
			}

			pubSubEvt := PubSubMessage{
				Type:           "group_updated",
				Payload:        updateMsg,
				OriginServerID: h.serverID,
			}
			serializedEvt, err := json.Marshal(pubSubEvt)
			if err != nil {
				log.Printf("Hub %s: Error marshalling group_updated event for group %s: %v", h.serverID, updateMsg.GroupID.String(), err)
			} else {
				if err := h.redisClient.Publish(h.ctx, pubSubGroupEventsChannel, serializedEvt).Err(); err != nil {
					log.Printf("Hub %s: Error publishing group_updated event for group %s: %v", h.serverID, updateMsg.GroupID.String(), err)
				} else {
					log.Printf("Hub %s: Published group_updated event for group %s", h.serverID, updateMsg.GroupID.String())
				}
			}
		}
	}
}

// addClientToLocalGroupStructLocked assumes h.mutex is already WLocked by the caller.
func (h *Hub) addClientToLocalGroupStructLocked(client *Client, groupID uuid.UUID) {
	group, exists := h.Groups[groupID]
	if !exists {
		name := "Unknown Group"
		groupInfoKey := redisGroupInfoPrefix + groupID.String()
		redisName, err := h.redisClient.HGet(h.ctx, groupInfoKey, "name").Result()
		if err == nil {
			name = redisName
		} else if err != redis.Nil {
			log.Printf("Hub %s: Error fetching group name for %s from Redis: %v", h.serverID, groupID.String(), err)
		}

		group = &Group{
			ID:      groupID,
			Name:    name,
			Clients: make(map[uuid.UUID]*Client),
		}
		h.Groups[groupID] = group
		log.Printf("Hub %s: Cached group %s (%s) locally.", h.serverID, groupID.String(), name)
	}

	group.mutex.Lock()
	group.Clients[client.User.ID] = client
	group.mutex.Unlock()
	log.Printf("Hub %s: Added client %s to local cache for group %s", h.serverID, client.User.ID.String(), groupID.String())
}

// removeClientFromLocalGroupStructLocked assumes h.mutex is already WLocked or RLocked appropriately by the caller.
func (h *Hub) removeClientFromLocalGroupStructLocked(client *Client, groupID uuid.UUID) {
	group, exists := h.Groups[groupID]
	if !exists {
		return
	}

	group.mutex.Lock()
	delete(group.Clients, client.User.ID)
	log.Printf("Hub %s: Removed client %s from local cache for group %s", h.serverID, client.User.ID.String(), groupID.String())
	isEmpty := len(group.Clients) == 0
	group.mutex.Unlock()

	if isEmpty {
		delete(h.Groups, groupID)
		log.Printf("Hub %s: Removed group %s from local cache as no local clients are members.", h.serverID, groupID.String())
	}
}

func (h *Hub) refreshClientRegistrations() {
	h.mutex.RLock()
	clientsToRefresh := make([]uuid.UUID, 0, len(h.Clients))
	for userID := range h.Clients {
		clientsToRefresh = append(clientsToRefresh, userID)
	}
	h.mutex.RUnlock()

	if len(clientsToRefresh) == 0 {
		return
	}

	pipe := h.redisClient.Pipeline()
	for _, userID := range clientsToRefresh {
		clientKey := redisClientServerPrefix + userID.String() + ":server_id"
		pipe.Expire(h.ctx, clientKey, 120*time.Second)
	}
	cmds, err := pipe.Exec(h.ctx)
	if err != nil {
		log.Printf("Hub %s: Error executing pipeline for client Redis key expirations: %v", h.serverID, err)
		return
	}
	var successfulRefreshCount int
	for _, cmd := range cmds {
		if cmd.Err() == nil {
			// For Expire, success means the key existed or was set to expire.
			// If Expire returns 1, it was set. If 0, key doesn't exist (which is odd here)
			if val, ok := cmd.(*redis.BoolCmd); ok && val.Val() {
				successfulRefreshCount++
			}
		} else if cmd.Err() != redis.Nil {
			log.Printf("Hub %s: Error refreshing a client Redis key: %v", h.serverID, cmd.Err())
		}
	}
	if successfulRefreshCount > 0 {
		log.Printf("Hub %s: Refreshed %d client Redis key expirations", h.serverID, successfulRefreshCount)
	}
}
