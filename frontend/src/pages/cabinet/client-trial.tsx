import { useNavigate } from "react-router-dom";
import { StealthTrialsModal } from "@/components/stealth/stealth-trials-modal";

/** Полноэкранная страница выбора пробного периода (Stealth-стиль). */
export function ClientTrialPage() {
  const navigate = useNavigate();
  return (
    <StealthTrialsModal
      asPage
      open
      onClose={() => navigate("/cabinet/dashboard")}
      onActivated={() => navigate("/cabinet/dashboard")}
    />
  );
}
