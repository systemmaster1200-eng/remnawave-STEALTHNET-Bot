/**
 * Зашитые в код настройки маркетплейса. Сделано константами (а не env), чтобы
 * у всех существующих инсталляций он включился сам после `git pull` без правки
 * .env. Переключение роли (client/hub) и хранение API-ключа — в SystemSetting
 * (см. marketplace.runtime.ts), а не в env.
 */

/** URL центрального хаба, к которому регистрируются все клиентские панели. */
export const MARKETPLACE_HUB_URL = "https://marketplace.stealthnet.app";

/** Включает маркетплейс глобально. Можно отключить через UI (SystemSetting marketplace_enabled = "false"). */
export const MARKETPLACE_ENABLED_DEFAULT = true;

/** Роль по умолчанию (для всех, кроме сервера, который сам объявил себя хабом). */
export const MARKETPLACE_ROLE_DEFAULT: "client" | "hub" = "client";

/** Сколько активных листингов разрешено одной инсталляции. */
export const MARKETPLACE_MAX_LISTINGS_PER_INSTALLATION = 50;

/** Сколько уникальных жалоб скрывают листинг (status = auto_hidden). */
export const MARKETPLACE_AUTO_HIDE_REPORTS_THRESHOLD = 3;

/** Cron-расписание heartbeat (раз в 10 минут). */
export const MARKETPLACE_HEARTBEAT_CRON = "*/10 * * * *";

/** Таймаут любого запроса к хабу. */
export const MARKETPLACE_HUB_TIMEOUT_MS = 8_000;

/** Ключи в таблице system_settings. */
export const SETTING_KEYS = {
  enabled: "marketplace_enabled",          // "true" | "false"
  role: "marketplace_role",                // "client" | "hub"
  apiKey: "marketplace_api_key",           // mk_…
  installationId: "marketplace_installation_id",
  contactUsername: "marketplace_contact_username",
  displayName: "marketplace_display_name",
  logoUrl: "marketplace_logo_url",
  description: "marketplace_description",
  lastConnectAt: "marketplace_last_connect_at",
  lastConnectStatus: "marketplace_last_connect_status",
} as const;
