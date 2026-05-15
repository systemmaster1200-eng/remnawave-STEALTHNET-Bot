/**
 * Middleware для авторизации входящих запросов от Telegram-бота.
 *
 * Заменяет старую схему «X-Telegram-Bot-Token === systemSettings.telegram_bot_token»
 * на «X-Telegram-Bot-Token принадлежит активному Bot из таблицы bots».
 *
 * После успешной проверки в req.bot оказывается полная Bot-запись —
 * далее любой роут может использовать `req.bot.id` как фильтр для prisma-запросов
 * и `req.bot.markupPercent` для расчёта цены.
 */

import type { Request, Response, NextFunction } from "express";
import type { Bot } from "@prisma/client";
import { getBotByToken } from "./bot.service.js";

export interface ReqWithBot {
  bot: Bot;
}

/** Извлекает токен из заголовка X-Telegram-Bot-Token. Регистр заголовка нормализуется Express'ом. */
export function extractBotTokenFromRequest(req: Request): string {
  const h = req.headers["x-telegram-bot-token"];
  if (typeof h === "string") return h.trim();
  return "";
}

/**
 * Express-middleware: проверяет токен, кладёт активного Bot в req.bot.
 * При неудаче — 401. Используется для роутов, доступных ИЗ бот-процесса
 * (например, /api/bot-admin/*, /api/public/link-telegram-from-bot, /api/internal/bots).
 */
export async function resolveBot(req: Request, res: Response, next: NextFunction) {
  const token = extractBotTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ message: "Unauthorized: missing X-Telegram-Bot-Token header" });
  }
  const bot = await getBotByToken(token);
  if (!bot) {
    return res.status(401).json({ message: "Unauthorized: bot token not recognized or bot inactive" });
  }
  (req as Request & ReqWithBot).bot = bot;
  next();
}

/**
 * Опциональный аналог: если токен есть и валидный — кладёт req.bot, иначе пропускает дальше.
 * Используется в публичных роутах, которые должны работать и без бота
 * (например, getPublicConfig из веб-кабинета).
 */
export async function optionalBot(req: Request, _res: Response, next: NextFunction) {
  const token = extractBotTokenFromRequest(req);
  if (!token) return next();
  const bot = await getBotByToken(token);
  if (bot) {
    (req as Request & Partial<ReqWithBot>).bot = bot;
  }
  next();
}
