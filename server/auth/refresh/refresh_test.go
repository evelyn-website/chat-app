package refresh

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"chat-app-server/db"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// These tests require a live Postgres — the refresh state machine leans on
// the partial indexes, NULL semantics, and transaction guarantees Postgres
// provides. They run inside `docker compose exec go-server go test` where
// DB_URL is configured; skip outside that environment.
func newTestStore(t *testing.T) (*Store, *db.Queries, func()) {
	t.Helper()
	dbURL := os.Getenv("DB_URL")
	if dbURL == "" {
		t.Skip("DB_URL not set; skipping refresh tests")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	q := db.New(pool)
	cleanup := func() { pool.Close() }
	return NewStore(q, pool), q, cleanup
}

// insertTestUser creates a user row we can attach refresh tokens to. The
// refresh_tokens.user_id FK requires a real row.
func insertTestUser(t *testing.T, q *db.Queries) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	user, err := q.InsertUserOIDC(ctx, db.InsertUserOIDCParams{
		Username:   "test-" + uuid.NewString()[:8],
		Email:      pgtype.Text{},
		FullName:   pgtype.Text{},
		GivenName:  pgtype.Text{},
		FamilyName: pgtype.Text{},
	})
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = q.DeleteUser(ctx, user.ID)
	})
	return user.ID
}

func TestRotate_HappyPath(t *testing.T) {
	store, q, cleanup := newTestStore(t)
	defer cleanup()
	ctx := context.Background()

	userID := insertTestUser(t, q)
	plaintext, err := store.Issue(ctx, userID, "device-1", "")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	res, err := store.Rotate(ctx, plaintext, "device-1", "")
	if err != nil {
		t.Fatalf("rotate: %v", err)
	}
	if res.UserID != userID {
		t.Errorf("user: got %v want %v", res.UserID, userID)
	}
	if res.NewPlaintext == plaintext {
		t.Error("rotated token should differ from original")
	}

	// The old token must now refuse a second rotation — single-use.
	_, err = store.Rotate(ctx, plaintext, "device-1", "")
	if !errors.Is(err, ErrTheftDetected) {
		t.Errorf("second rotate: got %v want ErrTheftDetected", err)
	}
}

// TestRotate_TheftDetection is the single most important test in this overhaul
// (per plan §12). Scenario: a token is rotated; someone presents the ORIGINAL
// again. That row has revoked_at != NULL AND replaced_by != NULL. We must
// react by revoking the entire family and rejecting the request.
func TestRotate_TheftDetection(t *testing.T) {
	store, q, cleanup := newTestStore(t)
	defer cleanup()
	ctx := context.Background()

	userID := insertTestUser(t, q)
	original, err := store.Issue(ctx, userID, "device-1", "")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	// Legitimate rotation — the new token is valid.
	first, err := store.Rotate(ctx, original, "device-1", "")
	if err != nil {
		t.Fatalf("first rotate: %v", err)
	}

	// Now a thief replays the original (pre-rotation) token.
	_, err = store.Rotate(ctx, original, "device-1", "")
	if !errors.Is(err, ErrTheftDetected) {
		t.Fatalf("theft reuse: got %v want ErrTheftDetected", err)
	}

	// The family response: the token the legitimate user just got should now
	// also be revoked. Presenting it returns ErrAlreadyRevoked (NOT theft —
	// it was explicitly revoked but hasn't been rotated).
	_, err = store.Rotate(ctx, first.NewPlaintext, "device-1", "")
	if !errors.Is(err, ErrAlreadyRevoked) && !errors.Is(err, ErrTheftDetected) {
		t.Fatalf("post-theft family revoke: got %v want ErrAlreadyRevoked or ErrTheftDetected", err)
	}
}

func TestRotate_DeviceMismatch(t *testing.T) {
	store, q, cleanup := newTestStore(t)
	defer cleanup()
	ctx := context.Background()

	userID := insertTestUser(t, q)
	plaintext, err := store.Issue(ctx, userID, "device-1", "")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	_, err = store.Rotate(ctx, plaintext, "device-2", "")
	if !errors.Is(err, ErrDeviceMismatch) {
		t.Fatalf("got %v want ErrDeviceMismatch", err)
	}
}

func TestRotate_Unknown(t *testing.T) {
	store, _, cleanup := newTestStore(t)
	defer cleanup()
	ctx := context.Background()

	// A random token that was never issued.
	bogus, _, err := Generate()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	_, err = store.Rotate(ctx, bogus, "device-1", "")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("got %v want ErrNotFound", err)
	}
}

func TestRotate_Expired(t *testing.T) {
	store, q, cleanup := newTestStore(t)
	defer cleanup()
	ctx := context.Background()

	userID := insertTestUser(t, q)
	plaintext, err := store.Issue(ctx, userID, "device-1", "")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	// Expire the row by hand. We can't shift time forward; easiest is to
	// UPDATE the row directly via the pool.
	hash := Hash(plaintext)
	row, err := q.GetRefreshTokenByHash(ctx, hash)
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if _, err := store.pool.Exec(ctx, "UPDATE refresh_tokens SET expires_at = $1 WHERE id = $2",
		time.Now().Add(-1*time.Hour), row.ID); err != nil {
		t.Fatalf("age row: %v", err)
	}

	_, err = store.Rotate(ctx, plaintext, "device-1", "")
	if !errors.Is(err, ErrExpired) {
		t.Fatalf("got %v want ErrExpired", err)
	}
}

func TestRevoke_Idempotent(t *testing.T) {
	store, q, cleanup := newTestStore(t)
	defer cleanup()
	ctx := context.Background()

	userID := insertTestUser(t, q)
	plaintext, err := store.Issue(ctx, userID, "device-1", "")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if err := store.Revoke(ctx, plaintext); err != nil {
		t.Fatalf("first revoke: %v", err)
	}
	// Second revoke — same token. Must be a no-op.
	if err := store.Revoke(ctx, plaintext); err != nil {
		t.Fatalf("second revoke: %v", err)
	}
	// Unknown token — also a no-op.
	bogus, _, err := Generate()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if err := store.Revoke(ctx, bogus); err != nil {
		t.Fatalf("unknown revoke: %v", err)
	}
}
