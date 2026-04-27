import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Gift, Package, Copy, Check, Loader2, Plus, X, Calendar, Clock, 
  Send, Link as LinkIcon, CheckCircle2, Play, ShoppingCart, Mail, 
  XCircle, Trash, History, ChevronDown, ChevronUp, User
} from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { api, type PublicTariff, type PublicTariffCategory } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

function formatMoney(amount: number, currency: string = "usd") {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency.toUpperCase() === "USD" ? "USD" : currency.toUpperCase() === "RUB" ? "RUB" : "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} мин назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "вчера";
  if (days < 7) return `${days} дн назад`;
  return new Date(dateStr).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const HISTORY_EVENT_MAP: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  PURCHASED: { icon: <ShoppingCart className="w-5 h-5" />, label: "Подписка куплена", color: "text-blue-500 border-blue-500/20 bg-blue-500/10" },
  ACTIVATED_SELF: { icon: <CheckCircle2 className="w-5 h-5" />, label: "Добавлена в профиль", color: "text-green-500 border-green-500/20 bg-green-500/10" },
  CODE_CREATED: { icon: <Gift className="w-5 h-5" />, label: "Подарочный код создан", color: "text-purple-500 border-purple-500/20 bg-purple-500/10" },
  GIFT_SENT: { icon: <Send className="w-5 h-5" />, label: "Подарок отправлен", color: "text-indigo-500 border-indigo-500/20 bg-indigo-500/10" },
  GIFT_RECEIVED: { icon: <Mail className="w-5 h-5" />, label: "Подарок получен", color: "text-emerald-500 border-emerald-500/20 bg-emerald-500/10" },
  CODE_CANCELLED: { icon: <XCircle className="w-5 h-5" />, label: "Код отменён", color: "text-red-500 border-red-500/20 bg-red-500/10" },
  CODE_EXPIRED: { icon: <Clock className="w-5 h-5" />, label: "Код истёк", color: "text-yellow-600 dark:text-yellow-400 border-yellow-500/20 bg-yellow-500/10" },
  DELETED: { icon: <Trash className="w-5 h-5" />, label: "Подписка удалена", color: "text-red-500 border-red-500/20 bg-red-500/10" },
};

export function ClientGiftsPage() {
  const { state, refreshProfile } = useClientAuth();
  const config = useCabinetConfig();
  const token = state.token ?? null;
  const client = state.client;
  const currency = (client?.preferredCurrency ?? "usd").toLowerCase();

  // Tour mock subscriptions
  type Subscription = { id: string; ownerId: string; remnawaveUuid: string | null; subscriptionIndex: number; tariffId: string | null; giftStatus: string | null; giftedToClientId: string | null; createdAt: string; updatedAt: string };
  const [tourMockSubs, setTourMockSubs] = useState<Subscription[]>([]);

  useEffect(() => {
    const showMocks = () => {
      setTourMockSubs([
        {
          id: "tour-mock-self",
          ownerId: "tour",
          remnawaveUuid: null,
          subscriptionIndex: 1,
          tariffId: null,
          giftStatus: "ACTIVATED_SELF",
          giftedToClientId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "tour-mock-gifted",
          ownerId: "tour",
          remnawaveUuid: null,
          subscriptionIndex: 2,
          tariffId: null,
          giftStatus: "GIFTED",
          giftedToClientId: null,
          createdAt: new Date(Date.now() - 86400000).toISOString(),
          updatedAt: new Date(Date.now() - 86400000).toISOString(),
        },
      ]);
    };
    const hideMocks = () => setTourMockSubs([]);

    window.addEventListener("tour:show-gift-mocks", showMocks);
    window.addEventListener("tour:hide-gift-mocks", hideMocks);
    return () => {
      window.removeEventListener("tour:show-gift-mocks", showMocks);
      window.removeEventListener("tour:hide-gift-mocks", hideMocks);
    };
  }, []);

  // Data states
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [codes, setCodes] = useState<Array<{ id: string; code: string; status: string; expiresAt: string; createdAt: string; redeemedAt: string | null; giftMessage: string | null; secondarySubscriptionId: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Buy Dialog State
  const [buyDialogOpen, setBuyDialogOpen] = useState(false);
  const [tariffs, setTariffs] = useState<PublicTariff[]>([]);
  const [buyLoading, setBuyLoading] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);

  // Redeem state
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemSuccess, setRedeemSuccess] = useState<string | null>(null);

  // Interaction states
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // History states
  const [historyItems, setHistoryItems] = useState<Array<{ id: string; eventType: string; metadata: unknown; createdAt: string; secondarySubscriptionId: string | null }>>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showFullHistory, setShowFullHistory] = useState(false);

  const fetchData = useCallback(async () => {
    if (!token) return;
    try {
      setError(null);
      const [subsRes, codesRes] = await Promise.all([
        api.giftListAllSubscriptions(token),
        api.giftListCodes(token),
      ]);
      setSubscriptions(subsRes.subscriptions || []);
      setCodes(codesRes.codes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки данных");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const fetchHistory = useCallback(async (page: number = 1) => {
    if (!token) return;
    setHistoryLoading(true);
    try {
      const res = await api.giftGetHistory(token, page, 10);
      setHistoryItems(res.items);
      setHistoryTotal(res.total);
      setHistoryPage(res.page);
    } catch {
      // silent
    } finally {
      setHistoryLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchHistory(historyPage);
  }, [historyPage, fetchHistory]);

  const loadTariffs = async () => {
    if (tariffs.length > 0) return;
    try {
      const res = await api.getPublicTariffs();
      const flat = (res?.items ?? []).flatMap((cat: PublicTariffCategory) => cat.tariffs);
      setTariffs(flat);
    } catch {
      // ignore
    }
  };

  const handleOpenBuy = () => {
    loadTariffs();
    setBuyError(null);
    setBuyDialogOpen(true);
  };

  const handleBuy = async (tariffId: string) => {
    if (!token) return;
    setBuyLoading(true);
    setBuyError(null);
    try {
      await api.giftBuySubscription(token, tariffId);
      await fetchData();
      fetchHistory(1);
      refreshProfile().catch(() => {});
      setBuyDialogOpen(false);
    } catch (err) {
      setBuyError(err instanceof Error ? err.message : "Ошибка покупки");
    } finally {
      setBuyLoading(false);
    }
  };

  const handleCreateCode = async (subscriptionId: string) => {
    if (!token) return;
    setActionLoading(`create-${subscriptionId}`);
    try {
      await api.giftCreateCode(token, subscriptionId);
      await fetchData();
      fetchHistory(1);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Ошибка создания кода");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancelCode = async (codeId: string) => {
    if (!token) return;
    if (!window.confirm("Точно отменить этот подарочный код?")) return;
    setActionLoading(`cancel-${codeId}`);
    try {
      await api.giftCancelCode(token, codeId);
      await fetchData();
      fetchHistory(1);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Ошибка отмены кода");
    } finally {
      setActionLoading(null);
    }
  };

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !redeemCode.trim()) return;
    setRedeemLoading(true);
    setRedeemError(null);
    setRedeemSuccess(null);
    try {
      await api.giftRedeemCode(token, redeemCode.trim());
      setRedeemSuccess("Код успешно активирован!");
      setRedeemCode("");
      await fetchData();
      fetchHistory(1);
      refreshProfile().catch(() => {});
    } catch (err) {
      setRedeemError(err instanceof Error ? err.message : "Ошибка активации");
    } finally {
      setRedeemLoading(false);
    }
  };

  const handleGetUrl = async (subscription: { id: string; giftStatus: string | null }) => {
    const subscriptionId = subscription.id;
    setActionLoading(`url-${subscriptionId}`);
    try {
      const activeCode = codes.find(
        (c) => c.secondarySubscriptionId === subscriptionId && c.status === "ACTIVE"
      );
      if (!activeCode) {
        if (subscription.giftStatus === "GIFTED") {
          alert("Эта подписка уже подарена. Ссылка недоступна.");
        } else {
          alert("Сначала создайте подарочный код кнопкой «Подарить», затем появится ссылка.");
        }
        return;
      }
      const appUrl =
        config?.publicAppUrl?.replace(/\/$/, "") ||
        (typeof window !== "undefined" ? window.location.origin : "");
      const link = `${appUrl}/gift/${activeCode.code}`;
      await navigator.clipboard.writeText(link);
      setCopiedId(`url-${subscriptionId}`);
      setTimeout(() => setCopiedId(null), 2000);
    } finally {
      setActionLoading(null);
    }
  };

  const handleActivateForSelf = async (subscriptionId: string) => {
    if (!token) return;
    setActionLoading(`activate-${subscriptionId}`);
    try {
      await api.giftActivateForSelf(token, subscriptionId);
      await fetchData();
      fetchHistory(1);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Ошибка активации");
    } finally {
      setActionLoading(null);
    }
  };

  const copyCode = async (code: string, id: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedId(`code-${id}`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const maxSubs = config?.maxAdditionalSubscriptions ?? 5;
  const currentSubs = subscriptions.length;
  const canBuyMore = currentSubs < maxSubs;
  const giftedCount = subscriptions.filter(s => s.giftStatus === "GIFTED").length;
  const activeCodesCount = codes.filter(c => c.status === "ACTIVE").length;

  if (loading && subscriptions.length === 0 && codes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 w-full min-w-0 pb-12">
      {/* SECTION 1: HERO */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative overflow-hidden rounded-3xl bg-card/40 backdrop-blur-2xl border border-border/50 p-8 sm:p-10 shadow-xl"
      >
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-primary/20 blur-[80px] pointer-events-none -mr-20 -mt-20" />
        <div className="absolute bottom-0 left-0 w-64 h-64 rounded-full bg-blue-500/10 blur-[80px] pointer-events-none -ml-20 -mb-20" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div className="flex-1">
            <div className="flex items-center gap-4 mb-3">
              <div className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner border border-primary/20">
                <Gift className="h-7 w-7" />
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">Подарки</h1>
            </div>
            <p className="text-[16px] text-muted-foreground max-w-xl leading-relaxed">
              Покупайте подписки VPN для друзей или активируйте вторую подписку для себя
            </p>
          </div>
          <div className="flex flex-col items-start sm:items-end gap-3 shrink-0 sm:min-w-[240px]">
            <Button data-tour="gifts-buy-button" onClick={handleOpenBuy} disabled={!canBuyMore} className="w-full sm:w-auto h-14 px-8 rounded-2xl shadow-lg hover:shadow-primary/25 transition-all text-base font-bold gap-2">
              <Plus className="w-5 h-5" />
              Купить подписку
            </Button>
            <div className="flex items-center justify-center sm:justify-end gap-2 text-sm text-muted-foreground font-medium px-4 py-2.5 rounded-xl bg-background/30 backdrop-blur-md border border-border/40 shadow-sm w-full sm:w-auto">
              <Package className="w-4 h-4 opacity-70" />
              <span>Доступно слотов: <strong className="text-foreground">{currentSubs} из {maxSubs}</strong></span>
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-6 rounded-lg bg-destructive/15 border border-destructive/30 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
      </motion.section>

      {/* SECTION 2: ACTION CARDS ROW */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 flex flex-col gap-6">
          {/* Card 1: Redeem Code */}
          <motion.div 
            data-tour="gifts-redeem"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl shadow-lg p-6 sm:p-8 flex flex-col relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-[40px] pointer-events-none" />
            <div className="flex items-center gap-4 mb-6 relative z-10">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Gift className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold">Активировать код</h2>
                <p className="text-sm text-muted-foreground">У вас есть подарочный код?</p>
              </div>
            </div>
            
            <form onSubmit={handleRedeem} className="flex flex-col gap-3 mt-auto relative z-10">
              <Input 
                value={redeemCode}
                onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
                placeholder="CODE-XXXX-XXXX"
                className="h-12 text-center font-mono text-base tracking-widest rounded-xl border-border/50 bg-background/50 focus-visible:ring-primary/30 uppercase"
              />
              <Button type="submit" className="h-12 rounded-xl shadow-md font-bold" disabled={redeemLoading || !redeemCode.trim()}>
                {redeemLoading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Send className="w-5 h-5 mr-2" />}
                Активировать
              </Button>
              <AnimatePresence>
                {redeemError && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                    <div className="mt-2 p-3 rounded-xl bg-destructive/10 text-destructive text-sm font-medium text-center">
                      {redeemError}
                    </div>
                  </motion.div>
                )}
                {redeemSuccess && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                    <div className="mt-2 p-3 rounded-xl bg-green-500/10 text-green-500 text-sm font-medium text-center flex items-center justify-center gap-2">
                      <CheckCircle2 className="w-4 h-4" /> {redeemSuccess}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </form>
          </motion.div>

          {/* Card 3: Stats */}
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl shadow-lg p-6 sm:p-8"
          >
            <h2 className="text-xl font-bold mb-6">Статистика</h2>
            <div className="space-y-3">
              <div className="flex items-center gap-4 bg-background/40 p-4 rounded-2xl border border-border/50">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
                  <Package className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Всего подписок</p>
                  <p className="text-[15px] font-semibold text-foreground">{subscriptions.length}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 bg-background/40 p-4 rounded-2xl border border-border/50">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-500">
                  <Send className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Подарено</p>
                  <p className="text-[15px] font-semibold text-foreground">{giftedCount}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 bg-background/40 p-4 rounded-2xl border border-border/50">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-green-500/10 text-green-500">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Активные коды</p>
                  <p className="text-[15px] font-semibold text-foreground">{activeCodesCount}</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Card 2: History Timeline */}
        <motion.div 
          data-tour="gifts-history"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="lg:col-span-7 rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl shadow-lg p-6 sm:p-8 flex flex-col"
        >
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <History className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold">История</h2>
                <p className="text-sm text-muted-foreground">Последние действия</p>
              </div>
            </div>
            {historyTotal > 4 && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setShowFullHistory(!showFullHistory)}
                className="rounded-xl text-primary hover:text-primary hover:bg-primary/10"
              >
                {showFullHistory ? "Скрыть" : "Показать всё"}
                {showFullHistory ? <ChevronUp className="w-4 h-4 ml-1" /> : <ChevronDown className="w-4 h-4 ml-1" />}
              </Button>
            )}
          </div>
          
          <div className="flex-1">
            {historyLoading && historyItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Загрузка истории…</p>
              </div>
            ) : historyItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-center gap-3 border border-dashed border-border/50 rounded-2xl bg-muted/20">
                <History className="w-8 h-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">История пуста</p>
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  <AnimatePresence mode="popLayout">
                    {historyItems.slice(0, showFullHistory ? undefined : 4).map((item, i) => {
                      const ev = HISTORY_EVENT_MAP[item.eventType] ?? { icon: <Clock className="w-5 h-5" />, label: item.eventType, color: "text-muted-foreground bg-muted/20 border-muted/30" };
                      const meta = item.metadata as Record<string, string> | null;
                      const timeAgo = formatTimeAgo(item.createdAt);

                      return (
                        <motion.div
                          key={item.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          transition={{ duration: 0.3, delay: i * 0.05 }}
                          className="group relative flex flex-col sm:flex-row gap-4 p-4 sm:p-5 rounded-[1.5rem] bg-background/50 backdrop-blur-xl border border-border/50 shadow-sm transition-all duration-300 hover:bg-card hover:shadow-md hover:border-border/80"
                        >
                          <div className={`flex h-12 w-12 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-[1rem] sm:rounded-[1.25rem] bg-background shadow-inner transition-transform group-hover:scale-105 duration-300 border ${ev.color}`}>
                            {ev.icon}
                          </div>
                          
                          <div className="flex-1 min-w-0 flex flex-col justify-center">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                              <span className="text-[16px] sm:text-[17px] font-bold text-foreground tracking-tight">{ev.label}</span>
                              <span className="text-[12px] font-semibold text-muted-foreground/80 bg-background/50 px-2.5 py-1 rounded-lg whitespace-nowrap self-start sm:self-auto border border-border/30">{timeAgo}</span>
                            </div>
                            
                            {meta && Object.keys(meta).length > 0 && (
                              <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                                {meta.code && (
                                  <span className="font-mono bg-primary/10 text-primary px-2.5 py-1.5 rounded-xl border border-primary/20 shadow-sm">{meta.code}</span>
                                )}
                                {meta.tariffName && (
                                  <span className="flex items-center bg-muted/40 text-muted-foreground px-2.5 py-1.5 rounded-xl border border-border/30">
                                    <Package className="w-3.5 h-3.5 mr-1.5 opacity-70" />
                                    {meta.tariffName}
                                  </span>
                                )}
                                {meta.recipientUsername && (
                                  <span className="flex items-center bg-blue-500/10 text-blue-500 dark:text-blue-400 px-2.5 py-1.5 rounded-xl border border-blue-500/20">
                                    <User className="w-3.5 h-3.5 mr-1.5 opacity-70" />
                                    → @{meta.recipientUsername}
                                  </span>
                                )}
                                {meta.senderUsername && (
                                  <span className="flex items-center bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 px-2.5 py-1.5 rounded-xl border border-emerald-500/20">
                                    <User className="w-3.5 h-3.5 mr-1.5 opacity-70" />
                                    от @{meta.senderUsername}
                                  </span>
                                )}
                              </div>
                            )}
                            
                            {meta?.giftMessage && (
                              <div className="mt-3.5 relative pl-4 py-2.5 pr-3 rounded-r-2xl bg-muted/30 border border-l-0 border-border/30 text-muted-foreground/90 italic text-[13px] leading-relaxed">
                                <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-full bg-primary/40"></div>
                                "{meta.giftMessage}"
                              </div>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
                {showFullHistory && historyTotal > 10 && (
                  <div className="flex items-center justify-center gap-3 pt-6">
                    <Button variant="outline" size="sm" className="rounded-xl border-border/50" disabled={historyPage <= 1 || historyLoading} onClick={() => setHistoryPage((p) => p - 1)}>
                      ← Назад
                    </Button>
                    <span className="text-xs font-medium text-muted-foreground bg-muted/30 px-3 py-1.5 rounded-lg">
                      {historyPage} / {Math.ceil(historyTotal / 10)}
                    </span>
                    <Button variant="outline" size="sm" className="rounded-xl border-border/50" disabled={historyPage >= Math.ceil(historyTotal / 10) || historyLoading} onClick={() => setHistoryPage((p) => p + 1)}>
                      Вперед →
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </motion.div>
      </div>

      {/* SECTION 3: SUBSCRIPTIONS */}
      {(() => {
        const displaySubs = tourMockSubs.length > 0 ? tourMockSubs : subscriptions;
        return (
      <div data-tour="gifts-subscriptions" className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight">Мои подписки</h2>
        </div>
        
        {displaySubs.length === 0 ? (
          <div className="p-8 sm:p-12 rounded-3xl border border-dashed border-border/50 flex flex-col items-center justify-center text-center gap-4 bg-muted/10">
            <Package className="w-10 h-10 text-muted-foreground/40" />
            <p className="text-muted-foreground">У вас пока нет дополнительных подписок.</p>
            {canBuyMore && (
              <Button onClick={handleOpenBuy} className="mt-2 rounded-xl shadow-md gap-2" size="lg">
                <Plus className="w-5 h-5" />
                Приобрести
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <AnimatePresence mode="popLayout">
              {displaySubs.map((sub, i) => {
                const isGifted = sub.giftStatus === "GIFTED";
                const isActivatedSelf = sub.giftStatus === "ACTIVATED_SELF";
                const isReserved = sub.giftStatus === "GIFT_RESERVED";
                const activeCode = codes.find(c => c.secondarySubscriptionId === sub.id && c.status === "ACTIVE");
                const isFinalized = isGifted || isActivatedSelf;
                const statusText = isGifted
                  ? "Эта подписка была подарена вам."
                  : isActivatedSelf
                    ? "Эта подписка была активирована вами."
                    : isReserved
                      ? "Подарок уже создан. Можно скопировать код или ссылку, отменить подарок либо оставить подписку себе."
                      : "Доступна для подарка или активации себе.";

                return (
                  <motion.div
                    key={sub.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ delay: i * 0.05 }}
                    className="rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl shadow-lg p-6 sm:p-8 flex flex-col gap-6 relative overflow-hidden"
                  >
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <h3 className="text-xl font-bold text-foreground">Подписка #{sub.subscriptionIndex}</h3>
                        <p className="text-sm text-muted-foreground mt-1 max-w-[240px]">
                          {statusText}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${isGifted ? 'bg-purple-500/15 text-purple-500 border border-purple-500/20' : isActivatedSelf ? 'bg-blue-500/15 text-blue-500 border border-blue-500/20' : isReserved ? 'bg-amber-500/15 text-amber-500 border border-amber-500/20' : 'bg-green-500/15 text-green-500 border border-green-500/20'}`}>
                        {isGifted ? "Получена в подарок" : isActivatedSelf ? "Для себя" : isReserved ? "Код создан" : "Доступна"}
                      </span>
                    </div>

                    {!isFinalized && activeCode && (
                      <div className="bg-background/40 p-4 rounded-2xl border border-border/50 flex items-center justify-between gap-3">
                        <code className="text-lg font-mono font-bold tracking-wider text-foreground">{activeCode.code}</code>
                        <Button variant="ghost" size="icon" onClick={() => copyCode(activeCode.code, activeCode.id)} className="h-9 w-9 rounded-xl hover:bg-muted">
                          {copiedId === `code-${activeCode.id}` ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
                        </Button>
                      </div>
                    )}

                    {isFinalized ? (
                      <div className="mt-auto rounded-2xl bg-green-500/10 border border-green-500/20 p-4 flex items-center justify-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                        <span className="text-sm font-semibold text-green-600 dark:text-green-400">Активирована</span>
                      </div>
                    ) : isReserved ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-auto">
                        <Button
                          variant="secondary"
                          className="rounded-xl bg-primary/10 hover:bg-primary/20 text-primary border-none shadow-none w-full gap-2"
                          onClick={() => handleGetUrl(sub)}
                          disabled={!activeCode || actionLoading === `url-${sub.id}`}
                        >
                          {actionLoading === `url-${sub.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : copiedId === `url-${sub.id}` ? <Check className="w-4 h-4" /> : <LinkIcon className="w-4 h-4" />}
                          Скопировать ссылку
                        </Button>
                        <Button
                          variant="secondary"
                          className="rounded-xl bg-background/70 hover:bg-muted text-foreground border border-border/60 shadow-none w-full gap-2"
                          onClick={() => activeCode && copyCode(activeCode.code, activeCode.id)}
                          disabled={!activeCode}
                        >
                          {activeCode && copiedId === `code-${activeCode.id}` ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                          Скопировать код
                        </Button>
                        <Button
                          variant="secondary"
                          className="rounded-xl bg-green-500/10 hover:bg-green-500/20 text-green-600 dark:text-green-400 font-semibold border-none shadow-none w-full gap-2"
                          onClick={() => handleActivateForSelf(sub.id)}
                          disabled={actionLoading === `activate-${sub.id}`}
                        >
                          {actionLoading === `activate-${sub.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                          Оставить себе
                        </Button>
                        <Button
                          variant="destructive"
                          className="rounded-xl bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground border-none shadow-none w-full gap-2"
                          onClick={() => activeCode && handleCancelCode(activeCode.id)}
                          disabled={!activeCode || actionLoading === `cancel-${activeCode.id}`}
                        >
                          {activeCode && actionLoading === `cancel-${activeCode.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                          Отменить подарок
                        </Button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-auto">
                        <Button
                          className="rounded-xl shadow-md w-full gap-2"
                          onClick={() => handleCreateCode(sub.id)}
                          disabled={actionLoading === `create-${sub.id}`}
                        >
                          {actionLoading === `create-${sub.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
                          Подарить
                        </Button>
                        <Button
                          variant="secondary"
                          className="rounded-xl bg-green-500/10 hover:bg-green-500/20 text-green-600 dark:text-green-400 font-semibold border-none shadow-none w-full gap-2"
                          onClick={() => handleActivateForSelf(sub.id)}
                          disabled={actionLoading === `activate-${sub.id}`}
                        >
                          {actionLoading === `activate-${sub.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                          Активировать себе
                        </Button>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
        );
      })()}

      {/* SECTION 4: GIFT CODES */}
      {codes.length > 0 && (
        <div className="space-y-6 pt-4">
          <h2 className="text-2xl font-bold tracking-tight">Все подарочные коды</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <AnimatePresence mode="popLayout">
              {codes.map((c, i) => {
                const isActive = c.status === "ACTIVE";
                const isRedeemed = c.status === "REDEEMED";
                
                return (
                  <motion.div
                    key={c.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ delay: i * 0.05 }}
                    className={`rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl shadow-lg p-6 flex flex-col gap-4 ${!isActive ? 'opacity-60 grayscale-[0.2]' : ''}`}
                  >
                    <div className="flex justify-between items-start">
                      <span className={`rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider ${isActive ? 'bg-green-500/15 text-green-500' : isRedeemed ? 'bg-blue-500/15 text-blue-500' : 'bg-muted text-muted-foreground'}`}>
                        {isActive ? "Активен" : isRedeemed ? "Активирован" : "Отменён"}
                      </span>
                      <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5 bg-background/40 px-2 py-1 rounded-lg border border-border/30">
                        <Clock className="w-3 h-3" /> {new Date(c.createdAt).toLocaleDateString("ru-RU")}
                      </span>
                    </div>
                    
                    <div className="flex items-center justify-center py-4 bg-background/40 rounded-2xl border border-border/50">
                      <code className="text-[17px] sm:text-lg font-mono font-bold tracking-widest text-foreground">
                        {c.code}
                      </code>
                    </div>
                    
                    {isActive && (
                      <div className="grid grid-cols-2 gap-3 mt-auto">
                        <Button 
                          variant="secondary" 
                          className="rounded-xl bg-primary/10 hover:bg-primary/20 text-primary border-none shadow-none gap-2"
                          onClick={() => copyCode(c.code, c.id)}
                        >
                          {copiedId === `code-${c.id}` ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          Копировать
                        </Button>
                        <Button 
                          variant="destructive" 
                          className="rounded-xl bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground border-none shadow-none gap-2"
                          onClick={() => handleCancelCode(c.id)}
                          disabled={actionLoading === `cancel-${c.id}`}
                        >
                          {actionLoading === `cancel-${c.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                          Отменить
                        </Button>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Buy Dialog */}
      <Dialog open={buyDialogOpen} onOpenChange={setBuyDialogOpen}>
        <DialogContent className="max-w-md rounded-[2rem] sm:rounded-[2.5rem] p-0 overflow-hidden bg-background/80 backdrop-blur-3xl border-white/10" showCloseButton={false}>
          <div className="p-6 sm:p-8 space-y-6">
            <DialogHeader className="text-center space-y-2">
              <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-2 shadow-inner border border-primary/20">
                <Plus className="w-6 h-6" />
              </div>
              <DialogTitle className="text-xl font-bold">Купить подписку в подарок</DialogTitle>
              <DialogDescription className="text-center">
                Выберите тариф для дополнительной подписки. Она будет оплачена с вашего баланса.
              </DialogDescription>
            </DialogHeader>

            {buyError && (
              <div className="p-3 rounded-xl bg-destructive/10 text-destructive text-sm text-center font-medium">
                {buyError}
              </div>
            )}

            <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
              {tariffs.length === 0 ? (
                <div className="flex justify-center p-6"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
              ) : (
                tariffs.map((t) => (
                  <div key={t.id} className="flex flex-col p-4 rounded-2xl border border-border/50 bg-background/50 hover:bg-muted/50 transition-colors">
                    <div className="flex justify-between items-start mb-2">
                      <div className="font-bold text-foreground truncate text-base">{t.name}</div>
                      <div className="font-bold text-primary shrink-0 ml-2 text-base">{formatMoney(t.price, currency)}</div>
                    </div>
                    <div className="flex items-center gap-3 text-xs font-medium text-muted-foreground mb-4">
                      <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> {t.durationDays} дн.</span>
                    </div>
                    <Button 
                      onClick={() => handleBuy(t.id)} 
                      disabled={buyLoading || (client?.balance ?? 0) < t.price}
                      className="w-full rounded-xl font-bold shadow-md h-11"
                    >
                      {buyLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                      {(client?.balance ?? 0) < t.price ? "Недостаточно средств" : `Купить за ${formatMoney(t.price, currency)}`}
                    </Button>
                  </div>
                ))
              )}
            </div>

            <DialogFooter className="flex-col sm:flex-col gap-2 pt-4 border-t border-white/10 mt-6">
              <div className="flex justify-between items-center w-full px-2 mb-3 text-sm">
                <span className="text-muted-foreground">Ваш баланс:</span>
                <span className="font-bold text-foreground text-base">{formatMoney(client?.balance ?? 0, currency)}</span>
              </div>
              <Button variant="ghost" onClick={() => setBuyDialogOpen(false)} className="w-full rounded-xl font-semibold h-11">
                Отмена
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
