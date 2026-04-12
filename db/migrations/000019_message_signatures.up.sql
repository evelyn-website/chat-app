ALTER TABLE device_keys
ADD COLUMN signing_public_key BYTEA NOT NULL;

COMMENT ON COLUMN device_keys.signing_public_key IS 'Ed25519 public key bytes for message signature verification';

ALTER TABLE messages
ADD COLUMN sender_device_identifier TEXT,
ADD COLUMN signature BYTEA;

COMMENT ON COLUMN messages.sender_device_identifier IS 'Device identifier that signed the message payload';
COMMENT ON COLUMN messages.signature IS 'Ed25519 detached signature over canonical message payload';
