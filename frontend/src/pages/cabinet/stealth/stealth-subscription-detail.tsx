/**
 * Stealth Subscription Detail — страница конкретной подписки.
 *
 * Открывается по зелёной кнопке «Подключить» с карточки подписки на дашборде:
 *   /cabinet/subscription/:subId
 *
 * Показывает:
 *   - название/эмодзи тарифа, статус и срок действия;
 *   - что входит в подписку (устройства, трафик);
 *   - статистику использования трафика (прогресс-бар);
 *   - количество подключённых устройств;
 *   - ссылку на подписку с копированием;
 *   - зелёную кнопку «Подключить устройство» → пошаговый wizard
 *     (/cabinet/subscribe?sub=:subId).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Wifi, Copy, Check, Clock, Calendar, Smartphone, Gauge, ArrowLeft, Loader2, ChevronDown, Trash2, Zap } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import type { ClientDeviceItem } from "@/lib/api";
import { StadiumButton } from "@/components/stealth/stadium-button";
import { cn } from "@/lib/utils";

/** Unwrap Remnawave-обёртки (.response / .data.response) до плоского payload. */
function unwrapSubPayload(sub: unknown): Record<string, unknown> | null {
  if (!sub || typeof sub !== "object") return null;
  const o = sub as Record<string, unknown>;
  if (o.response && typeof o.response === "object") return o.response as Record<string, unknown>;
  if (o.data && typeof o.data === "object") {
    const d = o.data as Record<string, unknown>;
    if (d.response && typeof d.response === "object") return d.response as Record<string, unknown>;
  }
  return o;
}

function getSubscriptionUrl(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const url = (payload.subscriptionUrl ?? payload.subscription_url) as string | undefined;
  return typeof url === "string" && url.length > 0 ? url : null;
}

/** Достаёт число из возможных мест payload (прямо или в userTraffic). */
function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return 0;
}

function getTrafficUsed(payload: Record<string, unknown> | null): number {
  if (!payload) return 0;
  const ut = payload.userTraffic as Record<string, unknown> | undefined;
  return num(payload.usedTrafficBytes) || num(ut?.usedTrafficBytes) || num(payload.trafficUsedBytes);
}

function getTrafficLimit(payload: Record<string, unknown> | null): number {
  if (!payload) return 0;
  return num(payload.trafficLimitBytes);
}

function fmtBytes(bytes: number): string {
  if (bytes <= 0) return "0 ГБ";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} ГБ`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(0)} МБ`;
}

function fmtDate(d: Date | null): string {
  if (!d || Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

/** Склонение слова «день» по числу: 1 день, 2 дня, 5 дней. */
function pluralDays(n: number): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "дня";
  return "дней";
}

type SubInfo = {
  id: string;
  label: string;
  emoji: string | null;
  url: string | null;
  startAt: Date | null;
  expireAt: Date | null;
  isActive: boolean;
  isTrial: boolean;
  trialConvertEnabled: boolean;
  trafficUsed: number;
  trafficLimit: number;
  extraDevices: number;
  deviceLimit: number;
};

export function StealthSubscriptionDetail() {
  const navigate = useNavigate();
  const { subId } = useParams<{ subId: string }>();
  const { state } = useClientAuth();

  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState<SubInfo | null>(null);
  // Устройства, подключённые именно к ЭТОЙ подписке (отфильтровано по subscriptionId).
  const [devices, setDevices] = useState<ClientDeviceItem[]>([]);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [deletingHwid, setDeletingHwid] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!state.token || !subId) return;
    let alive = true;
    setLoading(true);
    Promise.all([
      api.clientAllSubscriptions(state.token).catch(() => ({ items: [] as never[] })),
      api.getMyAllDevices(state.token).catch(() => ({ total: 0, items: [] as ClientDeviceItem[] })),
    ]).then(([all, devs]) => {
      if (!alive) return;
      const it = (all.items ?? []).find((s) => s.id === subId);
      if (it) {
        const payload = unwrapSubPayload(it.subscription);
        const expireAt = typeof payload?.expireAt === "string" ? new Date(payload.expireAt as string) : null;
        const startRaw = (payload?.createdAt ?? payload?.subscriptionCreatedAt) as string | undefined;
        const startAt = typeof startRaw === "string" ? new Date(startRaw) : null;
        setSub({
          id: it.id,
          label: it.tariffDisplayName?.trim() || `Подписка #${it.subscriptionIndex ?? 0}`,
          emoji: it.tariffMenuEmoji ?? null,
          url: getSubscriptionUrl(payload),
          startAt: startAt && !Number.isNaN(startAt.getTime()) ? startAt : null,
          expireAt,
          isActive: !!expireAt && !Number.isNaN(expireAt.getTime()) && expireAt.getTime() > Date.now(),
          isTrial: Boolean(it.trialId),
          trialConvertEnabled: it.trialConvertEnabled ?? true,
          trafficUsed: getTrafficUsed(payload),
          trafficLimit: getTrafficLimit(payload),
          extraDevices: it.extraDevices ?? 0,
          deviceLimit: num(payload?.hwidDeviceLimit),
        });
      } else {
        setSub(null);
      }
      // Только устройства ЭТОЙ подписки.
      setDevices((devs.items ?? []).filter((d) => d.subscriptionId === subId));
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [state.token, subId]);

  // Удаление устройства этой подписки.
  async function removeDevice(d: ClientDeviceItem) {
    if (!state.token || deletingHwid) return;
    setDeletingHwid(d.hwid);
    try {
      await api.deleteClientDevice(state.token, d.hwid, { type: d.subscriptionType, id: d.subscriptionId });
      setDevices((arr) => arr.filter((x) => x.hwid !== d.hwid));
    } catch {
      /* тихо: устройство могло быть уже удалено */
    } finally {
      setDeletingHwid(null);
    }
  }

  const daysLeft = useMemo(() => {
    if (!sub?.expireAt) return null;
    const ms = sub.expireAt.getTime() - Date.now();
    return ms > 0 ? Math.ceil(ms / (1000 * 60 * 60 * 24)) : 0;
  }, [sub]);

  const trafficPct = useMemo(() => {
    if (!sub || sub.trafficLimit <= 0) return null; // безлимит
    return Math.min(100, Math.round((sub.trafficUsed / sub.trafficLimit) * 100));
  }, [sub]);

  function copyUrl() {
    if (!sub?.url) return;
    navigator.clipboard.writeText(sub.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!sub) {
    return (
      <div className="px-4 pt-2 space-y-4 pb-4">
        <button onClick={() => navigate("/cabinet/dashboard")} className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
          <ArrowLeft className="h-4 w-4" /> Назад
        </button>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.07] p-4 text-sm text-amber-500/90">
          Подписка не найдена. Возможно, она была удалена.
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-2 space-y-4 pb-6">
      {/* Назад */}
      <button onClick={() => navigate("/cabinet/dashboard")} className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
        <ArrowLeft className="h-4 w-4" /> Назад
      </button>

      {/* Заголовок подписки */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold text-zinc-100 truncate">
          {sub.emoji ? `${sub.emoji} ` : ""}{sub.label}
        </h1>
        {sub.isActive ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] px-2 py-1 text-[11px] tabular-nums shrink-0">
            <Clock className="h-3 w-3 text-emerald-400" strokeWidth={2.2} />
            {daysLeft} дн.
          </span>
        ) : (
          <span className="shrink-0 rounded-lg bg-zinc-800/80 border border-white/[0.05] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            истекла
          </span>
        )}
      </div>

      {/* Что входит в подписку */}
      <div className="rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-4 space-y-3">
        <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-zinc-500">Что входит</p>

        {/* Период действия — во всю ширину */}
        <div className="rounded-xl border border-white/[0.06] bg-zinc-950/40 p-3">
          <div className="flex items-center gap-1.5 text-zinc-400 text-[11px]">
            <Calendar className="h-3.5 w-3.5 text-blue-400" /> Период действия
          </div>
          <p className="mt-1 text-sm font-bold text-zinc-100 tabular-nums">
            {sub.startAt ? `${fmtDate(sub.startAt)} — ${fmtDate(sub.expireAt)}` : `до ${fmtDate(sub.expireAt)}`}
          </p>
          <p className={cn("mt-0.5 text-xs font-semibold", sub.isActive ? "text-emerald-400" : "text-zinc-500")}>
            {sub.isActive ? `Осталось ${daysLeft} ${pluralDays(daysLeft ?? 0)}` : "Подписка истекла"}
          </p>
        </div>

        {/* Доступно устройств (подключено / всего) */}
        <div className="rounded-xl border border-white/[0.06] bg-zinc-950/40 p-3">
          <div className="flex items-center gap-1.5 text-zinc-400 text-[11px]">
            <Smartphone className="h-3.5 w-3.5 text-blue-400" /> Доступно устройств
          </div>
          <p className="mt-1 text-sm font-bold text-zinc-100 tabular-nums">
            {devices.length}{sub.deviceLimit > 0 ? `/${sub.deviceLimit}` : ""}
            {sub.extraDevices > 0 ? <span className="text-zinc-400 font-medium"> (+{sub.extraDevices} доп.)</span> : null}
          </p>
        </div>

        {/* Трафик */}
        <div className="rounded-xl border border-white/[0.06] bg-zinc-950/40 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-zinc-400 text-[11px]">
              <Gauge className="h-3.5 w-3.5 text-blue-400" /> Трафик
            </div>
            <p className="text-xs font-bold tabular-nums text-zinc-200">
              {fmtBytes(sub.trafficUsed)}{sub.trafficLimit > 0 ? ` / ${fmtBytes(sub.trafficLimit)}` : " · безлимит"}
            </p>
          </div>
          {trafficPct !== null && (
            <div className="mt-2 h-2 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  trafficPct >= 90 ? "bg-red-500" : trafficPct >= 70 ? "bg-amber-500" : "bg-emerald-500",
                )}
                style={{ width: `${trafficPct}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Подключённые устройства — раскрывающийся список с удалением */}
      <div className="rounded-2xl border border-white/[0.08] bg-zinc-900/40 overflow-hidden">
        <button
          type="button"
          onClick={() => setDevicesOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 p-4 text-left hover:bg-white/[0.02] transition-colors"
        >
          <span className="flex items-center gap-2 text-[10px] font-bold tracking-[0.18em] uppercase text-zinc-500">
            <Smartphone className="h-3.5 w-3.5 text-blue-400" />
            Управление устройствами
            <span className="rounded-full bg-white/[0.06] border border-white/10 px-1.5 py-0.5 text-[10px] tabular-nums text-zinc-300 normal-case tracking-normal">
              {devices.length}
            </span>
          </span>
          <ChevronDown className={cn("h-4 w-4 text-zinc-400 transition-transform", devicesOpen && "rotate-180")} />
        </button>
        {devicesOpen && (
          <div className="px-4 pb-4 space-y-2">
            {devices.length === 0 ? (
              <p className="text-xs text-zinc-500 text-center py-2">
                Нет подключённых устройств. Нажмите «Подключить устройство» ниже.
              </p>
            ) : (
              devices.map((d) => (
                <div key={d.hwid} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-zinc-950/40 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-100 truncate">
                      {d.deviceModel || d.platform || "Устройство"}
                    </p>
                    <p className="text-[11px] text-zinc-500 truncate">
                      {d.appName ? `${d.appName} · ` : ""}{d.hwid.slice(0, 12)}…
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={deletingHwid !== null}
                    onClick={() => removeDevice(d)}
                    className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-lg border border-red-500/25 bg-red-500/10 text-red-400 hover:bg-red-500/20 active:scale-95 transition disabled:opacity-50"
                    aria-label="Удалить устройство"
                  >
                    {deletingHwid === d.hwid ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Ссылка на подписку */}
      <div className="rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-4 space-y-3">
        <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-zinc-500">Ссылка на подписку</p>
        <div className="rounded-xl border border-white/[0.06] bg-zinc-950/60 p-3">
          <p className="font-mono text-xs text-zinc-200 break-all">{sub.url ?? "Ссылка недоступна"}</p>
        </div>
        <StadiumButton
          variant="ghost" size="md"
          iconLeft={copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          onClick={copyUrl}
          disabled={!sub.url}
        >
          {copied ? "Скопировано" : "Скопировать ссылку"}
        </StadiumButton>
      </div>

      {/* Зелёная кнопка «Подключить устройство» → пошаговый wizard */}
      <button
        onClick={() => navigate(`/cabinet/subscribe?sub=${encodeURIComponent(sub.id)}`)}
        className="w-full justify-center rounded-2xl bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 border border-emerald-400/40 px-3 py-3.5 text-base font-bold text-white shadow-[0_0_28px_-6px_rgba(16,185,129,0.8),inset_0_1px_0_rgba(255,255,255,0.25)] active:scale-95 transition-all duration-300 inline-flex items-center gap-2"
      >
        <Wifi className="h-5 w-5 shrink-0" />
        Подключить устройство
      </button>

      {/* Дублируем «Продлить» (триал → каталог, обычная → диалог продления). */}
      {(!sub.isTrial || sub.trialConvertEnabled) && (
        <button
          onClick={() => {
            if (sub.isTrial) navigate(`/cabinet/tariffs?extend=${encodeURIComponent(sub.id)}`);
            else navigate(`/cabinet/extend/${encodeURIComponent(sub.id)}`);
          }}
          className="w-full justify-center rounded-2xl bg-gradient-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 border border-red-400/40 px-3 py-3.5 text-base font-bold text-white shadow-[0_0_28px_-6px_rgba(239,68,68,0.8),inset_0_1px_0_rgba(255,255,255,0.25)] active:scale-95 transition-all duration-300 inline-flex items-center gap-2"
        >
          <Zap className="h-5 w-5 shrink-0" />
          {sub.isTrial ? "Купить подписку" : "Продлить"}
        </button>
      )}
    </div>
  );
}
