DROP TABLE IF EXISTS push_receipts;

DROP INDEX IF EXISTS idx_device_keys_push_token;

ALTER TABLE device_keys
DROP COLUMN IF EXISTS expo_push_token,
DROP COLUMN IF EXISTS notifications_enabled;
