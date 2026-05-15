import { prisma } from "../../db.js";

/**
 * Сохранить «сырую» ссылку платёжки в Payment.metadata.redirectTargetUrl и вернуть
 * наш redirect-URL (`https://<app>/api/pay/<orderId>`), который выдаётся пользователю.
 *
 * Если `publicAppUrl` пуст — fallback к «сырой» ссылке (старое поведение).
 */
export async function saveRedirectAndBuildUrl(
  paymentId: string,
  orderId: string,
  providerUrl: string,
  publicAppUrl: string | null | undefined,
): Promise<string> {
  const row = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { metadata: true },
  });

  let meta: Record<string, unknown> = {};
  if (row?.metadata) {
    try {
      const parsed = JSON.parse(row.metadata);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        meta = parsed as Record<string, unknown>;
      }
    } catch {
      // keep meta = {}
    }
  }
  meta.redirectTargetUrl = providerUrl;

  await prisma.payment.update({
    where: { id: paymentId },
    data: { metadata: JSON.stringify(meta) },
  });

  const cleanApp = publicAppUrl?.trim().replace(/\/$/, "");
  if (!cleanApp) return providerUrl;
  return `${cleanApp}/api/pay/${orderId}`;
}
