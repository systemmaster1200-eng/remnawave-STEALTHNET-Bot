-- Tariff: maxDevices + deviceDiscountTiers
ALTER TABLE "tariffs" ADD COLUMN "max_devices" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "tariffs" ADD COLUMN "device_discount_tiers" JSONB;

-- Backfill: maxDevices не меньше старого фиксированного device_limit (если он был задан и > 5).
UPDATE "tariffs" SET "max_devices" = GREATEST(COALESCE("device_limit", 1), 5);

-- Payment: device_count для аудита
ALTER TABLE "payments" ADD COLUMN "device_count" INTEGER;
