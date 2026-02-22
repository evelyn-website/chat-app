package ws

import (
	"chat-app-server/db"
	"chat-app-server/util"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type Client struct {
	conn             *websocket.Conn
	Message          chan *RawMessageE2EE
	Events           chan *ClientEvent
	Groups           map[uuid.UUID]bool
	DeviceIdentifier string
	User             *db.GetUserByIdRow `json:"user"`
	mutex            sync.RWMutex
	ctx              context.Context
	cancel           context.CancelFunc
}

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 16 * 1024
)

func NewClient(conn *websocket.Conn, user *db.GetUserByIdRow, deviceIdentifier string) *Client {
	ctx, cancel := context.WithCancel(context.Background())
	return &Client{
		conn:             conn,
		Message:          make(chan *RawMessageE2EE, 10),
		Events:           make(chan *ClientEvent, 20),
		Groups:           make(map[uuid.UUID]bool),
		DeviceIdentifier: deviceIdentifier,
		User:             user,
		ctx:              ctx,
		cancel:           cancel,
	}
}

func (c *Client) AddGroup(groupID uuid.UUID) {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	c.Groups[groupID] = true
}

func (c *Client) RemoveGroup(groupID uuid.UUID) {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	delete(c.Groups, groupID)
}

func (c *Client) WriteMessage() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		log.Printf("WriteMessage goroutine for client %d (%s) exiting.", c.User.ID, c.User.Username)
	}()

	for {
		select {
		case message, ok := <-c.Message:
			if err := c.conn.SetWriteDeadline(time.Now().Add(writeWait)); err != nil {
				log.Printf("Client %d (%s): Error setting write deadline: %v", c.User.ID, c.User.Username, err)
				return
			}
			if !ok {
				log.Printf("Client %d (%s) message channel closed by hub.", c.User.ID, c.User.Username)
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			err := c.conn.WriteJSON(message)
			if err != nil {
				log.Printf("Error writing JSON (E2EE) for client %d (%s): %v", c.User.ID, c.User.Username, err)
				return
			}
		case event, ok := <-c.Events:
			if !ok {
				return
			}
			if err := c.conn.SetWriteDeadline(time.Now().Add(writeWait)); err != nil {
				log.Printf("Client %d (%s): Error setting write deadline for event: %v", c.User.ID, c.User.Username, err)
				return
			}
			if err := c.conn.WriteJSON(event); err != nil {
				log.Printf("Error writing event JSON for client %d (%s): %v", c.User.ID, c.User.Username, err)
				return
			}
		case <-ticker.C:
			if err := c.conn.SetWriteDeadline(time.Now().Add(writeWait)); err != nil {
				log.Printf("Client %d (%s): Error setting write deadline for ping: %v", c.User.ID, c.User.Username, err)
				return
			}
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				log.Printf("Error sending ping for client %d (%s): %v", c.User.ID, c.User.Username, err)
				return
			}
		case <-c.ctx.Done():
			log.Printf("Context cancelled for client %d (%s), stopping writer.", c.User.ID, c.User.Username)
			return
		}
	}
}

func (c *Client) ReadMessage(hub *Hub, queries *db.Queries) {
	defer func() {
		log.Printf("ReadMessage loop for client %d (%s) exiting.", c.User.ID, c.User.Username)
	}()

	c.conn.SetReadLimit(maxMessageSize)
	if err := c.conn.SetReadDeadline(time.Now().Add(pongWait)); err != nil {
		log.Printf("Client %d (%s): Error setting initial read deadline: %v", c.User.ID, c.User.Username, err)
		return
	}
	c.conn.SetPongHandler(func(string) error {
		log.Printf("Client %d (%s) received pong.", c.User.ID, c.User.Username)
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	for {
		select {
		case <-c.ctx.Done():
			log.Printf("Client %d (%s): Context cancelled, stopping reader.", c.User.ID, c.User.Username)
			return
		default:
		}

		var clientMsg ClientSentE2EMessage
		err := c.conn.ReadJSON(&clientMsg)
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure, websocket.CloseNormalClosure, websocket.CloseNoStatusReceived) {
				log.Printf("Client %d (%s): Unexpected WebSocket close error: %v", c.User.ID, c.User.Username, err)
			} else if ne, ok := err.(net.Error); ok && ne.Timeout() {
				log.Printf("Client %d (%s): WebSocket read timeout (no pong or message): %v", c.User.ID, c.User.Username, err)
			} else if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				log.Printf("Client %d (%s): Context error during WebSocket read: %v", c.User.ID, c.User.Username, err)
			} else if err.Error() == "websocket: close sent" || err.Error() == "websocket: close 1000 (normal)" {
				log.Printf("Client %d (%s): WebSocket connection closed normally.", c.User.ID, c.User.Username)
			} else {
				log.Printf("Client %d (%s): WebSocket read error: %v", c.User.ID, c.User.Username, err)
			}
			return
		}
		if clientMsg.ID == uuid.Nil {
			log.Printf("Client %d (%s): Received E2EE message with missing ID. Discarding.", c.User.ID, c.User.Username)
			continue
		}
		if strings.TrimSpace(clientMsg.Signature) == "" {
			log.Printf("Client %d (%s): Received E2EE message with missing signature. Discarding.", c.User.ID, c.User.Username)
			continue
		}
		signatureBytes, err := base64.StdEncoding.DecodeString(clientMsg.Signature)
		if err != nil || len(signatureBytes) != ed25519.SignatureSize {
			log.Printf("Client %d (%s): Invalid signature encoding/length for message %s. Discarding.", c.User.ID, c.User.Username, clientMsg.ID)
			continue
		}

		isMember, err := util.UserInGroup(c.ctx, c.User.ID, clientMsg.GroupID, queries)
		if err != nil {
			log.Printf("Client %d (%s): DB error checking group %d authorization for E2EE message: %v. Discarding.",
				c.User.ID, c.User.Username, clientMsg.GroupID, err)
			continue
		}

		if !isMember {
			log.Printf("Client %d (%s) attempted to send E2EE message to unauthorized group %d. Discarding.",
				c.User.ID, c.User.Username, clientMsg.GroupID)
			continue
		}
		deviceKey, err := queries.GetDeviceKeyByIdentifier(c.ctx, db.GetDeviceKeyByIdentifierParams{
			UserID:           c.User.ID,
			DeviceIdentifier: c.DeviceIdentifier,
		})
		if err != nil {
			log.Printf("Client %d (%s): Failed to fetch signing key for device %s: %v. Discarding.",
				c.User.ID, c.User.Username, c.DeviceIdentifier, err)
			continue
		}
		if len(deviceKey.SigningPublicKey) != ed25519.PublicKeySize {
			log.Printf("Client %d (%s): Invalid signing public key length for device %s: got %d, expected %d. Discarding.",
				c.User.ID, c.User.Username, c.DeviceIdentifier, len(deviceKey.SigningPublicKey), ed25519.PublicKeySize)
			continue
		}
		canonicalPayload, err := buildCanonicalSignedPayload(clientMsg, c.User.ID, c.DeviceIdentifier)
		if err != nil {
			log.Printf("Client %d (%s): Failed to build canonical payload for message %s: %v. Discarding.",
				c.User.ID, c.User.Username, clientMsg.ID, err)
			continue
		}
		if !ed25519.Verify(deviceKey.SigningPublicKey, []byte(canonicalPayload), signatureBytes) {
			log.Printf("Client %d (%s): Signature verification failed for message %s in group %s. Discarding.",
				c.User.ID, c.User.Username, clientMsg.ID, clientMsg.GroupID)
			continue
		}

		hubMessage := &RawMessageE2EE{
			ID:             clientMsg.ID,
			GroupID:        clientMsg.GroupID,
			SenderDeviceID: c.DeviceIdentifier,
			MessageType:    clientMsg.MessageType,
			MsgNonce:       clientMsg.MsgNonce,
			Ciphertext:     clientMsg.Ciphertext,
			Signature:      clientMsg.Signature,
			Envelopes:      clientMsg.Envelopes,
			SenderID:       c.User.ID,
			SenderUsername: c.User.Username,
		}

		select {
		case hub.Broadcast <- hubMessage:
			log.Printf("Client %d (%s) sent E2EE message to hub for group %d", c.User.ID, c.User.Username, hubMessage.GroupID)
		case <-c.ctx.Done():
			log.Printf("Client %d (%s): Context cancelled while trying to broadcast message.", c.User.ID, c.User.Username)
			return
		default:
			log.Printf("Hub broadcast channel full for client %d (%s). Message for group %d dropped.", c.User.ID, c.User.Username, hubMessage.GroupID)
		}
	}
}

type canonicalEnvelope struct {
	DeviceID  string `json:"deviceId"`
	EphPubKey string `json:"ephPubKey"`
	KeyNonce  string `json:"keyNonce"`
	SealedKey string `json:"sealedKey"`
}

type canonicalPayload struct {
	ID             string         `json:"id"`
	GroupID        string         `json:"group_id"`
	SenderID       string         `json:"sender_id"`
	SenderDeviceID string         `json:"sender_device_id"`
	MessageType    db.MessageType `json:"messageType"`
	MsgNonce       string         `json:"msgNonce"`
	Ciphertext     string         `json:"ciphertext"`
	Envelopes      string         `json:"envelopes"`
}

func buildCanonicalSignedPayload(msg ClientSentE2EMessage, senderID uuid.UUID, senderDeviceID string) (string, error) {
	normalized := make([]canonicalEnvelope, 0, len(msg.Envelopes))
	for _, env := range msg.Envelopes {
		normalized = append(normalized, canonicalEnvelope{
			DeviceID:  env.DeviceID,
			EphPubKey: env.EphPubKey,
			KeyNonce:  env.KeyNonce,
			SealedKey: env.SealedKey,
		})
	}
	sort.Slice(normalized, func(i, j int) bool {
		return normalized[i].DeviceID < normalized[j].DeviceID
	})
	envelopesJSON, err := json.Marshal(normalized)
	if err != nil {
		return "", err
	}

	payload := canonicalPayload{
		ID:             msg.ID.String(),
		GroupID:        msg.GroupID.String(),
		SenderID:       senderID.String(),
		SenderDeviceID: senderDeviceID,
		MessageType:    msg.MessageType,
		MsgNonce:       msg.MsgNonce,
		Ciphertext:     msg.Ciphertext,
		Envelopes:      string(envelopesJSON),
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(payloadJSON), nil
}
