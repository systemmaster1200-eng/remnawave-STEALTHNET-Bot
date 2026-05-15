-- CreateTable
CREATE TABLE "contests" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "prize1_type" TEXT NOT NULL,
    "prize1_value" TEXT NOT NULL,
    "prize2_type" TEXT NOT NULL,
    "prize2_value" TEXT NOT NULL,
    "prize3_type" TEXT NOT NULL,
    "prize3_value" TEXT NOT NULL,
    "conditions_json" TEXT,
    "draw_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "daily_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_winners" (
    "id" TEXT NOT NULL,
    "contest_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "place" INTEGER NOT NULL,
    "prize_type" TEXT NOT NULL,
    "prize_value" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contest_winners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contest_winners_contest_id_place_key" ON "contest_winners"("contest_id", "place");

-- CreateIndex
CREATE INDEX "contest_winners_contest_id_idx" ON "contest_winners"("contest_id");

-- AddForeignKey
ALTER TABLE "contest_winners" ADD CONSTRAINT "contest_winners_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_winners" ADD CONSTRAINT "contest_winners_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
