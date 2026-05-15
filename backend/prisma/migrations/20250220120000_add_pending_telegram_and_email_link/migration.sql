-- CreateTable
CREATE TABLE "pending_telegram_links" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_telegram_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_email_links" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "verification_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_email_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_telegram_links_code_key" ON "pending_telegram_links"("code");

-- CreateIndex
CREATE INDEX "pending_telegram_links_code_idx" ON "pending_telegram_links"("code");

-- CreateIndex
CREATE INDEX "pending_telegram_links_expires_at_idx" ON "pending_telegram_links"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "pending_email_links_verification_token_key" ON "pending_email_links"("verification_token");

-- CreateIndex
CREATE INDEX "pending_email_links_verification_token_idx" ON "pending_email_links"("verification_token");

-- CreateIndex
CREATE INDEX "pending_email_links_expires_at_idx" ON "pending_email_links"("expires_at");
