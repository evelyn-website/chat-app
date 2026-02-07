-- name: GetAllUserGroups :many
SELECT "id", "user_id", "group_id", "admin", "created_at", "updated_at" FROM user_groups WHERE deleted_at IS NULL;

-- name: GetAllUserGroupsForUser :many
SELECT "id", "user_id", "group_id", "admin", "created_at", "updated_at" FROM user_groups WHERE user_id = $1 AND deleted_at IS NULL;

-- name: GetAllUserGroupsForGroup :many
SELECT "id", "user_id", "group_id", "admin", "created_at", "updated_at" FROM user_groups WHERE group_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC;

-- name: GetUserGroupByID :one
SELECT "id", "user_id", "group_id", "admin", "created_at", "updated_at" FROM user_groups WHERE id = $1 AND deleted_at IS NULL;

-- name: GetUserGroupByGroupIDAndUserID :one
SELECT "id", "user_id", "group_id", "admin", "created_at", "updated_at" FROM user_groups WHERE user_id = $1 AND group_id = $2 AND deleted_at IS NULL;

-- name: InsertUserGroup :one
INSERT INTO user_groups
    ("user_id", "group_id", "admin")
VALUES ($1, $2, $3)
ON CONFLICT (user_id, group_id) WHERE deleted_at IS NULL DO NOTHING
RETURNING *;

-- name: UpdateUserGroup :one
UPDATE user_groups
SET
    "admin" = $3
WHERE user_id = $1 AND group_id = $2 AND deleted_at IS NULL
RETURNING "id", "user_id", "group_id", "admin", "created_at", "updated_at";

-- name: DeleteUserGroup :one
UPDATE user_groups SET deleted_at = NOW()
WHERE user_id = $1 AND group_id = $2 AND deleted_at IS NULL
RETURNING "id", "user_id", "group_id", "admin", "created_at", "updated_at";
