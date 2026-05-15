import { prisma } from "../../db.js";

/**
 * Сверка snapshot `Payment.bot_id` с текущим `Client.bot_id`.
 * Расхождение возможно при редком «переезде» клиента между клонами после создания PENDING-платежа;
 * обработку вебхука не блокируем — только аудит в лог.
 */
export async function auditPaymentClientBotAlignment(payment: {
  id: string;
  clientId: string;
  botId: string | null;
}): Promise<void> {
  if (payment.botId == null) return;
  const client = await prisma.client.findUnique({
    where: { id: payment.clientId },
    select: { botId: true },
  });
  if (!client) {
    console.warn("[payment-webhook-audit] client missing for payment", {
      paymentId: payment.id,
      clientId: payment.clientId,
    });
    return;
  }
  if (client.botId !== payment.botId) {
    console.warn("[payment-webhook-audit] payment.botId !== client.botId (webhook processing continues)", {
      paymentId: payment.id,
      clientId: payment.clientId,
      paymentBotId: payment.botId,
      clientBotId: client.botId,
    });
  }
}
