import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { api, type BroadcastResult, type BroadcastProgress, type BroadcastHistoryItem } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Paperclip, X, MousePointerClick, Mail, MessageSquare, Loader2, AlertTriangle, CheckCircle2,
  History as HistoryIcon, Eye, RefreshCw, Sparkles, Megaphone, Users, Image as ImageIcon, FileText,
  Zap, Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_ATTACHMENT_MB = 20;

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

type ChannelKey = "telegram" | "email" | "both";

const CHANNEL_META: Record<ChannelKey, { label: string; desc: string; icon: typeof Send; gradient: string; ring: string; iconBg: string; accent: string }> = {
  telegram: {
    label: "Telegram",
    desc: "Сообщение в чат бота",
    icon: MessageSquare,
    gradient: "from-sky-500/30 via-blue-500/20 to-indigo-500/30",
    ring: "ring-sky-400/60 border-sky-400/40",
    iconBg: "bg-sky-500/20 text-sky-500 dark:text-sky-400",
    accent: "text-sky-500 dark:text-sky-400",
  },
  email: {
    label: "Email",
    desc: "Письмо с темой и вложением",
    icon: Mail,
    gradient: "from-cyan-500/30 via-teal-500/20 to-emerald-500/30",
    ring: "ring-cyan-400/60 border-cyan-400/40",
    iconBg: "bg-cyan-500/20 text-cyan-500 dark:text-cyan-400",
    accent: "text-cyan-500 dark:text-cyan-400",
  },
  both: {
    label: "Telegram + Email",
    desc: "Отправить везде сразу",
    icon: Sparkles,
    gradient: "from-fuchsia-500/30 via-purple-500/20 to-pink-500/30",
    ring: "ring-fuchsia-400/60 border-fuchsia-400/40",
    iconBg: "bg-fuchsia-500/20 text-fuchsia-500 dark:text-fuchsia-400",
    accent: "text-fuchsia-500 dark:text-fuchsia-400",
  },
};

export function BroadcastPage() {
  const { state } = useAuth();
  const token = state.accessToken ?? "";
  const [broadcastRecipients, setBroadcastRecipients] = useState<{ withTelegram: number; withEmail: number } | null>(null);
  const [broadcastChannel, setBroadcastChannel] = useState<ChannelKey>("telegram");
  const [broadcastSubject, setBroadcastSubject] = useState("");
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcastAttachment, setBroadcastAttachment] = useState<File | null>(null);
  const [broadcastButtonText, setBroadcastButtonText] = useState("");
  const [broadcastButtonAction, setBroadcastButtonAction] = useState("");
  const [broadcastButtonCustomUrl, setBroadcastButtonCustomUrl] = useState("");
  const [broadcastLoading, setBroadcastLoading] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<BroadcastResult | null>(null);
  const [broadcastProgress, setBroadcastProgress] = useState<BroadcastProgress | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [activeTab, setActiveTab] = useState<"compose" | "history">("compose");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (token) {
      api.broadcastRecipientsCount(token).then(setBroadcastRecipients).catch(() => setBroadcastRecipients(null));
    }
  }, [token]);

  const targetCount = useMemo(() => {
    if (!broadcastRecipients) return 0;
    if (broadcastChannel === "telegram") return broadcastRecipients.withTelegram;
    if (broadcastChannel === "email") return broadcastRecipients.withEmail;
    return broadcastRecipients.withTelegram + broadcastRecipients.withEmail;
  }, [broadcastRecipients, broadcastChannel]);

  async function handleBroadcastSend(e: React.FormEvent) {
    e.preventDefault();
    const text = broadcastMessage.trim();
    if (!text) return;
    if (broadcastAttachment && broadcastAttachment.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
      setBroadcastResult({
        ok: false,
        sentTelegram: 0,
        sentEmail: 0,
        failedTelegram: 0,
        failedEmail: 0,
        errors: [`Файл не должен превышать ${MAX_ATTACHMENT_MB} МБ`],
      });
      return;
    }
    setBroadcastLoading(true);
    setBroadcastResult(null);
    setBroadcastProgress(null);
    try {
      const resolvedAction = broadcastButtonAction === "__custom_url__" ? broadcastButtonCustomUrl.trim() : broadcastButtonAction;
      const { jobId } = await api.broadcast(
        token,
        {
          channel: broadcastChannel,
          subject: broadcastSubject.trim() || undefined,
          message: text,
          buttonText: broadcastButtonText.trim() || undefined,
          buttonUrl: resolvedAction || undefined,
        },
        broadcastAttachment ?? undefined
      );
      const finalResult = await pollBroadcastJob(jobId);
      setBroadcastResult(finalResult);
      if (finalResult.ok) {
        setBroadcastMessage("");
        setBroadcastSubject("");
        setBroadcastAttachment(null);
        setBroadcastButtonText("");
        setBroadcastButtonAction("");
        setBroadcastButtonCustomUrl("");
        api.broadcastRecipientsCount(token).then(setBroadcastRecipients).catch(() => {});
      }
    } catch (err) {
      setBroadcastResult({
        ok: false,
        sentTelegram: 0,
        sentEmail: 0,
        failedTelegram: 0,
        failedEmail: 0,
        errors: [err instanceof Error ? err.message : "Ошибка отправки"],
      });
    } finally {
      setBroadcastLoading(false);
      setBroadcastProgress(null);
    }
  }

  async function pollBroadcastJob(jobId: string): Promise<BroadcastResult> {
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      try {
        const s = await api.broadcastStatus(token, jobId);
        if (s.progress) setBroadcastProgress(s.progress);
        if (s.status === "completed" && s.result) return s.result;
        if (s.status === "error") {
          return {
            ok: false,
            sentTelegram: s.progress?.sentTelegram ?? 0,
            sentEmail: s.progress?.sentEmail ?? 0,
            failedTelegram: s.progress?.failedTelegram ?? 0,
            failedEmail: s.progress?.failedEmail ?? 0,
            errors: [s.error || "Ошибка рассылки"],
          };
        }
      } catch {
        // network blip — retry
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return {
      ok: false,
      sentTelegram: 0,
      sentEmail: 0,
      failedTelegram: 0,
      failedEmail: 0,
      errors: ["Превышен таймаут опроса статуса. Рассылка, возможно, всё ещё идёт — проверьте позже."],
    };
  }

  const channelMeta = CHANNEL_META[broadcastChannel];

  function handleFileDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setBroadcastAttachment(f);
  }

  return (
    <div className="space-y-6 px-4 sm:px-6 md:px-8 pt-6 pb-10 relative">
      {/* Декоративные блобы фона */}
      <div className="fixed -z-10 bg-primary/15 blur-[120px] top-[-50px] left-[-50px] w-[300px] h-[300px] rounded-full pointer-events-none" />
      <div className="fixed -z-10 bg-purple-500/10 blur-[100px] top-[20%] right-[-50px] w-[280px] h-[280px] rounded-full pointer-events-none" />
      <div className="fixed -z-10 bg-cyan-500/10 blur-[90px] bottom-[10%] left-[30%] w-[240px] h-[240px] rounded-full pointer-events-none" />

      {/* HERO */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden bg-gradient-to-br from-background/50 via-background/30 to-background/50 backdrop-blur-3xl border border-white/10 p-6 sm:p-8 rounded-[2.5rem] shadow-2xl"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-fuchsia-500/10 pointer-events-none" />
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-primary/20 blur-3xl rounded-full pointer-events-none" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-4">
            <motion.div
              animate={{ rotate: [0, -8, 8, -4, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 4 }}
              className="h-16 w-16 rounded-3xl bg-gradient-to-br from-primary/30 via-fuchsia-500/20 to-purple-500/30 flex items-center justify-center shadow-xl border border-white/20"
            >
              <Megaphone className="h-8 w-8 text-primary drop-shadow-lg" />
            </motion.div>
            <div>
              <h1 className="text-4xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary via-fuchsia-500 to-purple-500">
                Рассылка
              </h1>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-md">
                Отправляй сообщения клиентам в Telegram и/или на email — с кнопками, фото и файлами
              </p>
            </div>
          </div>
          {broadcastRecipients && (
            <div className="flex flex-wrap gap-2">
              <StatPill icon={MessageSquare} label="Telegram" value={broadcastRecipients.withTelegram} colorClass="from-sky-500/20 to-blue-500/10 text-sky-500 dark:text-sky-400 border-sky-400/30" />
              <StatPill icon={Mail} label="Email" value={broadcastRecipients.withEmail} colorClass="from-cyan-500/20 to-teal-500/10 text-cyan-500 dark:text-cyan-400 border-cyan-400/30" />
              <StatPill icon={Users} label="Всего" value={broadcastRecipients.withTelegram + broadcastRecipients.withEmail} colorClass="from-fuchsia-500/20 to-purple-500/10 text-fuchsia-500 dark:text-fuchsia-400 border-fuchsia-400/30" />
            </div>
          )}
        </div>
      </motion.div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "compose" | "history")} className="w-full">
        <TabsList className="bg-background/40 backdrop-blur-3xl border border-white/10 rounded-2xl p-1.5 shadow-lg h-auto">
          <TabsTrigger value="compose" className="rounded-xl px-5 py-2.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-primary data-[state=active]:to-fuchsia-500 data-[state=active]:text-white data-[state=active]:shadow-md">
            <Send className="h-4 w-4 mr-2" /> Создать
          </TabsTrigger>
          <TabsTrigger value="history" className="rounded-xl px-5 py-2.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-primary data-[state=active]:to-fuchsia-500 data-[state=active]:text-white data-[state=active]:shadow-md">
            <HistoryIcon className="h-4 w-4 mr-2" /> История
          </TabsTrigger>
        </TabsList>

        {/* ────────── COMPOSE ────────── */}
        <TabsContent value="compose" className="mt-5 space-y-5">
          <Card className="relative overflow-hidden bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] shadow-xl">
            <div className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", channelMeta.gradient)} />
            <form onSubmit={handleBroadcastSend} className="p-5 sm:p-7 space-y-7">

              {/* CHANNEL CARDS */}
              <section>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-3 block">
                  <Zap className="inline h-3 w-3 mr-1" /> Канал отправки
                </Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {(Object.keys(CHANNEL_META) as ChannelKey[]).map((c) => {
                    const meta = CHANNEL_META[c];
                    const Icon = meta.icon;
                    const isActive = broadcastChannel === c;
                    const recipients = c === "telegram"
                      ? broadcastRecipients?.withTelegram
                      : c === "email"
                        ? broadcastRecipients?.withEmail
                        : (broadcastRecipients ? broadcastRecipients.withTelegram + broadcastRecipients.withEmail : 0);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setBroadcastChannel(c)}
                        className={cn(
                          "relative overflow-hidden text-left rounded-2xl border p-4 transition-all duration-200",
                          "hover:scale-[1.02] hover:shadow-lg",
                          isActive
                            ? cn("bg-gradient-to-br ring-2", meta.gradient, meta.ring, "shadow-lg")
                            : "bg-foreground/[0.02] dark:bg-white/[0.02] border-white/10 hover:border-white/20"
                        )}
                      >
                        {isActive && (
                          <motion.div
                            layoutId="channelGlow"
                            className="absolute -top-8 -right-8 w-24 h-24 bg-white/30 rounded-full blur-2xl pointer-events-none"
                          />
                        )}
                        <div className="relative flex items-start gap-3">
                          <div className={cn("h-11 w-11 rounded-2xl flex items-center justify-center shrink-0", meta.iconBg)}>
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={cn("font-semibold text-sm", isActive && meta.accent)}>{meta.label}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">{meta.desc}</p>
                            {recipients != null && (
                              <p className="text-[11px] mt-1.5">
                                <span className="text-muted-foreground">Получателей: </span>
                                <span className={cn("font-bold", isActive ? meta.accent : "text-foreground")}>{recipients}</span>
                              </p>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* SUBJECT (email only) */}
              <AnimatePresence>
                {(broadcastChannel === "email" || broadcastChannel === "both") && (
                  <motion.section
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
                      <Mail className="inline h-3 w-3 mr-1" /> Тема письма
                    </Label>
                    <Input
                      value={broadcastSubject}
                      onChange={(e) => setBroadcastSubject(e.target.value)}
                      placeholder="Сообщение от сервиса"
                      maxLength={500}
                      className="h-11 rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-cyan-500/40"
                    />
                  </motion.section>
                )}
              </AnimatePresence>

              {/* MESSAGE */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    <FileText className="inline h-3 w-3 mr-1" /> Текст сообщения
                  </Label>
                  <span className={cn(
                    "text-[10px] font-mono px-2 py-0.5 rounded-full border",
                    broadcastMessage.length > 3800
                      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
                      : "bg-foreground/5 text-muted-foreground border-white/10"
                  )}>
                    {broadcastMessage.length} / 4096
                  </span>
                </div>
                <textarea
                  className="flex min-h-[180px] w-full rounded-2xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] px-4 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 resize-y leading-relaxed"
                  value={broadcastMessage}
                  onChange={(e) => setBroadcastMessage(e.target.value)}
                  placeholder={`Введите текст рассылки.\n\nДля Telegram поддерживается HTML: <b>жирный</b>, <i>курсив</i>, <a href="...">ссылки</a>.`}
                  maxLength={4096}
                  required
                />
              </section>

              {/* ATTACHMENT (drag-drop) */}
              <section>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
                  <Paperclip className="inline h-3 w-3 mr-1" /> Вложение
                  <span className="ml-1 text-[10px] normal-case text-muted-foreground/70">до {MAX_ATTACHMENT_MB} МБ</span>
                </Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf,.doc,.docx,.txt"
                  className="hidden"
                  onChange={(e) => setBroadcastAttachment(e.target.files?.[0] ?? null)}
                />
                {!broadcastAttachment ? (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleFileDrop}
                    className={cn(
                      "cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition-all",
                      dragOver
                        ? "border-primary/60 bg-primary/10"
                        : "border-white/15 bg-foreground/[0.02] dark:bg-white/[0.02] hover:border-white/30 hover:bg-white/[0.04]"
                    )}
                  >
                    <ImageIcon className={cn("h-8 w-8 mx-auto mb-2", dragOver ? "text-primary" : "text-muted-foreground")} />
                    <p className="text-sm font-medium">Перетащи файл сюда или <span className="text-primary underline">выбери</span></p>
                    <p className="text-[11px] text-muted-foreground mt-1">Картинки → как фото с подписью. Документы → как файл.</p>
                  </div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-4"
                  >
                    <div className="h-12 w-12 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
                      {broadcastAttachment.type.startsWith("image/") ? <ImageIcon className="h-6 w-6 text-primary" /> : <FileText className="h-6 w-6 text-primary" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{broadcastAttachment.name}</p>
                      <p className="text-[11px] text-muted-foreground">{(broadcastAttachment.size / 1024).toFixed(1)} КБ · {broadcastAttachment.type || "—"}</p>
                    </div>
                    <button
                      type="button"
                      className="h-8 w-8 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 flex items-center justify-center transition"
                      onClick={() => setBroadcastAttachment(null)}
                      aria-label="Удалить вложение"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </motion.div>
                )}
              </section>

              {/* INLINE BUTTON (Telegram only) */}
              <AnimatePresence>
                {(broadcastChannel === "telegram" || broadcastChannel === "both") && (
                  <motion.section
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-2xl border border-sky-500/20 bg-gradient-to-br from-sky-500/5 via-blue-500/5 to-indigo-500/5 p-5 space-y-4">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-xl bg-sky-500/20 flex items-center justify-center">
                          <MousePointerClick className="h-4 w-4 text-sky-500 dark:text-sky-400" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold">Кнопка под сообщением</p>
                          <p className="text-[11px] text-muted-foreground">Только для Telegram</p>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Действие</Label>
                          <select
                            className="flex h-11 w-full rounded-xl border border-white/10 bg-background/60 px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50"
                            value={broadcastButtonAction}
                            onChange={(e) => setBroadcastButtonAction(e.target.value)}
                          >
                            {BUTTON_ACTIONS.map((a) => (
                              <option key={a.value} value={a.value}>{a.label}</option>
                            ))}
                          </select>
                        </div>
                        {broadcastButtonAction && (
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Текст кнопки</Label>
                            <Input
                              value={broadcastButtonText}
                              onChange={(e) => setBroadcastButtonText(e.target.value)}
                              placeholder="Открыть тарифы"
                              maxLength={64}
                              className="h-11 rounded-xl bg-background/60 border-white/10 focus-visible:ring-sky-500/40"
                            />
                          </div>
                        )}
                      </div>
                      {broadcastButtonAction === "__custom_url__" && (
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Ссылка (URL)</Label>
                          <Input
                            value={broadcastButtonCustomUrl}
                            onChange={(e) => setBroadcastButtonCustomUrl(e.target.value)}
                            placeholder="https://example.com/tariffs"
                            maxLength={500}
                            className="h-11 rounded-xl bg-background/60 border-white/10 focus-visible:ring-sky-500/40"
                          />
                        </div>
                      )}
                    </div>
                  </motion.section>
                )}
              </AnimatePresence>

              {/* SUBMIT */}
              <div className="pt-2 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5" />
                  Будет отправлено: <strong className={channelMeta.accent}>{targetCount.toLocaleString("ru-RU")}</strong> получателей
                </p>
                <Button
                  type="submit"
                  disabled={broadcastLoading || !broadcastMessage.trim()}
                  className="h-12 px-8 rounded-2xl text-base font-semibold gap-2 bg-gradient-to-r from-primary via-fuchsia-500 to-purple-500 hover:from-primary/90 hover:via-fuchsia-500/90 hover:to-purple-500/90 shadow-lg shadow-primary/30 disabled:opacity-50"
                >
                  {broadcastLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                  {broadcastLoading ? "Идёт рассылка…" : "Запустить рассылку"}
                </Button>
              </div>

              {broadcastLoading && broadcastProgress && !broadcastResult && (
                <BroadcastProgressPanel progress={broadcastProgress} />
              )}

              {broadcastResult && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "rounded-2xl border p-5 text-sm backdrop-blur-md",
                    broadcastResult.ok
                      ? "border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-teal-500/5"
                      : "border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-red-500/5"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0",
                      broadcastResult.ok ? "bg-emerald-500/20" : "bg-amber-500/20")}>
                      {broadcastResult.ok ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <AlertTriangle className="h-5 w-5 text-amber-500" />}
                    </div>
                    <div className="flex-1">
                      <p className={cn("font-semibold mb-2", broadcastResult.ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
                        {broadcastResult.ok ? "Рассылка успешно завершена!" : "Рассылка завершена с предупреждениями"}
                      </p>
                      <div className="flex flex-wrap gap-2 mb-2">
                        {broadcastResult.sentTelegram > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30 px-2.5 py-1 rounded-lg">
                            <MessageSquare className="h-3 w-3" /> TG: {broadcastResult.sentTelegram}
                          </span>
                        )}
                        {broadcastResult.sentEmail > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30 px-2.5 py-1 rounded-lg">
                            <Mail className="h-3 w-3" /> Email: {broadcastResult.sentEmail}
                          </span>
                        )}
                        {(broadcastResult.failedTelegram + broadcastResult.failedEmail) > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30 px-2.5 py-1 rounded-lg">
                            <X className="h-3 w-3" /> Ошибок: {broadcastResult.failedTelegram + broadcastResult.failedEmail}
                          </span>
                        )}
                      </div>
                      {broadcastResult.errors.length > 0 && (
                        <details className="mt-2">
                          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">Показать ошибки ({broadcastResult.errors.length})</summary>
                          <ul className="mt-2 list-disc pl-4 text-xs text-foreground/70 space-y-0.5 max-h-40 overflow-y-auto">
                            {broadcastResult.errors.map((err, i) => (<li key={i}>{err}</li>))}
                          </ul>
                        </details>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </form>
          </Card>
        </TabsContent>

        {/* ────────── HISTORY ────────── */}
        <TabsContent value="history" className="mt-5">
          <BroadcastHistoryPanel token={token} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatPill({ icon: Icon, label, value, colorClass }: { icon: typeof Send; label: string; value: number; colorClass: string }) {
  return (
    <div className={cn("inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br border px-4 py-2 backdrop-blur-md shadow-sm", colorClass)}>
      <Icon className="h-4 w-4" />
      <div>
        <p className="text-[10px] uppercase tracking-wide opacity-80 leading-none mb-0.5">{label}</p>
        <p className="text-base font-bold leading-none">{value.toLocaleString("ru-RU")}</p>
      </div>
    </div>
  );
}

function BroadcastProgressPanel({ progress }: { progress: BroadcastProgress }) {
  const tgDone = progress.sentTelegram + progress.failedTelegram;
  const emailDone = progress.sentEmail + progress.failedEmail;
  const tgPct = progress.totalTelegram > 0 ? Math.min(100, Math.round((tgDone / progress.totalTelegram) * 100)) : 0;
  const emailPct = progress.totalEmail > 0 ? Math.min(100, Math.round((emailDone / progress.totalEmail) * 100)) : 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-fuchsia-500/5 to-purple-500/10 p-5 text-sm backdrop-blur-md space-y-4"
    >
      <div className="flex items-center gap-2.5">
        <div className="relative h-9 w-9 rounded-xl bg-primary/20 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <div className="absolute inset-0 rounded-xl ring-2 ring-primary/30 animate-pulse" />
        </div>
        <div>
          <p className="font-semibold">
            Рассылка идёт{progress.currentChannel === "telegram" ? " — Telegram" : progress.currentChannel === "email" ? " — Email" : ""}…
          </p>
          <p className="text-[11px] text-muted-foreground">Не закрывай вкладку до завершения</p>
        </div>
      </div>
      {progress.totalTelegram > 0 && (
        <ProgressBar
          label="Telegram"
          icon={MessageSquare}
          done={tgDone}
          total={progress.totalTelegram}
          failed={progress.failedTelegram}
          pct={tgPct}
          colorClass="bg-gradient-to-r from-sky-500 to-blue-500"
          labelColor="text-sky-500 dark:text-sky-400"
        />
      )}
      {progress.totalEmail > 0 && (
        <ProgressBar
          label="Email"
          icon={Mail}
          done={emailDone}
          total={progress.totalEmail}
          failed={progress.failedEmail}
          pct={emailPct}
          colorClass="bg-gradient-to-r from-cyan-500 to-teal-500"
          labelColor="text-cyan-500 dark:text-cyan-400"
        />
      )}
      {progress.totalTelegram === 0 && progress.totalEmail === 0 && (
        <p className="text-xs text-muted-foreground">Подготавливаем получателей…</p>
      )}
    </motion.div>
  );
}

function ProgressBar({ label, icon: Icon, done, total, failed, pct, colorClass, labelColor }: { label: string; icon: typeof Mail; done: number; total: number; failed: number; pct: number; colorClass: string; labelColor: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className={cn("inline-flex items-center gap-1.5 font-medium", labelColor)}>
          <Icon className="h-3.5 w-3.5" /> {label}
        </span>
        <span className="text-muted-foreground font-mono">
          <strong className="text-foreground">{done}</strong> / {total}
          {failed > 0 && <span className="ml-2 text-amber-500">· ⚠ {failed}</span>}
          <span className="ml-2 text-[10px] opacity-70">{pct}%</span>
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-foreground/10 dark:bg-white/10 overflow-hidden">
        <div
          className={cn("h-full transition-all duration-300", colorClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function statusBadge(status: BroadcastHistoryItem["status"]): { text: string; cls: string; dot: string } {
  if (status === "completed") return { text: "Готово", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30", dot: "bg-emerald-500" };
  if (status === "running") return { text: "Идёт…", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30", dot: "bg-amber-500 animate-pulse" };
  return { text: "Ошибка", cls: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30", dot: "bg-red-500" };
}

function channelLabel(c: BroadcastHistoryItem["channel"]): string {
  if (c === "telegram") return "Telegram";
  if (c === "email") return "Email";
  return "TG + Email";
}

function channelMetaIcon(c: BroadcastHistoryItem["channel"]) {
  if (c === "telegram") return { Icon: MessageSquare, cls: "bg-sky-500/15 text-sky-500 dark:text-sky-400" };
  if (c === "email") return { Icon: Mail, cls: "bg-cyan-500/15 text-cyan-500 dark:text-cyan-400" };
  return { Icon: Sparkles, cls: "bg-fuchsia-500/15 text-fuchsia-500 dark:text-fuchsia-400" };
}

function BroadcastHistoryPanel({ token }: { token: string }) {
  const [items, setItems] = useState<BroadcastHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<BroadcastHistoryItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.getBroadcastHistory(token, 100, 0);
      setItems(r.items);
      setTotal(r.total);
    } catch {
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Aggregate stats для верхних карточек.
  const stats = useMemo(() => {
    let totalSentTg = 0, totalSentEmail = 0, totalFailed = 0, completed = 0;
    for (const it of items) {
      totalSentTg += it.sentTelegram;
      totalSentEmail += it.sentEmail;
      totalFailed += it.failedTelegram + it.failedEmail;
      if (it.status === "completed") completed++;
    }
    return { totalSentTg, totalSentEmail, totalFailed, completed };
  }, [items]);

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <HistoryStatCard icon={HistoryIcon} label="Всего рассылок" value={total} colorClass="from-primary/20 to-fuchsia-500/10 border-primary/30 text-primary" />
        <HistoryStatCard icon={MessageSquare} label="Доставлено TG" value={stats.totalSentTg} colorClass="from-sky-500/20 to-blue-500/10 border-sky-500/30 text-sky-500 dark:text-sky-400" />
        <HistoryStatCard icon={Mail} label="Доставлено Email" value={stats.totalSentEmail} colorClass="from-cyan-500/20 to-teal-500/10 border-cyan-500/30 text-cyan-500 dark:text-cyan-400" />
        <HistoryStatCard icon={AlertTriangle} label="Ошибок доставки" value={stats.totalFailed} colorClass="from-red-500/20 to-amber-500/10 border-red-500/30 text-red-500 dark:text-red-400" />
      </div>

      <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] shadow-xl overflow-hidden">
        <div className="flex items-center justify-between p-5 sm:p-6 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-primary/15 flex items-center justify-center">
              <HistoryIcon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-bold">История рассылок</h2>
              <p className="text-xs text-muted-foreground">Последние {Math.min(items.length, 100)} записей</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="rounded-xl">
            <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
            Обновить
          </Button>
        </div>

        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Загрузка…
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center space-y-2">
            <Megaphone className="h-12 w-12 mx-auto text-muted-foreground/40" />
            <p className="text-sm font-medium">Рассылок ещё не было</p>
            <p className="text-xs text-muted-foreground">Запусти первую — она появится здесь</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {items.map((it) => {
              const b = statusBadge(it.status);
              const ch = channelMetaIcon(it.channel);
              const ChIcon = ch.Icon;
              const tgLine = it.totalTelegram > 0
                ? `${it.sentTelegram}/${it.totalTelegram}${it.failedTelegram ? ` · ${it.failedTelegram} fail` : ""}`
                : null;
              const emailLine = it.totalEmail > 0
                ? `${it.sentEmail}/${it.totalEmail}${it.failedEmail ? ` · ${it.failedEmail} fail` : ""}`
                : null;
              const preview = it.message.length > 100 ? it.message.slice(0, 100) + "…" : it.message;
              return (
                <button
                  key={it.id}
                  onClick={() => setDetail(it)}
                  className="w-full text-left p-4 sm:p-5 hover:bg-white/[0.03] transition-colors flex flex-col sm:flex-row gap-4 sm:items-center group"
                >
                  <div className={cn("h-12 w-12 rounded-2xl flex items-center justify-center shrink-0", ch.cls)}>
                    <ChIcon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium border", b.cls)}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", b.dot)} />
                        {b.text}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{channelLabel(it.channel)}</span>
                      <span className="text-[11px] text-muted-foreground">·</span>
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">{new Date(it.startedAt).toLocaleString("ru-RU")}</span>
                    </div>
                    <p className="text-sm text-foreground/90 line-clamp-2 break-words pr-2">{preview}</p>
                    <div className="flex flex-wrap gap-2 text-[11px] font-mono">
                      {tgLine && (
                        <span className="inline-flex items-center gap-1 bg-sky-500/10 text-sky-600 dark:text-sky-400 px-2 py-0.5 rounded-md border border-sky-500/20">
                          <MessageSquare className="h-3 w-3" /> {tgLine}
                        </span>
                      )}
                      {emailLine && (
                        <span className="inline-flex items-center gap-1 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 px-2 py-0.5 rounded-md border border-cyan-500/20">
                          <Mail className="h-3 w-3" /> {emailLine}
                        </span>
                      )}
                      {it.attachmentName && (
                        <span className="inline-flex items-center gap-1 bg-foreground/5 text-muted-foreground px-2 py-0.5 rounded-md border border-white/10">
                          <Paperclip className="h-3 w-3" /> {it.attachmentName}
                        </span>
                      )}
                    </div>
                  </div>
                  <Eye className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto rounded-[2rem]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HistoryIcon className="h-5 w-5 text-primary" />
              Рассылка
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-sm">
              <p className="text-xs text-muted-foreground">Запущена: {new Date(detail.startedAt).toLocaleString("ru-RU")}{detail.finishedAt ? ` · завершена: ${new Date(detail.finishedAt).toLocaleString("ru-RU")}` : ""}</p>

              <div className="grid grid-cols-2 gap-3">
                <DetailTile label="Канал" value={channelLabel(detail.channel)} />
                <DetailTile label="Статус" value={statusBadge(detail.status).text} />
                {detail.totalTelegram > 0 && (
                  <DetailTile label="Telegram" value={`${detail.sentTelegram} / ${detail.totalTelegram}${detail.failedTelegram ? ` · ${detail.failedTelegram} fail` : ""}`} mono />
                )}
                {detail.totalEmail > 0 && (
                  <DetailTile label="Email" value={`${detail.sentEmail} / ${detail.totalEmail}${detail.failedEmail ? ` · ${detail.failedEmail} fail` : ""}`} mono />
                )}
              </div>

              {detail.subject && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Тема (email)</p>
                  <p className="text-sm">{detail.subject}</p>
                </div>
              )}

              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Сообщение</p>
                <pre className="whitespace-pre-wrap break-words text-sm p-4 rounded-2xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] max-h-72 overflow-y-auto leading-relaxed">{detail.message}</pre>
              </div>

              {(detail.buttonText || detail.buttonUrl) && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Кнопка</p>
                  <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-xs">
                    <p className="font-medium">{detail.buttonText}</p>
                    <code className="text-muted-foreground break-all">{detail.buttonUrl}</code>
                  </div>
                </div>
              )}

              {detail.attachmentName && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Вложение</p>
                  <p className="text-xs inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-foreground/5 border border-white/10"><Paperclip className="h-3 w-3" /> {detail.attachmentName}</p>
                </div>
              )}

              {detail.error && (
                <div className="p-4 rounded-2xl border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 text-xs flex gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Фатальная ошибка</p>
                    <p className="mt-0.5">{detail.error}</p>
                  </div>
                </div>
              )}

              {detail.errors && detail.errors.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Ошибки доставки ({detail.errors.length})</p>
                  <pre className="whitespace-pre-wrap text-xs p-3 rounded-2xl border bg-red-500/5 border-red-500/20 max-h-48 overflow-y-auto text-red-600 dark:text-red-400">{detail.errors.join("\n")}</pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HistoryStatCard({ icon: Icon, label, value, colorClass }: { icon: typeof Send; label: string; value: number; colorClass: string }) {
  return (
    <Card className={cn("p-4 rounded-2xl border bg-gradient-to-br backdrop-blur-md", colorClass)}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wide opacity-80 font-medium">{label}</p>
        <Icon className="h-4 w-4 opacity-70" />
      </div>
      <p className="text-2xl font-bold mt-1.5">{value.toLocaleString("ru-RU")}</p>
    </Card>
  );
}

function DetailTile({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="p-3 rounded-xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02]">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("font-medium mt-0.5", mono && "font-mono text-sm")}>{value}</p>
    </div>
  );
}
