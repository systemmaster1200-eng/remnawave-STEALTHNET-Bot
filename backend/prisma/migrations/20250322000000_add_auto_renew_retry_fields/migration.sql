-- AlterTable
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "auto_renew_retry_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "auto_renew_notified_at" TIMESTAMP(3);
