import { PrismaClient, Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

const basePrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = basePrisma;

/**
 * Тонкая обёртка над prisma.payment.create — оставлена для совместимости после
 * выпила multi-bot в v5.0.0 (раньше делала автоподстановку botId по clientId).
 */
export async function createPayment(args: Prisma.PaymentCreateArgs) {
  return basePrisma.payment.create(args);
}

export const prisma = basePrisma;

// ── Тонкие обёртки для литералов Prisma: часть IDE/анализаторов отстаёт от `prisma generate`.
// Литерал сначала совместим с Record<string, unknown>, затем приводится к сгенерированному типу Prisma.
export function asClientUncheckedCreate(data: Record<string, unknown>): Prisma.ClientUncheckedCreateInput {
  return data as Prisma.ClientUncheckedCreateInput;
}

export function asClientWhere(where: Record<string, unknown>): Prisma.ClientWhereInput {
  return where as Prisma.ClientWhereInput;
}

export function asClientSelect(select: Record<string, unknown>): Prisma.ClientSelect {
  return select as Prisma.ClientSelect;
}

export function asPaymentUncheckedCreate(data: Record<string, unknown>): Prisma.PaymentUncheckedCreateInput {
  return data as Prisma.PaymentUncheckedCreateInput;
}

export function asTelegramAuthUpdate(data: Record<string, unknown>): Prisma.TelegramAuthTokenUpdateInput {
  return data as Prisma.TelegramAuthTokenUpdateInput;
}

export type TelegramAuthTokenRecord = {
  id: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  confirmedTelegramId: string | null;
  confirmedUsername: string | null;
};

/** Строка Client после findFirst с select для слияния «пустого» клона */
export type ClientEmptyCloneRow = {
  id: string;
  email: string | null;
  passwordHash: string | null;
  googleId: string | null;
  appleId: string | null;
  remnawaveUuid: string | null;
  balance: number;
  _count: { payments: number; ownedSubscriptions: number };
};
