-- Per-tariff Lava.top offer mapping.
-- Each tariff in admin can be linked to an offer in Lava.top dashboard
-- (https://app.lava.top → Products → ... → offer UUID). When client pays
-- via Lava.top, we use this offer ID. If null, falls back to
-- system_settings.lavatop_default_offer_id.
ALTER TABLE "tariffs" ADD COLUMN IF NOT EXISTS "lavatop_offer_id" TEXT;
