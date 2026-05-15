import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, X, CheckCircle2 } from "lucide-react";

/**
 * Тост «доступно обновление» + разовое «готово к оффлайн-работе».
 * Регистрирует Service Worker и предлагает перезагрузку, когда выходит новая версия.
 */
export function PwaUpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // Периодически проверяем обновления (раз в час), пока вкладка открыта.
      const check = () => {
        if (!(registration.installing || !navigator)) {
          if ("connection" in navigator && !(navigator as unknown as { onLine?: boolean }).onLine) return;
          registration.update().catch(() => {});
        }
      };
      setInterval(check, 60 * 60 * 1000);
    },
    onRegisterError(err) {
      console.warn("[PWA] SW registration failed:", err);
    },
  });

  const [offlineVisible, setOfflineVisible] = useState(false);

  useEffect(() => {
    if (!offlineReady) return;
    setOfflineVisible(true);
    const t = setTimeout(() => {
      setOfflineVisible(false);
      setOfflineReady(false);
    }, 4500);
    return () => clearTimeout(t);
  }, [offlineReady, setOfflineReady]);

  return (
    <AnimatePresence>
      {needRefresh && (
        <motion.div
          key="update"
          initial={{ opacity: 0, y: 24, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 280, damping: 26 }}
          className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-sm z-[9999]"
        >
          <div className="rounded-2xl border border-white/10 bg-background/80 backdrop-blur-2xl shadow-2xl p-4 flex items-start gap-3">
            <div className="h-10 w-10 shrink-0 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center">
              <RefreshCw className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Доступно обновление</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Появилась новая версия приложения. Перезагрузите, чтобы применить изменения.
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => updateServiceWorker(true)}
                  className="h-8 px-3 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                >
                  Обновить сейчас
                </button>
                <button
                  onClick={() => setNeedRefresh(false)}
                  className="h-8 px-3 rounded-lg text-xs font-medium text-muted-foreground hover:bg-foreground/5 transition-colors"
                >
                  Позже
                </button>
              </div>
            </div>
            <button
              onClick={() => setNeedRefresh(false)}
              className="shrink-0 h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
              aria-label="Закрыть"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}

      {offlineVisible && (
        <motion.div
          key="offline"
          initial={{ opacity: 0, y: 24, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 280, damping: 26 }}
          className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-xs z-[9999]"
        >
          <div className="rounded-2xl border border-emerald-500/20 bg-background/80 backdrop-blur-2xl shadow-2xl p-3.5 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
            <p className="text-sm">Приложение готово к работе офлайн</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
