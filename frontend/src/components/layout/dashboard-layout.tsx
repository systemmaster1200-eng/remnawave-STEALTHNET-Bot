import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, LayoutDashboard, Users, CreditCard, Settings, LogOut, KeyRound,
  Megaphone, Tag, BarChart3, FileText, ExternalLink, Sun, Moon, Monitor,
  Palette, Menu, X, Database, Target, UserCog, Send, CalendarClock, Globe, Server, MessageSquare, Trophy,
  Network, ShieldAlert, Key, Map, Video, Languages, Gift, Sparkles, Rocket, Bot,
  ChevronRight, Check, ShoppingBag,
  Activity, Inbox, ClipboardList, TrendingUp, Mail,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAdminLanguageSync } from "@/i18n/use-language-sync";
import { useAuth } from "@/contexts/auth";
import { useTheme, ACCENT_PALETTES, type ThemeMode, type ThemeAccent } from "@/contexts/theme";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api, type AdminNotificationCounters } from "@/lib/api";
import { InboxBell } from "@/components/inbox-bell";

const PANEL_VERSION = "4.2.1";
const GITHUB_URL = "https://github.com/systemmaster1200-eng/remnawave-STEALTHNET-Bot";

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; section: string; category: string };

const CATEGORY_ORDER = ["overview", "management", "subscription", "tools", "settings"];

const CATEGORY_I18N: Record<string, string> = {
  overview: "admin.nav.category_overview",
  management: "admin.nav.category_management",
  subscription: "admin.nav.category_subscription",
  tools: "admin.nav.category_tools",
  settings: "admin.nav.category_settings",
};

function useNavSections(): NavItem[] {
  const { t } = useTranslation();
  return [
    { to: "/admin", label: t("admin.nav.dashboard"), icon: LayoutDashboard, section: "dashboard", category: "overview" },
    { to: "/admin/analytics", label: t("admin.nav.analytics"), icon: BarChart3, section: "analytics", category: "overview" },
    { to: "/admin/business-analytics", label: "Бизнес-аналитика", icon: TrendingUp, section: "analytics", category: "overview" },
    { to: "/admin/anti-fraud", label: "Anti-fraud", icon: ShieldAlert, section: "analytics", category: "overview" },
    { to: "/admin/bot-conversations", label: "Активность клиентов", icon: MessageSquare, section: "clients", category: "management" },
    { to: "/admin/sales-report", label: t("admin.nav.sales_report"), icon: FileText, section: "sales-report", category: "overview" },
    { to: "/admin/traffic-abuse", label: t("admin.nav.traffic_abuse"), icon: ShieldAlert, section: "traffic-abuse", category: "overview" },
    { to: "/admin/geo-map", label: t("admin.nav.geo_map"), icon: Map, section: "geo-map", category: "overview" },
    { to: "/admin/clients", label: t("admin.nav.clients"), icon: Users, section: "clients", category: "management" },
    { to: "/admin/proxy", label: t("admin.nav.proxy"), icon: Globe, section: "proxy", category: "management" },
    { to: "/admin/singbox", label: t("admin.nav.singbox"), icon: Server, section: "singbox", category: "management" },
    { to: "/admin/backup", label: t("admin.nav.backups"), icon: Database, section: "backup", category: "management" },
    { to: "/admin/tickets", label: t("admin.nav.tickets"), icon: MessageSquare, section: "tickets", category: "management" },
    { to: "/admin/tariffs", label: t("admin.nav.tariffs"), icon: CreditCard, section: "tariffs", category: "subscription" },
    { to: "/admin/promo", label: t("admin.nav.promo_links"), icon: Megaphone, section: "promo", category: "subscription" },
    { to: "/admin/promo-codes", label: t("admin.nav.promo_codes"), icon: Tag, section: "promo-codes", category: "subscription" },
    { to: "/admin/marketing", label: t("admin.nav.marketing"), icon: Target, section: "marketing", category: "subscription" },
    { to: "/admin/referral-network", label: t("admin.nav.referral_network"), icon: Network, section: "referral-network", category: "subscription" },
    { to: "/admin/secondary-subscriptions", label: "Доп. подписки", icon: Gift, section: "secondary-subscriptions", category: "subscription" },
    { to: "/admin/video-instructions", label: t("admin.nav.video_instructions"), icon: Video, section: "video-instructions", category: "tools" },
    { to: "/admin/broadcast", label: t("admin.nav.broadcast"), icon: Send, section: "broadcast", category: "tools" },
    { to: "/admin/auto-broadcast", label: t("admin.nav.auto_broadcast"), icon: CalendarClock, section: "auto-broadcast", category: "tools" },
    { to: "/admin/contests", label: t("admin.nav.contests"), icon: Trophy, section: "contests", category: "tools" },
    { to: "/admin/tour-constructor", label: "Конструктор тура", icon: Sparkles, section: "tour-constructor", category: "tools" },
    { to: "/admin/promo-vpn", label: t("admin.nav.promo_vpn"), icon: Rocket, section: "promo-vpn", category: "tools" },
    { to: "/admin/marketplace", label: t("admin.nav.marketplace"), icon: ShoppingBag, section: "marketplace", category: "tools" },
    { to: "/admin/settings", label: t("admin.nav.settings"), icon: Settings, section: "settings", category: "settings" },
    { to: "/admin/languages", label: t("admin.nav.languages"), icon: Languages, section: "languages", category: "settings" },
    { to: "/admin/bots", label: t("admin.nav.clone_bots"), icon: Bot, section: "bots", category: "settings" },
    { to: "/admin/admins", label: t("admin.nav.managers"), icon: UserCog, section: "admins", category: "settings" },
    { to: "/admin/api-keys", label: t("admin.nav.api_keys"), icon: Key, section: "api-keys", category: "settings" },
    { to: "/admin/diagnostics", label: "Диагностика", icon: Activity, section: "diagnostics", category: "settings" },
    { to: "/admin/email-templates", label: "Email-шаблоны", icon: Mail, section: "settings", category: "settings" },
    { to: "/admin/bot-messages", label: "Тексты бота", icon: Bot, section: "settings", category: "settings" },
    { to: "/admin/webhook-inbox", label: "Webhook inbox", icon: Inbox, section: "webhook-inbox", category: "settings" },
    { to: "/admin/audit", label: "Аудит-лог", icon: ClipboardList, section: "audit", category: "settings" },
  ];
}

function canAccessSection(role: string, allowedSections: string[] | undefined, section: string): boolean {
  if (role === "ADMIN") return true;
  if (section === "admins") return false;
  return Array.isArray(allowedSections) && allowedSections.includes(section);
}

function isNavActive(pathname: string, to: string): boolean {
  if (to === "/admin") return pathname === "/admin";
  if (pathname === to) return true;
  if (pathname.startsWith(to)) {
    const next = pathname[to.length];
    return next === "/" || next === undefined;
  }
  return false;
}

function NavItems({ onClick }: { onClick?: () => void }) {
  const { t } = useTranslation();
  const location = useLocation();
  const admin = useAuth().state.admin;
  const allNav = useNavSections();
  const nav = admin
    ? allNav.filter((item) => canAccessSection(admin.role, admin.allowedSections, item.section))
    : allNav;

  const groupedNav = nav.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, NavItem[]>);

  const sortedCategories = Object.keys(groupedNav).sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));

  return (
    <>
      {sortedCategories.map((category, index) => (
        <div key={category} className="mb-4 last:mb-0">
          {index > 0 && <div className="mx-6 mb-4 border-t border-dotted border-white/10 dark:border-white/20"></div>}
          <div className="flex items-center gap-2 px-6 mb-2">
            <div className="w-[2px] h-[12px] bg-primary"></div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t(CATEGORY_I18N[category] ?? category)}</div>
          </div>
          <div className="space-y-1.5 px-3">
            {groupedNav[category].map((item) => {
              const isActive = isNavActive(location.pathname, item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={onClick}
                  className={cn(
                    "flex items-center gap-3.5 py-2.5 px-3 rounded-xl transition-all duration-300 relative border-x-[4px]",
                    isActive
                      ? "bg-primary/15 backdrop-blur-md text-primary shadow-[0_0_15px_rgba(var(--primary),0.2)] scale-[1.02] z-10 border-x-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-foreground/5 border-x-transparent"
                  )}
                >
                  <item.icon className={cn("h-[19px] w-[19px] shrink-0 transition-transform duration-300", isActive ? "text-primary scale-110" : "text-muted-foreground/70")} />
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground/50 font-mono text-[13px]">~</span>
                    <span className="text-[14.5px] font-mono tracking-wide">{item.label}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

export function DashboardLayout() {
  const { t } = useTranslation();
  useAdminLanguageSync();
  const { state, logout } = useAuth();
  const { config: themeConfig, setMode, setAccent } = useTheme();

  const MODE_OPTIONS: { value: ThemeMode; icon: typeof Sun; label: string }[] = [
    { value: "light", icon: Sun, label: t("admin.header.theme_light") },
    { value: "dark", icon: Moon, label: t("admin.header.theme_dark") },
    { value: "system", icon: Monitor, label: t("admin.header.theme_system") },
  ];
  const navigate = useNavigate();
  const location = useLocation();
  const [brand, setBrand] = useState<{ serviceName: string; logo: string | null }>({ serviceName: "", logo: null });
  const [showThemePanel, setShowThemePanel] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notificationToasts, setNotificationToasts] = useState<{ id: number; text: string; icon: string }[]>([]);
  const lastCountersRef = useRef<AdminNotificationCounters | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(true);

  useEffect(() => { setMobileMenuOpen(false); }, [location.pathname]);

  useEffect(() => {
    const admin = state.admin;
    if (!admin || admin.role !== "MANAGER") return;
    const path = location.pathname.replace(/^\/admin\/?/, "") || "dashboard";
    const section = path.split("/")[0] || "dashboard";
    const allowed = admin.allowedSections ?? [];
    if (section === "admins" || !allowed.includes(section)) {
      const first = allowed[0];
      const to = !first ? "/admin" : first === "dashboard" ? "/admin" : `/admin/${first}`;
      navigate(to, { replace: true });
    }
  }, [state.admin, location.pathname, navigate]);

  useEffect(() => {
    const token = state.accessToken;
    if (token) {
      api.getSettings(token).then((s) => {
        setBrand({ serviceName: s.serviceName, logo: s.logo ?? null });
        setNotificationsEnabled(s.adminFrontNotificationsEnabled ?? true);
      }).catch(() => {});
    }
  }, [state.accessToken]);

  useEffect(() => {
    const token = state.accessToken;
    if (!token || !notificationsEnabled) return;
    let cancelled = false;
    const pushToast = (text: string, icon = "") => {
      const id = Date.now() + Math.random();
      setNotificationToasts((prev) => [...prev, { id, text, icon }]);
      window.setTimeout(() => { setNotificationToasts((prev) => prev.filter((t) => t.id !== id)); }, 5000);
    };
    const fetchCounters = async () => {
      try {
        const data = await api.getAdminNotificationCounters(token);
        if (cancelled) return;
        const last = lastCountersRef.current;
        if (last) {
          const newClients = data.totalClients - last.totalClients;
          const newPayments = data.totalTariffPayments - last.totalTariffPayments;
          const newTopups = data.totalBalanceTopups - last.totalBalanceTopups;
          const newTickets = data.totalTickets - last.totalTickets;
          if (newClients > 0) pushToast(newClients === 1 ? t("admin.header.notification_new_client") : t("admin.header.notification_new_clients", { newClients }), "\u{1F464}");
          if (newPayments > 0) pushToast(newPayments === 1 ? t("admin.header.notification_new_payment") : t("admin.header.notification_new_payments", { newPayments }), "\u{1F4E6}");
          if (newTopups > 0) pushToast(newTopups === 1 ? t("admin.header.notification_new_topup") : t("admin.header.notification_new_topups", { newTopups }), "\u{1F4B0}");
          if (newTickets > 0) pushToast(newTickets === 1 ? t("admin.header.notification_new_ticket") : t("admin.header.notification_new_tickets", { newTickets }), "\u{1F4AC}");
        }
        lastCountersRef.current = data;
      } catch { /* ignore */ }
    };
    fetchCounters();
    const id = window.setInterval(fetchCounters, 15000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [state.accessToken, notificationsEnabled]);

  async function handleLogout() {
    await logout();
    navigate("/admin/login", { replace: true });
  }

  return (
    <div className="flex min-h-svh bg-background relative">
      {/* ═══ Global Ambient Lights ═══ */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10" aria-hidden>
        <div className="absolute inset-0" style={{ backgroundColor: 'hsl(var(--background))' }} />
        <div className="absolute inset-0 bg-gradient-to-b from-white/5 via-transparent to-transparent dark:from-primary/10" />
        <div className="absolute top-[-10%] -left-[10%] w-[50%] h-[50%] bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.15)_0%,transparent_60%)]" />
        <div className="absolute bottom-[-10%] -right-[10%] w-[50%] h-[50%] bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.12)_0%,transparent_60%)]" />
        <div className="absolute top-[30%] right-[10%] w-[35%] h-[35%] bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.06)_0%,transparent_55%)]" />
      </div>

      {/* ═══ Desktop sidebar ═══ */}
      <aside className="hidden md:flex flex-col shrink-0 fixed left-0 top-3 bottom-3 w-[290px] z-[70] rounded-r-[2rem] border-y border-r border-white/20 dark:border-white/10 bg-white/10 dark:bg-white/5 backdrop-blur-xl shadow-[20px_0_40px_-10px_rgba(0,0,0,0.5)] dark:shadow-[inset_-1px_1px_0_rgba(255,255,255,0.15)] transition-all overflow-hidden">
        <div className="flex h-16 items-center justify-center gap-3 px-4 relative z-10">
          <div className="absolute bottom-0 left-6 right-6 h-[1px] bg-gradient-to-r from-transparent via-white/20 dark:via-white/10 to-transparent"></div>
          {brand.logo ? (
            <img src={brand.logo} alt="" className="h-8 w-auto object-contain" />
          ) : (
            <Shield className="h-7 w-7 text-primary shrink-0" />
          )}
          {brand.serviceName ? <span className="font-bold text-lg tracking-wide truncate">{brand.serviceName}</span> : null}
        </div>
        <nav className="flex-1 space-y-1.5 p-4 overflow-y-auto relative z-10 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-white/20">
          <NavItems />
        </nav>
        <div className="border-t border-white/10 p-4 space-y-1.5 relative z-10">
          <div className="text-[12px] font-mono font-bold text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.8)] uppercase tracking-widest px-3 py-1 mb-1 flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            {t("admin.header.online")}
          </div>
          <div className="text-xs font-mono text-muted-foreground truncate px-3 py-1 mb-2">{state.admin?.email}</div>
          <Link to="/admin/change-password" className="block">
            <Button variant="ghost" size="sm" className="w-full justify-start gap-2 hover:bg-primary/10 hover:text-primary transition-all font-mono text-[13px]">
              <KeyRound className="h-4 w-4" />
              {t("admin.header.change_password")}
            </Button>
          </Link>
          <Button 
            variant="ghost" 
            size="sm" 
            className="w-full justify-start gap-2 text-red-500/80 hover:bg-red-500/20 hover:text-red-400 hover:shadow-[0_0_10px_rgba(239,68,68,0.3)] transition-all font-mono font-bold text-[13px] mt-1" 
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            {t("admin.header.logout")}
          </Button>
        </div>
      </aside>

      {/* ═══ Mobile sidebar overlay ═══ */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[69] bg-background/50 backdrop-blur-sm md:hidden" onClick={() => setMobileMenuOpen(false)} />
            <motion.aside
              initial={{ x: -290 }} animate={{ x: 0 }} exit={{ x: -290 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed left-0 top-0 bottom-0 z-[70] w-[290px] flex flex-col md:hidden bg-primary/20 dark:bg-primary/30 backdrop-blur-xl border-r border-white/30 dark:border-primary/40 shadow-[20px_0_40px_-10px_rgba(0,0,0,0.5)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),inset_0_0_40px_hsl(var(--primary)/0.2),0_0_40px_hsl(var(--primary)/0.2)] overflow-hidden"
            >
              <div className="flex h-16 items-center justify-center px-4 relative z-10">
                <div className="absolute bottom-0 left-6 right-6 h-[1px] bg-gradient-to-r from-transparent via-white/20 dark:via-white/10 to-transparent"></div>
                <div className="flex items-center gap-3 min-w-0">
                  {brand.logo ? <img src={brand.logo} alt="" className="h-8 w-auto object-contain" /> : <Shield className="h-7 w-7 text-primary shrink-0" />}
                  {brand.serviceName ? <span className="font-bold text-lg tracking-wide truncate">{brand.serviceName}</span> : null}
                </div>
                <Button variant="ghost" size="icon" className="absolute right-4 shrink-0" onClick={() => setMobileMenuOpen(false)}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <nav className="flex-1 space-y-1.5 p-4 overflow-y-auto relative z-10 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-white/20">
                <NavItems onClick={() => setMobileMenuOpen(false)} />
              </nav>
              <div className="border-t border-white/10 p-4 space-y-1.5 relative z-10">
                <div className="text-[12px] font-mono font-bold text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.8)] uppercase tracking-widest px-3 py-1 mb-1 flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  {t("admin.header.online")}
                </div>
                <div className="text-xs font-mono text-muted-foreground truncate px-3 py-1 mb-2">{state.admin?.email}</div>
                <Link to="/admin/change-password" className="block" onClick={() => setMobileMenuOpen(false)}>
                  <Button variant="ghost" size="sm" className="w-full justify-start gap-2 hover:bg-primary/10 hover:text-primary transition-all font-mono text-[13px]">
                    <KeyRound className="h-4 w-4" />
                    {t("admin.header.change_password")}
                  </Button>
                </Link>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="w-full justify-start gap-2 text-red-500/80 hover:bg-red-500/20 hover:text-red-400 hover:shadow-[0_0_10px_rgba(239,68,68,0.3)] transition-all font-mono font-bold text-[13px] mt-1" 
                  onClick={handleLogout}
                >
                  <LogOut className="h-4 w-4" />
                  {t("admin.header.logout")}
                </Button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ═══ Main content ═══ */}
      <main className="flex-1 min-w-0 flex flex-col md:pl-[290px] w-full relative z-10">
        <header className="sticky top-3 z-[70] mx-3 sm:mx-4 mt-3 flex h-16 shrink-0 items-center justify-between gap-3 px-4 md:px-5 rounded-[1.35rem] bg-white/10 dark:bg-white/5 backdrop-blur-2xl border border-white/20 dark:border-white/10 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3)] dark:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)] transition-all">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Button variant="ghost" size="icon" className="md:hidden shrink-0 rounded-xl" onClick={() => setMobileMenuOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            {/* Breadcrumb / Page title */}
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="hidden md:flex h-9 w-9 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10 border border-primary/20 items-center justify-center shrink-0">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="hidden md:flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                  <span>Admin</span>
                  <ChevronRight className="h-3 w-3 opacity-50" />
                  <span className="text-primary truncate">{(() => {
                    const seg = location.pathname.replace(/^\/admin\/?/, "").split("/")[0] || "dashboard";
                    const map: Record<string, string> = {
                      dashboard: "Главная", analytics: "Аналитика", "sales-report": "Отчёт продаж",
                      "traffic-abuse": "Аномалии трафика", "geo-map": "Карта", clients: "Клиенты",
                      proxy: "Прокси", singbox: "Singbox", backup: "Бэкапы", tickets: "Тикеты",
                      tariffs: "Тарифы", promo: "Промо-ссылки", "promo-codes": "Промокоды",
                      marketing: "Маркетинг", "referral-network": "Реф. сеть",
                      "secondary-subscriptions": "Доп. подписки", "video-instructions": "Видео",
                      broadcast: "Рассылки", "auto-broadcast": "Авто-рассылки", contests: "Контесты",
                      "tour-constructor": "Тур", "promo-vpn": "Promo VPN", settings: "Настройки",
                      languages: "Языки", admins: "Менеджеры", "api-keys": "API ключи",
                      "change-password": "Смена пароля",
                    };
                    return map[seg] ?? seg;
                  })()}</span>
                </div>
                {brand.serviceName ? <span className="text-sm font-medium text-muted-foreground md:hidden truncate">{brand.serviceName}</span> : null}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Real-time toast indicator (legacy, низ-приоритет) */}
            {notificationToasts.length > 0 && (
              <span title={notificationsEnabled ? "Уведомления включены" : "Уведомления выключены"} className="flex items-center justify-center h-9 w-2">
                <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
              </span>
            )}
            {/* Inbox Bell (counters → tickets/webhooks/payments/cron failures/etc.) */}
            <InboxBell />
            {/* Theme picker — стиль из кабинета */}
            <div className="relative">
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-9 px-2.5 rounded-xl border border-transparent hover:border-white/10 bg-background/20 hover:bg-background/40" onClick={() => setShowThemePanel(!showThemePanel)}>
                <Palette className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("admin.header.theme")}</span>
              </Button>
              {showThemePanel && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowThemePanel(false)} />
                  <div className={cn(
                    "absolute right-0 top-full z-50 mt-3 w-[calc(100vw-2rem)] sm:w-[320px] max-w-[320px] rounded-[2rem] border border-white/40 dark:border-white/10 bg-slate-200/60 dark:bg-slate-900/60 backdrop-blur-[32px] p-5 shadow-[0_10px_60px_rgba(0,0,0,0.15)] dark:shadow-[0_10px_60px_rgba(0,0,0,0.5)] transition-all duration-300 origin-top-right",
                    "opacity-100 scale-100 pointer-events-auto translate-y-0"
                  )}>
                    <div className="mb-5">
                      <h4 className="mb-3 text-sm font-semibold tracking-tight text-foreground">{t("admin.header.mode")}</h4>
                      <div className="flex rounded-xl bg-muted/60 p-1 border border-border/50">
                        {MODE_OPTIONS.map((opt) => {
                          const isActive = themeConfig.mode === opt.value;
                          return (
                            <button
                              key={opt.value}
                              onClick={() => setMode(opt.value)}
                              className={cn(
                                "flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition-all duration-300",
                                isActive
                                  ? "bg-background text-foreground shadow-sm ring-1 ring-border/50"
                                  : "text-muted-foreground hover:bg-background/50 hover:text-foreground"
                              )}
                            >
                              <opt.icon className="h-3.5 w-3.5" />
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <h4 className="mb-3 text-sm font-semibold tracking-tight text-foreground">{t("admin.header.accent")}</h4>
                      <div className="grid grid-cols-4 gap-2">
                        {(Object.entries(ACCENT_PALETTES) as [ThemeAccent, typeof ACCENT_PALETTES["default"]][]).map(([key, palette]) => {
                          const isActive = themeConfig.accent === key;
                          return (
                            <button
                              key={key}
                              onClick={() => setAccent(key)}
                              className={cn(
                                "group flex flex-col items-center gap-2 rounded-xl p-2 transition-all duration-300",
                                isActive ? "bg-primary/10" : "hover:bg-muted/60"
                              )}
                            >
                              <div
                                className={cn(
                                  "relative flex h-8 w-8 items-center justify-center rounded-full shadow-sm transition-transform duration-300",
                                  isActive ? "scale-110 ring-4 ring-primary/20" : "group-hover:scale-110"
                                )}
                                style={{ backgroundColor: palette.swatch }}
                              >
                                {isActive && <Check className="h-4 w-4 text-white drop-shadow-md" />}
                              </div>
                              <span className={cn(
                                "text-[10px] font-medium tracking-tight truncate w-full text-center transition-colors",
                                isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                              )}>
                                {palette.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
            {/* Version badge */}
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 rounded-xl border border-white/10 bg-gradient-to-br from-emerald-500/10 to-teal-500/5 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 transition-all hover:from-emerald-500/20 hover:to-teal-500/10 hover:shadow-md">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
              <span>v{PANEL_VERSION}</span>
              <ExternalLink className="h-3 w-3 opacity-50" />
            </a>
          </div>
        </header>
        <div className="flex-1 px-4 md:px-6 pt-6 pb-6 animate-in fade-in duration-300 relative z-10">
          <Outlet />
        </div>
      </main>

      {notificationToasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 space-y-2">
          {notificationToasts.map((t) => (
            <div key={t.id} className="max-w-xs rounded-lg border bg-card px-4 py-3 text-sm shadow-lg flex items-center gap-2 animate-in slide-in-from-right-5 fade-in duration-300">
              {t.icon && <span className="text-base shrink-0">{t.icon}</span>}
              <span>{t.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
