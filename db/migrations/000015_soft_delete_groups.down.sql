DROP INDEX IF EXISTS unique_active_user_group;
DELETE FROM user_groups WHERE deleted_at IS NOT NULL;
ALTER TABLE user_groups ADD CONSTRAINT unique_user_group UNIQUE (user_id, group_id);
ALTER TABLE user_groups DROP COLUMN deleted_at;
ALTER TABLE groups DROP COLUMN deleted_at;
