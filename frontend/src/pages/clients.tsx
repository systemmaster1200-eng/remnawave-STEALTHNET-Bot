import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/auth";
import {
  api,
  type ClientRecord,
  type UpdateClientPayload,
  type UpdateClientRemnaPayload,
  type RemnaUserFull,
  type RemnaHwidDevice,
  type RemnaUserUsageResponse,
  type AdminSecondarySubscription,
  type TariffCategoryWithTariffs,
  type TariffRecord,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Pencil, Trash2, Ban, ShieldCheck, Wifi, Ticket, KeyRound, Search,
  Copy, Check, Smartphone, Activity, User, Users, Settings, HardDrive, Link, Unlink,
  RefreshCw, Loader2, Package, Gift, Coins, MailX, MailCheck, RotateCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { clientsBulkApi, type BulkClientAction } from "@/lib/admin-extras-api";

function formatTrafficBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 2 : 0)} ${units[i]}`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: "Активен", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" },
  DISABLED: { label: "Отключён", color: "bg-red-500/15 text-red-400 border-red-500/20" },
  LIMITED: { label: "Лимит", color: "bg-amber-500/15 text-amber-400 border-amber-500/20" },
  EXPIRED: { label: "Истёк", color: "bg-gray-500/15 text-gray-400 border-gray-500/20" },
};

const STRATEGY_LABELS: Record<string, string> = {
  NO_RESET: "Без сброса",
  DAY: "Ежедневно",
  WEEK: "Еженедельно",
  MONTH: "Ежемесячно",
  MONTH_ROLLING: "Скользящий месяц",
};

function getOnlineStatus(onlineAt: string | null): { isOnline: boolean; label: string } {
  if (!onlineAt) return { isOnline: false, label: "Не подключался" };
  const diff = Date.now() - new Date(onlineAt).getTime();
  if (diff < 2 * 60 * 1000) return { isOnline: true, label: "Онлайн" };
  if (diff < 60 * 60 * 1000) return { isOnline: false, label: `${Math.floor(diff / 60000)} мин назад` };
  if (diff < 24 * 60 * 60 * 1000) return { isOnline: false, label: `${Math.floor(diff / 3600000)} ч назад` };
  return { isOnline: false, label: `${Math.floor(diff / 86400000)} дн назад` };
}
export function ClientsPage() {
  const { t } = useTranslation();
  const { state } = useAuth();
  const [data, setData] = useState<{ items: ClientRecord[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<ClientRecord | null>(null);
  const [editForm, setEditForm] = useState<UpdateClientPayload & Partial<UpdateClientRemnaPayload>>({});
  const [remnaData, setRemnaData] = useState<{ squads: { uuid: string; name?: string }[] }>({ squads: [] });
  const [clientRemnaSquads, setClientRemnaSquads] = useState<string[]>([]);
  const [settings, setSettings] = useState<{ activeLanguages: string[]; activeCurrencies: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [passwordForm, setPasswordForm] = useState<{ newPassword: string; confirm: string }>({ newPassword: "", confirm: "" });
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);
  const [search, setSearch] = useState("");
  const [searchApplied, setSearchApplied] = useState("");
  const [filterBlocked, setFilterBlocked] = useState<"all" | "blocked" | "active">("all");

  // ─── Bulk-actions state ───────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<BulkClientAction | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<{ ok: number; failed: number } | null>(null);
  // optional inputs
  const [bulkAmount, setBulkAmount] = useState("");
  const [bulkReason, setBulkReason] = useState("");

  const [onlineStatuses, setOnlineStatuses] = useState<Record<string, { onlineAt: string | null }>>({});

  const token = state.accessToken!;

  useEffect(() => {
    api.getSettings(token).then((s) => setSettings({ activeLanguages: s.activeLanguages, activeCurrencies: s.activeCurrencies })).catch(() => {});
  }, [token]);

  const loadClients = () => {
    setLoading(true);
    const isBlocked =
      filterBlocked === "blocked" ? true : filterBlocked === "active" ? false : undefined;
    api.getClients(token, page, 20, { search: searchApplied || undefined, isBlocked }).then((r) => {
      setData({ items: r.items, total: r.total });
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  // ─── Bulk-actions helpers ─────────────────────────────────────────────
  const allRowIds = (data?.items ?? []).map((c) => c.id);
  const allSelected = allRowIds.length > 0 && allRowIds.every((id) => selectedIds.has(id));
  function toggleId(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(allRowIds));
  }
  function clearSelection() {
    setSelectedIds(new Set());
    setBulkError(null);
    setBulkResult(null);
    setBulkAmount("");
    setBulkReason("");
  }
  async function runBulk(action: BulkClientAction) {
    if (selectedIds.size === 0) return;
    setBulkBusy(action);
    setBulkError(null);
    setBulkResult(null);
    try {
      const params: { reason?: string; amount?: number } = {};
      if (action === "credit_balance" || action === "debit_balance") {
        const n = parseFloat(bulkAmount);
        if (!Number.isFinite(n) || n <= 0) {
          setBulkError("Введите положительное число для amount");
          setBulkBusy(null);
          return;
        }
        params.amount = n;
      }
      if (action === "block" && bulkReason) params.reason = bulkReason;

      const r = await clientsBulkApi.bulk(token, {
        action,
        ids: Array.from(selectedIds),
        params: Object.keys(params).length ? params : undefined,
      });
      setBulkResult({ ok: r.ok, failed: r.failed });
      if (r.failed === 0) {
        // полный успех — снимаем выделение и перезагружаем
        setTimeout(() => {
          setSelectedIds(new Set());
          loadClients();
        }, 1500);
      } else {
        loadClients();
      }
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : "bulk error");
    } finally {
      setBulkBusy(null);
    }
  }

  useEffect(() => {
    loadClients();
  }, [token, page, searchApplied, filterBlocked]);

  useEffect(() => {
    const uuids = data?.items
      .map(c => c.remnawaveUuid)
      .filter((u): u is string => Boolean(u)) ?? [];
    if (uuids.length === 0) return;
    
    const poll = () => {
      api.getClientsOnlineStatuses(token, uuids)
        .then(setOnlineStatuses)
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 30000);
    return () => clearInterval(interval);
  }, [token, data?.items]);

  const applySearch = () => {
    setSearchApplied(search);
    setPage(1);
  };

  useEffect(() => {
    if (editing?.remnawaveUuid) {
      api.getRemnaSquadsInternal(token).then((raw: unknown) => {
        const res = raw as { response?: { internalSquads?: { uuid: string; name?: string }[] } };
        const items = res?.response?.internalSquads ?? (Array.isArray(res) ? res : []);
        setRemnaData({ squads: Array.isArray(items) ? items : [] });
      }).catch(() => setRemnaData({ squads: [] }));
      api.getClientRemna(token, editing.id).then((raw: unknown) => {
        const res = raw as { response?: { activeInternalSquads?: Array<{ uuid?: string } | string> } };
        const arr = res?.response?.activeInternalSquads ?? [];
        const uuids = Array.isArray(arr) ? arr.map((s) => (typeof s === "string" ? s : s?.uuid)).filter((u): u is string => Boolean(u)) : [];
        setClientRemnaSquads(uuids);
      }).catch(() => setClientRemnaSquads([]));
    } else {
      setRemnaData({ squads: [] });
      setClientRemnaSquads([]);
    }
  }, [token, editing?.id, editing?.remnawaveUuid]);

  function openEdit(c: ClientRecord) {
    setEditing(c);
    setEditForm({
      email: c.email ?? undefined,
      preferredLang: c.preferredLang,
      preferredCurrency: c.preferredCurrency,
      balance: c.balance,
      isBlocked: c.isBlocked,
      blockReason: c.blockReason ?? undefined,
      referralPercent: c.referralPercent ?? undefined,
      personalDiscountPercent: c.personalDiscountPercent ?? undefined,
    });
    setActionMessage(null);
  }

  async function saveClient() {
    if (!editing) return;
    setSaving(true);
    setActionMessage(null);
    try {
      const updated = await api.updateClient(token, editing.id, {
        email: editForm.email ?? null,
        preferredLang: editForm.preferredLang,
        preferredCurrency: editForm.preferredCurrency,
        balance: editForm.balance,
        isBlocked: editForm.isBlocked,
        blockReason: editForm.blockReason ?? null,
        referralPercent: editForm.referralPercent ?? null,
        personalDiscountPercent: editForm.personalDiscountPercent ?? null,
      });
      setEditing(updated);
      // Пересоздаём форму из обновлённых данных, иначе input'ы (привязанные к editForm)
      // показали бы пустые значения после save, и нужно было бы переоткрыть карточку.
      setEditForm({
        email: updated.email ?? undefined,
        preferredLang: updated.preferredLang,
        preferredCurrency: updated.preferredCurrency,
        balance: updated.balance,
        isBlocked: updated.isBlocked,
        blockReason: updated.blockReason ?? undefined,
        referralPercent: updated.referralPercent ?? undefined,
        personalDiscountPercent: updated.personalDiscountPercent ?? undefined,
      });
      setActionMessage(t("admin.clients.saved"));
      loadClients();
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : t("admin.clients.error"));
    } finally {
      setSaving(false);
    }
  }

  async function saveRemnaLimits() {
    if (!editing?.remnawaveUuid) return;
    setSaving(true);
    setActionMessage(null);
    try {
      const payload: UpdateClientRemnaPayload = {};
      if (editForm.trafficLimitBytes !== undefined) payload.trafficLimitBytes = editForm.trafficLimitBytes;
      if (editForm.trafficLimitStrategy) payload.trafficLimitStrategy = editForm.trafficLimitStrategy;
      if (editForm.hwidDeviceLimit !== undefined) payload.hwidDeviceLimit = editForm.hwidDeviceLimit;
      if (editForm.expireAt) payload.expireAt = editForm.expireAt;
      await api.updateClientRemna(token, editing.id, payload);
      setActionMessage(t("admin.clients.remna_limits_updated"));
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : t("admin.clients.error"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteClient(c: ClientRecord) {
    if (!confirm(`Удалить клиента ${c.email || c.telegramId || c.id}?`)) return;
    try {
      await api.deleteClient(token, c.id);
      if (editing?.id === c.id) setEditing(null);
      loadClients();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка удаления");
    }
  }

  async function remnaAction(
    name: string,
    fn: () => Promise<unknown>
  ) {
    setActionMessage(null);
    try {
      await fn();
      setActionMessage(name + " — ок");
      loadClients();
    } catch (e) {
      setActionMessage(name + ": " + (e instanceof Error ? e.message : "ошибка"));
    }
  }

  async function saveClientPassword() {
    if (!editing) return;
    if (passwordForm.newPassword.length < 8) {
      setPasswordMessage(t("admin.clients.password_min_8"));
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirm) {
      setPasswordMessage(t("admin.clients.passwords_mismatch"));
      return;
    }
    setPasswordMessage(null);
    setSavingPassword(true);
    try {
      await api.setClientPassword(token, editing.id, passwordForm.newPassword);
      setPasswordMessage(t("admin.clients.password_set"));
      setPasswordForm({ newPassword: "", confirm: "" });
    } catch (e) {
      setPasswordMessage(e instanceof Error ? e.message : t("admin.clients.error"));
    } finally {
      setSavingPassword(false);
    }
  }

  async function squadAdd(squadUuid: string) {
    if (!editing) return;
    await remnaAction(t("admin.clients.squad_added"), () => api.clientRemnaSquadAdd(token, editing.id, squadUuid));
    setClientRemnaSquads((prev) => (prev.includes(squadUuid) ? prev : [...prev, squadUuid]));
  }

  async function squadRemove(squadUuid: string) {
    if (!editing) return;
    await remnaAction(t("admin.clients.squad_removed"), () => api.clientRemnaSquadRemove(token, editing.id, squadUuid));
    setClientRemnaSquads((prev) => prev.filter((u) => u !== squadUuid));
  }

  const totalPages = data ? Math.ceil(data.total / 20) : 0;
  return (
    <div className="space-y-6 relative min-h-screen">
      {/* Ambient Glows */}
      <div className="fixed -z-10 bg-primary/15 blur-[120px] top-[-50px] left-[-50px] w-[300px] h-[300px] rounded-full pointer-events-none" />
      <div className="fixed -z-10 bg-purple-500/10 blur-[100px] top-[20%] right-[-50px] w-[250px] h-[250px] rounded-full pointer-events-none" />

      {/* HEADER */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between bg-background/40 backdrop-blur-3xl border border-white/10 p-6 rounded-[2rem] shadow-2xl"
      >
        {/* Decorative gradient orb in corner */}
        <div className="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-gradient-to-br from-primary/20 via-purple-500/15 to-transparent blur-2xl pointer-events-none" />
        <div className="absolute -bottom-12 -left-12 h-32 w-32 rounded-full bg-gradient-to-tr from-cyan-500/15 to-transparent blur-2xl pointer-events-none" />

        <div className="relative flex items-center gap-4">
          <motion.div
            whileHover={{ scale: 1.05, rotate: 4 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="relative h-14 w-14 rounded-2xl bg-gradient-to-br from-primary/30 via-purple-500/20 to-cyan-500/15 flex items-center justify-center shadow-inner border border-white/10 shrink-0"
          >
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/10 to-transparent" />
            <Users className="relative h-7 w-7 text-primary" />
          </motion.div>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground via-primary to-foreground/70 dark:from-foreground dark:via-primary dark:to-foreground/60">
              {t("admin.clients.title")}
            </h1>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary border border-primary/20 backdrop-blur-md">
                <Users className="h-3 w-3" />
                Всего: <span className="tabular-nums">{data?.total ?? 0}</span>
              </span>
              {data && data.items.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-500 dark:text-emerald-400 border border-emerald-500/20 backdrop-blur-md">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_4px_#10b981]" />
                  </span>
                  Live
                </span>
              )}
            </div>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={loadClients} disabled={loading} className="relative h-9 w-9 rounded-full hover:bg-foreground/[0.06] dark:hover:bg-white/10">
          <RefreshCw className={cn("h-4 w-4 text-muted-foreground transition-all", loading && "animate-[spin_1.5s_linear_infinite] text-primary")} />
        </Button>
      </motion.div>

      {/* FILTERS */}
      <Card className="bg-background/60 backdrop-blur-3xl border-white/10 p-4 rounded-[2rem] shadow-xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder={t("admin.clients.search_placeholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applySearch()}
              className="pl-9 pr-20 bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50 rounded-xl"
            />
            <Button
              variant="secondary" size="sm"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 px-3 text-xs bg-primary/15 hover:bg-primary/25 text-primary border border-primary/20 rounded-lg"
              onClick={applySearch}
            >
              {t("admin.clients.find")}
            </Button>
          </div>
          <div className="flex items-center gap-1 bg-foreground/[0.03] dark:bg-white/[0.02] p-1 rounded-xl border border-white/5">
            {(["all", "active", "blocked"] as const).map((f) => (
              <button
                key={f}
                onClick={() => { setFilterBlocked(f); setPage(1); }}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                  filterBlocked === f
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] dark:hover:bg-white/5"
                )}
              >
                {f === "all" ? t("admin.clients.all") : f === "active" ? t("admin.clients.active") : t("admin.clients.blocked")}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* BULK ACTIONS BAR */}
      {selectedIds.size > 0 && (
        <Card className="bg-primary/10 backdrop-blur-3xl border-primary/30 p-4 rounded-2xl shadow-xl">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
            <div className="flex items-center gap-3 shrink-0">
              <span className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                {selectedIds.size}
              </span>
              <span className="text-sm font-medium text-foreground">выбрано</span>
              <button
                onClick={clearSelection}
                className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              >
                сбросить
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="amount"
                type="number"
                value={bulkAmount}
                onChange={(e) => setBulkAmount(e.target.value)}
                className="h-8 w-[100px] text-xs rounded-lg bg-background/40 border-white/10"
              />
              <Input
                placeholder="причина (для блокировки)"
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value)}
                className="h-8 w-[180px] text-xs rounded-lg bg-background/40 border-white/10"
              />

              <Button
                size="sm" variant="outline"
                onClick={() => runBulk("block")}
                disabled={bulkBusy !== null}
                className="h-8 rounded-lg gap-1.5 text-xs border-rose-500/30 text-rose-500 hover:bg-rose-500/10"
              >
                {bulkBusy === "block" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
                Block
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={() => runBulk("unblock")}
                disabled={bulkBusy !== null}
                className="h-8 rounded-lg gap-1.5 text-xs border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10"
              >
                {bulkBusy === "unblock" ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                Unblock
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={() => runBulk("credit_balance")}
                disabled={bulkBusy !== null}
                className="h-8 rounded-lg gap-1.5 text-xs"
              >
                {bulkBusy === "credit_balance" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Coins className="h-3 w-3" />}
                +Balance
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={() => runBulk("debit_balance")}
                disabled={bulkBusy !== null}
                className="h-8 rounded-lg gap-1.5 text-xs"
              >
                {bulkBusy === "debit_balance" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Coins className="h-3 w-3" />}
                −Balance
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={() => runBulk("reset_trial")}
                disabled={bulkBusy !== null}
                className="h-8 rounded-lg gap-1.5 text-xs"
              >
                {bulkBusy === "reset_trial" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
                Reset Trial
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={() => runBulk("mark_unreachable")}
                disabled={bulkBusy !== null}
                className="h-8 rounded-lg gap-1.5 text-xs"
              >
                {bulkBusy === "mark_unreachable" ? <Loader2 className="h-3 w-3 animate-spin" /> : <MailX className="h-3 w-3" />}
                TG ✗
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={() => runBulk("mark_reachable")}
                disabled={bulkBusy !== null}
                className="h-8 rounded-lg gap-1.5 text-xs"
              >
                {bulkBusy === "mark_reachable" ? <Loader2 className="h-3 w-3 animate-spin" /> : <MailCheck className="h-3 w-3" />}
                TG ✓
              </Button>
            </div>
          </div>

          {(bulkError || bulkResult) && (
            <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-3 text-xs">
              {bulkError && <span className="text-rose-500">{bulkError}</span>}
              {bulkResult && (
                <span className={cn("font-medium", bulkResult.failed === 0 ? "text-emerald-500" : "text-amber-500")}>
                  Готово: {bulkResult.ok} ОК
                  {bulkResult.failed > 0 && ` · ${bulkResult.failed} с ошибкой`}
                </span>
              )}
            </div>
          )}
        </Card>
      )}

      {/* TABLE */}
      <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] shadow-xl overflow-hidden relative min-h-[400px]">
        {loading && !data ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/40 backdrop-blur-sm">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <span className="text-sm font-medium text-muted-foreground">{t("admin.clients.loading")}</span>
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="h-16 w-16 rounded-full bg-white/5 flex items-center justify-center mb-4 border border-white/10">
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground font-medium">{t("admin.clients.loading_error")}</p>
            {searchApplied && (
              <Button variant="link" size="sm" className="mt-2 text-primary" onClick={() => { setSearch(""); setSearchApplied(""); }}>
                {t("admin.common.refresh")}
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="text-xs uppercase bg-foreground/[0.04] dark:bg-white/[0.04] text-muted-foreground border-b border-white/10">
                <tr>
                  <th className="px-6 py-4 rounded-tl-[2rem]">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-white/30 bg-background cursor-pointer accent-primary"
                      checked={allSelected}
                      onChange={toggleAll}
                      onClick={(e) => e.stopPropagation()}
                      aria-label="Выбрать всех"
                    />
                  </th>
                  <th className="px-6 py-4 font-semibold tracking-wider">Пользователь</th>
                  <th className="px-6 py-4 font-semibold tracking-wider">Контакты</th>
                  <th className="px-6 py-4 font-semibold tracking-wider">Баланс & Дата</th>
                  <th className="px-6 py-4 font-semibold tracking-wider">Статус</th>
                  <th className="px-6 py-4 rounded-tr-[2rem] text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.items.map((c, idx) => {
                  const onlineAt = onlineStatuses[c.remnawaveUuid ?? ""]?.onlineAt ?? c.onlineAt ?? null;
                  const status = getOnlineStatus(onlineAt);
                  
                  return (
                    <motion.tr
                      key={c.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.02 }}
                      onClick={() => openEdit(c)}
                      className={cn(
                        "group cursor-pointer transition-all duration-200 border-l-[3px] border-l-transparent hover:bg-white/5 hover:border-l-primary/50",
                        c.isBlocked && "bg-red-500/5 hover:bg-red-500/10 border-l-red-500/50"
                      )}
                    >
                      <td className="px-6 py-4 w-10" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-white/30 bg-background cursor-pointer accent-primary"
                          checked={selectedIds.has(c.id)}
                          onChange={() => toggleId(c.id)}
                          aria-label={`Выбрать клиента ${c.id}`}
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-purple-500/20 text-primary border border-white/10">
                            <User className="h-5 w-5" />
                          </div>
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground">
                                {c.telegramUsername ? `@${c.telegramUsername}` : c.email || `ID: ${c.telegramId ?? c.id.slice(0, 8)}`}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 mt-1">
                              <span className={cn("inline-flex h-2 w-2 rounded-full", status.isOnline ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" : "bg-gray-500/50")} />
                              <span className="text-[10px] text-muted-foreground">{status.label}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                          {c.email && c.telegramUsername && <div className="flex items-center gap-1"><span className="text-foreground/80">{c.email}</span></div>}
                          {c.telegramId && <div className="flex items-center gap-1">TG: <span className="text-foreground/80">{c.telegramId}</span></div>}
                          <div className="uppercase text-[10px] bg-white/5 px-1.5 py-0.5 rounded max-w-fit border border-white/5 mt-0.5">{c.preferredLang}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1.5">
                          <span className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 font-medium text-xs border border-white/5 max-w-fit">
                            {c.balance.toFixed(2)} {c.preferredCurrency.toUpperCase()}
                          </span>
                          <span className="text-[11px] text-muted-foreground">{new Date(c.createdAt).toLocaleDateString("ru")}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1.5">
                          {c.isBlocked && (
                            <span className="inline-flex items-center rounded-full bg-red-500/15 text-red-400 px-2.5 py-0.5 text-[11px] font-medium border border-red-500/20 backdrop-blur-md max-w-fit shadow-sm">
                              <Ban className="h-3 w-3 mr-1" /> {t("admin.clients.block")}
                            </span>
                          )}
                          {c.activeNode && (
                            <span className="inline-flex items-center rounded-full bg-emerald-500/15 text-emerald-400 px-2.5 py-0.5 text-[11px] font-medium border border-emerald-500/20 backdrop-blur-md max-w-fit shadow-sm">
                              <Activity className="h-3 w-3 mr-1" /> {c.activeNode}
                            </span>
                          )}
                          {!c.isBlocked && !c.activeNode && (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0">
                          <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-foreground/[0.06] dark:hover:bg-white/10 hover:text-foreground" onClick={(e) => { e.stopPropagation(); openEdit(c); }} title="Редактировать">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-red-500/20 text-destructive" onClick={(e) => { e.stopPropagation(); deleteClient(c); }} title="Удалить">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-background/40 backdrop-blur-3xl border border-white/10 p-3 rounded-[1.5rem]">
          <span className="text-sm font-medium text-muted-foreground px-3">
            {page} / {totalPages}
          </span>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(1)} className="h-8 w-8 p-0 rounded-lg bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] border-white/10 rounded-lg">
              «
            </Button>
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="h-8 px-3 rounded-lg bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] border-white/10 rounded-lg">
              {t("admin.common.back")}
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="h-8 px-3 rounded-lg bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] border-white/10 rounded-lg">
              {t("admin.sales.next")}
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(totalPages)} className="h-8 w-8 p-0 rounded-lg bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] border-white/10 rounded-lg">
              »
            </Button>
          </div>
        </div>
      )}

      {editing && (
        <ClientEditModal
          client={editing}
          editForm={editForm}
          setEditForm={setEditForm}
          saving={saving}
          actionMessage={actionMessage}
          remnaData={remnaData}
          clientRemnaSquads={clientRemnaSquads}
          activeLanguages={settings?.activeLanguages ?? []}
          activeCurrencies={settings?.activeCurrencies ?? []}
          onClose={() => {
            setEditing(null);
            setPasswordForm({ newPassword: "", confirm: "" });
            setPasswordMessage(null);
          }}
          onSave={saveClient}
          onSaveRemnaLimits={saveRemnaLimits}
          onRemnaAction={remnaAction}
          onSquadAdd={squadAdd}
          onSquadRemove={squadRemove}
          onSetPassword={saveClientPassword}
          passwordForm={passwordForm}
          setPasswordForm={setPasswordForm}
          passwordMessage={passwordMessage}
          savingPassword={savingPassword}
          token={token}
        />
      )}
    </div>
  );
}

function ClientEditModal({
  client: editing,
  editForm,
  setEditForm,
  saving,
  actionMessage,
  remnaData,
  onClose,
  onSave,
  onSaveRemnaLimits,
  onRemnaAction,
  onSquadAdd,
  onSquadRemove,
  onSetPassword,
  passwordForm,
  setPasswordForm,
  passwordMessage,
  savingPassword,
  token,
  activeLanguages,
  activeCurrencies,
  clientRemnaSquads,
}: {
  client: ClientRecord;
  editForm: UpdateClientPayload & Partial<UpdateClientRemnaPayload>;
  setEditForm: React.Dispatch<React.SetStateAction<UpdateClientPayload & Partial<UpdateClientRemnaPayload>>>;
  saving: boolean;
  actionMessage: string | null;
  remnaData: { squads: { uuid: string; name?: string }[] };
  clientRemnaSquads: string[];
  activeLanguages: string[];
  activeCurrencies: string[];
  onClose: () => void;
  onSave: () => Promise<void>;
  onSaveRemnaLimits: () => Promise<void>;
  onRemnaAction: (name: string, fn: () => Promise<unknown>) => Promise<void>;
  onSquadAdd: (squadUuid: string) => Promise<void>;
  onSquadRemove: (squadUuid: string) => Promise<void>;
  onSetPassword: () => Promise<void>;
  passwordForm: { newPassword: string; confirm: string };
  setPasswordForm: React.Dispatch<React.SetStateAction<{ newPassword: string; confirm: string }>>;
  passwordMessage: string | null;
  savingPassword: boolean;
  token: string;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState("profile");
  const [remnaUser, setRemnaUser] = useState<RemnaUserFull | null>(null);
  const [remnaLoading, setRemnaLoading] = useState(false);
  const [devices, setDevices] = useState<RemnaHwidDevice[]>([]);
  const [devicesTotal, setDevicesTotal] = useState(0);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [usageData, setUsageData] = useState<RemnaUserUsageResponse["response"] | null>(null);
  const [secondarySubs, setSecondarySubs] = useState<AdminSecondarySubscription[]>([]);
  const [secondarySubsLoading, setSecondarySubsLoading] = useState(false);

  const [tariffCategories, setTariffCategories] = useState<TariffCategoryWithTariffs[]>([]);
  const [selectedGrantTariffId, setSelectedGrantTariffId] = useState<string>("");
  // Выбранная опция длительности из priceOptions выбранного тарифа
  const [selectedGrantOptionId, setSelectedGrantOptionId] = useState<string>("");
  const [grantNote, setGrantNote] = useState<string>("");
  const [grantLoading, setGrantLoading] = useState(false);
  const [grantMessage, setGrantMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const loadRemnaUser = useCallback(() => {
    if (!editing.remnawaveUuid) return;
    setRemnaLoading(true);
    api.getClientRemna(token, editing.id).then((raw: unknown) => {
      const resp = (raw as Record<string, unknown>)?.response ?? raw;
      setRemnaUser(resp as RemnaUserFull);
    }).catch(() => {}).finally(() => setRemnaLoading(false));
  }, [token, editing.id, editing.remnawaveUuid]);

  const loadDevices = useCallback(() => {
    if (!editing.remnawaveUuid) return;
    setDevicesLoading(true);
    api.getClientRemnaDevices(token, editing.id).then((d) => {
      setDevices(d.response?.devices ?? []);
      setDevicesTotal(d.response?.total ?? 0);
    }).catch(() => {}).finally(() => setDevicesLoading(false));
  }, [token, editing.id, editing.remnawaveUuid]);

  const loadUsage = useCallback(() => {
    if (!editing.remnawaveUuid) return;
    api.getClientRemnaUsage(token, editing.id, 30).then((d) => {
      setUsageData(d.response ?? null);
    }).catch(() => {});
  }, [token, editing.id, editing.remnawaveUuid]);

  const loadSecondarySubs = useCallback(() => {
    setSecondarySubsLoading(true);
    api.getSecondarySubscriptions(token, { page: 1, limit: 100, search: editing.id })
      .then((r) => {
        const items = (r.items ?? []).filter(
          (s) => s.owner?.id === editing.id || s.giftedToClient?.id === editing.id
        );
        setSecondarySubs(items);
      })
      .catch(() => setSecondarySubs([]))
      .finally(() => setSecondarySubsLoading(false));
  }, [token, editing.id]);

  useEffect(() => {
    loadRemnaUser();
    loadDevices();
    loadUsage();
    loadSecondarySubs();
  }, [loadRemnaUser, loadDevices, loadUsage, loadSecondarySubs]);

  useEffect(() => {
    let cancelled = false;
    api.getTariffCategories(token)
      .then((r) => { if (!cancelled) setTariffCategories(r.items ?? []); })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [token]);

  const flatTariffs: TariffRecord[] = tariffCategories.flatMap((c) => c.tariffs ?? []);

  const handleGrantTariff = async () => {
    if (!selectedGrantTariffId) return;
    setGrantLoading(true);
    setGrantMessage(null);
    try {
      const res = await api.grantClientTariff(token, editing.id, {
        tariffId: selectedGrantTariffId,
        tariffPriceOptionId: selectedGrantOptionId || undefined,
        note: grantNote.trim() || undefined,
      });
      if (res.ok) {
        setGrantMessage({
          type: "ok",
          text: t("admin.clients.grant_tariff_success", {
            defaultValue: "Тариф «{{name}}» выдан ({{days}} дн.)",
            name: res.tariff?.name ?? "",
            days: res.tariff?.durationDays ?? 0,
          }),
        });
        setGrantNote("");
        loadRemnaUser();
        loadDevices();
        loadUsage();
      } else {
        setGrantMessage({ type: "err", text: res.message ?? t("admin.clients.grant_tariff_error", "Не удалось выдать тариф") });
      }
    } catch (e) {
      setGrantMessage({
        type: "err",
        text: e instanceof Error ? e.message : t("admin.clients.grant_tariff_error", "Не удалось выдать тариф"),
      });
    } finally {
      setGrantLoading(false);
    }
  };

  const deleteDevice = async (hwid: string) => {
    if (!confirm(t("admin.clients.delete_device_confirm"))) return;
    try {
      await api.deleteClientRemnaDevice(token, editing.id, hwid);
      loadDevices();
    } catch (e) {
      alert(e instanceof Error ? e.message : t("admin.clients.delete_error"));
    }
  };

  const trafficUsed = remnaUser?.userTraffic?.usedTrafficBytes ?? 0;
  const trafficLimit = remnaUser?.trafficLimitBytes ?? 0;
  const trafficLifetime = remnaUser?.userTraffic?.lifetimeUsedTrafficBytes ?? 0;
  const trafficPercent = trafficLimit > 0 ? Math.min((trafficUsed / trafficLimit) * 100, 100) : 0;

  const statusInfo = STATUS_MAP[remnaUser?.status ?? ""] ?? { label: remnaUser?.status ?? "—", color: "bg-muted" };

  const isOnline = remnaUser?.userTraffic?.onlineAt != null;
  const onlineAt = remnaUser?.userTraffic?.onlineAt;

  const totalUsageLast30 = usageData?.sparklineData?.reduce((a, b) => a + b, 0) ?? 0;

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0 gap-0 bg-background/80 backdrop-blur-3xl border-white/10 shadow-2xl sm:rounded-[2rem] [&>button]:z-50">
        <div className="absolute top-0 right-0 w-[500px] h-[300px] bg-primary/10 blur-[100px] pointer-events-none rounded-full" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[300px] bg-purple-500/10 blur-[100px] pointer-events-none rounded-full" />
        <div className="p-6 border-b border-white/10 relative z-10 bg-white/5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
                <User className="h-6 w-6 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="truncate">{editing.email || editing.telegramUsername ? `@${editing.telegramUsername}` : editing.telegramId || "Клиент"}</span>
                  {editing.remnawaveUuid && (
                    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", statusInfo.color)}>
                      {statusInfo.label}
                    </span>
                  )}
                  {editing.isBlocked && (
                    <span className="inline-flex items-center rounded-full bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/20 px-2 py-0.5 text-[11px] font-medium">
                      {t("admin.clients.is_blocked")}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground font-normal mt-0.5">
                  {t("admin.clients.created")} {new Date(editing.createdAt).toLocaleString("ru")}
                  {remnaUser?.shortUuid && <> &middot; <code className="text-[10px]">{remnaUser.shortUuid}</code></>}
                </div>
              </div>
            </DialogTitle>
            <DialogDescription className="sr-only">{t("admin.clients.modal_title")}</DialogDescription>
          </DialogHeader>
        </div>

        {editing.remnawaveUuid && remnaUser && (
          <div className="px-6 pt-4 relative z-10">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-[1.5rem] bg-gradient-to-br from-foreground/[0.03] to-foreground/[0.05] dark:from-white/5 dark:to-white/10 border border-white/10 p-5 space-y-1.5 hover:from-foreground/[0.05] hover:to-foreground/[0.07] dark:hover:from-white/[0.08] dark:hover:to-white/[0.12] transition-colors">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider">{t("admin.clients.traffic")}</div>
                <div className="text-lg font-bold">{formatTrafficBytes(trafficUsed)}</div>
                {trafficLimit > 0 && (
                  <>
                    <div className="text-[11px] text-muted-foreground">из {formatTrafficBytes(trafficLimit)}</div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all",
                          trafficPercent > 90 ? "bg-red-500" : trafficPercent > 70 ? "bg-amber-500" : "bg-green-500"
                        )}
                        style={{ width: `${trafficPercent}%` }}
                      />
                    </div>
                  </>
                )}
                {trafficLimit === 0 && <div className="text-[11px] text-muted-foreground">{t("admin.clients.unlimited")}</div>}
              </div>
              <div className="rounded-[1.5rem] bg-gradient-to-br from-foreground/[0.03] to-foreground/[0.05] dark:from-white/5 dark:to-white/10 border border-white/10 p-5 space-y-1.5 hover:from-foreground/[0.05] hover:to-foreground/[0.07] dark:hover:from-white/[0.08] dark:hover:to-white/[0.12] transition-colors">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider">{t("admin.clients.traffic_30d")}</div>
                <div className="text-lg font-bold">{formatTrafficBytes(totalUsageLast30)}</div>
                <div className="text-[11px] text-muted-foreground">{t("admin.clients.total_traffic")} {formatTrafficBytes(trafficLifetime)}</div>
              </div>
              <div className="rounded-[1.5rem] bg-gradient-to-br from-foreground/[0.03] to-foreground/[0.05] dark:from-white/5 dark:to-white/10 border border-white/10 p-5 space-y-1.5 hover:from-foreground/[0.05] hover:to-foreground/[0.07] dark:hover:from-white/[0.08] dark:hover:to-white/[0.12] transition-colors">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider">{t("admin.clients.devices")}</div>
                <div className="text-lg font-bold">{devicesTotal}</div>
                <div className="text-[11px] text-muted-foreground">
                  {t("admin.clients.device_limit")} {remnaUser.hwidDeviceLimit != null ? remnaUser.hwidDeviceLimit : "—"}
                </div>
              </div>
              <div className="rounded-[1.5rem] bg-gradient-to-br from-foreground/[0.03] to-foreground/[0.05] dark:from-white/5 dark:to-white/10 border border-white/10 p-5 space-y-1.5 hover:from-foreground/[0.05] hover:to-foreground/[0.07] dark:hover:from-white/[0.08] dark:hover:to-white/[0.12] transition-colors">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider">{t("admin.clients.status")}</div>
                <div className="flex items-center gap-1.5">
                  <span className={cn("h-2 w-2 rounded-full", isOnline ? "bg-green-500 animate-pulse" : "bg-gray-400")} />
                  <span className="text-sm font-medium">{isOnline ? t("admin.clients.status_online") : t("admin.clients.status_offline")}</span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {onlineAt ? `${t("admin.clients.last_seen")} ${new Date(onlineAt).toLocaleString("ru")}` :
                    remnaUser.userTraffic?.firstConnectedAt ? `${t("admin.clients.first_login")} ${new Date(remnaUser.userTraffic.firstConnectedAt).toLocaleDateString("ru")}` : t("admin.clients.no_data")}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="px-6 pt-4 pb-6 relative z-10">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full flex flex-wrap bg-foreground/[0.04] dark:bg-white/[0.04] border border-white/5 rounded-xl p-1">
              <TabsTrigger value="profile" className="gap-1.5 text-xs rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all">
                <User className="h-3.5 w-3.5" /> {t("admin.clients.info")}
              </TabsTrigger>
              {editing.remnawaveUuid && (
                <>
                  <TabsTrigger value="remna" className="gap-1.5 text-xs rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all">
                    <Settings className="h-3.5 w-3.5" /> {t("admin.clients.remna")}
                  </TabsTrigger>
                  <TabsTrigger value="devices" className="gap-1.5 text-xs rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all">
                    <Smartphone className="h-3.5 w-3.5" /> {t("admin.clients.devices")}
                    {devicesTotal > 0 && <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[10px] font-bold text-primary">{devicesTotal}</span>}
                  </TabsTrigger>
                  <TabsTrigger value="actions" className="gap-1.5 text-xs rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all">
                    <Activity className="h-3.5 w-3.5" /> {t("admin.clients.actions")}
                  </TabsTrigger>
                </>
              )}
            </TabsList>

            {/* ────── Профиль ────── */}
            <TabsContent value="profile">
              <div className="space-y-5">
                <div className="rounded-[1.5rem] bg-gradient-to-br from-primary/10 to-purple-500/10 border border-primary/20 p-5 space-y-3 text-sm">
                  <div className="flex items-center gap-2 font-semibold text-sm">
                    <Gift className="h-4 w-4 text-primary" />
                    {t("admin.clients.grant_tariff_title", "Выдать тариф")}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("admin.clients.grant_tariff_hint", "Активирует выбранный тариф для клиента без оплаты. Будет создана запись платежа со статусом PAID и суммой 0. Реферальные бонусы не начисляются.")}
                  </p>

                  {/* Шаг 1: выбор тарифа */}
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">
                      1. {t("admin.clients.grant_tariff_select", "Тариф")}
                    </Label>
                    <select
                      className="w-full rounded-xl border border-input bg-background/70 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                      value={selectedGrantTariffId}
                      onChange={(e) => {
                        const newId = e.target.value;
                        setSelectedGrantTariffId(newId);
                        // Сбрасываем выбранную опцию — будет авто-выбрана дешёвая ниже
                        setSelectedGrantOptionId("");
                      }}
                      disabled={grantLoading}
                    >
                      <option value="">{t("admin.clients.grant_tariff_choose", "— выберите тариф —")}</option>
                      {tariffCategories.map((cat) => (
                        <optgroup key={cat.id} label={cat.name}>
                          {(cat.tariffs ?? []).map((tr) => {
                            const opts = tr.priceOptions ?? [];
                            const minPrice = opts.length > 0 ? Math.min(...opts.map((o) => o.price)) : tr.price;
                            return (
                              <option key={tr.id} value={tr.id}>
                                {tr.name}
                                {tr.trafficLimitBytes != null && tr.trafficLimitBytes > 0
                                  ? ` · ${formatTrafficBytes(Number(tr.trafficLimitBytes))}`
                                  : ""}
                                {tr.deviceLimit ? ` · ${tr.deviceLimit} устр.` : ""}
                                {opts.length > 1 ? ` · от ${minPrice} ${tr.currency.toUpperCase()}` : ` · ${minPrice} ${tr.currency.toUpperCase()}`}
                              </option>
                            );
                          })}
                        </optgroup>
                      ))}
                      {flatTariffs.length === 0 && (
                        <option value="" disabled>
                          {t("admin.clients.grant_tariff_empty", "Нет доступных тарифов")}
                        </option>
                      )}
                    </select>
                  </div>

                  {/* Шаг 2: chips с опциями длительности (если несколько) */}
                  {(() => {
                    const selectedTariff = flatTariffs.find((tr) => tr.id === selectedGrantTariffId);
                    const opts = selectedTariff?.priceOptions ?? [];
                    if (!selectedTariff || opts.length === 0) return null;
                    const sorted = [...opts].sort((a, b) => a.sortOrder - b.sortOrder || a.durationDays - b.durationDays);
                    const minPpd = Math.min(...opts.map((o) => o.price / Math.max(1, o.durationDays)));
                    const effectiveOptId = selectedGrantOptionId || sorted[0].id;
                    return (
                      <div className="space-y-1.5">
                        <Label className="text-[11px] text-muted-foreground">
                          2. Длительность <span className="text-muted-foreground/60">— клиент получит выбранную опцию</span>
                        </Label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {sorted.map((opt) => {
                            const ppd = opt.price / Math.max(1, opt.durationDays);
                            const isBest = opts.length > 1 && Math.abs(ppd - minPpd) < 0.0001;
                            const isSelected = effectiveOptId === opt.id;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                disabled={grantLoading}
                                onClick={() => setSelectedGrantOptionId(opt.id)}
                                className={cn(
                                  "relative rounded-xl border p-3 text-left transition-all hover:scale-[1.02]",
                                  isSelected
                                    ? "bg-primary/15 border-primary shadow-md ring-1 ring-primary/30"
                                    : "bg-background/40 border-white/10 hover:border-white/20",
                                  grantLoading && "opacity-50 cursor-not-allowed"
                                )}
                              >
                                {isBest && (
                                  <span className="absolute -top-1.5 -right-1.5 inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 px-1.5 py-0.5 text-[9px] font-bold backdrop-blur-md">
                                    <Check className="h-2.5 w-2.5" />
                                    Best
                                  </span>
                                )}
                                <div className="font-bold text-sm tabular-nums">{opt.durationDays} дн.</div>
                                <div className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                                  {opt.price} {selectedTariff.currency.toUpperCase()}
                                </div>
                                <div className="text-[10px] text-muted-foreground/80 tabular-nums mt-0.5">
                                  ≈ {ppd.toFixed(2)} {selectedTariff.currency.toUpperCase()}/день
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">{t("admin.clients.grant_tariff_note", "Комментарий (необязательно)")}</Label>
                    <Input
                      value={grantNote}
                      onChange={(e) => setGrantNote(e.target.value)}
                      placeholder={t("admin.clients.grant_tariff_note_ph", "Например: компенсация за простой")}
                      disabled={grantLoading}
                      className="rounded-xl"
                      maxLength={500}
                    />
                  </div>

                  <Button
                    type="button"
                    onClick={handleGrantTariff}
                    disabled={!selectedGrantTariffId || grantLoading}
                    className="gap-1.5 rounded-xl w-full sm:w-auto"
                  >
                    {grantLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
                    {t("admin.clients.grant_tariff_button", "Выдать")}
                  </Button>

                  {grantMessage && (
                    <div
                      className={cn(
                        "text-xs rounded-lg px-3 py-2 border",
                        grantMessage.type === "ok"
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                          : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
                      )}
                    >
                      {grantMessage.text}
                    </div>
                  )}
                </div>

                <div className="rounded-[1.5rem] bg-gradient-to-br from-background/80 to-background/40 border border-white/10 p-5 space-y-3 text-sm hover:bg-white/5 transition-colors">
                  <div className="font-medium text-xs uppercase tracking-wider text-muted-foreground mb-2">{t("admin.clients.info")}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Email</span>
                      <span>{editing.email || "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Telegram</span>
                      <span>{editing.telegramUsername ? `@${editing.telegramUsername}` : "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("admin.clients.telegram_id")}</span>
                      <span className="flex items-center gap-1">
                        {editing.telegramId ?? "—"}
                        {editing.telegramId && <CopyButton text={String(editing.telegramId)} />}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("admin.clients.panel_id")}</span>
                      <span className="flex items-center gap-1">
                        <code className="text-xs">{editing.id.slice(0, 12)}…</code>
                        <CopyButton text={editing.id} />
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("admin.clients.ref_code")}</span>
                      <span className="flex items-center gap-1">
                        {editing.referralCode ? <code className="text-xs">{editing.referralCode}</code> : "—"}
                        {editing.referralCode && <CopyButton text={editing.referralCode} />}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("admin.clients.referrals")}</span>
                      <span>{editing._count?.referrals ?? 0}</span>
                    </div>
                    {remnaUser?.subscriptionUrl && (
                      <div className="flex justify-between sm:col-span-2">
                        <span className="text-muted-foreground flex items-center gap-1"><Link className="h-3 w-3" /> {t("admin.clients.subscription")}</span>
                        <span className="flex items-center gap-1 max-w-[60%]">
                          <code className="text-xs truncate">{remnaUser.subscriptionUrl}</code>
                          <CopyButton text={remnaUser.subscriptionUrl} />
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-[1.5rem] bg-gradient-to-br from-background/80 to-background/40 border border-white/10 p-5 space-y-3 text-sm hover:bg-white/5 transition-colors">
                  <div className="font-medium text-xs uppercase tracking-wider text-muted-foreground mb-2">
                    Дополнительные подписки
                  </div>
                  {secondarySubsLoading ? (
                    <div className="text-sm text-muted-foreground">{t("admin.clients.loading_short")}</div>
                  ) : secondarySubs.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Нет дополнительных подписок</div>
                  ) : (
                    <div className="space-y-2">
                      {secondarySubs.map((s) => {
                        const status =
                          s.giftStatus === "GIFT_RESERVED"
                            ? "Код создан"
                            : s.giftStatus === "GIFTED"
                              ? "Подарена"
                              : "Активна";
                        const relation = s.owner?.id === editing.id ? "Владелец" : "Получатель";
                        return (
                          <div key={s.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] px-4 py-3 gap-3 transition-colors">
                            <div className="min-w-0">
                              <div className="text-xs font-medium">
                                #{s.subscriptionIndex ?? "—"} · {s.tariff?.name ?? "Тариф не указан"}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {relation} · {status}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {s.remnawaveUuid && (
                                <span className="text-[10px] text-muted-foreground truncate max-w-[140px]" title={s.remnawaveUuid}>
                                  {s.remnawaveUuid}
                                </span>
                              )}
                              <Button variant="outline" size="sm" asChild>
                                <a href={`/admin/secondary-subscriptions?search=${encodeURIComponent(s.id)}`}>
                                  Открыть детально
                                </a>
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                      value={editForm.email ?? ""}
                      onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value || undefined }))}
                      placeholder="email@example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("admin.clients.language")}</Label>
                    <Select
                      value={editForm.preferredLang ?? ""}
                      onChange={(v) => setEditForm((f) => ({ ...f, preferredLang: v }))}
                      options={(() => {
                        const langs = activeLanguages.length ? activeLanguages.map((l) => l.trim()) : ["ru", "en"];
                        const current = (editForm.preferredLang ?? editing.preferredLang ?? "").trim();
                        const set = new Set(langs);
                        if (current && !set.has(current)) set.add(current);
                        return [...set].map((l) => ({ value: l, label: l }));
                      })()}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("admin.clients.currency")}</Label>
                    <Select
                      value={editForm.preferredCurrency ?? ""}
                      onChange={(v) => setEditForm((f) => ({ ...f, preferredCurrency: v }))}
                      options={(() => {
                        const currs = activeCurrencies.length ? activeCurrencies.map((c) => c.trim()) : ["usd", "rub"];
                        const current = (editForm.preferredCurrency ?? editing.preferredCurrency ?? "").trim();
                        const set = new Set(currs);
                        if (current && !set.has(current)) set.add(current);
                        return [...set].map((c) => ({ value: c, label: c.toUpperCase() }));
                      })()}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("admin.clients.balance")}</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={editForm.balance ?? 0}
                      onChange={(e) => setEditForm((f) => ({ ...f, balance: Number(e.target.value) || 0 }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("admin.clients.referral_percent")}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={editForm.referralPercent ?? ""}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          referralPercent: e.target.value === "" ? undefined : Number(e.target.value),
                        }))
                      }
                      placeholder={t("admin.clients.referral_default")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      {t("admin.clients.personal_discount")}
                      <span className="text-[11px] font-normal text-muted-foreground">
                        {t("admin.clients.personal_discount_hint")}
                      </span>
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="0.1"
                      value={editForm.personalDiscountPercent ?? ""}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          personalDiscountPercent: e.target.value === "" ? undefined : Number(e.target.value),
                        }))
                      }
                      placeholder={t("admin.clients.personal_discount_placeholder")}
                    />
                  </div>
                  <div className="space-y-2 flex items-end gap-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={editForm.isBlocked ?? false}
                        onChange={(e) => setEditForm((f) => ({ ...f, isBlocked: e.target.checked }))}
                      />
                      <span>{t("admin.clients.is_blocked")}</span>
                    </label>
                  </div>
                  {(editForm.isBlocked ?? editing.isBlocked) && (
                    <div className="space-y-2 sm:col-span-2">
                      <Label>{t("admin.clients.block_reason")}</Label>
                      <Input
                        value={editForm.blockReason ?? ""}
                        onChange={(e) => setEditForm((f) => ({ ...f, blockReason: e.target.value || undefined }))}
                        placeholder="Причина"
                      />
                    </div>
                  )}
                </div>

                {actionMessage && <p className="text-sm text-muted-foreground">{actionMessage}</p>}
                <Button 
                  onClick={onSave} 
                  disabled={saving} 
                  className="rounded-xl bg-primary hover:bg-primary/90 shadow-md shadow-primary/20 border border-primary/30 transition-all"
                >
                  {saving ? t("admin.clients.saving") : t("admin.clients.save_profile")}
                </Button>

                <hr />
                <div>
                  <h3 className="font-semibold mb-2 flex items-center gap-2 text-sm">
                    <KeyRound className="h-4 w-4" /> {t("admin.clients.cabinet_password")}
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      type="password"
                      value={passwordForm.newPassword}
                      onChange={(e) => setPasswordForm((f) => ({ ...f, newPassword: e.target.value }))}
                      placeholder={t("admin.clients.new_password")}
                      autoComplete="new-password"
                    />
                    <Input
                      type="password"
                      value={passwordForm.confirm}
                      onChange={(e) => setPasswordForm((f) => ({ ...f, confirm: e.target.value }))}
                      placeholder={t("admin.clients.repeat_password")}
                      autoComplete="new-password"
                    />
                  </div>
                  {passwordMessage && (
                    <p className={cn("text-sm mt-2", passwordMessage === t("admin.clients.password_set") ? "text-green-600" : "text-destructive")}>
                      {passwordMessage}
                    </p>
                  )}
                  <Button
                    variant="outline" size="sm" className="mt-2 rounded-xl border-white/10 bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] shadow-sm transition-all"
                    onClick={onSetPassword}
                    disabled={savingPassword || !passwordForm.newPassword || passwordForm.newPassword.length < 8}
                  >
                    {savingPassword ? t("admin.clients.saving") : t("admin.clients.set_password")}
                  </Button>
                </div>
              </div>
            </TabsContent>

            {/* ────── Remna ────── */}
            {editing.remnawaveUuid && (
              <TabsContent value="remna">
                <div className="space-y-5">
                  {remnaLoading && <p className="text-muted-foreground text-sm">{t("admin.clients.loading_remna")}</p>}

                  {remnaUser && (
                    <div className="rounded-[1.5rem] bg-gradient-to-br from-background/80 to-background/40 border border-white/10 p-5 space-y-3 text-sm hover:bg-white/5 transition-colors">
                      <div className="font-medium text-xs uppercase tracking-wider text-muted-foreground mb-2">{t("admin.clients.remna_data")}</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Username</span>
                          <span className="flex items-center gap-1">
                            <code className="text-xs">{remnaUser.username}</code>
                            <CopyButton text={remnaUser.username} />
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">ID Remna</span>
                          <span className="font-mono text-xs">{remnaUser.id ?? "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">UUID</span>
                          <span className="flex items-center gap-1">
                            <code className="text-[10px]">{remnaUser.uuid.slice(0, 12)}…</code>
                            <CopyButton text={remnaUser.uuid} />
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Трафик</span>
                          <span>{formatTrafficBytes(trafficUsed)}{trafficLimit > 0 ? ` / ${formatTrafficBytes(trafficLimit)}` : " (безлимит)"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{t("admin.clients.traffic_reset_strategy")}</span>
                          <span>{STRATEGY_LABELS[remnaUser.trafficLimitStrategy] ?? remnaUser.trafficLimitStrategy}</span>
                        </div>
                        {remnaUser.lastTrafficResetAt && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">{t("admin.clients.last_traffic_reset")}</span>
                            <span>{new Date(remnaUser.lastTrafficResetAt).toLocaleString("ru")}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{t("admin.clients.expires")}</span>
                          <span>{remnaUser.expireAt ? new Date(remnaUser.expireAt).toLocaleString("ru") : "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{t("admin.clients.created_in_remna")}</span>
                          <span>{new Date(remnaUser.createdAt).toLocaleString("ru")}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{t("admin.clients.updated")}</span>
                          <span>{new Date(remnaUser.updatedAt).toLocaleString("ru")}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div>
                    <h3 className="font-semibold mb-3 text-sm">{t("admin.clients.limits_and_tariff")}</h3>
                    <div className="grid gap-4 sm:grid-cols-2 text-sm">
                      <div className="space-y-2">
                        <Label>{t("admin.clients.traffic_limit_gb")}</Label>
                        <Input
                          type="number" min={0} step={0.1}
                          value={
                            editForm.trafficLimitBytes !== undefined && editForm.trafficLimitBytes > 0
                              ? (editForm.trafficLimitBytes / (1024 ** 3)).toFixed(2).replace(/\.?0+$/, "")
                              : editForm.trafficLimitBytes === 0 ? "0" : ""
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            setEditForm((f) => ({
                              ...f,
                              trafficLimitBytes: v === "" ? undefined : (() => { const gb = parseFloat(v); return Number.isNaN(gb) ? undefined : Math.round(gb * 1024 ** 3); })(),
                            }));
                          }}
                          placeholder="0"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{t("admin.clients.device_limit_hwid")}</Label>
                        <Input
                          type="number" min={0}
                          value={editForm.hwidDeviceLimit ?? ""}
                          onChange={(e) => setEditForm((f) => ({ ...f, hwidDeviceLimit: e.target.value === "" ? undefined : Number(e.target.value) }))}
                          placeholder="—"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{t("admin.clients.traffic_reset")}</Label>
                        <Select
                          value={editForm.trafficLimitStrategy ?? ""}
                          onChange={(v) => setEditForm((f) => ({ ...f, trafficLimitStrategy: v as UpdateClientRemnaPayload["trafficLimitStrategy"] }))}
                          options={[
                            { value: "", label: "—" },
                            { value: "NO_RESET", label: t("admin.clients.reset_none") },
                            { value: "DAY", label: t("admin.clients.reset_day") },
                            { value: "WEEK", label: t("admin.clients.reset_week") },
                            { value: "MONTH", label: t("admin.clients.reset_month") },
                            { value: "MONTH_ROLLING", label: t("admin.clients.reset_rolling_month") },
                          ]}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{t("admin.clients.expiry_date")}</Label>
                        <Input
                          type="datetime-local"
                          value={editForm.expireAt ? editForm.expireAt.slice(0, 16) : ""}
                          onChange={(e) => setEditForm((f) => ({ ...f, expireAt: e.target.value ? new Date(e.target.value).toISOString() : undefined }))}
                        />
                      </div>
                    </div>
                    <Button variant="outline" size="sm" className="mt-3 rounded-xl border-white/10 bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] shadow-sm transition-all" onClick={onSaveRemnaLimits} disabled={saving}>
                      {t("admin.clients.apply_limits")}
                    </Button>
                  </div>

                  {remnaData.squads.length > 0 && (
                    <div>
                      <h3 className="font-semibold mb-2 text-sm">{t("admin.clients.squads")}</h3>
                      <div className="flex flex-wrap gap-2">
                        {remnaData.squads.map((s) => {
                          const inSquad = clientRemnaSquads.includes(s.uuid);
                          return (
                            <span
                              key={s.uuid}
                              className={cn(
                                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs border transition-colors",
                                inSquad ? "bg-primary/10 border-primary/30 text-primary" : "bg-muted border-transparent text-muted-foreground"
                              )}
                            >
                              <span className="font-medium">{s.name || s.uuid.slice(0, 8)}</span>
                              {inSquad ? (
                                <Button variant="ghost" size="sm" className="h-5 px-1 text-destructive text-[11px]" onClick={() => onSquadRemove(s.uuid)}>
                                  {t("admin.clients.remove")}
                                </Button>
                              ) : (
                                <Button variant="ghost" size="sm" className="h-5 px-1 text-[11px]" onClick={() => onSquadAdd(s.uuid)}>
                                  {t("admin.clients.add")}
                                </Button>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {actionMessage && <p className="text-sm text-muted-foreground">{actionMessage}</p>}
                </div>
              </TabsContent>
            )}

            {/* ────── Устройства ────── */}
            {editing.remnawaveUuid && (
              <TabsContent value="devices">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                      <Smartphone className="h-4 w-4" />
                      {t("admin.clients.hwid_devices")} ({devicesTotal})
                      {remnaUser?.hwidDeviceLimit != null && <span className="text-muted-foreground font-normal">{t("admin.clients.hwid_limit")} {remnaUser.hwidDeviceLimit}</span>}
                    </h3>
                    <Button variant="ghost" size="sm" onClick={loadDevices} disabled={devicesLoading}>
                      <RefreshCw className={cn("h-4 w-4", devicesLoading && "animate-spin")} />
                    </Button>
                  </div>

                  {devicesLoading && <p className="text-sm text-muted-foreground">{t("admin.clients.loading_short")}</p>}

                  {!devicesLoading && devices.length === 0 && (
                    <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
                      <Smartphone className="h-8 w-8 mx-auto mb-2 opacity-40" />
                      <p className="text-sm">{t("admin.clients.no_registered_devices")}</p>
                    </div>
                  )}

                  {devices.length > 0 && (
                    <div className="space-y-2">
                      {devices.map((d) => (
                        <div key={d.id || d.hwid} className="flex items-center justify-between rounded-[1.5rem] border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] p-4 gap-3 transition-colors">
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-2">
                              <HardDrive className="h-4 w-4 text-muted-foreground shrink-0" />
                              <code className="text-xs truncate">{d.hwid}</code>
                              <CopyButton text={d.hwid} />
                            </div>
                            <div className="text-[11px] text-muted-foreground pl-6">
                              {d.platform && <span>{t("admin.clients.platform")} {d.platform}</span>}
                              {d.createdAt && <span> &middot; {new Date(d.createdAt).toLocaleString("ru")}</span>}
                            </div>
                            {d.userAgent && (
                              <div className="text-[10px] text-muted-foreground pl-6 truncate max-w-md" title={d.userAgent}>
                                {d.userAgent}
                              </div>
                            )}
                          </div>
                          <Button variant="ghost" size="sm" className="text-destructive shrink-0" onClick={() => deleteDevice(d.hwid)} title="Удалить устройство">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>
            )}

            {/* ────── Действия ────── */}
            {editing.remnawaveUuid && (
              <TabsContent value="actions">
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm">{t("admin.clients.quick_actions")}</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Button
                      variant="outline" className="justify-start gap-2 rounded-xl border-white/10 bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] transition-all"
                      onClick={() => onRemnaAction(t("admin.clients.subscription_revoked"), () => api.clientRemnaRevokeSubscription(token, editing.id))}
                    >
                      <Ticket className="h-4 w-4" /> {t("admin.clients.revoke_subscription")}
                    </Button>
                    <Button
                      variant="outline" className="justify-start gap-2 text-destructive border-destructive/30 hover:bg-destructive/10 rounded-xl transition-all"
                      onClick={() => onRemnaAction(t("admin.clients.disabled"), () => api.clientRemnaDisable(token, editing.id))}
                    >
                      <Ban className="h-4 w-4" /> {t("admin.clients.disable_in_remna")}
                    </Button>
                    <Button
                      variant="outline" className="justify-start gap-2 text-green-700 dark:text-green-400 border-green-500/30 hover:bg-green-500/10 rounded-xl transition-all"
                      onClick={() => onRemnaAction(t("admin.clients.enabled"), () => api.clientRemnaEnable(token, editing.id))}
                    >
                      <ShieldCheck className="h-4 w-4" /> {t("admin.clients.enable_in_remna")}
                    </Button>
                    <Button
                      variant="outline" className="justify-start gap-2 rounded-xl border-white/10 bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] transition-all"
                      onClick={() => onRemnaAction(t("admin.clients.traffic_reset_done"), () => api.clientRemnaResetTraffic(token, editing.id))}
                    >
                      <Wifi className="h-4 w-4" /> {t("admin.clients.reset_traffic")}
                    </Button>
                    <Button
                      variant="outline" className="justify-start gap-2 rounded-xl border-white/10 bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] transition-all"
                      onClick={() => { loadRemnaUser(); loadDevices(); loadUsage(); }}
                    >
                      <RefreshCw className="h-4 w-4" /> {t("admin.clients.refresh_data")}
                    </Button>
                    <Button
                      variant="outline"
                      className="justify-start gap-2 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/10 rounded-xl transition-all sm:col-span-2"
                      onClick={() => {
                        if (!confirm(t("admin.clients.unlink_remna_confirm"))) return;
                        onRemnaAction(t("admin.clients.unlink_remna_ok"), () => api.clientRemnaUnlink(token, editing.id));
                      }}
                    >
                      <Unlink className="h-4 w-4" /> {t("admin.clients.unlink_remna")}
                    </Button>
                  </div>
                  {actionMessage && <p className="text-sm text-muted-foreground mt-2">{actionMessage}</p>}

                  {usageData && usageData.sparklineData && usageData.sparklineData.some((v) => v > 0) && (
                    <div className="mt-4">
                      <h3 className="font-semibold text-sm mb-3">{t("admin.clients.traffic_30d_chart")}</h3>
                      <div className="flex items-end gap-px h-24 rounded-[1.5rem] bg-gradient-to-br from-white/5 to-transparent border border-white/10 p-3 overflow-hidden">
                        {(() => {
                          const data = usageData.sparklineData;
                          const max = Math.max(...data, 1);
                          return data.map((v, i) => (
                            <div
                              key={i}
                              className="flex-1 bg-primary/60 hover:bg-primary rounded-t transition-colors min-w-[2px]"
                              style={{ height: `${Math.max((v / max) * 100, v > 0 ? 4 : 1)}%` }}
                              title={`${usageData.categories?.[i] ?? ""}: ${formatTrafficBytes(v)}`}
                            />
                          ));
                        })()}
                      </div>
                      <div className="flex justify-between text-[10px] text-muted-foreground mt-1 px-1">
                        <span>{usageData.categories?.[0] ?? ""}</span>
                        <span>{usageData.categories?.[usageData.categories.length - 1] ?? ""}</span>
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>
            )}
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      className="flex h-9 w-full rounded-xl border border-white/10 bg-foreground/[0.04] dark:bg-white/[0.04] hover:bg-black/30 transition-colors px-3 py-1 text-sm shadow-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
