import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Megaphone, Wallet, RefreshCw, Plus, Loader2, KeyRound, Eye, EyeOff, Power, Archive, Star, Send, Clock, TrendingUp, X, Check, AlertCircle, ExternalLink } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { api, type GramadsPostDto, type GramadsBalanceDto, type GramadsPostPageDto, type GramadsDepositPageDto, type GramadsIncomesExpensesDto } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GlassSelect } from "@/components/ui/glass-select";
import type { AdminSettings } from "@/lib/api";

const STRATEGY_OPTIONS = [
  { value: "0", label: "Minimum (дешёвые боты)" },
  { value: "1", label: "Normal (стандарт)" },
  { value: "2", label: "Max (премиум)" },
];

const MARKUP_OPTIONS = [
  { value: "0", label: "Plain text" },
  { value: "1", label: "Markdown" },
  { value: "2", label: "HTML" },
];

const CATEGORY_NAMES: Record<number, string> = {
  0: "Other", 1: "Crypto", 2: "Business/Marketing", 3: "Entertainment", 4: "Tech/IT",
  5: "News/Media", 6: "Sports", 7: "Betting", 8: "Gaming", 9: "Education",
  10: "Finance", 11: "Shops/Goods", 12: "Services", 13: "Art/Design",
  14: "Health/Lifestyle", 15: "Adults", 17: "VPN/Proxy",
};

const MODERATION_LABEL: Record<number, string> = {
  0: "На модерации",
  1: "Одобрено",
  2: "Отклонено",
};

const MODERATION_COLOR: Record<number, string> = {
  0: "bg-yellow-500/10 text-yellow-400",
  1: "bg-green-500/10 text-green-400",
  2: "bg-red-500/10 text-red-400",
};

// Форматтеры значений Gramads API.
// В Gramads оплачиваемые показы (`PostDto.paid`, `ChartDto.paidReward`) хранятся в "сотых
// показа" — т.е. 1 реальный показ = 100 внутренних единиц. Делим на 100, чтобы получить
// понятную пользователю цифру.
const GRAMADS_PAID_SCALE = 100;

/** Преобразует `PostDto.paid` (int64) в количество оплаченных показов.
 *  Gramads возвращает -1, когда биллинг по кампании ещё не прогонялся. */
function formatPaid(paid: number | undefined | null): string {
  if (typeof paid !== "number" || paid < 0) return "—";
  return Math.round(paid / GRAMADS_PAID_SCALE).toLocaleString();
}
/** Преобразует `ChartDto.paidReward` в количество оплаченных показов за период. */
function scalePaidReward(paid: number | undefined | null): number {
  if (typeof paid !== "number" || paid <= 0) return 0;
  return Math.round(paid / GRAMADS_PAID_SCALE);
}
// `limit` (int32) — лимит показов; 0 означает «без лимита».
function formatLimit(limit: number | undefined | null, unlimitedLabel: string): string {
  if (typeof limit !== "number" || limit <= 0) return unlimitedLabel;
  return limit.toLocaleString();
}

// Пояснение по коду NotSuccessExplanation от Gramads API.
// Пояснение в swagger не даётся, но опытным путём:
// 0 — успех, 1-4 — различные причины отказа (недостаточно баланса, пост на модерации, отклонён и т.п.).
function notSuccessExplanationHint(code: number | undefined): string {
  if (!code) return "";
  switch (code) {
    case 1: return "Недостаточно баланса на счёте Gramads.";
    case 2: return "Пост ещё на модерации Gramads (≈ до 24 ч).";
    case 3: return "Пост отклонён модераторами Gramads.";
    case 4: return "Действие сейчас недоступно (ограничение Gramads).";
    default: return `Gramads вернул код ошибки: ${code}.`;
  }
}

export function GramadsPromoPage() {
  const { t } = useTranslation();
  const token = useAuth().state.accessToken!;

  // Статус ключа
  const [statusLoading, setStatusLoading] = useState(true);
  const [status, setStatus] = useState<{ configured: boolean; valid: boolean; error?: string } | null>(null);

  // Форма API ключа
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [keyMessage, setKeyMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Данные кабинета
  const [balance, setBalance] = useState<GramadsBalanceDto | null>(null);
  const [incomes, setIncomes] = useState<GramadsIncomesExpensesDto | null>(null);
  const [topups, setTopups] = useState<GramadsDepositPageDto | null>(null);

  const [posts, setPosts] = useState<GramadsPostPageDto | null>(null);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postFilter, setPostFilter] = useState<"active" | "archived" | "all">("active");

  // Модалка создания
  const [createOpen, setCreateOpen] = useState(false);
  const [detailPost, setDetailPost] = useState<GramadsPostDto | null>(null);

  // Активная вкладка
  const [activeTab, setActiveTab] = useState("wallet");

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const r = await api.gramadsStatus(token);
      setStatus({ configured: r.configured, valid: r.valid, error: r.error });
    } catch (e) {
      setStatus({ configured: false, valid: false, error: e instanceof Error ? e.message : "error" });
    } finally {
      setStatusLoading(false);
    }
  }, [token]);

  const loadWallet = useCallback(async () => {
    if (!status?.valid) return;
    try {
      const [b, ie, tp] = await Promise.all([
        api.gramadsGetBalance(token).catch(() => null),
        api.gramadsGetIncomesAndExpenses(token, 30).catch(() => null),
        api.gramadsGetMyTopups(token, 10, 0).catch(() => null),
      ]);
      setBalance(b);
      setIncomes(ie);
      setTopups(tp);
    } catch {}
  }, [token, status?.valid]);

  const loadPosts = useCallback(async () => {
    if (!status?.valid) return;
    setPostsLoading(true);
    try {
      const args: Parameters<typeof api.gramadsGetMyPosts>[1] = { count: 100, pageIndex: 0 };
      if (postFilter === "archived") args.isArchived = true;
      else if (postFilter === "active") { args.isArchived = false; args.activeOnly = true; }
      else args.isArchived = false;
      const r = await api.gramadsGetMyPosts(token, args);
      setPosts(r);
    } catch {
      setPosts(null);
    } finally {
      setPostsLoading(false);
    }
  }, [token, status?.valid, postFilter]);

  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => { loadWallet(); }, [loadWallet]);
  useEffect(() => { loadPosts(); }, [loadPosts]);

  // Сохранение API-ключа (через /admin/settings)
  const saveApiKey = async () => {
    setSavingKey(true);
    setKeyMessage(null);
    try {
      await api.updateSettings(token, { gramadsApiKey: apiKeyInput.trim() } as Partial<AdminSettings> as never);
      setApiKeyInput("");
      await loadStatus();
      // loadStatus() обновит status — если valid=false покажем баннер.
      // Здесь сообщаем что save прошёл (Gramads validation — отдельная проверка ниже).
      setKeyMessage({ type: "ok", text: "Ключ сохранён. Проверяем валидность…" });
      setTimeout(() => setKeyMessage(null), 4000);
    } catch (e) {
      setKeyMessage({ type: "err", text: e instanceof Error ? e.message : "Ошибка сохранения" });
    } finally {
      setSavingKey(false);
    }
  };

  const clearApiKey = async () => {
    setSavingKey(true);
    setKeyMessage(null);
    try {
      await api.updateSettings(token, { gramadsApiKey: "" } as Partial<AdminSettings> as never);
      setApiKeyInput("");
      setStatus({ configured: false, valid: false });
      setBalance(null);
      setIncomes(null);
      setTopups(null);
      setPosts(null);
      setKeyMessage({ type: "ok", text: "Ключ удалён" });
      setTimeout(() => setKeyMessage(null), 3000);
    } catch (e) {
      setKeyMessage({ type: "err", text: e instanceof Error ? e.message : "Ошибка" });
    } finally {
      setSavingKey(false);
    }
  };

  const onPostAction = useCallback(async (action: "switchEnabled" | "switchFavourite" | "switchPremium" | "switchGroups" | "switchGAlity", postId: number) => {
    try {
      // Gramads API ожидает полный PostDto в теле — и берёт из него целевое значение
      // переключаемого флага (а не «инвертирует» по id). Если прислать `{id}`, все булевы
      // поля уйдут как false и переключение фактически не произойдёт.
      const current =
        detailPost?.id === postId
          ? detailPost
          : (posts?.items ?? []).find((p) => p.id === postId) ?? null;
      if (!current) { alert("Пост не найден в списке — обновите страницу."); return; }

      // Копируем текущее состояние и выставляем желаемое значение конкретного флага.
      const payload: GramadsPostDto = { ...current };
      if (action === "switchEnabled") payload.enabled = !current.enabled;
      else if (action === "switchFavourite") payload.isFavourite = !current.isFavourite;
      else if (action === "switchPremium") payload.premiumOnlyEnabled = !current.premiumOnlyEnabled;
      else if (action === "switchGroups") payload.groupChatsEnabled = !current.groupChatsEnabled;
      else if (action === "switchGAlity") payload.gAlityEnabled = !current.gAlityEnabled;

      let updated: GramadsPostDto;
      if (action === "switchEnabled") updated = await api.gramadsSwitchEnabled(token, payload);
      else if (action === "switchFavourite") updated = await api.gramadsSwitchIsFavourite(token, payload);
      else if (action === "switchPremium") updated = await api.gramadsSwitchPremiumOnlyEnabled(token, payload);
      else if (action === "switchGroups") updated = await api.gramadsSwitchGroupsEnabled(token, payload);
      else updated = await api.gramadsSwitchGAlityEnabled(token, payload);

      // Немедленно отразим ответ в UI.
      if (detailPost?.id === postId) setDetailPost(updated);
      setPosts((prev) => (prev ? { ...prev, items: prev.items.map((p) => (p.id === postId ? updated : p)) } : prev));

      // Диагностика: действие не применилось.
      const expl = updated.notSuccessExplanation ?? 0;
      if (expl && expl !== 0) {
        alert(notSuccessExplanationHint(expl));
      } else if (action === "switchEnabled" && current.enabled === updated.enabled) {
        if (updated.moderationStatus === 2) alert("Пост отклонён модераторами Gramads. Создайте новую кампанию с другим текстом/ссылкой.");
        else alert("Gramads не применил действие. Проверьте, что на балансе есть показы и что кампания одобрена.");
      }

      void loadPosts();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
  }, [token, loadPosts, detailPost, posts]);

  // === Render ===

  if (statusLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mb-2" />
        <p>{t("admin.common.loading")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4">
      {/* Заголовок */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <Megaphone className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t("admin.gramads.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("admin.gramads.subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status?.configured && (
            <Button variant="outline" onClick={() => { loadStatus(); loadWallet(); loadPosts(); }} disabled={postsLoading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${postsLoading ? "animate-spin" : ""}`} />
              {t("admin.common.refresh")}
            </Button>
          )}
          <a href="https://gramads.net" target="_blank" rel="noopener noreferrer" className="inline-flex">
            <Button variant="outline">
              <ExternalLink className="h-4 w-4 mr-2" />
              gramads.net
            </Button>
          </a>
        </div>
      </div>

      {/* Если ключ ещё не введён в БД — показываем форму подключения. */}
      {!status?.configured ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              <CardTitle>{t("admin.gramads.connect_title")}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 text-sm space-y-2">
              <p className="font-semibold flex items-center gap-2 text-amber-700 dark:text-amber-300"><AlertCircle className="h-4 w-4" /> {t("admin.gramads.how_to_get_key")}</p>
              <ol className="list-decimal pl-5 space-y-1 text-foreground/80">
                <li>{t("admin.gramads.step_1")}</li>
                <li>{t("admin.gramads.step_2")}</li>
                <li>{t("admin.gramads.step_3")}</li>
              </ol>
            </div>
            <div className="space-y-2">
              <Label>{t("admin.gramads.api_key")}</Label>
              <div className="flex gap-2">
                <Input
                  type={apiKeyVisible ? "text" : "password"}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="eyJhbGciOi... или API-токен из кабинета Gramads"
                  className="font-mono"
                />
                <Button type="button" variant="outline" size="icon" onClick={() => setApiKeyVisible((v) => !v)}>
                  {apiKeyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={saveApiKey} disabled={!apiKeyInput.trim() || savingKey}>
                {savingKey ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {t("admin.settings.saving")}</> : <><Check className="h-4 w-4 mr-2" /> {t("admin.gramads.connect")}</>}
              </Button>
            </div>
            {keyMessage && (
              <div className={`text-xs rounded-lg px-3 py-2 border ${
                keyMessage.type === "ok"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                  : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
              }`}>
                {keyMessage.text}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Баннер если ключ есть, но не валиден */}
          {!status?.valid && (
            <Card className="border-red-500/40 bg-red-500/5">
              <CardContent className="py-4 flex flex-wrap items-center gap-3">
                <AlertCircle className="h-5 w-5 text-red-500 dark:text-red-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-red-600 dark:text-red-400">
                    {t("admin.gramads.invalid_key", "API-ключ сохранён, но Gramads его отклонил")}
                  </p>
                  {status?.error && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Причина: {status.error}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Перейдите на вкладку «API ключ» чтобы заменить или удалить ключ.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setActiveTab("settings")}>
                  <KeyRound className="h-4 w-4 mr-2" /> Заменить ключ
                </Button>
              </CardContent>
            </Card>
          )}
          {/* Кабинет — вкладки показываются всегда когда configured */}
          {/* Кабинет */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="wallet"><Wallet className="h-4 w-4 mr-2" /> {t("admin.gramads.wallet")}</TabsTrigger>
              <TabsTrigger value="campaigns"><Megaphone className="h-4 w-4 mr-2" /> {t("admin.gramads.campaigns")}</TabsTrigger>
              <TabsTrigger value="settings"><KeyRound className="h-4 w-4 mr-2" /> {t("admin.gramads.api_key")}</TabsTrigger>
            </TabsList>

            {/* Кошелёк */}
            <TabsContent value="wallet" className="space-y-4 mt-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardHeader><CardTitle className="text-sm text-muted-foreground">{t("admin.gramads.balance")}</CardTitle></CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-primary">{balance?.balance != null ? Math.round(balance.balance).toLocaleString() : "—"}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t("admin.gramads.impressions_unit")}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-sm text-muted-foreground">{t("admin.gramads.spent_30d")}</CardTitle></CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold text-orange-400">
                      {scalePaidReward((incomes?.expenses ?? []).reduce((s, c) => s + (c.paidReward || 0), 0)).toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{t("admin.gramads.impressions_unit")}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-sm text-muted-foreground">{t("admin.gramads.topups_30d")}</CardTitle></CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold text-green-400">
                      {scalePaidReward((incomes?.incomes ?? []).reduce((s, c) => s + (c.paidReward || 0), 0)).toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{t("admin.gramads.impressions_unit")}</p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader><CardTitle>{t("admin.gramads.topups_history")}</CardTitle></CardHeader>
                <CardContent>
                  {topups?.items?.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-muted-foreground">
                          <tr className="border-b border-border/50">
                            <th className="text-left py-2 px-3">ID</th>
                            <th className="text-left py-2 px-3">{t("admin.gramads.amount")}</th>
                            <th className="text-left py-2 px-3">{t("admin.gramads.date")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {topups.items.map((d) => (
                            <tr key={d.id} className="border-b border-border/30 hover:bg-muted/30">
                              <td className="py-2 px-3 font-mono text-xs">{d.id}</td>
                              <td className="py-2 px-3">{Math.round(d.amount).toLocaleString()} <span className="text-xs text-muted-foreground">{t("admin.gramads.impressions_unit")}</span></td>
                              <td className="py-2 px-3 text-muted-foreground">{new Date(d.dateCreated).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <p className="text-muted-foreground text-sm">{t("admin.gramads.no_topups")}</p>}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Кампании */}
            <TabsContent value="campaigns" className="space-y-4 mt-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Button variant={postFilter === "active" ? "default" : "outline"} size="sm" onClick={() => setPostFilter("active")}>{t("admin.gramads.filter_active")}</Button>
                  <Button variant={postFilter === "all" ? "default" : "outline"} size="sm" onClick={() => setPostFilter("all")}>{t("admin.gramads.filter_all")}</Button>
                  <Button variant={postFilter === "archived" ? "default" : "outline"} size="sm" onClick={() => setPostFilter("archived")}>{t("admin.gramads.filter_archived")}</Button>
                </div>
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t("admin.gramads.new_campaign")}
                </Button>
              </div>

              {postsLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> {t("admin.common.loading")}</div>
              ) : !posts?.items?.length ? (
                <Card><CardContent className="py-8 text-center text-muted-foreground">{t("admin.gramads.no_campaigns")}</CardContent></Card>
              ) : (
                <div className="grid gap-3">
                  {posts.items.map((p) => (
                    <CampaignCard
                      key={p.id}
                      post={p}
                      onOpen={() => setDetailPost(p)}
                      onAction={(a) => onPostAction(a, p.id)}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="settings" className="space-y-4 mt-4">
              <Card>
                <CardHeader><CardTitle>{t("admin.gramads.api_key")}</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className={`text-sm rounded-lg px-3 py-2 border ${
                    status?.valid
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                      : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
                  }`}>
                    {status?.valid
                      ? "✓ Ключ сохранён и валиден"
                      : `✕ Ключ сохранён, но Gramads его отклоняет${status?.error ? ` (${status.error})` : ""}`}
                  </div>

                  <div className="space-y-2">
                    <Label>Заменить ключ</Label>
                    <div className="flex gap-2">
                      <Input
                        type={apiKeyVisible ? "text" : "password"}
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        placeholder="Новый API-ключ из кабинета Gramads"
                        className="font-mono"
                      />
                      <Button type="button" variant="outline" size="icon" onClick={() => setApiKeyVisible((v) => !v)}>
                        {apiKeyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <Button onClick={saveApiKey} disabled={!apiKeyInput.trim() || savingKey}>
                      {savingKey ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {t("admin.settings.saving")}</> : <><Check className="h-4 w-4 mr-2" /> Сохранить новый</>}
                    </Button>
                    <Button variant="outline" onClick={loadStatus}>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      {t("admin.gramads.recheck")}
                    </Button>
                    <Button variant="outline" onClick={clearApiKey} disabled={savingKey} className="text-red-500 dark:text-red-400 border-red-500/30 hover:bg-red-500/10">
                      <X className="h-4 w-4 mr-2" />
                      {t("admin.gramads.disconnect")}
                    </Button>
                  </div>

                  {keyMessage && (
                    <div className={`text-xs rounded-lg px-3 py-2 border ${
                      keyMessage.type === "ok"
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                        : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
                    }`}>
                      {keyMessage.text}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* Модалка создания */}
      {createOpen && (
        <CreateCampaignDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={() => { setCreateOpen(false); loadPosts(); }}
          token={token}
        />
      )}

      {/* Модалка деталей кампании */}
      {detailPost && (
        <CampaignDetailDialog
          post={detailPost}
          onClose={() => setDetailPost(null)}
          onAction={(a) => onPostAction(a, detailPost.id)}
          onRefresh={async () => {
            const u = await api.gramadsGetMyPost(token, detailPost.id);
            setDetailPost(u);
            loadPosts();
          }}
          token={token}
        />
      )}
    </div>
  );
}

// ────────── Карточка кампании ──────────
function CampaignCard({ post, onOpen, onAction }: {
  post: GramadsPostDto;
  onOpen: () => void;
  onAction: (a: "switchEnabled" | "switchFavourite" | "switchPremium" | "switchGroups" | "switchGAlity") => void;
}) {
  const { t } = useTranslation();
  const text = (post.text ?? "").trim();
  const preview = text.length > 180 ? text.slice(0, 180) + "…" : text || "(без текста)";

  return (
    <Card className="cursor-pointer hover:bg-muted/40 transition-colors">
      <CardContent className="p-4 space-y-3" onClick={onOpen}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-muted-foreground">#{post.id}</span>
              <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${MODERATION_COLOR[post.moderationStatus]}`}>
                {MODERATION_LABEL[post.moderationStatus]}
              </span>
              {post.enabled ? (
                <span className="px-2 py-0.5 rounded-md text-xs bg-green-500/10 text-green-400 font-semibold flex items-center gap-1"><Power className="h-3 w-3" /> {t("admin.gramads.active")}</span>
              ) : (
                <span className="px-2 py-0.5 rounded-md text-xs bg-muted text-muted-foreground font-semibold">{t("admin.gramads.paused")}</span>
              )}
              {post.isArchived && <span className="px-2 py-0.5 rounded-md text-xs bg-muted text-muted-foreground font-semibold flex items-center gap-1"><Archive className="h-3 w-3" /> {t("admin.gramads.archived")}</span>}
              {post.isFavourite && <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />}
            </div>
            <p className="mt-2 text-sm text-foreground/90 whitespace-pre-wrap break-words">{preview}</p>
          </div>
          <div className="text-right text-xs text-muted-foreground shrink-0 space-y-0.5">
            <div>{t("admin.gramads.shows")}: <span className="text-foreground font-semibold">{(post.totalShows ?? 0).toLocaleString()}</span></div>
            <div title={t("admin.gramads.paid_hint")}>{t("admin.gramads.paid_label")}: <span className="text-foreground font-semibold">{formatPaid(post.paid)}</span></div>
            <div>{t("admin.gramads.limit")}: <span className="text-foreground font-semibold">{formatLimit(post.limit, t("admin.gramads.unlimited"))}</span></div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAction("switchEnabled")}
            disabled={post.moderationStatus === 2}
            title={post.moderationStatus === 2 ? "Пост отклонён Gramads — запустить невозможно." : undefined}
          >
            <Power className="h-3 w-3 mr-1" /> {post.enabled ? t("admin.gramads.pause") : t("admin.gramads.resume")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => onAction("switchFavourite")}><Star className={`h-3 w-3 mr-1 ${post.isFavourite ? "fill-yellow-400 text-yellow-400" : ""}`} /> {post.isFavourite ? t("admin.gramads.unfav") : t("admin.gramads.fav")}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ────────── Диалог создания кампании ──────────
function CreateCampaignDialog({ open, onOpenChange, onCreated, token }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void; token: string }) {
  const { t } = useTranslation();
  const [text, setText] = useState("Привет! 🚀 Попробуй наш VPN — быстро, безопасно, без логов. Жми кнопку и получай скидку!");
  const [buttonText, setButtonText] = useState("🔒 Попробовать VPN");
  const [link, setLink] = useState("");
  const [limit, setLimit] = useState(1000);
  const [extraRate, setExtraRate] = useState(0);
  const [impressionPerHours, setImpressionPerHours] = useState(1);
  const [strategy, setStrategy] = useState("1");
  const [markup, setMarkup] = useState("0");
  const [premiumOnly, setPremiumOnly] = useState(false);
  const [groupsEnabled, setGroupsEnabled] = useState(true);
  const [gAlityEnabled, setGAlityEnabled] = useState(false);
  const [excludedCategories, setExcludedCategories] = useState<number[]>([15]);
  const [excludedLanguages, setExcludedLanguages] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const body: Partial<GramadsPostDto> = {
        text: text.trim(),
        buttonText: buttonText.trim(),
        link: link.trim(),
        limit,
        extraRate,
        impressionPerHours,
        strategy: parseInt(strategy, 10),
        markup: parseInt(markup, 10),
        premiumOnlyEnabled: premiumOnly,
        groupChatsEnabled: groupsEnabled,
        gAlityEnabled,
        excludedCategories,
        excludedLanguages: excludedLanguages.split(",").map((s) => s.trim()).filter(Boolean),
        enabled: false, // создаётся выключенной — включает админ после модерации
      };
      await api.gramadsAddPost(token, body);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t("admin.gramads.new_campaign")}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("admin.gramads.field_text")}</Label>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} />
            <p className="text-xs text-muted-foreground">{t("admin.gramads.field_text_hint")}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("admin.gramads.field_button_text")}</Label>
              <Input value={buttonText} onChange={(e) => setButtonText(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("admin.gramads.field_link")}</Label>
              <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://t.me/YourBot?start=gramads" />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label>{t("admin.gramads.field_limit")}</Label>
              <Input type="number" min={0} value={limit} onChange={(e) => setLimit(parseInt(e.target.value) || 0)} />
              <p className="text-xs text-muted-foreground">{t("admin.gramads.field_limit_hint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("admin.gramads.field_strategy")}</Label>
              <GlassSelect value={strategy} onChange={setStrategy} options={STRATEGY_OPTIONS} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("admin.gramads.field_markup")}</Label>
              <GlassSelect value={markup} onChange={setMarkup} options={MARKUP_OPTIONS} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("admin.gramads.field_impression_per_hours")}</Label>
              <Input type="number" min={1} value={impressionPerHours} onChange={(e) => setImpressionPerHours(parseInt(e.target.value) || 1)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("admin.gramads.field_excluded_categories")}</Label>
            <div className="flex flex-wrap gap-2 p-2 rounded-lg border bg-card/30">
              {Object.entries(CATEGORY_NAMES).map(([id, name]) => {
                const n = parseInt(id, 10);
                const active = excludedCategories.includes(n);
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setExcludedCategories((cats) => active ? cats.filter((x) => x !== n) : [...cats, n])}
                    className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${active ? "bg-red-500/20 text-red-300 line-through" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{t("admin.gramads.field_excluded_categories_hint")}</p>
          </div>

          <div className="space-y-1.5">
            <Label>{t("admin.gramads.field_excluded_languages")}</Label>
            <Input value={excludedLanguages} onChange={(e) => setExcludedLanguages(e.target.value)} placeholder="en, ar, es" />
            <p className="text-xs text-muted-foreground">{t("admin.gramads.field_excluded_languages_hint")}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="flex items-center justify-between p-3 rounded-lg border cursor-pointer">
              <span className="text-sm">{t("admin.gramads.field_premium_only")}</span>
              <Switch checked={premiumOnly} onCheckedChange={setPremiumOnly} />
            </label>
            <label className="flex items-center justify-between p-3 rounded-lg border cursor-pointer">
              <span className="text-sm">{t("admin.gramads.field_groups_enabled")}</span>
              <Switch checked={groupsEnabled} onCheckedChange={setGroupsEnabled} />
            </label>
            <label className="flex items-center justify-between p-3 rounded-lg border cursor-pointer">
              <span className="text-sm">{t("admin.gramads.field_gality_enabled")}</span>
              <Switch checked={gAlityEnabled} onCheckedChange={setGAlityEnabled} />
            </label>
          </div>

          <div className="space-y-1.5">
            <Label>{t("admin.gramads.field_extra_rate")}</Label>
            <Input type="number" min={0} value={extraRate} onChange={(e) => setExtraRate(parseInt(e.target.value) || 0)} />
            <p className="text-xs text-muted-foreground">{t("admin.gramads.field_extra_rate_hint")}</p>
          </div>

          {error && <div className="p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-sm text-red-300">{error}</div>}

          <div className="flex gap-2 justify-end pt-2 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t("admin.common.cancel")}</Button>
            <Button onClick={submit} disabled={saving || !text.trim() || !buttonText.trim() || !link.trim()}>
              {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {t("admin.gramads.creating")}</> : <><Plus className="h-4 w-4 mr-2" /> {t("admin.gramads.create")}</>}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ────────── Диалог деталей кампании ──────────
function CampaignDetailDialog({ post, onClose, onAction, onRefresh, token }: {
  post: GramadsPostDto;
  onClose: () => void;
  onAction: (a: "switchEnabled" | "switchFavourite" | "switchPremium" | "switchGroups" | "switchGAlity") => void;
  onRefresh: () => void;
  token: string;
}) {
  const { t } = useTranslation();
  const [limit, setLimit] = useState(post.limit);
  const [extraRate, setExtraRate] = useState(post.extraRate);
  const [impressionPerHours, setImpressionPerHours] = useState(post.impressionPerHours);
  const [strategy, setStrategy] = useState(String(post.strategy));
  const [testing, setTesting] = useState(false);
  const [savingLimit, setSavingLimit] = useState(false);
  const [savingExtra, setSavingExtra] = useState(false);
  const [savingFreq, setSavingFreq] = useState(false);
  const [savingStrategy, setSavingStrategy] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  useEffect(() => {
    setLimit(post.limit);
    setExtraRate(post.extraRate);
    setImpressionPerHours(post.impressionPerHours);
    setStrategy(String(post.strategy));
  }, [post]);

  // Set*/Change* эндпоинты Gramads, как и Switch*, требуют в теле полный PostDto.
  const saveLimit = async () => { setSavingLimit(true); try { await api.gramadsSetLimit(token, { ...post, limit }); onRefresh(); } finally { setSavingLimit(false); } };
  const saveExtra = async () => { setSavingExtra(true); try { await api.gramadsSetExtraRate(token, { ...post, extraRate }); onRefresh(); } finally { setSavingExtra(false); } };
  const saveFreq = async () => { setSavingFreq(true); try { await api.gramadsSetIpressionPerHours(token, { ...post, impressionPerHours }); onRefresh(); } finally { setSavingFreq(false); } };
  const saveStrategy = async () => { setSavingStrategy(true); try { await api.gramadsChangeStrategy(token, { ...post, strategy: parseInt(strategy, 10) }); onRefresh(); } finally { setSavingStrategy(false); } };
  const testPost = async () => {
    setTesting(true); setTestMsg(null);
    try {
      // TestPost требует в теле хотя бы text/buttonText/link (см. Swagger).
      // Передаём полные данные кампании, чтобы Gramads отправил именно её в @GramAdsRobot.
      const result = await api.gramadsTestPost(token, {
        id: post.id,
        text: post.text ?? "",
        buttonText: post.buttonText ?? "",
        link: post.link ?? "",
        markup: post.markup ?? 0,
      });
      const code = typeof result === "number" ? result : 0;
      if (code === 0) {
        setTestMsg(t("admin.gramads.test_sent"));
      } else {
        // Любой ненулевой код — отправка не удалась.
        // Самая частая причина: пользователь, которому принадлежит API-ключ,
        // ещё не запускал @GramAdsRobot у себя в Telegram.
        setTestMsg(`${t("admin.gramads.test_failed")} (code ${code})`);
      }
    } catch (e) {
      setTestMsg(e instanceof Error ? e.message : "error");
    } finally { setTesting(false); }
  };

  return (
    <Dialog open={true} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">#{post.id}</span>
            <span>{t("admin.gramads.campaign_detail")}</span>
            <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${MODERATION_COLOR[post.moderationStatus]}`}>
              {MODERATION_LABEL[post.moderationStatus]}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Предупреждение о модерации */}
          {post.moderationStatus === 0 && (
            <div className="p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-sm flex gap-2 items-start">
              <Clock className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
              <div>
                <p className="font-semibold text-foreground">Кампания на модерации Gramads</p>
                <p className="text-foreground/80">Показы начнутся только после одобрения (обычно до 24 ч). Управлять можно уже сейчас.</p>
              </div>
            </div>
          )}
          {post.moderationStatus === 2 && (
            <div className="p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-sm flex gap-2 items-start">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-500" />
              <div>
                <p className="font-semibold text-foreground">Кампания отклонена Gramads</p>
                <p className="text-foreground/80">Запуск невозможен. Создайте новую кампанию, изменив текст/ссылку, чтобы пройти модерацию.</p>
              </div>
            </div>
          )}

          {/* Текст */}
          <div className="p-3 rounded-lg bg-muted/40 border">
            <p className="text-sm whitespace-pre-wrap break-words">{post.text}</p>
            {post.link && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{t("admin.gramads.button")}:</span>
                <a href={post.link} target="_blank" rel="noopener noreferrer" className="text-xs px-2 py-1 rounded-md bg-primary/10 text-primary hover:underline inline-flex items-center gap-1">
                  {post.buttonText || "→"} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>

          {/* Состояние */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="p-3 rounded-lg border">
              <p className="text-xs text-muted-foreground">{t("admin.gramads.shows")}</p>
              <p className="text-xl font-bold">{(post.totalShows ?? 0).toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">{t("admin.gramads.impressions_unit")}</p>
            </div>
            <div className="p-3 rounded-lg border" title={t("admin.gramads.paid_hint")}>
              <p className="text-xs text-muted-foreground">{t("admin.gramads.paid_label")}</p>
              <p className={`text-xl font-bold ${typeof post.paid === "number" && post.paid > 0 ? "text-orange-400" : ""}`}>{formatPaid(post.paid)}</p>
              <p className="text-[10px] text-muted-foreground">{t("admin.gramads.impressions_unit")}</p>
            </div>
            <div className="p-3 rounded-lg border">
              <p className="text-xs text-muted-foreground">{t("admin.gramads.limit")}</p>
              <p className="text-xl font-bold">{formatLimit(post.limit, t("admin.gramads.unlimited"))}</p>
              <p className="text-[10px] text-muted-foreground">{t("admin.gramads.impressions_unit")}</p>
            </div>
            <div className="p-3 rounded-lg border">
              <p className="text-xs text-muted-foreground">{t("admin.gramads.created")}</p>
              <p className="text-sm">{new Date(post.dateCreated).toLocaleDateString()}</p>
            </div>
          </div>

          {/* Действия */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => onAction("switchEnabled")}
              disabled={post.moderationStatus === 2}
              title={post.moderationStatus === 2 ? "Пост отклонён Gramads — запустить невозможно." : undefined}
            >
              <Power className="h-4 w-4 mr-2" />
              {post.enabled ? t("admin.gramads.pause") : t("admin.gramads.resume")}
            </Button>
            <Button variant="outline" onClick={() => onAction("switchFavourite")}>
              <Star className={`h-4 w-4 mr-2 ${post.isFavourite ? "fill-yellow-400 text-yellow-400" : ""}`} />
              {post.isFavourite ? t("admin.gramads.unfav") : t("admin.gramads.fav")}
            </Button>
            <Button variant="outline" onClick={testPost} disabled={testing}>
              {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              {t("admin.gramads.test_post")}
            </Button>
          </div>
          {testMsg && <p className="text-sm text-muted-foreground">{testMsg}</p>}
          <p className="text-xs text-muted-foreground">{t("admin.gramads.test_hint")}</p>

          {/* Переключатели */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="flex items-center justify-between p-3 rounded-lg border cursor-pointer" onClick={(e) => { e.preventDefault(); onAction("switchPremium"); }}>
              <span className="text-sm">{t("admin.gramads.field_premium_only")}</span>
              <Switch checked={post.premiumOnlyEnabled} onCheckedChange={() => onAction("switchPremium")} />
            </label>
            <label className="flex items-center justify-between p-3 rounded-lg border cursor-pointer" onClick={(e) => { e.preventDefault(); onAction("switchGroups"); }}>
              <span className="text-sm">{t("admin.gramads.field_groups_enabled")}</span>
              <Switch checked={post.groupChatsEnabled} onCheckedChange={() => onAction("switchGroups")} />
            </label>
            <label className="flex items-center justify-between p-3 rounded-lg border cursor-pointer" onClick={(e) => { e.preventDefault(); onAction("switchGAlity"); }}>
              <span className="text-sm">{t("admin.gramads.field_gality_enabled")}</span>
              <Switch checked={post.gAlityEnabled} onCheckedChange={() => onAction("switchGAlity")} />
            </label>
          </div>

          {/* Редактирование параметров */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded-lg border space-y-2">
              <Label>{t("admin.gramads.field_limit")}</Label>
              <div className="flex gap-2">
                <Input type="number" value={limit} onChange={(e) => setLimit(parseInt(e.target.value) || 0)} />
                <Button variant="outline" onClick={saveLimit} disabled={savingLimit || limit === post.limit}>{savingLimit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}</Button>
              </div>
            </div>
            <div className="p-3 rounded-lg border space-y-2">
              <Label>{t("admin.gramads.field_strategy")}</Label>
              <div className="flex gap-2">
                <GlassSelect value={strategy} onChange={setStrategy} options={STRATEGY_OPTIONS} />
                <Button variant="outline" onClick={saveStrategy} disabled={savingStrategy || parseInt(strategy, 10) === post.strategy}>{savingStrategy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}</Button>
              </div>
            </div>
            <div className="p-3 rounded-lg border space-y-2">
              <Label>{t("admin.gramads.field_extra_rate")}</Label>
              <div className="flex gap-2">
                <Input type="number" value={extraRate} onChange={(e) => setExtraRate(parseInt(e.target.value) || 0)} />
                <Button variant="outline" onClick={saveExtra} disabled={savingExtra || extraRate === post.extraRate}>{savingExtra ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}</Button>
              </div>
            </div>
            <div className="p-3 rounded-lg border space-y-2">
              <Label>{t("admin.gramads.field_impression_per_hours")}</Label>
              <div className="flex gap-2">
                <Input type="number" min={1} value={impressionPerHours} onChange={(e) => setImpressionPerHours(parseInt(e.target.value) || 1)} />
                <Button variant="outline" onClick={saveFreq} disabled={savingFreq || impressionPerHours === post.impressionPerHours}>{savingFreq ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}</Button>
              </div>
            </div>
          </div>

          {/* Статистика */}
          <PostStats token={token} postId={post.id} createdAt={post.dateCreated} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ────────── Статистика по кампании ──────────
function PostStats({ token, postId, createdAt }: { token: string; postId: number; createdAt?: string }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [raw, setRaw] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api.gramadsGetStatistics(token, postId, 30);
      setRaw(s);
    } catch {
      setRaw(null);
    } finally { setLoading(false); }
  }, [token, postId]);

  useEffect(() => { load(); }, [load]);

  const series = useMemo(() => {
    if (!raw || !Array.isArray(raw)) return [];
    // Отсечка: показываем только дни ≥ дня создания кампании
    const createdTs = createdAt ? (() => {
      const d = new Date(createdAt);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })() : 0;
    return (raw as { year?: number; month?: number; day?: number; count?: number; paidReward?: number }[])
      .map((x) => {
        const y = x.year ?? 0, m = x.month ?? 0, d = x.day ?? 0;
        const ts = new Date(y, (m || 1) - 1, d || 1).getTime();
        return {
          ts,
          date: `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
          count: x.count ?? 0,
          // paidReward в Gramads хранится в "сотых показа" — делим, чтобы получить реальное число.
          paid: scalePaidReward(x.paidReward ?? 0),
        };
      })
      .filter((r) => r.ts >= createdTs && (r.count > 0 || r.paid > 0))
      .sort((a, b) => b.ts - a.ts);
  }, [raw, createdAt]);

  const totals = useMemo(() => series.reduce(
    (acc, s) => ({ count: acc.count + s.count, paid: acc.paid + s.paid }),
    { count: 0, paid: 0 },
  ), [series]);

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4" /> {t("admin.gramads.stats_30d")}</CardTitle></CardHeader>
      <CardContent>
        {loading ? <div className="text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" /> {t("admin.common.loading")}</div>
        : !series.length ? <p className="text-sm text-muted-foreground">{t("admin.gramads.no_stats")}</p>
        : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-2 rounded-lg border bg-muted/20">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("admin.gramads.shows")}</p>
                <p className="text-lg font-bold">{totals.count.toLocaleString()}</p>
              </div>
              <div className="p-2 rounded-lg border bg-muted/20">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("admin.gramads.paid_label")}</p>
                <p className="text-lg font-bold text-orange-400">{totals.paid.toLocaleString()}</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-muted-foreground border-b"><th className="text-left py-1 px-2"><Clock className="h-3 w-3 inline" /> {t("admin.gramads.date")}</th><th className="text-right py-1 px-2">{t("admin.gramads.shows")}</th><th className="text-right py-1 px-2">{t("admin.gramads.paid_label")}</th></tr></thead>
                <tbody>
                  {series.map((s, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-1 px-2">{s.date}</td>
                      <td className="py-1 px-2 text-right">{s.count.toLocaleString()}</td>
                      <td className="py-1 px-2 text-right">{s.paid.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
