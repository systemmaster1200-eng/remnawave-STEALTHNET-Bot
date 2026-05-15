import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth";
import {
  api,
  type AutoBroadcastRule,
  type AutoBroadcastRulePayload,
  type AutoBroadcastTriggerType,
} from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { motion } from "framer-motion";
import {
  CalendarClock,
  Plus,
  Play,
  Trash2,
  Pencil,
  Loader2,
  Clock,
  MousePointerClick,
  Send,
  Users,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BUTTON_ACTIONS = [
  { value: "", label: "Без кнопки" },
  { value: "menu:tariffs", label: "📦 Тарифы" },
  { value: "menu:topup", label: "💳 Пополнить баланс" },
  { value: "menu:profile", label: "👤 Профиль" },
  { value: "menu:trial", label: "🎁 Бесплатный триал" },
  { value: "menu:referral", label: "🔗 Реферальная программа" },
  { value: "menu:promocode", label: "🎟️ Промокод" },
  { value: "menu:support", label: "🆘 Поддержка" },
  { value: "menu:vpn", label: "📋 VPN подключение" },
  { value: "menu:devices", label: "📱 Устройства" },
  { value: "menu:extra_options", label: "➕ Доп. опции" },
  { value: "menu:main", label: "📋 Главное меню" },
  { value: "webapp:/cabinet", label: "🌐 Web кабинет" },
  { value: "webapp:/cabinet/subscribe", label: "🌐 Страница подключения" },
  { value: "webapp:/cabinet/tickets", label: "🌐 Тикеты" },
  { value: "__custom_url__", label: "🔗 Своя ссылка (URL)" },
];

const TRIGGER_LABELS: Record<AutoBroadcastTriggerType, string> = {
  after_registration: "После регистрации",
  inactivity: "Неактивность (нет оплат)",
  no_payment: "Ни разу не платил",
  trial_not_connected: "Не подключил триал",
  trial_used_never_paid: "Пользовался триалом, но не оплатил",
  no_traffic: "Подключён к VPN (напоминание)",
  subscription_expired: "Подписка истекла",
  subscription_ending_soon: "Подписка заканчивается скоро (за N дней)",
};

const CHANNEL_LABELS: Record<string, string> = {
  telegram: "Telegram",
  email: "Email",
  both: "Telegram и Email",
};

export function AutoBroadcastPage() {
  const { state } = useAuth();
  const token = state.accessToken ?? "";
  const [rules, setRules] = useState<AutoBroadcastRule[]>([]);
  const [eligibleCounts, setEligibleCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [runAllLoading, setRunAllLoading] = useState(false);
  const [runningRuleId, setRunningRuleId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<AutoBroadcastRulePayload>({
    name: "",
    triggerType: "after_registration",
    delayDays: 1,
    channel: "telegram",
    subject: "",
    message: "",
    buttonText: "",
    buttonUrl: "",
    enabled: true,
  });
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [scheduleCron, setScheduleCron] = useState("");
  const [scheduleSaving, setScheduleSaving] = useState(false);

  function loadRules() {
    if (!token) return;
    setLoading(true);
    api
      .getAutoBroadcastRules(token)
      .then((list) => {
        setRules(list);
        return list;
      })
      .then((list) => {
        const counts: Record<string, number> = {};
        Promise.all(
          list.map((r) =>
            api.getAutoBroadcastEligibleCount(token, r.id).then(({ count }) => {
              counts[r.id] = count;
            })
          )
        ).then(() => setEligibleCounts(counts));
      })
      .catch(() => setRules([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadRules();
  }, [token]);

  useEffect(() => {
    if (token) {
      api.getSettings(token).then((s) => setScheduleCron(s.autoBroadcastCron ?? "")).catch(() => {});
    }
  }, [token]);

  async function handleSaveSchedule(e: React.FormEvent) {
    e.preventDefault();
    setScheduleSaving(true);
    try {
      await api.updateSettings(token, { autoBroadcastCron: scheduleCron.trim() || null });
    } catch {
      // ignore
    } finally {
      setScheduleSaving(false);
    }
  }

  const [buttonAction, setButtonAction] = useState("");
  const [buttonCustomUrl, setButtonCustomUrl] = useState("");

  function resolveActionFromUrl(url: string | null): { action: string; customUrl: string } {
    if (!url) return { action: "", customUrl: "" };
    if (BUTTON_ACTIONS.some((a) => a.value === url && a.value !== "__custom_url__")) {
      return { action: url, customUrl: "" };
    }
    return { action: "__custom_url__", customUrl: url };
  }

  function openCreate() {
    setEditingId(null);
    setForm({
      name: "",
      triggerType: "after_registration",
      delayDays: 1,
      channel: "telegram",
      subject: "",
      message: "",
      buttonText: "",
      buttonUrl: "",
      enabled: true,
    });
    setButtonAction("");
    setButtonCustomUrl("");
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(rule: AutoBroadcastRule) {
    setEditingId(rule.id);
    const { action, customUrl } = resolveActionFromUrl(rule.buttonUrl);
    setForm({
      name: rule.name,
      triggerType: rule.triggerType,
      delayDays: rule.delayDays,
      channel: rule.channel,
      subject: rule.subject ?? "",
      message: rule.message,
      buttonText: rule.buttonText ?? "",
      buttonUrl: rule.buttonUrl ?? "",
      enabled: rule.enabled,
    });
    setButtonAction(action);
    setButtonCustomUrl(customUrl);
    setFormError(null);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const resolvedUrl = buttonAction === "__custom_url__" ? buttonCustomUrl.trim() : buttonAction;
    const payload: AutoBroadcastRulePayload = {
      ...form,
      subject: form.subject?.trim() || null,
      buttonText: form.buttonText?.trim() || null,
      buttonUrl: resolvedUrl || null,
    };
    if (!payload.name.trim()) {
      setFormError("Укажите название правила");
      return;
    }
    if (!payload.message.trim()) {
      setFormError("Укажите текст сообщения");
      return;
    }
    setFormSaving(true);
    try {
      if (editingId) {
        await api.updateAutoBroadcastRule(token, editingId, payload);
      } else {
        await api.createAutoBroadcastRule(token, payload);
      }
      closeForm();
      loadRules();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setFormSaving(false);
    }
  }

  async function handleDelete(ruleId: string) {
    if (!confirm("Удалить правило?")) return;
    try {
      await api.deleteAutoBroadcastRule(token, ruleId);
      loadRules();
    } catch {
      // ignore
    }
  }

  function formatRunResult(r: { sent: number; skipped: number; errors: string[] }): string {
    const parts: string[] = [];
    if (r.sent > 0) parts.push(`✅ Отправлено: ${r.sent}`);
    if (r.skipped > 0) parts.push(`⏭ Пропущено (бот заблокирован): ${r.skipped}`);
    if (r.errors.length > 0) parts.push(`❌ Ошибки: ${r.errors.join("; ")}`);
    if (parts.length === 0) parts.push("Нет подходящих получателей");
    return parts.join("\n");
  }

  async function handleRunAll() {
    setRunAllLoading(true);
    try {
      const { results } = await api.runAutoBroadcastAll(token);
      const totalSent = results.reduce((s, r) => s + r.sent, 0);
      const totalSkipped = results.reduce((s, r) => s + r.skipped, 0);
      const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);
      loadRules();
      alert(`Отправлено: ${totalSent}, пропущено: ${totalSkipped}${totalErrors > 0 ? `, ошибок: ${totalErrors}` : ""}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Ошибка запуска");
    } finally {
      setRunAllLoading(false);
    }
  }

  async function handleRunOne(ruleId: string) {
    setRunningRuleId(ruleId);
    try {
      const result = await api.runAutoBroadcastRule(token, ruleId);
      loadRules();
      alert(formatRunResult(result));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Ошибка запуска");
    } finally {
      setRunningRuleId(null);
    }
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
            <CalendarClock className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">
              Авто-рассылка
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Настраиваемые правила: после регистрации, неактивность, без платежа — чтобы не терять клиентов
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleRunAll}
            disabled={runAllLoading || rules.length === 0}
            className="gap-1.5 rounded-xl"
          >
            {runAllLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Запустить все
          </Button>
          <Button onClick={openCreate} className="gap-1.5 rounded-xl">
            <Plus className="h-4 w-4" />
            Добавить правило
          </Button>
        </div>
      </motion.div>

      {/* Schedule card */}
      <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-cyan-500/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
            <Clock className="h-5 w-5 text-cyan-500 dark:text-cyan-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold tracking-tight">Расписание</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Cron: минута час день месяц день_недели. Например{" "}
              <code className="rounded-md bg-foreground/[0.05] dark:bg-white/[0.05] border border-white/10 px-1.5 py-0.5 text-[11px]">
                0 9 * * *
              </code>{" "}
              — каждый день в 9:00. Пусто = по умолчанию 9:00.
            </p>
          </div>
        </div>
        <form onSubmit={handleSaveSchedule} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1 space-y-1.5">
            <Label htmlFor="schedule-cron" className="text-xs text-muted-foreground">
              Выражение cron
            </Label>
            <Input
              id="schedule-cron"
              value={scheduleCron}
              onChange={(e) => setScheduleCron(e.target.value)}
              placeholder="0 9 * * *"
              className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
            />
          </div>
          <Button type="submit" disabled={scheduleSaving} className="gap-2 rounded-xl">
            {scheduleSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Сохранить расписание
          </Button>
        </form>
      </Card>

      {/* Rules card */}
      <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
            <Send className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-bold tracking-tight">Правила</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Все настроенные сценарии авто-рассылки
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Загружаем правила…</p>
          </div>
        ) : rules.length === 0 ? (
          <div className="flex flex-col items-center text-center py-12">
            <div className="h-16 w-16 rounded-full bg-white/5 flex items-center justify-center mb-3 border border-white/10">
              <CalendarClock className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">Правил пока нет</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Добавьте первое правило, чтобы начать</p>
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map((rule, idx) => (
              <motion.div
                key={rule.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03 }}
                whileHover={{ y: -2 }}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] p-4 transition-all hover:border-white/20 hover:shadow-lg"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{rule.name}</span>
                    {rule.enabled ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20 px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-md">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_4px_#10b981]" />
                        Активно
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/40 text-muted-foreground border border-white/10 px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-md">
                        Выключено
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    <span className="text-foreground/80">{TRIGGER_LABELS[rule.triggerType]}</span>
                    {rule.triggerType === "subscription_ending_soon"
                      ? ` · за ${rule.delayDays} дн. до окончания`
                      : ` · через ${rule.delayDays} дн.`}{" "}
                    · <span className="text-cyan-500 dark:text-cyan-400">{CHANNEL_LABELS[rule.channel]}</span>
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Send className="h-3 w-3" />
                      Отправлено: <span className="text-foreground font-medium">{rule.sentCount ?? 0}</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      Подходят сейчас:{" "}
                      <span className="text-foreground font-medium">{eligibleCounts[rule.id] ?? "—"}</span>
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRunOne(rule.id)}
                    disabled={runningRuleId !== null}
                    className="gap-1.5 rounded-xl"
                  >
                    {runningRuleId === rule.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    Запустить
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-lg"
                    onClick={() => openEdit(rule)}
                    title="Редактировать"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500/10"
                    onClick={() => handleDelete(rule.id)}
                    title="Удалить"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </Card>

      <Dialog open={showForm} onOpenChange={(open) => !open && closeForm()}>
        <DialogContent className="bg-background/80 backdrop-blur-3xl border-white/10 rounded-[2rem] max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold tracking-tight">
              <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-white/10 flex items-center justify-center shadow-inner">
                {editingId ? <Pencil className="h-4 w-4 text-primary" /> : <Plus className="h-4 w-4 text-primary" />}
              </div>
              {editingId ? "Редактировать правило" : "Новое правило"}
            </DialogTitle>
            <DialogDescription className="sr-only">Форма правила авторассылки</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 pt-2">
            {formError && (
              <div className="flex items-start gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 backdrop-blur-md px-4 py-3 text-sm text-red-500 dark:text-red-400">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <p>{formError}</p>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Название</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Например: Напоминание через 3 дня"
                  className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Триггер</Label>
                <select
                  className="flex h-10 w-full rounded-xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  value={form.triggerType}
                  onChange={(e) => {
                    const t = e.target.value as AutoBroadcastTriggerType;
                    setForm((f) => ({
                      ...f,
                      triggerType: t,
                      delayDays:
                        t === "subscription_ending_soon"
                          ? Math.max(1, Math.min(30, f.delayDays))
                          : f.delayDays,
                    }));
                  }}
                >
                  {(Object.keys(TRIGGER_LABELS) as AutoBroadcastTriggerType[]).map((t) => (
                    <option key={t} value={t}>
                      {TRIGGER_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  {form.triggerType === "subscription_ending_soon"
                    ? "За сколько дней до окончания (1–30)"
                    : "Через сколько дней (0–365)"}
                </Label>
                <Input
                  type="number"
                  min={form.triggerType === "subscription_ending_soon" ? 1 : 0}
                  max={form.triggerType === "subscription_ending_soon" ? 30 : 365}
                  value={form.delayDays}
                  onChange={(e) => {
                    const v = Number(e.target.value) || 0;
                    const min = form.triggerType === "subscription_ending_soon" ? 1 : 0;
                    const max = form.triggerType === "subscription_ending_soon" ? 30 : 365;
                    setForm((f) => ({ ...f, delayDays: Math.max(min, Math.min(max, v)) }));
                  }}
                  className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
                />
                {form.triggerType === "subscription_ending_soon" && (
                  <p className="text-[11px] text-muted-foreground">
                    Создайте несколько правил (например, за 7, за 3, за 1 день) — рассылка будет с нужным текстом.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Канал</Label>
                <select
                  className="flex h-10 w-full rounded-xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  value={form.channel}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, channel: e.target.value as "telegram" | "email" | "both" }))
                  }
                >
                  <option value="telegram">Telegram</option>
                  <option value="email">Email</option>
                  <option value="both">Telegram и Email</option>
                </select>
              </div>
            </div>
            {(form.channel === "email" || form.channel === "both") && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Тема письма (для email)</Label>
                <Input
                  value={form.subject ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                  placeholder="Тема письма"
                  className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Текст сообщения</Label>
              <textarea
                className="flex min-h-[140px] w-full rounded-xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] px-4 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 resize-y"
                value={form.message}
                onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                placeholder="Текст для Telegram / email (до 4096 символов)"
                maxLength={4096}
              />
              <p className="text-[11px] text-muted-foreground">{form.message.length} / 4096</p>
            </div>
            {(form.channel === "telegram" || form.channel === "both") && (
              <div className="rounded-2xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <MousePointerClick className="h-4 w-4 text-primary" />
                  Кнопка под сообщением (только Telegram)
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Действие кнопки</Label>
                    <select
                      className="flex h-10 w-full rounded-xl border border-white/10 bg-background/60 px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                      value={buttonAction}
                      onChange={(e) => setButtonAction(e.target.value)}
                    >
                      {BUTTON_ACTIONS.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {buttonAction && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Текст кнопки</Label>
                      <Input
                        value={form.buttonText ?? ""}
                        onChange={(e) => setForm((f) => ({ ...f, buttonText: e.target.value }))}
                        placeholder="Открыть тарифы"
                        maxLength={64}
                        className="h-10 rounded-xl bg-background/60 border-white/10 focus-visible:ring-primary/50"
                      />
                    </div>
                  )}
                </div>
                {buttonAction === "__custom_url__" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Ссылка (URL)</Label>
                    <Input
                      value={buttonCustomUrl}
                      onChange={(e) => setButtonCustomUrl(e.target.value)}
                      placeholder="https://example.com/tariffs"
                      maxLength={500}
                      className="h-10 rounded-xl bg-background/60 border-white/10 focus-visible:ring-primary/50"
                    />
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Выберите действие — под сообщением появится inline-кнопка, открывающая выбранный раздел бота.
                </p>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] px-4 py-3">
              <div>
                <Label htmlFor="form-enabled" className="text-sm font-semibold cursor-pointer">
                  Включено
                </Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Участвует в запуске «Запустить все»
                </p>
              </div>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                  form.enabled ? "bg-emerald-500" : "bg-muted-foreground/30"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform",
                    form.enabled ? "translate-x-5" : "translate-x-0"
                  )}
                />
              </button>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={closeForm} className="rounded-xl">
                Отмена
              </Button>
              <Button type="submit" disabled={formSaving} className="gap-2 rounded-xl">
                {formSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {editingId ? "Сохранить" : "Создать"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
