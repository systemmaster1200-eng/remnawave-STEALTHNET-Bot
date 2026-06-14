/**
 * No-op после удаления multi-bot в v5.0.0 — раньше сверял Payment.bot_id и Client.bot_id.
 * Сохранена сигнатура чтобы потребители (вебхуки платёжных провайдеров) компилировались.
 */
export async function auditPaymentClientBotAlignment(_payment: {
  id: string;
  clientId: string;
}): Promise<void> {
  return;
}
