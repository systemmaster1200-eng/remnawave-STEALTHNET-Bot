/**
 * Публичные эндпоинты лендинга — отдают только видимые опубликованные блоки.
 */

import express, { Router } from "express";
import { listBlocksForRender, getThemeForRender } from "./landing.service.js";

function asyncRoute(
  fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>,
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export const landingPublicRouter = Router();

landingPublicRouter.get(
  "/landing",
  asyncRoute(async (req, res) => {
    const langRaw = String(req.query.lang ?? "ru").toLowerCase();
    const lang = langRaw === "en" ? "en" : "ru";
    const [blocks, theme] = await Promise.all([listBlocksForRender(lang), getThemeForRender()]);
    return res.json({ blocks, theme, lang });
  }),
);
