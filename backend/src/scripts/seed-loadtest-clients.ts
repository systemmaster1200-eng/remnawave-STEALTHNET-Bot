/**
 * Массовое создание тестовых клиентов для нагрузочного теста БД.
 *
 * Использование:
 *   LOADTEST_COUNT=30000 npx tsx src/scripts/seed-loadtest-clients.ts
 *   LOADTEST_COUNT=1000 npx tsx src/scripts/seed-loadtest-clients.ts   # быстрая проверка
 *
 * Удалить всех тестовых (email *@loadtest.local):
 *   npx tsx src/scripts/seed-loadtest-clients.ts --cleanup
 */

import "dotenv/config";
import { randomBytes, randomUUID } from "crypto";
import { prisma } from "../db.js";

const BATCH = 1000;
const EMAIL_DOMAIN = "loadtest.local";

async function main() {
  const cleanup = process.argv.includes("--cleanup");
  if (cleanup) {
    const deleted = await prisma.client.deleteMany({
      where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
    });
    console.log(`Удалено тестовых клиентов: ${deleted.count}`);
    process.exit(0);
    return;
  }

  const count = Math.min(
    Math.max(1, parseInt(process.env.LOADTEST_COUNT ?? "30000", 10) || 30000),
    500_000,
  );

  const runId = randomBytes(4).toString("hex");
  console.log(`Создание ${count} клиентов (runId=${runId}, батчи по ${BATCH})...`);

  let created = 0;
  const t0 = Date.now();

  for (let offset = 0; offset < count; offset += BATCH) {
    const slice = Math.min(BATCH, count - offset);
    const data = [];
    for (let i = 0; i < slice; i++) {
      const n = offset + i;
      data.push({
        id: randomUUID(),
        email: `lt-${runId}-${n}@${EMAIL_DOMAIN}`,
        telegramId: `lt${runId}${String(n).padStart(6, "0")}`,
        referralCode: `REFLT${runId}${String(n).padStart(6, "0")}`,
        preferredLang: "ru",
        preferredCurrency: "usd",
        trialUsed: false,
        balance: 0,
      });
    }
    const r = await prisma.client.createMany({ data });
    created += r.count;
    if (offset % (BATCH * 10) === 0 && offset > 0) {
      console.log(`  … ${created} / ${count}`);
    }
  }

  const ms = Date.now() - t0;
  console.log(`Готово: ${created} записей за ${(ms / 1000).toFixed(1)} с (${(created / (ms / 1000)).toFixed(0)} зап/с)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
