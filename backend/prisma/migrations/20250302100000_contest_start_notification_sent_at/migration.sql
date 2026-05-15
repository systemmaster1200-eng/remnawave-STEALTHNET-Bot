-- AlterTable
ALTER TABLE "contests" ADD COLUMN IF NOT EXISTS "start_notification_sent_at" TIMESTAMP(3);
