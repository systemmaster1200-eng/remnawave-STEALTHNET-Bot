-- Контекст автопродления: какую опцию длительности и сколько доп. устройств продлевать.
-- Без этих полей крон списывал тариф по legacy `Tariff.price` (минимум) без extras.
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "auto_renew_price_option_id" TEXT;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "auto_renew_extra_devices" INTEGER NOT NULL DEFAULT 0;
