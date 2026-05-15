-- Contest improvements (3.3.5):
-- 1. clients.telegram_unreachable — авто-флаг для тех, у кого бот заблокирован.
-- 2. contests.prize_balance_currency, participants_snapshot_json — для согласованности
--    призов и возможности отмены розыгрыша.
-- 3. contests.status дополняется значением 'drawing' (не enum, а text — никаких миграций).
-- 4. contest_events — аудит-лог.

-- AlterTable
ALTER TABLE "clients"
  ADD COLUMN "telegram_unreachable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "contests"
  ADD COLUMN "prize_balance_currency" VARCHAR(8),
  ADD COLUMN "participants_snapshot_json" TEXT;

-- CreateTable
CREATE TABLE "contest_events" (
    "id" TEXT NOT NULL,
    "contest_id" TEXT NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "actor_id" VARCHAR(120),
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contest_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contest_events_contest_id_created_at_idx" ON "contest_events"("contest_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "contest_events"
  ADD CONSTRAINT "contest_events_contest_id_fkey"
  FOREIGN KEY ("contest_id") REFERENCES "contests"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
