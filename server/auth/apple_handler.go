package auth

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"chat-app-server/auth/apple"
	"chat-app-server/auth/oidc"
	"chat-app-server/db"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// AppleSignIn handles POST /auth/apple. See plan.md §7.1 for the request
// shape and §9.3 for the idempotency requirements. Everything that mutates DB
// state runs in a single transaction so a partial-success client retry either
// observes the prior state cleanly or replays against the same rows.
func (h *AuthHandler) AppleSignIn(c *gin.Context) {
	ctx := c.Request.Context()

	if h.appleVerifier == nil {
		log.Printf("AppleSignIn: verifier not configured — APPLE_SERVICES_ID missing")
		c.JSON(http.StatusServiceUnavailable, gin.H{"message": "Apple sign-in not configured on server."})
		return
	}

	var req AppleSignInRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Invalid request: " + err.Error()})
		return
	}

	// Verify id_token. Any failure is a client-facing 401 — log distinct cause,
	// return generic message so we don't double as an enumeration oracle for
	// attackers guessing token shapes.
	claims, err := h.appleVerifier.Verify(ctx, req.IDToken, req.Nonce)
	if err != nil {
		log.Printf("AppleSignIn: id_token verify failed: %v", err)
		c.JSON(http.StatusUnauthorized, gin.H{"message": "Invalid Apple credential."})
		return
	}

	// Parse and age-check birthday before touching the DB. Birthday is only
	// required for new accounts; we can't know that yet, so we validate format
	// and age now and enforce presence later (after findOrCreateAppleUser tells
	// us whether this is a first-time sign-in).
	var birthday *time.Time
	if req.Birthday != "" {
		bd, err := time.Parse("2006-01-02", req.Birthday)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"message": "Invalid birthday format, expected YYYY-MM-DD"})
			return
		}
		now := time.Now()
		age := now.Year() - bd.Year()
		if now.Month() < bd.Month() || (now.Month() == bd.Month() && now.Day() < bd.Day()) {
			age--
		}
		if age < 18 {
			c.JSON(http.StatusForbidden, gin.H{"message": "You must be 18 or older to use this app."})
			return
		}
		birthday = &bd
	}

	// Decode device keys up front; if they're malformed the whole sign-in is
	// rejected before we touch the DB.
	pubKey, err := base64.StdEncoding.DecodeString(req.PublicKey)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Invalid public_key encoding"})
		return
	}
	signPubKey, err := base64.StdEncoding.DecodeString(req.SigningPublicKey)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Invalid signing_public_key encoding"})
		return
	}
	if len(signPubKey) != ed25519.PublicKeySize {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Invalid signing_public_key length"})
		return
	}

	tx, err := h.conn.Begin(ctx)
	if err != nil {
		log.Printf("AppleSignIn: begin tx: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Sign-in failed"})
		return
	}
	defer tx.Rollback(ctx)
	qtx := h.db.WithTx(tx)

	userID, identityID, isNew, err := findOrCreateAppleUser(ctx, qtx, claims, req.FullName, birthday)
	if errors.Is(err, errBirthdayRequired) {
		c.JSON(http.StatusBadRequest, gin.H{"message": "birthday is required for new accounts (YYYY-MM-DD)"})
		return
	}
	if err != nil {
		log.Printf("AppleSignIn: findOrCreateUser: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Sign-in failed"})
		return
	}

	// Register device key in the same tx so a crash between identity creation
	// and key registration leaves no half-provisioned user.
	if _, err := qtx.RegisterDeviceKey(ctx, db.RegisterDeviceKeyParams{
		UserID:           userID,
		DeviceIdentifier: req.DeviceIdentifier,
		PublicKey:        pubKey,
		SigningPublicKey: signPubKey,
	}); err != nil {
		log.Printf("AppleSignIn: register device key: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Sign-in failed"})
		return
	}

	// Issue refresh token in-tx.
	refreshPlain, err := h.refresh.IssueTx(ctx, qtx, userID, req.DeviceIdentifier, c.Request.UserAgent())
	if err != nil {
		log.Printf("AppleSignIn: issue refresh token: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Sign-in failed"})
		return
	}

	if err := tx.Commit(ctx); err != nil {
		log.Printf("AppleSignIn: commit: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Sign-in failed"})
		return
	}

	// Opportunistic authorization_code exchange runs AFTER commit so the
	// critical sign-in path doesn't hold a pooled DB connection while waiting
	// on Apple's /auth/token (10s timeout). Any failure here is logged but
	// non-fatal: the user can still sign in; only the "delete account via Apple
	// revoke" capability is degraded. A redundant exchange on the client's next
	// retry is harmless — GetAppleRefreshTokenEncrypted guards the idempotency.
	if err := h.maybeExchangeAppleCode(ctx, identityID, req.AuthorizationCode); err != nil {
		log.Printf("AppleSignIn: apple code exchange (user=%s): %v", userID, err)
	}

	// Post-commit: mint the access token and hydrate the response with whatever
	// the just-committed user row has.
	accessToken, ttlSeconds, err := IssueAccessToken(userID, req.DeviceIdentifier)
	if err != nil {
		log.Printf("AppleSignIn: issue access token: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Sign-in failed"})
		return
	}

	user, err := h.db.GetUserIdentityFields(ctx, userID)
	if err != nil {
		log.Printf("AppleSignIn: fetch user %s post-commit: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Sign-in failed"})
		return
	}

	log.Printf("AppleSignIn: user=%s isNew=%v username_set=%v", userID, isNew, user.UsernameSet)
	c.JSON(http.StatusOK, AuthResponse{
		AccessToken:     accessToken,
		RefreshToken:    refreshPlain,
		AccessExpiresIn: ttlSeconds,
		UserID:          userID,
		Username:        user.Username,
		FullName:        user.FullName.String,
		UsernameSet:     user.UsernameSet,
	})
}

// errBirthdayRequired is returned by findOrCreateAppleUser when a new account
// is being created but no birthday was supplied. Maps to HTTP 400.
var errBirthdayRequired = fmt.Errorf("birthday required for new account")

// findOrCreateAppleUser implements plan.md §9.3/§9.4. It either looks up an
// existing user by (provider, subject) or creates a new user+identity pair.
// fullName is captured only on the first-ever sign-in per identity (Apple
// only returns it once). birthday must be non-nil for new accounts; it is
// ignored for returning users.
//
// Returns (userID, identityID, isNew, error).
func findOrCreateAppleUser(
	ctx context.Context,
	qtx *db.Queries,
	claims *oidc.Claims,
	fullName *AppleFullName,
	birthday *time.Time,
) (uuid.UUID, uuid.UUID, bool, error) {
	existing, err := qtx.GetAuthIdentity(ctx, db.GetAuthIdentityParams{
		Provider: claims.Provider,
		Subject:  claims.Subject,
	})
	if err == nil {
		// Returning user — refresh last_used_at and opportunistically update
		// email if the provider sent us a non-empty one.
		_ = qtx.UpdateAuthIdentityLastUsed(ctx, existing.ID)
		if claims.Email != "" {
			_ = qtx.UpdateAuthIdentityEmail(ctx, db.UpdateAuthIdentityEmailParams{
				ID:            existing.ID,
				Email:         pgtype.Text{String: claims.Email, Valid: true},
				EmailVerified: pgtype.Bool{Bool: claims.EmailVerified, Valid: true},
			})
		}
		return existing.UserID, existing.ID, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, uuid.Nil, false, err
	}

	// First-ever sign-in for this identity.
	if birthday == nil {
		return uuid.Nil, uuid.Nil, false, errBirthdayRequired
	}

	// Create a user with a random placeholder username (username_set=false
	// bypasses the partial unique index, so placeholders can't collide).
	placeholder, err := randomPlaceholderUsername()
	if err != nil {
		return uuid.Nil, uuid.Nil, false, err
	}

	var fullNameText, givenNameText, familyNameText pgtype.Text
	if fullName != nil {
		given := strings.TrimSpace(fullName.Given)
		family := strings.TrimSpace(fullName.Family)
		if given != "" {
			givenNameText = pgtype.Text{String: given, Valid: true}
		}
		if family != "" {
			familyNameText = pgtype.Text{String: family, Valid: true}
		}
		combined := strings.TrimSpace(strings.TrimSpace(given) + " " + strings.TrimSpace(family))
		if combined != "" {
			fullNameText = pgtype.Text{String: combined, Valid: true}
		}
	}

	emailText := pgtype.Text{}
	if claims.Email != "" {
		emailText = pgtype.Text{String: claims.Email, Valid: true}
	}

	user, err := qtx.InsertUserOIDC(ctx, db.InsertUserOIDCParams{
		Username:   placeholder,
		Email:      emailText,
		FullName:   fullNameText,
		GivenName:  givenNameText,
		FamilyName: familyNameText,
		Birthday:   pgtype.Date{Time: *birthday, Valid: true},
	})
	if err != nil {
		return uuid.Nil, uuid.Nil, false, err
	}

	// Insert identity. The ON CONFLICT (provider, subject) guard in the SQL
	// converts a race with another concurrent /auth/apple call into a silent
	// update + RETURNING of the winner's row. The user_id on the conflict
	// resolution may point at a *different* users row than the one we just
	// inserted — Postgres gives us back the winner's user_id, which is what
	// we want to return to the client. The losing user row is orphaned; a
	// future cleanup job can GC them, but it's rare and harmless.
	identity, err := qtx.InsertAuthIdentity(ctx, db.InsertAuthIdentityParams{
		UserID:        user.ID,
		Provider:      claims.Provider,
		Subject:       claims.Subject,
		Email:         emailText,
		EmailVerified: pgtype.Bool{Bool: claims.EmailVerified, Valid: claims.Email != ""},
	})
	if err != nil {
		return uuid.Nil, uuid.Nil, false, err
	}

	return identity.UserID, identity.ID, identity.UserID == user.ID, nil
}

// randomPlaceholderUsername returns a short, URL-safe placeholder username.
// The partial unique index (WHERE username_set=TRUE) means placeholders don't
// participate in uniqueness, so randomness is a convenience for debuggability,
// not a correctness requirement.
func randomPlaceholderUsername() (string, error) {
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "user_" + hex.EncodeToString(buf), nil
}

// maybeExchangeAppleCode runs the /auth/token grant when appropriate. Called
// post-commit so the HTTP round-trip to Apple doesn't hold a DB connection.
// Uses h.db directly (not a caller-supplied tx) to avoid pinning the sign-in
// transaction. Not-configured is a silent nil, not an error — dev envs without
// Apple S2S wiring would otherwise log a spurious error on every sign-in.
func (h *AuthHandler) maybeExchangeAppleCode(
	ctx context.Context,
	identityID uuid.UUID,
	authorizationCode string,
) error {
	if authorizationCode == "" {
		return nil
	}
	if h.appleClient == nil || h.appleEncKey == nil {
		return nil
	}

	existing, err := h.db.GetAppleRefreshTokenEncrypted(ctx, identityID)
	if err != nil {
		return err
	}
	if len(existing) > 0 {
		return nil // we already hold one; code is one-time-use, so skip.
	}

	tok, err := h.appleClient.ExchangeAuthorizationCode(ctx, authorizationCode)
	if err != nil {
		return err
	}
	blob, err := apple.Encrypt(h.appleEncKey, []byte(tok.RefreshToken))
	if err != nil {
		return err
	}
	return h.db.SetAppleRefreshTokenEncrypted(ctx, db.SetAppleRefreshTokenEncryptedParams{
		ID:                         identityID,
		AppleRefreshTokenEncrypted: blob,
	})
}
