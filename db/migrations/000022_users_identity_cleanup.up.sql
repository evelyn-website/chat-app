-- Demote email to informational metadata; lift NOT NULL so Apple private-relay
-- or "email hidden on subsequent sign-in" cases don't violate the schema.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

-- Birthday was captured by the email+password signup form. SIWA does not
-- surface a birthday, so new OIDC users will not have one. Keep the column
-- for legacy rows but allow NULL.
ALTER TABLE users ALTER COLUMN birthday DROP NOT NULL;

-- Capture SIWA-provided name components. Apple only returns these on the
-- first sign-in per identity, so we persist whatever the client sends.
ALTER TABLE users
    ADD COLUMN full_name   TEXT,
    ADD COLUMN given_name  TEXT,
    ADD COLUMN family_name TEXT,
    ADD COLUMN username_set BOOLEAN NOT NULL DEFAULT FALSE;

-- Drop the old email uniqueness constraint. Email is no longer authoritative.
DROP INDEX IF EXISTS unique_email_idx;

-- Username becomes a first-class unique handle once the user has picked one.
-- Partial index so the placeholder usernames assigned during the brief
-- window between SIWA and the pick-username screen don't collide.
CREATE UNIQUE INDEX users_username_lower_idx
    ON users (LOWER(username))
    WHERE username_set = TRUE;
