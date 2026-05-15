import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { api, type AdminSettings } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { motion } from "framer-motion";
import {
  Megaphone, Link2, BarChart3, Target, Copy, Check, ExternalLink,
  Info, TrendingUp, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type CampaignsStatsRow = { source: string; campaign: string | null; registrations: number; trials: number; payments: number; revenue: number };

function fmt(n: number) { return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n); }
function fmtDec(n: number) { return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(n); }

function CopyButton({ text, label = "Копировать" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="gap-1.5 rounded-xl shrink-0">
      {copied ? <Check className="h-4 w-4 text-emerald-500 dark:text-emerald-400" /> : <Copy className="h-4 w-4" />}
      {copied ? "Скопировано" : label}
    </Button>
  );
}

function LinkRow({ title, href, description }: { title: string; href: string; description?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-3 border-b border-white/5 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-sm">{title}</p>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        <p className="text-xs font-mono text-muted-foreground/80 truncate mt-1" title={href}>{href}</p>
      </div>
      <div className="flex gap-2 shrink-0">
        <CopyButton text={href} />
        <Button variant="ghost" size="sm" asChild className="rounded-xl">
          <a href={href} target="_blank" rel="noopener noreferrer" title="Открыть">
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
      </div>
    </div>
  );
}

function SectionCard({ title, icon: Icon, description, children, color = "primary" }: { title: string; icon: React.ElementType; description: string; children: React.ReactNode; color?: "primary" | "violet" | "cyan" | "amber" | "emerald" }) {
  const gradMap = {
    primary: "from-primary/20 to-primary/5",
    violet: "from-violet-500/20 to-violet-500/5",
    cyan: "from-cyan-500/20 to-cyan-500/5",
    amber: "from-amber-500/20 to-amber-500/5",
    emerald: "from-emerald-500/20 to-emerald-500/5",
  };
  const iconColor = {
    primary: "text-primary",
    violet: "text-violet-500 dark:text-violet-400",
    cyan: "text-cyan-500 dark:text-cyan-400",
    amber: "text-amber-500 dark:text-amber-400",
    emerald: "text-emerald-500 dark:text-emerald-400",
  };
  return (
    <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 sm:p-6 shadow-xl">
      <div className="flex items-start gap-3 mb-4">
        <div className={cn("h-10 w-10 rounded-2xl bg-gradient-to-br border border-white/10 flex items-center justify-center shadow-inner shrink-0", gradMap[color])}>
          <Icon className={cn("h-5 w-5", iconColor[color])} />
        </div>
        <div>
          <h3 className="text-sm font-bold tracking-tight">{title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>
      {children}
    </Card>
  );
}

export function MarketingPage() {
  const { state } = useAuth();
  const token = state.accessToken;
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [gaId, setGaId] = useState("");
  const [ymId, setYmId] = useState("");
  const [campaignsStats, setCampaignsStats] = useState<CampaignsStatsRow[] | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    api.getSettings(token).then((s) => {
      setSettings(s);
      setGaId(s.googleAnalyticsId ?? "");
      setYmId(s.yandexMetrikaId ?? "");
    }).catch(() => {}).finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    api.getAnalytics(token).then((data) => setCampaignsStats(data.campaignsStats ?? [])).catch(() => setCampaignsStats([])).finally(() => setAnalyticsLoading(false));
  }, [token]);

  const saveAnalyticsIds = async () => {
    if (!token) return;
    setSaving(true);
    setMessage("");
    try {
      const updated = await api.updateSettings(token, {
        googleAnalyticsId: gaId.trim() || null,
        yandexMetrikaId: ymId.trim() || null,
      });
      setSettings(updated);
      setGaId(updated.googleAnalyticsId ?? "");
      setYmId(updated.yandexMetrikaId ?? "");
      setMessage("Настройки сохранены.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Загружаем настройки…</p>
      </div>
    );
  }

  const baseUrl = (settings.publicAppUrl ?? "").replace(/\/$/, "") || "https://ваш-сайт.ru";
  const botUsername = settings.telegramBotUsername?.replace(/^@/, "") ?? "ваш_бот";
  const botUrl = `https://t.me/${botUsername}`;

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
            <Megaphone className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">
              Маркетинг и аналитика
            </h1>
            <p className="text-sm text-muted-foreground mt-1">UTM-метки, счётчики и ссылки для рекламы</p>
          </div>
        </div>
      </motion.div>

      <SectionCard title="Полезные ссылки" icon={Link2} description="Ссылки для рассылок, рекламы и шаблоны с UTM" color="primary">
        <div className="rounded-2xl border border-white/5 bg-foreground/[0.03] dark:bg-white/[0.02] px-4">
          <LinkRow title="Кабинет — вход" href={`${baseUrl}/cabinet/login`} description="Страница входа в личный кабинет" />
          <LinkRow title="Кабинет — регистрация" href={`${baseUrl}/cabinet/register`} description="Страница регистрации" />
          <LinkRow title="Бот (старт)" href={`${botUrl}?start=`} description="Ссылка на бота без параметров" />
          <LinkRow title="Реферальная ссылка (шаблон)" href={`${baseUrl}/cabinet/register?ref=КОД_РЕФЕРАЛА`} description="Замените КОД_РЕФЕРАЛА на реферальный код" />
          <LinkRow title="Регистрация с UTM (шаблон)" href={`${baseUrl}/cabinet/register?utm_source=SOURCE&utm_medium=MEDIUM&utm_campaign=CAMPAIGN`} description="Пример: utm_source=facebook" />
          <LinkRow title="Бот — кампания (шаблон)" href={`${botUrl}?start=c_источник_кампания`} description="start=c_facebook_winter" />
          <LinkRow title="Бот — реферал + кампания" href={`${botUrl}?start=ref_КОД_c_источник_кампания`} description="Реферал и метка кампании в одной ссылке" />
        </div>
      </SectionCard>

      <SectionCard title="Готовые ссылки с UTM" icon={Target} description="Скопируйте, при необходимости поменяйте кампанию" color="violet">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">Кабинет — регистрация</p>
        <div className="rounded-2xl border border-white/5 bg-foreground/[0.03] dark:bg-white/[0.02] px-4 mb-4">
          <LinkRow title="Facebook / Meta" href={`${baseUrl}/cabinet/register?utm_source=facebook&utm_medium=cpc&utm_campaign=winter`} description="utm_source=facebook" />
          <LinkRow title="VK Реклама" href={`${baseUrl}/cabinet/register?utm_source=vk&utm_medium=cpc&utm_campaign=winter`} description="utm_source=vk" />
          <LinkRow title="Instagram" href={`${baseUrl}/cabinet/register?utm_source=instagram&utm_medium=stories&utm_campaign=winter`} description="utm_source=instagram" />
          <LinkRow title="Email-рассылка" href={`${baseUrl}/cabinet/register?utm_source=email&utm_medium=newsletter&utm_campaign=winter`} description="utm_source=email" />
          <LinkRow title="Telegram-канал / пост" href={`${baseUrl}/cabinet/register?utm_source=telegram&utm_medium=channel&utm_campaign=winter`} description="utm_source=telegram" />
          <LinkRow title="Блогер / партнёр" href={`${baseUrl}/cabinet/register?utm_source=blogger&utm_medium=partner&utm_campaign=winter`} description="utm_source=blogger" />
        </div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">Бот — старт с меткой кампании</p>
        <div className="rounded-2xl border border-white/5 bg-foreground/[0.03] dark:bg-white/[0.02] px-4">
          <LinkRow title="Бот — Facebook" href={`${botUrl}?start=c_facebook_winter`} description="источник_кампания" />
          <LinkRow title="Бот — VK" href={`${botUrl}?start=c_vk_winter`} description="источник_кампания" />
          <LinkRow title="Бот — Instagram" href={`${botUrl}?start=c_instagram_winter`} description="источник_кампания" />
          <LinkRow title="Бот — Email" href={`${botUrl}?start=c_email_newsletter`} description="источник_кампания" />
          <LinkRow title="Бот — Telegram-канал" href={`${botUrl}?start=c_telegram_channel`} description="источник_кампания" />
        </div>
      </SectionCard>

      <SectionCard title="Отслеживание источников (UTM)" icon={Info} description="Как работает система UTM-меток" color="cyan">
        <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 backdrop-blur-md p-4 text-sm space-y-2">
          <p className="font-semibold flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
            <Info className="h-4 w-4" />
            Как это работает
          </p>
          <ul className="list-disc list-inside space-y-1.5 text-muted-foreground text-xs">
            <li><strong>Сайт:</strong> добавьте параметры <code className="bg-foreground/[0.06] dark:bg-white/[0.06] px-1.5 py-0.5 rounded font-mono">utm_source</code>, <code className="bg-foreground/[0.06] dark:bg-white/[0.06] px-1.5 py-0.5 rounded font-mono">utm_campaign</code> к ссылкам кабинета. При первом заходе они привязываются к аккаунту.</li>
            <li><strong>Бот:</strong> <code className="bg-foreground/[0.06] dark:bg-white/[0.06] px-1.5 py-0.5 rounded font-mono">t.me/бот?start=c_источник_кампания</code> (например <code className="bg-foreground/[0.06] dark:bg-white/[0.06] px-1.5 py-0.5 rounded font-mono">c_facebook_winter</code>). Можно с рефералом: <code className="bg-foreground/[0.06] dark:bg-white/[0.06] px-1.5 py-0.5 rounded font-mono">ref_КОД_c_источник_кампания</code>.</li>
            <li>Итоги — в блоке ниже и в разделе <strong>Аналитика</strong>.</li>
          </ul>
        </div>
      </SectionCard>

      <SectionCard title="Аналитика по источникам" icon={TrendingUp} description="Регистрации, триалы, платежи и доход за 90 дней" color="emerald">
        {analyticsLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span>Загрузка…</span>
          </div>
        ) : !campaignsStats?.length ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            Нет данных. Используйте ссылки с UTM или бот с <code className="bg-foreground/[0.06] dark:bg-white/[0.06] px-1.5 py-0.5 rounded font-mono">start=c_источник_кампания</code>.
          </p>
        ) : (
          <div className="rounded-2xl border border-white/5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-foreground/[0.04] dark:bg-white/[0.03] border-b border-white/5">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Источник</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Кампания</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Регистрации</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Триалы</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Платежи</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Доход</th>
                  </tr>
                </thead>
                <tbody>
                  {campaignsStats.map((row, i) => (
                    <tr key={i} className="border-b border-white/5 last:border-0 hover:bg-foreground/[0.03] dark:hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 font-medium">{row.source}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.campaign ?? "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt(row.registrations)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt(row.trials)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt(row.payments)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-500 dark:text-emerald-400">{fmtDec(row.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Google Analytics 4" icon={BarChart3} description="Measurement ID для веб-кабинета" color="amber">
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ga-id" className="text-xs text-muted-foreground">Measurement ID (G-XXXXXXXXXX)</Label>
              <Input
                id="ga-id"
                placeholder="G-XXXXXXXXXX"
                value={gaId}
                onChange={(e) => setGaId(e.target.value)}
                className="font-mono rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
              />
              <p className="text-[11px] text-muted-foreground">Настройка → Данные → Потоки данных → Веб</p>
            </div>
            <Button onClick={saveAnalyticsIds} disabled={saving} className="rounded-xl">
              {saving ? "Сохранение…" : "Сохранить"}
            </Button>
          </div>
        </SectionCard>

        <SectionCard title="Яндекс.Метрика" icon={BarChart3} description="Номер счётчика" color="amber">
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ym-id" className="text-xs text-muted-foreground">Номер счётчика</Label>
              <Input
                id="ym-id"
                type="text"
                inputMode="numeric"
                placeholder="12345678"
                value={ymId}
                onChange={(e) => setYmId(e.target.value)}
                className="font-mono rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
              />
              <p className="text-[11px] text-muted-foreground">
                Создайте в <a href="https://metrika.yandex.ru" target="_blank" rel="noopener noreferrer" className="text-primary underline">Яндекс.Метрике</a> и скопируйте номер.
              </p>
            </div>
            <Button onClick={saveAnalyticsIds} disabled={saving} className="rounded-xl">
              {saving ? "Сохранение…" : "Сохранить"}
            </Button>
          </div>
        </SectionCard>
      </div>

      {message && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "rounded-2xl border backdrop-blur-md px-4 py-3 text-sm",
            message.startsWith("Ошибка")
              ? "border-red-500/30 bg-red-500/10 text-red-500 dark:text-red-400"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400"
          )}
        >
          {message}
        </motion.div>
      )}
    </div>
  );
}
