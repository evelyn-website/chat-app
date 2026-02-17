package auth

import (
	"chat-app-server/db"
	"context"
	"encoding/base64"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type AuthHandler struct {
	db   *db.Queries
	ctx  context.Context
	conn *pgxpool.Pool
}

func NewAuthHandler(db *db.Queries, ctx context.Context, conn *pgxpool.Pool) *AuthHandler {
	return &AuthHandler{
		db:   db,
		ctx:  ctx,
		conn: conn,
	}
}

func (h *AuthHandler) registerOrUpdateDeviceKey(
	ctx context.Context,
	userID uuid.UUID,
	deviceIdentifier string,
	base64PublicKey string,
) error {
	publicKeyBytes, err := base64.StdEncoding.DecodeString(base64PublicKey)
	if err != nil {
		log.Printf("Error decoding public key for user %s, device %s: %v", userID, deviceIdentifier, err)
		return err
	}

	_, err = h.db.RegisterDeviceKey(ctx, db.RegisterDeviceKeyParams{
		UserID:           userID,
		DeviceIdentifier: deviceIdentifier,
		PublicKey:        publicKeyBytes,
	})
	if err != nil {
		log.Printf("Error registering/updating device key for user %s, device %s: %v", userID, deviceIdentifier, err)
		return err
	}
	log.Printf("Device key registered/updated for user %s, device %s", userID, deviceIdentifier)
	return nil
}

func (h *AuthHandler) Signup(c *gin.Context) {
	ctx := c.Request.Context()
	var req SignupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Invalid request: " + err.Error()})
		return
	}

	if strings.TrimSpace(req.Username) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Username cannot be blank"})
		return
	}

	pwd := []byte(req.Password)
	hash, err := bcrypt.GenerateFromPassword(pwd, 12)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Signup failed"})
		return
	}

	user, err := h.db.InsertUser(ctx, db.InsertUserParams{Username: strings.TrimSpace(req.Username), Email: req.Email, Password: pgtype.Text{String: string(hash), Valid: true}})
	if err != nil {
		log.Printf("Error inserting user during signup for %s: %v", req.Email, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Signup failed, possibly due to existing user or database issue."})
		return
	}

	if err := h.registerOrUpdateDeviceKey(ctx, user.ID, req.DeviceIdentifier, req.PublicKey); err != nil {
		log.Printf("Warning: User %s signed up, but device key registration failed: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Signup succeeded but failed to register device."})
		return
	}

	claims := Claims{
		UserID: user.ID,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour * 24)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)

	tokenString, err := token.SignedString([]byte(os.Getenv("JWT_SECRET")))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"token": tokenString})
}

func (h *AuthHandler) Login(c *gin.Context) {
	ctx := c.Request.Context()
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Invalid request: " + err.Error()})
		return
	}

	user, err := h.db.GetUserByEmailInternal(ctx, req.Email)
	if err != nil {
		dummyHash := []byte("$2a$12$ZHc6p51/1IsM/4/hz/sUvezdkXuT1IF75EF5nyKyRTu7XyGDd0PM2")

		_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(req.Password))

		log.Printf("Login attempt for non-existent or problematic email %s (timing mitigation active): %v", req.Email, err)
		c.JSON(http.StatusUnauthorized, gin.H{"message": "Login failed: Invalid credentials"})
		return
	}

	if !user.Password.Valid {
		log.Printf("Login attempt failed for email %s: user has no password set.", req.Email)
		c.JSON(http.StatusUnauthorized, gin.H{"message": "Login failed: Account issue."})
		return
	}

	pwd := []byte(user.Password.String)
	err = bcrypt.CompareHashAndPassword(pwd, []byte(req.Password))
	if err != nil {
		log.Printf("Login attempt failed for email %s: incorrect password.", req.Email)
		c.JSON(http.StatusUnauthorized, gin.H{"message": "Login failed: Invalid credentials"})
		return
	}

	if err := h.registerOrUpdateDeviceKey(ctx, user.ID, req.DeviceIdentifier, req.PublicKey); err != nil {
		log.Printf("Warning: User %s logged in, but device key registration/update failed: %v", user.ID, err)
	}

	claims := Claims{
		UserID: user.ID,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour * 24)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(os.Getenv("JWT_SECRET")))
	if err != nil {
		log.Printf("Error signing token for user %s after login: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"token": tokenString, "user_id": user.ID, "username": user.Username})
}
