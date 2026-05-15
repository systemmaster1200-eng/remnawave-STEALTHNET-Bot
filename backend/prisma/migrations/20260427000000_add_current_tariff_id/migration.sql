-- Source-of-truth для отображения текущего активного тарифа клиента.
-- Обновляется при каждой успешной активации тарифа (через activateTariffForClient).
-- Используется в /api/client/subscription приоритетно перед resolveTariffDisplayName,
-- чтобы избежать неверного определения тарифа из activeInternalSquads (когда есть add-on squads).

ALTER TABLE "clients" ADD COLUMN "current_tariff_id" TEXT;

ALTER TABLE "clients" ADD CONSTRAINT "clients_current_tariff_id_fkey"
  FOREIGN KEY ("current_tariff_id") REFERENCES "tariffs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "clients_current_tariff_id_idx" ON "clients"("current_tariff_id");
