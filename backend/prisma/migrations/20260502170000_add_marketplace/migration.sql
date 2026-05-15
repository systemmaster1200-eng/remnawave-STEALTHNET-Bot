-- Marketplace: каталог листингов между инсталляциями (модели MarketplaceCategory,
-- MarketplaceInstallation, MarketplaceListing, MarketplaceReport).
--
-- В 3.3.3 эти модели появились в schema.prisma, но миграции не было — таблицы
-- создавались только через `db push` или drift-фолбэк entrypoint'а на P3005.
-- Эта миграция оформляет их «по-нормальному», чтобы migrate deploy катил всё
-- сам на любой БД, где раньше схема была в sync через drift.
--
-- Идемпотентна: все CREATE / ALTER обёрнуты в IF NOT EXISTS / DO-блок,
-- чтобы можно было записать как applied на серверах, где marketplace-таблицы
-- уже созданы вручную через diff.

-- ─── Таблицы ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "marketplace_installations" (
    "id" TEXT NOT NULL,
    "api_key_hash" TEXT NOT NULL,
    "api_key_prefix" VARCHAR(16) NOT NULL,
    "domain" TEXT NOT NULL,
    "display_name" VARCHAR(200),
    "contact_username" VARCHAR(64) NOT NULL,
    "contact_telegram_id" VARCHAR(32),
    "logo_url" VARCHAR(2000),
    "description" TEXT,
    "is_banned" BOOLEAN NOT NULL DEFAULT false,
    "ban_reason" TEXT,
    "total_listings" INTEGER NOT NULL DEFAULT 0,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_ip" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_installations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "marketplace_categories" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "label_ru" VARCHAR(120) NOT NULL,
    "label_en" VARCHAR(120) NOT NULL,
    "icon" VARCHAR(64),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "marketplace_listings" (
    "id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "price_unit" VARCHAR(20) NOT NULL DEFAULT 'one_time',
    "country" VARCHAR(8),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cover_image_url" VARCHAR(2000),
    "gallery_json" TEXT,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "views" INTEGER NOT NULL DEFAULT 0,
    "reports_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_listings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "marketplace_reports" (
    "id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "reporter_installation_id" TEXT NOT NULL,
    "reason" VARCHAR(64) NOT NULL,
    "comment" TEXT,
    "status" VARCHAR(16) NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "marketplace_reports_pkey" PRIMARY KEY ("id")
);

-- ─── Индексы ────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_installations_api_key_hash_key"
  ON "marketplace_installations"("api_key_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_installations_domain_key"
  ON "marketplace_installations"("domain");
CREATE INDEX IF NOT EXISTS "marketplace_installations_is_banned_idx"
  ON "marketplace_installations"("is_banned");
CREATE INDEX IF NOT EXISTS "marketplace_installations_last_seen_at_idx"
  ON "marketplace_installations"("last_seen_at");

CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_categories_slug_key"
  ON "marketplace_categories"("slug");

CREATE INDEX IF NOT EXISTS "marketplace_listings_category_id_status_created_at_idx"
  ON "marketplace_listings"("category_id", "status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "marketplace_listings_installation_id_idx"
  ON "marketplace_listings"("installation_id");
CREATE INDEX IF NOT EXISTS "marketplace_listings_status_created_at_idx"
  ON "marketplace_listings"("status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "marketplace_reports_status_idx"
  ON "marketplace_reports"("status");
CREATE INDEX IF NOT EXISTS "marketplace_reports_listing_id_idx"
  ON "marketplace_reports"("listing_id");
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_reports_listing_id_reporter_installation_id_key"
  ON "marketplace_reports"("listing_id", "reporter_installation_id");

-- ─── Foreign keys (идемпотентно через DO/EXCEPTION) ─────────────────────────

DO $$ BEGIN
  ALTER TABLE "marketplace_listings"
    ADD CONSTRAINT "marketplace_listings_installation_id_fkey"
    FOREIGN KEY ("installation_id") REFERENCES "marketplace_installations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "marketplace_listings"
    ADD CONSTRAINT "marketplace_listings_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "marketplace_categories"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "marketplace_reports"
    ADD CONSTRAINT "marketplace_reports_listing_id_fkey"
    FOREIGN KEY ("listing_id") REFERENCES "marketplace_listings"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "marketplace_reports"
    ADD CONSTRAINT "marketplace_reports_reporter_installation_id_fkey"
    FOREIGN KEY ("reporter_installation_id") REFERENCES "marketplace_installations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
