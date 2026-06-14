import express, { Router } from "express";
import { prisma } from "../../db.js";
import { requireClientAuth } from "../client/client.middleware.js";

export const wdttClientRouter = Router();
wdttClientRouter.use(requireClientAuth);

function asyncRoute(
  fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

wdttClientRouter.get("/slots", asyncRoute(async (req, res) => {
  const clientId = req.clientId!;
  const slots = await prisma.wdttSlot.findMany({
    where: { clientId },
    include: {
      node: { select: { name: true, publicHost: true, dtlsPort: true, wgPort: true, tunPort: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return res.json({
    items: slots.map((s) => ({
      id: s.id,
      nodeName: s.node.name,
      publicHost: s.node.publicHost,
      dtlsPort: s.node.dtlsPort,
      wgPort: s.node.wgPort,
      tunPort: s.node.tunPort,
      password: s.password,
      vkHash: s.vkHash,
      wdttLink: s.wdttLink,
      expiresAt: s.expiresAt.toISOString(),
      trafficLimitBytes: s.trafficLimitBytes?.toString() ?? null,
      trafficUsedBytes: s.trafficUsedBytes.toString(),
      status: s.status,
      createdAt: s.createdAt.toISOString(),
    })),
  });
}));

wdttClientRouter.get("/tariffs", asyncRoute(async (_req, res) => {
  const categories = await prisma.wdttCategory.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      tariffs: {
        where: { enabled: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  return res.json({
    items: categories.map((c) => ({
      id: c.id,
      name: c.name,
      tariffs: c.tariffs.map((t) => ({
        id: t.id,
        name: t.name,
        proxyCount: t.proxyCount,
        durationDays: t.durationDays,
        trafficLimitBytes: t.trafficLimitBytes?.toString() ?? null,
        price: t.price,
        currency: t.currency,
      })),
    })),
  });
}));
