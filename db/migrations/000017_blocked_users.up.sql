CREATE TABLE blocked_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT different_users CHECK (blocker_id != blocked_id)
);
CREATE UNIQUE INDEX unique_block ON blocked_users (blocker_id, blocked_id);
CREATE INDEX idx_blocked_users_blocked_id ON blocked_users (blocked_id);
CREATE INDEX idx_blocked_users_blocker_id ON blocked_users (blocker_id);
