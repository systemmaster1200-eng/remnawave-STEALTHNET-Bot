# مهاجرت به STEALTHNET 3.0

دستورالعمل‌های انتقال داده از نسخه‌های قبلی پنل.

> **مهم:** قبل از هرگونه مهاجرت، از دیتابیس جدید بکاپ بگیرید.  
> تمامی اسکریپت‌ها **آیدمپوتنت (Idempotent)** هستند — در صورت اجرای مجدد، موارد تکراری نادیده گرفته می‌شوند.

---

## فهرست مطالب

- [موارد کلی: آماده‌سازی](#%D9%85%D9%88%D8%A7%D8%B1%D8%AF-%DA%A9%D9%84%DB%8C-%D8%A2%D9%85%D8%A7%D8%AF%D9%87%E2%80%8C%D8%B3%D8%A7%D8%B2%DB%8C)
- [تعیین ارز](#%D8%AA%D8%B9%DB%8C%DB%8C%D9%86-%D8%A7%D8%B1%D8%B2)
- [گزینه 1: مهاجرت از پنل قدیمی (Flask)](#%DA%AF%D8%B2%DB%8C%D9%86%D9%87-1-%D9%85%D9%87%D8%A7%D8%AC%D8%B1%D8%AA-%D8%A7%D8%B2-%D9%BE%D9%86%D9%84-%D9%82%D8%AF%DB%8C%D9%85%DB%8C-flask)
- [گزینه 2: مهاجرت از ربات Bedolaga](#%DA%AF%D8%B2%DB%8C%D9%86%D9%87-2-%D9%85%D9%87%D8%A7%D8%AC%D8%B1%D8%AA-%D8%A7%D8%B2-%D8%B1%D8%A8%D8%A7%D8%AA-bedolaga)
- [سوالات متداول (FAQ)](#%D8%B3%D9%88%D8%A7%D9%84%D8%A7%D8%AA-%D9%85%D8%AA%D8%AF%D8%A7%D9%88%D9%84-faq)

---

## موارد کلی: آماده‌سازی

### 1. مطمئن شوید که پنل جدید در حال اجرا است

```bash
docker compose ps
# وضعیت تمامی سرویس‌ها باید Up باشد
```

### 2. نصب وابستگی‌های اسکریپت مهاجرت (فقط یک‌بار)

```bash
cd /opt/remnawave-STEALTHNET-Bot/scripts
npm install
cd ..
```

### 3. از دیتابیس جدید بکاپ بگیرید

```bash
docker compose exec postgres pg_dump -U stealthnet stealthnet > backup_before_migration.sql
```

---

## تعیین ارز

هر دو اسکریپت مهاجرت **به طور خودکار ارز سیستم را تعیین می‌کنند** (این مورد از تنظیمات پنل جدید در جدول `system_settings` کلید `default_currency` خوانده می‌شود).

| ارز سیستم | چه اتفاقی می‌افتد                                     |
| --------- | -------------------------------------------------------- |
| `rub`     | موجودی‌ها، قیمت‌ها و پرداخت‌ها به **روبل** منتقل می‌شوند |
| `usd`     | همه‌چیز به **دلار** تبدیل می‌شود                          |

می‌توانید ارز را از طریق تنظیمات در پنل ادمین (Settings → Default Currency) **قبل از** اجرای مهاجرت تنظیم کنید یا آن را از طریق ENV لغو و جایگزین کنید:

```bash
DEFAULT_CURRENCY=rub node scripts/migrate-from-old-panel.js
```

---

## گزینه 1: مهاجرت از پنل قدیمی (Flask)

> اسکریپت: `scripts/migrate-from-old-panel.js`  
> منبع: دیتابیس PostgreSQL مربوط به پنل قبلی STEALTHNET (مبتنی بر Flask + SQLAlchemy)

### چه مواردی منتقل می‌شوند

| پنل قدیمی (Flask)           | STEALTHNET 3.0   | جزئیات                                                                        |
| --------------------------- | ---------------- | ------------------------------------------------------------------------------- |
| `User`                      | `Client`         | ایمیل، telegram_id، موجودی، referral_code، remnawave_uuid، trial_used          |
| `TariffLevel` / فیلد `tier` | `TariffCategory` | basic → "پایه", pro → "پریمیوم", elite → "الیت"                                |
| `Tariff`                    | `Tariff`         | قیمت از ستون ارز سیستم دریافت می‌شود (`price_rub` / `price_usd` / `price_uah`) |
| `Payment`                   | `Payment`        | تاریخچه کامل پرداخت‌ها با ارائه‌دهندگان                                         |
| `PromoCode`                 | `PromoCode`      | PERCENT → DISCOUNT, DAYS → FREE_DAYS                                             |
| روابط `referrer_id`         | `referrerId`     | زنجیره‌های زیرمجموعه‌گیری                                                       |
| `SystemSetting`             | `SystemSettings` | زبان، ارز، زبان‌ها/ارزهای فعال                                                 |
| `BotConfig`                 | `SystemSettings` | نام سرویس، پشتیبانی، روزهای تست (Trial)                                       |
| `BrandingSetting`           | `SystemSettings` | لوگو، فاوآیکون، عنوان                                                          |
| `ReferralSetting`           | `SystemSettings` | درصدهای زیرمجموعه‌گیری، تست گروهی (Squad)                                      |
| `TrialSettings`             | `SystemSettings` | روزها، دستگاه‌ها، ترافیک                                                       |

### اجرای مهاجرت

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

> اگر هر دو دیتابیس روی یک سرور قرار دارند، نام‌های متفاوتی برای `OLD_DB_NAME` / `NEW_DB_NAME` مشخص کنید.

### تمامی متغیرها

| متغیر              | پیش‌فرض                          | توضیحات                         |
| ------------------ | ------------------------------- | --------------------------------- |
| `OLD_DB_HOST`      | `localhost`                     | هاست PostgreSQL قدیمی            |
| `OLD_DB_PORT`      | `5432`                          | پورت دیتابیس قدیمی              |
| `OLD_DB_NAME`      | `stealthnet`                    | نام دیتابیس قدیمی               |
| `OLD_DB_USER`      | `stealthnet`                    | کاربر دیتابیس قدیمی             |
| `OLD_DB_PASSWORD`  | `stealthnet_password_change_me` | رمزعبور دیتابیس قدیمی           |
| `NEW_DB_HOST`      | `localhost`                     | هاست PostgreSQL جدید             |
| `NEW_DB_PORT`      | `5432`                          | پورت دیتابیس جدید                |
| `NEW_DB_NAME`      | `stealthnet`                    | نام دیتابیس جدید                 |
| `NEW_DB_USER`      | `stealthnet`                    | کاربر دیتابیس جدید               |
| `NEW_DB_PASSWORD`  | `stealthnet_change_me`          | رمزعبور دیتابیس جدید             |
| `DEFAULT_CURRENCY` | *(از system_settings)*          | لغو و جایگزینی ارز (`rub`, `usd`) |

### نمونه خروجی

```
  💱  ارز سیستم: RUB
      موجودی‌ها و قیمت‌ها به RUB منتقل خواهند شد

═══════════════════════════════════════════════════════════════
  1/7  دسته‌بندی‌های تعرفه (TariffLevel → TariffCategory)
═══════════════════════════════════════════════════════════════
  ✅  دسته "پایه" (basic)
  ✅  دسته "پریمیوم" (pro)
  ...

╔══════════════════════════════════════════════════════════════╗
║                     مهاجرت تکمیل شد                         ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  کاربران:        42 ایجاد شد    0 نادیده گرفته شد  0 خطا  ║
║  دسته‌ها:         3 ایجاد شد    0 نادیده گرفته شد          ║
║  تعرفه‌ها:         9 ایجاد شد    0 نادیده گرفته شد  0 خطا  ║
║  پرداخت‌ها:      156 ایجاد شد    0 نادیده گرفته شد  0 خطا  ║
║  کدهای تخفیف:      5 ایجاد شد    0 نادیده گرفته شد  0 خطا ║
║  زیرمجموعه‌ها:     18 متصل شد                       0 خطا   ║
║  تنظیمات:        12 منتقل شد                                ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

### پس از مهاجرت

- [ ] به **پنل ادمین** بروید → کاربران، تعرفه‌ها و پرداخت‌ها را بررسی کنید
- [ ] **سیستم پرداخت** (Platega) را در بخش "Settings" پیکربندی کنید
- [ ] در پنل ادمین روی **"Sync from Remna"** کلیک کنید — این کار اشتراک‌های فعلی را متصل می‌کند
- [ ] **توکن ربات** را در `.env` بررسی کنید (اگر ربات جدید است — دستور `docker compose restart bot` را اجرا کنید)

---

## گزینه 2: مهاجرت از ربات Bedolaga

> اسکریپت: `scripts/migrate-from-bedolaga.js`  
> منبع: فایل بکاپ JSON (`backup_*.tar.gz`) از ربات remnawave-bedolaga-telegram-bot

### چه مواردی منتقل می‌شوند

| ربات Bedolaga       | STEALTHNET 3.0          | جزئیات                                                                       |
| ------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `users`             | `clients`               | telegram_id، نام کاربری، نام، موجودی، remnawave_uuid، referral_code         |
| `subscriptions`     | به‌روزرسانی `trial_used` | داده‌های اشتراک از قبل در Remnawave موجود است — از طریق Sync دریافت می‌شود |
| `transactions`      | `payments`              | تمامی تراکنش‌ها: واریزها، خریدها، پاداش‌ها                                   |
| `referred_by_id`    | `referrerId`            | زنجیره‌های زیرمجموعه‌گیری                                                     |
| `referral_earnings` | `referral_credits`      | پورسانت‌های واریز شده به معرف‌ها                                              |
| `system_settings`   | `system_settings`       | تنظیمات کلی (رمزها/توکن‌ها نادیده گرفته می‌شوند)                             |

### تبدیل ارز (کوپک‌ها)

ربات Bedolaga مبالغ را به صورت **کوپک (kopecks)** ذخیره می‌کند. اسکریپت آنها را به طور خودکار تبدیل می‌کند:

| ارز سیستم | فرمول                      | مثال: 30000 کوپک               |
| --------- | -------------------------- | -------------------------------- |
| `rub`     | کوپک ÷ 100                 | **300 ₽**                        |
| `uah`     | کوپک ÷ 100                 | **300 ₴**                        |
| `usd`     | کوپک × نرخ `KOPEKS_TO_USD` | **3.00 $** (در صورت نرخ 0.0001) |

### اجرای مهاجرت

```bash
cd /opt/remnawave-STEALTHNET-Bot

# مسیر فایل بکاپ به عنوان آرگومان
node scripts/migrate-from-bedolaga.js ./backup_20260126_000000.tar.gz
```

یا با استفاده از متغیرها:

```bash
NEW_DB_HOST=localhost \
NEW_DB_PORT=5432 \
NEW_DB_NAME=stealthnet \
NEW_DB_USER=stealthnet \
NEW_DB_PASSWORD=new_password \
KOPEKS_TO_USD=0.0001 \
node scripts/migrate-from-bedolaga.js ./backup.tar.gz
```

### تمامی متغیرها

| متغیر              | پیش‌فرض                 | توضیحات                                  |
| ------------------ | ---------------------- | ------------------------------------ ----- |
| `NEW_DB_HOST`      | `localhost`            | هاست PostgreSQL جدید                      |
| `NEW_DB_PORT`      | `5432`                 | پورت                                      |
| `NEW_DB_NAME`      | `stealthnet`           | نام دیتابیس                               |
| `NEW_DB_USER`      | `stealthnet`           | کاربر                                     |
| `NEW_DB_PASSWORD`  | `stealthnet_change_me` | رمزعبور                                   |
| `DEFAULT_CURRENCY` | *(از system_settings)* | لغو و جایگزینی ارز                        |
| `KOPEKS_TO_USD`    | `0.0001`               | نرخ دلار (1 کوپک = X دلار). فقط برای `usd` |

### نمونه خروجی

```
  💱  ارز سیستم: RUB
      کوپک → روبل (÷100)

╔══════════════════════════════════════════════════════════════╗
║                مهاجرت از BEDOLAGA تکمیل شد                  ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  کاربران:        17 ایجاد شد    0 نادیده گرفته شد  0 خط   ║
║  اشتراک‌ها:       6 آپدیت شد    0 نادیده گرفته شد          ║
║  پرداخت‌ها:      11 ایجاد شد    0 نادیده گرفته شد  0 خطا   ║
║  زیرمجموعه‌ها:     2 متصل شد                       0 خطا    ║
║  پاداش زیرمجموعه: 1 ایجاد شد                       0 خط    ║
║  تنظیمات:         4 منتقل شد                                ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

### پس از مهاجرت

-[ ] کاربران را در **پنل ادمین** بررسی کنید
- [ ] روی **"Sync from Remna"** کلیک کنید — تا اشتراک‌ها از Remnawave دریافت شوند
- [ ] تعرفه‌ها را به صورت **دستی** ایجاد کنید (در Bedolaga هیچ پلن تعرفه‌ای وجود ندارد)
- [ ] **سیستم پرداخت** (Platega) را پیکربندی کنید
- [ ] در صورت لزوم نرخ تبدیل را اصلاح کرده و مهاجرت را دوباره اجرا کنید

---

## سوالات متداول (FAQ)

### آیا می‌توان مهاجرت را دوباره اجرا کرد؟

بله. هر دو اسکریپت آیدمپوتنت (idempotent) هستند — موارد تکراری بر اساس `telegram_id`، `email` و `order_id` نادیده گرفته می‌شوند. داده‌ها دوبار ثبت نمی‌شوند.

### چگونه مهاجرت را لغو (Rollback) کنم؟

فایل بکاپ را بازگردانی (Restore) کنید:

```bash
docker compose exec -T postgres psql -U stealthnet stealthnet < backup_before_migration.sql
```

### در پنل قدیمی من از SQLite استفاده شده، نه PostgreSQL

اسکریپت `migrate-from-old-panel.js` فقط با PostgreSQL کار می‌کند. اگر پنل قدیمی روی SQLite است، ابتدا آن را به PostgreSQL منتقل کنید (در پنل قدیمی یک اسکریپت به نام `migration/manual/migrate_to_postgresql.py` وجود دارد)، سپس اسکریپت ما را اجرا کنید.

### چگونه بفهمم کدام ارز در سیستم تنظیم شده است؟

```bash
docker compose exec postgres psql -U stealthnet stealthnet \
  -c "SELECT value FROM system_settings WHERE key = 'default_currency';"
```

یا به پنل ادمین بروید → **تنظیمات** → بخش "ارز پیش‌فرض".

### موجودی‌ها با ارز اشتباهی منتقل شده‌اند

1. ارز مورد نظر را در پنل ادمین تنظیم کنید (تنظیمات → ارز)
2. کاربران منتقل شده را پاک کنید (یا بکاپ را بازگردانی کنید)
3. مهاجرت را دوباره اجرا کنید — اسکریپت ارز جدید را در نظر خواهد گرفت

### فایل بکاپ Bedolaga کجاست؟

در تنظیمات ربات Bedolaga → بخش Backups، یا در مسیر `/app/data/backups/` داخل کانتینر:

```bash
docker cp stealthnet-bot:/app/data/backups/ ./bedolaga-backups/
ls ./bedolaga-backups/
```