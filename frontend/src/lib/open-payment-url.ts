/**
 * Открытие платёжных страниц. Ключевая задача — надёжно работать во всех средах:
 * iOS Safari (включая standalone PWA «Добавлено на экран «Домой»»),
 * iOS Telegram Mini App, Android Chrome/WebView, десктоп.
 *
 * Ключевые правила:
 *
 *  1. В Telegram Mini App используется `WebApp.openLink(url)` — клиент Telegram
 *     сам открывает ссылку во внешнем браузере.
 *
 *  2. Вне Mini App используется **same-tab navigation** — `window.location.href = url`.
 *     Это межстраничная навигация, а НЕ попап, поэтому ни iOS Safari, ни PWA,
 *     ни встроенные WebView не считают её всплывающим окном и не блокируют.
 *
 *     ⚠️ Важно: НЕ использовать `window.open(url, '_blank')` и тем более не делать
 *     пре-open пустой вкладки. На iOS Safari новая вкладка открывается ФОНОВО
 *     в приложении Safari — пользователь остаётся на старой странице и думает,
 *     что ничего не произошло.
 */

type TelegramWebAppMinimal = {
  initData?: string;
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
};

/**
 * Возвращает `WebApp` ТОЛЬКО если пользователь действительно запущен из Telegram
 * как Mini App. `telegram-web-app.js` инжектит `window.Telegram.WebApp` на любой
 * странице (в т.ч. в обычной Safari), поэтому наличия объекта недостаточно.
 * Надёжный признак Mini App — непустой `initData`, который Telegram заполняет
 * только при реальном запуске WebApp.
 */
function getTelegramWebApp(): TelegramWebAppMinimal | null {
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

/**
 * Handle от {@link preparePaymentRedirect}. После `await` — `.open(url)` чтобы
 * переадресовать пользователя на платёжную страницу; при ошибке — `.cancel()`.
 *
 * Для текущей реализации `.cancel()` — no-op (ничего заранее не открываем),
 * но сохраняем API на случай будущих изменений.
 */
export type PaymentRedirect = {
  open: (url: string) => void;
  cancel: () => void;
};

/**
 * Вызывайте синхронно в click-обработчике (до `await`), затем после получения
 * URL — `.open(url)`. На iOS Safari/PWA/Android/десктопе делает же́сткую
 * переадресацию текущей вкладки; в Telegram Mini App — `WebApp.openLink`.
 */
export function preparePaymentRedirect(): PaymentRedirect {
  if (typeof window === "undefined") {
    return { open: () => undefined, cancel: () => undefined };
  }

  const webApp = getTelegramWebApp();
  if (webApp) {
    return {
      open: (url) => {
        try {
          webApp.openLink!(url);
        } catch {
          window.location.assign(url);
        }
      },
      cancel: () => undefined,
    };
  }

  return {
    open: (url) => {
      // `location.assign` = кросс-доменная навигация текущей вкладки.
      // На iOS это НЕ попап и не блокируется, даже после `await`.
      try {
        window.location.assign(url);
      } catch {
        window.location.href = url;
      }
    },
    cancel: () => undefined,
  };
}

/**
 * Простое открытие, когда URL известен синхронно (без `await`).
 * Поведение идентично {@link preparePaymentRedirect}, просто удобнее вызывать.
 */
export function openPaymentInBrowser(url: string): void {
  const redirect = preparePaymentRedirect();
  redirect.open(url);
}
