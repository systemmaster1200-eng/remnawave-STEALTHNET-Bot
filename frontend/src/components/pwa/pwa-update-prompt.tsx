import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, CheckCircle2 } from "lucide-react";

/**
 * Авто-обновление PWA. Как только Service Worker обнаруживает новую версию,
 * мы применяем её автоматически (updateServiceWorker(true) → новый SW
 * активируется и страница перезагружается). Так пользователь в мини-аппе всегда
 * открывает актуальную версию, без ручного промпта «обновить» (который в
 * Telegram-WebView часто не виден/не нажимается).
 *
 * Показываем лишь короткий ненавязчивый тост на момент применения обновления.
 */
export function PwaUpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // Проверяем обновления при регистрации и далее раз в час, пока вкладка открыта.
      const check = () => {
        if ("connection" in navigator && !(navigator as unknown as { onLine?: boolean }).onLine) return;
        registration.update().catch(() => {});
      };
      check();
      setInterval(check, 60 * 60 * 1000);
    },
    onRegisterError(err) {
      console.warn("[PWA] SW registration failed:", err);
    },
  });

  const [offlineVisible, setOfflineVisible] = useState(false);

  // Новая версия найдена → сразу применяем (перезагрузка на свежую сборку).
  useEffect(() => {
    if (needRefresh) {
      updateServiceWorker(true).catch(() => {});
    }
  }, [needRefresh, updateServiceWorker]);

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
          className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-xs z-[9999]"
        >
          <div className="rounded-2xl border border-white/10 bg-background/80 backdrop-blur-2xl shadow-2xl p-3.5 flex items-center gap-3">
            <RefreshCw className="h-5 w-5 text-primary shrink-0 animate-spin" />
            <p className="text-sm">Обновляем приложение…</p>
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
