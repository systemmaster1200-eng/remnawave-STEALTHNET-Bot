import { Router, Request, Response } from "express";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import {
  remnaGetUsers,
  remnaGetNodes,
  remnaGetNodeUsersUsage,
  isRemnaConfigured,
} from "../remna/remna.client.js";

export const trafficAbuseRouter = Router();
trafficAbuseRouter.use(requireAuth);
trafficAbuseRouter.use(requireAdminSection);

interface RemnaUser {
  uuid: string;
  username: string;
  status: string;
  email?: string | null;
  telegramId?: number | null;
  trafficLimitBytes: number;
  trafficLimitStrategy: string;
  expireAt: string;
  createdAt: string;
  userTraffic?: {
    usedTrafficBytes: number;
    lifetimeUsedTrafficBytes: number;
    onlineAt?: string | null;
    lastConnectedNodeUuid?: string | null;
  };
}

interface RemnaNode {
  uuid: string;
  name: string;
  countryCode?: string;
  isConnected?: boolean;
  isDisabled?: boolean;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const PAGE_SIZE = 500;
const MAX_PAGES = 100;

async function fetchAllUsers(): Promise<{ users: RemnaUser[]; total: number }> {
  const firstPage = await remnaGetUsers({ size: PAGE_SIZE, start: 0 });
  if (firstPage.error || !firstPage.data) {
    console.error("[traffic-abuse] Failed to fetch users page 0:", firstPage.error);
    return { users: [], total: 0 };
  }

  const data = firstPage.data as { response?: { users?: RemnaUser[]; total?: number } };
  const users: RemnaUser[] = data.response?.users ?? [];
  const total = data.response?.total ?? users.length;

  if (total <= PAGE_SIZE) return { users, total };

  const pages = Math.ceil(total / PAGE_SIZE);
  const remaining = Math.min(pages - 1, MAX_PAGES - 1);
  const promises = [];
  for (let i = 1; i <= remaining; i++) {
    promises.push(remnaGetUsers({ size: PAGE_SIZE, start: i * PAGE_SIZE }));
  }

  const results = await Promise.allSettled(promises);
  for (const r of results) {
    if (r.status !== "fulfilled" || r.value.error || !r.value.data) continue;
    const d = r.value.data as { response?: { users?: RemnaUser[] } };
    const pageUsers = d.response?.users;
    if (Array.isArray(pageUsers)) users.push(...pageUsers);
  }

  return { users, total };
}

interface AbuserEntry {
  uuid: string;
  username: string;
  email: string | null;
  telegramId: number | null;
  status: string;
  trafficLimitBytes: number;
  trafficLimitStrategy: string;
  usedTrafficBytes: number;
  lifetimeUsedTrafficBytes: number;
  periodUsageBytes: number;
  usagePercent: number;
  perNodeUsage: { nodeName: string; bytes: number }[];
  onlineAt: string | null;
  lastConnectedNodeUuid: string | null;
  createdAt: string;
  expireAt: string;
  abuseScore: number;
}

/**
 * GET /api/admin/traffic-abuse/analytics
 *
 * Query params:
 *   days — lookback period (default 7, max 90)
 *   threshold — abuse threshold multiplier (default 0.8 = 80% of limit)
 *   minBytes — minimum bytes used to be considered (default 1GB)
 */
trafficAbuseRouter.get("/analytics", async (req: Request, res: Response) => {
  if (!isRemnaConfigured()) {
    return res.status(503).json({ message: "Remna API not configured" });
  }

  const days = Math.min(Math.max(parseInt(req.query.days as string) || 7, 1), 90);
  const threshold = parseFloat(req.query.threshold as string) || 0.7;
  const minBytes = parseInt(req.query.minBytes as string) || 100_000_000;

  try {
    const nodesResult = await remnaGetNodes();
    if (nodesResult.error || !nodesResult.data) {
      console.error("[traffic-abuse] Remna nodes error:", nodesResult.error, "status:", nodesResult.status);
      return res.status(502).json({
        message: `Не удалось получить список нод: ${nodesResult.error || "unknown"}`,
      });
    }

    const nodesData = nodesResult.data as { response?: RemnaNode[] };
    const nodes: RemnaNode[] = nodesData.response ?? [];
    const activeNodes = nodes.filter((n) => !n.isDisabled);

    if (activeNodes.length === 0) {
      return res.json({
        abusers: [],
        stats: {
          totalUsers: 0,
          activeNodes: 0,
          periodDays: days,
          periodStart: formatDate(new Date()),
          periodEnd: formatDate(new Date()),
          totalTrafficPeriod: 0,
          abusersCount: 0,
          abuserTrafficTotal: 0,
          abuserTrafficPercent: 0,
          threshold,
          minBytes,
        },
      });
    }

    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    const startStr = formatDate(start);
    const endStr = formatDate(end);

    const nodeUsageResults = await Promise.allSettled(
      activeNodes.map((node) =>
        remnaGetNodeUsersUsage(node.uuid, startStr, endStr, 500).catch((e) => {
          console.error(`[traffic-abuse] Failed bandwidth-stats for node ${node.name} (${node.uuid}):`, e);
          return { data: undefined, error: String(e), status: 500 };
        })
      )
    );

    const usernameToNodeUsage = new Map<string, { nodeName: string; bytes: number }[]>();
    let nodesWithData = 0;

    activeNodes.forEach((node, i) => {
      const result = nodeUsageResults[i];
      if (result.status !== "fulfilled") return;

      const val = result.value as { data?: { response?: { topUsers?: { username: string; total: number }[] } }; error?: string };
      if (val.error || !val.data) return;

      const topUsers = val.data.response?.topUsers ?? [];
      if (topUsers.length > 0) nodesWithData++;

      for (const u of topUsers) {
        if (!u.username || typeof u.total !== "number") continue;
        if (!usernameToNodeUsage.has(u.username)) {
          usernameToNodeUsage.set(u.username, []);
        }
        usernameToNodeUsage.get(u.username)!.push({
          nodeName: node.name,
          bytes: u.total,
        });
      }
    });

    const { users, total: totalUsersCount } = await fetchAllUsers();

    const userMap = new Map<string, RemnaUser>();
    for (const u of users) {
      userMap.set(u.username, u);
    }

    const abusers: AbuserEntry[] = [];
    const allUsersAvgDaily = computeGlobalAvg(usernameToNodeUsage, days);

    for (const [username, nodeUsages] of usernameToNodeUsage) {
      const totalPeriod = nodeUsages.reduce((s, e) => s + e.bytes, 0);
      if (totalPeriod < minBytes) continue;

      const user = userMap.get(username);
      const usedTraffic = user?.userTraffic?.usedTrafficBytes ?? 0;
      const lifetimeTraffic = user?.userTraffic?.lifetimeUsedTrafficBytes ?? 0;
      const limit = Number(user?.trafficLimitBytes ?? 0);

      let usagePercent = 0;
      let abuseScore = 0;

      if (limit > 0) {
        usagePercent = (totalPeriod / limit) * 100;
        abuseScore = usagePercent;
      } else {
        const avgDailyBytes = totalPeriod / days;
        if (allUsersAvgDaily > 0) {
          abuseScore = (avgDailyBytes / allUsersAvgDaily) * 100;
        } else {
          abuseScore = 100;
        }
        usagePercent = abuseScore;
      }

      if (limit > 0 && usagePercent < threshold * 100) continue;
      if (limit === 0 && abuseScore < 150) continue;

      abusers.push({
        uuid: user?.uuid ?? "",
        username,
        email: user?.email ?? null,
        telegramId: user?.telegramId ?? null,
        status: user?.status ?? "UNKNOWN",
        trafficLimitBytes: limit,
        trafficLimitStrategy: user?.trafficLimitStrategy ?? "NO_RESET",
        usedTrafficBytes: usedTraffic,
        lifetimeUsedTrafficBytes: lifetimeTraffic,
        periodUsageBytes: totalPeriod,
        usagePercent: Math.round(usagePercent * 100) / 100,
        perNodeUsage: nodeUsages.sort((a, b) => b.bytes - a.bytes),
        onlineAt: user?.userTraffic?.onlineAt ?? null,
        lastConnectedNodeUuid: user?.userTraffic?.lastConnectedNodeUuid ?? null,
        createdAt: user?.createdAt ?? "",
        expireAt: user?.expireAt ?? "",
        abuseScore: Math.round(abuseScore * 100) / 100,
      });
    }

    abusers.sort((a, b) => b.abuseScore - a.abuseScore);

    const totalTrafficPeriod = Array.from(usernameToNodeUsage.values()).reduce(
      (sum, entries) => sum + entries.reduce((s, e) => s + e.bytes, 0),
      0
    );
    const abuserTrafficTotal = abusers.reduce((s, a) => s + a.periodUsageBytes, 0);

    res.json({
      abusers,
      stats: {
        totalUsers: totalUsersCount || users.length,
        activeNodes: activeNodes.length,
        nodesWithData,
        periodDays: days,
        periodStart: startStr,
        periodEnd: endStr,
        totalTrafficPeriod,
        abusersCount: abusers.length,
        abuserTrafficTotal,
        abuserTrafficPercent:
          totalTrafficPeriod > 0
            ? Math.round((abuserTrafficTotal / totalTrafficPeriod) * 10000) / 100
            : 0,
        threshold,
        minBytes,
      },
    });
  } catch (err) {
    console.error("[traffic-abuse] Unhandled error:", err);
    return res.status(500).json({
      message: err instanceof Error ? err.message : "Internal error computing traffic abuse analytics",
    });
  }
});

function computeGlobalAvg(
  map: Map<string, { nodeName: string; bytes: number }[]>,
  days: number
): number {
  let totalBytes = 0;
  let count = 0;
  for (const entries of map.values()) {
    totalBytes += entries.reduce((s, e) => s + e.bytes, 0);
    count++;
  }
  if (count === 0) return 0;
  return totalBytes / count / days;
}
