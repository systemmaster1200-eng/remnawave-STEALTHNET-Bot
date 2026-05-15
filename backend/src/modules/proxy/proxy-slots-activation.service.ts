/**
 * Создание прокси-слотов по успешной оплате (proxyTariffId).
 * Вызывается из: webhook YooMoney/YooKassa/Platega, admin mark-as-paid.
 */

import { randomBytes } from "crypto";
import { prisma } from "../../db.js";

export type CreateProxySlotsResult =
  | { ok: true; slotsCreated: number; slotIds: string[] }
  | { ok: false; error: string; status: number };

function generateLogin(): string {
  const raw = randomBytes(16).toString("base64url");
  return raw.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20) || `u${Date.now().toString(36)}`;
}

function generatePassword(): string {
  return randomBytes(16).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 16) || String(Date.now());
}

/**
 * Выбирает ONLINE ноды, исключая DISABLED. Распределяет слоты round-robin.
 */
export async function createProxySlotsByPaymentId(paymentId: string): Promise<CreateProxySlotsResult> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { proxyTariffId: true, clientId: true },
  });
  if (!payment?.proxyTariffId) {
    return { ok: false, error: "Прокси-тариф не привязан к платежу", status: 400 };
  }

  const tariff = await prisma.proxyTariff.findUnique({ where: { id: payment.proxyTariffId } });
  if (!tariff || !tariff.enabled) {
    return { ok: false, error: "Прокси-тариф не найден или отключён", status: 404 };
  }

  const client = await prisma.client.findUnique({ where: { id: payment.clientId } });
  if (!client) {
    return { ok: false, error: "Клиент не найден", status: 404 };
  }

  const assignedNodeIds = await prisma.proxyTariffNode.findMany({
    where: { tariffId: tariff.id },
    select: { nodeId: true },
  }).then((rows) => rows.map((r) => r.nodeId));

  const nodeWhere =
    assignedNodeIds.length > 0
      ? { id: { in: assignedNodeIds }, status: "ONLINE" }
      : { status: "ONLINE" };

  const nodes = await prisma.proxyNode.findMany({
    where: nodeWhere,
    select: { id: true, publicHost: true, socksPort: true, httpPort: true, capacity: true },
    orderBy: { updatedAt: "asc" },
  });
  if (nodes.length === 0) {
    return { ok: false, error: "Нет доступных прокси-нод. Попробуйте позже.", status: 503 };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + tariff.durationDays * 24 * 60 * 60 * 1000);

  const slotsToCreate = tariff.proxyCount;
  const slots: { nodeId: string; login: string; password: string }[] = [];
  const nodeSlots: Map<string, number> = new Map();
  for (const n of nodes) nodeSlots.set(n.id, 0);

  let nodeIndex = 0;
  for (let i = 0; i < slotsToCreate; i++) {
    const node = nodes[nodeIndex % nodes.length]!;
    const used = nodeSlots.get(node.id) ?? 0;
    const cap = node.capacity;
    if (cap != null && used >= cap) {
      const next = nodes.find((n) => (nodeSlots.get(n.id) ?? 0) < (n.capacity ?? Infinity));
      if (!next) break;
      nodeIndex = nodes.indexOf(next);
    }
    const login = generateLogin();
    const password = generatePassword();
    slots.push({ nodeId: node.id, login, password });
    nodeSlots.set(node.id, (nodeSlots.get(node.id) ?? 0) + 1);
    nodeIndex++;
  }

  if (slots.length === 0) {
    return { ok: false, error: "Нет свободных мест на нодах", status: 503 };
  }

  const created = await prisma.$transaction(
    slots.map((s) =>
      prisma.proxySlot.create({
        data: {
          nodeId: s.nodeId,
          clientId: client.id,
          proxyTariffId: tariff.id,
          login: s.login,
          password: s.password,
          expiresAt,
          trafficLimitBytes: tariff.trafficLimitBytes,
          connectionLimit: tariff.connectionLimit,
          status: "ACTIVE",
        },
      })
    )
  );

  return { ok: true, slotsCreated: created.length, slotIds: created.map((c) => c.id) };
}
