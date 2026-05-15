-- Configurable per-contest reminder schedule (issue #35)
-- Adds: enable/disable flag, custom interval in hours, deadline-relative reminders.

ALTER TABLE "contests"
  ADD COLUMN "reminder_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "reminder_interval_hours" INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN "reminder_deadline_hours_before" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "reminder_deadline_sent_json" TEXT;
