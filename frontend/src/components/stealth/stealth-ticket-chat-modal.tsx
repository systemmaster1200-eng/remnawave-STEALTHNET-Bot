/**
 * StealthTicketChatModal — переписка по конкретному тикету в lightbox-modalке.
 *
 * Полный chat-flow:
 *   - Заголовок: тема тикета + статус (Открыт/Закрыт)
 *   - Скроллируемый список сообщений (client справа, support слева)
 *   - Дата каждого сообщения
 *   - Превью вложений (картинки) с кликом для просмотра
 *   - Input + attach + send (если тикет открыт)
 *   - Auto-scroll к низу при новых сообщениях
 *
 * Использует api.getTicket + api.replyTicket.
 */

import { useEffect, useRef, useState } from "react";
import { Send, Loader2, AlertCircle, Paperclip, ImageIcon, X as XIcon, RefreshCw } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type TicketMessageDto } from "@/lib/api";
import { StealthModal } from "./stealth-modal";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  ticketId: string | null;
  onClose: () => void;
}

interface TicketDetail {
  id: string;
  subject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  messages: TicketMessageDto[];
}

const MAX_FILES = 5;
const POLL_MS = 8000;

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

export function StealthTicketChatModal({ open, ticketId, onClose }: Props) {
  const { state } = useClientAuth();
  const [data, setData] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    if (!state.token || !ticketId) return;
    setErr(null);
    try {
      const r = await api.getTicket(state.token, ticketId);
      setData(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось загрузить тикет");
    }
  }

  // Initial load + polling
  useEffect(() => {
    if (!open || !ticketId) return;
    setLoading(true);
    load().finally(() => setLoading(false));
    // Polling каждые 8 сек чтобы видеть новые ответы поддержки
    pollRef.current = setInterval(load, POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ticketId, state.token]);

  // Auto-scroll к низу при новых сообщениях
  useEffect(() => {
    if (data?.messages?.length && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [data?.messages?.length]);

  // Reset при закрытии
  useEffect(() => {
    if (!open) {
      setReply("");
      setFiles([]);
      setData(null);
      setErr(null);
    }
  }, [open]);

  function pickFiles(list: FileList | null) {
    if (!list) return;
    const arr = Array.from(list).slice(0, MAX_FILES - files.length).filter((f) => f.type.startsWith("image/"));
    setFiles((prev) => [...prev, ...arr].slice(0, MAX_FILES));
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function send() {
    if (!state.token || !ticketId) return;
    const trimmed = reply.trim();
    if (!trimmed && files.length === 0) return;
    setSending(true);
    setErr(null);
    try {
      await api.replyTicket(state.token, ticketId, { content: trimmed, files: files.length > 0 ? files : undefined });
      setReply("");
      setFiles([]);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось отправить");
    } finally {
      setSending(false);
    }
  }

  const isClosed = data?.status === "closed";
  const subject = data?.subject || "Без темы";

  return (
    <StealthModal open={open} onClose={onClose} title={subject} maxWidth="32rem">
      {/* Status pill */}
      {data && (
        <div className="-mt-2 mb-3">
          <span className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
            isClosed ? "bg-zinc-800/60 text-zinc-400 border-white/10" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
          )}>
            {isClosed ? "Закрыт" : "Открыт"}
          </span>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className="rounded-2xl border border-white/[0.06] bg-zinc-950/40 p-3 mb-3 h-[50vh] overflow-y-auto space-y-2"
      >
        {loading && !data ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-rose-500" />
          </div>
        ) : err && !data ? (
          <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-200 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{err}</span>
          </div>
        ) : data?.messages?.length === 0 ? (
          <div className="text-center text-xs text-zinc-500 py-6">Сообщений пока нет</div>
        ) : (
          data?.messages?.map((m) => {
            const isClient = m.authorType === "client";
            return (
              <div key={m.id} className={cn("flex", isClient ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[80%] rounded-2xl px-3 py-2",
                  isClient
                    ? "bg-rose-500/[0.12] border border-rose-500/20"
                    : "bg-zinc-800/60 border border-white/[0.06]",
                )}>
                  <p className="text-sm text-zinc-100 whitespace-pre-wrap break-words">{m.content}</p>
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      {m.attachments.map((att, i) => (
                        <a
                          key={i}
                          href={att.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block rounded-lg overflow-hidden bg-zinc-950/40 border border-white/10 hover:border-white/30 transition"
                        >
                          {att.mime.startsWith("image/") ? (
                            <img src={att.url} alt="" className="w-full h-20 object-cover" loading="lazy" />
                          ) : (
                            <div className="h-20 flex items-center justify-center text-zinc-400">
                              <ImageIcon className="h-5 w-5" />
                            </div>
                          )}
                        </a>
                      ))}
                    </div>
                  )}
                  <p className={cn(
                    "text-[9px] mt-1 tabular-nums",
                    isClient ? "text-rose-300/70" : "text-zinc-500",
                  )}>
                    {fmtTime(m.createdAt)}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {err && data && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-2.5 text-xs text-rose-200 mb-2">{err}</div>
      )}

      {/* Reply form */}
      {isClosed ? (
        <div className="rounded-2xl border border-white/[0.06] bg-zinc-950/40 p-3 text-xs text-zinc-400 text-center">
          Тикет закрыт. Напишите новое обращение если нужна дополнительная помощь.
        </div>
      ) : (
        <div className="space-y-2">
          {/* File previews */}
          {files.length > 0 && (
            <div className="grid grid-cols-3 gap-1.5">
              {files.map((f, idx) => (
                <div key={idx} className="relative rounded-xl border border-white/[0.06] bg-zinc-950/60 p-1.5 flex flex-col items-center gap-0.5">
                  <ImageIcon className="h-4 w-4 text-zinc-400" />
                  <p className="text-[8px] text-zinc-500 truncate w-full text-center">{f.name}</p>
                  <button
                    onClick={() => removeFile(idx)}
                    className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-rose-500 flex items-center justify-center"
                  >
                    <XIcon className="h-2.5 w-2.5 text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => pickFiles(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={files.length >= MAX_FILES || sending}
              className="h-11 w-11 rounded-2xl border border-white/[0.08] bg-zinc-950/60 hover:bg-zinc-900/80 flex items-center justify-center text-zinc-400 hover:text-zinc-200 disabled:opacity-40 transition shrink-0"
              aria-label="Прикрепить"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!sending) send();
                }
              }}
              placeholder="Введите сообщение…"
              rows={1}
              className="flex-1 min-h-[44px] max-h-32 rounded-2xl bg-zinc-950/60 border border-white/[0.08] px-3 py-3 text-sm placeholder-zinc-500 outline-none focus:border-rose-500/40 transition resize-none"
            />
            <button
              type="button"
              onClick={send}
              disabled={sending || (!reply.trim() && files.length === 0)}
              className="h-11 w-11 rounded-2xl bg-gradient-to-b from-rose-500 to-rose-600 hover:from-rose-500 hover:to-rose-500 shadow-[0_0_20px_-4px_rgba(255,35,87,0.5)] flex items-center justify-center text-white disabled:opacity-40 disabled:shadow-none transition shrink-0"
              aria-label="Отправить"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>

          {/* Refresh */}
          <button
            onClick={load}
            className="w-full text-[10px] text-zinc-500 hover:text-zinc-300 inline-flex items-center justify-center gap-1 py-1 transition"
          >
            <RefreshCw className="h-2.5 w-2.5" />
            Обновить
          </button>
        </div>
      )}
    </StealthModal>
  );
}
