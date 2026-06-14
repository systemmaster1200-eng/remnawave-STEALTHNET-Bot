/**
 * отдельный worker-процесс для рассылок.
 *
 * Архитектура:
 *   API (stealthnet-api) → POST /admin/broadcast
 *     → сохраняет attachment на shared volume /data/broadcast-attachments/
 *     → INSERT broadcast_history (status='pending')
 *     → возвращает jobId КЛИЕНТУ МГНОВЕННО
 *   Worker (stealthnet-broadcast-worker) — этот процесс
 *     → каждые 3 сек polls broadcast_history WHERE status='pending'
 *     → атомарно CLAIM: UPDATE status='running' RETURNING (skip-if-already-claimed)
 *     → читает attachment с диска
 *     → запускает runBroadcast() в своём event-loop
 *     → периодически в onProgress пишет sent/failed counts и проверяет cancel_requested
 *
 * Бот/api event-loop остаётся свободным — рассылка не лагает их.
 */

import { readFile, unlink } from "node:fs/promises";
import { prisma } from "../db.js";
import {
  runBroadcast,
  type BroadcastAttachment,
  type BroadcastChannel,
  type BroadcastTargetGroup,
} from "../modules/broadcast/broadcast.service.js";

const POLL_INTERVAL_MS = 3000;
const PROGRESS_FLUSH_MS = 3000;

function log(...args: unknown[]): void {
  console.log(`[broadcast-worker]`, ...args);
}

let shuttingDown = false;
process.on("SIGTERM", () => { shuttingDown = true; log("SIGTERM, shutting down after current job"); });
process.on("SIGINT", () => { shuttingDown = true; log("SIGINT, shutting down after current job"); });

/**
 * Атомарно «забрать» одну pending-рассылку. Возвращает row или null.
 * Используем UPDATE … WHERE status='pending' RETURNING * — Postgres гарантирует
 * атомарность, никто другой не подхватит ту же запись (если worker'ов несколько).
 */
async function claimNextJob() {
  const rows = await prisma.$queryRaw<Array<{
    id: string;
    channel: string;
    subject: string;
    message: string;
    button_text: string | null;
    button_url: string | null;
    attachment_name: string | null;
    attachment_path: string | null;
    attachment_mime: string | null;
    target_group: string | null;
  }>>`
    UPDATE broadcast_history
       SET status = 'running'
     WHERE id = (
       SELECT id FROM broadcast_history
        WHERE status = 'pending'
        ORDER BY started_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id, channel, subject, message, button_text, button_url,
              attachment_name, attachment_path, attachment_mime, target_group;
  `;
  return rows[0] ?? null;
}

async function processOne(job: NonNullable<Awaited<ReturnType<typeof claimNextJob>>>): Promise<void> {
  log(`claimed ${job.id} (${job.channel}, attachment=${job.attachment_name ?? "none"})`);

  let attachment: BroadcastAttachment | undefined;
  if (job.attachment_path) {
    try {
      const buf = await readFile(job.attachment_path);
      attachment = {
        buffer: buf,
        mimetype: job.attachment_mime || "application/octet-stream",
        originalname: job.attachment_name || "file",
      };
      log(`  loaded attachment from disk: ${buf.length} bytes`);
    } catch (e) {
      log(`  WARN: cannot load attachment ${job.attachment_path}:`, e instanceof Error ? e.message : e);
      // Если оригинал был с media но файл потерян — отмечаем error.
      await prisma.broadcastHistory.update({
        where: { id: job.id },
        data: { status: "error", error: "attachment file missing on disk", finishedAt: new Date() },
      });
      return;
    }
  }

  // Cancel-флаг полим каждые 2 сек, кешируем локально (runBroadcast спрашивает синхронно).
  let cancelRequested = false;
  const cancelPoller = setInterval(() => {
    void (async () => {
      try {
        const row = await prisma.broadcastHistory.findUnique({
          where: { id: job.id },
          select: { cancelRequested: true },
        });
        if (row?.cancelRequested) cancelRequested = true;
      } catch { /* ignore */ }
    })();
  }, 2000);

  let lastProgressFlushAt = 0;
  let finalStatus: "completed" | "cancelled" | "error" | "pending" = "completed";
  let finalError: string | null = null;
  let lastResult: Awaited<ReturnType<typeof runBroadcast>> | undefined;

  try {
    lastResult = await runBroadcast({
      channel: job.channel as BroadcastChannel,
      subject: job.subject,
      message: job.message,
      attachment,
      buttonText: job.button_text ?? undefined,
      buttonUrl: job.button_url ?? undefined,
      targetGroup: (job.target_group ?? undefined) as BroadcastTargetGroup | undefined,
      broadcastId: job.id,
      isCancelled: () => cancelRequested || shuttingDown,
      onProgress: (p) => {
        const now = Date.now();
        if (now - lastProgressFlushAt < PROGRESS_FLUSH_MS) return;
        lastProgressFlushAt = now;
        void prisma.broadcastHistory.update({
          where: { id: job.id },
          data: {
            totalTelegram: p.totalTelegram,
            sentTelegram: p.sentTelegram,
            failedTelegram: p.failedTelegram,
            totalEmail: p.totalEmail,
            sentEmail: p.sentEmail,
            failedEmail: p.failedEmail,
          },
        }).catch(() => { /* ignore */ });
      },
    });
    // различаем источник cancel:
    //   • cancel_requested=true в DB — это пользователь нажал «Остановить» → cancelled
    //   • shutdown (SIGTERM/SIGINT) — это рестарт worker'а, рассылку НЕ обрывали →
    //     возвращаем в очередь (status='pending') чтобы новый worker подхватил.
    if (lastResult.cancelled) {
      finalStatus = cancelRequested ? "cancelled" : "pending";
      if (finalStatus === "pending") log(`  shutdown during processing — re-queueing ${job.id}`);
    } else {
      finalStatus = "completed";
    }
  } catch (e) {
    finalStatus = "error";
    finalError = e instanceof Error ? e.message : String(e);
    log(`  ERROR running ${job.id}:`, finalError);
  } finally {
    clearInterval(cancelPoller);
  }

  // Финализируем
  try {
    await prisma.broadcastHistory.update({
      where: { id: job.id },
      data: {
        status: finalStatus,
        // Если pending — finishedAt НЕ ставим (запись снова станет «активной»).
        finishedAt: finalStatus === "pending" ? null : new Date(),
        sentTelegram: lastResult?.sentTelegram ?? 0,
        failedTelegram: lastResult?.failedTelegram ?? 0,
        sentEmail: lastResult?.sentEmail ?? 0,
        failedEmail: lastResult?.failedEmail ?? 0,
        errors: lastResult?.errors?.length ? lastResult.errors.slice(0, 50) : undefined,
        error: finalError,
      },
    });
  } catch (e) {
    log(`  WARN: finalize update failed:`, e instanceof Error ? e.message : e);
  }

  // Удаляем attachment ТОЛЬКО при completed (для resume и retry он ещё нужен).
  if (job.attachment_path && finalStatus === "completed") {
    unlink(job.attachment_path).catch(() => { /* ignore */ });
  }

  log(`done ${job.id}: status=${finalStatus}, sent=${lastResult?.sentTelegram ?? 0}, failed=${lastResult?.failedTelegram ?? 0}`);
}

/**
 * На старте — реанимируем «зомби» (status='running' с прошлого падения worker'а):
 * переводим обратно в 'pending', чтобы взять и продолжить (sentLog сохранён,
 * skip уже отправленных получателей).
 */
async function reanimateZombies(): Promise<void> {
  const updated = await prisma.broadcastHistory.updateMany({
    where: { status: "running" },
    data: { status: "pending" },
  });
  if (updated.count > 0) {
    log(`reanimated ${updated.count} zombie 'running' broadcasts → 'pending'`);
  }
}

async function mainLoop(): Promise<void> {
  log(`starting (poll interval ${POLL_INTERVAL_MS}ms)`);
  await reanimateZombies();
  while (!shuttingDown) {
    try {
      const job = await claimNextJob();
      if (job) {
        await processOne(job);
        continue; // сразу проверяем следующую без сна
      }
    } catch (e) {
      log(`poll loop error:`, e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  log(`shutdown complete`);
  await prisma.$disconnect();
  process.exit(0);
}

void mainLoop();
