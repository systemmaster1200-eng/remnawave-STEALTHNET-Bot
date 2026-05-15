import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/auth";
import { motion } from "framer-motion";
import {
  api,
  type AdminSecondarySubscriptionFilters,
  type AdminSecondarySubscriptionsResponse,
  type AdminSecondarySubscriptionDetail,
  type TariffRecord,
  type ClientRecord,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Search,
  RefreshCw,
  Eye,
  Trash2,
  Gift,
  ShoppingCart,
  CheckCircle2,
  Mail,
  Send,
  XCircle,
  Clock,
  Trash,
  Copy,
  Check,
  User,
  Activity,
  Plus,
  Loader2,
} from "lucide-react";

function giftStatusBadge(status: string | null): { label: string; className: string } {
  switch (status) {
    case null:
    case "":
      return { label: "Доступна", className: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 shadow-sm backdrop-blur-md" };
    case "ACTIVATED_SELF":
      return { label: "Своя", className: "bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20 shadow-sm backdrop-blur-md" };
    case "GIFT_RESERVED":
      return { label: "Резерв", className: "bg-amber-500/15 text-amber-400 border border-amber-500/20 shadow-sm backdrop-blur-md" };
    case "GIFT_CODE_ACTIVE":
      return { label: "Код активен", className: "bg-blue-500/15 text-blue-500 dark:text-blue-400 border border-blue-500/20 shadow-sm backdrop-blur-md" };
    case "GIFTED":
      return { label: "Подарена", className: "bg-purple-500/15 text-purple-400 border border-purple-500/20 shadow-sm backdrop-blur-md" };
    default:
      return { label: status, className: "bg-foreground/[0.06] dark:bg-white/10 text-muted-foreground border border-white/20 shadow-sm backdrop-blur-md" };
  }
}

const EVENT_LABELS: Record<string, { icon: React.ReactNode; label: string }> = {
  PURCHASED: { icon: <ShoppingCart className="h-4 w-4" />, label: "Подписка куплена" },
  ACTIVATED_SELF: { icon: <CheckCircle2 className="h-4 w-4" />, label: "Добавлена в профиль" },
  CODE_CREATED: { icon: <Gift className="h-4 w-4" />, label: "Код создан" },
  GIFT_SENT: { icon: <Send className="h-4 w-4" />, label: "Подарок отправлен" },
  GIFT_RECEIVED: { icon: <Mail className="h-4 w-4" />, label: "Подарок получен" },
  CODE_CANCELLED: { icon: <XCircle className="h-4 w-4" />, label: "Код отменен" },
  CODE_EXPIRED: { icon: <Clock className="h-4 w-4" />, label: "Код истек" },
  DELETED: { icon: <Trash className="h-4 w-4" />, label: "Удалена" },
};

export function AdminSecondarySubscriptionsPage() {
  const { state } = useAuth();
  const token = state.accessToken!;
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSearch = searchParams.get("search")?.trim() ?? "";
  
  const [data, setData] = useState<AdminSecondarySubscriptionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [filters, setFilters] = useState<AdminSecondarySubscriptionFilters>({
    page: 1,
    limit: 20,
    search: initialSearch || undefined,
  });
  
  const [searchInput, setSearchInput] = useState(initialSearch);
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<AdminSecondarySubscriptionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // ── Create Gift Code Dialog State ──
  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createClientSearch, setCreateClientSearch] = useState("");
  const [createClients, setCreateClients] = useState<ClientRecord[]>([]);
  const [createClientsLoading, setCreateClientsLoading] = useState(false);
  const [createSelectedClient, setCreateSelectedClient] = useState<ClientRecord | null>(null);
  const [createTariffs, setCreateTariffs] = useState<TariffRecord[]>([]);
  const [createSelectedTariff, setCreateSelectedTariff] = useState<string>("");
  const [createMessage, setCreateMessage] = useState("");
  const [createResult, setCreateResult] = useState<{ code: string; expiresAt: string } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      const res = await api.getSecondarySubscriptions(token, filters);
      setData(res);
      setSelectedIds(new Set());
    } catch (err) {
      console.error("Failed to fetch secondary subscriptions", err);
    } finally {
      setLoading(false);
    }
  }, [token, filters]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleSearch = () => {
    const nextSearch = searchInput.trim();
    setFilters((prev) => ({ ...prev, search: nextSearch || undefined, page: 1 }));
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (nextSearch) p.set("search", nextSearch);
      else p.delete("search");
      return p;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSearch();
  };

  const handleFilterChange = <K extends keyof AdminSecondarySubscriptionFilters>(key: K, value: AdminSecondarySubscriptionFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }));
  };

  const handleResetFilters = () => {
    setSearchInput("");
    setFilters({ page: 1, limit: 20 });
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.delete("search");
      return p;
    });
  };

  const toggleSelectAll = () => {
    if (!data) return;
    if (selectedIds.size === data.items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(data.items.map((item) => item.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleDeleteSelected = async () => {
    if (!token) return;
    if (!confirm(`Удалить ${selectedIds.size} подписок? Это действие нельзя отменить.`)) return;
    
    try {
      await api.deleteSecondarySubscriptionsBulk(token, Array.from(selectedIds));
      await fetchItems();
    } catch (err) {
      console.error("Failed to bulk delete", err);
      alert("Ошибка при удалении");
    }
  };

  const handleDeleteSingle = async (id: string) => {
    if (!token) return;
    if (!confirm("Удалить эту подписку?")) return;
    try {
      await api.deleteSecondarySubscription(token, id);
      await fetchItems();
    } catch (err) {
      console.error("Failed to delete", err);
      alert("Ошибка при удалении");
    }
  };

  const openDetail = async (id: string) => {
    setDetailId(id);
    if (!token) return;
    setDetailLoading(true);
    setDetailData(null);
    try {
      const res = await api.getSecondarySubscription(token, id);
      setDetailData(res);
    } catch (err) {
      console.error("Failed to fetch detail", err);
    } finally {
      setDetailLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(text);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  // ── Create Gift Code Handlers ──

  const openCreateDialog = async () => {
    setCreateOpen(true);
    setCreateSelectedClient(null);
    setCreateSelectedTariff("");
    setCreateMessage("");
    setCreateResult(null);
    setCreateError(null);
    setCreateClientSearch("");
    setCreateClients([]);

    // Load tariffs
    try {
      const res = await api.getTariffs(token);
      setCreateTariffs(res.items);
    } catch {
      setCreateTariffs([]);
    }
  };

  const searchClients = async () => {
    if (!createClientSearch.trim()) return;
    setCreateClientsLoading(true);
    try {
      const res = await api.getClients(token, 1, 10, { search: createClientSearch.trim() });
      setCreateClients(res.items);
    } catch {
      setCreateClients([]);
    } finally {
      setCreateClientsLoading(false);
    }
  };

  const handleCreateSubmit = async () => {
    if (!createSelectedClient || !createSelectedTariff) return;
    setCreateLoading(true);
    setCreateError(null);
    try {
      const result = await api.adminCreateGiftCode(token, {
        clientId: createSelectedClient.id,
        tariffId: createSelectedTariff,
        giftMessage: createMessage.trim() || undefined,
      });
      setCreateResult({ code: result.code, expiresAt: result.expiresAt });
      fetchItems(); // refresh list
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Ошибка создания подарочного кода");
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <div className="space-y-6 relative z-0">
      {/* Ambient glows */}
      <div className="fixed -z-10 pointer-events-none bg-primary/15 blur-[120px] w-[500px] h-[500px] -top-[10%] -left-[5%]" />
      <div className="fixed -z-10 pointer-events-none bg-purple-500/10 blur-[100px] w-[400px] h-[400px] top-[40%] -right-[5%]" />

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-background/40 backdrop-blur-3xl p-6 sm:p-7 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 shadow-2xl"
      >
        {/* Decorative gradient orbs */}
        <div className="absolute -top-20 -right-20 h-60 w-60 rounded-full bg-gradient-to-br from-primary/20 via-pink-500/15 to-transparent blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 h-40 w-40 rounded-full bg-gradient-to-tr from-cyan-500/15 to-transparent blur-2xl pointer-events-none" />

        <div className="relative z-10 flex items-center gap-5">
          <motion.div
            whileHover={{ scale: 1.05, rotate: -4 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="relative h-16 w-16 flex items-center justify-center rounded-[1.5rem] bg-gradient-to-br from-primary/30 via-pink-500/20 to-purple-500/15 border border-white/10 shadow-inner shrink-0"
          >
            <div className="absolute inset-0 rounded-[1.5rem] bg-gradient-to-br from-primary/10 to-transparent" />
            <Gift className="relative h-8 w-8 text-primary" />
          </motion.div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground via-primary to-foreground/70 dark:from-foreground dark:via-primary dark:to-foreground/60">
              Дополнительные подписки
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-2 text-sm font-medium">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 text-[11px] font-semibold text-primary backdrop-blur-md">
                <Gift className="h-3 w-3" />
                Всего: <span className="tabular-nums">{data?.total || 0}</span>
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

        <div className="relative z-10">
          <Button
            onClick={openCreateDialog}
            className="h-11 px-5 rounded-2xl gap-2 shadow-lg hover:shadow-xl transition-all bg-gradient-to-br from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 text-primary-foreground font-semibold group"
          >
            <Plus className="h-4 w-4 transition-transform group-hover:rotate-90" />
            Создать подарок
          </Button>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card className="bg-background/60 backdrop-blur-3xl border border-white/10 rounded-[2rem] p-6 shadow-xl">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.25em] text-foreground/80 mb-4">Фильтры</h2>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label className="text-xs">Поиск (Email / Telegram)</Label>
              <div className="relative">
                <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Поиск по владельцу..."
                  className="pl-9 bg-background/60 border-white/10 hover:border-primary/30 focus:border-primary/50 rounded-xl h-11 transition-colors"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
              </div>
            </div>
            
            <div className="w-full sm:w-64 space-y-2">
              <Label className="text-xs">Статус подарка</Label>
              <div className="relative">
                <select
                  className="flex h-11 w-full rounded-xl border border-white/10 bg-background/60 hover:border-primary/30 focus:border-primary/50 backdrop-blur-xl px-3 py-1 text-sm shadow-sm text-foreground focus:outline-none transition-colors appearance-none"
                  value={filters.giftStatus || ""}
                  onChange={(e) => handleFilterChange("giftStatus", e.target.value || undefined)}
                >
                  <option value="" className="bg-background text-foreground">Все</option>
                  <option value="null" className="bg-background text-foreground">Доступна</option>
                  <option value="ACTIVATED_SELF" className="bg-background text-foreground">Своя</option>
                  <option value="GIFT_RESERVED" className="bg-background text-foreground">Резерв</option>
                  <option value="GIFT_CODE_ACTIVE" className="bg-background text-foreground">Код активен</option>
                  <option value="GIFTED" className="bg-background text-foreground">Подарена</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="secondary" onClick={handleSearch} className="h-11 rounded-xl bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] border border-white/10 transition-colors px-5">
                <Search className="mr-2 h-4 w-4" />
                Найти
              </Button>
              <Button variant="ghost" onClick={handleResetFilters} className="h-11 rounded-xl text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] dark:hover:bg-white/5">
                Сброс
              </Button>
            </div>
          </div>
        </Card>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-background/50 backdrop-blur-3xl border border-white/10 rounded-[2rem] overflow-hidden shadow-2xl relative"
      >
        <div className="flex items-center justify-between p-5 border-b border-white/10 bg-white/5 relative z-10">
          <div className="flex items-center gap-3">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.25em] text-foreground/80 flex items-center gap-2">
              <Gift className="w-4 h-4 text-primary" />
              Список подписок
            </h2>
            {selectedIds.size > 0 && (
              <Button variant="destructive" size="sm" onClick={handleDeleteSelected} className="rounded-xl h-8 px-3 shadow-md shadow-destructive/20 border border-destructive/30">
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Удалить ({selectedIds.size})
              </Button>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={fetchItems} disabled={loading} className="h-8 w-8 rounded-full hover:bg-foreground/[0.06] dark:hover:bg-white/10">
            <RefreshCw className={cn("h-4 w-4 text-muted-foreground transition-transform", loading && "animate-[spin_1.5s_linear_infinite] text-primary")} />
          </Button>
        </div>

        <div className="overflow-x-auto relative z-10 min-h-[200px]">
          <table className="w-full text-sm text-left">
            <thead className="bg-foreground/[0.04] dark:bg-white/[0.04] border-b border-white/10">
              <tr>
                <th className="px-5 py-4 w-12 text-center">
                  <Checkbox
                    className="border-white/20 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    checked={data?.items.length ? selectedIds.size === data.items.length : false}
                    onCheckedChange={toggleSelectAll}
                  />
                </th>
                <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">ID</th>
                <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Владелец</th>
                <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Тариф</th>
                <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Статус</th>
                <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Получатель</th>
                <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Код</th>
                <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center">
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <div className="relative">
                        <div className="absolute inset-0 rounded-full blur-[10px] bg-primary/30 animate-pulse" />
                        <Loader2 className="h-8 w-8 animate-spin text-primary relative z-10" />
                      </div>
                      <span className="text-sm font-medium text-muted-foreground">Загрузка данных...</span>
                    </div>
                  </td>
                </tr>
              ) : data?.items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center">
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <div className="h-16 w-16 rounded-full bg-foreground/[0.03] dark:bg-white/[0.04] border border-white/10 flex items-center justify-center mb-2 shadow-inner">
                        <Gift className="h-8 w-8 text-muted-foreground/30" />
                      </div>
                      <span className="text-sm font-medium text-foreground/70">Подписок не найдено</span>
                      <span className="text-xs text-muted-foreground">Попробуйте изменить параметры поиска</span>
                    </div>
                  </td>
                </tr>
              ) : (
                data?.items.map((item, idx) => {
                  const badge = giftStatusBadge(item.giftStatus);
                  const ownerName = item.owner.telegramUsername ? `@${item.owner.telegramUsername}` : item.owner.email || item.owner.telegramId;
                  const giftedName = item.giftedToClient?.telegramUsername ? `@${item.giftedToClient.telegramUsername}` : item.giftedToClient?.email || "—";
                  const isSelected = selectedIds.has(item.id);
                  
                  return (
                    <motion.tr 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.02 }}
                      key={item.id} 
                      className={cn(
                        "transition-all duration-200 group cursor-pointer border-l-[3px] border-l-transparent",
                        isSelected 
                          ? "bg-primary/10 border-l-primary/50 hover:bg-primary/15" 
                          : "hover:bg-foreground/[0.05] dark:hover:bg-white/5 hover:border-l-primary/30"
                      )}
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest('button') || target.closest('[data-row-checkbox-zone]')) return;
                        openDetail(item.id);
                      }}
                    >
                      <td
                        data-row-checkbox-zone
                        className="px-5 py-4 text-center relative z-10 cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          if ((e.target as HTMLElement).closest('[role="checkbox"]')) return;
                          toggleSelect(item.id);
                        }}
                      >
                        <Checkbox
                          className={cn("border-white/20 transition-all", isSelected && "border-primary bg-primary text-primary-foreground")}
                          checked={isSelected}
                          onCheckedChange={() => toggleSelect(item.id)}
                        />
                      </td>
                      <td className="px-5 py-4 font-mono text-[11px] text-muted-foreground/70 group-hover:text-primary/70 transition-colors">
                        {item.id.substring(0, 8)}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-white/10 to-white/5 border border-white/10 flex items-center justify-center shrink-0">
                            <User className="w-4 h-4 text-muted-foreground/70" />
                          </div>
                          <div>
                            <div className="text-sm font-medium text-foreground/90">{ownerName}</div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">#{item.subscriptionIndex}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="text-sm font-medium text-foreground/80">{item.tariff?.name || "—"}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{new Date(item.createdAt).toLocaleDateString("ru-RU")}</div>
                      </td>
                      <td className="px-5 py-4">
                        <span className={cn("px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase", badge.className)}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={cn("text-sm transition-colors", giftedName !== "—" ? "text-foreground/80" : "text-muted-foreground/50")}>
                          {giftedName}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        {item.latestGiftCode ? (
                          <div className="flex items-center gap-2 group/code">
                            <span className="font-mono text-xs bg-black/30 text-primary/90 px-2 py-1 rounded-md border border-primary/20 shadow-inner tracking-wider">
                              {item.latestGiftCode.code}
                            </span>
                            <button
                              onClick={(e) => { e.stopPropagation(); copyToClipboard(item.latestGiftCode!.code); }}
                              className="w-7 h-7 rounded-md bg-foreground/[0.04] dark:bg-white/5 hover:bg-primary/15 hover:text-primary border border-white/5 hover:border-primary/30 flex items-center justify-center transition-all opacity-0 group-hover/code:opacity-100 shadow-sm"
                            >
                              {copiedCode === item.latestGiftCode.code ? (
                                <Check className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        ) : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-5 py-4 text-right relative z-10">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0">
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl bg-foreground/[0.04] dark:bg-white/5 hover:bg-blue-500/15 hover:text-blue-400 border border-white/10 hover:border-blue-500/30 transition-all shadow-sm" onClick={(e) => { e.stopPropagation(); openDetail(item.id); }}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl bg-foreground/[0.04] dark:bg-white/5 hover:bg-destructive/15 text-muted-foreground hover:text-destructive border border-white/10 hover:border-destructive/30 transition-all shadow-sm" onClick={(e) => { e.stopPropagation(); handleDeleteSingle(item.id); }}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between p-5 border-t border-white/10 bg-background/40 backdrop-blur-xl relative z-10">
            <span className="text-sm font-medium text-muted-foreground">
              Страница {data.page} из {data.totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl border-white/10 bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] shadow-sm transition-colors"
                disabled={data.page <= 1}
                onClick={() => setFilters((p) => ({ ...p, page: p.page! - 1 }))}
              >
                Назад
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl border-white/10 bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] shadow-sm transition-colors"
                disabled={data.page >= data.totalPages}
                onClick={() => setFilters((p) => ({ ...p, page: p.page! + 1 }))}
              >
                Вперед
              </Button>
            </div>
          </div>
        )}
      </motion.div>

      <Dialog open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-background/80 backdrop-blur-3xl border-white/10 shadow-2xl p-0 sm:rounded-[2rem] [&>button]:z-50">
          <div className="absolute top-0 right-0 w-[500px] h-[300px] bg-primary/10 blur-[100px] pointer-events-none rounded-full" />
          <div className="absolute bottom-0 left-0 w-[400px] h-[300px] bg-purple-500/10 blur-[100px] pointer-events-none rounded-full" />
          
          <div className="p-6 border-b border-white/10 relative z-10 bg-foreground/[0.03] dark:bg-white/5">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20 border border-white/10 flex items-center justify-center shadow-inner">
                  <Gift className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <DialogTitle className="text-xl font-bold tracking-tight">Подписка #{detailData?.subscriptionIndex}</DialogTitle>
                  <DialogDescription className="font-mono text-xs opacity-60 mt-1 flex items-center gap-2">
                    ID: {detailId}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>

          <div className="p-6 relative z-10">
            {detailLoading || !detailData ? (
              <div className="py-16 flex flex-col items-center justify-center space-y-4">
                <div className="relative w-16 h-16 flex items-center justify-center">
                  <div className="absolute inset-0 border-2 border-dashed border-primary/30 rounded-full animate-[spin_3s_linear_infinite]" />
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
                <span className="text-sm font-medium text-muted-foreground tracking-widest uppercase">Загрузка</span>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="rounded-[1.5rem] bg-gradient-to-br from-background/80 to-background/40 backdrop-blur-xl border border-white/10 p-5 shadow-sm transition-all hover:shadow-md hover:border-white/20">
                    <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground block mb-2">Тариф</span>
                    <span className="text-sm font-bold text-foreground/90">{detailData.tariff?.name || "—"}</span>
                  </div>
                  <div className="rounded-[1.5rem] bg-gradient-to-br from-background/80 to-background/40 backdrop-blur-xl border border-white/10 p-5 shadow-sm transition-all hover:shadow-md hover:border-white/20 flex flex-col items-start justify-center">
                    <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground block mb-2">Статус подарка</span>
                    <span className={cn("px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide", giftStatusBadge(detailData.giftStatus).className)}>
                      {giftStatusBadge(detailData.giftStatus).label}
                    </span>
                  </div>
                  <div className="rounded-[1.5rem] bg-gradient-to-br from-background/80 to-background/40 backdrop-blur-xl border border-white/10 p-5 shadow-sm transition-all hover:shadow-md hover:border-white/20">
                    <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground block mb-2">Создана</span>
                    <span className="text-sm font-medium text-foreground/80">{new Date(detailData.createdAt).toLocaleDateString("ru-RU")}</span>
                  </div>
                  <div className="rounded-[1.5rem] bg-gradient-to-br from-background/80 to-background/40 backdrop-blur-xl border border-white/10 p-5 shadow-sm transition-all hover:shadow-md hover:border-white/20">
                    <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground block mb-2">Обновлена</span>
                    <span className="text-sm font-medium text-foreground/80">{new Date(detailData.updatedAt).toLocaleDateString("ru-RU")}</span>
                  </div>
                </div>

                <div className="rounded-[1.5rem] bg-gradient-to-br from-background/80 to-background/40 backdrop-blur-xl border border-white/10 p-5 shadow-sm relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 blur-[40px] pointer-events-none rounded-full" />
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.25em] text-foreground/80 flex items-center gap-2.5 mb-5">
                    <User className="h-3.5 w-3.5 text-primary" /> Владелец
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-sm relative z-10">
                    <div className="bg-foreground/[0.03] dark:bg-white/[0.04] border border-white/5 rounded-xl p-4 transition-colors group-hover:bg-foreground/[0.06] dark:group-hover:bg-white/10">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">Telegram ID</span>
                      <span className="font-mono">{detailData.owner.telegramId || "—"}</span>
                    </div>
                    <div className="bg-foreground/[0.03] dark:bg-white/[0.04] border border-white/5 rounded-xl p-4 transition-colors group-hover:bg-foreground/[0.06] dark:group-hover:bg-white/10">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">Username</span>
                      <span className="font-medium text-foreground/90">{detailData.owner.telegramUsername ? `@${detailData.owner.telegramUsername}` : "—"}</span>
                    </div>
                    <div className="bg-foreground/[0.03] dark:bg-white/[0.04] border border-white/5 rounded-xl p-4 transition-colors group-hover:bg-foreground/[0.06] dark:group-hover:bg-white/10">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">Email</span>
                      <span className="font-medium text-foreground/90">{detailData.owner.email || "—"}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-[1.5rem] bg-gradient-to-br from-background/80 to-background/40 backdrop-blur-xl border border-white/10 p-5 shadow-sm relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 blur-[40px] pointer-events-none rounded-full" />
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.25em] text-foreground/80 flex items-center gap-2.5 mb-5">
                    <Activity className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400" /> Данные Remnawave
                  </h3>
                  {detailData.remnaData ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm relative z-10">
                      <div className="bg-foreground/[0.03] dark:bg-white/[0.04] border border-white/5 rounded-xl p-4">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-2">Статус</span>
                        <span className={cn(
                          "px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                          detailData.remnaData.status === "active" ? "bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20 shadow-sm backdrop-blur-md" : "bg-red-500/15 text-red-500 dark:text-red-400 border border-red-500/20 shadow-sm backdrop-blur-md"
                        )}>
                          {String(detailData.remnaData.status || "unknown")}
                        </span>
                      </div>
                      <div className="bg-foreground/[0.03] dark:bg-white/[0.04] border border-white/5 rounded-xl p-4">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">Истекает</span>
                        <span className="font-medium text-foreground/80">
                          {detailData.remnaData.expireAt 
                            ? new Date(String(detailData.remnaData.expireAt)).toLocaleDateString("ru-RU") 
                            : "—"}
                        </span>
                      </div>
                      <div className="bg-foreground/[0.03] dark:bg-white/[0.04] border border-white/5 rounded-xl p-4">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">Трафик</span>
                        <span className="font-mono text-foreground/80">{String(detailData.remnaData.usedTraffic || "0")} / {String(detailData.remnaData.trafficLimit || "∞")}</span>
                      </div>
                      <div className="bg-foreground/[0.03] dark:bg-white/[0.04] border border-white/5 rounded-xl p-4">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">Устройства</span>
                        <span className="font-mono text-foreground/80">{String(detailData.remnaData.devices || "0")}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="p-6 border border-dashed border-white/10 rounded-xl flex items-center justify-center text-sm font-medium text-muted-foreground/60 relative z-10">
                      Нет данных Remnawave
                    </div>
                  )}
                </div>

                {detailData.giftCodes && detailData.giftCodes.length > 0 && (
                  <div className="rounded-[1.5rem] bg-gradient-to-br from-background/80 to-background/40 backdrop-blur-xl border border-white/10 p-5 shadow-sm relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 blur-[40px] pointer-events-none rounded-full" />
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.25em] text-foreground/80 flex items-center gap-2.5 mb-5">
                      <Gift className="h-3.5 w-3.5 text-purple-400" /> Подарочные коды
                    </h3>
                    <div className="space-y-4 relative z-10">
                      {detailData.giftCodes.map((code) => (
                        <div key={code.id} className="p-4 bg-foreground/[0.03] dark:bg-white/[0.04] border border-white/10 rounded-xl text-sm grid grid-cols-1 sm:grid-cols-2 gap-4 transition-colors hover:bg-foreground/[0.06] dark:hover:bg-white/10 hover:border-white/20 shadow-sm">
                          <div className="flex flex-col gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Код</span>
                            <div className="flex items-center gap-3">
                              <span className="font-mono bg-black/40 text-primary/90 px-3 py-1.5 rounded-lg border border-white/5 shadow-inner tracking-widest text-base">
                                {code.code}
                              </span>
                              <span className={cn(
                                "text-[10px] font-bold px-2.5 py-1 rounded-md uppercase tracking-wider",
                                code.status === "ACTIVE" ? "bg-blue-500/15 text-blue-500 dark:text-blue-400 border border-blue-500/20 shadow-sm backdrop-blur-md" : 
                                code.status === "REDEEMED" ? "bg-purple-500/15 text-purple-400 border border-purple-500/20 shadow-sm backdrop-blur-md" : 
                                "bg-foreground/[0.06] dark:bg-white/10 text-muted-foreground border border-white/20 shadow-sm backdrop-blur-md"
                              )}>
                                {code.status}
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-col justify-center sm:text-right text-xs gap-1.5">
                            {code.redeemedBy && (
                              <div className="flex flex-col">
                                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Активировал</span>
                                <span className="font-medium text-foreground/90 mt-0.5">{code.redeemedBy.telegramUsername ? `@${code.redeemedBy.telegramUsername}` : code.redeemedBy.email}</span>
                              </div>
                            )}
                            <div className="flex flex-col mt-1">
                              <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Действует до</span>
                              <span className="font-medium text-foreground/80 mt-0.5">{new Date(code.expiresAt).toLocaleDateString("ru-RU")}</span>
                            </div>
                          </div>
                          {code.giftMessage && (
                            <div className="col-span-full mt-2 pt-4 border-t border-white/5">
                              <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">Сообщение</span>
                              <div className="text-sm italic text-foreground/80 leading-relaxed pl-3 border-l-[3px] border-primary/50">
                                "{code.giftMessage}"
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-[1.5rem] bg-gradient-to-br from-background/80 to-background/40 backdrop-blur-xl border border-white/10 p-5 shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/5 blur-[40px] pointer-events-none rounded-full" />
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.25em] text-foreground/80 flex items-center gap-2.5 mb-5 relative z-10">
                    <Clock className="h-3.5 w-3.5 text-orange-400" /> История
                  </h3>
                  <div className="space-y-0 pl-6 border-l-2 border-gradient from-primary/40 to-transparent ml-3 relative z-10 py-2">
                    {detailData.history.length === 0 ? (
                      <div className="text-sm text-muted-foreground -ml-6 pb-2 italic">Нет истории событий</div>
                    ) : (
                      detailData.history.map((event, idx) => {
                        const evData = EVENT_LABELS[event.eventType] || { icon: <Activity className="h-4 w-4" />, label: event.eventType };
                        const isLast = idx === detailData.history.length - 1;
                        
                        return (
                          <div key={event.id} className={cn("relative -ml-[31px] flex items-start gap-5", !isLast && "pb-8")}>
                            <div className="bg-background border-2 border-primary/30 rounded-full p-1.5 shadow-[0_0_10px_rgba(var(--primary),0.3)] mt-0.5 relative z-10">
                              <div className="text-foreground/80">{evData.icon}</div>
                            </div>
                            <div className="flex-1 bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] transition-colors border border-white/10 rounded-[1rem] p-4 shadow-sm">
                              <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-bold text-foreground/90">{evData.label}</span>
                                <span className="text-[10px] font-medium tracking-wide text-muted-foreground bg-foreground/[0.04] dark:bg-white/[0.04] px-2 py-1 rounded-md border border-white/5">
                                  {new Date(event.createdAt).toLocaleString("ru-RU", { 
                                    day: '2-digit', month: '2-digit', year: 'numeric',
                                    hour: '2-digit', minute: '2-digit'
                                  })}
                                </span>
                              </div>
                              {event.metadata && Object.keys(event.metadata).length > 0 && (
                                <pre className="text-[11px] text-muted-foreground/80 bg-black/40 p-3 rounded-lg border border-white/5 mt-3 overflow-x-auto shadow-inner leading-relaxed font-mono">
                                  {JSON.stringify(event.metadata, null, 2)}
                                </pre>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={(open) => { if (!open) setCreateOpen(false); }}>
        <DialogContent className="sm:max-w-lg bg-background/80 backdrop-blur-3xl border-white/10 shadow-2xl p-0 sm:rounded-[2rem] [&>button]:z-50">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 blur-[80px] pointer-events-none rounded-full" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-500/10 blur-[80px] pointer-events-none rounded-full" />
          
          <div className="p-6 border-b border-white/10 relative z-10 bg-foreground/[0.03] dark:bg-white/5">
            <DialogHeader>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20 border border-white/10 flex items-center justify-center shadow-inner">
                  <Gift className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <DialogTitle className="text-xl font-bold tracking-tight">Создать подарочный код</DialogTitle>
                  <DialogDescription className="text-xs mt-1 text-muted-foreground/80">
                    Генерирует код для активации подписки
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>

          <div className="p-6 relative z-10">
            {createResult ? (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="space-y-6"
              >
                <div className="p-8 rounded-[1.5rem] bg-gradient-to-br from-green-500/10 to-emerald-500/5 border border-green-500/20 text-center space-y-4 shadow-[inset_0_0_20px_rgba(34,197,94,0.05)] relative overflow-hidden">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", bounce: 0.5, delay: 0.2 }}
                    className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto border border-green-500/30 shadow-[0_0_30px_rgba(34,197,94,0.3)] mb-2"
                  >
                    <CheckCircle2 className="h-8 w-8 text-emerald-500 dark:text-emerald-400" />
                  </motion.div>
                  <p className="text-base font-bold text-emerald-500 dark:text-emerald-400">Подарочный код создан!</p>
                  
                  <div className="flex items-center justify-center gap-3 bg-black/40 p-4 rounded-xl border border-white/10 shadow-inner group">
                    <span className="font-mono text-2xl text-primary font-bold tracking-[0.2em]">
                      {createResult.code}
                    </span>
                    <Button 
                      size="icon" 
                      className="h-10 w-10 rounded-xl bg-foreground/[0.04] dark:bg-white/5 hover:bg-primary/15 text-muted-foreground hover:text-primary border border-white/10 transition-all group-hover:border-primary/30" 
                      onClick={() => copyToClipboard(createResult.code)}
                    >
                      {copiedCode === createResult.code ? <Check className="h-5 w-5 text-emerald-500 dark:text-emerald-400" /> : <Copy className="h-5 w-5" />}
                    </Button>
                  </div>
                  
                  <p className="text-xs font-medium text-muted-foreground bg-background/50 inline-block px-3 py-1.5 rounded-full border border-white/5">
                    Действует до: {new Date(createResult.expiresAt).toLocaleString("ru-RU")}
                  </p>
                </div>
                <Button className="w-full h-12 rounded-2xl font-bold bg-foreground/[0.05] dark:bg-white/10 hover:bg-foreground/[0.08] dark:hover:bg-white/[0.15] text-foreground border border-white/10 transition-all shadow-sm" onClick={() => setCreateOpen(false)}>
                  Закрыть
                </Button>
              </motion.div>
            ) : (
              <div className="space-y-6">
                <div className="space-y-3">
                  <Label className="text-[11px] font-bold uppercase tracking-[0.1em] text-foreground/80 ml-1">Клиент (владелец)</Label>
                  {createSelectedClient ? (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-3 p-3 rounded-xl bg-primary/10 border border-primary/30 shadow-[inset_0_0_15px_rgba(var(--primary),0.1)]"
                    >
                      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center border border-primary/30 shrink-0">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                      <span className="text-sm font-medium text-foreground/90 flex-1 truncate">
                        {createSelectedClient.telegramUsername
                          ? `@${createSelectedClient.telegramUsername}`
                          : createSelectedClient.email || `ID: ${createSelectedClient.telegramId}`}
                      </span>
                      <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/20 shrink-0" onClick={() => setCreateSelectedClient(null)}>
                        <XCircle className="h-4 w-4" />
                      </Button>
                    </motion.div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground/60" />
                          <Input
                            placeholder="Email или Telegram..."
                            className="pl-9 bg-background/60 backdrop-blur-sm border-white/10 hover:border-primary/30 focus:border-primary/50 rounded-xl h-11 transition-all shadow-inner"
                            value={createClientSearch}
                            onChange={(e) => setCreateClientSearch(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") searchClients(); }}
                          />
                        </div>
                        <Button variant="secondary" className="h-11 rounded-xl px-4 bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] border border-white/10 transition-colors" onClick={searchClients} disabled={createClientsLoading}>
                          {createClientsLoading ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : "Найти"}
                        </Button>
                      </div>
                      {createClients.length > 0 && (
                        <div className="max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-foreground/[0.04] dark:bg-white/[0.04] divide-y divide-white/5 mt-2 custom-scrollbar shadow-inner">
                          {createClients.map((c) => (
                            <button
                              key={c.id}
                              className="w-full text-left px-4 py-3 text-sm hover:bg-foreground/[0.06] dark:hover:bg-white/10 focus:bg-foreground/[0.06] dark:focus:bg-white/10 outline-none transition-colors flex items-center gap-3 group"
                              onClick={() => {
                                setCreateSelectedClient(c);
                                setCreateClients([]);
                              }}
                            >
                              <div className="w-6 h-6 rounded-full bg-foreground/[0.03] dark:bg-white/[0.04] border border-white/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 group-hover:border-primary/30 transition-colors">
                                <User className="h-3 w-3 text-muted-foreground group-hover:text-primary transition-colors" />
                              </div>
                              <span className="font-medium text-foreground/80 group-hover:text-foreground transition-colors truncate">
                                {c.telegramUsername ? `@${c.telegramUsername}` : c.email || `TG: ${c.telegramId}`}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <Label className="text-[11px] font-bold uppercase tracking-[0.1em] text-foreground/80 ml-1">Тариф</Label>
                  <div className="relative">
                    <select
                      className="flex h-12 w-full rounded-xl border border-white/10 bg-background/60 hover:border-primary/30 focus:border-primary/50 backdrop-blur-sm px-4 py-2 text-sm shadow-inner text-foreground focus:outline-none transition-all appearance-none cursor-pointer"
                      value={createSelectedTariff}
                      onChange={(e) => setCreateSelectedTariff(e.target.value)}
                    >
                      <option value="" disabled className="bg-background text-muted-foreground">Выберите тариф</option>
                      {createTariffs.map((t) => (
                        <option key={t.id} value={t.id} className="bg-background text-foreground py-2">
                          {t.name} ({t.durationDays}д · {t.price} {t.currency})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between ml-1">
                    <Label className="text-[11px] font-bold uppercase tracking-[0.1em] text-foreground/80">Сообщение</Label>
                    <span className="text-[10px] font-bold text-muted-foreground bg-foreground/[0.04] dark:bg-white/5 px-2 py-0.5 rounded-full border border-white/5">{createMessage.length}/200</span>
                  </div>
                  <Textarea
                    placeholder="Напишите приятные слова получателю... (необязательно)"
                    className="bg-background/60 backdrop-blur-sm border-white/10 hover:border-primary/30 focus:border-primary/50 rounded-xl resize-none shadow-inner p-4 transition-all"
                    maxLength={200}
                    rows={3}
                    value={createMessage}
                    onChange={(e) => setCreateMessage(e.target.value)}
                  />
                </div>

                {createError && (
                  <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-400 font-medium flex items-center gap-3">
                    <XCircle className="w-5 h-5 shrink-0" />
                    {createError}
                  </motion.div>
                )}

                <Button
                  className="w-full h-12 rounded-2xl gap-2 font-bold shadow-[0_0_15px_rgba(var(--primary),0.2)] hover:shadow-[0_0_25px_rgba(var(--primary),0.4)] transition-all overflow-hidden relative group"
                  disabled={!createSelectedClient || !createSelectedTariff || createLoading}
                  onClick={handleCreateSubmit}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-[200%] group-hover:translate-x-[200%] transition-transform duration-1000 ease-in-out" />
                  {createLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Gift className="h-5 w-5 group-hover:scale-110 transition-transform" />
                  )}
                  {createLoading ? "Создание..." : "Сгенерировать код"}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
