/**
 * StealthConnectPage — привязка email / Telegram отдельной страницей
 * (в стиле оформления подписки, с WizardHeader). Тип выбирается через ?type=.
 */

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type PublicConfig } from "@/lib/api";
import { WizardHeader } from "@/components/stealth/wizard-header";
import { StadiumButton } from "@/components/stealth/stadium-button";

export function StealthConnectPage() {
  const { state, refreshProfile, loginByTelegramDeepLink } = useClientAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const type = params.get("type") === "telegram" ? "telegram" : "email";

  const [config, setConfig] = useState<PublicConfig | null>(null);
  const emailVerifyRequired = Boolean(config?.smtpConfigured && !config?.skipEmailVerification);
  const tgConnected = !!state.client?.telegramId;

  useEffect(() => {
    api.getPublicConfig().then(setConfig).catch(() => {});
  }, []);

  const back = () => navigate("/cabinet/profile");

  // ── email ──
  const [emailStep, setEmailStep] = useState<"email" | "code" | "password">("email");
  const [emailVal, setEmailVal] = useState("");
  const [codeVal, setCodeVal] = useState("");
  const [pwVal, setPwVal] = useState("");
  const [pwVal2, setPwVal2] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [emailErr, setEmailErr] = useState<string | null>(null);

  async function sendEmailCode() {
    if (!state.token || !emailVal.trim() || emailBusy) return;
    setEmailBusy(true); setEmailErr(null); setEmailMsg(null);
    try {
      if (emailVerifyRequired) {
        await api.clientLinkEmailRequest(state.token, { email: emailVal.trim() });
        setEmailStep("code");
        setEmailMsg("Код отправлен на почту.");
      } else {
        await api.clientLinkEmailDirect(state.token, { email: emailVal.trim() });
        await refreshProfile().catch(() => {});
        setEmailStep("password");
      }
    } catch (e) {
      setEmailErr(e instanceof Error ? e.message : "Не удалось отправить код");
    } finally { setEmailBusy(false); }
  }

  async function verifyEmailCode() {
    if (!state.token || codeVal.trim().length !== 6 || emailBusy) return;
    setEmailBusy(true); setEmailErr(null);
    try {
      const res = await api.clientLinkEmailVerifyCode(state.token, { code: codeVal.trim() });
      if (res.merged && res.token && res.client) {
        // Аккаунты объединены: применяем токен основного аккаунта и выходим.
        loginByTelegramDeepLink({ token: res.token, client: res.client });
        setEmailMsg(null);
        navigate("/cabinet/dashboard");
        return;
      }
      await refreshProfile().catch(() => {});
      setEmailStep("password"); setEmailMsg(null);
    } catch (e) {
      setEmailErr(e instanceof Error ? e.message : "Неверный код");
    } finally { setEmailBusy(false); }
  }

  async function savePassword() {
    if (!state.token || emailBusy) return;
    if (pwVal.length < 6) { setEmailErr("Минимум 6 символов"); return; }
    if (pwVal !== pwVal2) { setEmailErr("Пароли не совпадают"); return; }
    setEmailBusy(true); setEmailErr(null);
    try {
      await api.clientSetPassword(state.token, { newPassword: pwVal });
      await refreshProfile().catch(() => {});
      back();
    } catch (e) {
      setEmailErr(e instanceof Error ? e.message : "Не удалось сохранить пароль");
    } finally { setEmailBusy(false); }
  }

  // ── telegram ──
  const [tgBusy, setTgBusy] = useState(false);
  const [tgErr, setTgErr] = useState<string | null>(null);
  const [tgCode, setTgCode] = useState<string | null>(null);
  const [tgBot, setTgBot] = useState<string | null>(null);
  const [tgStarted, setTgStarted] = useState(false);

  // В мини-аппе доступна мгновенная привязка по initData; в вебе — код + ссылка на бота.
  const initData = (typeof window !== "undefined"
    ? (window as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData
    : "") ?? "";
  const inMiniapp = Boolean(initData && initData.trim());

  // Запускаем TG-флоу автоматически при заходе на страницу типа telegram.
  // Мини-апп: мгновенная привязка по initData. Веб: запрашиваем код + ссылку на бота.
  useEffect(() => {
    if (type !== "telegram" || tgStarted || !state.token) return;
    setTgStarted(true);
    setTgBusy(true);
    (async () => {
      try {
        if (inMiniapp) {
          const res = await api.clientLinkTelegram(state.token!, { initData });
          if (res.merged && res.token && res.client) {
            // Аккаунты объединены: переключаемся на основной аккаунт (с TG).
            loginByTelegramDeepLink({ token: res.token, client: res.client });
            navigate("/cabinet/dashboard");
            return;
          }
          await refreshProfile().catch(() => {});
          back();
        } else {
          const res = await api.clientLinkTelegramRequest(state.token!);
          setTgCode(res.code);
          setTgBot(res.botUsername);
        }
      } catch (e) {
        setTgErr(e instanceof Error ? e.message : "Не удалось привязать Telegram");
      } finally { setTgBusy(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, state.token, tgStarted, inMiniapp]);

  // Пять показан код (веб) — опрашиваем профиль и закрываем страницу после привязки.
  useEffect(() => {
    if (type !== "telegram" || !tgCode) return;
    const iv = setInterval(() => { refreshProfile().catch(() => {}); }, 3000);
    return () => clearInterval(iv);
  }, [type, tgCode, refreshProfile]);

  useEffect(() => {
    if (type === "telegram" && tgConnected) back();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, tgConnected]);

  return (
    <div className="px-4 pt-2 space-y-5 pb-4">
      <WizardHeader step={1} totalSteps={1} onClose={back} />
      <h1 className="text-2xl font-extrabold text-zinc-100 px-1">
        {type === "telegram" ? "Привязка Telegram" : "Привязка email"}
      </h1>

      {type === "email" && (
        <div className="space-y-3">
          {emailStep === "email" && (
            <>
              <input
                type="email" inputMode="email" autoFocus
                value={emailVal}
                onChange={(e) => { setEmailVal(e.target.value); setEmailErr(null); setEmailMsg(null); }}
                placeholder="you@example.com"
                className="w-full rounded-xl bg-white/[0.04] border border-white/10 px-3 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50"
              />
              <StadiumButton variant="primary" size="md" disabled={emailBusy || !emailVal.trim()} onClick={sendEmailCode}>
                {emailBusy ? "Отправляем…" : (emailVerifyRequired ? "Отправить код" : "Привязать")}
              </StadiumButton>
            </>
          )}
          {emailStep === "code" && (
            <>
              <p className="text-xs text-zinc-400">Мы отправили 6-значный код на {emailVal}. Введите его ниже.</p>
              <p className="text-[11px] text-amber-400/90 leading-snug">
                Если этот email уже использовался для другого аккаунта — после подтверждения
                аккаунты будут объединены в один (подписки, баланс и рефералы перенесутся).
              </p>
              <input
                type="text" inputMode="numeric" maxLength={6} autoFocus
                value={codeVal}
                onChange={(e) => { setCodeVal(e.target.value.replace(/\D/g, "").slice(0, 6)); setEmailErr(null); }}
                placeholder="______"
                className="w-full rounded-xl bg-white/[0.04] border border-white/10 px-3 py-3 text-center text-lg tracking-[0.4em] font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50"
              />
              <StadiumButton variant="primary" size="md" disabled={emailBusy || codeVal.trim().length !== 6} onClick={verifyEmailCode}>
                {emailBusy ? "Проверяем…" : "Подтвердить"}
              </StadiumButton>
              <button type="button" onClick={() => { setEmailStep("email"); setCodeVal(""); setEmailErr(null); }} className="w-full text-[11px] text-zinc-500 hover:text-zinc-300 transition">
                Изменить email
              </button>
            </>
          )}
          {emailStep === "password" && (
            <>
              <p className="text-xs text-zinc-400">Почта привязана. Задайте пароль для входа на сайт по email.</p>
              <input
                type="password" autoFocus value={pwVal}
                onChange={(e) => { setPwVal(e.target.value); setEmailErr(null); }}
                placeholder="Новый пароль"
                className="w-full rounded-xl bg-white/[0.04] border border-white/10 px-3 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50"
              />
              <input
                type="password" value={pwVal2}
                onChange={(e) => { setPwVal2(e.target.value); setEmailErr(null); }}
                placeholder="Повторите пароль"
                className="w-full rounded-xl bg-white/[0.04] border border-white/10 px-3 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50"
              />
              <p className="text-[11px] text-zinc-500">Минимум 6 символов.</p>
              <StadiumButton variant="primary" size="md" disabled={emailBusy} onClick={savePassword}>
                {emailBusy ? "Сохраняем…" : "Сохранить пароль"}
              </StadiumButton>
              <button type="button" onClick={back} className="w-full text-[11px] text-zinc-500 hover:text-zinc-300 transition">
                Пропустить
              </button>
            </>
          )}
          {emailMsg && <p className="text-[11px] text-emerald-400">{emailMsg}</p>}
          {emailErr && <p className="text-[11px] text-red-400">{emailErr}</p>}
        </div>
      )}

      {type === "telegram" && (
        <div className="space-y-3">
          {tgBusy && <p className="text-sm text-zinc-400">{inMiniapp ? "Привязываем…" : "Готовим привязку…"}</p>}
          {tgCode && (
            <div className="space-y-2.5">
              <p className="text-sm text-zinc-300">Нажмите кнопку — откроется Telegram и код уйдёт боту автоматически:</p>
              {tgBot && (
                <StadiumButton
                  variant="primary"
                  size="md"
                  onClick={() => window.open(`https://t.me/${tgBot}?start=link_${encodeURIComponent(tgCode)}`, "_blank", "noopener,noreferrer")}
                >
                  Открыть Telegram и привязать
                </StadiumButton>
              )}
              <p className="text-[11px] text-zinc-500 leading-snug">Или отправьте боту{tgBot ? ` @${tgBot}` : ""} команду:</p>
              <div className="rounded-xl bg-white/[0.04] border border-blue-500/30 px-3 py-2 text-center font-mono text-sm text-blue-300 select-all">
                /link {tgCode}
              </div>
              <p className="text-[11px] text-zinc-500">Страница закроется автоматически после привязки.</p>
            </div>
          )}
          {tgErr && <p className="text-[11px] text-red-400">{tgErr}</p>}
        </div>
      )}
    </div>
  );
}
