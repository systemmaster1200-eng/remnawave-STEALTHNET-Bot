import { useNavigate } from "react-router-dom";
import { StealthDevicesModal } from "@/components/stealth/stealth-devices-modal";

/** Полноэкранная страница «Мои устройства» (Stealth-стиль, как оформление подписки). */
export function ClientDevicesPage() {
  const navigate = useNavigate();
  return (
    <StealthDevicesModal
      asPage
      open
      onClose={() => navigate("/cabinet/dashboard")}
    />
  );
}
