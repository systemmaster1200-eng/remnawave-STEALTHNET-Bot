/**
 * Ручной seed первого админа (если нужно пересоздать).
 * При обычном запуске приложения админ создаётся автоматически в index.ts (ensureFirstAdmin).
 */

import "dotenv/config";
import { prisma } from "../db.js";
import { createAdmin } from "../modules/auth/auth.service.js";

const email = process.env.INIT_ADMIN_EMAIL ?? "admin@stealthnet.local";
const password = process.env.INIT_ADMIN_PASSWORD ?? "ChangeMe123!";

async function seed() {
  const existing = await prisma.admin.findUnique({ where: { email } });
  if (existing) {
    console.log("Admin already exists:", email);
    process.exit(0);
    return;
  }
  await createAdmin(email, password);
  console.log("Admin created:", email);
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
