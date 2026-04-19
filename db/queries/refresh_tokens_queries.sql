-- name: InsertRefreshToken :one
INSERT INTO refresh_tokens (
    user_id,
    device_identifier,
    token_hash,
    expires_at,
    user_agent
) VALUES (
    $1, $2, $3, $4, $5
)
RETURNING *;

-- name: GetRefreshTokenByHash :one
SELECT *
FROM refresh_tokens
WHERE token_hash = $1;

-- name: GetRefreshTokenByID :one
SELECT *
FROM refresh_tokens
WHERE id = $1;

-- name: RotateRefreshToken :exec
-- Marks the old row revoked and links it to the newly-issued replacement.
-- Callers must run this inside the same tx that inserts the new row so a
-- failure rolls back both.
UPDATE refresh_tokens
SET revoked_at = NOW(),
    replaced_by = $2,
    last_used_at = NOW()
WHERE id = $1;

-- name: RevokeRefreshToken :exec
UPDATE refresh_tokens
SET revoked_at = NOW()
WHERE id = $1
  AND revoked_at IS NULL;

-- name: RevokeRefreshTokenFamily :exec
-- Theft response: walk the replaced_by chain both directions from the offending
-- row and revoke every row in the family. Two separate recursive CTEs — one
-- traces forward through replaced_by pointers, the other traces backward to
-- rows that pointed at anything in the family. Postgres forbids a recursive
-- CTE referencing itself twice in one UNION, so splitting is necessary.
WITH RECURSIVE forward AS (
    SELECT rt.id AS token_id, rt.replaced_by
    FROM refresh_tokens rt
    WHERE rt.id = $1

    UNION

    SELECT rt.id, rt.replaced_by
    FROM refresh_tokens rt
    JOIN forward f ON rt.id = f.replaced_by
),
backward AS (
    SELECT rt.id AS token_id, rt.replaced_by
    FROM refresh_tokens rt
    WHERE rt.id = $1

    UNION

    SELECT rt.id, rt.replaced_by
    FROM refresh_tokens rt
    JOIN backward b ON rt.replaced_by = b.token_id
)
UPDATE refresh_tokens
SET revoked_at = COALESCE(revoked_at, NOW())
WHERE id IN (SELECT token_id FROM forward)
   OR id IN (SELECT token_id FROM backward);

-- name: RevokeAllRefreshTokensForUser :exec
UPDATE refresh_tokens
SET revoked_at = NOW()
WHERE user_id = $1
  AND revoked_at IS NULL;

-- name: RevokeOtherRefreshTokensForUser :many
-- Revokes every active refresh token for this user except those on the
-- specified device_identifier. Returns the device_identifiers that were
-- revoked so the caller can NULL out push tokens for those devices.
UPDATE refresh_tokens
SET revoked_at = NOW()
WHERE user_id = $1
  AND device_identifier != $2
  AND revoked_at IS NULL
RETURNING device_identifier;

-- name: GetActiveRefreshTokensForUser :many
SELECT *
FROM refresh_tokens
WHERE user_id = $1
  AND revoked_at IS NULL
  AND expires_at > NOW()
ORDER BY created_at DESC;

-- name: DeleteStaleRefreshTokens :exec
-- 30-day retention window after expiry/revocation for forensic tail on theft
-- incidents. Tune later.
DELETE FROM refresh_tokens
WHERE expires_at < NOW() - INTERVAL '30 days'
   OR revoked_at < NOW() - INTERVAL '30 days';
