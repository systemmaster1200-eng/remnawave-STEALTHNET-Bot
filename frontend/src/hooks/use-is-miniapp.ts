import { useState, useEffect } from "react";

/** True когда кабинет открыт внутри Telegram Mini App (Web App) — показываем мобильную версию. */
export function useIsMiniapp(): boolean {
  const [isMiniapp, setIsMiniapp] = useState(false);

  useEffect(() => {
    const check =
      typeof window !== "undefined" &&
      Boolean((window as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData);
    setIsMiniapp(check);
  }, []);

  return isMiniapp;
}
