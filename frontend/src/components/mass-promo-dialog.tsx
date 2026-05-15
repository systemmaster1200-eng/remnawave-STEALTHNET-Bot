/**
 * Dialog для массового создания промокодов.
 *
 * Открывается из /admin/promo-codes по кнопке «Сгенерировать пачку».
 * После генерации показывает список созданных кодов с кнопкой «Скачать .txt».
 */

import { useState } from "react";
import { Loader2, Wand2, Download, X, AlertCircle, Check } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth";
import { cn } from "@/lib/utils";

type PromoType = "DISCOUNT" | "FREE_DAYS";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
  squads?: { uuid: string; name?: string }[];
}

export function MassPromoDialog({ open, onClose, onCreated, squads = [] }: Props) {
  const { state } = useAuth();

  const [count, setCount] = useState(50);
  const [prefix, setPrefix] = useState("");
  const [length, setLength] = useState(10);
  const [alphabet, setAlphabet] = useState<"ALPHA" | "ALPHANUM" | "NUM">("ALPHANUM");
  const [type, setType] = useState<PromoType>("DISCOUNT");

  // DISCOUNT
  const [discountPercent, setDiscountPercent] = useState<string>("10");
  const [discountFixed, setDiscountFixed] = useState<string>("");

  // FREE_DAYS
  const [squadUuid, setSquadUuid] = useState("");
  const [durationDays, setDurationDays] = useState("7");

  // common
  const [maxUses, setMaxUses] = useState("1");
  const [maxUsesPerClient, setMaxUsesPerClient] = useState("1");
  const [expiresAt, setExpiresAt] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ generated: string[]; failed: { code: string; reason: string }[]; total: number } | null>(null);

  function reset() {
    setResult(null);
    setErr(null);
    setBusy(false);
  }

  async function handleGenerate() {
    if (!state.accessToken) return;
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        count,
        length,
        alphabet,
        prefix: prefix.trim() || undefined,
        type,
        maxUses: Number(maxUses) || 0,
        maxUsesPerClient: Number(maxUsesPerClient) || 0,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      };
      if (type === "DISCOUNT") {
        if (discountPercent.trim()) body.discountPercent = Number(discountPercent);
        if (discountFixed.trim()) body.discountFixed = Number(discountFixed);
      } else {
        body.squadUuid = squadUuid.trim();
        body.durationDays = Number(durationDays);
      }

      const r = await fetch("/api/admin/promo-codes/bulk-generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${state.accessToken}`,
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const txt = await r.text();
        let msg = `${r.status}`;
        try { msg = JSON.parse(txt).message ?? msg; } catch { msg = txt || msg; }
        throw new Error(msg);
      }
      const data = await r.json();
      setResult(data);
      onCreated?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Bulk generate failed");
    } finally {
      setBusy(false);
    }
  }

  function downloadTxt() {
    if (!result?.generated.length) return;
    const blob = new Blob([result.generated.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `promo-codes-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyAll() {
    if (!result?.generated.length) return;
    navigator.clipboard.writeText(result.generated.join("\n"));
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" />
            Массовая генерация промокодов
          </DialogTitle>
          <DialogDescription>
            Создаёт N кодов одинаковой конфигурации. Уникальные суффиксы — random.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4 mt-2">
            {/* Базовые параметры */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Сколько кодов</Label>
                <Input type="number" min={1} max={1000} value={count} onChange={(e) => setCount(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} />
              </div>
              <div>
                <Label className="text-xs">Длина кода (без префикса)</Label>
                <Input type="number" min={4} max={20} value={length} onChange={(e) => setLength(Math.max(4, Math.min(20, Number(e.target.value) || 10)))} />
              </div>
              <div>
                <Label className="text-xs">Префикс (опц., до 12)</Label>
                <Input value={prefix} onChange={(e) => setPrefix(e.target.value.slice(0, 12).toUpperCase())} placeholder="BLACKFRI-" />
              </div>
              <div>
                <Label className="text-xs">Алфавит</Label>
                <select className="w-full h-9 rounded-md bg-background border border-input px-3 text-sm" value={alphabet} onChange={(e) => setAlphabet(e.target.value as "ALPHA" | "ALPHANUM" | "NUM")}>
                  <option value="ALPHANUM">Буквы+цифры (без 0/O/1/I)</option>
                  <option value="ALPHA">Только буквы</option>
                  <option value="NUM">Только цифры</option>
                </select>
              </div>
            </div>

            {/* Тип */}
            <div>
              <Label className="text-xs">Тип</Label>
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => setType("DISCOUNT")}
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition",
                    type === "DISCOUNT" ? "bg-primary text-primary-foreground border-primary" : "bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 hover:bg-foreground/[0.06]",
                  )}
                >Скидка</button>
                <button
                  onClick={() => setType("FREE_DAYS")}
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition",
                    type === "FREE_DAYS" ? "bg-primary text-primary-foreground border-primary" : "bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 hover:bg-foreground/[0.06]",
                  )}
                >Бесплатные дни</button>
              </div>
            </div>

            {/* Параметры по типу */}
            {type === "DISCOUNT" ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Скидка, %</Label>
                  <Input type="number" min={0} max={100} value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Или фикс. скидка (валюта)</Label>
                  <Input type="number" min={0} value={discountFixed} onChange={(e) => setDiscountFixed(e.target.value)} placeholder="например 100" />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs">Squad UUID (Remnawave)</Label>
                  {squads.length > 0 ? (
                    <select className="w-full h-9 rounded-md bg-background border border-input px-3 text-sm" value={squadUuid} onChange={(e) => setSquadUuid(e.target.value)}>
                      <option value="">— выберите —</option>
                      {squads.map((s) => <option key={s.uuid} value={s.uuid}>{s.name || s.uuid}</option>)}
                    </select>
                  ) : (
                    <Input value={squadUuid} onChange={(e) => setSquadUuid(e.target.value)} placeholder="uuid сквада" />
                  )}
                </div>
                <div>
                  <Label className="text-xs">Сколько дней</Label>
                  <Input type="number" min={1} max={3650} value={durationDays} onChange={(e) => setDurationDays(e.target.value)} />
                </div>
              </div>
            )}

            {/* Общие */}
            <div className="grid grid-cols-3 gap-3 pt-2 border-t border-white/10">
              <div>
                <Label className="text-xs">Активаций на код (0 = ∞)</Label>
                <Input type="number" min={0} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">На клиента (0 = ∞)</Label>
                <Input type="number" min={0} value={maxUsesPerClient} onChange={(e) => setMaxUsesPerClient(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Истекает</Label>
                <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              </div>
            </div>

            {err && (
              <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 p-3 flex items-start gap-2 text-xs">
                <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                <span className="text-rose-500">{err}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { reset(); onClose(); }} disabled={busy}>Отмена</Button>
              <Button onClick={handleGenerate} disabled={busy} className="gap-2">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                Сгенерировать {count}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 mt-2">
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4 flex items-center gap-3">
              <Check className="h-5 w-5 text-emerald-500 shrink-0" />
              <div className="text-sm flex-1">
                <p className="font-semibold text-emerald-600 dark:text-emerald-400">Сгенерировано {result.generated.length} из {result.total}</p>
                {result.failed.length > 0 && (
                  <p className="text-xs text-amber-500 mt-0.5">Ошибки: {result.failed.length} (см. ниже)</p>
                )}
              </div>
            </div>

            <div className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border border-white/10 max-h-[280px] overflow-y-auto p-3 font-mono text-xs space-y-0.5">
              {result.generated.map((c) => <div key={c} className="select-all">{c}</div>)}
            </div>

            {result.failed.length > 0 && (
              <details className="rounded-lg bg-rose-500/5 border border-rose-500/20 p-3">
                <summary className="cursor-pointer text-xs text-rose-500 font-medium">Ошибки ({result.failed.length})</summary>
                <ul className="mt-2 text-xs space-y-1">
                  {result.failed.map((f, i) => <li key={i}><code>{f.code}</code> — {f.reason}</li>)}
                </ul>
              </details>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
              <Button variant="outline" onClick={copyAll} className="gap-2">
                <X className="h-4 w-4" />
                Скопировать все
              </Button>
              <Button variant="outline" onClick={downloadTxt} className="gap-2">
                <Download className="h-4 w-4" />
                Скачать .txt
              </Button>
              <Button onClick={() => { reset(); onClose(); }}>Готово</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
