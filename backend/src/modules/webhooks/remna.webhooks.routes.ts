/**
 * Вебхуки от Remna (RemnaWave) — события user.*, node.*, crm.* и т.д.
 * Спецификация в api-1.yaml: RemnawaveWebhookUserEventsDto, RemnawaveWebhookNodeEventsDto, ...
 */

import { Router } from "express";
import { z } from "zod";

const webhookBodySchema = z.object({
  scope: z.string(),
  event: z.string(),
  timestamp: z.string(),
  data: z.record(z.unknown()).optional(),
  meta: z.record(z.unknown()).optional(),
});

export const remnaWebhooksRouter = Router();

remnaWebhooksRouter.post("/remna", async (req, res) => {
  const parsed = webhookBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid webhook payload", errors: parsed.error.flatten() });
  }

  const { scope, event, timestamp, data } = parsed.data;

  // Логируем и позже можно сохранять в БД, слать уведомления и т.д.
  console.log("[Remna Webhook]", { scope, event, timestamp, dataKeys: data ? Object.keys(data) : [] });

  // Подтверждаем приём (Remna может ожидать 2xx)
  return res.status(200).json({ received: true, scope, event });
});
