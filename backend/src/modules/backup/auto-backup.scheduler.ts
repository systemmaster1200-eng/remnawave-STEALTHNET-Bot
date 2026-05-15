import cron, { type ScheduledTask } from "node-cron";
import { getSystemConfig } from "../client/client.service.js";
import { parseDatabaseUrl, saveBackupToFile } from "./backup.service.js";
import { readFile } from "node:fs/promises";
import { proxyFetch } from "../proxy-util/proxy-fetch.js";
import { getProxyUrl } from "../proxy-util/get-proxy-url.js";

const DEFAULT_CRON = "0 7 * * *";
const LOG = "[auto-backup]";

let currentTask: ScheduledTask | null = null;

async function sendDocumentToTelegram(
  botToken: string,
  chatId: string,
  topicId: number | null,
  fileBuffer: Buffer,
  filename: string,
  caption: string,
): Promise<boolean> {
  const url = `https://api.telegram.org/bot${botToken}/sendDocument`;
  const form = new FormData();
  form.append("chat_id", chatId);
  if (topicId) form.append("message_thread_id", String(topicId));
  form.append("caption", caption);
  form.append("parse_mode", "HTML");
  form.append("document", new Blob([fileBuffer]), filename);

  try {
    const proxy = await getProxyUrl("telegram");
    const res = await proxyFetch(url, { method: "POST", body: form }, proxy);
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!data.ok) {
      console.error(`${LOG} sendDocument failed:`, data.description ?? res.statusText);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`${LOG} sendDocument error:`, e);
    return false;
  }
}

async function runAutoBackup(): Promise<void> {
  const config = await getSystemConfig();
  if (!config.autoBackupEnabled) return;

  const botToken = config.telegramBotToken?.trim();
  const groupId = config.notificationTelegramGroupId?.trim();
  if (!botToken || !groupId) {
    console.warn(`${LOG} Bot token or group ID not configured, skip`);
    return;
  }

  const topicRaw = config.notificationTopicBackups?.trim();
  const topicId = topicRaw ? (parseInt(topicRaw, 10) || null) : null;

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.warn(`${LOG} DATABASE_URL not set, skip`);
    return;
  }
  const db = parseDatabaseUrl(dbUrl);
  if (!db) {
    console.warn(`${LOG} Invalid DATABASE_URL, skip`);
    return;
  }

  console.log(`${LOG} Creating backup...`);
  try {
    const { fullPath, filename } = await saveBackupToFile(db);
    const fileBuffer = await readFile(fullPath);
    const sizeMb = (fileBuffer.length / 1024 / 1024).toFixed(2);
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");

    const caption =
      `💾 <b>Авто-бэкап</b>\n\n` +
      `📅 ${now} UTC\n` +
      `📦 Размер: ${sizeMb} МБ\n` +
      `📄 ${filename}`;

    const sent = await sendDocumentToTelegram(botToken, groupId, topicId, fileBuffer, filename, caption);
    if (sent) {
      console.log(`${LOG} Backup sent to Telegram: ${filename} (${sizeMb} MB)`);
    } else {
      console.error(`${LOG} Failed to send backup to Telegram`);
    }
  } catch (e) {
    console.error(`${LOG} Backup error:`, e);
  }
}

function startWithExpression(cronExpression: string): ScheduledTask | null {
  const expr = cronExpression.trim();
  const schedule = expr && cron.validate(expr) ? expr : DEFAULT_CRON;
  if (expr && !cron.validate(expr)) {
    console.warn(`${LOG} Invalid cron "${expr}", using default: ${DEFAULT_CRON}`);
  }

  const task = cron.schedule(schedule, async () => {
    console.log(`${LOG} Cron triggered (${schedule})`);
    try {
      await runAutoBackup();
    } catch (e) {
      console.error(`${LOG} Error:`, e);
    }
  });

  console.log(`${LOG} Scheduler started: ${schedule}`);
  return task;
}

export async function startAutoBackupScheduler(): Promise<void> {
  const config = await getSystemConfig();
  if (!config.autoBackupEnabled) {
    console.log(`${LOG} Disabled, skip scheduler`);
    return;
  }
  const expr = config.autoBackupCron || DEFAULT_CRON;
  currentTask = startWithExpression(expr);
}

export async function restartAutoBackupScheduler(): Promise<void> {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }
  await startAutoBackupScheduler();
}

export function stopAutoBackupScheduler(): void {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }
}

export { runAutoBackup };
