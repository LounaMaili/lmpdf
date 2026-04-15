-- Phase 1: identity source tracking for users
CREATE TYPE "AuthSource" AS ENUM ('local', 'ldap');

ALTER TABLE "User"
  ADD COLUMN "authSource" "AuthSource" NOT NULL DEFAULT 'local',
  ADD COLUMN "externalId" TEXT,
  ADD COLUMN "externalDn" TEXT;
