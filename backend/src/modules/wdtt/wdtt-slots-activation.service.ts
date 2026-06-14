import { randomBytes } from "crypto";
import { prisma } from "../../db.js";

export type CreateWdttSlotsResult =
  | { ok: true; slotsCreated: number; slotIds: string[] }
  | { ok: false; error: string; status: number };

function generatePassword(): string {
  return randomBytes(20).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 20) || `p${Date.now().toString(36)}`;
}

async function createKeyOnNode(
  nodeApiUrl: string,
  nodeApiKey: string,
  password: string,
  trafficLimitBytes: bigint | null,
): Promise<{ vkHash: string; wdttLink: string }> {
  const body: Record<string, unknown> = { password };
  if (trafficLimitBytes != null) {
    body.traffic_limit_bytes = trafficLimitBytes.toString();
  }
  const response = await fetch(`${nodeApiUrl}/api/keys`, {
    method: "POST",
    headers: {
      "X-API-Key": nodeApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "unknown error");
    throw new Error(`Node API error ${response.status}: ${text}`);
  }
  const data = await response.json() as { vk_hash: string; wdtt_link: string };
  return { vkHash: data.vk_hash, wdttLink: data.wdtt_link };
}

export async function createWdttSlotsByPaymentId(paymentId: string): Promise<CreateWdttSlotsResult> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { wdttTariffId: true, clientId: true },
  });
  if (!payment?.wdttTariffId) {
    return { ok: false, error: "WDTT тариф не привязан к платежу", status: 400 };
  }

  const tariff = await prisma.wdttTariff.findUnique({ where: { id: payment.wdttTariffId } });
  if (!tariff || !tariff.enabled) {
    return { ok: false, error: "WDTT тариф не найден или отключён", status: 404 };
  }

  const client = await prisma.client.findUnique({ where: { id: payment.clientId } });
  if (!client) {
    return { ok: false, error: "Клиент не найден", status: 404 };
  }

  const assignedNodeIds = await prisma.wdttTariffNode.findMany({
    where: { tariffId: tariff.id },
    select: { nodeId: true },
  }).then((rows) => rows.map((r) => r.nodeId));

  const nodeWhere =
    assignedNodeIds.length > 0
      ? { id: { in: assignedNodeIds }, status: "ONLINE" }
      : { status: "ONLINE" };

  const nodes = await prisma.wdttNode.findMany({
    where: nodeWhere,
    select: { id: true, apiUrl: true, apiKey: true, publicHost: true, dtlsPort: true, wgPort: true, tunPort: true, capacity: true, currentSlots: true },
    orderBy: { updatedAt: "asc" },
  });
  if (nodes.length === 0) {
    return { ok: false, error: "Нет доступных WDTT нод. Попробуйте позже.", status: 503 };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + tariff.durationDays * 24 * 60 * 60 * 1000);
  const slotsToCreate = tariff.proxyCount;
  const results: { nodeId: string; password: string; vkHash: string; wdttLink: string }[] = [];
  const nodeSlotCount: Map<string, number> = new Map();
  for (const n of nodes) nodeSlotCount.set(n.id, n.currentSlots);

  let nodeIndex = 0;
  for (let i = 0; i < slotsToCreate; i++) {
    const node = nodes[nodeIndex % nodes.length]!;
    const used = nodeSlotCount.get(node.id) ?? 0;
    const cap = node.capacity;
    if (cap != null && used >= cap) {
      const next = nodes.find((n) => (nodeSlotCount.get(n.id) ?? 0) < (n.capacity ?? Infinity));
      if (!next) break;
      nodeIndex = nodes.indexOf(next);
    }

    const password = generatePassword();
    let keyResult: { vkHash: string; wdttLink: string };
    try {
      keyResult = await createKeyOnNode(node.apiUrl, node.apiKey, password, tariff.trafficLimitBytes);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error(`[WDTT Activation] Failed to create key on node ${node.name}: ${msg}`);
      continue;
    }

    results.push({
      nodeId: node.id,
      password,
      vkHash: keyResult.vkHash,
      wdttLink: keyResult.wdttLink,
    });
    nodeSlotCount.set(node.id, used + 1);
    nodeIndex++;
  }

  if (results.length === 0) {
    return { ok: false, error: "Не удалось создать ключи на нодах", status: 503 };
  }

  const created = await prisma.$transaction(
    results.map((r) =>
      prisma.wdttSlot.create({
        data: {
          nodeId: r.nodeId,
          clientId: client.id,
          tariffId: tariff.id,
          paymentId: paymentId,
          password: r.password,
          vkHash: r.vkHash,
          wdttLink: r.wdttLink,
          expiresAt,
          trafficLimitBytes: tariff.trafficLimitBytes,
          status: "ACTIVE",
        },
      })
    )
  );

  await Promise.all(
    results.map((r) =>
      prisma.wdttNode.update({
        where: { id: r.nodeId },
        data: { currentSlots: { increment: 1 } },
      })
    )
  );

  return { ok: true, slotsCreated: created.length, slotIds: created.map((c) => c.id) };
}
