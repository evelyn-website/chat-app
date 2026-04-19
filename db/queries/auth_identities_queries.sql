-- name: GetAuthIdentity :one
SELECT *
FROM auth_identities
WHERE provider = $1 AND subject = $2;

-- name: GetAuthIdentityByID :one
SELECT *
FROM auth_identities
WHERE id = $1;

-- name: GetAuthIdentitiesForUser :many
SELECT *
FROM auth_identities
WHERE user_id = $1
ORDER BY created_at ASC;

-- name: InsertAuthIdentity :one
-- ON CONFLICT guard protects against two concurrent /auth/apple calls for the
-- same new identity. The losing caller gets RETURNING from the winner's row.
INSERT INTO auth_identities (
    user_id,
    provider,
    subject,
    email,
    email_verified
) VALUES (
    $1, $2, $3, $4, $5
)
ON CONFLICT (provider, subject) DO UPDATE SET
    last_used_at = NOW()
RETURNING *;

-- name: UpdateAuthIdentityLastUsed :exec
UPDATE auth_identities
SET last_used_at = NOW()
WHERE id = $1;

-- name: UpdateAuthIdentityEmail :exec
-- Email is informational metadata; refresh it opportunistically when the
-- provider hands us a new value on a subsequent sign-in.
UPDATE auth_identities
SET email = $2,
    email_verified = $3
WHERE id = $1;

-- name: SetAppleRefreshTokenEncrypted :exec
UPDATE auth_identities
SET apple_refresh_token_encrypted = $2
WHERE id = $1;

-- name: GetAppleRefreshTokenEncrypted :one
SELECT apple_refresh_token_encrypted
FROM auth_identities
WHERE id = $1;

-- name: DeleteAuthIdentity :one
DELETE FROM auth_identities
WHERE id = $1
RETURNING *;

-- name: CountAuthIdentitiesForUser :one
SELECT COUNT(*)::bigint AS count
FROM auth_identities
WHERE user_id = $1;
