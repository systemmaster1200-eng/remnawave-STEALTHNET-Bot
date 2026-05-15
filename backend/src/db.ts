import { PrismaClient, Prisma, type Payment } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

const basePrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = basePrisma;

/**
 * Создание платежа с автоподстановкой `botId` по `clientId`, если не задан явно.
 * Вынесено из `$extends`: расширение ломало вывод типов Prisma в IDE/TS (botId, baseAmount…).
 *
 * НЕ заполняет baseAmount / botMarkup* — это делает вызывающий код через buildPaymentMarkupSnapshot.
 */
export async function createPayment(args: Prisma.PaymentCreateArgs): Promise<Payment> {
  const data = args.data as Prisma.PaymentUncheckedCreateInput;
  if (!data.botId && typeof data.clientId === "string") {
    const c = await basePrisma.client.findUnique({
      where: { id: data.clientId },
      select: { botId: true },
    });
    if (c?.botId) {
      (args.data as Prisma.PaymentUncheckedCreateInput).botId = c.botId;
    }
  }
  return basePrisma.payment.create(args);
}

export const prisma = basePrisma;

// ── Тонкая обёртка для литералов Prisma: часть IDE/анализаторов отстаёт от `prisma generate`
// и помечает botId, baseAmount, confirmedBotId и т.д. как «лишние» поля. Литерал сначала
// совместим с Record<string, unknown>, затем приводится к сгенерированному типу Prisma.
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
  confirmedBotId: string | null;
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

/** После findUnique с select { botId: true } — стабильный тип при «отстающем» выводе Prisma в IDE */
export type ClientBotIdPick = { botId: string };

export async function prismaBotFindMany<T>(args: Record<string, unknown>): Promise<T[]> {
  const delegate = basePrisma as unknown as {
    bot: { findMany: (a: Record<string, unknown>) => Promise<T[]> };
  };
  return delegate.bot.findMany(args);
}
