<div align="center">
  <a title="English" style="text-decoration: none;" href="../../README.md">
    <img src="https://cdn.jsdelivr.net/gh/hampusborgos/country-flags@main/svg/us.svg" alt="EN" width="20" /> EN</a>
  </a>
  <a title="Russian" style="text-decoration: none;" href="../ru/README.md">
    <img src="https://cdn.jsdelivr.net/gh/hampusborgos/country-flags@main/svg/ru.svg" alt="RU" width="20" /> RU
  </a>
  <a title="Chinese" style="text-decoration: none;" href="../cn/README.md">
    <img src="https://cdn.jsdelivr.net/gh/hampusborgos/country-flags@main/svg/cn.svg" alt="CN" width="20" /> CN
  </a>
  <img src="https://cdn.jsdelivr.net/gh/hampusborgos/country-flags@main/svg/ir.svg" alt="FA" width="20" /> IR
</div>

---

<h1 align="center">STEALTHNET 3.0</h1>

<p align="center">
  <img src="https://img.shields.io/badge/STEALTHNET-3.0-blueviolet?style=for-the-badge&logoColor=white" alt="STEALTHNET 3.0" />
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
</p>

<p align="center">
  <b>یک پلتفرم کامل برای فروش اشتراک‌های VPN</b><br/>
  ربات تلگرام &bull; مینی اپلیکیشن (Mini App) &bull; پنل کاربری &bull; پنل مدیریت<br/>
  <i>همه چیز در یک پکیج. فقط با یک اسکریپت اجرا می‌شود.</i>
</p>

<p align="center">
  <a href="https://t.me/stealthnet_admin_panel"><img src="https://img.shields.io/badge/Telegram-کانال-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram" /></a>
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/ecd37b8e-68ef-4616-92da-550f8bd9cdb5" width="830" alt="STEALTHNET screenshot 1" />
</p>
<p align="center">
  <img src="https://github.com/user-attachments/assets/5c504c46-0b00-47d1-b767-7afed7f36983" width="830" alt="STEALTHNET screenshot 2" />
</p>

<p align="center">
  <a href="#-%D8%B4%D8%B1%D9%88%D8%B9-%D8%B3%D8%B1%DB%8C%D8%B9">شروع سریع</a> &bull;
  <a href="#%EF%B8%8F-%D9%BE%DB%8C%D8%B4%E2%80%8C%D9%86%DB%8C%D8%A7%D8%B2%D9%87%D8%A7%DB%8C-%D8%B3%D8%B1%D9%88%D8%B1">پیش‌نیازهای سرور</a> &bull;
  <a href="#-%D9%85%D8%B9%D9%85%D8%A7%D8%B1%DB%8C">معماری</a> &bull;
  <a href="#-%D8%A7%D9%85%DA%A9%D8%A7%D9%86%D8%A7%D8%AA">امکانات</a> &bull;
  <a href="#-%D8%B1%D8%A8%D8%A7%D8%AA-%D8%AA%D9%84%DA%AF%D8%B1%D8%A7%D9%85">ربات تلگرام</a> &bull;
  <a href="#-%D9%BE%D9%86%D9%84-%D9%88%D8%A8">پنل وب</a> &bull;
  <a href="#-api">API</a> &bull;
  <a href="#-docker">Docker</a> &bull;
  <a href="#%EF%B8%8F-%D9%BE%DB%8C%DA%A9%D8%B1%D8%A8%D9%86%D8%AF%DB%8C">پیکربندی</a> &bull;
  <a href="#-%D9%85%D9%87%D8%A7%D8%AC%D8%B1%D8%AA-1">مهاجرت</a>
</p>

---

## 🚀 شروع سریع

>[!CAUTION]
> برای جلوگیری از هرگونه تداخل، اکیداً توصیه می‌شود این مجموعه روی یک **سرور اختصاصی** نصب شود!

```bash
apt install git -y
curl -fsSL https://get.docker.com | sh
cd /opt
git clone https://github.com/systemmaster1200-eng/remnawave-STEALTHNET-Bot.git
cd remnawave-STEALTHNET-Bot
bash install.sh
```

> [!WARNING]
> اگر پس از راه‌اندازی، **سرویس API شما متوقف شد**، ربات پاسخ داد "**❌ fetch failed**"، و در لاگ‌ها (`docker compose logs -f api`) خطای "**Error: P1000: Authentication failed**" را مشاهده کردید، در صورتی که پروژه مهم دیگری روی این سرور ندارید، می‌توانید با اجرای دستور زیر فضا را آزاد کنید:
> 
> docker system prune -a --volumes

نصب‌کننده تعاملی همه چیز را در ۲ دقیقه پیکربندی می‌کند:

- دامنه و گواهینامه‌های SSL (Let's Encrypt)
- PostgreSQL، کلیدهای JWT، اطلاعات مدیر سیستم
- اتصال به Remnawave API
- ربات تلگرام
- Nginx (حالت داخلی با SSL خودکار یا ریورس پراکسی شخصی شما)

---

## 🖥️ پیش‌نیازهای سرور

پیکربندی تقریبی برای اجرای همه سرویس‌ها (API, frontend, bot, Nginx, PostgreSQL) در Docker:

| سطح          | CPU    | RAM      | دیسک      | کاربرد                                                 |
| ------------ | ------ | -------- | --------- | ------------------------------------------------------- |
| **حداقل**    | 1 vCPU | 1.5–2 GB | 20 GB     | تست، دمو، تا ~50 کاربر فعال                           |
| **متوسط**    | 2 vCPU | 4 GB     | 40 GB SSD | استفاده پروداکشن کوچک، تا ~500 کاربر، عملکرد پایدار |
| **پیشنهادی** | 4 vCPU | 8 GB     | 80 GB SSD | استفاده پروداکشن حرفه‌ای، هزاران کاربر، پاسخ‌دهی سریع |

**عمومی:**

- سیستم‌عامل: Linux (Debian 13، Ubuntu 24.04 LTS یا مشابه)، Docker و Docker Compose نسخه ۲ و بالاتر.
- پورت‌های باز: **80** (HTTP) و **443** (HTTPS)؛ هنگام نصب از طریق `install.sh` تنها همین دو مورد نیاز است.
- برای سطوح متوسط و پیشنهادی، استفاده از SSD و تهیه بکاپ مجزا از دیتابیس توصیه می‌شود.

---

## 🧱 معماری

```
┌──────────────────────────────────────────────────────────┐
│                      STEALTHNET 3.0                      │
├──────────────┬──────────────┬──────────────┬─────────────┤
│  Telegram    │  Mini App    │  پنل         │  پنل       │
│  Bot         │  (WebApp)    │  کاربری      │  مدیریت    │
│  Grammy      │  React       │  React       │  React      │
├──────────────┴──────────────┴──────────────┴─────────────┤
│                   Backend API (Express)                  │
│            JWT Auth  ·  Prisma ORM  ·  Webhooks          │
├──────────────────────────────────────────────────────────┤
│          PostgreSQL          │       Remnawave API       │
│          (داده‌ها)             │       (هسته VPN)        │
├──────────────────────────────┴───────────────────────────┤
│         Nginx + Let's Encrypt  ·  Docker Compose         │
└──────────────────────────────────────────────────────────┘
```

| سرویس        | تکنولوژی                                               | کاربرد                                                                                         |
| ------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| **backend**  | Node.js, Express, Prisma, PostgreSQL                   | رابط برنامه‌نویسی REST: احراز هویت، مشتریان، تعرفه‌ها، پرداخت‌ها، زیرمجموعه‌ها، کد تخفیف، آمار |
| **frontend** | React 18, Vite, Tailwind CSS, shadcn/ui, Framer Motion | پنل مدیریت + داشبورد مشتری + مینی اپلیکیشن تلگرام                                             |
| **bot**      | Grammy (TypeScript)                                    | ربات تلگرام کامل با پنل کاربری                                                                 |
| **nginx**    | Nginx + Certbot                                        | ریورس پراکسی، SSL، فایل‌های استاتیک، gzip                                                       |
| **postgres** | PostgreSQL 16                                          | ذخیره‌سازی داده‌ها                                                                                |

---

## ✨ امکانات

### 💳 پرداخت‌ها و اشتراک‌ها

- **Platega.io** — درگاه پرداخت (کارت، SBP، کریپتو و غیره)؛ آدرس کال‌بک در پنل مدیریت کپی می‌شود
- **YooMoney** — شارژ حساب و پرداخت تعرفه با کارت (فرم انتقال، نوتیفیکیشن‌های HTTP)
- **YooKassa** — پرداخت کارتی و SBP از طریق API (فقط RUB)؛ صدور فاکتور 54-FZ
- **پرداخت از کیف پول** — شارژ و کسر از موجودی داخلی
- **فعال‌سازی خودکار** — پس از پرداخت، تعرفه از طریق وب‌هوک به‌صورت لحظه‌ای فعال می‌شود
- **توضیحات پرداخت** — نام سرویس شما در توضیحات تمامی درگاه‌ها ثبت می‌شود
- **تعرفه‌های منعطف** — دسته‌بندی‌ها، مدت زمان، محدودیت‌های حجم و دستگاه، اتصال به اسکوادهای (Squads) رمنوویو
- **پشتیبانی از چند ارز** — پشتیبانی از ارزهای مختلف (USD, RUB و غیره)

### 🤝 برنامه زیرمجموعه‌گیری (ریفرال)

- **زیرمجموعه‌گیری ۳ سطحی** — کسب درآمد از افراد دعوت‌شده و زیرمجموعه‌های آن‌ها
- **درصدهای قابل تنظیم** — تعیین درصد مجزا برای هر سطح
- **واریز خودکار** — با هر پرداخت زیرمجموعه، پورسانت به موجودی اضافه می‌شود
- **لینک‌های دعوت** — برای ربات و وب‌سایت

### 🎟️ سیستم کدهای تبلیغاتی (پرو‌مو)

- **گروه‌های تبلیغاتی** — اشتراک رایگان از طریق لینک اختصاصی با محدودیت دفعات استفاده
- **کدهای تخفیف** — تخفیف (درصدی یا مبلغ ثابت) و اهدای روزهای رایگان
- **محدودیت استفاده** — تعیین سقف کلی و محدودیت برای هر کاربر
- **آمار استفاده** — رهگیری تعداد استفاده، توسط چه کسی و در چه زمانی

### 🧪 دوره آزمایشی (تریال)

- **تریال رایگان** — با امکان تنظیم مدت زمان، محدودیت حجم و دستگاه
- **یک‌بار مصرف** — امکان استفاده فقط یک بار برای هر مشتری
- **تخصیص اسکواد** — تعیین اسکواد مجزا برای کاربران تریال

### 🔗 ادغام با Remnawave

- **مدیریت کاربران** — ایجاد، حذف و مسدودسازی کاربران در Remnawave
- **اشتراک‌ها** — فعال‌سازی، تمدید و بررسی وضعیت
- **نودها (Nodes)** — مانیتورینگ، روشن/خاموش کردن، ری‌استارت
- **اسکوادها (Squads)** — توزیع کاربران بین سرورهای مختلف
- **همگام‌سازی** — همگام‌سازی دوطرفه داده‌ها (Remnawave <-> STEALTHNET)
- **وب‌هوک‌ها** — پردازش خودکار رویدادهای دریافتی از Remnawave

### 📱 نسخه موبایل و مینی اپلیکیشن

- **دسته‌بندی‌های تاشو** — نمایش آکاردئونی لیست دسته‌ها در موبایل
- **طراحی فشرده تعرفه‌ها** — در موبایل تمامی سرویس‌ها به صورت لیست‌های خوانا نمایش داده می‌شوند
- **رابط کاربری یکپارچه** — ظاهر یکسان در مرورگر موبایل و WebApp تلگرام

### 📊 آمار و گزارش‌ها

- **داشبورد** — نمایش معیارهای کلیدی در لحظه
- **نمودار درآمد** — نمایش درآمد روزانه طی ۹۰ روز گذشته
- **رشد مشتریان** — روند ثبت‌نام‌ها
- **برترین سرویس‌ها** — پرفروش‌ترین تعرفه‌ها
- **آمار ریفرال** — میزان درآمد از سطوح مختلف زیرمجموعه

### 🔐 امنیت

- **احراز هویت JWT** — توکن‌های Access و Refresh
- **اجبار به تغییر رمزعبور** — هنگام اولین ورود مدیر سیستم
- **تأیید ایمیل** — احراز هویت حساب کاربری با لینک ایمیل شده
- **مسدودسازی کاربران** — با ذکر دلیل
- **SSL/TLS** — دریافت گواهینامه رایگان Let's Encrypt به صورت خودکار

---

## 🤖 ربات تلگرام

یک پنل کاربری کامل در داخل تلگرام:

| دستور / دکمه          | عملکرد                                                 |
| --------------------- | -------------------------------------------------------- |
| `/start`              | ثبت‌نام و منوی اصلی                                      |
| `/start ref_CODE`     | ثبت‌نام با لینک زیرمجموعه‌گیری                           |
| `/start promo_CODE`   | فعال‌سازی لینک پرومو                                     |
| **منوی اصلی**         | وضعیت اشتراک، موجودی، روزهای باقی‌مانده، ترافیک مصرفی |
| **تعرفه‌ها (Tariffs)** | مشاهده و خرید سرویس                                     |
| **شارژ (Top-up)**     | شارژ کیف پول حساب                                       |
| **پروفایل (Profile)** | انتخاب زبان و ارز                                       |
| **زیرمجموعه‌ها**       | آمار و دریافت لینک دعوت                                |
| **تریال (Trial)**     | فعال‌سازی اشتراک تست رایگان                             |
| **VPN**               | صفحه اشتراک‌ها (در قالب مینی اپلیکیشن)                 |
| **کد تخفیف**          | وارد کردن کد تخفیف برای دریافت روز رایگان            |
| **پشتیبانی**          | لینک ارتباط با پشتیبانی، قوانین و دستورالعمل‌ها       |

---

## 🌐 پنل وب

### 🛠️ پنل مدیریت (`/admin`)

| بخش              | توضیحات                                                            |
| ---------------- | ------------------------------------------------------------------- |
| **داشبورد**      | آمار کلی، وضعیت نودها، دسترسی سریع                               |
| **مشتریان**      | لیست کاربران، جستجو، مسدودسازی/آزادسازی، ریست پسورد             |
| **تعرفه‌ها**      | مدیریت دسته‌بندی‌ها و پلان‌ها (CRUD)                                  |
| **کدهای تخفیف**  | ساخت و مدیریت پروموکدها                                           |
| **آمار و تحلیل** | گراف درآمد، کاربران، ریفرال و نرخ تبدیل                          |
| **تنظیمات**      | برندینگ (نام، لوگو)، SMTP، تنظیمات درگاه‌های پرداخت، اطلاعات ربات |

### 👤 پنل کاربری (`/cabinet`)

| بخش             | توضیحات                                                |
| --------------- | ------------------------------------------------------- |
| **ورود/ثبت‌نام** | ورود با ایمیل/پسورد یا ویجت تلگرام                   |
| **داشبورد**     | وضعیت سرویس‌ها، تاریخچه مالی                           |
| **خرید**        | مشاهده و سفارش سرویس جدید                              |
| **اشتراک VPN**  | دریافت لینک‌های اتصال برای تمامی دستگاه‌ها (Deep links) |

---

## 🔌 API

### 👥 اندپوینت‌های کاربری (`/api/client`)

```
POST   /auth/register          — ثبت نام
POST   /auth/login             — ورود
POST   /auth/telegram-miniapp  — ورود از طریق مینی اپ تلگرام
GET    /auth/me                — اطلاعات کاربر فعلی
GET    /subscription           — وضعیت اشتراک
GET    /tariffs                — تعرفه‌های موجود
POST   /payments/platega       — ایجاد فاکتور Platega
POST   /trial                  — فعال‌سازی تست رایگان
```

### 🛡️ اندپوینت‌های مدیریت (`/api/admin`)

```
GET    /dashboard/stats        — آمار داشبورد
GET    /clients                — لیست کاربران (جستجو و صفحه‌بندی)
CRUD   /tariffs                — مدیریت تعرفه‌ها
POST   /sync/to-remna          — همگام‌سازی با سرور Remnawave
```

### 📡 وب‌هوک‌ها

```
POST   /webhooks/remna         — دریافت رویدادها از Remnawave
POST   /webhooks/platega       — تأیید پرداخت از Platega
```

---

## 🐳 Docker

```bash
docker compose ps
```

| کانتینر               | پورت         | توضیحات                 |
| --------------------- | ------------ | ------------------------- |
| `stealthnet-postgres` | 5432 (داخلی) | دیتابیس PostgreSQL 16    |
| `stealthnet-api`      | 5000         | بک‌اند (Backend API)       |
| `stealthnet-bot`      | —            | ربات تلگرام               |
| `stealthnet-nginx`    | 80, 443      | وب‌سرور Nginx همراه با SSL |
| `stealthnet-certbot`  | —            | تمدید خودکار گواهی SSL    |

---

## 🧰 مهاجرت

```bash
# بروزرسانی به آخرین نسخه (برنچ main)
git pull origin main

# آپدیت به یک نسخه پایدار خاص:
git fetch --tags
git checkout v3.1.3

# وضعیت سرویس‌ها
docker compose ps

# مشاهده لاگ‌ها به صورت زنده
docker compose logs -f api

# ری‌استارت API و ربات
docker compose restart api bot

# خاموش کردن کامل
docker compose down

# روشن کردن (با Nginx داخلی و SSL)
docker compose --profile builtin-nginx up -d
```

### 🔄 راهنمای آپدیت (git pull)

فایل کانفیگ **`nginx/nginx.conf`** در `.gitignore` قرار دارد. اگر با `git pull` با تداخل مواجه شدید، یکبار دستور زیر را بزنید:
`git rm --cached nginx/nginx.conf && git commit -m "Stop tracking nginx.conf"`

---

## ⚙️ پیکربندی

### 🔑 متغیرهای محیطی (Environment Variables)

تمامی متغیرها در فایل `.env.example` وجود دارند:

| متغیر                 | الزامی | توضیحات                                |
| --------------------- | :----: | ---------------------------------------- |
| `DOMAIN`              |  بله   | دامنه پنل (مثلا `vpn.example.com`)       |
| `POSTGRES_DB`         |  بله   | نام دیتابیس                             |
| `POSTGRES_USER`       |  بله   | یوزرنیم PostgreSQL                      |
| `POSTGRES_PASSWORD`   |  بله   | پسورد PostgreSQL                        |
| `JWT_SECRET`          |  بله   | کلید رمزنگاری توکن (حداقل ۳۲ کاراکتر) |
| `INIT_ADMIN_EMAIL`    |  بله   | ایمیل ادمین اصلی                        |
| `INIT_ADMIN_PASSWORD` |  بله   | پسورد ادمین اصلی                        |
| `REMNA_API_URL`       |  بله   | آدرس پنل Remnawave                      |
| `REMNA_ADMIN_TOKEN`   |  بله   | توکن دسترسی Remnawave                   |
| `BOT_TOKEN`           |  خیر   | توکن ربات تلگرام                        |

---

## 🗂️ ساختار پروژه

```
remnawave-STEALTHNET-Bot/
├── backend/                  # Backend API
│   ├── src/
│   │   ├── index.ts          # نقطه شروع (Entry point)
│   │   ├── modules/
│   │   │   ├── auth/         # احراز هویت JWT
│   │   │   ├── admin/        # کنترلرهای مدیریت
│   │   │   └── client/       # کنترلرهای مشتریان
│   └── prisma/
│       └── schema.prisma     # ساختار جداول دیتابیس
├── bot/                      # ربات تلگرام
│   ├── src/
│   │   ├── index.ts          # منطق ربات
│   │   ├── api.ts            # کلاینت ارتباطی با بک‌اند
│   │   └── keyboard.ts       # کیبوردها و دکمه‌ها
├── frontend/                 # پروژه React
├── nginx/                    # فایل‌های کانفیگ Nginx
├── docker-compose.yml        # مدیریت تمام کانتینرها
├── install.sh                # اسکریپت نصب سریع
└── README.md                 # این فایل
```

---

## 🔁 مهاجرت

آیا قصد انتقال از پنل دیگری را دارید؟ شما می‌توانید از دو سورس مختلف دیتای خود را به این پنل منتقل کنید:

| سورس                  | اسکریپت                             | مستندات                                                                      |
| --------------------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| **پنل قدیمی (Flask)** | `scripts/migrate-from-old-panel.js` | [گزینه 1: مهاجرت از پنل قدیمی (Flask)](MIGRATION.md#%DA%AF%D8%B2%DB%8C%D9%86%D9%87-1-%D9%85%D9%87%D8%A7%D8%AC%D8%B1%D8%AA-%D8%A7%D8%B2-%D9%BE%D9%86%D9%84-%D9%82%D8%AF%DB%8C%D9%85%DB%8C-flask) |
| **ربات Bedolaga**     | `scripts/migrate-from-bedolaga.js`  | [گزینه 2: مهاجرت از ربات Bedolaga](MIGRATION.md#%DA%AF%D8%B2%DB%8C%D9%86%D9%87-2-%D9%85%D9%87%D8%A7%D8%AC%D8%B1%D8%AA-%D8%A7%D8%B2-%D8%B1%D8%A8%D8%A7%D8%AA-bedolaga)        |

### 🧬 شروع سریع مهاجرت

```bash
# 1. نصب وابستگی‌های اسکریپت (فقط یکبار)
cd scripts && npm install && cd ..

# 2a. انتقال از پنل Flask قدیمی
OLD_DB_HOST=localhost OLD_DB_NAME=stealthnet_old \
NEW_DB_HOST=localhost NEW_DB_NAME=stealthnet \
node scripts/migrate-from-old-panel.js

# 2b. انتقال از ربات بدولاگا (آدرس فایل بکاپ)
node scripts/migrate-from-bedolaga.js ./backup_20260126_000000.tar.gz
```

---

## 💬 پشتیبانی و جامعه

سوالات، پیشنهادات و گزارش باگ‌ها همگی در اینجا:

<p align="center">
  <a href="https://t.me/stealthnet_admin_panel"><img src="https://img.shields.io/badge/Telegram-@stealthnet__admin__panel-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="کانال تلگرام" /></a>
</p>

---

## 📜 مجوز (License)

این پروژه تحت لایسنس **GNU AGPL-3.0** منتشر شده است.

<p align="center">
  <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg" alt="License-AGPL" /></a>
</p>

متن کامل مجوز در فایل [LICENSE](../../LICENSE) قرار دارد. استفاده از این کد ملزم به رعایت قوانین AGPL-3.0 می‌باشد.

---

<p align="center">
  <b>STEALTHNET 3.0</b> — پلتفرم فروش VPN به سبکی زیبا.<br/>
  <sub>ساخته شده با TypeScript, React, Grammy, Prisma, Docker</sub><br/><br/>
</p>