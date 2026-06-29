import { useNavigate } from "react-router-dom";
import { StealthNewTicketModal } from "@/components/stealth/stealth-new-ticket-modal";

/**
 * Полноэкранная страница создания обращения: /cabinet/tickets/new.
 * Использует ту же форму, что и модалка, в режиме asPage.
 */
export function ClientNewTicketPage() {
  const navigate = useNavigate();
  return (
    <StealthNewTicketModal
      asPage
      open
      onClose={() => navigate("/cabinet/tickets")}
      onCreated={(id) => navigate(`/cabinet/tickets?open=${encodeURIComponent(id)}`)}
    />
  );
}
