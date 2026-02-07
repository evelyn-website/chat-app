-- Add push token columns to existing device_keys table
ALTER TABLE device_keys
ADD COLUMN expo_push_token TEXT,
ADD COLUMN notifications_enabled BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX idx_device_keys_push_token ON device_keys(expo_push_token)
WHERE expo_push_token IS NOT NULL;

-- Table to track pending receipts for token validation
CREATE TABLE push_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id TEXT NOT NULL UNIQUE,
    push_token TEXT NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_push_receipts_created_at ON push_receipts(created_at);
