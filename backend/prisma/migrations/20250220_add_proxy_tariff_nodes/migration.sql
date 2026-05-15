-- CreateTable
CREATE TABLE "proxy_tariff_nodes" (
    "id" TEXT NOT NULL,
    "tariff_id" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,

    CONSTRAINT "proxy_tariff_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "proxy_tariff_nodes_tariff_id_node_id_key" ON "proxy_tariff_nodes"("tariff_id", "node_id");

-- CreateIndex
CREATE INDEX "proxy_tariff_nodes_tariff_id_idx" ON "proxy_tariff_nodes"("tariff_id");

-- CreateIndex
CREATE INDEX "proxy_tariff_nodes_node_id_idx" ON "proxy_tariff_nodes"("node_id");

-- AddForeignKey
ALTER TABLE "proxy_tariff_nodes" ADD CONSTRAINT "proxy_tariff_nodes_tariff_id_fkey" FOREIGN KEY ("tariff_id") REFERENCES "proxy_tariffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proxy_tariff_nodes" ADD CONSTRAINT "proxy_tariff_nodes_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "proxy_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
