DROP INDEX IF EXISTS users_username_lower_idx;

ALTER TABLE users
    DROP COLUMN IF EXISTS username_set,
    DROP COLUMN IF EXISTS family_name,
    DROP COLUMN IF EXISTS given_name,
    DROP COLUMN IF EXISTS full_name;

-- These re-add NOT NULL and will fail if any rows violate the constraint.
-- Clean such rows before running the down migration.
ALTER TABLE users ALTER COLUMN birthday SET NOT NULL;
ALTER TABLE users ALTER COLUMN email SET NOT NULL;

CREATE UNIQUE INDEX unique_email_idx ON users (LOWER(email));
