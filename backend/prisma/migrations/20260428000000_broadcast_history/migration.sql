-- CreateTable
CREATE TABLE "broadcast_history" (
    "id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "channel" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL,
    "button_text" TEXT,
    "button_url" TEXT,
    "attachment_name" TEXT,
    "total_telegram" INTEGER NOT NULL DEFAULT 0,
    "sent_telegram" INTEGER NOT NULL DEFAULT 0,
    "failed_telegram" INTEGER NOT NULL DEFAULT 0,
    "total_email" INTEGER NOT NULL DEFAULT 0,
    "sent_email" INTEGER NOT NULL DEFAULT 0,
    "failed_email" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "error" TEXT,
    "started_by_admin" TEXT,

    CONSTRAINT "broadcast_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "broadcast_history_started_at_idx" ON "broadcast_history"("started_at" DESC);

-- CreateIndex
CREATE INDEX "broadcast_history_status_idx" ON "broadcast_history"("status");
