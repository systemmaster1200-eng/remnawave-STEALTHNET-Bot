-- Новая модель устройств: тариф включает `included_devices` устройств в базовой цене,
-- клиент может докупить до `max_extra_devices` дополнительных по `price_per_extra_device` за штуку.
-- Старая колонка `max_devices` переименовывается в `max_extra_devices` (семантика меняется:
-- теперь это «макс. ДОП. устройств», а не «макс. всего»).

-- 1) Новые колонки
ALTER TABLE "tariffs" ADD COLUMN IF NOT EXISTS "included_devices" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "tariffs" ADD COLUMN IF NOT EXISTS "price_per_extra_device" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- 2) Переименование max_devices → max_extra_devices
-- Если колонка max_devices существует — переименовываем; если не существует, создаём max_extra_devices.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tariffs' AND column_name = 'max_devices')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tariffs' AND column_name = 'max_extra_devices') THEN
    ALTER TABLE "tariffs" RENAME COLUMN "max_devices" TO "max_extra_devices";
  ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tariffs' AND column_name = 'max_extra_devices') THEN
    ALTER TABLE "tariffs" ADD COLUMN "max_extra_devices" INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

-- 3) Бэкфилл: для существующих тарифов сбрасываем maxExtra на 0 (доп. устройств нет, пока админ не настроит).
-- Старый maxDevices подразумевал «всего», поэтому семантически его вычитать нельзя — лучше обнулить.
UPDATE "tariffs" SET "max_extra_devices" = 0 WHERE "max_extra_devices" > 0 AND "price_per_extra_device" = 0;

-- 4) Если был device_limit — переносим его в included_devices как сколько устройств в комплекте.
UPDATE "tariffs" SET "included_devices" = COALESCE("device_limit", 1) WHERE "included_devices" = 1 AND "device_limit" IS NOT NULL AND "device_limit" > 0;
