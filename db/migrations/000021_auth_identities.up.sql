CREATE TABLE auth_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('apple', 'google')),
    subject TEXT NOT NULL,
    email TEXT,
    email_verified BOOLEAN,
    apple_refresh_token_encrypted BYTEA,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (provider, subject)
);

CREATE INDEX idx_auth_identities_user_id ON auth_identities(user_id);

COMMENT ON COLUMN auth_identities.subject IS 'Provider-scoped opaque subject (Apple/Google sub claim)';
COMMENT ON COLUMN auth_identities.email IS 'Informational only; may be Apple private relay, may change, never used as lookup key';
COMMENT ON COLUMN auth_identities.apple_refresh_token_encrypted IS 'AES-GCM ciphertext (nonce||ct||tag). Only populated for provider = apple.';
