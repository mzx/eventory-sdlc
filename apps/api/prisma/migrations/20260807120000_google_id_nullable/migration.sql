-- EVT-20: `googleId` becomes nullable so a row can exist (e.g. a manually
-- seeded/dev fixture, or an operator bootstrap placeholder) without ever
-- having signed in via Google. Such a row must not count towards the
-- first-user auto-promotion check in AuthService.upsertFromGoogleProfile.
-- The existing unique index is unaffected — Postgres unique indexes permit
-- multiple NULLs.
ALTER TABLE "User" ALTER COLUMN "googleId" DROP NOT NULL;
