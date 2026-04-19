-- name: GetAllUsers :many
SELECT "id", "username", "email", "created_at", "updated_at" FROM users;

-- name: GetUserById :one
SELECT "id", "username", "email", "created_at", "updated_at" FROM users WHERE id = $1;

-- name: GetUserByUsername :one
SELECT "id", "username", "email", "created_at", "updated_at" FROM users WHERE username = $1;

-- name: GetUserByEmail :one
SELECT "id", "username", "email", "created_at", "updated_at" FROM users WHERE LOWER(email) = LOWER($1);

-- name: GetAllUsersInGroup :many
SELECT users.id AS user_id, users.username, groups.id AS group_id, groups.name, user_groups.admin, user_groups.created_at AS joined_at
FROM users 
JOIN user_groups ON user_groups.user_id = users.id 
JOIN groups ON groups.id = user_groups.group_id
WHERE groups.id = $1;

-- name: GetUsersByEmails :many
SELECT id, username, email, created_at, updated_at FROM users WHERE email = ANY(sqlc.arg('emails')::text[]);

-- name: GetUsersByIDs :many
SELECT id, username, email, created_at, updated_at FROM users WHERE id = ANY(sqlc.arg('ids')::UUID[]);

-- name: GetAllUsersInternal :many
SELECT "id", "username", "email", "password", "created_at", "updated_at" FROM users;

-- name: GetUserByIdInternal :one
SELECT "id", "username", "email", "password", "created_at", "updated_at" FROM users WHERE id = $1;

-- name: GetUserByEmailInternal :one
SELECT "id", "username", "email", "password", "created_at", "updated_at" FROM users WHERE LOWER(email) = LOWER($1);

-- name: InsertUser :one
INSERT INTO users (username, email, password, birthday) VALUES ($1, $2, $3, $4) RETURNING "id", "username", "email", "created_at", "updated_at";

-- name: InsertUserOIDC :one
-- Creates a user row for an OIDC sign-in. `username` is a placeholder
-- (username_set=false). The user picks a real handle via POST /api/users/username
-- before being routed into the app.
INSERT INTO users (
    username,
    email,
    full_name,
    given_name,
    family_name,
    username_set
) VALUES (
    $1, $2, $3, $4, $5, FALSE
)
RETURNING id, username, email, full_name, given_name, family_name, username_set, created_at, updated_at;

-- name: SetUsername :one
-- Atomic username pick. The partial unique index on LOWER(username) WHERE
-- username_set=TRUE handles the race between two users claiming the same
-- handle concurrently — the loser gets a unique-violation error, which the
-- handler maps to 409.
UPDATE users
SET username = $2,
    username_set = TRUE,
    updated_at = NOW()
WHERE id = $1
RETURNING id, username, email, full_name, username_set, created_at, updated_at;

-- name: GetUserIdentityFields :one
-- Used by /whoami to hydrate the client with name + username_set after a
-- cold launch or refresh.
SELECT id, username, email, full_name, given_name, family_name, username_set, created_at, updated_at
FROM users
WHERE id = $1;

-- name: UpdateUser :one
UPDATE users 
SET
    "username" = coalesce(sqlc.narg('username'), "username"),
    "email" = coalesce(sqlc.narg('email'), "email")
WHERE id = sqlc.arg('id')
RETURNING "id", "username", "email", "created_at", "updated_at";

-- name: DeleteUser :one
DELETE FROM users
WHERE id = $1 RETURNING "id", "username", "email", "created_at", "updated_at";

-- name: GetRelevantUsers :many
WITH s AS (
    SELECT g.id FROM groups g
    JOIN user_groups ug ON ug.group_id = g.id
    WHERE ug.user_id = $1
)
SELECT u.id, u.username, u.email, u.created_at, jsonb_object_agg(ug.group_id, ug.admin)::text AS group_admin_map FROM users u 
JOIN user_groups ug ON ug.user_id = u.id
JOIN s ON s.id = group_id
GROUP BY u.id;

-- name: GetRelevantUserDeviceKeys :many
WITH user_target_groups AS (
    SELECT ug.group_id
    FROM user_groups ug
    WHERE ug.user_id = $1
),
relevant_users AS (
    SELECT DISTINCT ug.user_id
    FROM user_groups ug
    JOIN user_target_groups utg ON ug.group_id = utg.group_id
    UNION
    -- Always include the requesting user so a fresh user with no groups
    -- still gets their own device keys (needed to encrypt to themselves
    -- when they create their first group).
    SELECT $1::uuid
)
SELECT
    ru.user_id,
    jsonb_agg(
        jsonb_build_object(
            'device_identifier', dk.device_identifier,
            'public_key', encode(dk.public_key, 'base64'),
            'signing_public_key', encode(dk.signing_public_key, 'base64')
        ) ORDER BY dk.created_at DESC
    ) AS device_keys
FROM
    relevant_users ru
JOIN
    device_keys dk ON ru.user_id = dk.user_id
GROUP BY
    ru.user_id
HAVING
    count(dk.id) > 0; 
