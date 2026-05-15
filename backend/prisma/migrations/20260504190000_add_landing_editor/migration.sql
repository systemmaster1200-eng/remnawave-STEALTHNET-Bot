-- Landing Editor (3.3.4+): блочный редактор лендинга с draft-режимом и снапшотами.

-- CreateTable
CREATE TABLE "landing_blocks" (
    "id" TEXT NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "variant" VARCHAR(60) NOT NULL DEFAULT 'default',
    "order" INTEGER NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "props" JSONB NOT NULL DEFAULT '{}',
    "i18n" JSONB NOT NULL DEFAULT '{}',
    "props_draft" JSONB,
    "i18n_draft" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landing_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "landing_blocks_order_idx" ON "landing_blocks"("order");

-- CreateIndex
CREATE INDEX "landing_blocks_visible_order_idx" ON "landing_blocks"("visible", "order");

-- CreateTable
CREATE TABLE "landing_theme" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "primary_color" VARCHAR(20),
    "accent_color" VARCHAR(20),
    "background_color" VARCHAR(20),
    "text_color" VARCHAR(20),
    "font_family" VARCHAR(80),
    "font_presets" JSONB NOT NULL DEFAULT '[]',
    "border_radius" VARCHAR(20),
    "container_width" VARCHAR(20),
    "custom_css" TEXT,
    "draft" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landing_theme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landing_snapshots" (
    "id" TEXT NOT NULL,
    "label" VARCHAR(120),
    "data" JSONB NOT NULL,
    "created_by" VARCHAR(120),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "landing_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "landing_snapshots_created_at_idx" ON "landing_snapshots"("created_at" DESC);
