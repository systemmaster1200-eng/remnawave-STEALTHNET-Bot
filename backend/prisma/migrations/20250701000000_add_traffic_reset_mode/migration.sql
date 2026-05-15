-- AlterTable: добавляем режим сброса трафика в тарифы
ALTER TABLE "tariffs" ADD COLUMN "traffic_reset_mode" TEXT NOT NULL DEFAULT 'no_reset';
