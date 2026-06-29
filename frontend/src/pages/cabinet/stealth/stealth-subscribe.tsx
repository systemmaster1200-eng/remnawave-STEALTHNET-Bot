/**
 * Stealth Subscribe — wizard «Установить и настроить VPN» в 3 шага.
 * Работает с реальной структурой SubscriptionPageConfig:
 *   platforms.{ios|android|macos|windows|linux}.apps[].blocks[].buttons[]
 *
 * Кнопки бывают двух типов:
 *   - external — установка приложения (App Store / Google Play / GitHub)
 *   - subscriptionLink — deeplink с {{SUBSCRIPTION_LINK}} placeholder
 *
 * Для deeplink используется тот же hop-страница `/api/public/deeplink?url=...`,
 * что в classic-варианте — корректно работает в Telegram Mini App через
 * `Telegram.WebApp.openLink` (иначе кастомные схемы заблокированы).
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Laptop, Download, Key, Copy, Check, ArrowRight, Smartphone, MonitorSmartphone, Apple, Tv, ExternalLink, Plus } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type SubscriptionPageConfig } from "@/lib/api";
import { ConcentricRings } from "@/components/stealth/concentric-rings";
import { WizardHeader } from "@/components/stealth/wizard-header";
import { StadiumButton } from "@/components/stealth/stadium-button";
import { cn } from "@/lib/utils";

// Платформы — strict lowercase для соответствия конфигу
type Platform = "windows" | "macos" | "android" | "ios" | "linux";

const PLATFORM_LABELS: Record<Platform, string> = {
  windows: "Windows", macos: "macOS", android: "Android", ios: "iOS", linux: "Linux",
};

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "windows";
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  if (/mac/.test(ua)) return "macos";
  if (/win/.test(ua)) return "windows";
  if (/linux/.test(ua)) return "linux";
  return "windows";
}

function platformIcon(p: Platform) {
  switch (p) {
    case "macos": return Laptop;
    case "windows": return MonitorSmartphone;
    case "android": return Smartphone;
    case "ios": return Apple;
    case "linux": return Tv;
  }
}

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

function getSubscriptionUrl(sub: unknown): string | null {
  if (!sub || typeof sub !== "object") return null;
  // Unwrap Remnawave .response wrapper
  const o = sub as Record<string, unknown>;
  let payload: Record<string, unknown> = o;
  if (o.response && typeof o.response === "object") payload = o.response as Record<string, unknown>;
  else if (o.data && typeof o.data === "object") {
    const d = o.data as Record<string, unknown>;
    if (d.response && typeof d.response === "object") payload = d.response as Record<string, unknown>;
  }
  const url = (payload.subscriptionUrl ?? payload.subscription_url) as string | undefined;
  return typeof url === "string" && url.length > 0 ? url : null;
}

interface AppButton {
  link?: string;
  text?: { ru?: string; en?: string };
  type?: "external" | "subscriptionLink";
}
interface AppBlock {
  title?: { ru?: string; en?: string };
  description?: { ru?: string; en?: string };
  buttons?: AppButton[];
}
interface AppEntry {
  name: string;
  isFeatured?: boolean;
  blocks?: AppBlock[];
}

function getText(t: { ru?: string; en?: string } | undefined, lang: string): string {
  if (!t) return "";
  return (lang === "en" ? t.en : t.ru) ?? t.ru ?? t.en ?? "";
}

/** Собираем кнопки конкретного типа из всех блоков приложения. */
function collectButtons(app: AppEntry | undefined, type: "external" | "subscriptionLink"): { btn: AppButton; blockTitle?: string }[] {
  if (!app?.blocks) return [];
  const out: { btn: AppButton; blockTitle?: string }[] = [];
  for (const b of app.blocks) {
    for (const btn of b.buttons ?? []) {
      if (btn.type === type) out.push({ btn, blockTitle: getText(b.title, "ru") });
    }
  }
  return out;
}

/** Билдим URL для deeplink-кнопки через hop /api/public/deeplink. */
function buildDeeplinkHref(rawLink: string, subUrl: string, baseUrl: string, isMiniapp: boolean): string {
  const filled = rawLink.replace(/\{\{SUBSCRIPTION_LINK\}\}/g, subUrl).replace(/\{\{USERNAME\}\}/g, "");
  if (!baseUrl) return filled;
  const skipAuto = isMiniapp ? "&skip_auto=1" : "";
  return `${baseUrl}/api/public/deeplink?url=${encodeURIComponent(filled)}${skipAuto}`;
}

export function StealthSubscribe() {
  const { state } = useClientAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [step, setStep] = useState(1);
  const [platform, setPlatform] = useState<Platform>(() => detectPlatform());
  const [showOtherDevices, setShowOtherDevices] = useState(false);
  const [selectedAppIdx, setSelectedAppIdx] = useState(0);
  const [copied, setCopied] = useState(false);

  // мультиподписки. Грузим ВСЕ подписки клиента (единый код
  // для любой — без спецслучаев на «нулевую») и даём выбрать, какую настраивать.
  // ?sub=<id> (с дашборда) — предвыбор конкретной подписки.
  const [subsList, setSubsList] = useState<{ id: string; label: string; emoji: string | null; url: string | null; isActive: boolean }[]>([]);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  const [pageConfig, setPageConfig] = useState<SubscriptionPageConfig | null>(null);
  const [publicAppUrl, setPublicAppUrl] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const subUrl = useMemo(
    () => subsList.find((s) => s.id === selectedSubId)?.url ?? null,
    [subsList, selectedSubId],
  );

  // Если пришли с дашборда по «Подключить» (?sub=<id>) и эта подписка существует —
  // подписка зафиксирована: селектор «какую подписку настроить» не показываем.
  const lockedSub = useMemo(() => {
    const requested = searchParams.get("sub");
    return Boolean(requested && subsList.some((s) => s.id === requested));
  }, [searchParams, subsList]);

  const isMiniapp = useMemo(() => {
    if (typeof window === "undefined") return false;
    const tg = (window as unknown as { Telegram?: { WebApp?: unknown } }).Telegram?.WebApp;
    return !!tg;
  }, []);

  useEffect(() => {
    if (!state.token) return;
    let alive = true;
    setLoading(true);
    Promise.all([
      api.clientAllSubscriptions(state.token).catch((): { items: [] } => ({ items: [] })),
      api.getPublicSubscriptionPageConfig().catch(() => null),
      api.getPublicConfig().catch(() => null),
    ]).then(([all, cfg, pub]) => {
      if (!alive) return;
      const list = (all.items ?? []).map((it) => {
        const raw = unwrapSubPayload(it.subscription);
        const expireAt = typeof raw?.expireAt === "string" ? new Date(raw.expireAt as string) : null;
        const idx = it.subscriptionIndex ?? 0;
        return {
          id: it.id,
          label: it.tariffDisplayName?.trim() || `Подписка #${idx}`,
          emoji: it.tariffMenuEmoji ?? null,
          url: getSubscriptionUrl(it.subscription),
          isActive: !!expireAt && !Number.isNaN(expireAt.getTime()) && expireAt.getTime() > Date.now(),
        };
      }).filter((s) => s.url);
      setSubsList(list);
      // Предвыбор: ?sub из URL → первая активная → первая.
      const requested = searchParams.get("sub");
      const preselect = (requested && list.find((s) => s.id === requested))
        || list.find((s) => s.isActive)
        || list[0]
        || null;
      setSelectedSubId(preselect?.id ?? null);
      setPageConfig(cfg);
      const u = (pub as { publicAppUrl?: string | null } | null)?.publicAppUrl ?? "";
      setPublicAppUrl(u || (typeof window !== "undefined" ? window.location.origin : ""));
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.token]);

  const apps: AppEntry[] = useMemo(() => {
    const platformsObj = (pageConfig as unknown as { platforms?: Record<string, { apps?: AppEntry[] }> })?.platforms ?? {};
    return platformsObj[platform]?.apps ?? [];
  }, [pageConfig, platform]);

  const currentApp = apps[selectedAppIdx];
  const featuredIdx = apps.findIndex((a) => a.isFeatured);

  // Если apps[selectedAppIdx] нет (после смены платформы) — сбрасываем
  useEffect(() => {
    if (apps.length > 0 && selectedAppIdx >= apps.length) {
      setSelectedAppIdx(featuredIdx >= 0 ? featuredIdx : 0);
    }
  }, [apps, selectedAppIdx, featuredIdx]);

  // initial — выбираем featured если есть
  useEffect(() => {
    if (apps.length > 0 && featuredIdx >= 0 && selectedAppIdx === 0) {
      setSelectedAppIdx(featuredIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps.length]);

  function copyUrl() {
    if (!subUrl) return;
    navigator.clipboard.writeText(subUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function openDeeplink(href: string) {
    if (typeof window === "undefined") return;
    if (subUrl) { try { navigator.clipboard?.writeText(subUrl); } catch { /* ignore */ } }
    const tg = (window as unknown as { Telegram?: { WebApp?: { openLink?: (u: string, opts?: { try_instant_view?: boolean }) => void } } }).Telegram?.WebApp;
    if (isMiniapp && tg?.openLink && href.startsWith("http")) {
      tg.openLink(href, { try_instant_view: false });
    } else {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  }

  function openExternal(rawLink: string) {
    // external buttons обычно ведут в App Store/Google Play/GitHub — обычная http-ссылка
    if (typeof window === "undefined") return;
    const tg = (window as unknown as { Telegram?: { WebApp?: { openLink?: (u: string) => void } } }).Telegram?.WebApp;
    if (isMiniapp && tg?.openLink) tg.openLink(rawLink);
    else window.open(rawLink, "_blank", "noopener,noreferrer");
  }

  const PlatformIcon = platformIcon(platform);

  const externalBtns = useMemo(() => collectButtons(currentApp, "external"), [currentApp]);
  const subscriptionBtns = useMemo(() => collectButtons(currentApp, "subscriptionLink"), [currentApp]);

  return (
    <div className="px-4 pt-2 space-y-5 pb-2">
      <WizardHeader
        step={step}
        totalSteps={3}
        onBack={step > 1 ? () => setStep(step - 1) : undefined}
        onClose={() => navigate("/cabinet/dashboard")}
      />

      <AnimatePresence mode="wait">
      {/* Step 1: choose client */}
      {step === 1 && (
        <motion.div
          key="step-1"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="space-y-5"
        >
          <div className="pt-4">
            <ConcentricRings icon={PlatformIcon} />
          </div>

          <div className="text-center space-y-1.5">
            <h2 className="text-2xl font-bold">Настройка на {PLATFORM_LABELS[platform]}</h2>
            <p className="text-sm text-zinc-400">3 шага для завершения настройки</p>
          </div>

          {/* выбор подписки (если их несколько) — какую настраиваем.
              Скрыт, если подписка зафиксирована переходом с дашборда (?sub=). */}
          {subsList.length > 1 && !lockedSub && (
            <div className="space-y-2.5">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 text-center">Какую подписку настроить</p>
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                {subsList.map((s) => {
                  const active = s.id === selectedSubId;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedSubId(s.id)}
                      className={cn(
                        "shrink-0 rounded-2xl border px-3.5 py-2 text-xs font-bold transition-all inline-flex items-center gap-2",
                        active
                          ? "border-blue-500 bg-blue-500/[0.1] text-white shadow-[0_0_20px_-6px_rgba(47,107,255,0.5)]"
                          : "border-white/[0.08] bg-zinc-900/60 text-zinc-400 hover:border-white/20",
                      )}
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full", s.isActive ? "bg-emerald-400" : "bg-zinc-600")} />
                      {s.emoji ? `${s.emoji} ` : ""}{s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-2.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 text-center">Выберите клиент</p>
            {apps.length === 0 ? (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-center text-xs text-amber-200">
                Для платформы «{PLATFORM_LABELS[platform]}» приложения не настроены.
                Выберите другую платформу ниже.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {apps.map((app, idx) => {
                  const active = idx === selectedAppIdx;
                  const isFeatured = idx === featuredIdx || app.isFeatured;
                  return (
                    <motion.button
                      key={`${app.name}-${idx}`}
                      type="button"
                      onClick={() => setSelectedAppIdx(idx)}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0, scale: active ? 1.02 : 1 }}
                      whileHover={{ scale: 1.035 }}
                      whileTap={{ scale: 0.97 }}
                      transition={{
                        opacity: { duration: 0.3, delay: idx * 0.05, ease: "easeOut" },
                        y: { duration: 0.3, delay: idx * 0.05, ease: "easeOut" },
                        scale: { duration: 0.2, ease: "easeOut" },
                      }}
                      className={cn(
                        "relative rounded-2xl border-2 bg-white/[0.03] backdrop-blur-xl p-3.5 text-left transition-colors duration-300",
                        // Активный (не featured) → ярко-розовый акцент
                        active && !isFeatured && "border-blue-500 bg-blue-500/[0.08] shadow-[0_0_32px_-4px_rgba(47,107,255,0.5),inset_0_1px_0_rgba(255,255,255,0.08)]",
                        // Активный + featured → фиолетовый акцент
                        active && isFeatured && "border-violet-500 bg-violet-500/[0.1] shadow-[0_0_32px_-4px_rgba(167,139,250,0.55),inset_0_1px_0_rgba(255,255,255,0.08)]",
                        // Не активный
                        !active && "border-white/[0.06] hover:border-white/20 hover:bg-white/[0.05]",
                      )}
                    >
                      {/* Featured chip — над карточкой */}
                      {isFeatured && (
                        <span className="absolute -top-2.5 left-3 rounded-full bg-violet-500 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white shadow-[0_4px_12px_-4px_rgba(167,139,250,0.6)]">
                          Рекомендуется
                        </span>
                      )}

                      {/* Чекмарк в правом верхнем углу выбранной карточки */}
                      {active && (
                        <span className={cn(
                          "absolute top-2 right-2 h-5 w-5 rounded-full flex items-center justify-center shadow-[0_2px_8px_rgba(0,0,0,0.4)]",
                          isFeatured ? "bg-violet-500" : "bg-blue-500",
                        )}>
                          <Check className="h-3 w-3 text-white" strokeWidth={3} />
                        </span>
                      )}

                      <div className="flex items-center gap-2.5">
                        <div className={cn(
                          "h-9 w-9 rounded-lg border flex items-center justify-center font-bold text-sm transition-colors",
                          active && isFeatured && "bg-violet-500/25 border-violet-500/50 text-violet-200",
                          active && !isFeatured && "bg-blue-500/25 border-blue-500/50 text-blue-200",
                          !active && isFeatured && "bg-violet-500/10 border-violet-500/25 text-violet-300/70",
                          !active && !isFeatured && "bg-zinc-800/80 border-white/10 text-zinc-400",
                        )}>
                          {app.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={cn(
                            "font-semibold text-sm truncate transition-colors",
                            active && "text-white",
                            !active && "text-zinc-200",
                          )}>
                            {app.name}
                          </div>
                          <div className={cn(
                            "text-[10px] truncate transition-colors",
                            active && isFeatured && "text-violet-300/90",
                            active && !isFeatured && "text-blue-300/90",
                            !active && "text-zinc-500",
                          )}>
                            {active ? "Выбрано" : isFeatured ? "VPN Client" : "Альтернативный клиент"}
                          </div>
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-2 space-y-2.5">
            <StadiumButton
              variant="primary"
              size="md"
              iconLeft={<ArrowRight className="h-4 w-4" />}
              onClick={() => setStep(2)}
              disabled={!currentApp || loading}
            >
              Начать настройку
            </StadiumButton>
            <StadiumButton
              variant="outline"
              size="md"
              iconLeft={<MonitorSmartphone className="h-4 w-4" />}
              onClick={() => setShowOtherDevices((v) => !v)}
            >
              Другое устройство
            </StadiumButton>

            <AnimatePresence>
            {showOtherDevices && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-xl p-3 space-y-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
              >
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Выберите устройство</p>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => {
                    const active = p === platform;
                    return (
                      <button
                        key={p}
                        onClick={() => { setPlatform(p); setSelectedAppIdx(0); setShowOtherDevices(false); }}
                        className={cn(
                          "rounded-xl border bg-zinc-900/40 px-3 py-2.5 text-sm transition-all",
                          active ? "border-white/40 bg-white/[0.08]" : "border-white/[0.06] hover:border-white/20",
                        )}
                      >
                        {PLATFORM_LABELS[p]}
                      </button>
                    );
                  })}
                </div>

                {subUrl && (
                  <>
                    <div className="rounded-xl border border-white/[0.06] bg-zinc-950/60 p-3 mt-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1.5">Subscription URL</p>
                      <p className="font-mono text-[11px] text-zinc-200 break-all">{subUrl}</p>
                    </div>
                    <StadiumButton variant="outline" size="md" iconLeft={<Copy className="h-4 w-4" />} onClick={copyUrl}>
                      {copied ? "Скопировано" : "Скопировать ссылку с ключом"}
                    </StadiumButton>
                  </>
                )}
              </motion.div>
            )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}

      {/* Step 2: install client */}
      {step === 2 && (
        <motion.div
          key="step-2"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="space-y-5"
        >
          <div className="pt-4"><ConcentricRings icon={Download} /></div>

          <div className="text-center space-y-1.5">
            <h2 className="text-2xl font-bold">Установка {currentApp?.name ?? "клиента"}</h2>
            <p className="text-sm text-zinc-400 px-2">
              Установите приложение клиента на устройство — кнопки ниже откроют соответствующие магазины приложений.
            </p>
          </div>

          {externalBtns.length === 0 ? (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-center text-xs text-amber-200">
              Ссылки на установку для этого приложения не настроены.
            </div>
          ) : (
            <div className="space-y-2.5">
              {externalBtns.map(({ btn }, i) => (
                <StadiumButton
                  key={i}
                  variant="outline"
                  size="md"
                  iconLeft={<ExternalLink className="h-4 w-4" />}
                  onClick={() => btn.link && openExternal(btn.link)}
                >
                  {getText(btn.text, "ru") || "Установить клиент"}
                </StadiumButton>
              ))}
            </div>
          )}

          <div className="pt-1">
            <StadiumButton variant="primary" size="md" iconLeft={<ArrowRight className="h-4 w-4" />} onClick={() => setStep(3)}>
              Далее
            </StadiumButton>
          </div>
        </motion.div>
      )}

      {/* Step 3: add subscription */}
      {step === 3 && (
        <motion.div
          key="step-3"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="space-y-5"
        >
          <div className="pt-4"><ConcentricRings icon={Key} /></div>

          <div className="text-center space-y-1.5">
            <h2 className="text-2xl font-bold">Добавление подписки</h2>
            <p className="text-sm text-zinc-400 px-2">
              Откройте deeplink ниже — приложение {currentApp?.name ?? "клиент"} автоматически добавит подписку.
            </p>
          </div>

          <div className="relative rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-xl p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] overflow-hidden">
            <div className="absolute -top-10 -right-10 h-24 w-24 rounded-full bg-blue-500/10 blur-2xl pointer-events-none" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Subscription URL</p>
            <p className="relative font-mono text-xs text-zinc-200 break-all">{subUrl ?? "—"}</p>
          </div>

          <div className="space-y-2.5">
            {subscriptionBtns.length > 0 && subUrl ? (
              subscriptionBtns.map(({ btn }, i) => (
                <StadiumButton
                  key={i}
                  variant="primary"
                  size="md"
                  iconLeft={<Plus className="h-4 w-4" />}
                  onClick={() => {
                    if (!btn.link) return;
                    openDeeplink(buildDeeplinkHref(btn.link, subUrl, publicAppUrl, isMiniapp));
                  }}
                >
                  {getText(btn.text, "ru") || `Открыть в ${currentApp?.name}`}
                </StadiumButton>
              ))
            ) : (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-center text-xs text-amber-200">
                Deeplink для добавления подписки не настроен — добавьте ссылку вручную в приложении.
              </div>
            )}

            <StadiumButton variant="outline" size="md" iconLeft={copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />} onClick={copyUrl} disabled={!subUrl}>
              {copied ? "Скопировано" : "Скопировать ссылку с ключом"}
            </StadiumButton>

            <StadiumButton variant="ghost" size="md" iconLeft={<ArrowRight className="h-4 w-4" />} onClick={() => navigate("/cabinet/dashboard")}>
              Завершить
            </StadiumButton>
          </div>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}
