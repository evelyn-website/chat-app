package jobs

import (
	"chat-app-server/db"
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// Job defines the interface that all recurring jobs must implement
type Job interface {
	// Name returns the unique identifier for the job (snake_case)
	Name() string

	// Schedule returns the cron expression for job execution
	// Cron format: "minute hour day month weekday"
	// Examples:
	//   "*/15 * * * *"  - Every 15 minutes
	//   "0 2 * * *"     - Daily at 2 AM UTC
	//   "0 */6 * * *"   - Every 6 hours
	//   "0 0 * * 0"     - Weekly on Sunday at midnight
	Schedule() string

	// LockTimeout returns the Redis lock TTL
	// Should be slightly longer than expected execution time
	LockTimeout() time.Duration

	// Execute performs the job's work
	// Must be idempotent (safe to run multiple times)
	// Must respect context cancellation
	Execute(ctx context.Context) error
}

// BaseJob provides common dependencies for all jobs
type BaseJob struct {
	db          *db.Queries
	redisClient *redis.Client
	pgxPool     *pgxpool.Pool
	ctx         context.Context
}

// NewBaseJob creates a new BaseJob with the provided dependencies
func NewBaseJob(dbQueries *db.Queries, redisClient *redis.Client, pgxPool *pgxpool.Pool, ctx context.Context) BaseJob {
	return BaseJob{
		db:          dbQueries,
		redisClient: redisClient,
		pgxPool:     pgxPool,
		ctx:         ctx,
	}
}
