-- Runs once via docker-entrypoint-initdb.d against a fresh Postgres data directory.
-- Enables the extensions the target architecture depends on (PRODUCT.md):
--   pg_trgm   — trigram text search (item search by name/tags)
--   uuid-ossp — UUID generation (item/location QR tokens)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
