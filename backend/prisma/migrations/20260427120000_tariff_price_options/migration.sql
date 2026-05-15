-- Опции цен в тарифе: вместо одной фиксированной (price + durationDays)
-- теперь у тарифа может быть несколько вариантов длительности с разной ценой.
-- Существующие тарифы мигрируют в одну дефолтную опцию.

CREATE TABLE "tariff_price_options" (
  "id" TEXT NOT NULL,
  "tariff_id" TEXT NOT NULL,
  "duration_days" INTEGER NOT NULL,
  "price" DOUBLE PRECISION NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tariff_price_options_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "tariff_price_options" ADD CONSTRAINT "tariff_price_options_tariff_id_fkey"
  FOREIGN KEY ("tariff_id") REFERENCES "tariffs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "tariff_price_options_tariff_id_idx" ON "tariff_price_options"("tariff_id");
CREATE INDEX "tariff_price_options_sort_order_idx" ON "tariff_price_options"("sort_order");

-- Backfill: для каждого существующего тарифа создаём одну опцию из текущих
-- значений price и durationDays. Используем cuid-подобный id (gen_random_uuid быстрее).
INSERT INTO "tariff_price_options" ("id", "tariff_id", "duration_days", "price", "sort_order", "created_at", "updated_at")
SELECT
  'opt_' || substr(md5(random()::text || clock_timestamp()::text), 1, 22),
  "id",
  "duration_days",
  "price",
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "tariffs";

-- Source-of-truth: ставка $/день при последней покупке тарифа.
-- Используется при пересчёте остатка дней при смене тарифа (защита от abuse-стека).
ALTER TABLE "clients" ADD COLUMN "current_price_per_day" DOUBLE PRECISION;

-- Связь платежа с конкретной выбранной опцией (если null — старый платёж до миграции).
ALTER TABLE "payments" ADD COLUMN "tariff_price_option_id" TEXT;
ALTER TABLE "payments" ADD CONSTRAINT "payments_tariff_price_option_id_fkey"
  FOREIGN KEY ("tariff_price_option_id") REFERENCES "tariff_price_options"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "payments_tariff_price_option_id_idx" ON "payments"("tariff_price_option_id");
