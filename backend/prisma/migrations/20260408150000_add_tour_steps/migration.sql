-- CreateTable
CREATE TABLE "tour_steps" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "target_label" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "video_url" TEXT,
    "placement" TEXT NOT NULL DEFAULT 'bottom',
    "mascot_id" TEXT NOT NULL DEFAULT 'girl-1',
    "mood" TEXT NOT NULL DEFAULT 'point',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tour_steps_pkey" PRIMARY KEY ("id")
);
