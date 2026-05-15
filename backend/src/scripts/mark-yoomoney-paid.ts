/**
 * Разово отметить платёж ЮMoney (yoomoney_form) как оплаченный и начислить баланс клиенту.
 * Использование: npx tsx src/scripts/mark-yoomoney-paid.ts <paymentId>
 * Пример: npx tsx src/scripts/mark-yoomoney-paid.ts 651fcdc7-bb47-4c52-9fb6-877a790eb516
 */

import "dotenv/config";
import { prisma } from "../db.js";

const paymentId = process.argv[2]?.trim();
if (!paymentId) {
  console.error("Usage: npx tsx src/scripts/mark-yoomoney-paid.ts <paymentId>");
  process.exit(1);
}

async function main() {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, clientId: true, amount: true, status: true, provider: true },
  });
  if (!payment) {
    console.error("Payment not found:", paymentId);
    process.exit(1);
  }
  if (payment.provider !== "yoomoney_form") {
    console.error("Payment is not yoomoney_form:", payment.provider);
    process.exit(1);
  }
  if (payment.status === "PAID") {
    console.log("Payment already PAID, nothing to do.");
    process.exit(0);
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.payment.update({
      where: { id: paymentId },
      data: { status: "PAID", paidAt: now },
    }),
    prisma.client.update({
      where: { id: payment.clientId },
      data: { balance: { increment: payment.amount } },
    }),
  ]);

  const client = await prisma.client.findUnique({
    where: { id: payment.clientId },
    select: { email: true, balance: true },
  });
  console.log("OK: payment", paymentId, "marked PAID, balance credited", payment.amount, "RUB");
  if (client) console.log("Client", client.email, "new balance:", client.balance);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
