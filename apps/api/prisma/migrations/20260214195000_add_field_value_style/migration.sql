-- Add persisted value/style for template fields
ALTER TABLE "Field"
  ADD COLUMN "value" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "style" JSONB;
