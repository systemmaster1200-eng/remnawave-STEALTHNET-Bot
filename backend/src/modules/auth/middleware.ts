import { Request, Response, NextFunction } from "express";
import { verifyToken } from "./auth.service.js";
import { env } from "../../config/index.js";
import { prisma } from "../../db.js";

const AUTH_HEADER = "authorization";
const BEARER = "Bearer ";

export type AdminRole = "ADMIN" | "MANAGER";

export interface ReqAdmin {
  adminId: string;
  adminEmail: string;
  adminRole: AdminRole;
  adminAllowedSections: string[];
}

function parseAllowedSections(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

/** Нормализует путь запроса до пути относительно /api/admin (без ведущего слэша). */
function normaliseAdminPath(req: Request): string {
  let path = (req.path || req.originalUrl || "").replace(/^\//, "");
  if (path.startsWith("api/admin/")) path = path.slice("api/admin/".length);
  else if (path === "api/admin" || path.startsWith("api/admin")) path = path.slice("api/admin".length).replace(/^\//, "");
  return path;
}

/** Путь API admin -> раздел доступа (первый сегмент пути с маппингом). */
function getSectionFromPath(normalisedPath: string): string | null {
  const segments = normalisedPath.split("/").filter(Boolean);
  const first = segments[0];
  if (!first || first === "me") return null;
  if (first === "remna") {
    if (segments[1] === "nodes") return "remna-nodes";
    return "dashboard";
  }
  if (first === "payments") return "sales-report";
  if (first === "tariff-categories") return "tariffs";
  if (first === "default-subscription-page-config") return "settings";
  if (first === "sync") return "settings";
  if (first === "promo-groups") return "promo";
  if (first === "referrals") return "clients";
  if (first === "traffic-abuse") return "analytics";
  if (first === "api-keys") return "settings";
  if (first === "gramads") return "promo-vpn";
  return first;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const raw = req.headers[AUTH_HEADER];
  const token = typeof raw === "string" && raw.startsWith(BEARER) ? raw.slice(BEARER.length) : null;

  if (!token) {
    return res.status(401).json({ message: "Missing or invalid Authorization header" });
  }

  const payload = verifyToken(token, env.JWT_SECRET);
  if (!payload || payload.type !== "access") {
    return res.status(401).json({ message: "Invalid or expired token" });
  }

  try {
    const admin = await prisma.admin.findUnique({
      where: { id: payload.adminId },
      select: { id: true, email: true, role: true, allowedSections: true },
    });
    if (!admin) {
      return res.status(401).json({ message: "User not found" });
    }
    const ext = req as Request & ReqAdmin;
    ext.adminId = admin.id;
    ext.adminEmail = admin.email;
    ext.adminRole = (admin.role === "MANAGER" ? "MANAGER" : "ADMIN") as AdminRole;
    ext.adminAllowedSections = parseAllowedSections(admin.allowedSections);
    next();
  } catch (e) {
    console.error("requireAuth prisma error:", e);
    return res.status(503).json({
      message: "Database error. Check DATABASE_URL and run: npx prisma db push",
    });
  }
}

/** После requireAuth: запрещает доступ менеджеру, если у него нет доступа к разделу текущего пути. */
export function requireAdminSection(req: Request, res: Response, next: NextFunction) {
  const ext = req as Request & ReqAdmin;
  const path = normaliseAdminPath(req);
  const section = getSectionFromPath(path);
  if (!section) return next();
  if (ext.adminRole === "ADMIN") return next();
  if (section === "admins") {
    return res.status(403).json({ message: "Access denied. Only full admin can manage managers." });
  }
  if (ext.adminAllowedSections.includes(section)) return next();
  return res.status(403).json({ message: "Access denied to this section." });
}

/** Если токен есть и валиден — добавляет adminId в req, иначе не блокирует (для опционального auth). */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const raw = req.headers[AUTH_HEADER];
  const token = typeof raw === "string" && raw.startsWith(BEARER) ? raw.slice(BEARER.length) : null;

  if (!token) return next();

  const payload = verifyToken(token, env.JWT_SECRET);
  if (!payload || payload.type !== "access") return next();

  try {
    const admin = await prisma.admin.findUnique({
      where: { id: payload.adminId },
      select: { id: true },
    });
    if (admin) {
      (req as Request & { adminId?: string }).adminId = admin.id;
    }
  } catch (e) {
    console.error("optionalAuth prisma error:", e);
  }
  next();
}
