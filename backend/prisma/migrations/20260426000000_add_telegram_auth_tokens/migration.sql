-- CreateTable
CREATE TABLE "telegram_auth_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "confirmed_telegram_id" TEXT,
    "confirmed_username" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_auth_tokens_token_key" ON "telegram_auth_tokens"("token");

-- CreateIndex
CREATE INDEX "telegram_auth_tokens_token_idx" ON "telegram_auth_tokens"("token");

-- CreateIndex
CREATE INDEX "telegram_auth_tokens_expires_at_idx" ON "telegram_auth_tokens"("expires_at");
