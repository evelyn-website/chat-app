-- Cleanup Expired Groups Queries

-- name: GetExpiredGroups :many
-- Returns groups that have passed their end_time
SELECT id, name, end_time
FROM groups
WHERE end_time < NOW()
ORDER BY end_time ASC
LIMIT $1;

-- name: DeleteMessagesForGroup :exec
-- Deletes all messages for a specific group
DELETE FROM messages
WHERE group_id = $1;

-- name: DeleteUserGroupsForGroup :exec
-- Deletes all user_groups relationships for a specific group
DELETE FROM user_groups
WHERE group_id = $1;


-- Cleanup Stale Reservations Queries

-- name: GetStaleGroupReservations :many
-- Returns group reservations older than specified interval
SELECT group_id, user_id, created_at
FROM group_reservations
WHERE created_at < NOW() - INTERVAL '24 hours'
ORDER BY created_at ASC;


-- Cleanup Stale Device Keys Queries

-- name: GetStaleDeviceKeys :many
-- Returns device keys that haven't been seen in 90+ days
SELECT user_id, device_identifier, last_seen_at
FROM device_keys
WHERE last_seen_at < NOW() - INTERVAL '90 days'
ORDER BY last_seen_at ASC;

-- name: UserHasActiveGroups :one
-- Checks if user is in any groups that haven't expired yet
SELECT EXISTS (
    SELECT 1
    FROM user_groups ug
    JOIN groups g ON ug.group_id = g.id
    WHERE ug.user_id = $1
      AND g.end_time > NOW()
) AS has_active_groups;
