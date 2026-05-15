import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { User, Wallet, Copy, Check, CreditCard, Loader2, Link2, Mail, Fingerprint, CalendarDays, Shield, KeyRound, Monitor, Trash2, Zap } from "lucide-react";
import { useCabinetDesign } from "@/lib/use-cabinet-design";
import { StealthProfile } from "@/pages/cabinet/stealth/stealth-profile";
import { QRCodeSVG } from "qrcode.react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetMiniapp } from "@/pages/cabinet/cabinet-layout";
import { PayNowPanel } from "@/components/payment/pay-now-panel";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { ClientPayment } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
function formatDate(s: string | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("ru-RU");
  } catch {
    return s;
  }
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency.toUpperCase() === "USD" ? "USD" : currency.toUpperCase() === "RUB" ? "RUB" : "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatPaymentStatus(status: string, t: (key: string) => string): string {
  const s = (status || "").toLowerCase();
  if (s === "paid") return t("cabinet.profile.payment_paid");
  if (s === "pending") return t("cabinet.profile.payment_pending");
  if (s === "failed") return t("cabinet.profile.payment_failed");
  if (s === "refunded") return t("cabinet.profile.payment_refunded");
  return status || "—";
}

export function ClientProfilePage() {
  const design = useCabinetDesign();
  if (design === "stealth") return <StealthProfile />;
  return <ClassicProfilePage />;
}

function ClassicProfilePage() {
  const { t } = useTranslation();
  const { state, refreshProfile } = useClientAuth();
  const [payments, setPayments] = useState<ClientPayment[]>([]);
  const [copiedRef, setCopiedRef] = useState<"site" | "bot" | null>(null);
  const [plategaMethods, setPlategaMethods] = useState<{ id: number; label: string }[]>([]);
  const [yoomoneyEnabled, setYoomoneyEnabled] = useState(false);
  const [yookassaEnabled, setYookassaEnabled] = useState(false);
  const [cryptopayEnabled, setCryptopayEnabled] = useState(false);
  const [heleketEnabled, setHeleketEnabled] = useState(false);
  const [lavaEnabled, setLavaEnabled] = useState(false);
  // Lava.top removed from balance top-up — оставлен только для тарифов (см. client-tariffs.tsx)
  const [overpayEnabled, setOverpayEnabled] = useState(false);
  const [paymentProviders, setPaymentProviders] = useState<{ id: string; label: string; sortOrder: number }[]>([]);
  const [publicAppUrl, setPublicAppUrl] = useState<string | null>(null);
  const [yookassaRecurringEnabled, setYookassaRecurringEnabled] = useState(false);
  const [unlinkingPayment, setUnlinkingPayment] = useState(false);
  const [telegramBotUsername, setTelegramBotUsername] = useState<string | null>(null);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpModalOpen, setTopUpModalOpen] = useState(false);
  const [topUpLoading, setTopUpLoading] = useState(false);
  const [topUpError, setTopUpError] = useState<string | null>(null);
  const [readyUrl, setReadyUrl] = useState<{ url: string; provider: string } | null>(null);
  const [linkTelegramCode, setLinkTelegramCode] = useState<string | null>(null);
  const [linkTelegramLoading, setLinkTelegramLoading] = useState(false);
  const [linkTelegramError, setLinkTelegramError] = useState<string | null>(null);
  const [linkEmailValue, setLinkEmailValue] = useState("");
  const [linkEmailLoading, setLinkEmailLoading] = useState(false);
  const [linkEmailSent, setLinkEmailSent] = useState(false);
  const [linkEmailError, setLinkEmailError] = useState<string | null>(null);
  const [paymentsHistoryOpen, setPaymentsHistoryOpen] = useState(false);
  const [devices, setDevices] = useState<{ hwid: string; platform?: string; deviceModel?: string; createdAt?: string }[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [deletingHwid, setDeletingHwid] = useState<string | null>(null);
  const [twoFaEnableOpen, setTwoFaEnableOpen] = useState(false);
  const [twoFaDisableOpen, setTwoFaDisableOpen] = useState(false);
  const [twoFaSetupData, setTwoFaSetupData] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [twoFaStep, setTwoFaStep] = useState<1 | 2>(1);
  const [twoFaCode, setTwoFaCode] = useState("");
  const [twoFaLoading, setTwoFaLoading] = useState(false);
  const [twoFaError, setTwoFaError] = useState<string | null>(null);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);
  const [changePasswordSuccess, setChangePasswordSuccess] = useState(false);
  // Установка пароля (для юзеров без пароля — зарегистрировались через Telegram/Google/Apple).
  const [setPasswordOpen, setSetPasswordOpen] = useState(false);
  const [setPasswordNew, setSetPasswordNew] = useState("");
  const [setPasswordConfirm, setSetPasswordConfirm] = useState("");
  const [setPasswordLoading, setSetPasswordLoading] = useState(false);
  const [setPasswordError, setSetPasswordError] = useState<string | null>(null);
  const [setPasswordSuccess, setSetPasswordSuccess] = useState(false);

  const client = state.client;
  const token = state.token;
  const currency = (client?.preferredCurrency ?? "usd").toLowerCase();

  useEffect(() => {
    if (token) {
      refreshProfile().catch(() => { });
    }
  }, [token, refreshProfile]);

  useEffect(() => {
    if (token) {
      api.clientPayments(token).then((r) => setPayments(r.items ?? [])).catch(() => { });
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    setDevicesLoading(true);
    setDevicesError(null);
    api.getClientDevices(token)
      .then((r) => setDevices(r.devices ?? []))
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Подписка не привязана")) {
          setDevicesError("NO_SUBSCRIPTION");
        } else {
          setDevicesError(t("cabinet.profile.devices_error_load"));
        }
        setDevices([]);
      })
      .finally(() => setDevicesLoading(false));
  }, [token]);

  async function deleteDevice(hwid: string) {
    if (!token) return;
    setDeletingHwid(hwid);
    try {
      await api.deleteClientDevice(token, hwid);
      setDevices((prev) => prev.filter((d) => d.hwid !== hwid));
    } catch {
      setDevicesError(t("cabinet.profile.devices_error_disconnect"));
    } finally {
      setDeletingHwid(null);
    }
  }

  async function openTwoFaEnable() {
    if (!token) return;
    setTwoFaError(null);
    setTwoFaSetupData(null);
    setTwoFaStep(1);
    setTwoFaCode("");
    setTwoFaEnableOpen(true);
    setTwoFaLoading(true);
    try {
      const data = await api.client2FASetup(token);
      setTwoFaSetupData(data);
    } catch (e) {
      setTwoFaError(e instanceof Error ? e.message : t("cabinet.profile.2fa_error_setup"));
    } finally {
      setTwoFaLoading(false);
    }
  }
  function closeTwoFaEnable() {
    setTwoFaEnableOpen(false);
    setTwoFaSetupData(null);
    setTwoFaStep(1);
    setTwoFaCode("");
    setTwoFaError(null);
  }
  async function confirmTwoFaEnable() {
    if (!token || !twoFaCode.trim() || twoFaCode.length !== 6) {
      setTwoFaError(t("cabinet.profile.2fa_error_enter_code"));
      return;
    }
    setTwoFaError(null);
    setTwoFaLoading(true);
    try {
      await api.client2FAConfirm(token, twoFaCode.trim());
      refreshProfile();
      closeTwoFaEnable();
    } catch (e) {
      setTwoFaError(e instanceof Error ? e.message : t("cabinet.profile.2fa_error_invalid"));
    } finally {
      setTwoFaLoading(false);
    }
  }
  async function openTwoFaDisable() {
    setTwoFaDisableOpen(true);
    setTwoFaCode("");
    setTwoFaError(null);
  }
  async function confirmTwoFaDisable() {
    if (!token || !twoFaCode.trim() || twoFaCode.length !== 6) {
      setTwoFaError(t("cabinet.profile.2fa_error_enter_code"));
      return;
    }
    setTwoFaError(null);
    setTwoFaLoading(true);
    try {
      await api.client2FADisable(token, twoFaCode.trim());
      refreshProfile();
      setTwoFaDisableOpen(false);
      setTwoFaCode("");
    } catch (e) {
      setTwoFaError(e instanceof Error ? e.message : t("cabinet.profile.2fa_error_invalid"));
    } finally {
      setTwoFaLoading(false);
    }
  }

  async function submitChangePassword() {
    if (!token) return;
    if (!currentPassword.trim()) {
      setChangePasswordError(t("cabinet.profile.change_password_error_current"));
      return;
    }
    if (newPassword.length < 6) {
      setChangePasswordError(t("cabinet.profile.change_password_error_min"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setChangePasswordError(t("cabinet.profile.change_password_error_mismatch"));
      return;
    }
    setChangePasswordError(null);
    setChangePasswordLoading(true);
    try {
      await api.clientChangePassword(token, {
        currentPassword: currentPassword,
        newPassword: newPassword,
      });
      setChangePasswordSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => {
        setChangePasswordOpen(false);
        setChangePasswordSuccess(false);
      }, 2000);
    } catch (e) {
      setChangePasswordError(e instanceof Error ? e.message : t("cabinet.profile.change_password_error"));
    } finally {
      setChangePasswordLoading(false);
    }
  }

  function closeChangePassword() {
    setChangePasswordOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setChangePasswordError(null);
    setChangePasswordSuccess(false);
  }

  async function submitSetPassword() {
    if (!token) return;
    if (setPasswordNew.length < 6) {
      setSetPasswordError(t("cabinet.profile.change_password_error_min"));
      return;
    }
    if (setPasswordNew !== setPasswordConfirm) {
      setSetPasswordError(t("cabinet.profile.change_password_error_mismatch"));
      return;
    }
    setSetPasswordError(null);
    setSetPasswordLoading(true);
    try {
      await api.clientSetPassword(token, { newPassword: setPasswordNew });
      setSetPasswordSuccess(true);
      await refreshProfile().catch(() => {});
      setTimeout(() => {
        setSetPasswordOpen(false);
        setSetPasswordSuccess(false);
        setSetPasswordNew("");
        setSetPasswordConfirm("");
      }, 1500);
    } catch (e) {
      setSetPasswordError(e instanceof Error ? e.message : t("cabinet.profile.change_password_error"));
    } finally {
      setSetPasswordLoading(false);
    }
  }

  function closeSetPassword() {
    setSetPasswordOpen(false);
    setSetPasswordNew("");
    setSetPasswordConfirm("");
    setSetPasswordError(null);
    setSetPasswordSuccess(false);
  }

  useEffect(() => {
    api.getPublicConfig().then((c) => {
      setPlategaMethods(c.plategaMethods ?? []);
      setYoomoneyEnabled(Boolean(c.yoomoneyEnabled));
      setYookassaEnabled(Boolean(c.yookassaEnabled));
      setCryptopayEnabled(Boolean(c.cryptopayEnabled));
      setHeleketEnabled(Boolean(c.heleketEnabled));
      setLavaEnabled(Boolean(c.lavaEnabled));
      setOverpayEnabled(Boolean(c.overpayEnabled));
      setPaymentProviders(c.paymentProviders ?? []);
      setPublicAppUrl(c.publicAppUrl ?? null);
      setTelegramBotUsername(c.telegramBotUsername ?? null);
      setYookassaRecurringEnabled(Boolean(c.yookassaRecurringEnabled));
    }).catch(() => { });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    if (params.get("yoomoney") === "connected" || params.get("yoomoney_form") === "success" || params.get("yookassa") === "success" || params.get("heleket") === "success") {
      refreshProfile().catch(() => { });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refreshProfile]);

  async function startTopUp(methodId: number) {
    if (!token || !client) return;
    const amount = Number(topUpAmount?.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setTopUpError(t("cabinet.profile.top_up_enter_amount"));
      return;
    }
    setTopUpError(null);
    setTopUpLoading(true);
    try {
      const res = await api.clientCreatePlategaPayment(token, {
        amount,
        currency,
        paymentMethod: methodId,
        description: t("cabinet.profile.top_up_description"),
      });
      if (res.paymentUrl) setReadyUrl({ url: res.paymentUrl, provider: "Platega" });
    } catch (e) {
      setTopUpError(e instanceof Error ? e.message : t("cabinet.profile.top_up_error"));
    } finally {
      setTopUpLoading(false);
    }
  }

  async function startTopUpYoomoneyForm(paymentType: "PC" | "AC") {
    if (!token || !client) return;
    const amount = Number(topUpAmount?.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setTopUpError(t("cabinet.profile.top_up_enter_amount_rub"));
      return;
    }
    setTopUpError(null);
    setTopUpLoading(true);
    try {
      const res = await api.yoomoneyCreateFormPayment(token, { amount, paymentType });
      if (res.paymentUrl) {
        setReadyUrl({ url: res.paymentUrl, provider: "ЮMoney" });
      } else if (res.form) {
        const f = res.form;
        const yoomoneyUrl = `https://yoomoney.ru/quickpay/confirm.xml?quickpay-form=shop&receiver=${encodeURIComponent(f.receiver)}&sum=${f.sum}&label=${encodeURIComponent(f.label)}&paymentType=${f.paymentType}&successURL=${encodeURIComponent(f.successURL)}`;
        setReadyUrl({ url: yoomoneyUrl, provider: "ЮMoney" });
      }
    } catch (e) {
      setTopUpError(e instanceof Error ? e.message : t("cabinet.profile.top_up_error"));
    } finally {
      setTopUpLoading(false);
    }
  }

  async function startTopUpYookassa() {
    if (!token || !client) return;
    const amount = Number(topUpAmount?.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setTopUpError(t("cabinet.profile.top_up_enter_amount_rub"));
      return;
    }
    setTopUpError(null);
    setTopUpLoading(true);
    try {
      const res = await api.yookassaCreatePayment(token, { amount, currency: "RUB" });
      if (res.confirmationUrl) setReadyUrl({ url: res.confirmationUrl, provider: "ЮKassa" });
    } catch (e) {
      setTopUpError(e instanceof Error ? e.message : t("cabinet.profile.top_up_error"));
    } finally {
      setTopUpLoading(false);
    }
  }

  async function startTopUpCryptopay() {
    if (!token || !client) return;
    const amount = Number(topUpAmount?.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setTopUpError(t("cabinet.profile.top_up_enter_amount"));
      return;
    }
    setTopUpError(null);
    setTopUpLoading(true);
    try {
      const res = await api.cryptopayCreatePayment(token, { amount, currency });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "Crypto Bot" });
    } catch (e) {
      setTopUpError(e instanceof Error ? e.message : t("cabinet.profile.top_up_error"));
    } finally {
      setTopUpLoading(false);
    }
  }

  async function startTopUpHeleket() {
    if (!token || !client) return;
    const amount = Number(topUpAmount?.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setTopUpError(t("cabinet.profile.top_up_enter_amount"));
      return;
    }
    setTopUpError(null);
    setTopUpLoading(true);
    try {
      const res = await api.heleketCreatePayment(token, { amount, currency });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "Heleket" });
    } catch (e) {
      setTopUpError(e instanceof Error ? e.message : t("cabinet.profile.top_up_error"));
    } finally {
      setTopUpLoading(false);
    }
  }

  async function startTopUpLava() {
    if (!token || !client) return;
    const amount = Number(topUpAmount?.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setTopUpError(t("cabinet.profile.top_up_enter_amount"));
      return;
    }
    setTopUpError(null);
    setTopUpLoading(true);
    try {
      const res = await api.lavaCreatePayment(token, { amount, currency });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "LAVA" });
    } catch (e) {
      setTopUpError(e instanceof Error ? e.message : t("cabinet.profile.top_up_error"));
    } finally {
      setTopUpLoading(false);
    }
  }

  // Lava.top — только subscription для тарифов, не для top-up. Кнопка отсутствует, функция оставлена закомменченной для возможного будущего использования.
  // async function startTopUpLavatop() { ... }

  async function startTopUpOverpay() {
    if (!token || !client) return;
    const amount = Number(topUpAmount?.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setTopUpError(t("cabinet.profile.top_up_enter_amount"));
      return;
    }
    setTopUpError(null);
    setTopUpLoading(true);
    try {
      const res = await api.overpayCreatePayment(token, { amount, currency });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "Overpay" });
    } catch (e) {
      setTopUpError(e instanceof Error ? e.message : t("cabinet.profile.top_up_error"));
    } finally {
      setTopUpLoading(false);
    }
  }

  async function requestLinkTelegramCode() {
    if (!token) return;
    setLinkTelegramLoading(true);
    setLinkTelegramCode(null);
    setLinkTelegramError(null);
    try {
      const res = await api.clientLinkTelegramRequest(token);
      setLinkTelegramCode(res.code);
    } catch (err) {
      setLinkTelegramCode(null);
      setLinkTelegramError(err instanceof Error ? err.message : t("cabinet.profile.link_telegram_code_error"));
    } finally {
      setLinkTelegramLoading(false);
    }
  }

  async function linkTelegramFromMiniapp() {
    if (!token) return;
    const initData = (window as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData;
    if (!initData?.trim()) return;
    setLinkTelegramLoading(true);
    setLinkTelegramError(null);
    try {
      const res = await api.clientLinkTelegram(token, { initData });
      if (res.client) {
        refreshProfile();
        setLinkTelegramCode(null);
      }
    } catch (err) {
      setLinkTelegramError(err instanceof Error ? err.message : t("cabinet.profile.link_telegram_error"));
    } finally {
      setLinkTelegramLoading(false);
    }
  }

  async function sendLinkEmailRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !linkEmailValue.trim()) return;
    setLinkEmailError(null);
    setLinkEmailSent(false);
    setLinkEmailLoading(true);
    try {
      await api.clientLinkEmailRequest(token, { email: linkEmailValue.trim() });
      setLinkEmailSent(true);
      setLinkEmailValue("");
    } catch (err) {
      setLinkEmailError(err instanceof Error ? err.message : t("cabinet.profile.link_email_error"));
    } finally {
      setLinkEmailLoading(false);
    }
  }

  async function handleUnlinkPaymentMethod() {
    if (!token) return;
    setUnlinkingPayment(true);
    try {
      await api.yookassaUnlinkPaymentMethod(token);
      await refreshProfile();
    } catch (err) {
      console.error("Ошибка отвязки способа оплаты:", err);
    } finally {
      setUnlinkingPayment(false);
    }
  }

  const baseUrl = publicAppUrl ?? (typeof window !== "undefined" ? window.location.origin : "");
  const referralLinkSite =
    client?.referralCode && baseUrl
      ? `${String(baseUrl).replace(/\/$/, "")}/cabinet/register?ref=${encodeURIComponent(client.referralCode)}`
      : "";
  const referralLinkBot =
    client?.referralCode && telegramBotUsername
      ? `https://t.me/${telegramBotUsername.replace(/^@/, "")}?start=ref_${client.referralCode}`
      : "";
  const hasReferralLinks = Boolean(referralLinkSite || referralLinkBot);
  function copyReferral(which: "site" | "bot") {
    const url = which === "site" ? referralLinkSite : referralLinkBot;
    if (url) {
      navigator.clipboard.writeText(url);
      setCopiedRef(which);
      setTimeout(() => setCopiedRef(null), 2000);
    }
  }

  if (!client) return null;
  const isMiniapp = useCabinetMiniapp();
  // Реальный miniapp (TG WebApp) — только если доступен initData
  const isTgMiniapp = isMiniapp && Boolean((window as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData?.trim());
  const cardClass = isMiniapp ? "min-w-0 overflow-hidden" : "";

  return (
    <div className="space-y-6 w-full min-w-0 pb-10">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">{t("cabinet.profile.title")}</h1>
        <p className="text-muted-foreground text-sm mt-1 truncate">{t("cabinet.profile.subtitle")}</p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={`grid gap-6 items-stretch ${isMiniapp ? "grid-cols-1" : "lg:grid-cols-2"} min-w-0`}
      >
        <div data-tour="profile-settings" className={cn("relative flex flex-col h-full rounded-[2rem] shadow-[0_8px_40px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_40px_rgba(0,0,0,0.3)]", cardClass)}>
          <div className="absolute inset-0 overflow-hidden rounded-[2rem] border border-white/10 dark:border-white/5 bg-background/40 backdrop-blur-2xl">
            <div className="absolute -top-32 -right-32 h-64 w-64 rounded-full bg-primary/10 blur-[80px] pointer-events-none" />
          </div>

          <div className="relative p-6 sm:p-8 flex flex-col flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
                <User className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-bold tracking-tight text-foreground truncate">{t("cabinet.profile.data_heading")}</h3>
                <p className="text-xs text-muted-foreground mt-[1px] truncate">{t("cabinet.profile.contact_info")}</p>
              </div>
            </div>

            <div className="space-y-4 flex-1 min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-muted/40 border border-border/50 transition-colors hover:bg-muted/60 dark:bg-white/5 dark:border-white/5 dark:hover:bg-white/10">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="flex h-10 w-10 items-center justify-center shrink-0 rounded-xl bg-primary/10 text-primary">
                    <Fingerprint className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground mb-0.5">{t("cabinet.profile.account_id")}</p>
                    <p className="font-medium text-sm truncate font-mono select-all">{client.id}</p>
                  </div>
                </div>
              </div>

              {client.email != null && client.email !== "" ? (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-muted/40 border border-border/50 transition-colors hover:bg-muted/60 dark:bg-white/5 dark:border-white/5 dark:hover:bg-white/10">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="flex h-10 w-10 items-center justify-center shrink-0 rounded-xl bg-primary/10 text-primary">
                      <Mail className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground mb-0.5">Email</p>
                      <p className="font-medium text-sm truncate">{client.email}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 p-4 rounded-2xl bg-muted/40 border border-border/50 transition-colors hover:bg-muted/60 dark:bg-white/5 dark:border-white/5 dark:hover:bg-white/10">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="flex h-10 w-10 items-center justify-center shrink-0 rounded-xl bg-orange-500/10 text-orange-500">
                      <Mail className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground mb-0.5">Email</p>
                      <p className="font-medium text-sm truncate text-orange-500">{t("cabinet.profile.email_not_linked")}</p>
                    </div>
                  </div>
                  <form onSubmit={sendLinkEmailRequest} className="flex gap-2 mt-2">
                    <Input
                      type="email"
                      placeholder="email@example.com"
                      value={linkEmailValue}
                      onChange={(e) => setLinkEmailValue(e.target.value)}
                      className="h-9 bg-background/50 border-white/10 text-sm"
                      disabled={linkEmailLoading}
                    />
                    <Button type="submit" size="sm" className="h-9 shrink-0 gap-2 px-4 shadow-sm" disabled={linkEmailLoading || !linkEmailValue.trim()}>
                      {linkEmailLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                      <span className="hidden sm:inline">{t("cabinet.profile.link_email")}</span>
                    </Button>
                  </form>
                  {linkEmailSent && <p className="text-xs font-medium text-green-500 mt-1">{t("cabinet.profile.link_email_sent")}</p>}
                  {linkEmailError && <p className="text-xs font-medium text-destructive mt-1">{linkEmailError}</p>}
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-muted/40 border border-border/50 transition-colors hover:bg-muted/60 dark:bg-white/5 dark:border-white/5 dark:hover:bg-white/10">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="flex h-10 w-10 items-center justify-center shrink-0 rounded-xl bg-[#0088cc]/10 text-[#0088cc]">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.888-.667 3.475-1.512 5.79-2.511 6.945-2.993 3.303-1.385 3.99-1.623 4.43-1.63z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground mb-0.5">Telegram</p>
                    {client.telegramId ? (
                      <p className="font-medium text-sm truncate">
                        {client.telegramUsername ? `@${client.telegramUsername}` : `ID ${client.telegramId}`}
                      </p>
                    ) : (
                      <p className="font-medium text-sm truncate text-orange-500">{t("cabinet.profile.telegram_not_linked")}</p>
                    )}
                  </div>
                </div>
                {!client.telegramId && (
                  <div className="shrink-0">
                    {isTgMiniapp ? (
                      <Button variant="outline" size="sm" onClick={linkTelegramFromMiniapp} disabled={linkTelegramLoading} className="shadow-sm">
                        {linkTelegramLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : t("cabinet.profile.link_current")}
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={requestLinkTelegramCode} disabled={linkTelegramLoading || !!linkTelegramCode} className="shadow-sm">
                        {linkTelegramLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : t("cabinet.profile.get_code")}
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {!isTgMiniapp && !client.telegramId && linkTelegramCode && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="rounded-2xl border border-primary/20 bg-primary/5 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{t("cabinet.profile.link_code")}</p>
                    <p className="font-mono text-xl tracking-wider font-bold text-primary">{linkTelegramCode}</p>
                  </div>
                  <p className="text-xs text-muted-foreground/80">
                    {t("cabinet.profile.link_code_hint")} <code className="bg-primary/10 text-primary font-mono px-1.5 py-0.5 rounded">/link {linkTelegramCode}</code><br />{t("cabinet.profile.link_code_expires")}
                  </p>
                </motion.div>
              )}
              {linkTelegramError && (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs font-medium text-destructive px-1">
                  {linkTelegramError}
                </motion.p>
              )}

              <div className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-muted/40 border border-border/50 transition-colors hover:bg-muted/60 dark:bg-white/5 dark:border-white/5 dark:hover:bg-white/10">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="flex h-10 w-10 items-center justify-center shrink-0 rounded-xl bg-green-500/10 text-green-500">
                    <Wallet className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground mb-0.5">{t("cabinet.profile.balance_label")}</p>
                    <p className="font-bold text-lg truncate tracking-tight">{formatMoney(client.balance, client.preferredCurrency)}</p>
                  </div>
                </div>
                <Button variant="default" size="sm" className="bg-green-500 hover:bg-green-600 text-white shrink-0 shadow-lg shadow-green-500/20 px-5" onClick={() => {
                  const el = document.getElementById("topup");
                  if (el) el.scrollIntoView({ behavior: 'smooth' });
                }}>
                  {t("cabinet.profile.top_up")}
                </Button>
              </div>

              {client.createdAt && (
                <div className="flex items-center gap-4 p-4 rounded-2xl bg-muted/40 border border-border/50 transition-colors hover:bg-muted/60 dark:bg-white/5 dark:border-white/5 dark:hover:bg-white/10">
                  <div className="flex h-10 w-10 items-center justify-center shrink-0 rounded-xl bg-primary/10 text-primary">
                    <CalendarDays className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground mb-0.5">{t("cabinet.profile.registration_date")}</p>
                    <p className="text-sm font-medium">{new Date(client.createdAt).toLocaleDateString("ru-RU", { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                  </div>
                </div>
              )}

              {hasReferralLinks && (
                <div className="pt-4 border-t border-border/20 space-y-4">
                  <div>
                    <h4 className="text-sm font-bold text-foreground">{t("cabinet.profile.referral_program")}</h4>
                    <p className="text-xs text-muted-foreground mt-1">{t("cabinet.profile.referral_invite_hint")}</p>
                  </div>
                  <div className="space-y-2">
                    {referralLinkSite && (
                      <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-background/80 border border-border/30 dark:bg-white/5 dark:border-white/5">
                        <div className="shrink-0 w-12 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("cabinet.profile.site_label")}</div>
                        <code className="flex-1 min-w-[140px] truncate text-xs font-mono text-primary/80 select-all">{referralLinkSite}</code>
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg ml-auto" onClick={() => copyReferral("site")}>
                          {copiedRef === "site" ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                        </Button>
                      </div>
                    )}
                    {referralLinkBot && (
                      <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-background/80 border border-border/30 dark:bg-white/5 dark:border-white/5">
                        <div className="shrink-0 w-12 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("cabinet.profile.bot_label")}</div>
                        <code className="flex-1 min-w-[140px] truncate text-xs font-mono text-primary/80 select-all">{referralLinkBot}</code>
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg ml-auto" onClick={() => copyReferral("bot")}>
                          {copiedRef === "bot" ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div data-tour="password-change" className={cn("relative flex flex-col h-full rounded-[2rem] shadow-[0_8px_40px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_40px_rgba(0,0,0,0.3)]", cardClass)}>
          <div className="absolute inset-0 overflow-hidden rounded-[2rem] border border-white/10 dark:border-white/5 bg-background/40 backdrop-blur-2xl">
            <div className="absolute -bottom-32 -left-32 h-64 w-64 rounded-full bg-primary/10 blur-[80px] pointer-events-none" />
          </div>

          <div className="relative p-6 sm:p-8 flex flex-col flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-500 shrink-0">
                <Shield className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-bold tracking-tight text-foreground truncate">{t("cabinet.profile.security_heading")}</h3>
                <p className="text-xs text-muted-foreground mt-[1px] truncate">{t("cabinet.profile.security_subtitle")}</p>
              </div>
            </div>

            <div className="flex-1 flex flex-col gap-4 min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-muted/40 border border-border/50 transition-colors hover:bg-muted/60 dark:bg-white/5 dark:border-white/5 dark:hover:bg-white/10">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="flex h-10 w-10 items-center justify-center shrink-0 rounded-xl bg-primary/10 text-primary">
                    <KeyRound className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground mb-0.5">{t("cabinet.profile.2fa_label")}</p>
                    <p className="font-medium text-sm truncate">{t("cabinet.profile.2fa_multi_level")}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {client.totpEnabled ? (
                    <>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-green-500/20 text-green-700 dark:text-green-400 dark:bg-green-500/20">{t("cabinet.profile.2fa_enabled")}</span>
                      <Button variant="outline" size="sm" className="shadow-sm border-red-500/50 text-red-600 hover:bg-red-500/15 dark:text-red-400 dark:hover:bg-red-500/20" onClick={openTwoFaDisable}>{t("cabinet.profile.2fa_disable")}</Button>
                    </>
                  ) : (
                    <Button variant="outline" size="sm" className="shadow-sm" onClick={openTwoFaEnable}>{t("cabinet.profile.2fa_enable")}</Button>
                  )}
                </div>
              </div>

              {client.hasPassword === false && client.email ? (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-muted/40 border border-border/50 transition-colors hover:bg-muted/60 dark:bg-white/5 dark:border-white/5 dark:hover:bg-white/10">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="flex h-10 w-10 items-center justify-center shrink-0 rounded-xl bg-orange-500/10 text-orange-500">
                      <KeyRound className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground mb-0.5">{t("cabinet.profile.password_label")}</p>
                      <p className="font-medium text-sm truncate text-orange-500">{t("cabinet.profile.password_not_set")}</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="shadow-sm shrink-0" onClick={() => setSetPasswordOpen(true)}>
                    {t("cabinet.profile.password_set")}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-muted/40 border border-border/50 transition-colors hover:bg-muted/60 dark:bg-white/5 dark:border-white/5 dark:hover:bg-white/10">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="flex h-10 w-10 items-center justify-center shrink-0 rounded-xl bg-primary/10 text-primary">
                      <KeyRound className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground mb-0.5">{t("cabinet.profile.password_label")}</p>
                      <p className="font-medium text-sm truncate">{t("cabinet.profile.password_change_account")}</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="shadow-sm shrink-0" onClick={() => setChangePasswordOpen(true)}>
                    {t("cabinet.profile.password_change")}
                  </Button>
                </div>
              )}

              {yookassaRecurringEnabled && client.yookassaPaymentMethodTitle && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-muted/40 border border-border/50 transition-colors hover:bg-muted/60 dark:bg-white/5 dark:border-white/5 dark:hover:bg-white/10">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="flex h-10 w-10 items-center justify-center shrink-0 rounded-xl bg-primary/10 text-primary">
                      <CreditCard className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground mb-0.5">{t("cabinet.profile.payment_method")}</p>
                      <p className="font-medium text-sm truncate">{client.yookassaPaymentMethodTitle}</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shadow-sm shrink-0 border-red-500/50 text-red-600 hover:bg-red-500/15 dark:text-red-400 dark:hover:bg-red-500/20"
                    disabled={unlinkingPayment}
                    onClick={handleUnlinkPaymentMethod}
                  >
                    {unlinkingPayment ? <Loader2 className="w-4 h-4 animate-spin" /> : t("cabinet.profile.unlink")}
                  </Button>
                </div>
              )}

              <div className="flex-1 flex flex-col rounded-2xl bg-muted/40 border border-border/50 overflow-hidden dark:bg-white/5 dark:border-white/5">
                <div className="p-4 border-b border-border/50 dark:border-white/5">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="flex h-10 w-10 items-center justify-center shrink-0 rounded-xl bg-primary/10 text-primary">
                      <Monitor className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground mb-0.5">{t("cabinet.profile.sessions_label")}</p>
                      <p className="font-medium text-sm truncate">{t("cabinet.profile.sessions_desc")}</p>
                    </div>
                  </div>
                </div>
                <div className="flex-1 p-4 space-y-3 flex flex-col justify-center">
                  {devicesLoading ? (
                    <div className="flex items-center justify-center py-8 text-primary/60">
                      <Loader2 className="h-8 w-8 animate-spin" />
                    </div>
                  ) : devicesError === "NO_SUBSCRIPTION" ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center px-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/50 text-muted-foreground mb-3 border border-border/50">
                        <Monitor className="h-6 w-6 opacity-60" />
                      </div>
                      <p className="text-sm font-medium text-foreground">{t("cabinet.profile.no_devices_title")}</p>
                      <p className="text-xs text-muted-foreground mt-1 text-center max-w-[280px]">{t("cabinet.profile.devices_no_sub_hint")}</p>
                    </div>
                  ) : devicesError ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center px-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive mb-3">
                        <Monitor className="h-6 w-6 opacity-80" />
                      </div>
                      <p className="text-sm font-medium text-destructive">{devicesError}</p>
                      <p className="text-xs text-muted-foreground mt-1 text-center max-w-[250px]">{t("cabinet.profile.devices_error_hint")}</p>
                    </div>
                  ) : devices.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center px-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/50 text-muted-foreground mb-3 border border-border/50">
                        <Monitor className="h-6 w-6 opacity-60" />
                      </div>
                      <p className="text-sm font-medium text-foreground">{t("cabinet.profile.no_devices_title")}</p>
                      <p className="text-xs text-muted-foreground mt-1 text-center max-w-[280px]">{t("cabinet.profile.devices_empty_hint")}</p>
                    </div>
                  ) : (
                    <div className="flex flex-col h-full">
                      <p className="text-xs text-muted-foreground mb-3">{t("cabinet.profile.devices_disconnect_hint")}</p>
                      <div className="grid grid-cols-1 gap-2">
                        {devices.map((d) => {
                          const label = [d.platform, d.deviceModel].filter(Boolean).join(" · ") || (d.hwid.slice(0, 12) + (d.hwid.length > 12 ? "…" : ""));
                          const isDeleting = deletingHwid === d.hwid;
                          return (
                            <div key={d.hwid} className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-2xl bg-background/50 border border-border/50 transition-all hover:bg-muted/30 dark:bg-white/5 dark:border-white/5 dark:hover:bg-white/10">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                  <Monitor className="h-5 w-5" />
                                </div>
                                <div className="min-w-0">
                                  <span className="text-sm font-bold truncate block text-foreground" title={label}>{label}</span>
                                  <span className="text-[10px] sm:text-xs text-muted-foreground truncate block font-mono mt-0.5">{d.hwid.slice(0, 16)}…</span>
                                </div>
                              </div>
                              <Button variant="outline" size="sm" className="shrink-0 w-full sm:w-auto rounded-xl h-9 px-3 sm:px-4 shadow-sm border-destructive/20 text-destructive bg-destructive/5 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive dark:bg-destructive/10 transition-all" disabled={isDeleting} onClick={() => deleteDevice(d.hwid)}>
                                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2 opacity-80" />}
                                <span>{isDeleting ? t("cabinet.profile.devices_deleting") : t("cabinet.profile.device_disconnect")}</span>
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className={`grid gap-6 ${isMiniapp ? "grid-cols-1" : "lg:grid-cols-2"} min-w-0`}
      >
        {(plategaMethods.length > 0 || yoomoneyEnabled || yookassaEnabled || cryptopayEnabled || heleketEnabled || lavaEnabled || overpayEnabled) && (
          <div id="topup" className="relative flex flex-col rounded-[2rem] shadow-[0_8px_40px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_40px_rgba(0,0,0,0.3)]">
            <div className="absolute inset-0 overflow-hidden rounded-[2rem] border border-white/10 dark:border-white/5 bg-background/40 backdrop-blur-2xl">
              <div className="absolute -top-32 -left-32 h-64 w-64 rounded-full bg-primary/20 blur-[80px] pointer-events-none" />
            </div>

            <div className="relative p-6 sm:p-8 flex flex-col h-full">
              <div className="flex items-center gap-4 mb-8">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner shrink-0">
                  <CreditCard className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold tracking-tight text-foreground">{t("cabinet.profile.top_up_balance")}</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">{t("cabinet.profile.top_up_opens_tab")}</p>
                </div>
              </div>

              <div className="space-y-6 mt-auto">
                <div className="relative flex h-32 w-full items-center justify-center rounded-3xl border border-border/50 bg-background/50 shadow-sm transition-all focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
                  <Input
                    type="number"
                    min={1}
                    step={0.01}
                    placeholder="0"
                    value={topUpAmount}
                    onChange={(e) => setTopUpAmount(e.target.value)}
                    className="absolute inset-0 h-full w-full border-0 bg-transparent px-20 text-center text-5xl sm:text-6xl font-extrabold tracking-tighter shadow-none focus-visible:ring-0"
                    style={{ WebkitAppearance: "none", MozAppearance: "textfield" }}
                  />
                  <span className="pointer-events-none absolute right-[12%] top-1/2 -translate-y-1/2 text-2xl sm:text-3xl font-bold text-muted-foreground uppercase opacity-80">
                    {currency}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {[100, 300, 500, 1000].map((n) => {
                    const isActive = topUpAmount === String(n);
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setTopUpAmount(String(n))}
                        className={cn(
                          "flex items-center justify-center rounded-2xl py-3 text-sm font-bold transition-all duration-300",
                          isActive
                            ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30 scale-105"
                            : "bg-muted/60 text-foreground hover:bg-muted hover:scale-105"
                        )}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>

                {topUpError && (
                  <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-center text-sm font-medium text-destructive">
                    {topUpError}
                  </div>
                )}

                <Button
                  className="group relative w-full overflow-hidden rounded-2xl py-7 text-lg font-bold shadow-xl transition-all duration-300 hover:scale-[1.02] hover:shadow-primary/25"
                  onClick={() => {
                    const amount = Number(topUpAmount?.replace(",", "."));
                    if (!Number.isFinite(amount) || amount < 1) {
                      setTopUpError(t("cabinet.profile.top_up_min"));
                      return;
                    }
                    setTopUpError(null);
                    setTopUpModalOpen(true);
                  }}
                >
                  <div className="absolute inset-0 bg-white/20 translate-y-full transition-transform duration-300 group-hover:translate-y-0" />
                  <span className="relative flex items-center justify-center gap-2">
                    <CreditCard className="h-5 w-5" />
                    {t("cabinet.profile.top_up_pay")} {topUpAmount ? `${topUpAmount} ${currency.toUpperCase()}` : ""}
                  </span>
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="relative flex flex-col rounded-[2rem] shadow-[0_8px_40px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_40px_rgba(0,0,0,0.3)] min-h-[400px]">
          <div className="absolute inset-0 overflow-hidden rounded-[2rem] border border-white/10 dark:border-white/5 bg-background/40 backdrop-blur-2xl">
            <div className="absolute -bottom-32 -right-32 h-64 w-64 rounded-full bg-primary/10 blur-[80px] pointer-events-none" />
          </div>

          <div className="relative p-6 sm:p-8 flex flex-col h-full min-w-0">
            <div className="flex items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-4 min-w-0">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner shrink-0">
                  <Wallet className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xl font-bold tracking-tight text-foreground truncate">{t("cabinet.profile.payments_history")}</h3>
                  <p className="text-sm text-muted-foreground mt-0.5 truncate">{t("cabinet.profile.payments_last3")}</p>
                </div>
              </div>
              {payments.length > 3 && (
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => setPaymentsHistoryOpen(true)}>
                  {t("cabinet.profile.payments_all")} ({payments.length})
                </Button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar min-w-0 -mx-2 px-2">
              {payments.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center opacity-70">
                  <Wallet className="mb-3 h-10 w-10 text-muted-foreground" />
                  <p className="text-sm font-medium text-muted-foreground">{t("cabinet.profile.no_payments")}</p>
                </div>
              ) : (
                <ul className="space-y-3 min-w-0">
                  {payments.slice(0, 3).map((p) => (
                    <li
                      key={p.id}
                      className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-white/5 bg-white/5 hover:bg-white/10 dark:bg-black/10 dark:hover:bg-black/20 p-4 transition-all duration-300"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background/50 text-muted-foreground shadow-sm">
                          <Check className={cn("h-4 w-4", p.status?.toLowerCase() === "paid" && "text-green-500")} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate" title={p.orderId}>{p.orderId}</p>
                          <p className="text-xs text-muted-foreground">{formatDate(p.paidAt ?? p.createdAt)}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between sm:flex-col sm:items-end sm:justify-center shrink-0">
                        <span className="font-bold tracking-tight">{formatMoney(p.amount, p.currency)}</span>
                        <span className={cn(
                          "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full",
                          p.status?.toLowerCase() === "paid" ? "bg-green-500/10 text-green-500" : "bg-muted text-muted-foreground"
                        )}>
                          {formatPaymentStatus(p.status, t)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      <Dialog open={paymentsHistoryOpen} onOpenChange={setPaymentsHistoryOpen}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col" showCloseButton>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              {t("cabinet.profile.all_history")}
            </DialogTitle>
            <DialogDescription>
              {payments.length} {payments.length === 1 ? t("cabinet.profile.transactions_count_one") : payments.length < 5 ? t("cabinet.profile.transactions_count_few") : t("cabinet.profile.transactions_count_many")}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 min-h-0 -mx-1 px-1 space-y-2 py-2">
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">{t("cabinet.profile.no_payments")}</p>
            ) : (
              payments.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border bg-muted/30 p-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground">
                      <Check className={cn("h-3.5 w-3.5", p.status?.toLowerCase() === "paid" && "text-green-500")} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate" title={p.orderId}>{p.orderId}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(p.paidAt ?? p.createdAt)}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between sm:flex-col sm:items-end gap-1 shrink-0">
                    <span className="font-semibold text-sm">{formatMoney(p.amount, p.currency)}</span>
                    <span className={cn(
                      "text-[10px] font-medium uppercase px-2 py-0.5 rounded-full",
                      p.status?.toLowerCase() === "paid" ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-muted text-muted-foreground"
                    )}>
                      {formatPaymentStatus(p.status, t)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentsHistoryOpen(false)}>
              {t("cabinet.profile.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={topUpModalOpen}
        onOpenChange={(open) => {
          if (topUpLoading) return;
          setTopUpModalOpen(open);
          if (!open) setReadyUrl(null);
        }}
      >
        <DialogContent className="max-w-md p-6 rounded-3xl border border-border/50 bg-card/60 backdrop-blur-3xl shadow-2xl" showCloseButton={!topUpLoading} onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader className="mb-4 text-center sm:text-left">
            <DialogTitle className="text-2xl font-bold flex items-center justify-center sm:justify-start gap-2">
              <div className="p-2 bg-primary/10 rounded-xl">
                <Wallet className="h-6 w-6 text-primary" />
              </div>
              {t("cabinet.profile.payment_method")}
            </DialogTitle>
            <DialogDescription className="text-base font-medium mt-2">
              <div className="flex flex-col gap-2 mt-4 bg-background/50 p-4 rounded-2xl border border-border/50 text-left relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="flex justify-between items-center relative z-10">
                  <span className="text-muted-foreground">{t("cabinet.profile.top_up_to_pay")}</span>
                  <span className="font-bold text-xl text-primary">
                    {topUpAmount ? formatMoney(Number(topUpAmount.replace(",", ".")), currency.toUpperCase()) : "—"}
                  </span>
                </div>
              </div>
            </DialogDescription>
          </DialogHeader>

          {topUpError && (
            <div className="p-3 mb-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm text-center font-medium animate-in fade-in slide-in-from-top-2">
              {topUpError}
            </div>
          )}

          {readyUrl ? (
            <PayNowPanel
              url={readyUrl.url}
              provider={readyUrl.provider}
              onBack={() => setReadyUrl(null)}
              onPaid={() => { setTopUpModalOpen(false); setReadyUrl(null); }}
            />
          ) : (
          <div className="flex flex-col gap-3">
            {(() => {
              const providerLabel = (id: string, fallback: string) => paymentProviders.find((p) => p.id === id)?.label || fallback;
              const btnCls = cn("w-full", isMiniapp ? "justify-start gap-4 px-6 h-16 rounded-2xl border-white/5 bg-card/40 hover:bg-card/60" : "gap-3 hover:bg-background/80 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 rounded-xl h-14 border-border/50 group justify-center px-6 relative");

              const colorMap: Record<string, { bg10: string; bg20: string; text: string }> = {
                cryptopay: { bg10: "bg-yellow-500/10", bg20: "group-hover:bg-yellow-500/20", text: "text-yellow-500" },
                heleket: { bg10: "bg-orange-500/10", bg20: "group-hover:bg-orange-500/20", text: "text-orange-500" },
                yookassa: { bg10: "bg-green-500/10", bg20: "group-hover:bg-green-500/20", text: "text-green-500" },
                yoomoney: { bg10: "bg-green-500/10", bg20: "group-hover:bg-green-500/20", text: "text-green-500" },
                lava: { bg10: "bg-sky-500/10", bg20: "group-hover:bg-sky-500/20", text: "text-sky-500" },
                overpay: { bg10: "bg-indigo-500/10", bg20: "group-hover:bg-indigo-500/20", text: "text-indigo-500" },
              };

              type ProviderEntry = { id: string; enabled: boolean; onClick: () => void; label: string; icon: "crypto" | "card" };
              const providers: ProviderEntry[] = [
                { id: "cryptopay", enabled: cryptopayEnabled, onClick: () => startTopUpCryptopay(), label: providerLabel("cryptopay", "Crypto Bot"), icon: "crypto" },
                { id: "heleket", enabled: heleketEnabled, onClick: () => startTopUpHeleket(), label: providerLabel("heleket", "Heleket"), icon: "crypto" },
                { id: "yookassa", enabled: yookassaEnabled, onClick: () => startTopUpYookassa(), label: providerLabel("yookassa", t("cabinet.tariffs.sbp_cards_ru")), icon: "card" },
                { id: "yoomoney", enabled: yoomoneyEnabled, onClick: () => startTopUpYoomoneyForm("AC"), label: providerLabel("yoomoney", t("cabinet.tariffs.yoomoney_cards")), icon: "card" },
                { id: "lava", enabled: lavaEnabled && currency.toLowerCase() === "rub", onClick: () => startTopUpLava(), label: providerLabel("lava", "LAVA"), icon: "card" },
                // Lava.top — только subscription для тарифов, не для top-up баланса
                { id: "overpay", enabled: overpayEnabled, onClick: () => startTopUpOverpay(), label: providerLabel("overpay", "Overpay"), icon: "card" },
              ];

              const sortedProviders = paymentProviders.length > 0
                ? paymentProviders.map((pp) => providers.find((p) => p.id === pp.id)).filter((p): p is ProviderEntry => !!p)
                : providers;

              return (
                <>
                  {sortedProviders.filter((p) => p.enabled).map((p) => {
                    const c = colorMap[p.id] ?? colorMap.yookassa;
                    return (
                    <Button key={p.id} size="lg" variant="outline" onClick={p.onClick} disabled={topUpLoading} className={btnCls}>
                      {isMiniapp ? (
                        <>
                          <div className={cn("p-2 rounded-xl", c.bg10)}>
                            {topUpLoading ? <Loader2 className={cn("h-6 w-6 animate-spin", c.text)} /> : p.icon === "crypto" ? <Zap className={cn("h-6 w-6", c.text)} /> : <CreditCard className={cn("h-6 w-6", c.text)} />}
                          </div>
                          <span className="text-base font-bold">{p.label}</span>
                        </>
                      ) : (
                        <>
                          <div className={cn("absolute left-6 p-1.5 rounded-lg transition-colors", c.bg10, c.bg20)}>
                            {topUpLoading ? <Loader2 className={cn("h-5 w-5 animate-spin", c.text)} /> : p.icon === "crypto" ? <Zap className={cn("h-5 w-5", c.text)} /> : <CreditCard className={cn("h-5 w-5", c.text)} />}
                          </div>
                          <span className="text-base font-medium">{p.icon === "crypto" ? "⚡" : "💳"} {p.label}</span>
                        </>
                      )}
                    </Button>
                    );
                  })}
                  {plategaMethods.map((m) => (
                    <Button key={m.id} size="lg" variant="outline" onClick={() => startTopUp(m.id)} disabled={topUpLoading} className={btnCls}>
                      {isMiniapp ? (
                        <>
                          <div className="p-2 rounded-xl bg-green-500/10">
                            {topUpLoading ? <Loader2 className="h-6 w-6 animate-spin text-green-500" /> : <CreditCard className="h-6 w-6 text-green-500" />}
                          </div>
                          <span className="text-base font-bold">{m.label}</span>
                        </>
                      ) : (
                        <>
                          <div className="absolute left-6 p-1.5 rounded-lg bg-green-500/10 group-hover:bg-green-500/20 transition-colors">
                            {topUpLoading ? <Loader2 className="h-5 w-5 animate-spin text-green-500" /> : <CreditCard className="h-5 w-5 text-green-500" />}
                          </div>
                          <span className="text-base font-medium">💳 {m.label}</span>
                        </>
                      )}
                    </Button>
                  ))}
                </>
              );
            })()}
          </div>
          )}
          {!readyUrl && (
          <DialogFooter className="mt-4 sm:justify-center border-t border-border/50 pt-4">
            <Button variant="ghost" onClick={() => setTopUpModalOpen(false)} disabled={topUpLoading} className="rounded-xl hover:bg-background/50 hover:text-foreground text-muted-foreground transition-colors">
              {t("cabinet.profile.cancel")}
            </Button>
          </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={twoFaEnableOpen} onOpenChange={(open) => !open && closeTwoFaEnable()}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden border-border/50 backdrop-blur-3xl" showCloseButton={!twoFaLoading} onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="p-6 sm:p-8 flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/10 text-primary mb-6 shadow-inner border border-primary/20">
              <KeyRound className="h-8 w-8" />
            </div>
            <DialogHeader className="p-0 flex flex-col items-center mb-6">
              <DialogTitle className="text-2xl font-bold tracking-tight">
                {twoFaStep === 1 ? t("cabinet.profile.2fa_setup_title") : t("cabinet.profile.2fa_setup_confirm")}
              </DialogTitle>
              <DialogDescription className="text-center text-sm mt-2 max-w-[280px]">
                {twoFaStep === 1
                  ? t("cabinet.profile.2fa_setup_scan_qr")
                  : t("cabinet.profile.2fa_setup_enter_code")}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-6 w-full">
              {twoFaLoading && !twoFaSetupData ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-10 w-10 animate-spin text-primary/60" />
                </div>
              ) : twoFaStep === 1 && twoFaSetupData ? (
                <div className="flex flex-col items-center gap-6 w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="relative p-4 rounded-3xl bg-white shadow-xl ring-1 ring-black/5 dark:ring-white/10 dark:bg-white/95">
                    <QRCodeSVG value={twoFaSetupData.otpauthUrl} size={180} level="M" />
                  </div>
                  <div className="w-full space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider text-left pl-1">{t("cabinet.profile.2fa_manual_key")}</p>
                    <div className="flex items-center gap-2 p-1.5 pr-2 rounded-2xl bg-muted/50 border border-border/50">
                      <div className="flex-1 overflow-x-auto no-scrollbar font-mono text-xs font-bold text-foreground text-center tracking-widest pl-2 select-all whitespace-nowrap">
                        {twoFaSetupData.secret}
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl shrink-0 hover:bg-background shadow-sm" onClick={() => {
                        navigator.clipboard.writeText(twoFaSetupData.secret);
                      }}>
                        <Copy className="h-4 w-4 opacity-70 cursor-pointer" />
                      </Button>
                    </div>
                  </div>
                  <Button className="w-full h-12 rounded-2xl font-bold text-base shadow-lg shadow-primary/20" onClick={() => setTwoFaStep(2)}>
                    {t("cabinet.profile.2fa_next_enter")}
                  </Button>
                </div>
              ) : twoFaStep === 2 ? (
                <div className="flex flex-col gap-6 w-full animate-in fade-in slide-in-from-right-8 duration-300">
                  <div className="relative w-full">
                    <Input
                      placeholder="000 000"
                      maxLength={6}
                      value={twoFaCode}
                      onChange={(e) => setTwoFaCode(e.target.value.replace(/\D/g, ""))}
                      className="h-16 text-center text-3xl tracking-[0.3em] font-mono font-bold rounded-2xl border-primary/20 bg-primary/5 focus-visible:ring-primary/30"
                      autoFocus
                    />
                  </div>
                  <div className="flex flex-col gap-3">
                    <Button className="w-full h-12 rounded-2xl font-bold text-base shadow-lg shadow-primary/20" onClick={confirmTwoFaEnable} disabled={twoFaLoading || twoFaCode.length !== 6}>
                      {twoFaLoading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
                      {t("cabinet.profile.2fa_confirm_enable")}
                    </Button>
                    <Button variant="ghost" className="w-full h-10 rounded-xl text-muted-foreground" onClick={() => setTwoFaStep(1)} disabled={twoFaLoading}>
                      {t("cabinet.profile.2fa_back")}
                    </Button>
                  </div>
                </div>
              ) : null}
              {twoFaError && (
                <p className="text-sm font-medium text-destructive animate-in fade-in text-center">{twoFaError}</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={twoFaDisableOpen} onOpenChange={(open) => !open && setTwoFaDisableOpen(false)}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden border-border/50 backdrop-blur-3xl" showCloseButton={!twoFaLoading} onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="p-6 sm:p-8 flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-red-500/10 text-red-500 mb-6 shadow-inner border border-red-500/20">
              <Shield className="h-8 w-8" />
            </div>
            <DialogHeader className="p-0 flex flex-col items-center mb-6">
              <DialogTitle className="text-2xl font-bold tracking-tight">{t("cabinet.profile.2fa_disable_title")}</DialogTitle>
              <DialogDescription className="text-center text-sm mt-2 max-w-[280px]">
                {t("cabinet.profile.2fa_disable_desc")}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-6 w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
              <Input
                placeholder="000 000"
                maxLength={6}
                value={twoFaCode}
                onChange={(e) => setTwoFaCode(e.target.value.replace(/\D/g, ""))}
                className="h-16 text-center text-3xl tracking-[0.3em] font-mono font-bold rounded-2xl border-red-500/20 bg-red-500/5 focus-visible:ring-red-500/30"
                autoFocus
              />
              <Button variant="destructive" className="w-full h-12 rounded-2xl font-bold text-base shadow-lg shadow-red-500/20" onClick={confirmTwoFaDisable} disabled={twoFaLoading || twoFaCode.length !== 6}>
                {twoFaLoading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
                {t("cabinet.profile.2fa_disable_button")}
              </Button>
              {twoFaError && (
                <p className="text-sm font-medium text-destructive animate-in fade-in text-center">{twoFaError}</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={changePasswordOpen} onOpenChange={(open) => !open && closeChangePassword()}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden border-border/50 backdrop-blur-3xl" showCloseButton={!changePasswordLoading} onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="p-6 sm:p-8 flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/10 text-primary mb-6 shadow-inner border border-primary/20">
              <KeyRound className="h-8 w-8" />
            </div>
            <DialogHeader className="p-0 flex flex-col items-center mb-6">
              <DialogTitle className="text-2xl font-bold tracking-tight">{t("cabinet.profile.change_password_title")}</DialogTitle>
              <DialogDescription className="text-center text-sm mt-2 max-w-[280px]">
                {t("cabinet.profile.change_password_desc")}
              </DialogDescription>
            </DialogHeader>

            {changePasswordSuccess ? (
              <div className="flex flex-col items-center gap-4 py-6 animate-in fade-in scale-95 duration-300">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10 text-green-500">
                  <Check className="h-8 w-8" />
                </div>
                <p className="text-lg font-bold text-green-500">{t("cabinet.profile.password_changed")}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4 w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="space-y-3">
                  <Input
                    type="password"
                    placeholder={t("cabinet.profile.current_password")}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="h-12 rounded-xl"
                    autoFocus
                  />
                  <Input
                    type="password"
                    placeholder={t("cabinet.profile.new_password")}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="h-12 rounded-xl"
                  />
                  <Input
                    type="password"
                    placeholder={t("cabinet.profile.confirm_password")}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="h-12 rounded-xl"
                  />
                </div>
                {changePasswordError && (
                  <p className="text-sm font-medium text-destructive animate-in fade-in text-center">{changePasswordError}</p>
                )}
                <Button className="w-full h-12 rounded-xl font-bold text-base shadow-lg" onClick={submitChangePassword} disabled={changePasswordLoading || !currentPassword || !newPassword || !confirmPassword}>
                  {changePasswordLoading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
                  {t("cabinet.profile.save_password")}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Установка пароля — для юзеров без пароля (Telegram/Google/Apple) */}
      <Dialog open={setPasswordOpen} onOpenChange={(open) => !open && closeSetPassword()}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden border-border/50 backdrop-blur-3xl" showCloseButton={!setPasswordLoading} onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="p-6 sm:p-8 flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/10 text-primary mb-6 shadow-inner border border-primary/20">
              <KeyRound className="h-8 w-8" />
            </div>
            <DialogHeader className="p-0 flex flex-col items-center mb-6">
              <DialogTitle className="text-2xl font-bold tracking-tight">{t("cabinet.profile.set_password_title")}</DialogTitle>
              <DialogDescription className="text-center text-sm mt-2 max-w-[280px]">
                {t("cabinet.profile.set_password_desc")}
              </DialogDescription>
            </DialogHeader>

            {setPasswordSuccess ? (
              <div className="flex flex-col items-center gap-4 py-6 animate-in fade-in scale-95 duration-300">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10 text-green-500">
                  <Check className="h-8 w-8" />
                </div>
                <p className="text-lg font-bold text-green-500">{t("cabinet.profile.set_password_ok")}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4 w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="space-y-3">
                  <Input
                    type="password"
                    placeholder={t("cabinet.profile.new_password")}
                    value={setPasswordNew}
                    onChange={(e) => setSetPasswordNew(e.target.value)}
                    className="h-12 rounded-xl"
                    autoFocus
                  />
                  <Input
                    type="password"
                    placeholder={t("cabinet.profile.confirm_password")}
                    value={setPasswordConfirm}
                    onChange={(e) => setSetPasswordConfirm(e.target.value)}
                    className="h-12 rounded-xl"
                  />
                </div>
                {setPasswordError && (
                  <p className="text-sm font-medium text-destructive animate-in fade-in text-center">{setPasswordError}</p>
                )}
                <Button className="w-full h-12 rounded-xl font-bold text-base shadow-lg" onClick={submitSetPassword} disabled={setPasswordLoading || !setPasswordNew || !setPasswordConfirm}>
                  {setPasswordLoading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
                  {t("cabinet.profile.save_password")}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
