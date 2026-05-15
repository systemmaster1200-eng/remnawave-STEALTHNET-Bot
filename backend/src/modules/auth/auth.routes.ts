import { Router } from "express";
import { z } from "zod";
import { generateSecret, generateURI, verify } from "otplib";
import { prisma } from "../../db.js";
import { env } from "../../config/index.js";
import {
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  verifyToken,
  hashPassword,
  signAdmin2FAPendingToken,
  verifyAdmin2FAPendingToken,
} from "./auth.service.js";
import { requireAuth } from "./middleware.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  try {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
    }

    const admin = await prisma.admin.findUnique({ where: { email: body.data.email } });
    if (!admin) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const valid = await verifyPassword(body.data.password, admin.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const full = await prisma.admin.findUnique({
      where: { id: admin.id },
      select: { id: true, email: true, mustChangePassword: true, role: true, allowedSections: true, totpEnabled: true },
    });
    if (!full) return res.status(401).json({ message: "Invalid email or password" });

    if (full.totpEnabled) {
      const tempToken = signAdmin2FAPendingToken({ adminId: full.id, email: full.email }, env.JWT_SECRET);
      return res.json({ requires2FA: true as const, tempToken });
    }

    const accessToken = signAccessToken(
      { adminId: admin.id, email: admin.email },
      env.JWT_SECRET,
      env.JWT_ACCESS_EXPIRES_IN
    );
    const refreshToken = signRefreshToken(
      { adminId: admin.id, email: admin.email },
      env.JWT_SECRET,
      env.JWT_REFRESH_EXPIRES_IN
    );

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await prisma.refreshToken.create({
      data: { adminId: admin.id, token: refreshToken, expiresAt },
    });

    const allowedSections = parseAllowedSections(admin.allowedSections);
    return res.json({
      accessToken,
      refreshToken,
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
      admin: {
        id: admin.id,
        email: admin.email,
        mustChangePassword: admin.mustChangePassword,
        role: admin.role,
        allowedSections,
        totpEnabled: full.totpEnabled ?? false,
      },
    });
  } catch (e) {
    console.error("Login error:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ message: "Internal server error", error: msg });
  }
});

const twoFaLoginSchema = z.object({ tempToken: z.string().min(1), code: z.string().length(6, "Код 6 цифр").regex(/^\d+$/) });
authRouter.post("/2fa-login", async (req, res) => {
  const body = twoFaLoginSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Введите 6-значный код", errors: body.error.flatten() });
  const payload = verifyAdmin2FAPendingToken(body.data.tempToken, env.JWT_SECRET);
  if (!payload) return res.status(401).json({ message: "Сессия истекла. Войдите снова." });
  const admin = await prisma.admin.findUnique({
    where: { id: payload.adminId },
    select: { id: true, email: true, mustChangePassword: true, role: true, allowedSections: true, totpSecret: true, totpEnabled: true },
  });
  if (!admin?.totpEnabled || !admin.totpSecret) return res.status(401).json({ message: "2FA не включена. Войдите снова." });
  const result = await verify({ secret: admin.totpSecret, token: body.data.code });
  if (!result.valid) return res.status(401).json({ message: "Неверный код" });
  const accessToken = signAccessToken({ adminId: admin.id, email: admin.email }, env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
  const refreshToken = signRefreshToken({ adminId: admin.id, email: admin.email }, env.JWT_SECRET, env.JWT_REFRESH_EXPIRES_IN);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  await prisma.refreshToken.create({ data: { adminId: admin.id, token: refreshToken, expiresAt } });
  const allowedSections = parseAllowedSections(admin.allowedSections);
  return res.json({
    accessToken,
    refreshToken,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    admin: { id: admin.id, email: admin.email, mustChangePassword: admin.mustChangePassword, role: admin.role, allowedSections },
  });
});

const twoFaCodeSchema = z.object({ code: z.string().length(6, "Код 6 цифр").regex(/^\d+$/) });
authRouter.post("/2fa/setup", requireAuth, async (req, res) => {
  const adminId = (req as unknown as { adminId?: string }).adminId!;
  const admin = await prisma.admin.findUnique({ where: { id: adminId }, select: { id: true, email: true, totpEnabled: true } });
  if (!admin) return res.status(401).json({ message: "Unauthorized" });
  if (admin.totpEnabled) return res.status(400).json({ message: "2FA уже включена" });
  const secret = generateSecret();
  const otpauthUrl = generateURI({ issuer: "STEALTHNET Admin", label: admin.email, secret });
  await prisma.admin.update({ where: { id: adminId }, data: { totpSecret: secret, totpEnabled: false } });
  return res.json({ secret, otpauthUrl });
});
authRouter.post("/2fa/confirm", requireAuth, async (req, res) => {
  const adminId = (req as unknown as { adminId?: string }).adminId!;
  const body = twoFaCodeSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Введите 6-значный код", errors: body.error.flatten() });
  const row = await prisma.admin.findUnique({ where: { id: adminId }, select: { totpSecret: true, totpEnabled: true } });
  if (!row?.totpSecret || row.totpEnabled) return res.status(400).json({ message: "Сначала запустите настройку 2FA или 2FA уже включена" });
  const result = await verify({ secret: row.totpSecret, token: body.data.code });
  if (!result.valid) return res.status(400).json({ message: "Неверный код" });
  await prisma.admin.update({ where: { id: adminId }, data: { totpEnabled: true } });
  return res.json({ message: "Двухфакторная аутентификация включена" });
});
authRouter.post("/2fa/disable", requireAuth, async (req, res) => {
  const adminId = (req as unknown as { adminId?: string }).adminId!;
  const body = twoFaCodeSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Введите 6-значный код", errors: body.error.flatten() });
  const row = await prisma.admin.findUnique({ where: { id: adminId }, select: { totpSecret: true, totpEnabled: true } });
  if (!row?.totpEnabled || !row.totpSecret) return res.status(400).json({ message: "2FA не включена" });
  const result = await verify({ secret: row.totpSecret, token: body.data.code });
  if (!result.valid) return res.status(401).json({ message: "Неверный код" });
  await prisma.admin.update({ where: { id: adminId }, data: { totpSecret: null, totpEnabled: false } });
  return res.json({ message: "Двухфакторная аутентификация отключена" });
});

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

authRouter.post("/refresh", async (req, res) => {
  const body = refreshSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input" });
  }

  const payload = verifyToken(body.data.refreshToken, env.JWT_SECRET);
  if (!payload || payload.type !== "refresh") {
    return res.status(401).json({ message: "Invalid or expired refresh token" });
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { token: body.data.refreshToken },
    include: { admin: true },
  });
  if (!stored || stored.expiresAt < new Date()) {
    if (stored) await prisma.refreshToken.delete({ where: { id: stored.id } }).catch(() => {});
    return res.status(401).json({ message: "Invalid or expired refresh token" });
  }

  const accessToken = signAccessToken(
    { adminId: stored.admin.id, email: stored.admin.email },
    env.JWT_SECRET,
    env.JWT_ACCESS_EXPIRES_IN
  );

  const allowedSections = parseAllowedSections(stored.admin.allowedSections);
  return res.json({
    accessToken,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    admin: {
      id: stored.admin.id,
      email: stored.admin.email,
      mustChangePassword: stored.admin.mustChangePassword,
      role: stored.admin.role,
      allowedSections,
      totpEnabled: stored.admin.totpEnabled ?? false,
    },
  });
});

function parseAllowedSections(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Min 8 characters"),
});

authRouter.post("/change-password", requireAuth, async (req, res) => {
  const adminId = (req as unknown as { adminId?: string }).adminId!;

  const body = changePasswordSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  }

  const admin = await prisma.admin.findUnique({ where: { id: adminId } });
  if (!admin) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const valid = await verifyPassword(body.data.currentPassword, admin.passwordHash);
  if (!valid) {
    return res.status(400).json({ message: "Current password is incorrect" });
  }

  const passwordHash = await hashPassword(body.data.newPassword);
  const updated = await prisma.admin.update({
    where: { id: adminId },
    data: { passwordHash, mustChangePassword: false },
    select: { id: true, email: true, mustChangePassword: true, role: true, allowedSections: true },
  });

  const allowedSections = parseAllowedSections(updated.allowedSections);
  return res.json({
    success: true,
    message: "Password changed",
    admin: {
      id: updated.id,
      email: updated.email,
      mustChangePassword: updated.mustChangePassword,
      role: updated.role,
      allowedSections,
    },
  });
});

authRouter.post("/logout", async (req, res) => {
  const token = req.body?.refreshToken;
  if (token) {
    await prisma.refreshToken.deleteMany({ where: { token } }).catch(() => {});
  }
  return res.json({ success: true });
});
