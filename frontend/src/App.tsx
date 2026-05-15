import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";

const routerFutureFlags = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
};
import { AuthProvider, useAuth } from "@/contexts/auth";
import { ClientAuthProvider, useClientAuth } from "@/contexts/client-auth";
import { ThemeProvider } from "@/contexts/theme";
import { AnimatedBackground } from "@/components/animated-background";
import { PwaUpdatePrompt } from "@/components/pwa/pwa-update-prompt";
import { api } from "@/lib/api";
import { LoginPage } from "@/pages/login";
import { ChangePasswordPage } from "@/pages/change-password";
import { DashboardPage } from "@/pages/dashboard";
import { ClientsPage } from "@/pages/clients";
import { TariffsPage } from "@/pages/tariffs";
import { SettingsPage } from "@/pages/settings";
import { LandingEditorPage } from "@/pages/landing-editor";
import { LandingPreviewPage } from "@/pages/landing-preview";
import { AdminAuditPage } from "@/pages/admin-audit";
import { AdminWebhookInboxPage } from "@/pages/admin-webhook-inbox";
import { AdminDiagnosticsPage } from "@/pages/admin-diagnostics";
import { AdminBusinessAnalyticsPage } from "@/pages/admin-business-analytics";
import { AdminAntiFraudPage } from "@/pages/admin-anti-fraud";
import { AdminEmailTemplatesPage } from "@/pages/admin-email-templates";
import { AdminBotMessagesPage } from "@/pages/admin-bot-messages";
import { AdminBotConversationsPage } from "@/pages/admin-bot-conversations";
import { CmdKPalette } from "@/components/cmd-k-palette";
import { PromoPage } from "@/pages/promo";
import { PromoCodesPage } from "@/pages/promo-codes";
import { AnalyticsPage } from "@/pages/analytics";
import { MarketingPage } from "@/pages/marketing";
import { AdminsPage } from "@/pages/admins";
import { SalesReportPage } from "@/pages/sales-report";
import { VideoInstructionsPage } from "@/pages/video-instructions";
import { BackupPage } from "@/pages/backup";
import { ContestsPage } from "@/pages/contests";
import { AdminTicketsPage } from "@/pages/admin-tickets";
import { BroadcastPage } from "@/pages/broadcast";
import { AutoBroadcastPage } from "@/pages/auto-broadcast";
import { ReferralNetworkPage } from "@/pages/referral-network";
import { GramadsPromoPage } from "@/pages/gramads-promo";
import { TrafficAbusePage } from "@/pages/traffic-abuse";
import { ApiKeysPage } from "@/pages/api-keys";
import { BotsPage } from "@/pages/bots";
import { ApiDocsPage } from "@/pages/api-docs";
import { GeoMapPage } from "@/pages/geo-map";
import { AdminSecondarySubscriptionsPage } from "@/pages/admin-secondary-subscriptions";
import { ProxyPage } from "@/pages/proxy";
import { SingboxPage } from "@/pages/singbox";
import LanguagesPage from "@/pages/languages";
import { TourConstructorPage } from "@/pages/tour-constructor";
import { MarketplaceLayout } from "@/pages/marketplace/marketplace-layout";
import { MarketplaceBrowsePage } from "@/pages/marketplace/marketplace-browse";
import { MarketplaceMyListingsPage } from "@/pages/marketplace/marketplace-my";
import { MarketplaceEditListingPage } from "@/pages/marketplace/marketplace-edit";
import { MarketplaceHubInstallationsPage } from "@/pages/marketplace/marketplace-hub-installations";
import { MarketplaceHubReportsPage } from "@/pages/marketplace/marketplace-hub-reports";
import { MarketplaceHubCategoriesPage } from "@/pages/marketplace/marketplace-hub-categories";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { CabinetLayout } from "@/pages/cabinet/cabinet-layout";
import { ClientLoginPage } from "@/pages/cabinet/client-login";
import { ClientRegisterPage } from "@/pages/cabinet/client-register";
import { ClientOnboardingPage } from "@/pages/cabinet/client-onboarding";
import { ClientVerifyEmailPage } from "@/pages/cabinet/client-verify-email";
import { ClientVerifyLinkEmailPage } from "@/pages/cabinet/client-verify-link-email";
import { ClientDashboardPage } from "@/pages/cabinet/client-dashboard";
import { ClientTariffsPage } from "@/pages/cabinet/client-tariffs";
import { ClientProfilePage } from "@/pages/cabinet/client-profile";
import { ClientReferralPage } from "@/pages/cabinet/client-referral";
import { ClientSubscribePage } from "@/pages/cabinet/client-subscribe";
import { ClientYooMoneyPayPage } from "@/pages/cabinet/client-yoomoney-pay";
import { ClientExtraOptionsPage } from "@/pages/cabinet/client-extra-options";
import { ClientProxyPage } from "@/pages/cabinet/client-proxy";
import { ClientSingboxPage } from "@/pages/cabinet/client-singbox";
import { ClientTicketsPage } from "@/pages/cabinet/client-tickets";
import { ClientCustomBuildPage } from "@/pages/cabinet/client-custom-build";
import { ClientGiftsPage } from "@/pages/cabinet/client-gifts";
import { GiftActivatePage } from "@/pages/gift-activate";
import { LandingPage } from "@/pages/landing";
import type { PublicConfig } from "@/lib/api";

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
    return (
      <div className="min-h-svh flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-background to-muted/20">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-muted-foreground">Загрузка…</p>
      </div>
    );
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
        element={
          <RequireAuth>
            <>
              <CmdKPalette />
              <DashboardLayout />
            </>
          </RequireAuth>
        }
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
        <Route path="video-instructions" element={<ForceChangePassword><VideoInstructionsPage /></ForceChangePassword>} />
        <Route path="broadcast" element={<ForceChangePassword><BroadcastPage /></ForceChangePassword>} />
        <Route path="auto-broadcast" element={<ForceChangePassword><AutoBroadcastPage /></ForceChangePassword>} />
        <Route path="proxy" element={<ForceChangePassword><ProxyPage /></ForceChangePassword>} />
        <Route path="singbox" element={<ForceChangePassword><SingboxPage /></ForceChangePassword>} />
        <Route path="backup" element={<ForceChangePassword><BackupPage /></ForceChangePassword>} />
        <Route path="contests" element={<ForceChangePassword><ContestsPage /></ForceChangePassword>} />
        <Route path="tickets" element={<ForceChangePassword><AdminTicketsPage /></ForceChangePassword>} />
        <Route path="referral-network" element={<ForceChangePassword><ReferralNetworkPage /></ForceChangePassword>} />
        <Route path="traffic-abuse" element={<ForceChangePassword><TrafficAbusePage /></ForceChangePassword>} />
        <Route path="api-keys" element={<ForceChangePassword><ApiKeysPage /></ForceChangePassword>} />
        <Route path="bots" element={<ForceChangePassword><BotsPage /></ForceChangePassword>} />
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
          <ClientAuthProvider>
            <GiftActivatePage />
          </ClientAuthProvider>
        }
      />

      <Route
        path="/cabinet"
        element={
          <ClientAuthProvider>
            <CabinetLayout />
          </ClientAuthProvider>
        }
      >
        <Route index element={<CabinetIndexRedirect />} />
        <Route path="login" element={<ClientLoginPage />} />
        <Route path="register" element={<ClientRegisterPage />} />
        <Route path="verify-email" element={<ClientVerifyEmailPage />} />
        <Route path="verify-link-email" element={<ClientVerifyLinkEmailPage />} />
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
  );
}

function TitleAndThemeSync() {
  const location = useLocation();
  const [config, setConfig] = useState<{ serviceName: string; favicon: string | null } | null>(null);

  // Подтягиваем конфиг при смене маршрута (в т.ч. после сохранения настроек), чтобы favicon обновился
  useEffect(() => {
    api
      .getPublicConfig()
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
          <PwaUpdatePrompt />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
