import { useNavigate } from "react-router-dom";
import { useClientAuth } from "@/contexts/client-auth";
import { StealthTopupModal } from "@/components/stealth/stealth-topup-modal";

/** Полноэкранная страница пополнения баланса (Stealth-стиль, как оформление подписки). */
export function ClientTopupPage() {
  const navigate = useNavigate();
  const { state } = useClientAuth();
  return (
    <StealthTopupModal
      asPage
      open
      onClose={() => navigate("/cabinet/dashboard")}
      currency={state.client?.preferredCurrency || "RUB"}
    />
  );
}
