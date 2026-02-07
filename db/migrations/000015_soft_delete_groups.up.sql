ALTER TABLE groups ADD COLUMN deleted_at TIMESTAMP;
ALTER TABLE user_groups ADD COLUMN deleted_at TIMESTAMP;
ALTER TABLE user_groups DROP CONSTRAINT unique_user_group;
CREATE UNIQUE INDEX unique_active_user_group ON user_groups (user_id, group_id) WHERE deleted_at IS NULL;
