import { Router } from "express";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import { getGeoMapData, invalidateCache } from "./geo-map.service.js";
import { resetMaxMindReader } from "./geoip.service.js";
import { prisma } from "../../db.js";

export const geoMapRouter = Router();
geoMapRouter.use(requireAuth);
geoMapRouter.use(requireAdminSection);

async function isGeoMapEnabled(): Promise<boolean> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: "geo_map_enabled" } });
    return row?.value === "true" || row?.value === "1";
  } catch {
    return false;
  }
}

geoMapRouter.get("/data", async (_req, res) => {
  try {
    if (!(await isGeoMapEnabled())) {
      return res.status(403).json({ message: "Geo map is disabled" });
    }
    const data = await getGeoMapData(false);
    res.json(data);
  } catch (e) {
    console.error("[geo-map] Error fetching map data:", e);
    res.status(500).json({ message: "Failed to fetch geo map data" });
  }
});

geoMapRouter.post("/refresh", async (_req, res) => {
  try {
    if (!(await isGeoMapEnabled())) {
      return res.status(403).json({ message: "Geo map is disabled" });
    }
    invalidateCache();
    resetMaxMindReader();
    const data = await getGeoMapData(true);
    res.json(data);
  } catch (e) {
    console.error("[geo-map] Error refreshing map data:", e);
    res.status(500).json({ message: "Failed to refresh geo map data" });
  }
});
