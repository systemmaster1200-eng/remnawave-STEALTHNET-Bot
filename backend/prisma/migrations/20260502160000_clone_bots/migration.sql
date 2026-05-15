-- Боты-клоны: «1:1 копия» основного бота с разной наценкой.
--
-- Изменения:
--   1) Новые таблицы:    bots, bot_payouts
--   2) clients.bot_id    добавляется (nullable → backfill → NOT NULL)
--   3) clients:          @unique(telegram_id) → @@unique([bot_id, telegram_id])
--   4) payments:         + bot_id, base_amount, bot_markup_percent, bot_markup_amount
--   5) Backfill:         primary bot создаётся из system_settings.telegram_bot_token
--                        (или с пустым токеном — заполнится позже из BOT_TOKEN env'а),
--                        все существующие clients/payments получают bot_id = primary.
--
-- Миграция идемпотентна: при повторном запуске не дублирует primary bot.

-- ─── 1. Таблица bots ────────────────────────────────────────────────────────
CREATE TABLE "bots" (
  "id"                TEXT NOT NULL,
  "token"             TEXT NOT NULL,
  "username"          TEXT,
  "markup_percent"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "owner_telegram_id" TEXT,
  "owner_name"        TEXT,
  "is_active"         BOOLEAN NOT NULL DEFAULT true,
  "is_primary"        BOOLEAN NOT NULL DEFAULT false,
  "notes"             TEXT,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bots_token_key" ON "bots"("token");
CREATE INDEX "bots_is_active_idx" ON "bots"("is_active");

-- ─── 2. Таблица bot_payouts ─────────────────────────────────────────────────
CREATE TABLE "bot_payouts" (
  "id"         TEXT NOT NULL,
  "bot_id"     TEXT NOT NULL,
  "amount"     DOUBLE PRECISION NOT NULL,
  "currency"   TEXT NOT NULL DEFAULT 'rub',
  "comment"    TEXT,
  "paid_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bot_payouts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bot_payouts_bot_id_idx" ON "bot_payouts"("bot_id");
CREATE INDEX "bot_payouts_paid_at_idx" ON "bot_payouts"("paid_at");

ALTER TABLE "bot_payouts" ADD CONSTRAINT "bot_payouts_bot_id_fkey"
  FOREIGN KEY ("bot_id") REFERENCES "bots"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 3. Создаём primary bot из existing telegram_bot_token ─────────────────
--
-- Берём токен из system_settings, если он там есть. Если токена нет (свежая
-- инсталляция без настроек), создаётся placeholder с пустым токеном —
-- бот не активен, его обновит ensureSystemSettings() из env.BOT_TOKEN.
DO $$
DECLARE
  v_bot_id    TEXT := 'bot_' || substr(md5(random()::text || clock_timestamp()::text), 1, 22);
  v_token     TEXT;
  v_is_active BOOLEAN;
BEGIN
  SELECT COALESCE(NULLIF(TRIM(value), ''), '') INTO v_token
  FROM "system_settings"
  WHERE key = 'telegram_bot_token';

  IF v_token IS NULL THEN
    v_token := '';
  END IF;

  -- Активен только если токен непустой.
  v_is_active := (v_token <> '');

  -- Если токен пустой, кладём placeholder-маркер чтобы не упереться в UNIQUE.
  IF v_token = '' THEN
    v_token := 'placeholder_' || v_bot_id;
  END IF;

  -- Идемпотентность: если primary bot уже есть — ничего не делаем.
  IF NOT EXISTS (SELECT 1 FROM "bots" WHERE is_primary = true) THEN
    INSERT INTO "bots" ("id", "token", "markup_percent", "is_active", "is_primary", "owner_name", "notes")
    VALUES (
      v_bot_id,
      v_token,
      0,
      v_is_active,
      true,
      'Основной (платформа)',
      'Создан автоматически миграцией clone_bots. Токен взят из system_settings.telegram_bot_token. Если placeholder_* — настройте токен через админку «Боты».'
    );
  END IF;
END $$;

-- ─── 4. Добавляем bot_id в clients (nullable → backfill → NOT NULL) ─────────
ALTER TABLE "clients" ADD COLUMN "bot_id" TEXT;

UPDATE "clients"
   SET "bot_id" = (SELECT id FROM "bots" WHERE is_primary = true LIMIT 1)
 WHERE "bot_id" IS NULL;

ALTER TABLE "clients" ALTER COLUMN "bot_id" SET NOT NULL;

ALTER TABLE "clients" ADD CONSTRAINT "clients_bot_id_fkey"
  FOREIGN KEY ("bot_id") REFERENCES "bots"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "clients_bot_id_idx" ON "clients"("bot_id");

-- ─── 5. clients: @unique(telegram_id) → @@unique([bot_id, telegram_id]) ─────
--
-- Старый @unique через колонку: индекс называется "clients_telegram_id_key".
-- Снимаем его и заменяем на составной UNIQUE.
DROP INDEX IF EXISTS "clients_telegram_id_key";

CREATE UNIQUE INDEX "clients_bot_id_telegram_id_unique"
  ON "clients"("bot_id", "telegram_id")
  WHERE "telegram_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "clients_telegram_id_idx" ON "clients"("telegram_id");

-- ─── 5b. telegram_auth_tokens: confirmed_bot_id для deep-link авторизации ──
ALTER TABLE "telegram_auth_tokens" ADD COLUMN "confirmed_bot_id" TEXT;

-- ─── 6. Добавляем поля в payments ──────────────────────────────────────────
ALTER TABLE "payments"
  ADD COLUMN "bot_id"             TEXT,
  ADD COLUMN "base_amount"        DOUBLE PRECISION,
  ADD COLUMN "bot_markup_percent" DOUBLE PRECISION,
  ADD COLUMN "bot_markup_amount"  DOUBLE PRECISION;

-- Backfill: для legacy-Payment берём bot_id из связанного клиента,
-- baseAmount = amount (наценки не было), markup = 0/0.
UPDATE "payments" p
   SET "bot_id"             = c.bot_id,
       "base_amount"        = p.amount,
       "bot_markup_percent" = 0,
       "bot_markup_amount"  = 0
  FROM "clients" c
 WHERE p.client_id = c.id;

-- Подстраховка: если по какой-то причине осталась запись с NULL bot_id — primary.
UPDATE "payments"
   SET "bot_id" = (SELECT id FROM "bots" WHERE is_primary = true LIMIT 1)
 WHERE "bot_id" IS NULL;

ALTER TABLE "payments" ADD CONSTRAINT "payments_bot_id_fkey"
  FOREIGN KEY ("bot_id") REFERENCES "bots"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "payments_bot_id_idx" ON "payments"("bot_id");
