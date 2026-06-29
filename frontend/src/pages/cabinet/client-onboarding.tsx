import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, KeyRound, Mail, Shield, Check, Eye, EyeOff, Loader2, ChevronRight } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

// T-onb-email (26.05.2026, WolfVPN): добавлен обязательный шаг "email"
// для TG-юзеров без привязанной почты.
type Step = "welcome" | "email" | "password" | "2fa" | "done";

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 60 : -60,
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({
    x: direction > 0 ? -60 : 60,
    opacity: 0,
  }),
};

// T-onb-polish (26.05.2026, WolfVPN): декоративные элементы для онбординга.

/** Pulsing glow за иконкой шага — добавляет «дыхание» главному визуалу. */
function IconGlow({ color = "bg-primary/40" }: { color?: string }) {
  return (
    <motion.span
      aria-hidden
      className={`absolute inset-0 rounded-3xl ${color} blur-2xl pointer-events-none`}
      animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.85, 0.5] }}
      transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

/** Маленькие звёздочки, которые орбитят вокруг главной иконки на welcome-шаге. */
function FloatingSparkles() {
  const dots = [
    { angle: 0, radius: 70, delay: 0, size: 6, color: "bg-primary" },
    { angle: 72, radius: 78, delay: 0.5, size: 4, color: "bg-amber-400" },
    { angle: 144, radius: 64, delay: 1, size: 5, color: "bg-sky-400" },
    { angle: 216, radius: 80, delay: 1.5, size: 4, color: "bg-violet-400" },
    { angle: 288, radius: 66, delay: 2, size: 5, color: "bg-emerald-400" },
  ];
  return (
    <>
      {dots.map((d, i) => {
        const rad = (d.angle * Math.PI) / 180;
        const x = Math.cos(rad) * d.radius;
        const y = Math.sin(rad) * d.radius;
        return (
          <motion.span
            key={i}
            aria-hidden
            className={`absolute ${d.color} rounded-full shadow-lg pointer-events-none`}
            style={{
              width: d.size,
              height: d.size,
              left: `calc(50% + ${x}px - ${d.size / 2}px)`,
              top: `calc(50% + ${y}px - ${d.size / 2}px)`,
            }}
            animate={{
              scale: [0.6, 1.2, 0.6],
              opacity: [0.3, 1, 0.3],
              y: [y, y - 8, y],
            }}
            transition={{
              duration: 3.5,
              delay: d.delay,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        );
      })}
    </>
  );
}

/** Конфетти-вспышка на done-шаге. ~40 частиц, разные цвета, разлетаются по дуге и падают. */
function ConfettiBurst() {
  const COLORS = ["bg-primary", "bg-amber-400", "bg-emerald-400", "bg-sky-400", "bg-violet-400", "bg-pink-400"];
  const particles = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => ({
        angle: Math.random() * 360,
        distance: 90 + Math.random() * 120,
        color: COLORS[i % COLORS.length],
        size: 6 + Math.random() * 6,
        rotate: Math.random() * 720 - 360,
        delay: Math.random() * 0.15,
        fall: 60 + Math.random() * 100,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
      {particles.map((p, i) => {
        const rad = (p.angle * Math.PI) / 180;
        const xEnd = Math.cos(rad) * p.distance;
        const yEnd = Math.sin(rad) * p.distance;
        return (
          <motion.span
            key={i}
            aria-hidden
            className={`absolute ${p.color} rounded-sm`}
            style={{ width: p.size, height: p.size * 0.4 }}
            initial={{ x: 0, y: 0, opacity: 0, scale: 0.4, rotate: 0 }}
            animate={{
              x: xEnd,
              y: [0, yEnd, yEnd + p.fall],
              opacity: [0, 1, 0],
              scale: [0.4, 1, 0.7],
              rotate: p.rotate,
            }}
            transition={{
              duration: 1.6,
              delay: p.delay,
              ease: "easeOut",
              times: [0, 0.55, 1],
            }}
          />
        );
      })}
    </div>
  );
}

export function ClientOnboardingPage() {
  const { state, refreshProfile, clearNewTelegramUser } = useClientAuth();
  const config = useCabinetConfig();
  const navigate = useNavigate();
  const token = state.token;
  const client = state.client;
  // T-onb-email (27.05.2026, WolfVPN): нужна ли верификация email через письмо.
  // Если SMTP не настроен ИЛИ админ выключил верификацию — пользуем direct-привязку.
  const emailVerificationRequired = Boolean(config?.smtpConfigured && !config?.skipEmailVerification);

  const [step, setStep] = useState<Step>("welcome");
  const [direction, setDirection] = useState(1);

  // Email step (T-onb-email 26.05.2026, WolfVPN)
  const [emailInput, setEmailInput] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [agreedToPrivacy, setAgreedToPrivacy] = useState(false);

  // Password step
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  // 2FA step
  const [twoFaData, setTwoFaData] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [twoFaCode, setTwoFaCode] = useState("");
  const [twoFaLoading, setTwoFaLoading] = useState(false);
  const [twoFaError, setTwoFaError] = useState("");
  const [twoFaSetupLoading, setTwoFaSetupLoading] = useState(false);

  // T-onb-email (26.05.2026, WolfVPN): динамический список шагов.
  // Шаг "email" появляется только если у клиента email ещё не привязан.
  // Welcome / 2fa / done — всегда; password — всегда (для TG-юзеров пароль отсутствует,
  // для email-регистрации он уже стоит, но бэк позволяет переустановить пока onboardingCompleted=false).
  const STEPS = useMemo<Step[]>(() => {
    // Онбординг упрощён: на первом заходе НЕ запрашиваем email и НЕ предлагаем
    // подключить 2FA — и то, и другое пользователь может сделать позже в профиле.
    // Оставляем приветствие → установку пароля → финал.
    return ["welcome", "password", "done"];
  }, []);

  const stepIndex = STEPS.indexOf(step);

  function goTo(next: Step) {
    const nextIndex = STEPS.indexOf(next);
    setDirection(nextIndex > stepIndex ? 1 : -1);
    setStep(next);
  }

  // Следующий шаг после welcome — email если нужен, иначе password.
  // Аналогично после email → password.
  function nextStepAfter(current: Step): Step {
    const idx = STEPS.indexOf(current);
    return STEPS[idx + 1] ?? "done";
  }

  // Load 2FA setup when entering that step
  useEffect(() => {
    if (step === "2fa" && !twoFaData && token) {
      setTwoFaSetupLoading(true);
      api.client2FASetup(token)
        .then(data => setTwoFaData(data))
        .catch(() => {})
        .finally(() => setTwoFaSetupLoading(false));
    }
  }, [step, twoFaData, token]);

  const [exitOverlay, setExitOverlay] = useState(false);

  const [doneLoading, setDoneLoading] = useState(false);

  async function handleFinishOnboarding() {
    if (!token) return;
    setDoneLoading(true);
    try {
      await api.clientCompleteOnboarding(token);
      await refreshProfile();
      setExitOverlay(true);
      setTimeout(() => {
        clearNewTelegramUser();
        navigate("/cabinet/dashboard", { replace: true });
      }, 600);
    } catch {
      setDoneLoading(false);
    }
  }

  async function handleSetPassword() {
    if (!token) return;
    if (newPassword.length < 6) {
      setPasswordError("Минимум 6 символов");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Пароли не совпадают");
      return;
    }
    setPasswordError("");
    setPasswordLoading(true);
    try {
      await api.clientSetPassword(token, { newPassword });
      goTo(nextStepAfter("password"));
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setPasswordLoading(false);
    }
  }

  async function handleConfirm2FA() {
    if (!token || twoFaCode.length !== 6) return;
    setTwoFaError("");
    setTwoFaLoading(true);
    try {
      await api.client2FAConfirm(token, twoFaCode);
      goTo("done");
    } catch (e) {
      setTwoFaError(e instanceof Error ? e.message : "Неверный код");
    } finally {
      setTwoFaLoading(false);
    }
  }

  async function handleSkip2FA() {
    goTo("done");
  }

  // T-onb-email (26.05.2026, WolfVPN): отправка ссылки или мгновенная привязка.
  // Если верификация требуется → /link-email-request (письмо со ссылкой).
  // Если нет (SMTP не настроен или skipEmailVerification=true) → /link-email-direct
  // (привязка мгновенная, юзер сразу идёт дальше).
  async function handleSubmitEmail() {
    if (!token) return;
    const value = emailInput.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setEmailError("Введите корректный email");
      return;
    }
    if (!agreedToPrivacy) {
      setEmailError("Необходимо согласие с Политикой обработки персональных данных");
      return;
    }
    setEmailError("");
    setEmailLoading(true);
    try {
      if (emailVerificationRequired) {
        await api.clientLinkEmailRequest(token, { email: value });
        setEmailSent(true);
      } else {
        try {
          await api.clientLinkEmailDirect(token, { email: value });
          await refreshProfile();
          goTo(nextStepAfter("email"));
        } catch (e) {
          // страховка от рассинхрона с бэком: если direct
          // отвечает «Требуется верификация» (конфиг SMTP изменился / закэширован),
          // не показываем юзеру тупик — переключаемся на письмо со ссылкой.
          if (e instanceof Error && /верификац/i.test(e.message)) {
            await api.clientLinkEmailRequest(token, { email: value });
            setEmailSent(true);
          } else {
            throw e;
          }
        }
      }
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : "Не удалось сохранить email");
    } finally {
      setEmailLoading(false);
    }
  }

  // Прогресс-дотс рендерим только для основных шагов (без welcome/done).
  // Welcome — приветствие, done — финал; они не считаются «настройкой».
  const progressSteps = STEPS.filter(s => s !== "welcome" && s !== "done");
  const progressDots = progressSteps.map((s) => {
    const i = STEPS.indexOf(s);
    const isActive = step === s;
    const isPast = stepIndex > i;
    // T-onb-polish: layout-анимация через motion — плавный морфинг ширины/цвета,
    // активный dot пульсирует.
    return (
      <motion.div
        key={s}
        layout
        className={cn(
          "h-2 rounded-full relative overflow-hidden",
          isActive ? "w-8 bg-primary" : isPast ? "w-2 bg-primary/40" : "w-2 bg-muted-foreground/20"
        )}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
      >
        {isActive && (
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full bg-primary"
            animate={{ opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </motion.div>
    );
  });

  return (
    <div className="min-h-svh flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Exit overlay — белая/тёмная волна поверх всего при переходе в кабинет */}
      <AnimatePresence>
        {exitOverlay && (
          <motion.div
            key="exit-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, ease: "easeInOut" }}
            className="fixed inset-0 z-50 bg-background pointer-events-none"
          />
        )}
      </AnimatePresence>
      {/* Background blobs */}
      <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-primary/20 blur-[120px] pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-primary/10 blur-[120px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        {/* Progress dots (hidden on done step) */}
        {step !== "done" && (
          <div className="flex items-center justify-center gap-2 mb-6">
            {progressDots}
          </div>
        )}

        <div className="relative rounded-[2.5rem] border border-white/10 dark:border-white/5 bg-background/40 backdrop-blur-2xl shadow-2xl overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />

          <AnimatePresence mode="wait" custom={direction}>
            {step === "welcome" && (
              <motion.div
                key="welcome"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="p-8 sm:p-10 flex flex-col items-center text-center"
              >
                <motion.div
                  initial={{ scale: 0, rotate: -20 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ delay: 0.15, type: "spring", stiffness: 200 }}
                  className="relative flex h-24 w-24 items-center justify-center rounded-3xl bg-primary/10 border border-primary/20 mb-6"
                >
                  <IconGlow color="bg-primary/40" />
                  <FloatingSparkles />
                  <Sparkles className="relative z-10 h-12 w-12 text-primary" />
                </motion.div>
                <motion.h1
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="text-3xl font-extrabold tracking-tight mb-2"
                >
                  Добро пожаловать!
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25 }}
                  className="text-muted-foreground mb-1"
                >
                  {client?.telegramUsername ? "Аккаунт создан через Telegram" : "Аккаунт успешно создан"}
                </motion.p>
                {client?.telegramUsername ? (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    className="text-primary font-bold text-lg mb-4"
                  >
                    @{client.telegramUsername}
                  </motion.span>
                ) : client?.email ? (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    className="text-primary font-bold text-lg mb-4"
                  >
                    {client.email}
                  </motion.span>
                ) : null}
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.35 }}
                  className="text-sm text-muted-foreground mb-8 max-w-xs"
                >
                  Давайте настроим ваш аккаунт за пару шагов. Это займёт меньше минуты.
                </motion.p>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="w-full"
                >
                  <Button
                    className="w-full h-14 rounded-2xl text-base font-bold shadow-xl hover:scale-[1.02] transition-all gap-2"
                    onClick={() => goTo(nextStepAfter("welcome"))}
                  >
                    Начать
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                </motion.div>
              </motion.div>
            )}

            {step === "email" && (
              <motion.div
                key="email"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="p-8 sm:p-10 flex flex-col items-center"
              >
                <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-sky-500/10 border border-sky-500/20 mb-6">
                  <IconGlow color="bg-sky-500/40" />
                  <Mail className="relative z-10 h-10 w-10 text-sky-500" />
                </div>
                <h2 className="text-2xl font-extrabold tracking-tight mb-1 text-center">Привяжите email</h2>
                <p className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
                  Нужен для входа на сайт и восстановления доступа
                </p>

                {!emailSent ? (
                  <>
                    <div className="w-full space-y-3 mb-4">
                      <Input
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        placeholder="your@email.com"
                        value={emailInput}
                        onChange={e => { setEmailInput(e.target.value); setEmailError(""); }}
                        className="h-12 rounded-xl"
                        autoFocus
                        disabled={emailLoading}
                      />
                      {emailError && (
                        <motion.p
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="text-sm text-destructive text-center"
                        >
                          {emailError}
                        </motion.p>
                      )}
                    </div>
                    {/* Согласие с обработкой персональных данных (обязательно) */}
                    <div className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-background/30 p-3 mb-4 w-full text-left">
                      <Checkbox id="agree-privacy-onb" checked={agreedToPrivacy} onCheckedChange={(v) => setAgreedToPrivacy(v === true)} className="mt-0.5 shrink-0 border-white/50 bg-white/10 data-[state=checked]:bg-fuchsia-500 data-[state=checked]:border-fuchsia-500 data-[state=checked]:text-white" />
                      <label htmlFor="agree-privacy-onb" className="text-xs font-normal leading-relaxed text-muted-foreground cursor-pointer">
                        Я ознакомился и согласен с{" "}
                        <Link to="/cabinet/documents/privacy" target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">Политикой обработки персональных данных</Link>.
                      </label>
                    </div>
                    <Button
                      className="w-full h-14 rounded-2xl text-base font-bold shadow-xl hover:scale-[1.02] transition-all gap-2"
                      onClick={handleSubmitEmail}
                      disabled={emailLoading || !emailInput.trim() || !agreedToPrivacy}
                    >
                      {emailLoading ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <>{emailVerificationRequired ? "Отправить ссылку" : "Далее"} <ChevronRight className="h-5 w-5" /></>
                      )}
                    </Button>
                  </>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="w-full flex flex-col items-center"
                  >
                    <div className="w-full p-4 rounded-2xl bg-green-500/10 border border-green-500/20 text-center mb-4">
                      <Check className="h-6 w-6 text-green-500 mx-auto mb-2" />
                      <p className="text-sm font-semibold text-foreground">Письмо отправлено</p>
                      <p className="text-xs text-muted-foreground mt-1 break-all">
                        {emailInput} — подтвердите по ссылке из письма
                      </p>
                    </div>
                    <Button
                      className="w-full h-14 rounded-2xl text-base font-bold shadow-xl hover:scale-[1.02] transition-all gap-2"
                      onClick={() => goTo(nextStepAfter("email"))}
                    >
                      Продолжить <ChevronRight className="h-5 w-5" />
                    </Button>
                  </motion.div>
                )}
              </motion.div>
            )}

            {step === "password" && (
              <motion.div
                key="password"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="p-8 sm:p-10 flex flex-col items-center"
              >
                <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10 border border-primary/20 mb-6">
                  <IconGlow color="bg-primary/40" />
                  <KeyRound className="relative z-10 h-10 w-10 text-primary" />
                </div>
                <h2 className="text-2xl font-extrabold tracking-tight mb-1 text-center">Создайте пароль</h2>
                <p className="text-sm text-muted-foreground mb-6 text-center">Для входа через email и пароль</p>

                <div className="w-full space-y-3 mb-4">
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="Новый пароль (мин. 6 символов)"
                      value={newPassword}
                      onChange={e => { setNewPassword(e.target.value); setPasswordError(""); }}
                      className="h-12 rounded-xl pr-10"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <Input
                    type="password"
                    placeholder="Повторите пароль"
                    value={confirmPassword}
                    onChange={e => { setConfirmPassword(e.target.value); setPasswordError(""); }}
                    className="h-12 rounded-xl"
                  />
                  {passwordError && (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-sm text-destructive text-center"
                    >
                      {passwordError}
                    </motion.p>
                  )}
                </div>

                <Button
                  className="w-full h-14 rounded-2xl text-base font-bold shadow-xl hover:scale-[1.02] transition-all gap-2 mb-3"
                  onClick={handleSetPassword}
                  disabled={passwordLoading || !newPassword || !confirmPassword}
                >
                  {passwordLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <>Далее <ChevronRight className="h-5 w-5" /></>}
                </Button>
              </motion.div>
            )}

            {step === "2fa" && (
              <motion.div
                key="2fa"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="p-8 sm:p-10 flex flex-col items-center"
              >
                <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-orange-500/10 border border-orange-500/20 mb-6">
                  <IconGlow color="bg-orange-500/40" />
                  <Shield className="relative z-10 h-10 w-10 text-orange-500" />
                </div>
                <h2 className="text-2xl font-extrabold tracking-tight mb-1 text-center">Двухфакторная защита</h2>
                <p className="text-base font-bold text-orange-500 dark:text-orange-400 mb-2 text-center max-w-xs">
                  Этот шаг необязательный — можно пропустить
                </p>
                <p className="text-sm text-muted-foreground mb-2 text-center max-w-xs">
                  Для двухфакторной аутентификации используйте приложение <span className="font-semibold text-foreground">Google Authenticator</span>.
                </p>
                <p className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
                  Вы можете скачать его в магазине приложений на вашем устройстве.
                </p>

                {twoFaSetupLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-10 w-10 animate-spin text-primary/60" />
                  </div>
                ) : twoFaData ? (
                  <div className="w-full space-y-4">
                    <div className="flex justify-center">
                      <div className="p-3 rounded-2xl bg-white shadow-lg">
                        <QRCodeSVG value={twoFaData.otpauthUrl} size={160} />
                      </div>
                    </div>
                    <div className="rounded-xl bg-muted/40 border border-border/50 p-3 text-center">
                      <p className="text-xs text-muted-foreground mb-1">Или введите ключ вручную</p>
                      <code className="text-sm font-mono text-primary select-all break-all">{twoFaData.secret}</code>
                    </div>
                    <Input
                      placeholder="000 000"
                      maxLength={6}
                      value={twoFaCode}
                      onChange={e => { setTwoFaCode(e.target.value.replace(/\D/g, "")); setTwoFaError(""); }}
                      className="h-12 rounded-xl text-center text-2xl tracking-[0.3em] font-mono font-bold"
                    />
                    {twoFaError && (
                      <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-sm text-destructive text-center"
                      >
                        {twoFaError}
                      </motion.p>
                    )}
                    <Button
                      className="w-full h-14 rounded-2xl text-base font-bold shadow-xl hover:scale-[1.02] transition-all"
                      onClick={handleConfirm2FA}
                      disabled={twoFaLoading || twoFaCode.length !== 6}
                    >
                      {twoFaLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Подтвердить и завершить"}
                    </Button>
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={handleSkip2FA}
                  className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-base font-bold text-orange-500 dark:text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 hover:border-orange-500/60 shadow-sm hover:shadow-md transition-all duration-200 hover:scale-[1.02]"
                >
                  Пропустить, перейти в кабинет
                  <ChevronRight className="h-4 w-4" />
                </button>
              </motion.div>
            )}

            {step === "done" && (
              <motion.div
                key="done"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="relative p-8 sm:p-10 flex flex-col items-center text-center"
              >
                <ConfettiBurst />
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 200, damping: 15 }}
                  className="relative flex h-24 w-24 items-center justify-center rounded-full bg-green-500/10 border border-green-500/20 mb-6"
                >
                  <IconGlow color="bg-green-500/40" />
                  <Check className="relative z-10 h-12 w-12 text-green-500" />
                </motion.div>
                <motion.h2
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="text-3xl font-extrabold tracking-tight mb-2"
                >
                  Настройка завершена!
                </motion.h2>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="text-muted-foreground mb-8"
                >
                  Ваш аккаунт полностью готов к работе
                </motion.p>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="w-full"
                >
                  <Button
                    className="w-full h-14 rounded-2xl text-base font-bold shadow-xl hover:scale-[1.02] transition-all gap-2"
                    onClick={handleFinishOnboarding}
                    disabled={doneLoading}
                  >
                    {doneLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <>Перейти в кабинет <ChevronRight className="h-5 w-5" /></>}
                  </Button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}