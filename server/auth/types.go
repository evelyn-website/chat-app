package auth

import (
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// Token types used in the `typ` claim. Access tokens authenticate API calls;
// refresh tokens are separately-issued opaque strings (see server/auth/refresh).
const (
	TokenTypeAccess = "access"
)

type Claims struct {
	UserID   uuid.UUID `json:"userID"`
	DeviceID string    `json:"did,omitempty"`
	Typ      string    `json:"typ,omitempty"`
	jwt.RegisteredClaims
}

type SignupRequest struct {
	Username         string `json:"username" binding:"required,max=50"`
	Email            string `json:"email" binding:"required,email,max=255"`
	Password         string `json:"password" binding:"required,min=8,max=72"`
	Birthday         string `json:"birthday" binding:"required"`
	DeviceIdentifier string `json:"device_identifier" binding:"required"`
	PublicKey        string `json:"public_key" binding:"required"`
	SigningPublicKey string `json:"signing_public_key" binding:"required"`
}
type LoginRequest struct {
	Email            string `json:"email" binding:"required,email"`
	Password         string `json:"password" binding:"required"`
	DeviceIdentifier string `json:"device_identifier" binding:"required"`
	PublicKey        string `json:"public_key" binding:"required"`
	SigningPublicKey string `json:"signing_public_key" binding:"required"`
}

// AppleSignInRequest is the payload to POST /auth/apple. authorization_code is
// opportunistic / best-effort: include it when available (Apple only vends it
// once, on first sign-in) so the server can store an Apple refresh token for
// account deletion via /auth/revoke. Omitting it never fails the sign-in.
// AppleSignInRequest is the payload to POST /auth/apple. birthday is required
// for first-time sign-ins (new account creation) and ignored for returning
// users. Format: YYYY-MM-DD. The server enforces age ≥ 18 for new accounts.
type AppleSignInRequest struct {
	IDToken           string         `json:"id_token" binding:"required"`
	AuthorizationCode string         `json:"authorization_code"`
	Nonce             string         `json:"nonce" binding:"required"`
	DeviceIdentifier  string         `json:"device_identifier" binding:"required"`
	PublicKey         string         `json:"public_key" binding:"required"`
	SigningPublicKey   string         `json:"signing_public_key" binding:"required"`
	FullName          *AppleFullName `json:"full_name,omitempty"`
	Birthday          string         `json:"birthday"`
}

type AppleFullName struct {
	Given  string `json:"given"`
	Family string `json:"family"`
}

// RefreshRequest is the body for POST /auth/refresh. Its only credential is
// the opaque refresh_token — no Authorization header.
type RefreshRequest struct {
	RefreshToken     string `json:"refresh_token" binding:"required"`
	DeviceIdentifier string `json:"device_identifier" binding:"required"`
}

// LogoutRequest is the body for POST /auth/logout. Idempotent — the handler
// accepts already-revoked or unknown tokens without leaking which case we hit.
type LogoutRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

// AuthResponse is returned by /auth/apple and /auth/refresh.
type AuthResponse struct {
	AccessToken      string    `json:"access_token"`
	RefreshToken     string    `json:"refresh_token"`
	AccessExpiresIn  int       `json:"access_expires_in"` // seconds
	UserID           uuid.UUID `json:"user_id"`
	Username         string    `json:"username"`
	FullName         string    `json:"full_name,omitempty"`
	UsernameSet      bool      `json:"username_set"`
}
