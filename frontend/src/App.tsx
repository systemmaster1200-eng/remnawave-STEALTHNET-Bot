import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";

const routerFutureFlags = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
};
import { AuthProvider, useAuth } from "@/contexts/auth";
import { ClientAuthProvider, useClientAuth } from "@/contexts/client-auth";
import { ThemeProvider } from "@/contexts/theme";
import { AnimatedBackground } from "@/components/animated-background";
import { api } from "@/lib/api";
import type { PublicConfig } from "@/lib/api";

const LoginPage = lazy(() => import("@/pages/login").then((m) => ({ default: m.LoginPage })));
const ChangePasswordPage = lazy(() => import("@/pages/change-password").then((m) => ({ default: m.ChangePasswordPage })));
const DashboardPage = lazy(() => import("@/pages/dashboard").then((m) => ({ default: m.DashboardPage })));
const ClientsPage = lazy(() => import("@/pages/clients").then((m) => ({ default: m.ClientsPage })));
const TariffsPage = lazy(() => import("@/pages/tariffs").then((m) => ({ default: m.TariffsPage })));
const TrialsPage = lazy(() => import("@/pages/trials").then((m) => ({ default: m.TrialsPage })));
const WithdrawalsPage = lazy(() => import("@/pages/withdrawals").then((m) => ({ default: m.WithdrawalsPage })));
const AutoRenewPage = lazy(() => import("@/pages/auto-renew").then((m) => ({ default: m.AutoRenewPage })));
const SettingsPage = lazy(() => import("@/pages/settings").then((m) => ({ default: m.SettingsPage })));
const LandingEditorPage = lazy(() => import("@/pages/landing-editor").then((m) => ({ default: m.LandingEditorPage })));
const LandingPreviewPage = lazy(() => import("@/pages/landing-preview").then((m) => ({ default: m.LandingPreviewPage })));
const AdminAuditPage = lazy(() => import("@/pages/admin-audit").then((m) => ({ default: m.AdminAuditPage })));
const AdminWebhookInboxPage = lazy(() => import("@/pages/admin-webhook-inbox").then((m) => ({ default: m.AdminWebhookInboxPage })));
const AdminDiagnosticsPage = lazy(() => import("@/pages/admin-diagnostics").then((m) => ({ default: m.AdminDiagnosticsPage })));
const AdminBusinessAnalyticsPage = lazy(() => import("@/pages/admin-business-analytics").then((m) => ({ default: m.AdminBusinessAnalyticsPage })));
const AdminAntiFraudPage = lazy(() => import("@/pages/admin-anti-fraud").then((m) => ({ default: m.AdminAntiFraudPage })));
const AdminEmailTemplatesPage = lazy(() => import("@/pages/admin-email-templates").then((m) => ({ default: m.AdminEmailTemplatesPage })));
const AdminBotMessagesPage = lazy(() => import("@/pages/admin-bot-messages").then((m) => ({ default: m.AdminBotMessagesPage })));
const AdminBotConversationsPage = lazy(() => import("@/pages/admin-bot-conversations").then((m) => ({ default: m.AdminBotConversationsPage })));
const CmdKPalette = lazy(() => import("@/components/cmd-k-palette").then((m) => ({ default: m.CmdKPalette })));
const PromoPage = lazy(() => import("@/pages/promo").then((m) => ({ default: m.PromoPage })));
const PromoCodesPage = lazy(() => import("@/pages/promo-codes").then((m) => ({ default: m.PromoCodesPage })));
const AnalyticsPage = lazy(() => import("@/pages/analytics").then((m) => ({ default: m.AnalyticsPage })));
const MarketingPage = lazy(() => import("@/pages/marketing").then((m) => ({ default: m.MarketingPage })));
const AdminsPage = lazy(() => import("@/pages/admins").then((m) => ({ default: m.AdminsPage })));
const SalesReportPage = lazy(() => import("@/pages/sales-report").then((m) => ({ default: m.SalesReportPage })));
const BalanceSalesPage = lazy(() => import("@/pages/balance-sales").then((m) => ({ default: m.BalanceSalesPage })));
const VideoInstructionsPage = lazy(() => import("@/pages/video-instructions").then((m) => ({ default: m.VideoInstructionsPage })));
const BackupPage = lazy(() => import("@/pages/backup").then((m) => ({ default: m.BackupPage })));
const ContestsPage = lazy(() => import("@/pages/contests").then((m) => ({ default: m.ContestsPage })));
const AdminTicketsPage = lazy(() => import("@/pages/admin-tickets").then((m) => ({ default: m.AdminTicketsPage })));
const BroadcastPage = lazy(() => import("@/pages/broadcast").then((m) => ({ default: m.BroadcastPage })));
const AutoBroadcastPage = lazy(() => import("@/pages/auto-broadcast").then((m) => ({ default: m.AutoBroadcastPage })));
const ReferralNetworkPage = lazy(() => import("@/pages/referral-network").then((m) => ({ default: m.ReferralNetworkPage })));
const AdminReferralsPage = lazy(() => import("@/pages/admin-referrals").then((m) => ({ default: m.AdminReferralsPage })));
const GramadsPromoPage = lazy(() => import("@/pages/gramads-promo").then((m) => ({ default: m.GramadsPromoPage })));
const TrafficAbusePage = lazy(() => import("@/pages/traffic-abuse").then((m) => ({ default: m.TrafficAbusePage })));
const ApiKeysPage = lazy(() => import("@/pages/api-keys").then((m) => ({ default: m.ApiKeysPage })));
const AntibotPage = lazy(() => import("@/pages/antibot").then((m) => ({ default: m.AntibotPage })));
const ApiDocsPage = lazy(() => import("@/pages/api-docs").then((m) => ({ default: m.ApiDocsPage })));
const GeoMapPage = lazy(() => import("@/pages/geo-map").then((m) => ({ default: m.GeoMapPage })));
const AdminSecondarySubscriptionsPage = lazy(() => import("@/pages/admin-secondary-subscriptions").then((m) => ({ default: m.AdminSecondarySubscriptionsPage })));
const ProxyPage = lazy(() => import("@/pages/proxy").then((m) => ({ default: m.ProxyPage })));
const SingboxPage = lazy(() => import("@/pages/singbox").then((m) => ({ default: m.SingboxPage })));
const WdttPage = lazy(() => import("@/pages/wdtt").then((m) => ({ default: m.WdttPage })));
const LanguagesPage = lazy(() => import("@/pages/languages"));
const TourConstructorPage = lazy(() => import("@/pages/tour-constructor").then((m) => ({ default: m.TourConstructorPage })));
const MarketplaceLayout = lazy(() => import("@/pages/marketplace/marketplace-layout").then((m) => ({ default: m.MarketplaceLayout })));
const MarketplaceBrowsePage = lazy(() => import("@/pages/marketplace/marketplace-browse").then((m) => ({ default: m.MarketplaceBrowsePage })));
const MarketplaceMyListingsPage = lazy(() => import("@/pages/marketplace/marketplace-my").then((m) => ({ default: m.MarketplaceMyListingsPage })));
const MarketplaceEditListingPage = lazy(() => import("@/pages/marketplace/marketplace-edit").then((m) => ({ default: m.MarketplaceEditListingPage })));
const MarketplaceHubInstallationsPage = lazy(() => import("@/pages/marketplace/marketplace-hub-installations").then((m) => ({ default: m.MarketplaceHubInstallationsPage })));
const MarketplaceHubReportsPage = lazy(() => import("@/pages/marketplace/marketplace-hub-reports").then((m) => ({ default: m.MarketplaceHubReportsPage })));
const MarketplaceHubCategoriesPage = lazy(() => import("@/pages/marketplace/marketplace-hub-categories").then((m) => ({ default: m.MarketplaceHubCategoriesPage })));
const DashboardLayout = lazy(() => import("@/components/layout/dashboard-layout").then((m) => ({ default: m.DashboardLayout })));
const CabinetLayout = lazy(() => import("@/pages/cabinet/cabinet-layout").then((m) => ({ default: m.CabinetLayout })));
const ClientLoginPage = lazy(() => import("@/pages/cabinet/client-login").then((m) => ({ default: m.ClientLoginPage })));
const ClientRegisterPage = lazy(() => import("@/pages/cabinet/client-register").then((m) => ({ default: m.ClientRegisterPage })));
const ClientOnboardingPage = lazy(() => import("@/pages/cabinet/client-onboarding").then((m) => ({ default: m.ClientOnboardingPage })));
const ClientVerifyEmailPage = lazy(() => import("@/pages/cabinet/client-verify-email").then((m) => ({ default: m.ClientVerifyEmailPage })));
const ClientVerifyLinkEmailPage = lazy(() => import("@/pages/cabinet/client-verify-link-email").then((m) => ({ default: m.ClientVerifyLinkEmailPage })));
const ClientDashboardPage = lazy(() => import("@/pages/cabinet/client-dashboard").then((m) => ({ default: m.ClientDashboardPage })));
const ClientTariffsPage = lazy(() => import("@/pages/cabinet/client-tariffs").then((m) => ({ default: m.ClientTariffsPage })));
const ClientProfilePage = lazy(() => import("@/pages/cabinet/client-profile").then((m) => ({ default: m.ClientProfilePage })));
const ClientReferralPage = lazy(() => import("@/pages/cabinet/client-referral").then((m) => ({ default: m.ClientReferralPage })));
const ClientSubscribePage = lazy(() => import("@/pages/cabinet/client-subscribe").then((m) => ({ default: m.ClientSubscribePage })));
const ClientYooMoneyPayPage = lazy(() => import("@/pages/cabinet/client-yoomoney-pay").then((m) => ({ default: m.ClientYooMoneyPayPage })));
const ClientExtraOptionsPage = lazy(() => import("@/pages/cabinet/client-extra-options").then((m) => ({ default: m.ClientExtraOptionsPage })));
const ClientProxyPage = lazy(() => import("@/pages/cabinet/client-proxy").then((m) => ({ default: m.ClientProxyPage })));
const ClientSingboxPage = lazy(() => import("@/pages/cabinet/client-singbox").then((m) => ({ default: m.ClientSingboxPage })));
const ClientWdttPage = lazy(() => import("@/pages/cabinet/client-wdtt").then((m) => ({ default: m.ClientWdttPage })));
const ClientTicketsPage = lazy(() => import("@/pages/cabinet/client-tickets").then((m) => ({ default: m.ClientTicketsPage })));
const ClientCustomBuildPage = lazy(() => import("@/pages/cabinet/client-custom-build").then((m) => ({ default: m.ClientCustomBuildPage })));
const ClientGiftsPage = lazy(() => import("@/pages/cabinet/client-gifts").then((m) => ({ default: m.ClientGiftsPage })));
const GiftActivatePage = lazy(() => import("@/pages/gift-activate").then((m) => ({ default: m.GiftActivatePage })));
const LandingPage = lazy(() => import("@/pages/landing").then((m) => ({ default: m.LandingPage })));
const PwaUpdatePrompt = lazy(() => import("@/components/pwa/pwa-update-prompt").then((m) => ({ default: m.PwaUpdatePrompt })));

function LoadingScreen({ label = "Загрузка…" }: { label?: string }) {
  return (
    <div className="min-h-svh flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-background to-muted/20">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="text-muted-foreground">{label}</p>
    </div>
  );
}

function AdminShell() {
  return (
    <RequireAuth>
      <>
        <CmdKPalette />
        <DashboardLayout />
      </>
    </RequireAuth>
  );
}

function ClientGuestRoute({ children }: { children: React.ReactNode }) {
  return <ClientAuthProvider>{children}</ClientAuthProvider>;
}

function ClientCabinetShell() {
  return (
    <ClientAuthProvider>
      <CabinetLayout />
    </ClientAuthProvider>
  );
}

function IdlePwaUpdatePrompt() {
  const [enabled, setEnabled] = useState(false);
  const location = useLocation();
  const isGuestRoute =
    location.pathname === "/" ||
    location.pathname === "/admin/login" ||
    location.pathname === "/cabinet" ||
    location.pathname === "/cabinet/login" ||
    location.pathname === "/cabinet/register" ||
    location.pathname.startsWith("/cabinet/verify") ||
    location.pathname.startsWith("/gift/");

  useEffect(() => {
    if (isGuestRoute) {
      setEnabled(false);
      return;
    }
    const win = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const enable = () => setEnabled(true);
    if (win.requestIdleCallback) {
      const id = win.requestIdleCallback(enable, { timeout: 3000 });
      return () => win.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(enable, 2500);
    return () => window.clearTimeout(id);
  }, [isGuestRoute]);

  if (!enabled || isGuestRoute) return null;
  return (
    <Suspense fallback={null}>
      <PwaUpdatePrompt />
    </Suspense>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const hasToken = Boolean(state.accessToken);

  if (!hasToken) {
    return <Navigate to="/admin/login" replace />;
  }

  return <>{children}</>;
}

function ForceChangePassword({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  if (state.admin?.mustChangePassword) {
    return <Navigate to="/admin/change-password" replace />;
  }
  return <>{children}</>;
}

function RequireClientAuth({ children }: { children: React.ReactNode }) {
  const { state } = useClientAuth();
  const location = useLocation();
  const inTelegram = typeof window !== "undefined" && Boolean((window as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData);
  const showMiniappLoading = state.miniappAuthLoading || (inTelegram && !state.token && !state.miniappAuthAttempted);
  if (showMiniappLoading) {
    return (
      <div className="min-h-svh flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-background to-muted/20">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-muted-foreground">Загрузка кабинета…</p>
      </div>
    );
  }
  if (!state.token) {
    return <Navigate to="/cabinet/login" replace />;
  }
  // Проверяем серверный флаг onboardingCompleted ИЛИ эфемерный isNewTelegramUser
  const needsOnboarding = state.client?.onboardingCompleted === false || state.isNewTelegramUser;
  if (needsOnboarding && location.pathname !== "/cabinet/onboarding") {
    return <Navigate to="/cabinet/onboarding" replace />;
  }
  return <>{children}</>;
}

function RequireOnboarding({ children }: { children: React.ReactNode }) {
  const { state } = useClientAuth();
  const needsOnboarding = state.client?.onboardingCompleted === false || state.isNewTelegramUser;
  if (!needsOnboarding) {
    return <Navigate to="/cabinet/dashboard" replace />;
  }
  return <>{children}</>;
}

function CabinetIndexRedirect() {
  const { state } = useClientAuth();
  const inTelegram = typeof window !== "undefined" && Boolean((window as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData);
  const showMiniappLoading = state.miniappAuthLoading || (inTelegram && !state.token && !state.miniappAuthAttempted);
  if (showMiniappLoading) {
    return (
      <div className="min-h-svh flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-background to-muted/20">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-muted-foreground">Загрузка кабинета…</p>
      </div>
    );
  }
  return <Navigate to={state.token ? "/cabinet/dashboard" : "/cabinet/login"} replace />;
}

function RootRoute() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getPublicConfig()
      .then((c) => setConfig(c))
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <LoadingScreen />;
  }

  if (config?.landingEnabled) {
    return <LandingPage config={config} />;
  }

  return <Navigate to="/cabinet" replace />;
}

function AppRoutes() {
  const { state, refreshAccess } = useAuth();

  useEffect(() => {
    if (!state.accessToken && state.refreshToken) {
      refreshAccess();
    }
  }, []);

  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
      {/* Главная: лендинг (если включён в настройках) или редирект в кабинет */}
      <Route path="/" element={<RootRoute />} />

      {/* Админка */}
      <Route path="/admin/login" element={state.accessToken ? <Navigate to="/admin" replace /> : <LoginPage />} />
      <Route
        path="/admin/change-password"
        element={
          <RequireAuth>
            <ChangePasswordPage />
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={<AdminShell />}
      >
        <Route
          index
          element={
            <ForceChangePassword>
              <DashboardPage />
            </ForceChangePassword>
          }
        />
        <Route path="clients" element={<ForceChangePassword><ClientsPage /></ForceChangePassword>} />
        <Route path="tariffs" element={<ForceChangePassword><TariffsPage /></ForceChangePassword>} />
        {/* T15 (11.05.2026) */}
        <Route path="trials" element={<ForceChangePassword><TrialsPage /></ForceChangePassword>} />
        {/* T6 (11.05.2026) */}
        <Route path="withdrawals" element={<ForceChangePassword><WithdrawalsPage /></ForceChangePassword>} />
        {/* T-autorenew (12.05.2026) */}
        <Route path="auto-renew" element={<ForceChangePassword><AutoRenewPage /></ForceChangePassword>} />
        <Route path="settings" element={<ForceChangePassword><SettingsPage /></ForceChangePassword>} />
        <Route path="landing-editor" element={<ForceChangePassword><LandingEditorPage /></ForceChangePassword>} />
        <Route path="landing-preview" element={<ForceChangePassword><LandingPreviewPage /></ForceChangePassword>} />
        <Route path="audit" element={<ForceChangePassword><AdminAuditPage /></ForceChangePassword>} />
        <Route path="webhook-inbox" element={<ForceChangePassword><AdminWebhookInboxPage /></ForceChangePassword>} />
        <Route path="diagnostics" element={<ForceChangePassword><AdminDiagnosticsPage /></ForceChangePassword>} />
        <Route path="business-analytics" element={<ForceChangePassword><AdminBusinessAnalyticsPage /></ForceChangePassword>} />
        <Route path="anti-fraud" element={<ForceChangePassword><AdminAntiFraudPage /></ForceChangePassword>} />
        <Route path="email-templates" element={<ForceChangePassword><AdminEmailTemplatesPage /></ForceChangePassword>} />
        <Route path="bot-messages" element={<ForceChangePassword><AdminBotMessagesPage /></ForceChangePassword>} />
        <Route path="bot-conversations" element={<ForceChangePassword><AdminBotConversationsPage /></ForceChangePassword>} />
        <Route path="promo" element={<ForceChangePassword><PromoPage /></ForceChangePassword>} />
        <Route path="promo-codes" element={<ForceChangePassword><PromoCodesPage /></ForceChangePassword>} />
        <Route path="analytics" element={<ForceChangePassword><AnalyticsPage /></ForceChangePassword>} />
        <Route path="marketing" element={<ForceChangePassword><MarketingPage /></ForceChangePassword>} />
        <Route path="admins" element={<ForceChangePassword><AdminsPage /></ForceChangePassword>} />
        <Route path="sales-report" element={<ForceChangePassword><SalesReportPage /></ForceChangePassword>} />
        <Route path="balance-sales" element={<ForceChangePassword><BalanceSalesPage /></ForceChangePassword>} />
        <Route path="video-instructions" element={<ForceChangePassword><VideoInstructionsPage /></ForceChangePassword>} />
        <Route path="broadcast" element={<ForceChangePassword><BroadcastPage /></ForceChangePassword>} />
        <Route path="auto-broadcast" element={<ForceChangePassword><AutoBroadcastPage /></ForceChangePassword>} />
        <Route path="proxy" element={<ForceChangePassword><ProxyPage /></ForceChangePassword>} />
        <Route path="singbox" element={<ForceChangePassword><SingboxPage /></ForceChangePassword>} />
        <Route path="wdtt" element={<ForceChangePassword><WdttPage /></ForceChangePassword>} />
        <Route path="backup" element={<ForceChangePassword><BackupPage /></ForceChangePassword>} />
        <Route path="contests" element={<ForceChangePassword><ContestsPage /></ForceChangePassword>} />
        <Route path="tickets" element={<ForceChangePassword><AdminTicketsPage /></ForceChangePassword>} />
        <Route path="referral-network" element={<ForceChangePassword><ReferralNetworkPage /></ForceChangePassword>} />
        <Route path="referrals" element={<ForceChangePassword><AdminReferralsPage /></ForceChangePassword>} />
        <Route path="traffic-abuse" element={<ForceChangePassword><TrafficAbusePage /></ForceChangePassword>} />
        <Route path="api-keys" element={<ForceChangePassword><ApiKeysPage /></ForceChangePassword>} />
        <Route path="antibot" element={<ForceChangePassword><AntibotPage /></ForceChangePassword>} />
        <Route path="languages" element={<ForceChangePassword><LanguagesPage /></ForceChangePassword>} />
        <Route path="api-docs" element={<ForceChangePassword><ApiDocsPage /></ForceChangePassword>} />
        <Route path="geo-map" element={<ForceChangePassword><GeoMapPage /></ForceChangePassword>} />
        <Route path="secondary-subscriptions" element={<ForceChangePassword><AdminSecondarySubscriptionsPage /></ForceChangePassword>} />
        <Route path="tour-constructor" element={<ForceChangePassword><TourConstructorPage /></ForceChangePassword>} />
        <Route path="promo-vpn" element={<ForceChangePassword><GramadsPromoPage /></ForceChangePassword>} />
        <Route path="marketplace" element={<ForceChangePassword><MarketplaceLayout /></ForceChangePassword>}>
          <Route index element={<MarketplaceBrowsePage />} />
          <Route path="my" element={<MarketplaceMyListingsPage />} />
          <Route path="my/new" element={<MarketplaceEditListingPage />} />
          <Route path="my/:id/edit" element={<MarketplaceEditListingPage />} />
          <Route path="hub/installations" element={<MarketplaceHubInstallationsPage />} />
          <Route path="hub/reports" element={<MarketplaceHubReportsPage />} />
          <Route path="hub/categories" element={<MarketplaceHubCategoriesPage />} />
        </Route>
      </Route>
      {/* Онбординг — вне CabinetLayout (без навбара) */}
      <Route
        path="/cabinet/onboarding"
        element={
          <ClientAuthProvider>
            <RequireClientAuth>
              <RequireOnboarding>
                <ClientOnboardingPage />
              </RequireOnboarding>
            </RequireClientAuth>
          </ClientAuthProvider>
        }
      />

      {/* Публичная страница подарка — без auth */}
      <Route
        path="/gift/:code"
        element={
          <ClientGuestRoute>
            <GiftActivatePage />
          </ClientGuestRoute>
        }
      />

      <Route
        path="/cabinet"
        element={
          <ClientGuestRoute>
            <CabinetIndexRedirect />
          </ClientGuestRoute>
        }
      />
      <Route path="/cabinet/login" element={<ClientGuestRoute><ClientLoginPage /></ClientGuestRoute>} />
      <Route path="/cabinet/register" element={<ClientGuestRoute><ClientRegisterPage /></ClientGuestRoute>} />
      <Route path="/cabinet/verify-email" element={<ClientGuestRoute><ClientVerifyEmailPage /></ClientGuestRoute>} />
      <Route path="/cabinet/verify-link-email" element={<ClientGuestRoute><ClientVerifyLinkEmailPage /></ClientGuestRoute>} />

      <Route
        path="/cabinet"
        element={<ClientCabinetShell />}
      >
        <Route
          path="dashboard"
          element={
            <RequireClientAuth>
              <ClientDashboardPage />
            </RequireClientAuth>
          }
        />
        <Route
          path="tariffs"
          element={
            <RequireClientAuth>
              <ClientTariffsPage />
            </RequireClientAuth>
          }
        />
        <Route
          path="profile"
          element={
            <RequireClientAuth>
              <ClientProfilePage />
            </RequireClientAuth>
          }
        />
        <Route
          path="referral"
          element={
            <RequireClientAuth>
              <ClientReferralPage />
            </RequireClientAuth>
          }
        />
        <Route
          path="tickets"
          element={
            <RequireClientAuth>
              <ClientTicketsPage />
            </RequireClientAuth>
          }
        />
        <Route
          path="subscribe"
          element={
            <RequireClientAuth>
              <ClientSubscribePage />
            </RequireClientAuth>
          }
        />
        <Route
          path="yoomoney-pay"
          element={
            <RequireClientAuth>
              <ClientYooMoneyPayPage />
            </RequireClientAuth>
          }
        />
        <Route
          path="custom-build"
          element={
            <RequireClientAuth>
              <ClientCustomBuildPage />
            </RequireClientAuth>
          }
        />
        <Route
          path="extra-options"
          element={
            <RequireClientAuth>
              <ClientExtraOptionsPage />
            </RequireClientAuth>
          }
        />
        <Route
          path="proxy"
          element={
            <RequireClientAuth>
              <ClientProxyPage />
            </RequireClientAuth>
          }
        />
        <Route
          path="singbox"
          element={
            <RequireClientAuth>
              <ClientSingboxPage />
            </RequireClientAuth>
          }
        />
        <Route
          path="wdtt"
          element={
            <RequireClientAuth>
              <ClientWdttPage />
            </RequireClientAuth>
          }
        />
        <Route
          path="gifts"
          element={
            <RequireClientAuth>
              <ClientGiftsPage />
            </RequireClientAuth>
          }
        />
      </Route>
      {/* Всё неизвестное тоже ведём в кабинет */}
      <Route path="*" element={<Navigate to="/cabinet" replace />} />
      </Routes>
    </Suspense>
  );
}

function TitleAndThemeSync() {
  const location = useLocation();
  const [config, setConfig] = useState<{ serviceName: string; favicon: string | null } | null>(null);

  // Подтягиваем конфиг при смене маршрута (в т.ч. после сохранения настроек), чтобы favicon обновился
  useEffect(() => {
    api
      .getPublicConfig(true)
      .then((cfg) => {
        setConfig({
          serviceName: cfg.serviceName ?? "",
          favicon: (cfg as { favicon?: string | null }).favicon ?? null,
        });
        // Глобальная тема из настроек
      })
      .catch(() => {
        setConfig({ serviceName: "", favicon: null });
      });
  }, [location.pathname]);

  // Title и favicon
  useEffect(() => {
    const base = config?.serviceName ?? "";
    let suffix = "";
    if (location.pathname.startsWith("/admin")) suffix = " — Admin";
    else if (location.pathname.startsWith("/cabinet")) suffix = " — Кабинет";
    document.title = (base + suffix).trim() || suffix.replace(/^ — /, "").trim();

    // Custom favicon: убираем все статические <link rel="icon"> из index.html
    // (svg, 32px, 16px, apple-touch и иконки PWA-манифеста), потому что
    // браузер выбирает «лучший» по размеру, и PWA-иконка может перебить
    // пользовательский favicon. Помечаем добавленные нами линки атрибутом
    // data-custom-favicon, чтобы при обновлении не плодить дубли.
    //
    // Также подменяем <link rel="manifest"> на динамический эндпоинт
    // /api/public/manifest.webmanifest когда есть custom favicon — иначе
    // PWA install/Add-to-home-screen покажет дефолтную иконку сборки.
    const favicon = config?.favicon ?? null;
    const existingCustom = document.querySelectorAll<HTMLLinkElement>('link[data-custom-favicon="1"]');
    const builtin = document.querySelectorAll<HTMLLinkElement>(
      'link[rel="icon"]:not([data-custom-favicon]), link[rel="apple-touch-icon"]:not([data-custom-favicon]), link[rel="shortcut icon"]:not([data-custom-favicon]), link[rel="mask-icon"]:not([data-custom-favicon])'
    );

    if (favicon) {
      // Убираем дефолтные иконки сборки (favicon-16/32, apple-touch, svg).
      builtin.forEach((el) => el.remove());
      existingCustom.forEach((el) => el.remove());

      const detectType = (src: string): string => {
        if (src.startsWith("data:image/")) {
          const m = src.match(/data:image\/(\w+)/);
          return m ? `image/${m[1].toLowerCase()}` : "image/png";
        }
        if (/\.svg(\?|$)/i.test(src)) return "image/svg+xml";
        if (/\.png(\?|$)/i.test(src)) return "image/png";
        if (/\.(jpg|jpeg)(\?|$)/i.test(src)) return "image/jpeg";
        if (/\.webp(\?|$)/i.test(src)) return "image/webp";
        if (/\.ico(\?|$)/i.test(src)) return "image/x-icon";
        return "image/png";
      };
      const type = detectType(favicon);

      // Главный favicon — без sizes, чтобы браузер не пытался выбрать «другой подходящий»
      const main = document.createElement("link");
      main.rel = "icon";
      main.type = type;
      main.href = favicon;
      main.setAttribute("data-custom-favicon", "1");
      document.head.appendChild(main);

      // apple-touch-icon — отдельной иконкой, чтобы home-screen на iOS тоже взял пользовательский favicon
      const apple = document.createElement("link");
      apple.rel = "apple-touch-icon";
      apple.href = favicon;
      apple.setAttribute("data-custom-favicon", "1");
      document.head.appendChild(apple);
    } else {
      // Сбросили favicon в админке — возвращаем дефолтные если их вдруг убрали custom-логикой раньше
      existingCustom.forEach((el) => el.remove());
      if (document.querySelectorAll('link[rel="icon"]').length === 0) {
        const def = document.createElement("link");
        def.rel = "icon";
        def.type = "image/svg+xml";
        def.href = "/favicon.svg";
        document.head.appendChild(def);
      }
    }

    // Манифест: при custom favicon переключаем на динамический эндпоинт.
    // Когда favicon пустой — оставляем статический манифест (дефолтное брендирование).
    const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const dynamicManifestUrl = "/api/public/manifest.webmanifest";
    const staticManifestUrl = "/manifest.webmanifest";
    const wantUrl = favicon ? dynamicManifestUrl : staticManifestUrl;
    if (manifestLink && manifestLink.getAttribute("href") !== wantUrl) {
      manifestLink.href = wantUrl;
    } else if (!manifestLink) {
      const ml = document.createElement("link");
      ml.rel = "manifest";
      ml.href = wantUrl;
      document.head.appendChild(ml);
    }
  }, [location.pathname, config]);

  return null;
}

export default function App() {

  return (
    <ThemeProvider >
      <AuthProvider>
        <BrowserRouter future={routerFutureFlags}>
          <AnimatedBackground />
          <TitleAndThemeSync  />
          <AppRoutes />
          <IdlePwaUpdatePrompt />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
