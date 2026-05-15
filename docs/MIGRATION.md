# Migration to STEALTHNET 3.0

Instructions for migrating data from previous panel versions.

> **Important:** Before any migration, make a backup of the new database.  
> All scripts are **idempotent** — duplicates are skipped upon restarting.

---

## Table of Contents

- [General: Preparation](#general-preparation)
- [Currency Determination](#currency-determination)
- [Option 1: Migration from the old panel (Flask)](#option-1-migration-from-the-old-panel-flask)
- [Option 2: Migration from Bedolaga Bot](#option-2-migration-from-bedolaga-bot)
- [Frequently Asked Questions](#frequently-asked-questions)

---

## General: Preparation

### 1. Make sure the new panel is running

```bash
docker compose ps
# All services should be Up
```

### 2. Install migration script dependencies (once)

```bash
cd /opt/remnawave-STEALTHNET-Bot/scripts
npm install
cd ..
```

### 3. Make a backup of the new database

```bash
docker compose exec postgres pg_dump -U stealthnet stealthnet > backup_before_migration.sql
```

---

## Currency Determination

Both migration scripts **automatically determine the system currency** from the new panel settings (`system_settings` table, `default_currency` key).

| System currency | What happens                                              |
| --------------- | --------------------------------------------------------- |
| `rub`           | Balances, prices, and payments are migrated in **rubles** |
| `usd`           | Everything is converted to **dollars**                    |

The currency can be set via the admin panel settings (Settings → Default Currency) **before** running the migration, or overridden via ENV:

```bash
DEFAULT_CURRENCY=rub node scripts/migrate-from-old-panel.js
```

---

## Option 1: Migration from the old panel (Flask)

> Script: `scripts/migrate-from-old-panel.js`  
> Source: PostgreSQL database of the previous STEALTHNET panel (Flask + SQLAlchemy)

### What is migrated

| Old panel (Flask)            | STEALTHNET 3.0   | Details                                                                                  |
| ---------------------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| `User`                       | `Client`         | email, telegram_id, balance, referral_code, remnawave_uuid, trial_used                   |
| `TariffLevel` / `tier` field | `TariffCategory` | basic → "Basic", pro → "Premium", elite → "Elite"                                        |
| `Tariff`                     | `Tariff`         | Price is taken from the system currency column (`price_rub` / `price_usd` / `price_uah`) |
| `Payment`                    | `Payment`        | Entire payment history with providers                                                    |
| `PromoCode`                  | `PromoCode`      | PERCENT → DISCOUNT, DAYS → FREE_DAYS                                                     |
| `referrer_id` relations      | `referrerId`     | Referral chains                                                                          |
| `SystemSetting`              | `SystemSettings` | Language, currency, active languages/currencies                                          |
| `BotConfig`                  | `SystemSettings` | Service name, support, trial days                                                        |
| `BrandingSetting`            | `SystemSettings` | Logo, favicon, title                                                                     |
| `ReferralSetting`            | `SystemSettings` | Referral percentages, squad trial                                                        |
| `TrialSettings`              | `SystemSettings` | Days, devices, traffic                                                                   |

### Running the migration

```bash
cd /opt/remnawave-STEALTHNET-Bot

OLD_DB_HOST=localhost \
OLD_DB_PORT=5432 \
OLD_DB_NAME=stealthnet_old \
OLD_DB_USER=stealthnet \
OLD_DB_PASSWORD=old_password \
NEW_DB_HOST=localhost \
NEW_DB_PORT=5432 \
NEW_DB_NAME=stealthnet \
NEW_DB_USER=stealthnet \
NEW_DB_PASSWORD=new_password \
node scripts/migrate-from-old-panel.js
```

> If both databases are on the same server, specify different `OLD_DB_NAME` / `NEW_DB_NAME`.

### All variables

| Variable           | Default                         | Description                      |
| ------------------ | ------------------------------- | -------------------------------- |
| `OLD_DB_HOST`      | `localhost`                     | Old PostgreSQL host              |
| `OLD_DB_PORT`      | `5432`                          | Old DB port                      |
| `OLD_DB_NAME`      | `stealthnet`                    | Old DB name                      |
| `OLD_DB_USER`      | `stealthnet`                    | Old DB user                      |
| `OLD_DB_PASSWORD`  | `stealthnet_password_change_me` | Old DB password                  |
| `NEW_DB_HOST`      | `localhost`                     | New PostgreSQL host              |
| `NEW_DB_PORT`      | `5432`                          | New DB port                      |
| `NEW_DB_NAME`      | `stealthnet`                    | New DB name                      |
| `NEW_DB_USER`      | `stealthnet`                    | New DB user                      |
| `NEW_DB_PASSWORD`  | `stealthnet_change_me`          | New DB password                  |
| `DEFAULT_CURRENCY` | *(from system_settings)*        | Override currency (`rub`, `usd`) |

### Example output

```
  💱  System currency: RUB
      Balances and prices will be migrated in RUB

═══════════════════════════════════════════════════════════════
  1/7  Tariff Categories (TariffLevel → TariffCategory)
═══════════════════════════════════════════════════════════════
  ✅  Category "Basic" (basic)
  ✅  Category "Premium" (pro)
  ...

╔══════════════════════════════════════════════════════════════╗
║                     MIGRATION COMPLETED                      ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Clients:       42 created      0 skipped      0 errors      ║
║  Categories:     3 created      0 skipped                    ║
║  Tariffs:        9 created      0 skipped      0 errors      ║
║  Payments:     156 created      0 skipped      0 errors      ║
║  Promo codes:    5 created      0 skipped      0 errors      ║
║  Referrals:     18 linked                      0 errors      ║
║  Settings:      12 migrated                                  ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

### After migration

- [ ] Go to the **admin panel** → check clients, tariffs, and payments
- [ ] Configure the **payment system** (Platega) in the "Settings" section
- [ ] Click **"Sync from Remna"** in the admin panel — this will link current subscriptions
- [ ] Check the **bot token** in `.env` (if the bot is new — run `docker compose restart bot`)

---

## Option 2: Migration from Bedolaga Bot

> Script: `scripts/migrate-from-bedolaga.js`  
> Source: JSON backup (`backup_*.tar.gz`) from remnawave-bedolaga-telegram-bot

### What is migrated

| Bedolaga Bot        | STEALTHNET 3.0      | Details                                                                   |
| ------------------- | ------------------- | ------------------------------------------------------------------------- |
| `users`             | `clients`           | telegram_id, username, first name, balance, remnawave_uuid, referral_code |
| `subscriptions`     | `trial_used` update | Subscription data is already in Remnawave — will be pulled via Sync       |
| `transactions`      | `payments`          | All transactions: deposits, purchases, bonuses                            |
| `referred_by_id`    | `referrerId`        | Referral chains                                                           |
| `referral_earnings` | `referral_credits`  | Accruals to referrals                                                     |
| `system_settings`   | `system_settings`   | General settings (secrets/tokens are skipped)                             |

### Currency conversion (kopecks)

Bedolaga stores amounts in **kopecks**. The script converts them automatically:

| System currency | Formula                        | Example: 30000 kopecks      |
| --------------- | ------------------------------ | --------------------------- |
| `rub`           | kopecks ÷ 100                  | **300 ₽**                   |
| `usd`           | kopecks × `KOPEKS_TO_USD` rate | **3.00 $** (at 0.0001 rate) |

### Running the migration

```bash
cd /opt/remnawave-STEALTHNET-Bot

# Path to the backup as an argument
node scripts/migrate-from-bedolaga.js ./backup_20260126_000000.tar.gz
```

Or with variables:

```bash
NEW_DB_HOST=localhost \
NEW_DB_PORT=5432 \
NEW_DB_NAME=stealthnet \
NEW_DB_USER=stealthnet \
NEW_DB_PASSWORD=new_password \
KOPEKS_TO_USD=0.0001 \
node scripts/migrate-from-bedolaga.js ./backup.tar.gz
```

### All variables

| Variable           | Default                  | Description                                     |
| ------------------ | ------------------------ | ----------------------------------------------- |
| `NEW_DB_HOST`      | `localhost`              | New PostgreSQL host                             |
| `NEW_DB_PORT`      | `5432`                   | Port                                            |
| `NEW_DB_NAME`      | `stealthnet`             | DB name                                         |
| `NEW_DB_USER`      | `stealthnet`             | User                                            |
| `NEW_DB_PASSWORD`  | `stealthnet_change_me`   | Password                                        |
| `DEFAULT_CURRENCY` | *(from system_settings)* | Override currency                               |
| `KOPEKS_TO_USD`    | `0.0001`                 | Rate for USD (1 kopeck = X USD). Only for `usd` |

### Example output

```
  💱  System currency: RUB
      Kopecks → rubles (÷100)

╔══════════════════════════════════════════════════════════════╗
║             MIGRATION FROM BEDOLAGA COMPLETED                ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Clients:        17 created     0 skipped      0 errors      ║
║  Subscriptions:   6 updated     0 skipped                    ║
║  Payments:       11 created     0 skipped      0 errors      ║
║  Referrals:       2 linked                     0 errors      ║
║  Ref. bonuses:    1 created                    0 errors      ║
║  Settings:        4 migrated                                 ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

### After migration

- [ ] Check the clients in the **admin panel**
- [ ] Click **"Sync from Remna"** — it will pull subscriptions from Remnawave
- [ ] **Create tariffs** manually (there are no tariff plans in Bedolaga)
- [ ] Configure the **payment system** (Platega)
- [ ] If necessary, adjust the rate and restart the migration

---

## Frequently Asked Questions

### Can the migration be run again?

Yes. Both scripts are idempotent — duplicates are skipped by `telegram_id`, `email`, `order_id`. Data is not duplicated.

### How to rollback the migration?

Restore the backup:

```bash
docker compose exec -T postgres psql -U stealthnet stealthnet < backup_before_migration.sql
```

### I have SQLite in the old panel, not PostgreSQL

The `migrate-from-old-panel.js` script only works with PostgreSQL. If the old panel runs on SQLite, first migrate it to PostgreSQL (there is a `migration/manual/migrate_to_postgresql.py` script in the old panel), then run our script.

### How do I find out which currency is set in the system?

```bash
docker compose exec postgres psql -U stealthnet stealthnet \
  -c "SELECT value FROM system_settings WHERE key = 'default_currency';"
```

Or go to the admin panel → **Settings** → "Default Currency" section.

### Balances migrated in the wrong currency

1. Set the desired currency in the admin panel (Settings → Currency)
2. Clear the migrated clients (or restore the backup)
3. Restart the migration — it will pick up the current currency

### Where is the Bedolaga backup?

In Bedolaga Bot settings → Backups, or in the `/app/data/backups/` folder inside the container:

```bash
docker cp stealthnet-bot:/app/data/backups/ ./bedolaga-backups/
ls ./bedolaga-backups/
```
