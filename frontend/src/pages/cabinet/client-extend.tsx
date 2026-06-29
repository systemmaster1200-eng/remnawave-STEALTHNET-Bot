import { useNavigate, useParams } from "react-router-dom";
import { ExtendSubscriptionDialog } from "@/components/payment/extend-subscription-dialog";

/**
 * Полноэкранная страница продления конкретной подписки (Stealth-стиль).
 * subId берётся из URL: /cabinet/extend/:subId.
 */
export function ClientExtendPage() {
  const navigate = useNavigate();
  const { subId } = useParams<{ subId: string }>();

  // Нет subId в URL — возвращаем на дашборд.
  if (!subId) {
    navigate("/cabinet/dashboard", { replace: true });
    return null;
  }

  return (
    <ExtendSubscriptionDialog
      asPage
      subId={subId}
      open
      onClose={() => navigate("/cabinet/dashboard")}
      onPaidByBalance={() => navigate("/cabinet/dashboard")}
    />
  );
}
