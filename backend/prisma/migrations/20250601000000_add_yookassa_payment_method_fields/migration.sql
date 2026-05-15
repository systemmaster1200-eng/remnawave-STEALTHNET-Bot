-- AlterTable
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "yookassa_payment_method_id" TEXT;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "yookassa_payment_method_title" TEXT;
