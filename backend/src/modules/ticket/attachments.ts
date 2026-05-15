import type { Request } from "express";
import { ticketAttachmentUrl } from "../../lib/upload.js";

/**
 * Единичное вложение тикета. Храним такой JSON-массив строкой в TicketMessage.attachments.
 * - url:   относительный путь вида `/api/uploads/tickets/<file>` (совпадает с express.static маунтом).
 * - mime:  MIME-тип, отданный multer (image/png, image/jpeg и т.д.).
 * - size:  размер в байтах (может пригодиться фронту).
 * - name:  оригинальное имя файла (для alt/скачивания).
 */
export type TicketAttachment = {
  url: string;
  mime: string;
  size: number;
  name?: string;
};

/** Превратить пришедшие через multer файлы в DTO-массив. */
export function filesToAttachments(
  files: Express.Multer.File[] | undefined,
): TicketAttachment[] {
  if (!files || files.length === 0) return [];
  return files.map((f) => ({
    url: ticketAttachmentUrl(f.filename),
    mime: f.mimetype || "application/octet-stream",
    size: f.size,
    name: f.originalname,
  }));
}

/** Сериализовать в TEXT-поле (или null, если нет вложений). */
export function serializeAttachments(list: TicketAttachment[] | undefined): string | null {
  if (!list || list.length === 0) return null;
  return JSON.stringify(list);
}

/**
 * Разобрать значение из БД обратно в массив.
 * Терпимо относимся к любому мусору — возвращаем [].
 */
export function parseAttachments(raw: string | null | undefined): TicketAttachment[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is TicketAttachment =>
        x &&
        typeof x === "object" &&
        typeof (x as { url?: unknown }).url === "string" &&
        typeof (x as { mime?: unknown }).mime === "string",
    );
  } catch {
    return [];
  }
}

/** Аккуратно вытащить строку из поля multipart-формы (multer кладёт в req.body). */
export function pickField(req: Request, key: string): string {
  const v = (req.body as Record<string, unknown> | undefined)?.[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return "";
}
