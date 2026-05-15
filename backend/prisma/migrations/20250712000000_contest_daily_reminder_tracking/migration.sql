-- Track last daily reminder + button config for contest notifications
ALTER TABLE "contests" ADD COLUMN "last_daily_reminder_at" TIMESTAMP(3);
ALTER TABLE "contests" ADD COLUMN "button_text" TEXT;
ALTER TABLE "contests" ADD COLUMN "button_url" TEXT;
