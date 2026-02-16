package jobs

import (
	"chat-app-server/db"
	"chat-app-server/notifications"
	"context"
	"fmt"
	"log"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/google/uuid"
)

// deleteS3ObjectsWithPrefix deletes all S3 objects with the given prefix, handling pagination
// for buckets with more than 1000 objects. Returns the total number of objects deleted.
func deleteS3ObjectsWithPrefix(ctx context.Context, s3Client *s3.Client, bucket, prefix, _ string) (int, error) {
	var continuationToken *string
	totalDeleted := 0

	for {
		listOutput, err := s3Client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
			Bucket:            aws.String(bucket),
			Prefix:            aws.String(prefix),
			ContinuationToken: continuationToken,
		})
		if err != nil {
			return totalDeleted, fmt.Errorf("failed to list S3 objects: %w", err)
		}

		if len(listOutput.Contents) == 0 {
			break
		}

		var objectIds []types.ObjectIdentifier
		for _, obj := range listOutput.Contents {
			objectIds = append(objectIds, types.ObjectIdentifier{Key: obj.Key})
		}

		_, err = s3Client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(bucket),
			Delete: &types.Delete{Objects: objectIds},
		})
		if err != nil {
			return totalDeleted, fmt.Errorf("failed to delete S3 objects: %w", err)
		}

		totalDeleted += len(objectIds)

		if !aws.ToBool(listOutput.IsTruncated) {
			break
		}
		continuationToken = listOutput.NextContinuationToken
	}

	return totalDeleted, nil
}

// CleanupExpiredGroupsJob deletes groups that have passed their end_time
type CleanupExpiredGroupsJob struct {
	BaseJob
}

func (j *CleanupExpiredGroupsJob) Name() string {
	return "cleanup_expired_groups"
}

func (j *CleanupExpiredGroupsJob) Schedule() string {
	return "0 * * * *" // Every hour
}

func (j *CleanupExpiredGroupsJob) LockTimeout() time.Duration {
	return 30 * time.Minute
}

func (j *CleanupExpiredGroupsJob) Execute(ctx context.Context) error {
	// Get expired groups in batches of 50
	expiredGroups, err := j.db.GetExpiredGroups(ctx, 50)
	if err != nil {
		return fmt.Errorf("failed to get expired groups: %w", err)
	}

	if len(expiredGroups) == 0 {
		log.Printf("Job %s: No expired groups found", j.Name())
	} else {
		log.Printf("Job %s: Found %d expired groups to clean up", j.Name(), len(expiredGroups))

		// Process each expired group
		cleanedCount := 0
		for _, group := range expiredGroups {
			if err := j.cleanupGroup(ctx, group.ID); err != nil {
				log.Printf("Job %s: Error cleaning up group %s: %v", j.Name(), group.ID, err)
				// Continue with other groups even if one fails
				continue
			}
			cleanedCount++
			log.Printf("Job %s: Cleaned up group %s (ended %s)", j.Name(), group.ID, group.EndTime.Time.Format(time.RFC3339))
		}

		log.Printf("Job %s: Cleaned up %d/%d expired groups", j.Name(), cleanedCount, len(expiredGroups))
	}

	// Clean up soft-deleted groups that still have orphaned messages/S3 data
	// (e.g. groups where the last user left before expiration)
	softDeletedGroups, err := j.db.GetSoftDeletedGroupsNeedingCleanup(ctx, 50)
	if err != nil {
		return fmt.Errorf("failed to get soft-deleted groups needing cleanup: %w", err)
	}

	if len(softDeletedGroups) > 0 {
		log.Printf("Job %s: Found %d soft-deleted groups with orphaned data", j.Name(), len(softDeletedGroups))
		orphanCleaned := 0
		for _, group := range softDeletedGroups {
			if err := j.cleanupOrphanedGroupData(ctx, group.ID); err != nil {
				log.Printf("Job %s: Error cleaning orphaned data for group %s: %v", j.Name(), group.ID, err)
				continue
			}
			orphanCleaned++
			log.Printf("Job %s: Cleaned orphaned data for soft-deleted group %s", j.Name(), group.ID)
		}
		log.Printf("Job %s: Cleaned orphaned data for %d/%d soft-deleted groups", j.Name(), orphanCleaned, len(softDeletedGroups))
	}

	return nil
}

func (j *CleanupExpiredGroupsJob) cleanupGroup(ctx context.Context, groupID uuid.UUID) error {
	// Step 1: Delete S3 objects for the group
	if err := j.deleteS3Objects(ctx, groupID); err != nil {
		log.Printf("Job %s: Warning - failed to delete S3 objects for group %s: %v", j.Name(), groupID, err)
		// Continue with database cleanup even if S3 cleanup fails
	}

	// Step 2: Delete database records in a transaction
	tx, err := j.pgxPool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	qtx := j.db.WithTx(tx)

	// Delete messages (DeleteMessagesForGroup expects *uuid.UUID)
	if err := qtx.DeleteMessagesForGroup(ctx, &groupID); err != nil {
		return fmt.Errorf("failed to delete messages: %w", err)
	}

	// Delete user_groups relationships
	if err := qtx.DeleteUserGroupsForGroup(ctx, &groupID); err != nil {
		return fmt.Errorf("failed to delete user_groups: %w", err)
	}

	// Delete the group itself (DeleteGroup expects uuid.UUID and returns DeleteGroupRow)
	if _, err := qtx.DeleteGroup(ctx, groupID); err != nil {
		return fmt.Errorf("failed to delete group: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	// Step 3: Cleanup Redis keys
	if err := j.cleanupRedisKeys(ctx, groupID); err != nil {
		log.Printf("Job %s: Warning - failed to cleanup Redis keys for group %s: %v", j.Name(), groupID, err)
		// Don't return error - Redis cleanup is best-effort
	}

	return nil
}

func (j *CleanupExpiredGroupsJob) cleanupOrphanedGroupData(ctx context.Context, groupID uuid.UUID) error {
	// Delete S3 objects first — if this fails, return early so the group is
	// retried next run (messages/image_url still present keep it in the query)
	if err := j.deleteS3Objects(ctx, groupID); err != nil {
		return fmt.Errorf("failed to delete S3 objects for soft-deleted group: %w", err)
	}

	// Delete orphaned messages
	if err := j.db.DeleteMessagesForGroup(ctx, &groupID); err != nil {
		return fmt.Errorf("failed to delete messages for soft-deleted group: %w", err)
	}

	// Clear image_url so this group isn't picked up again
	if err := j.db.ClearGroupImageUrl(ctx, groupID); err != nil {
		return fmt.Errorf("failed to clear image_url for soft-deleted group: %w", err)
	}

	// Best-effort Redis cleanup (may already be cleaned by LeaveGroup)
	if err := j.cleanupRedisKeys(ctx, groupID); err != nil {
		log.Printf("Job %s: Warning - failed to cleanup Redis keys for soft-deleted group %s: %v", j.Name(), groupID, err)
	}

	return nil
}

func (j *CleanupExpiredGroupsJob) deleteS3Objects(ctx context.Context, groupID uuid.UUID) error {
	prefix := fmt.Sprintf("groups/%s/", groupID)

	deleted, err := deleteS3ObjectsWithPrefix(ctx, j.s3Client, j.s3Bucket, prefix, j.Name())
	if err != nil {
		return err
	}

	if deleted > 0 {
		log.Printf("Job %s: Deleted %d S3 objects for group %s", j.Name(), deleted, groupID)
	}
	return nil
}

func (j *CleanupExpiredGroupsJob) cleanupRedisKeys(ctx context.Context, groupID uuid.UUID) error {
	groupIDStr := groupID.String()

	// Get group members before deleting the set
	membersKey := fmt.Sprintf("group:%s:members", groupIDStr)
	members, err := j.redisClient.SMembers(ctx, membersKey).Result()
	if err != nil {
		log.Printf("Job %s: Warning - failed to get group members from Redis: %v", j.Name(), err)
		// Continue with cleanup
		members = []string{}
	}

	// Remove group from each member's user:{userID}:groups set
	for _, memberID := range members {
		userGroupsKey := fmt.Sprintf("user:%s:groups", memberID)
		if err := j.redisClient.SRem(ctx, userGroupsKey, groupIDStr).Err(); err != nil {
			log.Printf("Job %s: Warning - failed to remove group from user %s groups: %v", j.Name(), memberID, err)
		}
	}

	// Delete group:{groupID}:members
	if err := j.redisClient.Del(ctx, membersKey).Err(); err != nil {
		log.Printf("Job %s: Warning - failed to delete group members set: %v", j.Name(), err)
	}

	// Delete groupinfo:{groupID}
	groupInfoKey := fmt.Sprintf("groupinfo:%s", groupIDStr)
	if err := j.redisClient.Del(ctx, groupInfoKey).Err(); err != nil {
		log.Printf("Job %s: Warning - failed to delete groupinfo: %v", j.Name(), err)
	}

	return nil
}

// CleanupStaleReservationsJob removes group reservations older than 24 hours
type CleanupStaleReservationsJob struct {
	BaseJob
}

func (j *CleanupStaleReservationsJob) Name() string {
	return "cleanup_stale_reservations"
}

func (j *CleanupStaleReservationsJob) Schedule() string {
	return "0 3 * * *" // Daily at 3 AM UTC
}

func (j *CleanupStaleReservationsJob) LockTimeout() time.Duration {
	return 5 * time.Minute
}

func (j *CleanupStaleReservationsJob) Execute(ctx context.Context) error {
	// Get stale reservations (older than 24 hours)
	staleReservations, err := j.db.GetStaleGroupReservations(ctx)
	if err != nil {
		return fmt.Errorf("failed to get stale reservations: %w", err)
	}

	if len(staleReservations) == 0 {
		log.Printf("Job %s: No stale reservations found", j.Name())
		return nil
	}

	log.Printf("Job %s: Found %d stale reservations to clean up", j.Name(), len(staleReservations))

	deletedCount := 0
	for _, reservation := range staleReservations {
		// Delete orphaned S3 objects (if any)
		if err := j.deleteS3Objects(ctx, reservation.GroupID); err != nil {
			log.Printf("Job %s: Warning - failed to delete S3 objects for reservation %s: %v", j.Name(), reservation.GroupID, err)
			// Continue with database cleanup
		}

		// Delete the reservation from database
		if err := j.db.DeleteGroupReservation(ctx, reservation.GroupID); err != nil {
			log.Printf("Job %s: Error deleting reservation %s: %v", j.Name(), reservation.GroupID, err)
			continue
		}

		deletedCount++
	}

	log.Printf("Job %s: Cleaned up %d stale reservations", j.Name(), deletedCount)
	return nil
}

func (j *CleanupStaleReservationsJob) deleteS3Objects(ctx context.Context, groupID uuid.UUID) error {
	prefix := fmt.Sprintf("groups/%s/", groupID)

	deleted, err := deleteS3ObjectsWithPrefix(ctx, j.s3Client, j.s3Bucket, prefix, j.Name())
	if err != nil {
		return err
	}

	if deleted > 0 {
		log.Printf("Job %s: Deleted %d orphaned S3 objects for reservation %s", j.Name(), deleted, groupID)
	}
	return nil
}

// CleanupStaleDeviceKeysJob removes device keys for inactive devices
type CleanupStaleDeviceKeysJob struct {
	BaseJob
}

func (j *CleanupStaleDeviceKeysJob) Name() string {
	return "cleanup_stale_device_keys"
}

func (j *CleanupStaleDeviceKeysJob) Schedule() string {
	return "0 1 * * 0" // Weekly on Sunday at 1 AM UTC
}

func (j *CleanupStaleDeviceKeysJob) LockTimeout() time.Duration {
	return 5 * time.Minute
}

func (j *CleanupStaleDeviceKeysJob) Execute(ctx context.Context) error {
	// Get stale device keys (not seen in 90+ days)
	staleKeys, err := j.db.GetStaleDeviceKeys(ctx)
	if err != nil {
		return fmt.Errorf("failed to get stale device keys: %w", err)
	}

	if len(staleKeys) == 0 {
		log.Printf("Job %s: No stale device keys found", j.Name())
		return nil
	}

	log.Printf("Job %s: Found %d potentially stale device keys", j.Name(), len(staleKeys))

	deletedCount := 0
	skippedCount := 0

	for _, key := range staleKeys {
		// Check if user has any active groups
		hasActiveGroups, err := j.db.UserHasActiveGroups(ctx, &key.UserID)
		if err != nil {
			log.Printf("Job %s: Error checking active groups for user %s: %v", j.Name(), key.UserID, err)
			continue
		}

		// Skip deletion if user has active groups (preserve message access)
		if hasActiveGroups {
			skippedCount++
			continue
		}

		// Delete the device key (DeleteDeviceKey expects DeleteDeviceKeyParams)
		if err := j.db.DeleteDeviceKey(ctx, db.DeleteDeviceKeyParams{
			UserID:           key.UserID,
			DeviceIdentifier: key.DeviceIdentifier,
		}); err != nil {
			log.Printf("Job %s: Error deleting device key for user %s, device %s: %v", j.Name(), key.UserID, key.DeviceIdentifier, err)
			continue
		}

		deletedCount++
	}

	log.Printf("Job %s: Deleted %d device keys, skipped %d (users with active groups)", j.Name(), deletedCount, skippedCount)
	return nil
}

// ProcessPushReceiptsJob checks pending push notification receipts and removes invalid tokens
type ProcessPushReceiptsJob struct {
	BaseJob
	notificationService *notifications.NotificationService
}

// NewProcessPushReceiptsJob creates a new ProcessPushReceiptsJob with the notification service
func NewProcessPushReceiptsJob(baseJob BaseJob, notificationService *notifications.NotificationService) *ProcessPushReceiptsJob {
	return &ProcessPushReceiptsJob{
		BaseJob:             baseJob,
		notificationService: notificationService,
	}
}

func (j *ProcessPushReceiptsJob) Name() string {
	return "process_push_receipts"
}

func (j *ProcessPushReceiptsJob) Schedule() string {
	return "*/15 * * * *" // Every 15 minutes
}

func (j *ProcessPushReceiptsJob) LockTimeout() time.Duration {
	return 5 * time.Minute
}

func (j *ProcessPushReceiptsJob) Execute(ctx context.Context) error {
	log.Printf("Job %s: Starting push receipt processing", j.Name())

	if err := j.notificationService.ProcessReceipts(ctx); err != nil {
		return fmt.Errorf("failed to process push receipts: %w", err)
	}

	log.Printf("Job %s: Completed push receipt processing", j.Name())
	return nil
}
