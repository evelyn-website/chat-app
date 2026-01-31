package jobs

import (
	"chat-app-server/db"
	"context"
	"fmt"
	"log"
	"time"

	"github.com/bsm/redislock"
	"github.com/go-co-op/gocron"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// Scheduler manages the lifecycle of all recurring jobs with distributed locking
type Scheduler struct {
	cron     *gocron.Scheduler
	locker   *redislock.Client
	ctx      context.Context
	serverID string
}

// NewScheduler creates and initializes a new job scheduler
func NewScheduler(dbQueries *db.Queries, ctx context.Context, pgxPool *pgxpool.Pool, redisClient *redis.Client, serverID string) *Scheduler {
	// Create gocron scheduler with UTC timezone
	cronScheduler := gocron.NewScheduler(time.UTC)

	// Create Redis locker for distributed locking
	locker := redislock.New(redisClient)

	scheduler := &Scheduler{
		cron:     cronScheduler,
		locker:   locker,
		ctx:      ctx,
		serverID: serverID,
	}

	// Create base job with dependencies
	baseJob := NewBaseJob(dbQueries, redisClient, pgxPool, ctx)

	// Register all enabled jobs from registry
	jobConfigs := GetJobConfigs(baseJob)
	for _, config := range jobConfigs {
		if config.IsEnabled() {
			scheduler.registerJob(config.Job)
		}
	}

	return scheduler
}

// registerJob registers a single job with the scheduler
func (s *Scheduler) registerJob(job Job) {
	// Wrap job execution with distributed locking
	_, err := s.cron.Cron(job.Schedule()).Do(func() {
		s.executeWithLock(job)
	})

	if err != nil {
		log.Printf("Scheduler %s: Error registering job '%s': %v", s.serverID, job.Name(), err)
		return
	}

	log.Printf("Scheduler %s: Registered job '%s' with schedule '%s'", s.serverID, job.Name(), job.Schedule())
}

// executeWithLock executes a job with distributed locking to ensure only one instance runs it
func (s *Scheduler) executeWithLock(job Job) {
	lockKey := fmt.Sprintf("job:lock:%s", job.Name())
	lockTimeout := job.LockTimeout()

	// Try to acquire distributed lock
	lock, err := s.locker.Obtain(s.ctx, lockKey, lockTimeout, &redislock.Options{
		RetryStrategy: redislock.LimitRetry(redislock.LinearBackoff(100*time.Millisecond), 3),
	})

	if err == redislock.ErrNotObtained {
		// Another instance is running this job
		log.Printf("Scheduler %s: Job '%s' already running on another instance, skipping", s.serverID, job.Name())
		return
	} else if err != nil {
		log.Printf("Scheduler %s: Error acquiring lock for job '%s': %v", s.serverID, job.Name(), err)
		return
	}

	// Ensure lock is released
	defer func() {
		if err := lock.Release(s.ctx); err != nil {
			log.Printf("Scheduler %s: Error releasing lock for job '%s': %v", s.serverID, job.Name(), err)
		}
	}()

	// Execute the job
	log.Printf("Scheduler %s: Starting job '%s'", s.serverID, job.Name())

	if err := job.Execute(s.ctx); err != nil {
		log.Printf("Scheduler %s: Job '%s' failed: %v", s.serverID, job.Name(), err)
		return
	}

	log.Printf("Scheduler %s: Job '%s' completed successfully", s.serverID, job.Name())
}

// Start begins the scheduler (blocking call - run in goroutine)
func (s *Scheduler) Start() {
	log.Printf("Scheduler %s: Starting job scheduler", s.serverID)
	s.cron.StartBlocking()
}

// Stop gracefully stops the scheduler
func (s *Scheduler) Stop() {
	log.Printf("Scheduler %s: Stopping job scheduler", s.serverID)
	s.cron.Stop()
}
