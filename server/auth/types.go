package auth

import (
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type Claims struct {
	UserID uuid.UUID `json:"userID"`
	jwt.RegisteredClaims
}

type SignupRequest struct {
	Username         string `json:"username" binding:"required,max=50"`
	Email            string `json:"email" binding:"required,email,max=255"`
	Password         string `json:"password" binding:"required,min=8,max=72"`
	DeviceIdentifier string `json:"device_identifier" binding:"required"`
	PublicKey        string `json:"public_key" binding:"required"`
}
type LoginRequest struct {
	Email            string `json:"email" binding:"required,email"`
	Password         string `json:"password" binding:"required"`
	DeviceIdentifier string `json:"device_identifier" binding:"required"`
	PublicKey        string `json:"public_key" binding:"required"`
}
