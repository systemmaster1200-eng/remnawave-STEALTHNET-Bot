/**
 * Middleware на стороне хаба: ищет инсталляцию по `X-Marketplace-Key` и
 * проверяет, что она не забанена. Кладёт installation в `req.installation`.
 */
import type { Request, Response, NextFunction } from "express";
import type { MarketplaceInstallation } from "@prisma/client";
import { prisma } from "../../db.js";
import { hashApiKey, safeIp } from "./marketplace.shared.js";

const HEADER = "x-marketplace-key";

export interface ReqWithInstallation extends Request {
  installation: MarketplaceInstallation;
}

export async function requireInstallation(req: Request, res: Response, next: NextFunction) {
  const raw = req.headers[HEADER];
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!key) return res.status(401).json({ message: "Missing X-Marketplace-Key" });
  const hash = hashApiKey(key);
  try {
    const inst = await prisma.marketplaceInstallation.findUnique({ where: { apiKeyHash: hash } });
    if (!inst) return res.status(401).json({ message: "Invalid marketplace key" });
    if (inst.isBanned) return res.status(403).json({ message: "Installation is banned", reason: inst.banReason });
    await prisma.marketplaceInstallation.update({
      where: { id: inst.id },
      data: { lastSeenAt: new Date(), lastIp: safeIp(req) },
    });
    (req as ReqWithInstallation).installation = inst;
    next();
  } catch (e) {
    console.error("[marketplace] requireInstallation prisma error:", e);
    return res.status(503).json({ message: "Database error" });
  }
}
