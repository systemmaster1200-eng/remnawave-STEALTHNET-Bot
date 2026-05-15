#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════
 *  STEALTHNET v3 — Скрипт миграции из старой панели (Flask/SQLAlchemy)
 * ═══════════════════════════════════════════════════════════════════
 *
 *  Что мигрирует:
 *    1. Users         → Clients          (пользователи)
 *    2. TariffLevels  → TariffCategories  (категории тарифов)
 *    3. Tariffs       → Tariffs           (тарифные планы)
 *    4. Payments      → Payments          (история платежей)
 *    5. PromoCodes    → PromoCodes        (промокоды)
 *    6. Referral links (referrer_id)      (реферальные связи)
 *    7. Settings      → SystemSettings    (настройки)
 *
 *  Как запустить:
 *    1. Убедитесь, что новая панель уже развёрнута и БД создана (prisma migrate)
 *    2. Установите зависимости:  npm install pg
 *    3. Настройте переменные ниже или передайте через ENV
 *    4. Запустите:  node scripts/migrate-from-old-panel.js
 *
 *  Важно:
 *    - Скрипт НЕ удаляет существующие данные в новой БД
 *    - Дубликаты пропускаются (по email, telegram_id, order_id)
 *    - Можно запускать повторно (идемпотентно)
 *    - Логирует каждый шаг и итоги
 */

const { Client: PgClient } = require("pg");

// ══════════════════════════════════════════════════════════════════
//  НАСТРОЙКИ ПОДКЛЮЧЕНИЯ
// ══════════════════════════════════════════════════════════════════

// Старая БД (Flask-панель)
const OLD_DB = {
  host: process.env.OLD_DB_HOST || "localhost",
  port: parseInt(process.env.OLD_DB_PORT || "5432"),
  database: process.env.OLD_DB_NAME || "stealthnet",
  user: process.env.OLD_DB_USER || "stealthnet",
  password: process.env.OLD_DB_PASSWORD || "stealthnet_password_change_me",
};

// Новая БД (STEALTHNET 3.0)
const NEW_DB = {
  host: process.env.NEW_DB_HOST || "localhost",
  port: parseInt(process.env.NEW_DB_PORT || "5432"),
  database: process.env.NEW_DB_NAME || "stealthnet",
  user: process.env.NEW_DB_USER || "stealthnet",
  password: process.env.NEW_DB_PASSWORD || "stealthnet_change_me",
};

// Валюта определяется автоматически из system_settings новой панели (ключ default_currency).
// Можно переопределить через ENV:
const FORCE_CURRENCY = process.env.DEFAULT_CURRENCY || null;

// ══════════════════════════════════════════════════════════════════
//  УТИЛИТЫ
// ══════════════════════════════════════════════════════════════════

function generateCuid() {
  // Простой cuid-подобный ID (совместим с Prisma @default(cuid()))
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  const rand2 = Math.random().toString(36).substring(2, 6);
  return `c${ts}${rand}${rand2}`;
}

function generateReferralCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function log(emoji, msg) {
  console.log(`  ${emoji}  ${msg}`);
}

function logSection(title) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"═".repeat(60)}`);
}

function parseCommaSeparated(val) {
  if (!val) return null;
  try {
    const parsed = JSON.parse(val);
    if (Array.isArray(parsed)) return parsed.join(",");
  } catch {}
  return val;
}

function parseSquadIds(squadIds, squadId) {
  if (squadIds) {
    try {
      const parsed = JSON.parse(squadIds);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch {}
  }
  if (squadId) return [squadId];
  return [];
}

function getPriceForCurrency(tariff, currency) {
  switch (currency) {
    case "usd":
      return tariff.price_usd || 0;
    case "rub":
      return tariff.price_rub || 0;
    case "uah":
      return tariff.price_uah || 0;
    default:
      return tariff.price_usd || 0;
  }
}

// ══════════════════════════════════════════════════════════════════
//  ОСНОВНАЯ ЛОГИКА МИГРАЦИИ
// ══════════════════════════════════════════════════════════════════

async function migrate() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║   STEALTHNET v3 — Миграция из старой панели                  ║
╚══════════════════════════════════════════════════════════════╝
`);

  const oldDb = new PgClient(OLD_DB);
  const newDb = new PgClient(NEW_DB);

  try {
    log("🔌", `Подключение к старой БД: ${OLD_DB.host}:${OLD_DB.port}/${OLD_DB.database}`);
    await oldDb.connect();
    log("✅", "Старая БД — подключено");

    log("🔌", `Подключение к новой БД: ${NEW_DB.host}:${NEW_DB.port}/${NEW_DB.database}`);
    await newDb.connect();
    log("✅", "Новая БД — подключено");

    // ─── Определяем системную валюту ─────────────────────────
    let systemCurrency = FORCE_CURRENCY;
    if (!systemCurrency) {
      const currRes = await newDb.query(
        `SELECT value FROM system_settings WHERE key = 'default_currency' LIMIT 1`
      );
      systemCurrency = currRes.rows.length > 0 ? currRes.rows[0].value : "usd";
    }
    log("💱", `Системная валюта: ${systemCurrency.toUpperCase()}`);
    log("  ", `Балансы и цены будут перенесены в ${systemCurrency.toUpperCase()}`);

    // Маппинг старых ID → новые ID
    const userIdMap = new Map();     // old user.id → new client.id
    const tariffIdMap = new Map();   // old tariff.id → new tariff.id
    const categoryIdMap = new Map(); // old tier code → new category.id

    const stats = {
      users: { total: 0, migrated: 0, skipped: 0, errors: 0 },
      categories: { total: 0, migrated: 0, skipped: 0 },
      tariffs: { total: 0, migrated: 0, skipped: 0, errors: 0 },
      payments: { total: 0, migrated: 0, skipped: 0, errors: 0 },
      promoCodes: { total: 0, migrated: 0, skipped: 0, errors: 0 },
      referrals: { total: 0, linked: 0, errors: 0 },
      settings: { migrated: 0 },
    };

    // ─── 1. TARIFF LEVELS → TARIFF CATEGORIES ─────────────────
    logSection("1/7  Категории тарифов (TariffLevel → TariffCategory)");

    let tariffLevels = [];
    try {
      const res = await oldDb.query(
        `SELECT * FROM tariff_level WHERE is_active = true ORDER BY display_order`
      );
      tariffLevels = res.rows;
    } catch {
      log("⚠️", "Таблица tariff_level не найдена. Создам категории из полей tier тарифов.");
    }

    if (tariffLevels.length > 0) {
      stats.categories.total = tariffLevels.length;
      for (const level of tariffLevels) {
        // Проверяем, не существует ли уже
        const existing = await newDb.query(
          `SELECT id FROM tariff_categories WHERE name = $1`,
          [level.name]
        );
        if (existing.rows.length > 0) {
          categoryIdMap.set(level.code, existing.rows[0].id);
          stats.categories.skipped++;
          log("⏭️", `Категория "${level.name}" уже существует`);
          continue;
        }

        const newId = generateCuid();
        await newDb.query(
          `INSERT INTO tariff_categories (id, name, emoji_key, sort_order, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())`,
          [newId, level.name, level.code, level.display_order || 0]
        );
        categoryIdMap.set(level.code, newId);
        stats.categories.migrated++;
        log("✅", `Категория "${level.name}" (${level.code})`);
      }
    } else {
      // Fallback: создаём категории из уникальных tier значений тарифов
      const tiersRes = await oldDb.query(
        `SELECT DISTINCT tier FROM tariff WHERE tier IS NOT NULL ORDER BY tier`
      );
      stats.categories.total = tiersRes.rows.length || 1;

      if (tiersRes.rows.length === 0) {
        const newId = generateCuid();
        await newDb.query(
          `INSERT INTO tariff_categories (id, name, emoji_key, sort_order, created_at, updated_at)
           VALUES ($1, 'Тарифы', 'ordinary', 0, NOW(), NOW())
           ON CONFLICT DO NOTHING`,
          [newId]
        );
        categoryIdMap.set("default", newId);
        stats.categories.migrated++;
        log("✅", 'Создана категория "Тарифы" (по умолчанию)');
      } else {
        let order = 0;
        for (const row of tiersRes.rows) {
          const tierName =
            row.tier === "basic"
              ? "Базовый"
              : row.tier === "pro"
              ? "Премиум"
              : row.tier === "elite"
              ? "Элитный"
              : row.tier;
          const existing = await newDb.query(
            `SELECT id FROM tariff_categories WHERE name = $1`,
            [tierName]
          );
          if (existing.rows.length > 0) {
            categoryIdMap.set(row.tier, existing.rows[0].id);
            stats.categories.skipped++;
            continue;
          }
          const newId = generateCuid();
          await newDb.query(
            `INSERT INTO tariff_categories (id, name, emoji_key, sort_order, created_at, updated_at)
             VALUES ($1, $2, $3, $4, NOW(), NOW())`,
            [newId, tierName, row.tier, order++]
          );
          categoryIdMap.set(row.tier, newId);
          stats.categories.migrated++;
          log("✅", `Категория "${tierName}" (${row.tier})`);
        }
      }
    }

    log(
      "📊",
      `Категории: ${stats.categories.migrated} создано, ${stats.categories.skipped} пропущено`
    );

    // ─── 2. TARIFFS ───────────────────────────────────────────
    logSection("2/7  Тарифы (Tariff → Tariff)");

    const tariffsRes = await oldDb.query(`SELECT * FROM tariff ORDER BY id`);
    stats.tariffs.total = tariffsRes.rows.length;

    for (const t of tariffsRes.rows) {
      const squadUuids = parseSquadIds(t.squad_ids, t.squad_id);
      const tier = t.tier || "default";
      let categoryId = categoryIdMap.get(tier);

      // Если категория не найдена, создаём "Прочие"
      if (!categoryId) {
        const fallbackName = "Прочие";
        const existing = await newDb.query(
          `SELECT id FROM tariff_categories WHERE name = $1`,
          [fallbackName]
        );
        if (existing.rows.length > 0) {
          categoryId = existing.rows[0].id;
        } else {
          categoryId = generateCuid();
          await newDb.query(
            `INSERT INTO tariff_categories (id, name, sort_order, created_at, updated_at)
             VALUES ($1, $2, 99, NOW(), NOW())`,
            [categoryId, fallbackName]
          );
        }
        categoryIdMap.set(tier, categoryId);
      }

      // Проверяем дубликат по имени + длительности в той же категории
      const existing = await newDb.query(
        `SELECT id FROM tariffs WHERE name = $1 AND duration_days = $2 AND category_id = $3`,
        [t.name, t.duration_days, categoryId]
      );
      if (existing.rows.length > 0) {
        tariffIdMap.set(t.id, existing.rows[0].id);
        stats.tariffs.skipped++;
        log("⏭️", `Тариф "${t.name}" (${t.duration_days}д) — уже есть`);
        continue;
      }

      const price = getPriceForCurrency(t, systemCurrency);
      const newId = generateCuid();
      try {
        await newDb.query(
          `INSERT INTO tariffs
             (id, category_id, name, duration_days, internal_squad_uuids,
              traffic_limit_bytes, device_limit, price, currency, sort_order,
              created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
          [
            newId,
            categoryId,
            t.name,
            t.duration_days,
            `{${squadUuids.map((s) => `"${s}"`).join(",")}}`, // PostgreSQL array literal
            t.traffic_limit_bytes || null,
            t.hwid_device_limit || null,
            price,
            systemCurrency,
            t.id, // sortOrder = old id (сохраняет порядок)
          ]
        );
        tariffIdMap.set(t.id, newId);
        stats.tariffs.migrated++;
        log("✅", `Тариф "${t.name}" — ${t.duration_days}д, ${price} ${systemCurrency}`);
      } catch (err) {
        stats.tariffs.errors++;
        log("❌", `Тариф "${t.name}": ${err.message}`);
      }
    }

    log(
      "📊",
      `Тарифы: ${stats.tariffs.migrated} создано, ${stats.tariffs.skipped} пропущено, ${stats.tariffs.errors} ошибок`
    );

    // ─── 3. USERS → CLIENTS ──────────────────────────────────
    logSection("3/7  Пользователи (User → Client)");

    const usersRes = await oldDb.query(
      `SELECT * FROM "user" WHERE role = 'CLIENT' ORDER BY id`
    );
    stats.users.total = usersRes.rows.length;

    for (const u of usersRes.rows) {
      // Пропускаем дубликаты
      let existing = null;
      if (u.telegram_id) {
        existing = await newDb.query(
          `SELECT id FROM clients WHERE telegram_id = $1`,
          [String(u.telegram_id)]
        );
      }
      if ((!existing || existing.rows.length === 0) && u.email) {
        existing = await newDb.query(`SELECT id FROM clients WHERE email = $1`, [
          u.email,
        ]);
      }
      if (existing && existing.rows.length > 0) {
        userIdMap.set(u.id, existing.rows[0].id);
        stats.users.skipped++;
        continue;
      }

      const newId = generateCuid();
      const referralCode = u.referral_code || generateReferralCode();

      try {
        await newDb.query(
          `INSERT INTO clients
             (id, email, password_hash, role, remnawave_uuid, referral_code,
              balance, preferred_lang, preferred_currency,
              telegram_id, telegram_username, is_blocked, block_reason,
              referral_percent, trial_used, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())`,
          [
            newId,
            u.email || null,
            u.password_hash || null,
            "CLIENT",
            u.remnawave_uuid || null,
            referralCode,
            u.balance || 0,
            u.preferred_lang || "ru",
            systemCurrency,
            u.telegram_id ? String(u.telegram_id) : null,
            u.telegram_username || null,
            u.is_blocked || false,
            u.block_reason || null,
            u.referral_percent || null,
            u.trial_used || false,
            u.created_at || new Date(),
          ]
        );
        userIdMap.set(u.id, newId);
        stats.users.migrated++;
      } catch (err) {
        stats.users.errors++;
        log("❌", `User #${u.id} (${u.email || u.telegram_id}): ${err.message}`);
      }
    }

    log(
      "📊",
      `Пользователи: ${stats.users.migrated} создано, ${stats.users.skipped} пропущено, ${stats.users.errors} ошибок`
    );

    // ─── 4. REFERRAL LINKS ───────────────────────────────────
    logSection("4/7  Рефералы");

    const usersWithReferrer = usersRes.rows.filter((u) => u.referrer_id);
    stats.referrals.total = usersWithReferrer.length;

    for (const u of usersWithReferrer) {
      const newClientId = userIdMap.get(u.id);
      const newReferrerId = userIdMap.get(u.referrer_id);

      if (!newClientId || !newReferrerId) {
        stats.referrals.errors++;
        continue;
      }

      try {
        await newDb.query(
          `UPDATE clients SET referrer_id = $1 WHERE id = $2`,
          [newReferrerId, newClientId]
        );
        stats.referrals.linked++;
      } catch (err) {
        stats.referrals.errors++;
        log("❌", `Реферал user #${u.id} → #${u.referrer_id}: ${err.message}`);
      }
    }

    log(
      "📊",
      `Рефералы: ${stats.referrals.linked} связано, ${stats.referrals.errors} ошибок`
    );

    // ─── 5. PAYMENTS ─────────────────────────────────────────
    logSection("5/7  Платежи (Payment → Payment)");

    const paymentsRes = await oldDb.query(
      `SELECT * FROM payment ORDER BY id`
    );
    stats.payments.total = paymentsRes.rows.length;

    for (const p of paymentsRes.rows) {
      const newClientId = userIdMap.get(p.user_id);
      if (!newClientId) {
        stats.payments.skipped++;
        continue;
      }

      // Проверяем дубликат по order_id
      const existing = await newDb.query(
        `SELECT id FROM payments WHERE order_id = $1`,
        [p.order_id]
      );
      if (existing.rows.length > 0) {
        stats.payments.skipped++;
        continue;
      }

      const newTariffId = p.tariff_id ? tariffIdMap.get(p.tariff_id) : null;
      const newId = generateCuid();

      try {
        await newDb.query(
          `INSERT INTO payments
             (id, client_id, order_id, amount, currency, status, provider,
              external_id, tariff_id, metadata, created_at, paid_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            newId,
            newClientId,
            p.order_id,
            p.amount,
            p.currency || systemCurrency,
            p.status || "PENDING",
            p.payment_provider || null,
            p.payment_system_id || null,
            newTariffId,
            p.description ? JSON.stringify({ description: p.description }) : null,
            p.created_at || new Date(),
            p.status === "PAID" ? p.created_at || new Date() : null,
          ]
        );
        stats.payments.migrated++;
      } catch (err) {
        stats.payments.errors++;
        log("❌", `Payment ${p.order_id}: ${err.message}`);
      }
    }

    log(
      "📊",
      `Платежи: ${stats.payments.migrated} создано, ${stats.payments.skipped} пропущено, ${stats.payments.errors} ошибок`
    );

    // ─── 6. PROMO CODES ──────────────────────────────────────
    logSection("6/7  Промокоды (PromoCode → PromoCode)");

    let promoCodesRes;
    try {
      promoCodesRes = await oldDb.query(`SELECT * FROM promo_code ORDER BY id`);
    } catch {
      promoCodesRes = { rows: [] };
      log("⚠️", "Таблица промокодов не найдена, пропускаю");
    }
    stats.promoCodes.total = promoCodesRes.rows.length;

    for (const pc of promoCodesRes.rows) {
      const existing = await newDb.query(
        `SELECT id FROM promo_codes WHERE code = $1`,
        [pc.code]
      );
      if (existing.rows.length > 0) {
        stats.promoCodes.skipped++;
        continue;
      }

      const newId = generateCuid();
      // Маппинг типов:  PERCENT → DISCOUNT, DAYS → FREE_DAYS
      const newType = pc.promo_type === "DAYS" ? "FREE_DAYS" : "DISCOUNT";

      try {
        await newDb.query(
          `INSERT INTO promo_codes
             (id, code, name, type, discount_percent, discount_fixed,
              squad_uuid, duration_days, max_uses, max_uses_per_client,
              is_active, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())`,
          [
            newId,
            pc.code,
            `Промокод ${pc.code}`, // name (в старой панели его нет)
            newType,
            newType === "DISCOUNT" ? pc.value : null,   // discount_percent
            null,                                        // discount_fixed
            pc.squad_id || null,                         // squad_uuid (для FREE_DAYS)
            newType === "FREE_DAYS" ? pc.value : null,   // duration_days
            pc.uses_left || 0,                           // max_uses
            1,                                           // max_uses_per_client
            (pc.uses_left || 0) > 0,                     // is_active
          ]
        );
        stats.promoCodes.migrated++;
        log("✅", `Промокод "${pc.code}" (${newType}, value=${pc.value})`);
      } catch (err) {
        stats.promoCodes.errors++;
        log("❌", `Промокод "${pc.code}": ${err.message}`);
      }
    }

    log(
      "📊",
      `Промокоды: ${stats.promoCodes.migrated} создано, ${stats.promoCodes.skipped} пропущено, ${stats.promoCodes.errors} ошибок`
    );

    // ─── 7. SETTINGS ─────────────────────────────────────────
    logSection("7/7  Настройки → SystemSettings");

    // Мигрируем ключевые настройки из старых таблиц
    const settingsToMigrate = [];

    // SystemSetting
    try {
      const sysRes = await oldDb.query(`SELECT * FROM system_setting LIMIT 1`);
      if (sysRes.rows.length > 0) {
        const s = sysRes.rows[0];
        const currency = systemCurrency || s.default_currency || "usd";
        const activeCurrencies = systemCurrency
          ? systemCurrency
          : parseCommaSeparated(s.active_currencies) || "usd,rub";
        const activeLanguages = parseCommaSeparated(s.active_languages) || "ru,en";
        settingsToMigrate.push(
          { key: "default_language", value: s.default_language || "ru" },
          { key: "default_currency", value: currency },
          { key: "active_languages", value: activeLanguages },
          { key: "active_currencies", value: activeCurrencies }
        );
      }
    } catch {
      log("⚠️", "Таблица system_setting не найдена");
    }

    // ReferralSetting
    try {
      const refRes = await oldDb.query(`SELECT * FROM referral_setting LIMIT 1`);
      if (refRes.rows.length > 0) {
        const r = refRes.rows[0];
        settingsToMigrate.push(
          { key: "default_referral_percent", value: String(r.default_referral_percent || 10) },
          { key: "referral_level1_percent", value: String(r.default_referral_percent || 10) },
          { key: "referral_level2_percent", value: "5" },
          { key: "referral_level3_percent", value: "2" },
          { key: "trial_days", value: String(r.invitee_bonus_days || 3) },
          { key: "trial_squad_uuid", value: r.trial_squad_id || "" }
        );
      }
    } catch {
      log("⚠️", "Таблица referral_setting не найдена");
    }

    // BotConfig
    try {
      const botRes = await oldDb.query(`SELECT service_name, support_url, support_bot_username, trial_days FROM bot_config LIMIT 1`);
      if (botRes.rows.length > 0) {
        const b = botRes.rows[0];
        if (b.service_name) settingsToMigrate.push({ key: "service_name", value: b.service_name });
        if (b.support_url) settingsToMigrate.push({ key: "support_url", value: b.support_url });
        if (b.support_bot_username) settingsToMigrate.push({ key: "support_bot_username", value: b.support_bot_username });
        if (b.trial_days) settingsToMigrate.push({ key: "trial_days", value: String(b.trial_days) });
      }
    } catch {
      log("⚠️", "Таблица конфигурации бота не найдена");
    }

    // BrandingSetting
    try {
      const brandRes = await oldDb.query(`SELECT logo_url, favicon_url, site_name FROM branding_setting LIMIT 1`);
      if (brandRes.rows.length > 0) {
        const br = brandRes.rows[0];
        if (br.logo_url) settingsToMigrate.push({ key: "logo_url", value: br.logo_url });
        if (br.favicon_url) settingsToMigrate.push({ key: "favicon_url", value: br.favicon_url });
        if (br.site_name) settingsToMigrate.push({ key: "site_name", value: br.site_name });
      }
    } catch {
      log("⚠️", "Таблица настроек брендинга не найдена");
    }

    // TrialSettings
    try {
      const trialRes = await oldDb.query(`SELECT * FROM trial_settings LIMIT 1`);
      if (trialRes.rows.length > 0) {
        const tr = trialRes.rows[0];
        settingsToMigrate.push(
          { key: "trial_days", value: String(tr.days || 3) },
          { key: "trial_devices", value: String(tr.devices || 3) },
          { key: "trial_traffic_limit_bytes", value: String(tr.traffic_limit_bytes || 0) },
          { key: "trial_enabled", value: String(tr.enabled !== false) }
        );
      }
    } catch {
      log("⚠️", "Таблица настроек триалов не найдена");
    }

    // Если FORCE_CURRENCY задан, гарантируем что валюта будет записана в настройки
    if (FORCE_CURRENCY) {
      const hasCurrency = settingsToMigrate.some((s) => s.key === "default_currency");
      if (!hasCurrency) {
        settingsToMigrate.push(
          { key: "default_currency", value: FORCE_CURRENCY },
          { key: "active_currencies", value: FORCE_CURRENCY }
        );
      }
    }

    // Записываем настройки (upsert)
    for (const s of settingsToMigrate) {
      try {
        const existing = await newDb.query(
          `SELECT id FROM system_settings WHERE key = $1`,
          [s.key]
        );
        if (existing.rows.length > 0) {
          await newDb.query(`UPDATE system_settings SET value = $1 WHERE key = $2`, [
            s.value,
            s.key,
          ]);
        } else {
          await newDb.query(
            `INSERT INTO system_settings (id, key, value) VALUES ($1, $2, $3)`,
            [generateCuid(), s.key, s.value]
          );
        }
        stats.settings.migrated++;
        log("✅", `${s.key} = ${s.value.substring(0, 60)}${s.value.length > 60 ? "..." : ""}`);
      } catch (err) {
        log("❌", `Настройка ${s.key}: ${err.message}`);
      }
    }

    log("📊", `Настройки: ${stats.settings.migrated} перенесено`);

    // ─── ИТОГО ───────────────────────────────────────────────
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    МИГРАЦИЯ ЗАВЕРШЕНА                        ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Клиенты:    ${String(stats.users.migrated).padStart(5)} создано  ${String(stats.users.skipped).padStart(5)} пропущено  ${String(stats.users.errors).padStart(3)} ошибок  ║
║  Категории:  ${String(stats.categories.migrated).padStart(5)} создано  ${String(stats.categories.skipped).padStart(5)} пропущено             ║
║  Тарифы:     ${String(stats.tariffs.migrated).padStart(5)} создано  ${String(stats.tariffs.skipped).padStart(5)} пропущено  ${String(stats.tariffs.errors).padStart(3)} ошибок  ║
║  Платежи:    ${String(stats.payments.migrated).padStart(5)} создано  ${String(stats.payments.skipped).padStart(5)} пропущено  ${String(stats.payments.errors).padStart(3)} ошибок  ║
║  Промокоды:  ${String(stats.promoCodes.migrated).padStart(5)} создано  ${String(stats.promoCodes.skipped).padStart(5)} пропущено  ${String(stats.promoCodes.errors).padStart(3)} ошибок  ║
║  Рефералы:   ${String(stats.referrals.linked).padStart(5)} связано                ${String(stats.referrals.errors).padStart(3)} ошибок  ║
║  Настройки:  ${String(stats.settings.migrated).padStart(5)} перенесено                            ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);

    const totalErrors =
      stats.users.errors +
      stats.tariffs.errors +
      stats.payments.errors +
      stats.promoCodes.errors +
      stats.referrals.errors;

    if (totalErrors > 0) {
      log("⚠️", `Всего ошибок: ${totalErrors}. Проверьте логи выше.`);
    } else {
      log("🎉", "Миграция прошла без ошибок!");
    }

    log("💡", "Не забудьте:");
    log("  ", "  1. Проверить данные в админ-панели новой версии");
    log("  ", "  2. Настроить платёжную систему (Platega) в настройках");
    log("  ", "  3. Обновить бот-токен в .env если бот другой");
    log("  ", "  4. Запустить синхронизацию с Remnawave из панели StealthNet");
  } catch (err) {
    console.error("\n❌ КРИТИЧЕСКАЯ ОШИБКА:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await oldDb.end().catch(() => {});
    await newDb.end().catch(() => {});
  }
}

// ══════════════════════════════════════════════════════════════════
//  ЗАПУСК
// ══════════════════════════════════════════════════════════════════
migrate().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
