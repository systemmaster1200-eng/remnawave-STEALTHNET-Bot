import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { api, type ContestListItem, type ContestDetail, type ContestFormPayload, type ContestPrizeType, type ContestDrawType } from "@/lib/api";
import { contestExtrasApi } from "@/lib/contest-extras-api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Trophy, Plus, Pencil, Trash2, Loader2, Users, Shuffle, Send, Clock, X, MousePointerClick, Sparkles, Award } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const PRIZE_TYPES: { value: ContestPrizeType; label: string }[] = [
  { value: "custom", label: "Свой текст" },
  { value: "balance", label: "Деньги на баланс" },
  { value: "vpn_days", label: "Дни VPN в подарок" },
];

const DRAW_TYPES: { value: ContestDrawType; label: string }[] = [
  { value: "random", label: "Случайный выбор" },
  { value: "by_days_bought", label: "Кто больше купил дней" },
  { value: "by_payments_count", label: "По количеству оплат" },
  { value: "by_referrals_count", label: "Кто больше привёл рефералов" },
];

const STATUS_LABELS: Record<string, string> = {
  draft: "Черновик",
  active: "Активен",
  ended: "Завершён",
  drawn: "Розыгрыш проведён",
};

function statusBadge(status: string) {
  const map: Record<string, { cls: string; dot: string }> = {
    draft: { cls: "bg-foreground/[0.05] dark:bg-white/[0.05] text-muted-foreground border-white/10", dot: "bg-muted-foreground/40" },
    active: { cls: "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20", dot: "bg-emerald-400 shadow-[0_0_4px_#10b981]" },
    ended: { cls: "bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/20", dot: "bg-amber-400 shadow-[0_0_4px_#fbbf24]" },
    drawn: { cls: "bg-violet-500/10 text-violet-500 dark:text-violet-400 border-violet-500/20", dot: "bg-violet-400 shadow-[0_0_4px_#a78bfa]" },
  };
  const cfg = map[status] ?? map.draft;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-md", cfg.cls)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function toLocalDatetime(d: string): string {
  if (!d) return "";
  const date = new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

function fromFormDatetime(s: string): string {
  if (!s) return new Date().toISOString();
  return new Date(s).toISOString();
}

function parseConditions(json: string | null): { minTariffDays?: number; minPaymentsCount?: number; minReferrals?: number } {
  if (!json?.trim()) return {};
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    return {
      minTariffDays: typeof o.minTariffDays === "number" ? o.minTariffDays : undefined,
      minPaymentsCount: typeof o.minPaymentsCount === "number" ? o.minPaymentsCount : undefined,
      minReferrals: typeof o.minReferrals === "number" ? o.minReferrals : undefined,
    };
  } catch {
    return {};
  }
}

function stringifyConditions(c: { minTariffDays?: number; minPaymentsCount?: number; minReferrals?: number }): string | null {
  if (!c.minTariffDays && !c.minPaymentsCount && !c.minReferrals) return null;
  return JSON.stringify({
    ...(c.minTariffDays != null && c.minTariffDays > 0 ? { minTariffDays: c.minTariffDays } : {}),
    ...(c.minPaymentsCount != null && c.minPaymentsCount > 0 ? { minPaymentsCount: c.minPaymentsCount } : {}),
    ...(c.minReferrals != null && c.minReferrals > 0 ? { minReferrals: c.minReferrals } : {}),
  });
}

const BUTTON_ACTIONS = [
  { value: "", label: "Без кнопки" },
  { value: "cabinet", label: "Личный кабинет" },
  { value: "referral", label: "Реферальная ссылка" },
  { value: "custom", label: "Своя ссылка" },
] as const;

function resolveActionFromUrl(url?: string | null): string {
  if (!url) return "";
  if (url.includes("/cabinet")) return "cabinet";
  if (url.includes("/referral")) return "referral";
  return "custom";
}

const emptyForm: ContestFormPayload = {
  name: "",
  startAt: new Date().toISOString(),
  endAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  prize1Type: "custom",
  prize1Value: "",
  prize2Type: "custom",
  prize2Value: "",
  prize3Type: "custom",
  prize3Value: "",
  conditionsJson: null,
  drawType: "random",
  dailyMessage: null,
  buttonText: null,
  buttonUrl: null,
  reminderEnabled: true,
  reminderIntervalHours: 24,
  reminderDeadlineHoursBefore: "",
};

const inputCls = "rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50";
const selectCls = "flex h-10 w-full rounded-xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50";

export function ContestsPage() {
  const { state } = useAuth();
  const token = state.accessToken!;

  const [list, setList] = useState<ContestListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ContestFormPayload>(emptyForm);
  const [minTariffDays, setMinTariffDays] = useState<string>("");
  const [minPaymentsCount, setMinPaymentsCount] = useState<string>("");
  const [minReferrals, setMinReferrals] = useState<string>("");
  const [buttonAction, setButtonAction] = useState<string>("");
  const [buttonCustomUrl, setButtonCustomUrl] = useState<string>("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContestDetail | null>(null);
  const [participantsPreview, setParticipantsPreview] = useState<{ total: number; participants: { clientId: string; totalDaysBought: number; paymentsCount: number; referralsCount?: number }[] } | null>(null);
  const [drawingId, setDrawingId] = useState<string | null>(null);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getContests(token);
      setList(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [token]);

  useEffect(() => {
    if (!detailId || !token) return;
    api.getContest(token, detailId).then(setDetail).catch(() => setDetail(null));
  }, [detailId, token]);

  const openCreate = () => {
    setEditingId(null);
    setForm({
      ...emptyForm,
      startAt: new Date().toISOString(),
      endAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    setMinTariffDays("");
    setMinPaymentsCount("");
    setMinReferrals("");
    setButtonAction("");
    setButtonCustomUrl("");
    setShowForm(true);
  };

  const openEdit = (c: ContestListItem) => {
    setEditingId(c.id);
    setForm({
      name: c.name,
      startAt: c.startAt,
      endAt: c.endAt,
      prize1Type: c.prize1Type as ContestPrizeType,
      prize1Value: c.prize1Value,
      prize2Type: c.prize2Type as ContestPrizeType,
      prize2Value: c.prize2Value,
      prize3Type: c.prize3Type as ContestPrizeType,
      prize3Value: c.prize3Value,
      conditionsJson: c.conditionsJson,
      drawType: c.drawType as ContestDrawType,
      dailyMessage: c.dailyMessage,
      buttonText: c.buttonText ?? null,
      buttonUrl: c.buttonUrl ?? null,
      reminderEnabled: c.reminderEnabled ?? true,
      reminderIntervalHours: c.reminderIntervalHours ?? 24,
      reminderDeadlineHoursBefore: c.reminderDeadlineHoursBefore ?? "",
    });
    const cond = parseConditions(c.conditionsJson);
    setMinTariffDays(cond.minTariffDays != null ? String(cond.minTariffDays) : "");
    setMinPaymentsCount(cond.minPaymentsCount != null ? String(cond.minPaymentsCount) : "");
    setMinReferrals(cond.minReferrals != null ? String(cond.minReferrals) : "");
    const action = resolveActionFromUrl(c.buttonUrl);
    setButtonAction(action);
    setButtonCustomUrl(action === "custom" ? (c.buttonUrl ?? "") : "");
    setShowForm(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const conditionsJson = stringifyConditions({
        minTariffDays: minTariffDays ? parseInt(minTariffDays, 10) : undefined,
        minPaymentsCount: minPaymentsCount ? parseInt(minPaymentsCount, 10) : undefined,
        minReferrals: minReferrals ? parseInt(minReferrals, 10) : undefined,
      });
      let resolvedButtonUrl: string | null = null;
      if (buttonAction === "cabinet") resolvedButtonUrl = "/cabinet";
      else if (buttonAction === "referral") resolvedButtonUrl = "/cabinet/referral";
      else if (buttonAction === "custom" && buttonCustomUrl.trim()) resolvedButtonUrl = buttonCustomUrl.trim();

      const payload: ContestFormPayload = {
        ...form,
        startAt: fromFormDatetime(form.startAt),
        endAt: fromFormDatetime(form.endAt),
        conditionsJson,
        buttonText: buttonAction ? (form.buttonText || null) : null,
        buttonUrl: resolvedButtonUrl,
      };
      if (editingId) {
        await api.updateContest(token, editingId, payload);
      } else {
        await api.createContest(token, payload);
      }
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const loadParticipantsPreview = async (id: string) => {
    try {
      const data = await api.getContestParticipantsPreview(token, id);
      setParticipantsPreview(data);
      setDetailId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки участников");
    }
  };

  const runDraw = async (id: string) => {
    setDrawingId(id);
    try {
      await api.runContestDraw(token, id);
      await load();
      setDetailId(id);
      const d = await api.getContest(token, id);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка розыгрыша");
    } finally {
      setDrawingId(null);
    }
  };

  const undoDraw = async (id: string) => {
    if (!confirm("Отменить розыгрыш? Balance-призы будут возвращены клиентам, vpn_days и custom призы остаются — отзывайте вручную.")) return;
    setDrawingId(id);
    try {
      const r = await contestExtrasApi.undoDraw(token, id);
      await load();
      const d = await api.getContest(token, id);
      setDetail(d);
      alert(r.message + (r.refunded > 0 ? ` (возвращено ${r.refunded})` : ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка отмены розыгрыша");
    } finally {
      setDrawingId(null);
    }
  };

  const applyPrize = async (contestId: string, winnerId: string) => {
    try {
      const r = await contestExtrasApi.applyPrize(token, contestId, winnerId);
      const d = await api.getContest(token, contestId);
      setDetail(d);
      alert(r.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка применения приза");
    }
  };

  const removeWinner = async (contestId: string, winnerId: string) => {
    if (!confirm("Удалить победителя? Balance-приз (если был применён) будет возвращён.")) return;
    try {
      await contestExtrasApi.removeWinner(token, contestId, winnerId);
      const d = await api.getContest(token, contestId);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления победителя");
    }
  };

  const handleLaunch = async (id: string) => {
    setLaunchingId(id);
    setError(null);
    try {
      await api.launchContest(token, id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка запуска");
    } finally {
      setLaunchingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setSaving(true);
    try {
      await api.deleteContest(token, id);
      setDeleteConfirmId(null);
      setDetailId(null);
      setDetail(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления");
    } finally {
      setSaving(false);
    }
  };

  const now = new Date();
  const canDraw = (c: ContestListItem) =>
    c.status !== "drawn" && new Date(c.endAt) <= now && c.winners.length === 0;

  function formatTimeLeft(endAt: string): string {
    const end = new Date(endAt).getTime();
    const diff = end - Date.now();
    if (diff <= 0) return "Завершён";
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    if (days > 0) return `До конца: ${days} дн. ${hours} ч.`;
    if (hours > 0) return `До конца: ${hours} ч.`;
    const min = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
    return `До конца: ${min} мин.`;
  }
  function isContestActive(c: ContestListItem): boolean {
    const start = new Date(c.startAt).getTime();
    const end = new Date(c.endAt).getTime();
    return start <= Date.now() && end >= Date.now();
  }

  return (
    <div className="space-y-5 px-4 sm:px-6 md:px-8 pt-6 pb-10 relative">
      <div className="fixed -z-10 bg-primary/15 blur-[120px] top-[-50px] left-[-50px] w-[300px] h-[300px] rounded-full pointer-events-none" />
      <div className="fixed -z-10 bg-purple-500/10 blur-[100px] top-[20%] right-[-50px] w-[250px] h-[250px] rounded-full pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between bg-background/40 backdrop-blur-3xl border border-white/10 p-6 rounded-[2rem] shadow-2xl"
      >
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center shadow-inner border border-white/10">
            <Trophy className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">
              Конкурсы
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Создавайте розыгрыши и поощряйте активных пользователей</p>
          </div>
        </div>
        <Button onClick={openCreate} className="gap-1.5 rounded-xl">
          <Plus className="h-4 w-4" />
          Создать конкурс
        </Button>
      </motion.div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-red-500/30 bg-red-500/10 backdrop-blur-md px-4 py-3 text-sm text-red-500 dark:text-red-400"
        >
          {error}
        </motion.div>
      )}

      <Dialog open={showForm} onOpenChange={(open) => !open && setShowForm(false)}>
        <DialogContent className="bg-background/80 backdrop-blur-3xl border-white/10 rounded-[2rem] max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20 border border-white/10 flex items-center justify-center shadow-inner">
                {editingId ? <Pencil className="h-4 w-4 text-primary" /> : <Sparkles className="h-4 w-4 text-primary" />}
              </div>
              {editingId ? "Редактировать конкурс" : "Новый конкурс"}
            </DialogTitle>
            <DialogDescription className="sr-only">Форма создания и редактирования конкурса</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Название</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Название конкурса"
                className={inputCls}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Начало</Label>
                <Input
                  type="datetime-local"
                  value={toLocalDatetime(form.startAt)}
                  onChange={(e) => setForm((f) => ({ ...f, startAt: e.target.value ? new Date(e.target.value).toISOString() : f.startAt }))}
                  className={inputCls}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Окончание</Label>
                <Input
                  type="datetime-local"
                  value={toLocalDatetime(form.endAt)}
                  onChange={(e) => setForm((f) => ({ ...f, endAt: e.target.value ? new Date(e.target.value).toISOString() : f.endAt }))}
                  className={inputCls}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Тип розыгрыша</Label>
              <select
                className={selectCls}
                value={form.drawType}
                onChange={(e) => setForm((f) => ({ ...f, drawType: e.target.value as ContestDrawType }))}
              >
                {DRAW_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label className="text-xs text-muted-foreground">Условия участия (опционально)</Label>
              <div className="rounded-2xl border border-white/5 bg-foreground/[0.03] dark:bg-white/[0.02] p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="grid gap-1">
                  <Label className="text-[11px] text-muted-foreground">Мин. дней тарифа</Label>
                  <Input
                    type="number"
                    min={0}
                    placeholder="30"
                    value={minTariffDays}
                    onChange={(e) => setMinTariffDays(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[11px] text-muted-foreground">Мин. оплат</Label>
                  <Input
                    type="number"
                    min={0}
                    placeholder="1"
                    value={minPaymentsCount}
                    onChange={(e) => setMinPaymentsCount(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[11px] text-muted-foreground">Мин. рефералов</Label>
                  <Input
                    type="number"
                    min={0}
                    placeholder="0"
                    value={minReferrals}
                    onChange={(e) => setMinReferrals(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
            </div>
            {([1, 2, 3] as const).map((place) => {
              const colors = {
                1: { grad: "from-amber-500/20 to-amber-500/5", text: "text-amber-500 dark:text-amber-400", label: "1 место" },
                2: { grad: "from-slate-400/20 to-slate-400/5", text: "text-slate-400 dark:text-slate-300", label: "2 место" },
                3: { grad: "from-orange-500/20 to-orange-500/5", text: "text-orange-500 dark:text-orange-400", label: "3 место" },
              }[place];
              return (
                <div key={place} className="rounded-2xl border border-white/5 bg-foreground/[0.03] dark:bg-white/[0.02] p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className={cn("h-7 w-7 rounded-xl bg-gradient-to-br border border-white/10 flex items-center justify-center", colors.grad)}>
                      <Award className={cn("h-4 w-4", colors.text)} />
                    </div>
                    <span className="text-sm font-semibold">Приз — {colors.label}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 items-end">
                    <div className="grid gap-1.5">
                      <Label className="text-[11px] text-muted-foreground">Тип</Label>
                      <select
                        className={selectCls}
                        value={form[`prize${place}Type` as keyof ContestFormPayload] as string}
                        onChange={(e) => setForm((f) => ({ ...f, [`prize${place}Type`]: e.target.value as ContestPrizeType }))}
                      >
                        {PRIZE_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-[11px] text-muted-foreground">Значение (текст / сумма / дни)</Label>
                      <Input
                        value={form[`prize${place}Value` as keyof ContestFormPayload] as string}
                        onChange={(e) => setForm((f) => ({ ...f, [`prize${place}Value`]: e.target.value }))}
                        placeholder={form[`prize${place}Type` as keyof ContestFormPayload] === "balance" ? "500" : form[`prize${place}Type` as keyof ContestFormPayload] === "vpn_days" ? "30" : "Описание приза"}
                        className={inputCls}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Текст ежедневной рассылки в боте (опционально)</Label>
              <Textarea
                rows={3}
                value={form.dailyMessage ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, dailyMessage: e.target.value || null }))}
                placeholder="Сообщение, которое бот будет отправлять каждый день во время конкурса"
                className={inputCls}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <MousePointerClick className="h-3.5 w-3.5" /> Кнопка в сообщении (опционально)
              </Label>
              <div className="grid grid-cols-2 gap-4">
                <select
                  className={selectCls}
                  value={buttonAction}
                  onChange={(e) => setButtonAction(e.target.value)}
                >
                  {BUTTON_ACTIONS.map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
                <Input
                  value={form.buttonText ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, buttonText: e.target.value || null }))}
                  placeholder="Текст кнопки"
                  disabled={!buttonAction}
                  className={inputCls}
                />
              </div>
              {buttonAction === "custom" && (
                <Input
                  value={buttonCustomUrl}
                  onChange={(e) => setButtonCustomUrl(e.target.value)}
                  placeholder="https://..."
                  className={inputCls}
                />
              )}
            </div>

            {/* Расписание напоминаний (issue #35) */}
            <div className="grid gap-3 rounded-xl border border-white/10 bg-foreground/[0.02] p-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Напоминания об активном конкурсе</Label>
                <label className="inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.reminderEnabled !== false}
                    onChange={(e) => setForm((f) => ({ ...f, reminderEnabled: e.target.checked }))}
                  />
                  Включены
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">Интервал (часы) — 0 чтобы выключить периодические</Label>
                  <Input
                    type="number"
                    min={0}
                    max={720}
                    step={1}
                    value={form.reminderIntervalHours ?? 24}
                    onChange={(e) => setForm((f) => ({ ...f, reminderIntervalHours: Math.max(0, parseInt(e.target.value || "0", 10) || 0) }))}
                    placeholder="24"
                    disabled={form.reminderEnabled === false}
                    className={inputCls}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">За сколько часов до конца (CSV)</Label>
                  <Input
                    value={form.reminderDeadlineHoursBefore ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, reminderDeadlineHoursBefore: e.target.value }))}
                    placeholder="24,1"
                    disabled={form.reminderEnabled === false}
                    className={inputCls}
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Пример: интервал <code className="font-mono">24</code> + deadline <code className="font-mono">24,1</code> →
                раз в сутки + дополнительные напоминания за 24ч и 1ч до окончания. Поставьте интервал <code className="font-mono">0</code>,
                если хотите только deadline-напоминания (или анонс при старте).
              </p>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)} className="rounded-xl">
                Отмена
              </Button>
              <Button onClick={handleSave} disabled={saving} className="gap-2 rounded-xl">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {editingId ? "Сохранить" : "Создать"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {loading ? (
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] py-16 shadow-xl flex flex-col items-center justify-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Загружаем конкурсы…</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {list.length === 0 ? (
            <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] py-12 shadow-xl flex flex-col items-center text-center">
              <div className="h-16 w-16 rounded-full bg-white/5 flex items-center justify-center mb-3 border border-white/10">
                <Trophy className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground mb-4">Нет конкурсов. Создайте первый.</p>
              <Button onClick={openCreate} className="gap-1.5 rounded-xl">
                <Plus className="h-4 w-4" /> Создать конкурс
              </Button>
            </Card>
          ) : (
            list.map((c, idx) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04 }}
                whileHover={{ y: -2 }}
              >
                <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl">
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
                        <Trophy className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-base font-bold tracking-tight truncate">{c.name}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(c.startAt).toLocaleString("ru")} — {new Date(c.endAt).toLocaleString("ru")}
                        </p>
                      </div>
                    </div>
                    {statusBadge(c.status)}
                  </div>

                  {isContestActive(c) && (
                    <div className="rounded-xl border border-primary/20 bg-primary/5 backdrop-blur-md px-3 py-2 mb-3 flex items-center gap-1.5 text-sm font-medium text-primary">
                      <Clock className="h-4 w-4" />
                      {formatTimeLeft(c.endAt)}
                    </div>
                  )}

                  <div className="rounded-2xl border border-white/5 bg-foreground/[0.03] dark:bg-white/[0.02] p-4 space-y-2 mb-3">
                    <p className="text-xs text-muted-foreground">
                      Розыгрыш: <span className="text-foreground font-medium">{DRAW_TYPES.find((t) => t.value === c.drawType)?.label ?? c.drawType}</span>
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {([1, 2, 3] as const).map((place) => {
                        const colors = {
                          1: { text: "text-amber-500 dark:text-amber-400", grad: "from-amber-500/15 to-amber-500/5" },
                          2: { text: "text-slate-400 dark:text-slate-300", grad: "from-slate-400/15 to-slate-400/5" },
                          3: { text: "text-orange-500 dark:text-orange-400", grad: "from-orange-500/15 to-orange-500/5" },
                        }[place];
                        const value = c[`prize${place}Value` as "prize1Value" | "prize2Value" | "prize3Value"];
                        return (
                          <div key={place} className={cn("rounded-xl bg-gradient-to-br border border-white/10 p-2.5 flex items-center gap-2", colors.grad)}>
                            <Award className={cn("h-4 w-4 shrink-0", colors.text)} />
                            <div className="min-w-0">
                              <p className="text-[10px] text-muted-foreground">{place} место</p>
                              <p className="text-xs font-semibold truncate">{value || "—"}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {c.winners.length > 0 && (
                    <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 backdrop-blur-md p-3 mb-3">
                      <p className="text-xs font-medium text-violet-500 dark:text-violet-400 mb-1.5">Победители</p>
                      <p className="text-xs text-muted-foreground break-words">
                        {c.winners.map((w) => `#${w.place} ${w.client?.telegramUsername ?? w.client?.email ?? w.client?.id ?? "—"}`).join(", ")}
                      </p>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {c.status === "draft" && (
                      <Button size="sm" onClick={() => handleLaunch(c.id)} disabled={launchingId !== null} className="gap-1.5 rounded-xl">
                        {launchingId === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        Запустить
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => openEdit(c)} className="gap-1.5 rounded-xl">
                      <Pencil className="h-3.5 w-3.5" />
                      Изменить
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => loadParticipantsPreview(c.id)} className="gap-1.5 rounded-xl">
                      <Users className="h-3.5 w-3.5" />
                      Участники
                    </Button>
                    {canDraw(c) && (
                      <Button size="sm" onClick={() => runDraw(c.id)} disabled={drawingId !== null} className="gap-1.5 rounded-xl">
                        {drawingId === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shuffle className="h-4 w-4" />}
                        Провести розыгрыш
                      </Button>
                    )}
                    {deleteConfirmId === c.id ? (
                      <>
                        <Button variant="destructive" size="sm" onClick={() => handleDelete(c.id)} disabled={saving} className="rounded-xl">
                          Удалить?
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setDeleteConfirmId(null)} className="rounded-xl">Отмена</Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDeleteConfirmId(c.id)}
                        className="gap-1.5 rounded-xl border-red-500/30 text-red-500 dark:text-red-400 hover:bg-red-500/10 hover:border-red-500/50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </Card>
              </motion.div>
            ))
          )}
        </div>
      )}

      {(detailId && (detail || participantsPreview)) && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-cyan-500/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
                  <Users className="h-5 w-5 text-cyan-500 dark:text-cyan-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold tracking-tight">{detail?.name ?? "Участники"}</h3>
                  <p className="text-xs text-muted-foreground">Превью и победители</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="rounded-full" onClick={() => { setDetailId(null); setDetail(null); setParticipantsPreview(null); }}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-4">
              {detail && isContestActive(detail) && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 backdrop-blur-md px-3 py-2 flex items-center gap-1.5 text-sm font-medium text-primary">
                  <Clock className="h-4 w-4" />
                  {formatTimeLeft(detail.endAt)}
                </div>
              )}
              {participantsPreview !== null && (
                <div className="rounded-2xl border border-white/5 bg-foreground/[0.03] dark:bg-white/[0.02] p-4">
                  <p className="text-sm font-medium mb-2">
                    Превью участников (по условиям конкурса):
                    <span className="ml-2 inline-flex items-center rounded-full bg-primary/10 text-primary border border-primary/20 px-2.5 py-0.5 text-xs font-semibold">
                      {participantsPreview.total} чел.
                    </span>
                  </p>
                  {participantsPreview.participants.length > 0 && (
                    <ul className="text-xs text-muted-foreground mt-2 space-y-1">
                      {participantsPreview.participants.slice(0, 20).map((p, i) => (
                        <li key={i} className="rounded-lg bg-foreground/[0.04] dark:bg-white/[0.04] border border-white/5 px-2.5 py-1.5">
                          <span className="font-mono">clientId: {p.clientId}</span>
                          <span className="mx-2">·</span>
                          дней: <span className="text-foreground font-medium">{p.totalDaysBought}</span>
                          <span className="mx-2">·</span>
                          оплат: <span className="text-foreground font-medium">{p.paymentsCount}</span>
                          {p.referralsCount != null && (
                            <>
                              <span className="mx-2">·</span>
                              рефералов: <span className="text-foreground font-medium">{p.referralsCount}</span>
                            </>
                          )}
                        </li>
                      ))}
                      {participantsPreview.total > 20 && (
                        <li className="text-center pt-1 text-muted-foreground/70">… и ещё {participantsPreview.total - 20}</li>
                      )}
                    </ul>
                  )}
                </div>
              )}
              {detail?.winners && detail.winners.length > 0 && (
                <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 backdrop-blur-md p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-violet-500 dark:text-violet-400 flex items-center gap-1.5">
                      <Award className="h-4 w-4" /> Победители
                    </p>
                    {detail.status === "drawn" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => undoDraw(detail.id)}
                        disabled={drawingId === detail.id}
                        className="h-7 gap-1.5 text-xs text-orange-600 dark:text-orange-400 border-orange-500/30 hover:bg-orange-500/10"
                      >
                        <X className="h-3 w-3" /> Отменить розыгрыш
                      </Button>
                    )}
                  </div>
                  <ul className="text-sm space-y-1.5">
                    {detail.winners.map((w) => {
                      const winnerObj = w as typeof w & { id?: string };
                      const wId = winnerObj.id;
                      return (
                        <li key={w.place} className="rounded-lg bg-foreground/[0.04] dark:bg-white/[0.04] border border-white/5 px-3 py-2 flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center rounded-full bg-violet-500/10 text-violet-500 dark:text-violet-400 border border-violet-500/20 px-2 py-0.5 text-[11px] font-semibold">
                            {w.place} место
                          </span>
                          <span className="font-medium">{w.client?.telegramUsername ?? w.client?.email ?? w.client?.id}</span>
                          <span className="text-muted-foreground">— {w.prizeType}: {w.prizeValue}</span>
                          {w.appliedAt ? (
                            <span className="inline-flex items-center rounded-full bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-medium">
                              начислено
                            </span>
                          ) : (
                            wId && (
                              <Button
                                size="sm"
                                onClick={() => applyPrize(detail.id, wId)}
                                className="h-6 ml-auto gap-1 px-2 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white"
                              >
                                <Sparkles className="h-3 w-3" />
                                Применить
                              </Button>
                            )
                          )}
                          {wId && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => removeWinner(detail.id, wId)}
                              className="h-6 w-6 p-0 text-red-500 hover:bg-red-500/10 hover:text-red-600"
                              title="Удалить победителя"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
