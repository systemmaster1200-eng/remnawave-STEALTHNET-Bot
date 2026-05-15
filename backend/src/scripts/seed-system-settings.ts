import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { prisma } from "../db.js";

const DEFAULTS: Array<[string, string]> = [
  ["active_languages", "ru,en"],
  ["active_currencies", "usd,rub"],
  ["default_referral_percent", "10"],
  ["trial_days", "3"],
  ["service_name", "STEALTHNET"],
  [
    "bot_inner_button_styles",
    '{"tariffPay":"success","topup":"primary","back":"danger","profile":"primary","trialConfirm":"success","lang":"primary","currency":"primary"}',
  ],
  ["category_emojis", '{"ordinary":"📦","premium":"⭐"}'],
  [
    "bot_emojis",
    '{"TRIAL":{"unicode":"🎁"},"PACKAGE":{"unicode":"📦"},"CARD":{"unicode":"💳"},"LINK":{"unicode":"🔗"},"SERVERS":{"unicode":"🌐"},"PUZZLE":{"unicode":"🧩"},"BACK":{"unicode":"◀️"},"MAIN_MENU":{"unicode":"👋"},"BALANCE":{"unicode":"💰"},"TARIFFS":{"unicode":"📦"},"HEADER":{"unicode":"🛡"}}',
  ],
  [
    "bot_menu_line_visibility",
    '{"welcomeTitlePrefix":true,"welcomeGreeting":true,"balancePrefix":true,"tariffPrefix":true,"subscriptionPrefix":true,"expirePrefix":true,"daysLeftPrefix":true,"devicesLabel":true,"trafficPrefix":true,"linkLabel":true,"chooseAction":true}',
  ],
  ["default_auto_renew_enabled", "false"],
  ["auto_renew_days_before_expiry", "1"],
  ["auto_renew_notify_days_before", "3"],
  ["auto_renew_grace_period_days", "2"],
  ["auto_renew_max_retries", "3"],
  ["yookassa_recurring_enabled", "false"],
  ["gift_subscriptions_enabled", "false"],
  ["gift_code_expiry_hours", "72"],
  ["max_additional_subscriptions", "5"],
  ["gift_code_format_length", "12"],
  ["gift_rate_limit_per_minute", "5"],
  ["gift_expiry_notification_days", "3"],
  ["gift_referral_enabled", "true"],
  ["gift_message_max_length", "200"],
];

export async function ensureSystemSettings() {
  for (const [key, value] of DEFAULTS) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value },
      update: {},
    });
  }
  await seedEnglishPack();
  await seedMarketplaceCategories();
  await ensurePrimaryBot();
}

/**
 * Гарантирует существование primary бота и синхронизирует его токен.
 *
 * Сценарии:
 *   1) Свежая инсталляция: миграция создала primary с placeholder-токеном —
 *      перезаписываем настоящим из env.BOT_TOKEN или system_settings.telegram_bot_token.
 *   2) Существующий пользователь после миграции: primary создан с токеном из
 *      system_settings, всё уже корректно — обновлять не нужно.
 *   3) Token сменили в .env: НЕ перезаписываем автоматически (могут быть
 *      клиенты привязанные к старому токену через webhook). Только если placeholder.
 */
async function ensurePrimaryBot() {
  try {
    const envToken = (process.env.BOT_TOKEN ?? "").trim();
    const settingRow = await prisma.systemSetting.findUnique({
      where: { key: "telegram_bot_token" },
    });
    const settingToken = (settingRow?.value ?? "").trim();
    const desiredToken = envToken || settingToken;

    let primary = await prisma.bot.findFirst({ where: { isPrimary: true } });

    if (!primary) {
      // Бот мог быть удалён вручную — пересоздаём.
      if (!desiredToken) {
        console.warn("[seed] primary bot missing and no BOT_TOKEN set — skipping");
        return;
      }
      primary = await prisma.bot.create({
        data: {
          token: desiredToken,
          markupPercent: 0,
          isActive: true,
          isPrimary: true,
          ownerName: "Основной (платформа)",
        },
      });
      console.log("[seed] primary bot created");
      return;
    }

    // Если токен placeholder_* — заменяем настоящим (свежая установка).
    if (primary.token.startsWith("placeholder_") && desiredToken) {
      await prisma.bot.update({
        where: { id: primary.id },
        data: { token: desiredToken, isActive: true },
      });
      console.log("[seed] primary bot token initialized from env");
    }
  } catch (e) {
    console.warn("[seed] ensurePrimaryBot skip:", e instanceof Error ? e.message : e);
  }
}

const MARKETPLACE_CATEGORIES: Array<{
  slug: string;
  labelRu: string;
  labelEn: string;
  icon: string;
  sortOrder: number;
}> = [
  { slug: "vpn-servers",     labelRu: "VPN-серверы",          labelEn: "VPN servers",         icon: "Server",      sortOrder: 10 },
  { slug: "ipv4-proxy",      labelRu: "IPv4 / IPv6 прокси",   labelEn: "IPv4 / IPv6 proxies", icon: "Globe",       sortOrder: 20 },
  { slug: "residential",     labelRu: "Резидентские прокси",  labelEn: "Residential proxies", icon: "Network",     sortOrder: 30 },
  { slug: "ready-panels",    labelRu: "Готовые панели",       labelEn: "Turn-key panels",     icon: "LayoutGrid",  sortOrder: 40 },
  { slug: "branding",        labelRu: "Брендинг и дизайн",    labelEn: "Branding & design",   icon: "Palette",     sortOrder: 50 },
  { slug: "marketing",       labelRu: "Маркетинг и трафик",   labelEn: "Marketing & traffic", icon: "Megaphone",   sortOrder: 60 },
  { slug: "support",         labelRu: "Поддержка и настройка", labelEn: "Support & setup",    icon: "LifeBuoy",    sortOrder: 70 },
  { slug: "software",        labelRu: "Софт и боты",          labelEn: "Software & bots",     icon: "Cpu",         sortOrder: 80 },
  { slug: "other",           labelRu: "Прочее",               labelEn: "Other",               icon: "Sparkles",    sortOrder: 999 },
];

async function seedMarketplaceCategories() {
  try {
    for (const c of MARKETPLACE_CATEGORIES) {
      await prisma.marketplaceCategory.upsert({
        where: { slug: c.slug },
        create: c,
        update: {
          // апдейтим только sortOrder/icon, ярлыки могли быть переименованы вручную в UI
          sortOrder: c.sortOrder,
          icon: c.icon,
        },
      });
    }
  } catch (e) {
    console.warn("[seed] marketplace categories skip:", e instanceof Error ? e.message : e);
  }
}

async function seedEnglishPack() {
  const existing = await prisma.systemSetting.findUnique({ where: { key: "lang_pack_en" } });
  if (existing) return;
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(dir, "../i18n/en.json"),
      resolve(dir, "../../../frontend/src/i18n/locales/en.json"),
    ];
    let data: string | null = null;
    for (const p of candidates) {
      try { data = readFileSync(p, "utf-8"); break; } catch { /* next */ }
    }
    if (!data) { console.warn("[seed] en.json not found, skip"); return; }
    JSON.parse(data);
    await prisma.systemSetting.create({ data: { key: "lang_pack_en", value: data } });
    console.log("[seed] English language pack seeded");
  } catch (e) {
    console.warn("[seed] Could not seed English pack:", e instanceof Error ? e.message : e);
  }
}
