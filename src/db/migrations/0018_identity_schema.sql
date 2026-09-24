-- #60: Supabase reserves the schema `auth` for its own Auth service, so the Better Auth tables move to
-- `identity` (the module's name). Renaming keeps tables, data, foreign keys (they point to the same
-- relations), indexes, grants and default privileges – the drop/re-add of foreign keys the generator
-- proposed is not needed and would only re-validate every row.
ALTER SCHEMA "auth" RENAME TO "identity";
