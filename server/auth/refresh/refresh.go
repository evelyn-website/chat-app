// Package refresh implements the opaque-refresh-token state machine described
// in development-notes/auth-overhaul/plan.md §2.
//
// Properties we want:
//   - The refresh token is a 32-byte cryptographic random value, base64url
//     encoded. The server never stores the plaintext — only SHA-256(token).
//   - Every successful refresh ROTATES the token: the old row is marked
//     revoked_at=NOW() with replaced_by linking to the new row.
//   - Re-presenting a revoked-and-replaced token is the theft signal. When we
//     see it, we walk the family chain and revoke everything in it.
package refresh

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"chat-app-server/db"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TTL is the absolute lifetime of a refresh token. Rotation resets this window.
const TTL = 30 * 24 * time.Hour

// Sentinel errors. Handlers map these to 401s; the distinct types let
// observability and tests assert on the state-machine branch taken.
var (
	ErrNotFound         = errors.New("refresh: token not found")
	ErrAlreadyRevoked   = errors.New("refresh: token already revoked")
	ErrTheftDetected    = errors.New("refresh: replayed consumed token")
	ErrExpired          = errors.New("refresh: token expired")
	ErrDeviceMismatch   = errors.New("refresh: device_identifier does not match")
)

// Store owns the transactional interactions with refresh_tokens. It deliberately
// wraps db.Queries rather than embedding so the verify/rotate flow can take a
// pgx pool and issue the multi-statement atomic rotation described in the plan.
type Store struct {
	queries *db.Queries
	pool    *pgxpool.Pool
}

func NewStore(queries *db.Queries, pool *pgxpool.Pool) *Store {
	return &Store{queries: queries, pool: pool}
}

// Generate returns a new refresh-token plaintext and its SHA-256 hash. The
// plaintext is returned to the client once; the hash is persisted.
func Generate() (plaintext string, hash []byte, err error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", nil, err
	}
	plaintext = base64.RawURLEncoding.EncodeToString(buf)
	sum := sha256.Sum256([]byte(plaintext))
	return plaintext, sum[:], nil
}

// Hash wraps SHA-256 so callers (tests, handlers) don't reach into crypto/sha256
// directly.
func Hash(plaintext string) []byte {
	sum := sha256.Sum256([]byte(plaintext))
	return sum[:]
}

func (s *Store) issueToken(ctx context.Context, q *db.Queries, userID uuid.UUID, deviceIdentifier, userAgent string) (string, error) {
	plaintext, hash, err := Generate()
	if err != nil {
		return "", fmt.Errorf("generate: %w", err)
	}
	_, err = q.InsertRefreshToken(ctx, db.InsertRefreshTokenParams{
		UserID:           userID,
		DeviceIdentifier: deviceIdentifier,
		TokenHash:        hash,
		ExpiresAt:        pgtype.Timestamp{Time: time.Now().Add(TTL), Valid: true},
		UserAgent:        pgtype.Text{String: userAgent, Valid: userAgent != ""},
	})
	if err != nil {
		return "", fmt.Errorf("insert: %w", err)
	}
	return plaintext, nil
}

// Issue inserts a fresh refresh token row for (userID, deviceIdentifier) and
// returns the plaintext to hand back to the client.
func (s *Store) Issue(ctx context.Context, userID uuid.UUID, deviceIdentifier, userAgent string) (string, error) {
	return s.issueToken(ctx, s.queries, userID, deviceIdentifier, userAgent)
}

// IssueTx behaves like Issue but participates in an existing transaction. Used
// by /auth/apple so user creation, identity upsert, device-key upsert, and
// refresh-token issuance either all succeed or all roll back together.
func (s *Store) IssueTx(ctx context.Context, qtx *db.Queries, userID uuid.UUID, deviceIdentifier, userAgent string) (string, error) {
	return s.issueToken(ctx, qtx, userID, deviceIdentifier, userAgent)
}

// RotateResult carries the output of a successful rotation so the caller can
// hand the new plaintext back to the client while knowing which user/device
// it belongs to.
type RotateResult struct {
	NewPlaintext     string
	UserID           uuid.UUID
	DeviceIdentifier string
}

// Rotate verifies a presented refresh token and issues a replacement in a
// single transaction. See plan §2.3 for the state machine; ErrTheftDetected
// is the critical branch — a replayed row that has already been revoked AND
// replaced means a thief is holding a stolen copy, and we burn the whole
// family.
//
// userAgent is optional and recorded for audit only.
func (s *Store) Rotate(ctx context.Context, presentedPlaintext, deviceIdentifier, userAgent string) (RotateResult, error) {
	return s.rotate(ctx, presentedPlaintext, deviceIdentifier, userAgent, nil)
}

// RotateWithWork is like Rotate but calls work within the rotation transaction
// before committing. If work returns an error the transaction is rolled back
// and the rotation is abandoned — the presented token remains valid so the
// caller can retry. This ensures response-critical work (e.g. fetching user
// fields) is atomic with the token swap so a post-commit DB failure cannot
// leave the new token committed but undelivered to the client.
func (s *Store) RotateWithWork(
	ctx context.Context,
	presentedPlaintext, deviceIdentifier, userAgent string,
	work func(ctx context.Context, q *db.Queries, r RotateResult) error,
) (RotateResult, error) {
	return s.rotate(ctx, presentedPlaintext, deviceIdentifier, userAgent, work)
}

func (s *Store) rotate(
	ctx context.Context,
	presentedPlaintext, deviceIdentifier, userAgent string,
	work func(ctx context.Context, q *db.Queries, r RotateResult) error,
) (RotateResult, error) {
	hash := Hash(presentedPlaintext)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RotateResult{}, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)

	row, err := qtx.GetRefreshTokenByHash(ctx, hash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return RotateResult{}, ErrNotFound
		}
		return RotateResult{}, fmt.Errorf("lookup: %w", err)
	}

	if row.RevokedAt.Valid {
		// Already-revoked path. Distinguish theft (revoked AND replaced) from
		// benign double-use (revoked via logout, replaced_by NULL).
		if row.ReplacedBy != nil {
			if err := qtx.RevokeRefreshTokenFamily(ctx, row.ID); err != nil {
				return RotateResult{}, fmt.Errorf("revoke family: %w", err)
			}
			if err := tx.Commit(ctx); err != nil {
				return RotateResult{}, fmt.Errorf("commit theft response: %w", err)
			}
			return RotateResult{}, ErrTheftDetected
		}
		return RotateResult{}, ErrAlreadyRevoked
	}

	if row.ExpiresAt.Valid && time.Now().After(row.ExpiresAt.Time) {
		return RotateResult{}, ErrExpired
	}

	if row.DeviceIdentifier != deviceIdentifier {
		// Don't commit anything — device mismatch may indicate a client bug or
		// a stolen token used from a different device. Either way the safe
		// answer is to refuse without revealing which branch.
		return RotateResult{}, ErrDeviceMismatch
	}

	// Happy path: insert the replacement, link the old row to it.
	newPlaintext, newHash, err := Generate()
	if err != nil {
		return RotateResult{}, fmt.Errorf("generate new: %w", err)
	}
	newRow, err := qtx.InsertRefreshToken(ctx, db.InsertRefreshTokenParams{
		UserID:           row.UserID,
		DeviceIdentifier: row.DeviceIdentifier,
		TokenHash:        newHash,
		ExpiresAt:        pgtype.Timestamp{Time: time.Now().Add(TTL), Valid: true},
		UserAgent:        pgtype.Text{String: userAgent, Valid: userAgent != ""},
	})
	if err != nil {
		return RotateResult{}, fmt.Errorf("insert new: %w", err)
	}

	newRowID := newRow.ID
	affected, err := qtx.RotateRefreshToken(ctx, db.RotateRefreshTokenParams{
		ID:         row.ID,
		ReplacedBy: &newRowID,
	})
	if err != nil {
		return RotateResult{}, fmt.Errorf("mark old rotated: %w", err)
	}
	if affected == 0 {
		// Another goroutine rotated this row between our SELECT and UPDATE —
		// i.e., the same plaintext was presented concurrently. Treat it as
		// theft: drop our not-yet-committed replacement, then revoke the whole
		// family in a fresh transaction.
		_ = tx.Rollback(ctx)
		if err := s.queries.RevokeRefreshTokenFamily(ctx, row.ID); err != nil {
			return RotateResult{}, fmt.Errorf("family revoke after race: %w", err)
		}
		return RotateResult{}, ErrTheftDetected
	}

	result := RotateResult{
		NewPlaintext:     newPlaintext,
		UserID:           row.UserID,
		DeviceIdentifier: row.DeviceIdentifier,
	}

	if work != nil {
		if err := work(ctx, qtx, result); err != nil {
			return RotateResult{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return RotateResult{}, fmt.Errorf("commit: %w", err)
	}

	return result, nil
}

// Revoke marks the presented refresh token revoked. Idempotent: unknown or
// already-revoked tokens return nil so the /auth/logout handler doesn't leak
// an oracle about which case was hit.
func (s *Store) Revoke(ctx context.Context, presentedPlaintext string) error {
	hash := Hash(presentedPlaintext)
	row, err := s.queries.GetRefreshTokenByHash(ctx, hash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	if row.RevokedAt.Valid {
		return nil
	}
	return s.queries.RevokeRefreshToken(ctx, row.ID)
}
