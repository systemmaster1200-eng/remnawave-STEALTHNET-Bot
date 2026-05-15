/**
 * Dialog для CSV-импорта тарифов.
 *
 * Workflow: paste/upload CSV → preview (dryRun) → apply.
 * Кнопка экспорта здесь же — просто скачивает текущий CSV.
 */

import { useState, useRef } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Download, Upload, FileSpreadsheet, AlertCircle, Check, FileText } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onApplied?: () => void;
}

interface PreviewRow { action: string; id: string; name: string; price: string; duration_days: number; included_devices: number; category_id: string; }
interface DryRunResult { dryRun: true; total: number; wouldCreate: number; wouldUpdate: number; previewRows: PreviewRow[]; }
interface ApplyResult { dryRun: false; total: number; created: number; updated: number; errors: { row: number; error: string }[]; }

export function TariffCsvDialog({ open, onClose, onApplied }: Props) {
  const { state } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState<"export" | "dryRun" | "apply" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<DryRunResult | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);

  function reset() {
    setCsv("");
    setBusy(null);
    setErr(null);
    setPreview(null);
    setResult(null);
  }

  async function handleExport() {
    if (!state.accessToken) return;
    setBusy("export");
    setErr(null);
    try {
      const r = await fetch("/api/admin/tariffs-csv/export", {
        headers: { Authorization: `Bearer ${state.accessToken}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tariffs-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleDryRun() {
    if (!state.accessToken || !csv.trim()) {
      setErr("Сначала вставьте CSV или загрузите файл");
      return;
    }
    setBusy("dryRun");
    setErr(null);
    setPreview(null);
    setResult(null);
    try {
      const r = await fetch("/api/admin/tariffs-csv/import?dryRun=1", {
        method: "POST",
        headers: {
          "Content-Type": "text/csv",
          Authorization: `Bearer ${state.accessToken}`,
        },
        body: csv,
      });
      const data = await r.json();
      if (!r.ok) {
        setErr(data.message ?? `HTTP ${r.status}`);
        if (Array.isArray(data.errors)) {
          setErr((data.message ?? "Ошибки") + ":\n" + data.errors.map((e: { row: number; error: string }) => `строка ${e.row}: ${e.error}`).slice(0, 10).join("\n"));
        }
        return;
      }
      setPreview(data as DryRunResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Dry-run failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleApply() {
    if (!state.accessToken || !csv.trim()) return;
    setBusy("apply");
    setErr(null);
    try {
      const r = await fetch("/api/admin/tariffs-csv/import", {
        method: "POST",
        headers: {
          "Content-Type": "text/csv",
          Authorization: `Bearer ${state.accessToken}`,
        },
        body: csv,
      });
      const data = await r.json();
      if (!r.ok) {
        setErr(data.message ?? `HTTP ${r.status}`);
        return;
      }
      setResult(data as ApplyResult);
      onApplied?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Apply failed");
    } finally {
      setBusy(null);
    }
  }

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => setCsv(reader.result as string);
    reader.readAsText(file);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Импорт / экспорт тарифов (CSV)
          </DialogTitle>
          <DialogDescription>
            Экспорт даёт CSV всех тарифов; импорт — обновляет существующие (по id) или создаёт новые (id пустой).
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 mt-2 pt-2 border-b border-white/10 pb-3">
          <Button variant="outline" onClick={handleExport} disabled={busy !== null} className="gap-2">
            {busy === "export" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Скачать текущие
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()} className="gap-2" disabled={busy !== null}>
            <Upload className="h-4 w-4" />
            Загрузить файл
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </div>

        <div className="mt-3">
          <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-1 block">CSV-данные</label>
          <textarea
            className="w-full h-40 rounded-lg bg-foreground/[0.03] dark:bg-white/[0.02] border border-white/10 p-3 font-mono text-xs"
            placeholder="id,category_id,name,description,duration_days,price,currency,..."
            value={csv}
            onChange={(e) => { setCsv(e.target.value); setPreview(null); setResult(null); }}
            spellCheck={false}
          />
        </div>

        {err && (
          <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 p-3 flex items-start gap-2 text-xs">
            <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
            <pre className="text-rose-500 whitespace-pre-wrap break-all">{err}</pre>
          </div>
        )}

        {preview && (
          <div className="rounded-xl bg-sky-500/5 border border-sky-500/20 p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-sky-500" />
              <span className="font-semibold text-sky-600 dark:text-sky-400">
                Превью: {preview.wouldCreate} создать, {preview.wouldUpdate} обновить (всего {preview.total})
              </span>
            </div>
            <div className="rounded-lg bg-foreground/[0.03] dark:bg-white/[0.02] border border-white/10 max-h-[260px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-foreground/[0.03] dark:bg-white/[0.02] text-muted-foreground uppercase">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-semibold">Действие</th>
                    <th className="px-2 py-1.5 text-left font-semibold">ID</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Имя</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Цена</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Дни</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Устройств</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {preview.previewRows.map((r, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1.5">
                        <span className={cn(
                          "rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase",
                          r.action === "create" ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500",
                        )}>{r.action}</span>
                      </td>
                      <td className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground">{r.id.slice(0, 12)}</td>
                      <td className="px-2 py-1.5 truncate max-w-[200px]">{r.name}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.price}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.duration_days}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.included_devices}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.previewRows.length < preview.total && (
              <p className="text-xs text-muted-foreground italic">Показано первых {preview.previewRows.length} из {preview.total}</p>
            )}
          </div>
        )}

        {result && (
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3 flex items-start gap-2 text-sm">
            <Check className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                Применено: создано {result.created}, обновлено {result.updated}
                {result.errors.length > 0 && ` · ошибок ${result.errors.length}`}
              </p>
              {result.errors.length > 0 && (
                <details className="mt-1.5 text-xs">
                  <summary className="cursor-pointer text-amber-500">Показать ошибки</summary>
                  <ul className="mt-1 space-y-0.5">
                    {result.errors.map((e, i) => <li key={i}>строка {e.row}: {e.error}</li>)}
                  </ul>
                </details>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Закрыть</Button>
          <Button variant="outline" onClick={handleDryRun} disabled={busy !== null || !csv.trim()} className="gap-2">
            {busy === "dryRun" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Превью (dry-run)
          </Button>
          <Button onClick={handleApply} disabled={busy !== null || !csv.trim() || !preview} className="gap-2">
            {busy === "apply" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Применить
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
