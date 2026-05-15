import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { getMasterKeys } from "../../i18n/keys.js";
import { clearLangPackCache } from "../client/client.service.js";

export const languageRouter = Router();

function asyncRoute(fn: (req: any, res: any) => Promise<any>) {
  return (req: any, res: any, next: any) => fn(req, res).catch(next);
}

languageRouter.get("/keys", asyncRoute(async (_req, res) => {
  const keys = getMasterKeys();
  return res.json({ ok: true, keys });
}));

languageRouter.get("/", asyncRoute(async (_req, res) => {
  const masterKeys = getMasterKeys();
  const totalKeys = Object.keys(masterKeys).length;
  const rows = await prisma.systemSetting.findMany({
    where: { key: { startsWith: "lang_pack_" } },
  });
  const languages = rows.map((r) => {
    const code = r.key.replace("lang_pack_", "");
    let translatedCount = 0;
    try {
      const data = JSON.parse(r.value);
      translatedCount = countLeafKeys(data);
    } catch { /* ignore */ }
    return {
      code,
      translatedKeys: translatedCount,
      totalKeys,
      completeness: totalKeys > 0 ? Math.round((translatedCount / totalKeys) * 100) : 0,
    };
  });
  return res.json({ ok: true, languages, totalKeys });
}));

languageRouter.get("/:code", asyncRoute(async (req, res) => {
  const code = req.params.code;
  const row = await prisma.systemSetting.findUnique({ where: { key: `lang_pack_${code}` } });
  if (!row) return res.status(404).json({ ok: false, message: "Language pack not found" });
  try {
    const data = JSON.parse(row.value);
    return res.json({ ok: true, code, data });
  } catch {
    return res.status(500).json({ ok: false, message: "Invalid language pack data" });
  }
}));

const langPackSchema = z.record(z.unknown());

languageRouter.put("/:code", asyncRoute(async (req, res) => {
  const code = req.params.code;
  const body = langPackSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ ok: false, message: "Invalid data" });
  const value = JSON.stringify(body.data);
  await prisma.systemSetting.upsert({
    where: { key: `lang_pack_${code}` },
    create: { key: `lang_pack_${code}`, value },
    update: { value },
  });
  clearLangPackCache();
  return res.json({ ok: true });
}));

languageRouter.delete("/:code", asyncRoute(async (req, res) => {
  const code = req.params.code;
  if (code === "ru") return res.status(400).json({ ok: false, message: "Cannot delete default language" });
  try {
    await prisma.systemSetting.delete({ where: { key: `lang_pack_${code}` } });
  } catch { /* may not exist */ }
  clearLangPackCache();
  return res.json({ ok: true });
}));

languageRouter.post("/:code/import", asyncRoute(async (req, res) => {
  const code = req.params.code;
  const body = langPackSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ ok: false, message: "Invalid JSON" });
  const value = JSON.stringify(body.data);
  await prisma.systemSetting.upsert({
    where: { key: `lang_pack_${code}` },
    create: { key: `lang_pack_${code}`, value },
    update: { value },
  });
  clearLangPackCache();
  return res.json({ ok: true });
}));

languageRouter.get("/:code/export", asyncRoute(async (req, res) => {
  const code = req.params.code;
  const row = await prisma.systemSetting.findUnique({ where: { key: `lang_pack_${code}` } });
  if (!row) return res.status(404).json({ ok: false, message: "Language pack not found" });
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="lang_${code}.json"`);
  return res.send(row.value);
}));

function countLeafKeys(obj: unknown, prefix = ""): number {
  if (!obj || typeof obj !== "object") return 0;
  let count = 0;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === "string") {
      count++;
    } else if (typeof v === "object" && v !== null) {
      count += countLeafKeys(v, prefix ? `${prefix}.${k}` : k);
    }
  }
  return count;
}
