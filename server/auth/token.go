package auth

import (
	"errors"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// AccessTokenTTL is the lifetime of access tokens. Short by design — the
// refresh-token path handles renewal. The 15-minute value bounds the blast
// radius of a leaked access token.
const AccessTokenTTL = 15 * time.Minute

var jwtSecret = []byte(os.Getenv("JWT_SECRET"))

// ValidatedToken carries out of the parser everything downstream handlers need.
// Adding DeviceID here (rather than a second return value) keeps the common
// "claims in context" path extensible if we add more JWT fields later.
type ValidatedToken struct {
	UserID   uuid.UUID
	DeviceID string
	Typ      string
}

// IssueAccessToken signs a JWT for the given user+device. typ allows us to
// distinguish access tokens from any future JWT-shaped credentials (linking
// flows, etc.), though today all live tokens are typ=access.
func IssueAccessToken(userID uuid.UUID, deviceID string) (string, int, error) {
	if len(jwtSecret) == 0 {
		return "", 0, fmt.Errorf("JWT secret not configured on server")
	}
	now := time.Now()
	claims := Claims{
		UserID:   userID,
		DeviceID: deviceID,
		Typ:      TokenTypeAccess,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(AccessTokenTTL)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString(jwtSecret)
	if err != nil {
		return "", 0, err
	}
	return signed, int(AccessTokenTTL.Seconds()), nil
}

// ValidateToken parses the JWT and returns the identity + device id it was
// issued for. Errors are preserved via errors.Is so the middleware can map
// them to user-facing messages.
func ValidateToken(tokenString string) (ValidatedToken, error) {
	if tokenString == "" {
		return ValidatedToken{}, fmt.Errorf("authorization token required")
	}
	if len(jwtSecret) == 0 {
		log.Println("Warning: JWT_SECRET environment variable not set.")
		return ValidatedToken{}, fmt.Errorf("JWT secret not configured on server")
	}

	parsed, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return jwtSecret, nil
	})

	if err != nil {
		log.Printf("Token parsing error: %v", err)
		switch {
		case errors.Is(err, jwt.ErrTokenMalformed):
			return ValidatedToken{}, fmt.Errorf("malformed token: %w", err)
		case errors.Is(err, jwt.ErrTokenExpired):
			return ValidatedToken{}, fmt.Errorf("token is expired: %w", err)
		case errors.Is(err, jwt.ErrTokenNotValidYet):
			return ValidatedToken{}, fmt.Errorf("token not yet valid: %w", err)
		case errors.Is(err, jwt.ErrTokenSignatureInvalid):
			return ValidatedToken{}, fmt.Errorf("token signature is invalid: %w", err)
		default:
			return ValidatedToken{}, fmt.Errorf("couldn't handle token: %w", err)
		}
	}
	if !parsed.Valid {
		return ValidatedToken{}, fmt.Errorf("invalid token")
	}

	claims, ok := parsed.Claims.(*Claims)
	if !ok {
		return ValidatedToken{}, fmt.Errorf("invalid token claims format")
	}
	if claims.UserID == uuid.Nil {
		return ValidatedToken{}, fmt.Errorf("userID claim missing or nil")
	}
	// Defense in depth: reject tokens that declare a typ other than access.
	// Legacy tokens issued before this change have Typ == "" — we accept those
	// during the rollout window, since Phase 1 ships as a single cutover.
	if claims.Typ != "" && claims.Typ != TokenTypeAccess {
		return ValidatedToken{}, fmt.Errorf("unexpected token typ %q", claims.Typ)
	}

	return ValidatedToken{
		UserID:   claims.UserID,
		DeviceID: claims.DeviceID,
		Typ:      claims.Typ,
	}, nil
}
