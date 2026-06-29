-- Конструктор кнопок (произвольное число) для рассылок и авторассылок.
-- buttons_config: JSON-массив [{ "text": "...", "action": "menu:*|webapp:/path|https://..." }].
--   NULL → fallback на старые button_text/button_url/button2_* (обратная совместимость).
ALTER TABLE "auto_broadcast_rules" ADD COLUMN "buttons_config" TEXT;
ALTER TABLE "broadcast_history" ADD COLUMN "buttons_config" TEXT;
