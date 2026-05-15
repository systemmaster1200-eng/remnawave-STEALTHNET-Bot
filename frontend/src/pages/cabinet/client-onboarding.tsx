import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, KeyRound, Shield, Check, Eye, EyeOff, Loader2, ChevronRight } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Step = "welcome" | "password" | "2fa" | "done";

const STEPS: Step[] = ["welcome", "password", "2fa", "done"];

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

export function ClientOnboardingPage() {
  const { state, refreshProfile, clearNewTelegramUser } = useClientAuth();
  const navigate = useNavigate();
  const token = state.token;
  const client = state.client;

  const [step, setStep] = useState<Step>("welcome");
  const [direction, setDirection] = useState(1);

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

  const stepIndex = STEPS.indexOf(step);

  function goTo(next: Step) {
    const nextIndex = STEPS.indexOf(next);
    setDirection(nextIndex > stepIndex ? 1 : -1);
    setStep(next);
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
      goTo("2fa");
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

  const progressDots = ["welcome", "password", "2fa"].map((s, i) => (
    <div
      key={s}
      className={cn(
        "h-2 rounded-full transition-all duration-500",
        step === s ? "w-8 bg-primary" : stepIndex > i ? "w-2 bg-primary/40" : "w-2 bg-muted-foreground/20"
      )}
    />
  ));

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
                  className="flex h-24 w-24 items-center justify-center rounded-3xl bg-primary/10 border border-primary/20 mb-6"
                >
                  <Sparkles className="h-12 w-12 text-primary" />
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
                    onClick={() => goTo("password")}
                  >
                    Начать
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                </motion.div>
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
                <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10 border border-primary/20 mb-6">
                  <KeyRound className="h-10 w-10 text-primary" />
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
                <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-orange-500/10 border border-orange-500/20 mb-6">
                  <Shield className="h-10 w-10 text-orange-500" />
                </div>
                <h2 className="text-2xl font-extrabold tracking-tight mb-1 text-center">Двухфакторная защита</h2>
                <p className="text-sm text-muted-foreground mb-6 text-center max-w-xs">Дополнительная защита аккаунта — необязательно, но рекомендуем</p>

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
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors mt-4"
                >
                  Пропустить, перейти в кабинет
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
                className="p-8 sm:p-10 flex flex-col items-center text-center"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 200, damping: 15 }}
                  className="flex h-24 w-24 items-center justify-center rounded-full bg-green-500/10 border border-green-500/20 mb-6"
                >
                  <Check className="h-12 w-12 text-green-500" />
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