-- Gift System v2 Migration
-- Migrates secondary subscriptions from clients table to dedicated secondary_subscriptions table
-- Adds gift_history table for audit logging
-- Updates gift_codes FK from secondary_client_id to secondary_subscription_id
--
-- This migration is designed to run via `psql` (not prisma migrate)
-- After running, execute `npx prisma db push` to sync schema state
--
-- Total affected rows: ~9 secondary clients, ~4 gift codes

BEGIN;

-- ============================================================
-- 1. Create secondary_subscriptions table
-- ============================================================
CREATE TABLE IF NOT EXISTS "secondary_subscriptions" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "remnawave_uuid" TEXT,
    "subscription_index" INTEGER NOT NULL,
    "tariff_id" TEXT,
    "gift_status" TEXT,
    "gifted_to_client_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "secondary_subscriptions_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: one index per owner
CREATE UNIQUE INDEX IF NOT EXISTS "secondary_subscriptions_owner_id_subscription_index_key"
    ON "secondary_subscriptions"("owner_id", "subscription_index");

-- Indexes
CREATE INDEX IF NOT EXISTS "secondary_subscriptions_owner_id_idx"
    ON "secondary_subscriptions"("owner_id");
CREATE INDEX IF NOT EXISTS "secondary_subscriptions_remnawave_uuid_idx"
    ON "secondary_subscriptions"("remnawave_uuid");
CREATE INDEX IF NOT EXISTS "secondary_subscriptions_gift_status_idx"
    ON "secondary_subscriptions"("gift_status");

-- Foreign keys
ALTER TABLE "secondary_subscriptions"
    ADD CONSTRAINT "secondary_subscriptions_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "clients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "secondary_subscriptions"
    ADD CONSTRAINT "secondary_subscriptions_gifted_to_client_id_fkey"
    FOREIGN KEY ("gifted_to_client_id") REFERENCES "clients"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "secondary_subscriptions"
    ADD CONSTRAINT "secondary_subscriptions_tariff_id_fkey"
    FOREIGN KEY ("tariff_id") REFERENCES "tariffs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 2. Create gift_history table
-- ============================================================
CREATE TABLE IF NOT EXISTS "gift_history" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "secondary_subscription_id" TEXT,
    "event_type" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "gift_history_client_id_idx"
    ON "gift_history"("client_id");
CREATE INDEX IF NOT EXISTS "gift_history_secondary_subscription_id_idx"
    ON "gift_history"("secondary_subscription_id");
CREATE INDEX IF NOT EXISTS "gift_history_created_at_idx"
    ON "gift_history"("created_at");

ALTER TABLE "gift_history"
    ADD CONSTRAINT "gift_history_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- 3. Migrate data: clients -> secondary_subscriptions
-- ============================================================
INSERT INTO "secondary_subscriptions" ("id", "owner_id", "remnawave_uuid", "subscription_index", "tariff_id", "gift_status", "gifted_to_client_id", "created_at", "updated_at")
SELECT
    c."id",
    c."parent_client_id",
    c."remnawave_uuid",
    c."subscription_index",
    NULL,  -- tariff_id was not stored on secondary clients
    c."gift_status",
    NULL,  -- gifted_to_client_id will be set by gift code redemption logic
    c."created_at",
    c."updated_at"
FROM "clients" c
WHERE c."parent_client_id" IS NOT NULL;

-- For REDEEMED gift codes, set gifted_to_client_id on the secondary subscription
-- The redeemed_by_id on GiftCode tells us who received the subscription
UPDATE "secondary_subscriptions" ss
SET "gifted_to_client_id" = gc."redeemed_by_id"
FROM "gift_codes" gc
WHERE gc."secondary_client_id" = ss."id"
  AND gc."status" = 'REDEEMED'
  AND gc."redeemed_by_id" IS NOT NULL;

-- ============================================================
-- 4. Update gift_codes: rename FK column, add new columns
-- ============================================================

-- Add new columns
ALTER TABLE "gift_codes" ADD COLUMN IF NOT EXISTS "gift_message" TEXT;
ALTER TABLE "gift_codes" ADD COLUMN IF NOT EXISTS "expiry_notified_at" TIMESTAMP(3);

-- Rename FK column: secondary_client_id -> secondary_subscription_id
ALTER TABLE "gift_codes" RENAME COLUMN "secondary_client_id" TO "secondary_subscription_id";

-- Drop old FK constraint if it exists (may not exist if created via db push)
ALTER TABLE "gift_codes" DROP CONSTRAINT IF EXISTS "gift_codes_secondary_client_id_fkey";

-- Drop old index
DROP INDEX IF EXISTS "gift_codes_secondary_client_id_idx";

-- Create new index with correct name
CREATE INDEX IF NOT EXISTS "gift_codes_secondary_subscription_id_idx"
    ON "gift_codes"("secondary_subscription_id");

-- Add new FK constraint pointing to secondary_subscriptions
ALTER TABLE "gift_codes"
    ADD CONSTRAINT "gift_codes_secondary_subscription_id_fkey"
    FOREIGN KEY ("secondary_subscription_id") REFERENCES "secondary_subscriptions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- 5. Delete old secondary client records from clients table
-- ============================================================
-- These are now in secondary_subscriptions with the SAME ids
-- Must delete AFTER gift_codes FK is updated (otherwise cascade would delete codes)
DELETE FROM "clients" WHERE "parent_client_id" IS NOT NULL;

-- ============================================================
-- 6. Drop old columns from clients table
-- ============================================================
-- Drop indexes first
DROP INDEX IF EXISTS "clients_parent_client_id_idx";
DROP INDEX IF EXISTS "clients_parent_client_id_subscription_index_key";

-- Drop FK constraint if exists
ALTER TABLE "clients" DROP CONSTRAINT IF EXISTS "clients_parent_client_id_fkey";

-- Drop columns
ALTER TABLE "clients" DROP COLUMN IF EXISTS "parent_client_id";
ALTER TABLE "clients" DROP COLUMN IF EXISTS "subscription_index";
ALTER TABLE "clients" DROP COLUMN IF EXISTS "gift_status";

COMMIT;
