-- name: InsertInvite :one
INSERT INTO invites (code, group_id, created_by, expires_at, max_uses)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetInviteByCode :one
SELECT * FROM invites WHERE code = $1;

-- name: IncrementInviteUseCount :exec
UPDATE invites SET use_count = use_count + 1 WHERE id = $1;

-- name: DeleteInvite :exec
DELETE FROM invites WHERE id = $1;

-- name: GetInvitesByGroup :many
SELECT * FROM invites WHERE group_id = $1 ORDER BY created_at DESC;

-- name: GetGroupPreviewByID :one
SELECT
    g.id,
    g.name,
    g.description,
    g.image_url,
    g.blurhash,
    g.start_time,
    g.end_time,
    (SELECT COUNT(*) FROM user_groups ug WHERE ug.group_id = g.id AND ug.deleted_at IS NULL)::int AS member_count
FROM groups g
WHERE g.id = $1 AND g.deleted_at IS NULL;
