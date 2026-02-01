-- name: GetAllGroups :many
SELECT "id", "name", "description", "location", "image_url", "blurhash", "start_time", "end_time", "created_at", "updated_at" FROM groups;

-- name: GetGroupById :one
SELECT "id", "name", "description", "location", "image_url", "blurhash", "start_time", "end_time", "created_at", "updated_at" FROM groups WHERE id = $1;

-- name: GetGroupsForUser :many
SELECT groups.id, groups.name, groups."description", groups."location", groups."image_url", groups."blurhash", groups.start_time, groups.end_time, groups.created_at, ug.admin, groups.updated_at,
json_agg(jsonb_build_object('id', u2.id, 'username', u2.username, 'email', u2.email, 'admin', ug2.admin, 'invited_at', ug2.created_at)) AS group_users 
FROM groups
JOIN user_groups ug ON ug.group_id = groups.id
JOIN users u ON u.id = ug.user_id
JOIN user_groups ug2 ON ug2.group_id = groups.id
JOIN users u2 ON u2.id = ug2.user_id
WHERE u.id = $1
GROUP BY groups.id, ug.id, u.id;

-- name: GetGroupWithUsersByID :one
SELECT
    g.id,
    g.name,
    g."description",
    g.location,
    g.image_url,
    g.blurhash,
    g.start_time,
    g.end_time,
    g.created_at,
    g.updated_at,
    (SELECT ug_check.admin FROM user_groups ug_check WHERE ug_check.group_id = g.id AND ug_check.user_id = sqlc.arg('requesting_user_id')) AS admin, -- Admin status of the requesting user for THIS group
    COALESCE(
        (SELECT json_agg(jsonb_build_object('id', u.id, 'username', u.username, 'email', u.email, 'admin', ug.admin, 'invited_at', ug.created_at))
         FROM users u
         JOIN user_groups ug ON u.id = ug.user_id
         WHERE ug.group_id = g.id),
        '[]'::json
    )::json AS group_users
FROM
    groups g
WHERE
    g.id = sqlc.arg('group_id');

-- name: InsertGroup :one
INSERT INTO groups ("id", "name", "start_time", "end_time", "description", "location", "image_url", "blurhash") VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *; 

-- name: UpdateGroup :one
UPDATE groups
SET
    "name" = coalesce(sqlc.narg('name'), "name"),
    "start_time" = coalesce(sqlc.narg('start_time'), "start_time"),
    "end_time" = coalesce(sqlc.narg('end_time'), "end_time"),
    "description" = coalesce(sqlc.narg('description'), "description"),
    "location" = coalesce(sqlc.narg('location'), "location"),
    "image_url" = coalesce(sqlc.narg('image_url'), "image_url"),
    "blurhash" = coalesce(sqlc.narg('blurhash'), "blurhash")
WHERE id = $1
RETURNING "id", "name", "start_time", "end_time", "description", "location", "image_url", "blurhash", "created_at", "updated_at";

-- name: DeleteGroup :one
DELETE FROM groups
WHERE id = $1 RETURNING "id", "name", "created_at", "updated_at";