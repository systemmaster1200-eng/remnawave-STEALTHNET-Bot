import { useEffect, useRef, useState, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { LogIn, Shield, Loader2 } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import type { PublicConfig } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

export function ClientLoginPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [authMode, setAuthMode] = useState<"password" | "email_code">("password");
  const [emailError, setEmailError] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [brand, setBrand] = useState<{ serviceName: string; logo: string | null }>({
    serviceName: "",
    logo: null,
  });
  const [telegramBotUsername, setTelegramBotUsername] = useState<string | null>(null);
  const [emailCodeLoginEnabled, setEmailCodeLoginEnabled] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [publicAppUrl, setPublicAppUrl] = useState<string | null>(null);
  const [appleEnabled, setAppleEnabled] = useState(false);
  const [tgAuthPending, setTgAuthPending] = useState(false);
  const [showTgFallback, setShowTgFallback] = useState(false);
  const [telegramBotId, setTelegramBotId] = useState<string | null>(null);
  const tgPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tgFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchParams] = useSearchParams();
  const { login, requestEmailCode, loginByEmailCode, loginByGoogle, loginByApple, loginByTelegramDeepLink, registerByTelegram } = useClientAuth();
  const navigate = useNavigate();

  function validateEmail(value: string): string {
    if (!value.trim()) return t("cabinet.login.email_required");
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) return t("cabinet.login.email_invalid");
    return "";
  }

  function handleEmailBlur() {
    setEmailError(validateEmail(email));
  }

  function handleEmailChange(e: React.ChangeEvent<HTMLInputElement>) {
    setEmail(e.target.value);
    if (emailError) setEmailError("");
  }

  function validateAll(): boolean {
    const emailErr = validateEmail(email);
    setEmailError(emailErr);
    return !emailErr;
  }

  // Сохраняем UTM из URL для последующей регистрации (если пользователь перейдёт на /cabinet/register)
  useEffect(() => {
    const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
    const utm: Record<string, string> = {};
    for (const k of keys) {
      const v = searchParams.get(k)?.trim();
      if (v) utm[k] = v;
    }
    if (Object.keys(utm).length > 0) {
      try {
        localStorage.setItem("stealthnet_utm", JSON.stringify(utm));
      } catch {
        // ignore
      }
    }
  }, [searchParams]);

  useEffect(() => {
    api
      .getPublicConfig()
      .then((c: PublicConfig) => {
        setBrand({ serviceName: c.serviceName ?? "", logo: c.logo ?? null });
        setTelegramBotUsername(c.telegramBotUsername ?? null);
        setTelegramBotId(c.telegramBotId ?? null);
        setGoogleEnabled(!!c.googleLoginEnabled);
        setEmailCodeLoginEnabled(c.emailCodeLoginEnabled === true);
        setGoogleClientId(c.googleClientId ?? null);
        setPublicAppUrl(c.publicAppUrl ?? null);
        setAppleEnabled(!!c.appleLoginEnabled);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!emailCodeLoginEnabled && authMode === "email_code") {
      setAuthMode("password");
      setEmailCode("");
      setSuccessMessage("");
    }
  }, [emailCodeLoginEnabled, authMode]);

  useEffect(() => {
    return () => {
      if (tgPollRef.current) clearInterval(tgPollRef.current);
      if (tgFallbackTimerRef.current) clearTimeout(tgFallbackTimerRef.current);
    };
  }, []);

  const handleTelegramLogin = useCallback(async () => {
    if (!telegramBotUsername || tgAuthPending) return;
    setError("");
    setTgAuthPending(true);
    setShowTgFallback(false);

    try {
      const { token } = await api.clientTelegramLoginToken();

      // Открываем Telegram через deep link (tg:// протокол — работает без VPN)
      const deepLink = `tg://resolve?domain=${telegramBotUsername}&start=auth_${token}`;
      window.open(deepLink, "_blank");

      // Через 15 секунд показываем фоллбэк-кнопку (веб-версия OAuth)
      if (tgFallbackTimerRef.current) clearTimeout(tgFallbackTimerRef.current);
      tgFallbackTimerRef.current = setTimeout(() => setShowTgFallback(true), 15_000);

      // Поллинг каждые 2 секунды
      if (tgPollRef.current) clearInterval(tgPollRef.current);
      let attempts = 0;
      const maxAttempts = 150; // 5 минут
      tgPollRef.current = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
          if (tgPollRef.current) clearInterval(tgPollRef.current);
          setTgAuthPending(false);
          setError(t("cabinet.login.error_timeout"));
          return;
        }
        try {
          const res = await api.clientTelegramLoginCheck(token);
          if (res.confirmed) {
            if (tgPollRef.current) clearInterval(tgPollRef.current);
            if (tgFallbackTimerRef.current) clearTimeout(tgFallbackTimerRef.current);
            loginByTelegramDeepLink(res);
            setTgAuthPending(false);
            navigate("/cabinet", { replace: true });
          }
        } catch {
          // Ошибка поллинга — продолжаем
        }
      }, 2000);
    } catch (err) {
      setTgAuthPending(false);
      setError(err instanceof Error ? err.message : t("cabinet.login.error_telegram"));
    }
  }, [telegramBotUsername, tgAuthPending, loginByTelegramDeepLink, navigate, t]);

  // Обработка OAuth авторизации через Telegram (popup)
  const tgOAuthPopupRef = useRef<Window | null>(null);
  const tgOAuthDoneRef = useRef(false);

  const handleTgOAuthResult = useCallback(
    (authData: { id?: number; username?: string } | false | undefined) => {
      if (!authData || !authData.id || tgOAuthDoneRef.current) return;
      tgOAuthDoneRef.current = true;

      if (tgPollRef.current) clearInterval(tgPollRef.current);
      if (tgFallbackTimerRef.current) clearTimeout(tgFallbackTimerRef.current);
      setTgAuthPending(false);
      setShowTgFallback(false);

      registerByTelegram({
        telegramId: String(authData.id),
        telegramUsername: authData.username,
      })
        .then(() => navigate("/cabinet", { replace: true }))
        .catch((err: unknown) => setError(err instanceof Error ? err.message : t("cabinet.login.error_telegram")));
    },
    [registerByTelegram, navigate, t],
  );

  // Слушаем postMessage от попапа (Telegram шлёт JSON-строку с event:"auth_result")
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!event.origin.includes("telegram.org")) return;
      if (tgOAuthPopupRef.current && event.source !== tgOAuthPopupRef.current) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.event === "auth_result") {
          handleTgOAuthResult(data.result);
        }
      } catch {
        // не JSON — игнорируем
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [handleTgOAuthResult]);

  const handleTelegramOAuthFallback = useCallback(() => {
    if (!telegramBotId) return;
    tgOAuthDoneRef.current = false;
    const popupUrl =
      `https://oauth.telegram.org/auth?bot_id=${encodeURIComponent(telegramBotId)}` +
      `&origin=${encodeURIComponent(window.location.origin)}` +
      `&request_access=write` +
      `&return_to=${encodeURIComponent(window.location.href)}`;
    const w = 550;
    const h = 470;
    const left = Math.max(0, (screen.width - w) / 2) + ((screen as unknown as Record<string, number>).availLeft || 0);
    const top = Math.max(0, (screen.height - h) / 2) + ((screen as unknown as Record<string, number>).availTop || 0);
    const popup = window.open(
      popupUrl,
      "telegram_oauth_bot" + telegramBotId,
      `width=${w},height=${h},left=${left},top=${top},status=0,location=0,menubar=0,toolbar=0`,
    );
    tgOAuthPopupRef.current = popup;

    // Мониторим закрытие попапа — если юзер уже залогинен, Telegram закроет окно
    // и данные нужно получить через XHR fallback (как делает оригинальный виджет)
    if (popup) {
      const checkClosed = () => {
        if (!popup || popup.closed) {
          if (tgOAuthDoneRef.current) return;
          // Попап закрылся без postMessage — пробуем получить данные через API
          fetch("https://oauth.telegram.org/auth/get", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            credentials: "include",
            body: `bot_id=${encodeURIComponent(telegramBotId)}`,
          })
            .then((r) => r.json())
            .then((result: { user?: { id?: number; username?: string }; origin?: string }) => {
              if (result.user) {
                handleTgOAuthResult(result.user);
              }
            })
            .catch(() => {
              // XHR fallback тоже не сработал — ничего не делаем
            });
          return;
        }
        setTimeout(checkClosed, 100);
      };
      setTimeout(checkClosed, 100);
    }
  }, [telegramBotId, handleTgOAuthResult]);

  const handleGoogleLogin = useCallback(() => {
    if (!googleEnabled || !googleClientId) return;
    setError("");
    const state = "google_" + Math.random().toString(36).slice(2);
    const nonce = Math.random().toString(36).slice(2);
    try {
      sessionStorage.setItem("stealthnet_google_oauth_state", state);
      sessionStorage.setItem("stealthnet_google_oauth_nonce", nonce);
    } catch {
      // ignore
    }
    const baseUrl = (publicAppUrl ?? "").trim().replace(/\/$/, "") || window.location.origin;
    const redirectUri = baseUrl + "/cabinet/login";
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", googleClientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "id_token");
    url.searchParams.set("scope", "openid email");
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("state", state);
    window.location.href = url.toString();
  }, [googleEnabled, googleClientId, publicAppUrl]);

  useEffect(() => {
    const hash = window.location.hash?.replace("#", "") || "";
    const params = new URLSearchParams(hash);
    const state = params.get("state") || "";
    if (!state.startsWith("google_") || !params.get("id_token")) return;
    const idToken = params.get("id_token");
    if (!idToken) return;
    try {
      const saved = sessionStorage.getItem("stealthnet_google_oauth_state");
      if (saved !== state) return;
      sessionStorage.removeItem("stealthnet_google_oauth_state");
      sessionStorage.removeItem("stealthnet_google_oauth_nonce");
    } catch {
      /* ignore */
    }
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setLoading(true);
    loginByGoogle(idToken)
      .then(() => navigate("/cabinet", { replace: true }))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : t("cabinet.login.error_google")))
      .finally(() => setLoading(false));
  }, [loginByGoogle, navigate, t]);

  const handleAppleLogin = useCallback(async () => {
    if (!appleEnabled) return;
    setError("");
    setLoading(true);
    try {
      const cfg = await api.getPublicConfig();
      const appleClientIdVal = cfg.appleClientId;
      if (!appleClientIdVal) throw new Error("Apple Sign In not configured");
      const baseUrl = (cfg.publicAppUrl ?? "").trim().replace(/\/$/, "") || window.location.origin;
      const redirectUri = baseUrl + "/cabinet/login";
      const state = Math.random().toString(36).slice(2);
      const url = new URL("https://appleid.apple.com/auth/authorize");
      url.searchParams.set("client_id", appleClientIdVal);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code id_token");
      url.searchParams.set("response_mode", "fragment");
      url.searchParams.set("scope", "email");
      url.searchParams.set("state", state);
      window.location.href = url.toString();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cabinet.login.error_apple"));
      setLoading(false);
    }
  }, [appleEnabled, t]);

  useEffect(() => {
    const hash = window.location.hash?.replace("#", "") || "";
    const params = new URLSearchParams(hash);
    if (params.get("state")?.startsWith("google_")) return;
    if (!params.get("id_token")) return;
    const idToken = params.get("id_token");
    if (!idToken) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setLoading(true);
    loginByApple(idToken)
      .then(() => navigate("/cabinet", { replace: true }))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : t("cabinet.login.error_apple")))
      .finally(() => setLoading(false));
  }, [loginByApple, navigate, t]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccessMessage("");
    
    if (!validateAll()) {
      return;
    }
    
    setLoading(true);
    try {
      if (authMode === "email_code") {
        await loginByEmailCode(email, emailCode.trim());
      } else {
        await login(email, password);
      }
      navigate("/cabinet", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cabinet.login.error_login"));
    } finally {
      setLoading(false);
    }
  }

  async function handleSendCode() {
    setError("");
    setSuccessMessage("");
    if (!validateAll()) return;
    setSendingCode(true);
    try {
      const message = await requestEmailCode(email);
      setSuccessMessage(message || t("cabinet.login.code_sent"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cabinet.login.error_send_code"));
    } finally {
      setSendingCode(false);
    }
  }

  return (
    <div className="min-h-svh flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background blobs */}
      <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-primary/20 blur-[120px] pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-primary/10 blur-[120px] pointer-events-none" />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md"
      >
        <div className="flex items-center justify-center gap-2 mb-6 min-h-[2.5rem]">
          {brand.logo ? (
            <span className="flex items-center justify-center h-11 px-3 rounded-xl dark:bg-transparent bg-zinc-900">
              <img src={brand.logo} alt="" className="h-8 max-w-[140px] object-contain" />
            </span>
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shrink-0">
              <Shield className="h-6 w-6" />
            </span>
          )}
          {brand.serviceName ? <span className="font-semibold text-xl">{brand.serviceName}</span> : null}
        </div>
        <div className="relative rounded-[2.5rem] border border-white/10 dark:border-white/5 bg-background/40 backdrop-blur-2xl shadow-2xl overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
          <div className="p-8 sm:p-10 relative z-10">

          
            <div className="space-y-1 text-center mb-8">

            <div className="flex justify-center mb-2">
              <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10 border border-primary/20 mb-2">
                <LogIn className="h-10 w-10 text-primary" />
              </div>
            </div>
            
              <h2 className="text-3xl font-extrabold tracking-tight mb-2">{t("cabinet.login.title")}</h2>

            <p className="text-muted-foreground text-sm">{t("cabinet.login.subtitle")}</p>
          
            </div>

          
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Скрытое поле: iOS/Safari реже выводит панель автозаполнения на каждый символ */}
              <input type="text" name="prevent_autofill" autoComplete="off" tabIndex={-1} className="absolute opacity-0 pointer-events-none h-0 w-0 overflow-hidden" aria-hidden />
              {error && (
                <div className="rounded-md bg-destructive/10 text-destructive text-sm p-3">
                  {error}
                </div>
              )}
              {successMessage && (
                <div className="rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-sm p-3">
                  {successMessage}
                </div>
              )}
              {emailCodeLoginEnabled && (
                <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode("password");
                      setError("");
                      setSuccessMessage("");
                    }}
                    className={cn("h-9 rounded-lg text-sm transition-colors", authMode === "password" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
                  >
                    {t("cabinet.login.mode_password")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode("email_code");
                      setError("");
                      setSuccessMessage("");
                    }}
                    className={cn("h-9 rounded-lg text-sm transition-colors", authMode === "email_code" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
                  >
                    {t("cabinet.login.mode_email_code")}
                  </button>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email"
                  type="email"
                  name="login_email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={handleEmailChange}
                  onBlur={handleEmailBlur}
                  required
                  autoComplete="off"
                  data-form-type="other"
                   className={cn("h-12 rounded-xl bg-background/50 backdrop-blur-sm border-white/10 focus-visible:ring-primary/50 transition-all", emailError ? "border-destructive focus-visible:ring-destructive" : "")}
                />
                {emailError && <p className="text-xs text-destructive">{emailError}</p>}
              </div>
              {authMode === "password" ? (
                <div className="space-y-2">
                  <Label htmlFor="password">{t("cabinet.login.password_label")}</Label>
                  <Input id="password" type="password" name="login_password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="off" data-form-type="other" className="h-12 rounded-xl bg-background/50 backdrop-blur-sm border-white/10 focus-visible:ring-primary/50 transition-all" />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="email_code">{t("cabinet.login.code_label")}</Label>
                  <Input
                    id="email_code"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder={t("cabinet.login.code_placeholder")}
                    value={emailCode}
                    onChange={(e) => setEmailCode(e.target.value.replace(/\D+/g, ""))}
                    required
                    className="h-12 rounded-xl bg-background/50 backdrop-blur-sm border-white/10 focus-visible:ring-primary/50 transition-all"
                  />
                  <Button type="button" variant="outline" className="w-full" onClick={handleSendCode} disabled={sendingCode || loading}>
                    {sendingCode ? t("cabinet.login.code_send_loading") : t("cabinet.login.code_send")}
                  </Button>
                </div>
              )}
              <Button type="submit" className="w-full h-14 rounded-2xl text-base font-bold shadow-xl hover:scale-[1.02] transition-all gap-2" disabled={loading}>
                {loading ? t("cabinet.login.submit_loading") : t("cabinet.login.submit")}
              </Button>
              <div className="text-right -mt-1">
                <Link to="/cabinet/forgot-password" className="text-xs text-muted-foreground hover:text-primary hover:underline">
                  {t("cabinet.login.forgot_password")}
                </Link>
              </div>
              {(telegramBotUsername || googleEnabled || appleEnabled) && (
                <div className="space-y-3">
                  <div className="relative flex items-center gap-2">
                    <div className="flex-1 border-t border-border" />
                    <span className="text-xs text-muted-foreground px-2">{t("cabinet.login.or")}</span>
                    <div className="flex-1 border-t border-border" />
                  </div>
                  {googleEnabled && googleClientId && (
                    <div className="flex flex-wrap items-center justify-center gap-3">
                      <button
                        type="button"
                        onClick={handleGoogleLogin}
                        disabled={loading}
                        title={t("cabinet.login.google_title")}
                        className={cn(
                          "h-11 w-11 shrink-0 rounded-full flex items-center justify-center",
                          "border border-border bg-muted/50 hover:bg-muted transition-colors",
                          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        )}
                      >
                        <GoogleIcon className="h-5 w-5" />
                      </button>
                    </div>
                  )}
                  {appleEnabled && (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-11 gap-2"
                      onClick={handleAppleLogin}
                      disabled={loading}
                    >
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
                      {t("cabinet.login.apple")}
                    </Button>
                  )}
                  {telegramBotUsername && (
                    <div className="space-y-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full h-11 gap-2"
                        onClick={handleTelegramLogin}
                        disabled={loading || tgAuthPending}
                      >
                        {tgAuthPending ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {t("cabinet.login.telegram_pending")}
                          </>
                        ) : (
                          <>
                            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                            {t("cabinet.login.telegram")}
                          </>
                        )}
                      </Button>
                      {showTgFallback && telegramBotId && (
                        <Button
                          type="button"
                          variant="ghost"
                          className="w-full h-9 gap-2 text-xs text-muted-foreground hover:text-foreground"
                          onClick={handleTelegramOAuthFallback}
                        >
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                          {t("cabinet.login.telegram_fallback")}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
              <p className="text-center text-sm text-muted-foreground">
                {t("cabinet.login.no_account")}{" "}
                <Link to="/cabinet/register" className="text-primary hover:underline">
                  {t("cabinet.login.register_link")}
                </Link>
              </p>
            </form>
          
        
          </div>
        </div>
      </motion.div>
    </div>
  );
}
