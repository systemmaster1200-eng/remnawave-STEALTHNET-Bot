/**
 * Bot message editor — единый интерфейс для всех `bot_*` ключей в system_settings.
 *
 * Многие тексты бота уже редактируются в /admin/settings, но они разбросаны по
 * разным секциям. Этот endpoint собирает их в один список с группировкой и
 * метаданными (тип значения: text/json/markdown), и позволяет править через
 * единое API.
 *
 * Endpoints:
 *   GET  /api/admin/bot-messages/list           — все bot_* ключи
 *   GET  /api/admin/bot-messages/:key            — один ключ
 *   PUT  /api/admin/bot-messages/:key            — обновить значение
 */

import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import { logAdmin } from "../audit/audit.service.js";

function asyncRoute(fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

interface BotMessageMeta {
  key: string;
  group: string;
  label: string;
  description: string;
  valueType: "text" | "json" | "markdown" | "boolean" | "number";
  variables?: string[];
}

// редактор оставляет ТОЛЬКО текстовые блоки бота.
// Кнопки, JSON-настройки (иконки/стили/видимость), flags (boolean/number), Telegram-ID —
// убраны: они настраиваются в обычных секциях /admin/settings, а здесь должны быть
// только тексты экранов бота, которые видит юзер.
const META: BotMessageMeta[] = [
  { key: "bot_info_block", group: "Тексты экранов бота", label: "Инфо-блок (главное меню)", description: "Произвольный текст под главным меню. Markdown поддерживается.", valueType: "markdown" },
  { key: "bot_devices_text", group: "Тексты экранов бота", label: "Экран «📱 Мои устройства»", description: "Шапка экрана списка устройств. Появляется до перечня устройств по подпискам.", valueType: "markdown" },
  { key: "bot_tariffs_text", group: "Тексты экранов бота", label: "Экран «Выбор тарифа»", description: "{{TARIFFS}} = список тарифов", valueType: "markdown", variables: ["{{TARIFFS}}"] },
  { key: "bot_payment_text", group: "Тексты экранов бота", label: "Экран «Оплата»", description: "Сообщение при выборе тарифа для оплаты.", valueType: "markdown", variables: ["{{NAME}}", "{{PRICE}}", "{{ACTION}}"] },
  // подсказка для юзера при выдаче subscription URL.
  { key: "bot_instruction_fallback_text", group: "Тексты экранов бота", label: "Подсказка «Если инструкция не открылась»", description: "Показывается под ссылкой подписки и в карточке подписки — на случай если кнопка «📲 Инструкции» не открывает приложение.", valueType: "markdown" },
];

export const botMessagesRouter = Router();
botMessagesRouter.use(requireAuth);
botMessagesRouter.use(requireAdminSection);

botMessagesRouter.get(
  "/list",
  asyncRoute(async (_req, res) => {
    const stored = await prisma.systemSetting.findMany({
      where: { key: { in: META.map((m) => m.key) } },
    });
    const valueByKey = new Map(stored.map((s) => [s.key, s.value]));

    const items = META.map((m) => ({
      ...m,
      value: valueByKey.get(m.key) ?? "",
    }));

    return res.json({ items });
  }),
);

botMessagesRouter.get(
  "/:key",
  asyncRoute(async (req, res) => {
    const meta = META.find((m) => m.key === req.params.key);
    if (!meta) return res.status(404).json({ message: "Unknown key" });
    const stored = await prisma.systemSetting.findUnique({ where: { key: meta.key } });
    return res.json({ ...meta, value: stored?.value ?? "" });
  }),
);

const putSchema = z.object({
  value: z.string().max(50_000),
});

botMessagesRouter.put(
  "/:key",
  asyncRoute(async (req, res) => {
    const meta = META.find((m) => m.key === req.params.key);
    if (!meta) return res.status(404).json({ message: "Unknown key" });
    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });

    // Доп. валидация для JSON: проверяем что это валидный JSON
    if (meta.valueType === "json" && parsed.data.value.trim()) {
      try { JSON.parse(parsed.data.value); }
      catch { return res.status(400).json({ message: "Невалидный JSON" }); }
    }

    await prisma.systemSetting.upsert({
      where: { key: meta.key },
      create: { key: meta.key, value: parsed.data.value },
      update: { value: parsed.data.value },
    });

    await logAdmin(req, "bot_messages.update", { type: "system", id: meta.key }, {
      key: meta.key,
      length: parsed.data.value.length,
    });

    return res.json({ ok: true, key: meta.key, value: parsed.data.value });
  }),
);
