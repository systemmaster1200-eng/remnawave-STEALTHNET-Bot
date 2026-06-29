import { useNavigate } from "react-router-dom";
import { StealthPromocodeModal } from "@/components/stealth/stealth-promocode-modal";

/** Полноэкранная страница активации промокода (Stealth-стиль, как оформление подписки). */
export function ClientPromocodePage() {
  const navigate = useNavigate();
  return (
    <StealthPromocodeModal
      asPage
      open
      onClose={() => navigate("/cabinet/dashboard")}
      onActivated={() => navigate("/cabinet/dashboard")}
    />
  );
}
