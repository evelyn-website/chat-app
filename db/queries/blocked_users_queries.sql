-- name: BlockUser :one
INSERT INTO blocked_users (blocker_id, blocked_id)
VALUES ($1, $2)
ON CONFLICT (blocker_id, blocked_id) DO NOTHING
RETURNING *;

-- name: UnblockUser :exec
DELETE FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2;

-- name: GetBlockedUsers :many
SELECT u.id, u.username, u.email, u.created_at, u.updated_at, bu.created_at AS blocked_at
FROM blocked_users bu
JOIN users u ON u.id = bu.blocked_id
WHERE bu.blocker_id = $1
ORDER BY bu.created_at DESC;

-- name: CheckBlockExists :one
SELECT EXISTS(
    SELECT 1 FROM blocked_users
    WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)
) AS is_blocked;

-- name: GetSharedGroupIDs :many
SELECT ug1.group_id FROM user_groups ug1
JOIN user_groups ug2 ON ug1.group_id = ug2.group_id
WHERE ug1.user_id = $1 AND ug2.user_id = $2
  AND ug1.deleted_at IS NULL AND ug2.deleted_at IS NULL;

-- name: CheckBlockConflictWithGroup :one
SELECT EXISTS(
    SELECT 1 FROM user_groups ug
    JOIN blocked_users bu ON
        (bu.blocker_id = ug.user_id AND bu.blocked_id = $1)
        OR (bu.blocker_id = $1 AND bu.blocked_id = ug.user_id)
    WHERE ug.group_id = $2 AND ug.deleted_at IS NULL
) AS has_conflict;
