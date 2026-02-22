ALTER TABLE messages
DROP COLUMN IF EXISTS signature,
DROP COLUMN IF EXISTS sender_device_identifier;

ALTER TABLE device_keys
DROP COLUMN IF EXISTS signing_public_key;
