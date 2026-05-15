/**
 * StealthNewTicketModal — форма создания нового тикета.
 *
 * Поля:
 *   - Тема (опционально, max 500 chars)
 *   - Сообщение (required, max 4000 chars)
 *   - Прикрепить фото (опц., до 5 файлов)
 *
 * После создания: redirect на список (родитель сам сделает reload), модалка
 * закрывается, счётчик/список обновляется.
 */

import { useState, useRef } from "react";
import { Send, X, Loader2, AlertCircle, Paperclip, ImageIcon } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import { StealthModal } from "./stealth-modal";
import { StadiumButton } from "./stadium-button";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (id: string) => void;
}

const MAX_FILES = 5;
const MAX_BODY = 4000;
const MAX_SUBJECT = 500;

export function StealthNewTicketModal({ open, onClose, onCreated }: Props) {
  const { state } = useClientAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setSubject("");
    setBody("");
    setFiles([]);
    setBusy(false);
    setErr(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handlePickFiles(list: FileList | null) {
    if (!list) return;
    const arr = Array.from(list).slice(0, MAX_FILES - files.length);
    // Только image-файлы
    const onlyImages = arr.filter((f) => f.type.startsWith("image/"));
    setFiles((prev) => [...prev, ...onlyImages].slice(0, MAX_FILES));
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit() {
    if (!state.token || !body.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.createTicket(state.token, {
        subject: subject.trim() || "Без темы",
        message: body.trim(),
        files: files.length > 0 ? files : undefined,
      });
      onCreated?.(r.id);
      handleClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось создать обращение");
    } finally {
      setBusy(false);
    }
  }

  return (
    <StealthModal open={open} onClose={handleClose} title="Новое обращение">
      <div className="space-y-3">
        {/* Subject */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
            Тема <span className="text-zinc-600 normal-case font-normal tracking-normal">(необязательно)</span>
          </label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value.slice(0, MAX_SUBJECT))}
            placeholder="Кратко опишите проблему"
            className="w-full rounded-2xl bg-zinc-950/60 border border-white/[0.08] px-4 py-3 text-sm placeholder-zinc-500 outline-none focus:border-rose-500/40 transition"
          />
        </div>

        {/* Body */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Сообщение</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
            placeholder="Опишите вашу проблему или вопрос подробно…"
            rows={6}
            className="w-full rounded-2xl bg-zinc-950/60 border border-white/[0.08] px-4 py-3 text-sm placeholder-zinc-500 outline-none focus:border-rose-500/40 transition resize-none"
            autoFocus
          />
          <p className="text-[10px] text-zinc-600 text-right tabular-nums">
            {body.length} / {MAX_BODY}
          </p>
        </div>

        {/* Files */}
        <div className="space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handlePickFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={files.length >= MAX_FILES}
            className="w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-zinc-950/40 px-4 py-2.5 text-xs text-zinc-300 hover:bg-zinc-900/40 hover:border-white/25 transition disabled:opacity-50"
          >
            <Paperclip className="h-3.5 w-3.5" />
            Прикрепить фото
            {files.length > 0 && <span className="text-zinc-500">({files.length}/{MAX_FILES})</span>}
          </button>

          {files.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {files.map((f, idx) => (
                <div key={idx} className="relative rounded-xl border border-white/[0.06] bg-zinc-950/60 p-2 flex flex-col items-center gap-1 text-center">
                  <ImageIcon className="h-5 w-5 text-zinc-400" />
                  <p className="text-[9px] text-zinc-500 truncate w-full">{f.name}</p>
                  <button
                    onClick={() => removeFile(idx)}
                    className="absolute top-1 right-1 h-5 w-5 rounded-full bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 flex items-center justify-center transition"
                  >
                    <X className="h-3 w-3 text-rose-400" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {err && (
          <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 flex items-start gap-2 text-xs">
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="text-rose-200">{err}</span>
          </div>
        )}

        {/* Submit */}
        <StadiumButton
          variant="primary"
          size="md"
          iconLeft={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          onClick={submit}
          disabled={busy || !body.trim()}
        >
          {busy ? "Отправка…" : "Отправить"}
        </StadiumButton>
      </div>
    </StealthModal>
  );
}
