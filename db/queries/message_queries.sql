-- name: InsertMessage :one
INSERT INTO messages (
    id,
    user_id,
    group_id,
    ciphertext,
    message_type,
    msg_nonce,
    key_envelopes
) VALUES (
    $1, $2, $3, $4, $5, $6, $7
) RETURNING id, user_id, group_id, created_at, updated_at, ciphertext, message_type, msg_nonce, key_envelopes;

-- name: GetMessageById :one
SELECT
    id,
    user_id,
    group_id,
    created_at,
    updated_at,
    ciphertext,
    message_type,
    msg_nonce,
    key_envelopes
FROM messages
WHERE id = $1;

-- name: GetMessagesForGroup :many
SELECT
    m.id,
    m.user_id,
    u.username,
    m.group_id,
    m.created_at,
    m.updated_at,
    m.ciphertext,
    m.message_type,
    m.msg_nonce,
    m.key_envelopes
FROM messages m
JOIN users u ON m.user_id = u.id
WHERE m.group_id = $1;

-- name: GetRelevantMessages :many
SELECT
    m.id,
    m.group_id,
    m.user_id AS sender_id,
    m.created_at AS "timestamp",
    m.ciphertext,
    m.message_type,
    m.msg_nonce,
    m.key_envelopes
FROM messages m
JOIN user_groups ug ON ug.group_id = m.group_id
JOIN users u_member ON ug.user_id = u_member.id 
JOIN users u_sender ON m.user_id = u_sender.id
JOIN groups g ON m.group_id = g.id
WHERE u_member.id = $1
AND m.created_at > ug.created_at
AND ug.deleted_at IS NULL
AND g.deleted_at IS NULL
;

-- name: DeleteMessage :one
-- Deletes a message by its ID.
-- Returns the deleted message's core fields (E2EE fields might be large to return).
DELETE FROM messages
WHERE id = $1
RETURNING id, user_id, group_id, created_at;

-- name: GetAllMessages :many
-- Retrieves all messages. Use with caution on large datasets.
-- Primarily for admin or debugging.
SELECT
    id,
    user_id,
    group_id,
    created_at,
    updated_at,
    ciphertext,
    message_type,
    msg_nonce,
    key_envelopes
FROM messages
ORDER BY created_at DESC;

