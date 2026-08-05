-- EVT-1 scaffold: no domain models yet (see PRODUCT.md for the target schema,
-- added by later backlog tasks). This migration exists so `prisma migrate deploy`
-- has a migration history to apply on container start (AC5: no manual step).
--
-- Extensions are primarily enabled by db/init/01-extensions.sql (docker-entrypoint-initdb.d),
-- which only runs once against a fresh data directory. We also enable them here,
-- idempotently, as defense in depth for environments where the init script didn't run
-- (e.g. a pre-existing data volume).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
