package main

import (
	"chat-app-server/auth"
	"chat-app-server/db"
	"chat-app-server/images"
	"chat-app-server/jobs"
	"chat-app-server/notifications"
	"chat-app-server/router"
	"chat-app-server/s3store"
	"chat-app-server/server"
	"chat-app-server/ws"
	"context"
	"fmt"
	"log"
	"os"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

var (
	RedisClient      *redis.Client
	ServerInstanceID string
)

func InitializeRedis(ctx context.Context) {
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		log.Fatal("REDIS_URL environment variable not set")
	}
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Fatalf("Could not parse REDIS_URL: %v", err)
	}
	RedisClient = redis.NewClient(opts)
	if err := RedisClient.Ping(ctx).Err(); err != nil {
		log.Fatalf("Could not connect to Redis: %v", err)
	}
	log.Println("Successfully connected to Redis.")
}

func init() {
	ServerInstanceID = uuid.NewString()
	log.Printf("Initializing with ServerInstanceID: %s", ServerInstanceID)
}

func main() {
	ctx := context.Background()

	InitializeRedis(ctx)

	connPool, err := pgxpool.New(ctx, os.Getenv("DB_URL"))
	if err != nil {
		fmt.Fprintf(os.Stderr, "Unable to connect to database: %v\n", err)
		os.Exit(1)
	}
	db := db.New(connPool)

	authHandler := auth.NewAuthHandler(db, ctx, connPool)

	// Initialize notification service
	notificationService := notifications.NewNotificationService(db, RedisClient)
	notificationHandler := notifications.NewNotificationHandler(db)

	hub := ws.NewHub(db, ctx, connPool, RedisClient, ServerInstanceID, notificationService)
	wsHandler := ws.NewHandler(hub, db, ctx, connPool)
	go hub.Run()

	api := server.NewAPI(db, ctx, connPool)

	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		fmt.Fprintf(os.Stderr, "Unable to connect to AWS: %v\n", err)
		os.Exit(1)
	}
	store := s3store.New(cfg, os.Getenv("S3_BUCKET"))

	// Initialize and start job scheduler (after S3 store creation)
	jobDeps := &jobs.JobDependencies{
		NotificationService: notificationService,
	}
	scheduler := jobs.NewScheduler(db, ctx, connPool, RedisClient, store.GetS3Client(), store.GetBucket(), ServerInstanceID, jobDeps)
	go scheduler.Start()

	imageHandler := images.NewImageHandler(store, db, ctx, connPool)

	defer connPool.Close()
	defer scheduler.Stop()

	router.InitRouter(authHandler, wsHandler, api, imageHandler, notificationHandler)
	router.Start(":8080")

}
