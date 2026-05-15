-- CreateTable
CREATE TABLE "tour_mascots" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "image_url" VARCHAR(500) NOT NULL,
    "is_built_in" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tour_mascots_pkey" PRIMARY KEY ("id")
);

-- AlterTable: video_url VARCHAR(1000)
ALTER TABLE "tour_steps" ALTER COLUMN "video_url" TYPE VARCHAR(1000);

-- AlterTable: mascot_id nullable + drop default
ALTER TABLE "tour_steps" ALTER COLUMN "mascot_id" DROP NOT NULL;
ALTER TABLE "tour_steps" ALTER COLUMN "mascot_id" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "tour_steps" ADD CONSTRAINT "tour_steps_mascot_id_fkey" FOREIGN KEY ("mascot_id") REFERENCES "tour_mascots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed built-in mascots
INSERT INTO "tour_mascots" ("id", "name", "image_url", "is_built_in", "created_at") VALUES
  ('builtin-girl-1', 'Мика', '/api/uploads/mascots/builtin-girl-1.png', true, NOW()),
  ('builtin-girl-2', 'Рин', '/api/uploads/mascots/builtin-girl-2.png', true, NOW());

-- Migrate existing tour_steps: set mascot_id to null (old SVG mascots no longer valid)
UPDATE "tour_steps" SET "mascot_id" = NULL WHERE "mascot_id" IS NOT NULL;
