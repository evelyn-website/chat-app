package ws

import (
	"chat-app-server/db"
	"time"

	"github.com/google/uuid"
)

type Envelope struct {
	DeviceID  string `json:"deviceId"`
	EphPubKey string `json:"ephPubKey"` // Base64 encoded
	KeyNonce  string `json:"keyNonce"`  // Base64 encoded
	SealedKey string `json:"sealedKey"` // Base64 encoded
}

type RawMessageE2EE struct {
	ID             uuid.UUID      `json:"id"`
	GroupID        uuid.UUID      `json:"group_id"`
	MsgNonce       string         `json:"msgNonce"`   // Base64 encoded
	Ciphertext     string         `json:"ciphertext"` // Base64 encoded
	MessageType    db.MessageType `json:"messageType"`
	Timestamp      string         `json:"timestamp"`
	SenderID       uuid.UUID      `json:"sender_id"`
	SenderUsername string         `json:"sender_username"`
	Envelopes      []Envelope     `json:"envelopes"`
}
type ClientSentE2EMessage struct {
	ID          uuid.UUID      `json:"id" binding:"required"`
	GroupID     uuid.UUID      `json:"group_id"`
	MsgNonce    string         `json:"msgNonce"`   // Base64 encoded
	Ciphertext  string         `json:"ciphertext"` // Base64 encoded
	MessageType db.MessageType `json:"messageType"`
	Envelopes   []Envelope     `json:"envelopes"`
}

type CreateGroupRequest struct {
	ID          uuid.UUID `json:"id" binding:"required"`
	Name        string    `json:"name" binding:"required"`
	StartTime   time.Time `json:"start_time" binding:"required" `
	EndTime     time.Time `json:"end_time" binding:"required" `
	Description *string   `json:"description,omitempty"`
	Location    *string   `json:"location,omitempty"`
	ImageUrl    *string   `json:"image_url,omitempty"`
	Blurhash    *string   `json:"blurhash,omitempty"`
}

type UpdateGroupRequest struct {
	Name        *string    `json:"name,omitempty"`
	StartTime   *time.Time `json:"start_time,omitempty"`
	EndTime     *time.Time `json:"end_time,omitempty"`
	Description *string    `json:"description,omitempty"`
	Location    *string    `json:"location,omitempty"`
	ImageUrl    *string    `json:"image_url,omitempty"`
	Blurhash    *string    `json:"blurhash,omitempty"`
}

type ClientGroup struct {
	ID          uuid.UUID         `json:"id"`
	Name        string            `json:"name"`
	Description *string           `json:"description,omitempty"`
	Location    *string           `json:"location,omitempty"`
	ImageUrl    *string           `json:"image_url,omitempty"`
	Blurhash    *string           `json:"blurhash,omitempty"`
	StartTime   *time.Time        `json:"start_time,omitempty"`
	EndTime     *time.Time        `json:"end_time,omitempty"`
	CreatedAt   time.Time         `json:"created_at"`
	UpdatedAt   time.Time         `json:"updated_at"`
	Admin       bool              `json:"admin"`
	GroupUsers  []ClientGroupUser `json:"group_users"`
}

type UpdateGroupResponse struct {
	Group ClientGroup `json:"group"`
}

type JoinGroupRequest struct {
	ID uuid.UUID `json:"id"`
}

type InviteUsersToGroupRequest struct {
	GroupID uuid.UUID `json:"group_id"`
	Emails  []string  `json:"emails"`
}

type RemoveUserFromGroupRequest struct {
	GroupID uuid.UUID `json:"group_id"`
	Email   string    `json:"email"`
}

type GroupAdminMap map[uuid.UUID]bool

type ClientGroupUser struct {
	ID        uuid.UUID `json:"id"`
	Username  string    `json:"username"`
	Email     string    `json:"email"`
	Admin     bool      `json:"admin"`
	InvitedAt string    `json:"invited_at"`
}

type BlockUserRequest struct {
	UserID uuid.UUID `json:"user_id" binding:"required"`
}

type UnblockUserRequest struct {
	UserID uuid.UUID `json:"user_id" binding:"required"`
}

type CreateInviteRequest struct {
	GroupID uuid.UUID `json:"group_id" binding:"required"`
	MaxUses int       `json:"max_uses"`
}

type CreateInviteResponse struct {
	Code      string    `json:"code"`
	ExpiresAt time.Time `json:"expires_at"`
	MaxUses   int       `json:"max_uses"`
	InviteURL string    `json:"invite_url"`
}

type InvitePreviewResponse struct {
	GroupID     uuid.UUID  `json:"group_id"`
	GroupName   string     `json:"group_name"`
	Description *string    `json:"description,omitempty"`
	ImageUrl    *string    `json:"image_url,omitempty"`
	Blurhash    *string    `json:"blurhash,omitempty"`
	MemberCount int32      `json:"member_count"`
	StartTime   *time.Time `json:"start_time,omitempty"`
	EndTime     *time.Time `json:"end_time,omitempty"`
	ExpiresAt   time.Time  `json:"expires_at"`
}

type AcceptInviteResponse struct {
	GroupID uuid.UUID `json:"group_id"`
	Message string    `json:"message"`
}

// ClientEvent is a server-to-client lifecycle event sent over WebSocket.
type ClientEvent struct {
	Type    string    `json:"type"`     // always "group_event"
	Event   string    `json:"event"`    // "user_invited", "user_removed", "group_updated", "group_deleted"
	GroupID uuid.UUID `json:"group_id"`
}
