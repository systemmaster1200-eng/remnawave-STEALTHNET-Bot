/**
 * No-op shim после удаления multi-bot/clone-bots в v5.0.0.
 *
 * `optionalBot` оставлен как настоящий express-middleware (используется через
 * `publicConfigRouter.use(optionalBot)`), но теперь только кладёт null в req.bot
 * и сразу вызывает next() — никаких DB-запросов больше нет.
 */

import type { Request, Response, NextFunction } from "express";
import type { StubBot } from "./bot.service.js";
import { getBotByToken, getPrimaryBot } from "./bot.service.js";

export type ReqWithBot = Request & { bot?: StubBot | null };

export function extractBotTokenFromRequest(req: Request): string {
  const h = req.headers["x-telegram-bot-token"];
  return typeof h === "string" ? h.trim() : "";
}

/** Helper (не middleware): получить bot объект явно для запроса. */
export async function resolveBotForRequest(req: Request): Promise<StubBot> {
  const token = extractBotTokenFromRequest(req);
  if (token) {
    const b = await getBotByToken(token);
    if (b) return b;
  }
  return getPrimaryBot();
}

/**
 * Express middleware: кладёт `req.bot` (либо primary stub если есть валидный токен,
 * либо null) и продолжает цепочку через next().
 */
export function optionalBot(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBotTokenFromRequest(req);
  if (!token) {
    (req as ReqWithBot).bot = null;
    next();
    return;
  }
  getBotByToken(token)
    .then((bot) => {
      (req as ReqWithBot).bot = bot;
      next();
    })
    .catch(() => {
      (req as ReqWithBot).bot = null;
      next();
    });
}

/** Алиас для совместимости со старым кодом, который импортировал resolveBot. */
export const resolveBot = resolveBotForRequest;
