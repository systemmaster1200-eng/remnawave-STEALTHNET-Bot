import { ExternalLink, ArrowLeft, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type TelegramWebAppMinimal = {
  initData?: string;
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
};

function getTelegramMiniApp(): TelegramWebAppMinimal | null {
  if (typeof window === "undefined") return null;
  const raw = (window as {
    Telegram?: { WebApp?: false | TelegramWebAppMinimal };
  }).Telegram?.WebApp;
  if (!raw || typeof raw !== "object") return null;
  const webApp = raw as TelegramWebAppMinimal;
  if (typeof webApp.openLink !== "function") return null;
  if (!webApp.initData || !webApp.initData.trim()) return null;
  return webApp;
}

export type PayNowPanelProps = {
  /** URL платёжной страницы, возвращённый провайдером. */
  url: string;
  /** Название провайдера (YooKassa, CryptoPay и т.д.) — для отображения в шапке. */
  provider?: string;
  /** Callback «вернуться к выбору метода» — очищает URL в родителе. */
  onBack: () => void;
  /** Callback после клика по «Оплатить» (обычно закрывает модалку). */
  onPaid?: () => void;
  /** Компактный mobile / miniapp-стиль, или широкий desktop-dialog. */
  compact?: boolean;
};

/**
 * Компонент, который показывается внутри платёжной модалки после того,
 * как URL для оплаты получен от бэкенда. Отрисовывает большую кнопку-ссылку
 * «Оплатить», которая открывает страницу в новой вкладке.
 *
 * Ключевой момент для iOS Safari: клик по `<a target="_blank">` — это
 * **прямой user gesture**, между ним и открытием вкладки нет `await`.
 * Поэтому блокировщик попапов в iOS Safari/PWA не срабатывает.
 *
 * В Telegram Mini App `<a target="_blank">` не открывается корректно —
 * поэтому здесь перехватываем клик и используем `WebApp.openLink`.
 */
export function PayNowPanel({ url, provider, onBack, onPaid, compact }: PayNowPanelProps) {
  const { t } = useTranslation();

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const miniApp = getTelegramMiniApp();
    if (miniApp) {
      e.preventDefault();
      try {
        miniApp.openLink!(url);
      } catch {
        window.location.assign(url);
      }
    }
    if (onPaid) onPaid();
  };

  const isMiniapp = typeof window !== "undefined" && Boolean(getTelegramMiniApp());
  const hint = isMiniapp
    ? t("cabinet.common.ready_to_pay_hint_miniapp")
    : t("cabinet.common.ready_to_pay_hint");

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "rounded-2xl border border-primary/30 bg-primary/5 overflow-hidden relative",
          compact ? "p-5" : "p-6",
        )}
      >
        <div className="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
        <div className="relative z-10 flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className={cn("font-bold text-foreground", compact ? "text-base" : "text-lg")}>
              {t("cabinet.common.ready_to_pay_title")}
            </p>
            {provider && (
              <p className="text-xs font-medium text-muted-foreground mt-0.5">
                {t("cabinet.common.payment_provider")}: <span className="text-foreground font-bold">{provider}</span>
              </p>
            )}
            <p className="text-sm text-muted-foreground mt-2">{hint}</p>
          </div>
        </div>
      </div>

      <Button
        asChild
        size="lg"
        className={cn(
          "w-full font-bold shadow-lg bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 transition-all duration-200 active:scale-[0.98]",
          compact ? "h-16 rounded-2xl text-base" : "h-14 rounded-xl text-base",
        )}
      >
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleClick}
          className="flex items-center justify-center gap-2"
        >
          <ExternalLink className={cn(compact ? "h-6 w-6" : "h-5 w-5")} />
          <span>{t("cabinet.common.pay_open_new_tab")}</span>
        </a>
      </Button>

      <Button
        type="button"
        variant="outline"
        size="lg"
        onClick={onBack}
        className={cn(
          "w-full font-medium border-border/60",
          compact ? "h-14 rounded-2xl" : "h-12 rounded-xl",
        )}
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        {t("cabinet.common.choose_another_method")}
      </Button>
    </div>
  );
}
