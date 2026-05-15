/**
 * Синхронизация клиентов панели с Remna (из Remna и в Remna).
 */

import { prisma } from "../../db.js";
import {
  isRemnaConfigured,
  remnaGetUsers,
  remnaGetUser,
  remnaUpdateUser,
  remnaCreateUser,
  remnaGetUserByTelegramId,
  remnaGetUserByEmail,
  remnaGetUserByUsername,
  extractRemnaUuid,
  remnaUsernameFromClient,
} from "../remna/remna.client.js";
import { getSystemConfig } from "../client/client.service.js";
import { getPrimaryBot } from "../bot/bot.service.js";

const PAGE_SIZE = 100;

type RemnaUser = {
  uuid?: string;
  telegramId?: number | null;
  email?: string | null;
  username?: string;
};

function extractRemnaUsers(data: unknown): RemnaUser[] {
  if (Array.isArray(data)) return data as RemnaUser[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (obj.response && typeof obj.response === "object") {
      const resp = (obj.response as Record<string, unknown>).users;
      if (Array.isArray(resp)) return resp as RemnaUser[];
    }
    if (Array.isArray(obj.items)) return obj.items as RemnaUser[];
    if (Array.isArray(obj.data)) return obj.data as RemnaUser[];
    if (Array.isArray(obj.users)) return obj.users as RemnaUser[];
  }
  return [];
}

/** Синхронизация из Remna: загружаем пользователей Remna и создаём/обновляем клиентов в нашей БД. */
export async function syncFromRemna(): Promise<{
  ok: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}> {
  const result = { created: 0, updated: 0, skipped: 0, errors: [] as string[] };

  if (!isRemnaConfigured()) {
    result.errors.push("Remna API не настроен (REMNA_API_URL, REMNA_ADMIN_TOKEN)");
    return { ok: false, ...result };
  }

  // Берём настройки панели (язык/валюта по умолчанию),
  // чтобы новые клиенты из Remna создавались с теми же значениями.
  const config = await getSystemConfig();
  const defaultLang = config.defaultLanguage ?? "ru";
  const defaultCurrency = (config.defaultCurrency ?? "usd").toLowerCase();
  // Sync from Remna создаёт «безбот'овых» клиентов (источник истины — Remna,
  // не TG-сессия). Привязываем к primary боту для консистентности.
  const primaryBot = await getPrimaryBot();
  if (!primaryBot) {
    result.errors.push("Primary bot не настроен — синхронизация невозможна");
    return { ok: false, ...result };
  }

  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const start = (page - 1) * PAGE_SIZE;
    const res = await remnaGetUsers({ start, size: PAGE_SIZE });
    if (res.error) {
      result.errors.push(`Remna: ${res.error}`);
      break;
    }

    const users = extractRemnaUsers(res.data);
    if (users.length === 0) hasMore = false;
    else {
      for (const u of users) {
        const uuid = u.uuid;
        if (!uuid) {
          result.skipped++;
          continue;
        }
        const telegramId = u.telegramId != null ? String(u.telegramId) : null;
        const email = u.email && String(u.email).trim() ? String(u.email).trim() : null;
        const username = u.username && String(u.username).trim() ? String(u.username).trim() : null;

        try {
          const existingByUuid = await prisma.client.findFirst({
            where: { remnawaveUuid: uuid },
          });
          const existingByTg = telegramId
            ? await prisma.client.findFirst({ where: { telegramId } })
            : null;
          const existingByEmail = email
            ? await prisma.client.findFirst({ where: { email } })
            : null;

          const existing = existingByUuid || existingByTg || existingByEmail;

          if (existing) {
            const data: { remnawaveUuid: string; telegramId?: string; email?: string | null; telegramUsername?: string; trialUsed?: boolean } = {
              remnawaveUuid: uuid,
              trialUsed: true,
            };
            if (telegramId) {
              const otherWithTg = await prisma.client.findFirst({
                where: { telegramId, id: { not: existing.id } },
              });
              if (!otherWithTg) data.telegramId = telegramId;
            }
            if (email != null && email !== "") {
              const otherWithEmail = await prisma.client.findFirst({
                where: { email, id: { not: existing.id } },
              });
              if (!otherWithEmail) data.email = email;
            }
            if (username && !existing.telegramUsername) data.telegramUsername = username;
            await prisma.client.update({
              where: { id: existing.id },
              data,
            });
            result.updated++;
          } else {
            const refCode = "REF-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
            await prisma.client.create({
              data: {
                botId: primaryBot.id,
                remnawaveUuid: uuid,
                email: email ?? null,
                telegramId,
                telegramUsername: username ?? null,
                referralCode: refCode,
                preferredLang: defaultLang,
                preferredCurrency: defaultCurrency,
                autoRenewEnabled: config.defaultAutoRenewEnabled ?? false,
                trialUsed: true,
              },
            });
            result.created++;
          }
        } catch (e) {
          result.errors.push(`${uuid}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (users.length < PAGE_SIZE) hasMore = false;
      else page++;
    }
  }

  return { ok: result.errors.length === 0, ...result };
}

/** Извлечь telegramId, email и activeInternalSquads из ответа Remna (getUser) — чтобы не затирать при PATCH. */
function extractRemnaUserFields(data: unknown): {
  telegramId?: number;
  email?: string | null;
  activeInternalSquads: string[];
} {
  if (!data || typeof data !== "object") return { activeInternalSquads: [] };
  const o = data as Record<string, unknown>;
  const resp = (o.response ?? o) as Record<string, unknown> | undefined;
  const telegramId = resp?.telegramId;
  const email = resp?.email;
  const ais = resp?.activeInternalSquads;
  const squads: string[] = [];
  if (Array.isArray(ais)) {
    for (const x of ais) {
      if (typeof x === "string" && x.trim()) squads.push(x.trim());
      else if (x && typeof x === "object" && typeof (x as { uuid?: string }).uuid === "string")
        squads.push((x as { uuid: string }).uuid);
    }
  }
  return {
    ...(typeof telegramId === "number" && { telegramId }),
    ...(email !== undefined && { email: email != null ? String(email) : null }),
    activeInternalSquads: squads,
  };
}

/** Проверка, что ошибка Remna — «пользователь не найден» (удалён в Remna или не существует). */
function isRemnaNotFoundError(status: number, error?: string): boolean {
  return status === 404 || (typeof error === "string" && /not found|not exist/i.test(error));
}

/** Повторить запрос к Remna один раз при сетевой ошибке («fetch failed» и подобные). */
async function remnaGetUserWithRetry(uuid: string): Promise<Awaited<ReturnType<typeof remnaGetUser>>> {
  const first = await remnaGetUser(uuid);
  if (!first.error || first.status !== 500) return first;
  // Сетевая/транзитная ошибка — даём Remna секунду и пробуем ещё раз перед тем как сбить синхру.
  await new Promise((r) => setTimeout(r, 1000));
  return remnaGetUser(uuid);
}

/** Синхронизация в Remna: отправляем telegramId и email наших клиентов.
 *  Текущие activeInternalSquads из GET подставляем в PATCH явно, чтобы Remna не обнулял сквады при «частичном» PATCH
 *  (иначе один запуск синхронизации мог бы сбросить сквады всем пользователям).
 *  Если пользователь в Remna не найден (404) — отвязываем клиента (remnawaveUuid = null) и считаем как unlinked. */
export async function syncToRemna(): Promise<{
  ok: boolean;
  updated: number;
  unlinked: number;
  errors: string[];
}> {
  const result = { updated: 0, unlinked: 0, errors: [] as string[] };

  if (!isRemnaConfigured()) {
    result.errors.push("Remna API не настроен");
    return { ok: false, ...result };
  }

  const clients = await prisma.client.findMany({
    where: { remnawaveUuid: { not: null } },
    select: { id: true, remnawaveUuid: true, telegramId: true, email: true },
  });

  for (const c of clients) {
    const uuid = c.remnawaveUuid;
    if (!uuid) continue;
    try {
      const getRes = await remnaGetUserWithRetry(uuid);
      if (getRes.error) {
        if (isRemnaNotFoundError(getRes.status, getRes.error)) {
          await prisma.client.update({ where: { id: c.id }, data: { remnawaveUuid: null } });
          result.unlinked++;
        } else {
          result.errors.push(`${uuid}: ${getRes.error}`);
        }
        continue;
      }
      const currentRemna = extractRemnaUserFields(getRes.data);
      const body: Record<string, unknown> = { uuid };
      body.telegramId = c.telegramId != null ? parseInt(c.telegramId, 10) : (currentRemna.telegramId ?? undefined);
      body.email = c.email != null ? c.email : (currentRemna.email ?? undefined);
      if (currentRemna.activeInternalSquads.length > 0)
        body.activeInternalSquads = currentRemna.activeInternalSquads;
      const res = await remnaUpdateUser(body);
      if (res.error) {
        if (isRemnaNotFoundError(res.status, res.error)) {
          await prisma.client.update({ where: { id: c.id }, data: { remnawaveUuid: null } });
          result.unlinked++;
        } else {
          result.errors.push(`${uuid}: ${res.error}`);
        }
      } else {
        result.updated++;
      }
    } catch (e) {
      result.errors.push(`${uuid}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { ok: result.errors.length === 0, ...result };
}

/** Создать в Remna пользователей для клиентов панели, у которых ещё нет remnawaveUuid. */
export async function createRemnaUsersForClientsWithoutUuid(): Promise<{
  ok: boolean;
  created: number;
  linked: number;
  errors: string[];
}> {
  const result = { created: 0, linked: 0, errors: [] as string[] };

  if (!isRemnaConfigured()) {
    result.errors.push("Remna API не настроен");
    return { ok: false, ...result };
  }

  const clients = await prisma.client.findMany({
    where: { remnawaveUuid: null },
    select: { id: true, email: true, telegramId: true, telegramUsername: true },
  });

  for (const c of clients) {
    try {
      let uuid: string | null = null;
      if (c.telegramId?.trim()) {
        const res = await remnaGetUserByTelegramId(c.telegramId.trim());
        uuid = extractRemnaUuid(res.data);
      }
      if (!uuid && c.email?.trim()) {
        const res = await remnaGetUserByEmail(c.email.trim());
        uuid = extractRemnaUuid(res.data);
      }
      const displayUsername = remnaUsernameFromClient({
        telegramUsername: c.telegramUsername,
        telegramId: c.telegramId,
        email: c.email,
        clientIdFallback: c.id,
      });
      if (!uuid) {
        const byUsernameRes = await remnaGetUserByUsername(displayUsername);
        uuid = extractRemnaUuid(byUsernameRes.data);
      }
      if (!uuid) {
        const createRes = await remnaCreateUser({
          username: displayUsername,
          trafficLimitBytes: 0,
          trafficLimitStrategy: "NO_RESET",
          expireAt: new Date(Date.now() - 1000).toISOString(),
          ...(c.telegramId && { telegramId: parseInt(c.telegramId, 10) }),
          ...(c.email && { email: c.email }),
        });
        uuid = extractRemnaUuid(createRes.data);
        if (uuid) result.created++;
      } else {
        result.linked++;
      }
      if (uuid) {
        await prisma.client.update({
          where: { id: c.id },
          data: { remnawaveUuid: uuid, trialUsed: true },
        });
      } else {
        result.errors.push(`Client ${c.id}: не удалось получить или создать UUID в Remna`);
      }
    } catch (e) {
      result.errors.push(`Client ${c.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { ok: result.errors.length === 0, ...result };
}
