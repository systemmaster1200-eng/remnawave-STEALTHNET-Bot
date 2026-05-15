import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Gift, 
  Sparkles, 
  Clock, 
  User, 
  UserPlus, 
  AlertTriangle, 
  XCircle, 
  CheckCircle, 
  Loader2, 
  RefreshCw 
} from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import type { PublicGiftCodeInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function GiftActivatePage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { state: authState } = useClientAuth();

  const [loading, setLoading] = useState(true);
  const [giftInfo, setGiftInfo] = useState<PublicGiftCodeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!code) {
      setError("Код подарка не указан");
      setLoading(false);
      return;
    }

    const fetchGift = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await api.getPublicGiftCodeInfo(code);
        setGiftInfo(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить информацию о подарке");
      } finally {
        setLoading(false);
      }
    };

    fetchGift();
  }, [code]);

  const handleExistingAccount = async () => {
    if (!code) return;

    if (authState.token) {
      setRedeeming(true);
      setRedeemError(null);
      try {
        await api.giftRedeemCode(authState.token, code);
        setSuccess(true);
        setTimeout(() => {
          navigate("/cabinet/dashboard");
        }, 2500);
      } catch (err: any) {
        console.error("Failed to redeem gift code:", err);
        setRedeemError(err.response?.data?.message || err.message || "Ошибка активации подарка");
      } finally {
        setRedeeming(false);
      }
    } else {
      localStorage.setItem("stealthnet_pending_gift", code);
      navigate("/cabinet/login");
    }
  };

  const handleNewAccount = () => {
    if (!code) return;
    localStorage.setItem("stealthnet_pending_gift", code);
    navigate("/cabinet/register");
  };

  const containerVariants = {
    hidden: { opacity: 0, scale: 0.95 },
    visible: { 
      opacity: 1, 
      scale: 1,
      transition: {
        type: "spring",
        stiffness: 300,
        damping: 30,
        staggerChildren: 0.1
      }
    },
    exit: { opacity: 0, scale: 0.95 }
  };

  const childVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 }
  };

  return (
    <div className="min-h-svh flex flex-col items-center justify-center p-4 relative overflow-hidden bg-background text-foreground">
      {/* Decorative blobs */}
      <div className="absolute top-1/4 -left-40 w-96 h-96 rounded-full bg-primary/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 -right-40 w-96 h-96 rounded-full bg-amber-500/10 blur-[120px] pointer-events-none" />

      <motion.div className="w-full max-w-md relative z-10" layout>
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="rounded-[2.5rem] border border-white/10 dark:border-white/5 bg-background/40 backdrop-blur-2xl shadow-2xl overflow-hidden p-8 flex flex-col items-center justify-center"
            >
              <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
              <p className="text-muted-foreground font-medium">Распаковываем подарок...</p>
            </motion.div>
          ) : error ? (
            <motion.div
              key="error"
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={containerVariants}
              className="rounded-[2.5rem] border border-red-500/20 bg-background/40 backdrop-blur-2xl shadow-2xl overflow-hidden p-8 flex flex-col items-center justify-center text-center"
            >
              <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mb-6">
                <Gift className="w-10 h-10 text-red-500 opacity-50" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Подарок не найден</h2>
              <p className="text-muted-foreground mb-6">{error}</p>
              <Button onClick={() => window.location.reload()} variant="outline" className="gap-2 rounded-xl">
                <RefreshCw className="w-4 h-4" />
                Попробовать снова
              </Button>
            </motion.div>
          ) : success ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", bounce: 0.5 }}
              className="rounded-[2.5rem] border border-green-500/20 bg-background/40 backdrop-blur-2xl shadow-2xl overflow-hidden p-8 flex flex-col items-center justify-center text-center"
            >
              <motion.div 
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: "spring" }}
                className="w-24 h-24 rounded-full bg-green-500/20 flex items-center justify-center mb-6 relative"
              >
                <CheckCircle className="w-12 h-12 text-green-500" />
                <motion.div 
                  animate={{ rotate: 360 }} 
                  transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-0 border-2 border-dashed border-green-500/30 rounded-full"
                />
              </motion.div>
              <h2 className="text-3xl font-bold text-green-500 mb-2">Подарок активирован!</h2>
              <p className="text-muted-foreground">Сейчас вы будете перенаправлены в панель управления...</p>
            </motion.div>
          ) : giftInfo ? (
            <motion.div
              key="content"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="rounded-[2.5rem] border border-amber-500/20 bg-background/40 backdrop-blur-2xl shadow-2xl overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 via-transparent to-transparent pointer-events-none" />
              
              <div className="p-8 flex flex-col items-center text-center relative z-10">
                <motion.div variants={childVariants} className="relative mb-6">
                  <div className="w-24 h-24 rounded-3xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20 shadow-inner">
                    <Gift className="w-12 h-12 text-amber-500" />
                  </div>
                  {giftInfo.status === "ACTIVE" && !giftInfo.isExpired && (
                    <motion.div
                      animate={{ scale: [1, 1.2, 1], rotate: [0, 10, -10, 0] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="absolute -top-2 -right-2"
                    >
                      <Sparkles className="w-8 h-8 text-amber-400" fill="currentColor" />
                    </motion.div>
                  )}
                </motion.div>

                <motion.h1 variants={childVariants} className="text-3xl font-extrabold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-amber-200 to-amber-500">
                  Вам подарок!
                </motion.h1>

                <motion.div variants={childVariants} className="w-full bg-background/50 rounded-2xl p-4 mb-6 border border-white/5 backdrop-blur-md">
                  <div className="text-sm text-muted-foreground mb-1">Тариф</div>
                  <div className="text-xl font-bold text-foreground">{giftInfo.tariffName || "Подписка VPN"}</div>
                  
                  <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between text-sm">
                    <div className="flex items-center text-muted-foreground">
                      <Clock className="w-4 h-4 mr-2" />
                      Действует до
                    </div>
                    <div className="font-mono text-foreground">
                      {new Date(giftInfo.expiresAt).toLocaleDateString("ru-RU")}
                    </div>
                  </div>
                </motion.div>

                {giftInfo.giftMessage && (
                  <motion.div variants={childVariants} className="w-full mb-6 relative">
                    <blockquote className="text-left p-4 rounded-r-2xl border-l-4 border-amber-500 bg-amber-500/5 italic text-muted-foreground relative z-10">
                      "{giftInfo.giftMessage}"
                    </blockquote>
                  </motion.div>
                )}

                {/* Status Handling */}
                {giftInfo.isExpired || giftInfo.status === "EXPIRED" ? (
                  <motion.div variants={childVariants} className="w-full p-4 rounded-2xl bg-secondary/50 border border-border flex items-center justify-center gap-3 text-muted-foreground">
                    <Clock className="w-6 h-6" />
                    <span className="font-medium">Срок действия кода истёк</span>
                  </motion.div>
                ) : giftInfo.status === "REDEEMED" ? (
                  <motion.div variants={childVariants} className="w-full p-4 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center gap-3 text-green-500">
                    <CheckCircle className="w-6 h-6" />
                    <span className="font-medium">Этот код уже был использован</span>
                  </motion.div>
                ) : giftInfo.status === "CANCELLED" ? (
                  <motion.div variants={childVariants} className="w-full p-4 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center gap-3 text-red-500">
                    <XCircle className="w-6 h-6" />
                    <span className="font-medium">Этот код был отменён</span>
                  </motion.div>
                ) : (
                  <motion.div variants={childVariants} className="w-full space-y-4">
                    {redeemError && (
                      <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start text-left text-sm text-red-400">
                        <AlertTriangle className="w-5 h-5 mr-3 shrink-0 mt-0.5" />
                        <div>{redeemError}</div>
                      </div>
                    )}

                    <Button 
                      onClick={handleExistingAccount}
                      disabled={redeeming}
                      className="w-full h-14 rounded-2xl text-base font-bold shadow-xl hover:scale-[1.02] transition-all gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white border-0"
                    >
                      {redeeming ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <>
                          <User className="w-5 h-5" />
                          Активировать на существующий
                        </>
                      )}
                    </Button>

                    <Button 
                      onClick={handleNewAccount}
                      disabled={redeeming}
                      variant="outline"
                      className="w-full h-14 rounded-2xl text-base font-bold shadow-sm hover:scale-[1.02] transition-all gap-2 border-white/10 hover:bg-white/5"
                    >
                      <UserPlus className="w-5 h-5" />
                      Создать новый аккаунт
                    </Button>
                  </motion.div>
                )}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
