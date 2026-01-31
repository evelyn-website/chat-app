package jobs

import (
	"chat-app-server/db"
	"context"
	"fmt"
	"log"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/google/uuid"
)

// CleanupExpiredGroupsJob deletes groups that have passed their end_time
type CleanupExpiredGroupsJob struct {
	BaseJob
}

func (j *CleanupExpiredGroupsJob) Name() string {
	return "cleanup_expired_groups"
}

func (j *CleanupExpiredGroupsJob) Schedule() string {
	return "0 */6 * * *" // Every 6 hours
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
		return nil
	}

	log.Printf("Job %s: Found %d expired groups to clean up", j.Name(), len(expiredGroups))

	// Process each expired group
	for _, group := range expiredGroups {
		if err := j.cleanupGroup(ctx, group.ID); err != nil {
			log.Printf("Job %s: Error cleaning up group %s: %v", j.Name(), group.ID, err)
			// Continue with other groups even if one fails
			continue
		}
		log.Printf("Job %s: Cleaned up group %s (ended %s)", j.Name(), group.ID, group.EndTime.Time.Format(time.RFC3339))
	}

	log.Printf("Job %s: Cleaned up %d expired groups", j.Name(), len(expiredGroups))
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

func (j *CleanupExpiredGroupsJob) deleteS3Objects(ctx context.Context, groupID uuid.UUID) error {
	prefix := fmt.Sprintf("groups/%s/", groupID)

	// List objects with the group's prefix
	listOutput, err := j.s3Client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
		Bucket: aws.String(j.s3Bucket),
		Prefix: aws.String(prefix),
	})
	if err != nil {
		return fmt.Errorf("failed to list S3 objects: %w", err)
	}

	if len(listOutput.Contents) == 0 {
		// No objects to delete
		return nil
	}

	// Build delete request (up to 1000 objects per call)
	var objectIds []types.ObjectIdentifier
	for _, obj := range listOutput.Contents {
		objectIds = append(objectIds, types.ObjectIdentifier{
			Key: obj.Key,
		})
	}

	_, err = j.s3Client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
		Bucket: aws.String(j.s3Bucket),
		Delete: &types.Delete{
			Objects: objectIds,
		},
	})
	if err != nil {
		return fmt.Errorf("failed to delete S3 objects: %w", err)
	}

	log.Printf("Job %s: Deleted %d S3 objects for group %s", j.Name(), len(objectIds), groupID)
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

	// List objects with the group's prefix
	listOutput, err := j.s3Client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
		Bucket: aws.String(j.s3Bucket),
		Prefix: aws.String(prefix),
	})
	if err != nil {
		return fmt.Errorf("failed to list S3 objects: %w", err)
	}

	if len(listOutput.Contents) == 0 {
		// No objects to delete (common case - not all reservations have uploaded avatars)
		return nil
	}

	// Build delete request
	var objectIds []types.ObjectIdentifier
	for _, obj := range listOutput.Contents {
		objectIds = append(objectIds, types.ObjectIdentifier{
			Key: obj.Key,
		})
	}

	_, err = j.s3Client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
		Bucket: aws.String(j.s3Bucket),
		Delete: &types.Delete{
			Objects: objectIds,
		},
	})
	if err != nil {
		return fmt.Errorf("failed to delete S3 objects: %w", err)
	}

	log.Printf("Job %s: Deleted %d orphaned S3 objects for reservation %s", j.Name(), len(objectIds), groupID)
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
