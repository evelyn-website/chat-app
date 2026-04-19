CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_identifier TEXT NOT NULL,
    -- SHA-256 of the opaque token bytes. We never store the plaintext.
    token_hash BYTEA NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMP NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMP,
    -- Non-NULL when this row has been rotated. (revoked_at IS NOT NULL AND
    -- replaced_by IS NOT NULL) on a presented token indicates theft — the
    -- token was already consumed once, the thief is presenting a copy.
    replaced_by UUID REFERENCES refresh_tokens(id) ON DELETE SET NULL,
    user_agent TEXT
);

CREATE INDEX idx_refresh_tokens_user_device
    ON refresh_tokens(user_id, device_identifier)
    WHERE revoked_at IS NULL;
