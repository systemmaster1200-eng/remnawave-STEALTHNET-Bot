/**
 * Admin permissions dialog.
 *
 * Открывается из /admin/admins при клике на «Permissions» рядом с каждым
 * админом. Показывает каталог критических действий (refund, debit_balance,
 * logout-all и т.п.) с чекбоксами — главный ADMIN может выдавать MANAGER'у
 * выборочные права на critical-операции.
 */

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Shield, AlertCircle, Save, Check, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { adminPermissionsApi, type ActionDef } from "@/lib/admin-extras-api";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  adminId: string | null;
  adminEmail?: string;
  onClose: () => void;
}

const GROUP_LABELS: Record<ActionDef["group"], string> = {
  payments: "Платежи",
  clients: "Клиенты",
  security: "Безопасность",
  operations: "Операции",
};

const SEVERITY_STYLES: Record<ActionDef["severity"], string> = {
  info: "border-sky-500/20 bg-sky-500/5",
  warn: "border-amber-500/30 bg-amber-500/5",
  critical: "border-rose-500/30 bg-rose-500/5",
};

export function AdminPermissionsDialog({ open, adminId, adminEmail, onClose }: Props) {
  const { state } = useAuth();
  const [actionsCatalog, setActionsCatalog] = useState<ActionDef[]>([]);
  const [granted, setGranted] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [adminMeta, setAdminMeta] = useState<{ email: string; role: string } | null>(null);

  useEffect(() => {
    if (!open || !adminId || !state.accessToken) return;
    setLoading(true);
    setErr(null);
    setSaved(false);
    Promise.all([
      adminPermissionsApi.actions(state.accessToken),
      adminPermissionsApi.get(state.accessToken, adminId),
    ])
      .then(([cat, cur]) => {
        setActionsCatalog(Array.isArray(cat?.actions) ? cat.actions : []);
        setGranted(new Set(Array.isArray(cur?.actions) ? cur.actions : []));
        setAdminMeta({ email: cur?.email ?? adminEmail ?? "", role: cur?.role ?? "" });
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "load error"))
      .finally(() => setLoading(false));
  }, [open, adminId, state.accessToken, adminEmail]);

  function toggle(key: string) {
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setSaved(false);
  }

  async function save() {
    if (!state.accessToken || !adminId) return;
    setBusy(true);
    setErr(null);
    try {
      await adminPermissionsApi.set(state.accessToken, adminId, Array.from(granted));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save error");
    } finally {
      setBusy(false);
    }
  }

  // group catalog by .group
  const grouped = actionsCatalog.reduce<Record<string, ActionDef[]>>((acc, a) => {
    if (!acc[a.group]) acc[a.group] = [];
    acc[a.group].push(a);
    return acc;
  }, {});

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Granular permissions
          </DialogTitle>
          <DialogDescription>
            Critical-действия для <code>{adminMeta?.email ?? adminEmail ?? "—"}</code>
            {adminMeta?.role && <span className="ml-2 px-2 py-0.5 rounded-md bg-foreground/[0.05] text-[10px] uppercase tracking-wider">{adminMeta.role}</span>}
          </DialogDescription>
        </DialogHeader>

        {adminMeta?.role === "ADMIN" && (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 flex items-start gap-2 text-xs">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <span className="text-amber-600 dark:text-amber-400">
              Это полный ADMIN — все действия доступны независимо от этих галок. Permissions имеют смысл только для MANAGER.
            </span>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : err ? (
          <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 p-3 flex items-center gap-2 text-xs">
            <AlertCircle className="h-4 w-4 text-rose-500 shrink-0" />
            <span className="text-rose-500">{err}</span>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(grouped).map(([group, actions]) => (
              <div key={group}>
                <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">{GROUP_LABELS[group as ActionDef["group"]] ?? group}</h4>
                <div className="space-y-1.5">
                  {actions.map((a) => {
                    const checked = granted.has(a.key);
                    return (
                      <label
                        key={a.key}
                        className={cn(
                          "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition",
                          SEVERITY_STYLES[a.severity],
                          checked && "ring-2 ring-primary/40",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(a.key)}
                          className="h-4 w-4 mt-0.5 accent-primary cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{a.label}</span>
                            {a.severity === "critical" && (
                              <span className="text-[9px] uppercase tracking-wider bg-rose-500/15 text-rose-500 rounded-md px-1.5 py-0.5 font-bold">critical</span>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{a.description}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
          <Button variant="outline" onClick={onClose}>Закрыть</Button>
          <Button onClick={save} disabled={busy || loading} className="gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {saved ? "Сохранено" : "Сохранить"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
