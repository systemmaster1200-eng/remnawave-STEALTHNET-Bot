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

const META: BotMessageMeta[] = [
  // меню
  { key: "bot_menu_texts", group: "Меню и приветствие", label: "Заголовки меню (JSON)", description: "Объект с ключами welcomeTitlePrefix, balancePrefix и т.п.", valueType: "json" },
  { key: "bot_back_label", group: "Меню и приветствие", label: "Кнопка «Назад»", description: "Текст кнопки возврата", valueType: "text" },
  { key: "bot_buttons", group: "Меню и приветствие", label: "Тексты кнопок (JSON)", description: "Текст и emoji всех кнопок главного меню", valueType: "json" },
  { key: "bot_emojis", group: "Меню и приветствие", label: "Иконки разделов (JSON)", description: "Emoji-префиксы для разделов меню", valueType: "json" },
  { key: "bot_info_block", group: "Меню и приветствие", label: "Инфо-блок", description: "Произвольный текст под главным меню", valueType: "markdown" },

  // тарифы и оплата
  { key: "bot_tariffs_text", group: "Тарифы и оплата", label: "Текст «Выбор тарифа»", description: "{{TARIFFS}} = список тарифов", valueType: "markdown", variables: ["{{TARIFFS}}"] },
  { key: "bot_tariffs_fields", group: "Тарифы и оплата", label: "Поля тарифа в списке (JSON)", description: "Какие поля тарифа показывать (price, duration, devices…)", valueType: "json" },
  { key: "bot_payment_text", group: "Тарифы и оплата", label: "Текст «Оплата»", description: "Сообщение при выборе тарифа для оплаты", valueType: "markdown", variables: ["{{NAME}}", "{{PRICE}}", "{{ACTION}}"] },

  // вёрстка/UI
  { key: "bot_buttons_per_row", group: "UI", label: "Кнопок в ряду", description: "Сколько inline-кнопок в одной строке", valueType: "number" },
  { key: "bot_inner_button_styles", group: "UI", label: "Стили inline-кнопок (JSON)", description: "Префиксы и стили внутренних кнопок", valueType: "json" },
  { key: "bot_menu_line_visibility", group: "UI", label: "Видимость пунктов меню (JSON)", description: "Какие пункты меню показывать", valueType: "json" },

  // прочее
  { key: "bot_admin_telegram_ids", group: "Прочее", label: "Telegram ID администраторов", description: "Через запятую — кто получает админ-нотификации", valueType: "text" },
  { key: "bot_auto_delete_unknown_messages", group: "Прочее", label: "Авто-удалять неизвестные сообщения", description: "Удалять любые сообщения от пользователя, не вписывающиеся в команду", valueType: "boolean" },
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
