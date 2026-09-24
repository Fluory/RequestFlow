-- #60: Supabase reserves the schema `auth` for its own Auth service, so the Better Auth tables live in
-- `identity` (the module's name). Migrations 0001–0017 create `identity` directly on a fresh database,
-- so they never touch a platform-owned `auth` schema. Databases migrated before #60 still have OUR
-- schema `auth`: it is renamed here – only when it belongs to the migrating role and `identity` does not
-- exist yet. Renaming keeps tables, data, foreign keys, indexes, grants and default privileges.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth' AND pg_get_userbyid(nspowner) = current_user)
     AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'identity') THEN
    ALTER SCHEMA "auth" RENAME TO "identity";
  END IF;
END $$;
