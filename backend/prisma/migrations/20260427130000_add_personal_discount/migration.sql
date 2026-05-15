-- Добавляем персональную скидку (в процентах) клиенту.
-- NULL или 0 означает "скидки нет". Ограничение 0–100 валидируем на уровне API (Zod).
ALTER TABLE "clients" ADD COLUMN "personal_discount_percent" DOUBLE PRECISION;
