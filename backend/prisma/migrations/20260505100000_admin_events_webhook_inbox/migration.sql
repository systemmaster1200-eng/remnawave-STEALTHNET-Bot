-- Admin audit log + Webhook inbox (3.3.5+).
--
-- admin_events  — универсальный аудит-лог действий админов.
-- webhook_events — все входящие webhook'и от платежных провайдеров для replay/diagnostics.

-- CreateTable
CREATE TABLE "admin_events" (
    "id" TEXT NOT NULL,
    "kind" VARCHAR(80) NOT NULL,
    "actor_id" VARCHAR(120),
    "actor_ip" VARCHAR(64),
    "target_type" VARCHAR(40),
    "target_id" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_events_created_at_idx" ON "admin_events"("created_at" DESC);

-- CreateIndex
CREATE INDEX "admin_events_actor_id_created_at_idx" ON "admin_events"("actor_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "admin_events_target_type_target_id_created_at_idx" ON "admin_events"("target_type", "target_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "admin_events_kind_created_at_idx" ON "admin_events"("kind", "created_at" DESC);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "raw_body" TEXT NOT NULL,
    "headers" JSONB NOT NULL,
    "remote_ip" VARCHAR(64),
    "response_status" INTEGER NOT NULL,
    "outcome" VARCHAR(40) NOT NULL,
    "error_message" TEXT,
    "payment_id" TEXT,
    "duration_ms" INTEGER,
    "replayed_by" VARCHAR(120),
    "replay_of_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_events_provider_created_at_idx" ON "webhook_events"("provider", "created_at" DESC);

-- CreateIndex
CREATE INDEX "webhook_events_payment_id_idx" ON "webhook_events"("payment_id");

-- CreateIndex
CREATE INDEX "webhook_events_outcome_created_at_idx" ON "webhook_events"("outcome", "created_at" DESC);

-- CreateIndex
CREATE INDEX "webhook_events_created_at_idx" ON "webhook_events"("created_at" DESC);
