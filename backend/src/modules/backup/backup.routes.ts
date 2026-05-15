/**
 * Роуты бэкапа: создание (сохранение на диск + скачивание), список, скачивание, восстановление
 */

import { Request, Response } from "express";
import multer from "multer";
import {
  parseDatabaseUrl,
  runPgRestore,
  saveBackupToFile,
  listBackups,
  createBackupReadStream,
  readBackupFile,
} from "./backup.service.js";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

export function registerBackupRoutes(
  router: import("express").Router,
  asyncRoute: (fn: (req: Request, res: Response) => Promise<void | Response>) => (req: Request, res: Response, next: () => void) => void
) {
  /** GET /api/admin/backup/create — создаёт бэкап на диск (по дням) и отдаёт файл на скачивание */
  router.get("/backup/create", asyncRoute(async (_req, res) => {
    const url = process.env.DATABASE_URL;
    if (!url) return res.status(503).json({ message: "DATABASE_URL не задан" });
    const db = parseDatabaseUrl(url);
    if (!db) return res.status(503).json({ message: "Неверный формат DATABASE_URL" });
    try {
      const { relativePath, filename, fullPath } = await saveBackupToFile(db);
      const st = await stat(fullPath);
      res.setHeader("Content-Type", "application/sql");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", String(st.size));
      createReadStream(fullPath).pipe(res);
    } catch (e) {
      console.error("Backup create error:", e);
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ message: "Ошибка создания бэкапа. Убедитесь, что в контейнере установлен postgresql-client.", error: msg });
    }
  }));

  /** GET /api/admin/backup/list — список сохранённых бэкапов */
  router.get("/backup/list", asyncRoute(async (_req, res) => {
    try {
      const items = await listBackups();
      return res.json({ items });
    } catch (e) {
      console.error("Backup list error:", e);
      return res.status(500).json({ message: "Ошибка чтения списка бэкапов" });
    }
  }));

  /** GET /api/admin/backup/download?path=YYYY/MM/DD/filename.sql — скачать бэкап с сервера */
  router.get("/backup/download", asyncRoute(async (req, res) => {
    const pathParam = req.query.path as string | undefined;
    if (!pathParam || typeof pathParam !== "string") {
      return res.status(400).json({ message: "Укажите параметр path (относительный путь к бэкапу)" });
    }
    const stream = createBackupReadStream(pathParam);
    if (!stream) return res.status(404).json({ message: "Бэкап не найден" });
    const filename = pathParam.split("/").pop() || "backup.sql";
    res.setHeader("Content-Type", "application/sql");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    stream.pipe(res);
  }));

  /**
   * POST /api/admin/backup/restore
   * Вариант 1: multipart с полем "file" и "confirm" = "RESTORE"
   * Вариант 2: JSON body { confirm: "RESTORE", path: "YYYY/MM/DD/filename.sql" } — восстановить с сервера
   */
  router.post("/backup/restore", upload.single("file"), asyncRoute(async (req, res) => {
    const url = process.env.DATABASE_URL;
    if (!url) return res.status(503).json({ message: "DATABASE_URL не задан" });
    const db = parseDatabaseUrl(url);
    if (!db) return res.status(503).json({ message: "Неверный формат DATABASE_URL" });
    if (req.body?.confirm !== "RESTORE") {
      return res.status(400).json({ message: "Подтвердите восстановление: укажите confirm: RESTORE" });
    }

    let sqlBuffer: Buffer;
    const serverPath = req.body?.path as string | undefined;
    if (serverPath && typeof serverPath === "string") {
      const buf = await readBackupFile(serverPath);
      if (!buf || buf.length === 0) return res.status(404).json({ message: "Бэкап на сервере не найден" });
      sqlBuffer = buf;
    } else {
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file || !file.buffer || file.buffer.length === 0) {
        return res.status(400).json({ message: "Выберите файл бэкапа (.sql) или укажите path к сохранённому бэкапу" });
      }
      sqlBuffer = file.buffer;
    }

    try {
      await runPgRestore(db, sqlBuffer);
      return res.json({ message: "База данных восстановлена из бэкапа." });
    } catch (e) {
      console.error("Backup restore error:", e);
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ message: msg, error: msg });
    }
  }));
}
