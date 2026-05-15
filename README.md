


<div align="center">
  <img src="https://cdn.jsdelivr.net/gh/hampusborgos/country-flags@main/svg/us.svg" alt="EN" width="20" /> EN
  <a title="Russian" style="text-decoration: none;" href="docs/ru/README.md">
    <img src="https://cdn.jsdelivr.net/gh/hampusborgos/country-flags@main/svg/ru.svg" alt="RU" width="20" /> RU
  </a>
  <a title="Chinese" style="text-decoration: none;" href="docs/cn/README.md">
    <img src="https://cdn.jsdelivr.net/gh/hampusborgos/country-flags@main/svg/cn.svg" alt="CN" width="20" /> CN
  </a>
  <a title="Persian" style="text-decoration: none;" href="docs/fa/README.md">
    <img src="https://cdn.jsdelivr.net/gh/hampusborgos/country-flags@main/svg/ir.svg" alt="FA" width="20" /> IR
  </a>
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
  <b>Full-featured platform for selling VPN subscriptions</b><br/>
  Telegram bot &bull; Mini App &bull; Client dashboard &bull; Admin panel<br/>
  <i>Everything in one box. One script — and it works.</i>
</p>

<p align="center">
  <a href="https://t.me/stealthnet_admin_panel"><img src="https://img.shields.io/badge/Telegram-channel-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram" /></a>
</p>

<p align="center">
<img width="1500" height="636" alt="AdminMiniApp 3" src="https://github.com/user-attachments/assets/81b8d321-3d0a-4d59-bec1-8f804ef5a5ba" />


</p>






<p align="center">
  <a href="#-quick-start">Quick start</a> &bull;
  <a href="#%EF%B8%8F-server-requirements">Requirements</a> &bull;
  <a href="#-architecture">Architecture</a> &bull;
  <a href="#-features">Features</a> &bull;
  <a href="#-telegram-bot">Telegram bot</a> &bull;
  <a href="#-web-panel">Web panel</a> &bull;
  <a href="#-api">API</a> &bull;
  <a href="#-docker-services">Docker Services</a> &bull;
  <a href="#%EF%B8%8F-configuration">Configuration</a> &bull;
  <a href="#-migration">Migration</a>
</p>

---

## 🚀 Quick Start

> [!CAUTION]
> To avoid any conflicts, it is strongly recommended to install this stack on a **separate server**!

```bash
apt install git -y
curl -fsSL https://get.docker.com | sh
cd /opt
git clone https://github.com/systemmaster1200-eng/remnawave-STEALTHNET-Bot.git
cd remnawave-STEALTHNET-Bot
bash install.sh
```

> [!WARNING]
> If after launch your **API service crashes**, the bot replies "**❌ fetch failed**", and in the logs (`docker compose logs -f api`) you see the error "**Error: P1000: Authentication failed**", and if you don't have any other important projects running on this server, you can and should delete them to free up space with the following command:
> 
> docker system prune -a --volumes

The interactive installer will configure everything in 2 minutes:

- Domain and SSL certificates (Let's Encrypt)
- PostgreSQL, JWT secrets, administrator credentials
- Remnawave API connection
- Telegram bot
- Nginx (built-in with auto-SSL or your own reverse proxy)

---

## 🖥️ Server Requirements

Estimated configurations for running all services (API, frontend, bot, Nginx, PostgreSQL) in Docker:

| Level           | CPU    | RAM      | Disk      | Purpose                                                    |
| --------------- | ------ | -------- | --------- | ---------------------------------------------------------- |
| **Minimum**     | 1 vCPU | 1.5–2 GB | 20 GB     | Testing, demo, up to ~50 active users                      |
| **Medium**      | 2 vCPU | 4 GB     | 40 GB SSD | Small production, up to ~500 users, stable operation       |
| **Recommended** | 4 vCPU | 8 GB     | 80 GB SSD | Production with reserve, thousands of users, fast response |

**General:**

- OS: Linux (Debian 13, Ubuntu 24.04 LTS or equivalent), Docker and Docker Compose v2+.
- Open ports: **80** (HTTP), **443** (HTTPS); when installed via `install.sh` — only these are needed.
- For medium and recommended levels, an SSD and separate DB backups are desirable.

---

## 🧱 Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      STEALTHNET 3.0                      │
├──────────────┬──────────────┬──────────────┬─────────────┤
│  Telegram    │  Mini App    │  Client      │  Admin      │
│  Bot         │  (WebApp)    │  dashboard   │  panel      │
│  Grammy      │  React       │  React       │  React      │
├──────────────┴──────────────┴──────────────┴─────────────┤
│                   Backend API (Express)                  │
│            JWT Auth  ·  Prisma ORM  ·  Webhooks          │
├──────────────────────────────────────────────────────────┤
│          PostgreSQL          │       Remnawave API       │
│          (Data)              │       (VPN core)          │
├──────────────────────────────┴───────────────────────────┤
│         Nginx + Let's Encrypt  ·  Docker Compose         │
└──────────────────────────────────────────────────────────┘
```

| Service      | Technologies                                           | Purpose                                                                 |
| ------------ | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| **backend**  | Node.js, Express, Prisma, PostgreSQL                   | REST API: auth, clients, tariffs, payments, referrals, promo, analytics |
| **frontend** | React 18, Vite, Tailwind CSS, shadcn/ui, Framer Motion | Admin panel + client dashboard + Telegram Mini App                      |
| **bot**      | Grammy (TypeScript)                                    | Full Telegram bot with client dashboard                                 |
| **nginx**    | Nginx + Certbot                                        | Reverse proxy, SSL, static, gzip                                        |
| **postgres** | PostgreSQL 16                                          | Data storage                                                            |

---

## ✨ Features

### 💳 Payments and Subscriptions

- **Platega.io** — payment acceptance (cards, SBP, crypto, etc.); callback URL is copied in the admin panel
- **YooMoney** — balance top-up and tariff payment via card (transfer form, HTTP notifications); webhook URL with a "Copy" button in settings
- **YooKassa** — card and SBP payments via API (RUB only); 54-FZ receipts; webhook on `payment.succeeded`; webhook URL is copied in the admin panel
- **Balance payment** — internal balance top-up and deduction
- **Auto-activation** — after payment, the tariff is activated instantly via webhook (Platega, YooMoney, YooKassa)
- **Payment description** — for all payment systems (Platega, YooMoney, YooKassa), the **service name** from admin settings is added to the description (General → Service Name)
- **Flexible tariffs** — categories, durations, traffic and device limits, binding to Remnawave squads
- **Multi-currency** — support for multiple currencies (USD, RUB, etc.)

### 🤝 Referral Program

- **3-level referrals** — earn from invited users and their referrals
- **Customizable percentages** — separately for each level
- **Automatic accrual** — bonuses are credited to the balance with every referral payment
- **Referral links** — for the bot and the website

### 🎟️ Promo System

- **Promo groups** — free subscription via link (`/start promo_CODE`), with activation limits
- **Promo codes** — discounts (% or fixed amount) and free days
- **Usage limits** — total limit and limit per client, expiration date
- **Activation statistics** — how many times it was used, by whom, when

### 🧪 Trial Period

- **Free trial** — customizable duration, traffic and device limits
- **One-time activation** — one trial per client
- **Squad binding** — separate squad for trial users

### 🔗 Remnawave Integration

- **User management** — creation, deletion, blocking in Remnawave
- **Subscriptions** — activation, extension, status check
- **Nodes** — monitoring, enable/disable, restart
- **Squads** — distribution of users across servers
- **Synchronization** — two-way data sync (Remnawave <-> STEALTHNET)
- **Webhooks** — automatic handling of Remnawave events

### 📱 Mobile Version and Mini App

- **Collapsible tariff categories** — with multiple categories on narrow screens and in the Mini App, categories are shown as an accordion: the first is open by default, others open on click
- **Compact tariff cards** — in mobile view, tariffs are in one column, long thin rows (name and parameters on the left, price and "Pay" on the right)
- **Unified mobile interface** — bottom navigation, compact header, same style in mobile browser and Telegram WebApp

### 📊 Analytics and Reports

- **Dashboard** — key metrics in real-time
- **Revenue charts** — daily for 90 days
- **Client base growth** — registration dynamics
- **Top tariffs** — best-selling plans
- **Referral stats** — earnings by level
- **Conversion** — trial -> paid subscription
- **Sales report** — filtering by date and payment provider

### 🔐 Security

- **JWT authentication** — access + refresh tokens
- **Forced password change** — on the first admin login
- **Email verification** — confirmation via link in email
- **Client blocking** — with reason specification
- **SSL/TLS** — automatic Let's Encrypt certificates

---

## 🤖 Telegram Bot

A full client dashboard right in Telegram:

| Command / Button | Action |
|-------------------|------------|
| `/start` | Registration and main menu |
| `/start ref_CODE` | Registration via referral link |
| `/start promo_CODE` | Promo group activation |
| **Main Menu** | Subscription status, balance, days left, traffic, device limit |
| **Tariffs** | View categories and tariffs, purchase |
| **Top-up** | Balance top-up (presets and custom amount) |
| **Profile** | Language and currency selection |
| **Referrals** | Statistics and referral link |
| **Trial** | Free trial activation |
| **VPN** | Subscription page (Mini App) |
| **Promo code** | Enter promo code for discount or free days |
| **Support** | Links to support, agreement, offer, instructions |

**Bot Features:**
- Custom emojis (Premium Emoji)
- Colored buttons (primary / success / danger)
- Traffic usage progress bar
- Telegram Mini App (WebApp) integration
- Customizable texts and logo

---

## 🌐 Web Panel

### 🛠️ Admin Panel (`/admin`)

| Section          | Description                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**    | Statistics, node status, quick actions                                                                                                      |
| **Clients**      | Client list, search, filters, block/unblock, password reset                                                                                 |
| **Tariffs**      | Category and tariff management (CRUD)                                                                                                       |
| **Promo groups** | Promo links creation and management                                                                                                         |
| **Promo codes**  | Discount and free days promo codes creation                                                                                                 |
| **Analytics**    | Revenue, clients, referrals, conversion charts                                                                                              |
| **Sales Report** | Detailed sales with filters                                                                                                                 |
| **Settings**     | Branding (service name, logo), SMTP, **Platega / YooMoney / YooKassa** (webhook URLs with a "Copy" button), bot, Remnawave, referral system |

### 👤 Client Dashboard (`/cabinet`)

| Section           | Description                                          |
| ----------------- | ---------------------------------------------------- |
| **Authorization** | Email + password or Telegram widget                  |
| **Registration**  | With email confirmation                              |
| **Dashboard**     | Subscription status, balance, payment history, trial |
| **Tariffs**       | View and purchase tariffs                            |
| **Subscription**  | VPN page: apps by platform, deep links               |
| **Referrals**     | Statistics and invitation link                       |
| **Profile**       | Language, currency, password change                  |

**Frontend Technologies:**
- React 18 + TypeScript + Vite
- Tailwind CSS + shadcn/ui
- Framer Motion (animations)
- Recharts (charts)
- Dark / light theme
- Responsive design (mobile + desktop)
- PWA (Service Worker)
- Telegram Mini App

---

## 🔌 API

### 👥 Client Endpoints (`/api/client`)

```
POST   /auth/register                — Registration (email + password)
POST   /auth/login                   — Login
POST   /auth/telegram-miniapp        — Telegram Mini App login
GET    /auth/me                      — Current user

GET    /subscription                 — Subscription status
GET    /tariffs                      — Available tariffs

POST   /payments/platega             — Create payment (Platega)
POST   /payments/balance             — Balance payment
POST   /yookassa/create-payment      — Create YooKassa payment (card/SBP, RUB), redirect to payment page
GET    /yoomoney/auth-url            — YooMoney authorization URL (OAuth)
POST   /yoomoney/request-topup       — Request YooMoney wallet top-up
POST   /yoomoney/create-form-payment — YooMoney form (card payment), returns paymentUrl

POST   /trial                        — Activate trial
POST   /promo/activate               — Activate promo group
POST   /promo-code/check             — Check promo code
POST   /promo-code/activate          — Apply promo code

GET    /referral-stats               — Referral statistics
```

### 🛡️ Admin Endpoints (`/api/admin`)

```
GET    /dashboard/stats              — Dashboard stats
GET    /clients                      — Client list (pagination, search)
GET    /clients/:id                  — Client details
PATCH  /clients/:id                  — Update client

CRUD   /tariff-categories            — Tariff categories
CRUD   /tariffs                      — Tariffs
CRUD   /promo-groups                 — Promo groups
CRUD   /promo-codes                  — Promo codes

GET    /analytics                    — Analytics
GET    /sales-report                 — Sales report
GET/PATCH /settings                  — System settings

GET    /remna/*                      — Proxy requests to Remnawave
POST   /sync/from-remna              — Sync from Remnawave
POST   /sync/to-remna                — Sync to Remnawave
```

### 🌍 Public Endpoints (`/api/public`)

```
GET    /config                       — Public configuration
GET    /tariffs                      — Tariff list
GET    /subscription-page            — Subscription page config
GET    /deeplink                     — Deep link for VPN apps
```

### 📡 Webhooks

```
POST   /webhooks/remna               — Remnawave events
POST   /webhooks/platega             — Platega callback (auto-activation)
POST   /webhooks/yoomoney            — YooMoney HTTP notifications (top-up, tariff payment)
POST   /webhooks/yookassa            — YooKassa events (payment.succeeded → top-up/tariff activation)
```

---

## 🐳 Docker Services

```bash
docker compose ps
```

| Container             | Port        | Description                  |
| --------------------- | ----------- | ---------------------------- |
| `stealthnet-postgres` | 5432 (int.) | PostgreSQL 16 — database     |
| `stealthnet-api`      | 5000        | Backend API                  |
| `stealthnet-bot`      | —           | Telegram bot                 |
| `stealthnet-nginx`    | 80, 443     | Nginx + SSL (built-in mode)  |
| `stealthnet-certbot`  | —           | SSL certificate auto-renewal |

---

## 🧰 Useful Commands

```bash
# Update to the latest commit (latest main branch, not always stable)
git pull origin main

# Update to a specific version (more stable, release version):
git fetch --tags
git checkout v3.1.3

# Services status
docker compose ps

# Real-time logs
docker compose logs -f api
docker compose logs -f bot
docker compose logs -f nginx

# Restart API and bot
docker compose restart api bot

# Full shutdown
docker compose down

# Start (without built-in nginx)
docker compose up -d

# Start (with built-in nginx + SSL)
docker compose --profile builtin-nginx up -d

# Shutdown (with built-in nginx + SSL)
docker compose --profile builtin-nginx down

# Rebuild after code update
docker compose build api bot
docker compose up frontend        # rebuild frontend
docker compose restart api bot

# Rebuild after code update (with external nginx)
chmod +x ./scripts/update-front-with-external-nginx.sh
./scripts/update-front-with-external-nginx.sh

# For cleaning old images (if disk space too small)
docker compose down
docker system prune -a
docker compose up -d --build && docker compose logs -f -t
```

### 🔄 Updating from Git (git pull)

- **`nginx/nginx.conf`** — is in `.gitignore` (file generated by install.sh for the domain). If Git still updates it on pull, run once:  
  `git rm --cached nginx/nginx.conf && git commit -m "Stop tracking nginx.conf"`
- **Source code** (`backend/...`, `nginx/nginx.conf.template`, etc.) should not be added to ignore. Before `git pull`, either commit changes or stash them:  
  `git stash && git pull && git stash pop`

---


## ⚙️ Configuration

### 🔑 Environment Variables

All variables are described in `.env.example`:

| Variable                 | Required | Description                            |
| ------------------------ | :------: | -------------------------------------- |
| `DOMAIN`                 |   yes    | Panel domain (e.g., `vpn.example.com`) |
| `POSTGRES_DB`            |   yes    | Database name                          |
| `POSTGRES_USER`          |   yes    | PostgreSQL user                        |
| `POSTGRES_PASSWORD`      |   yes    | PostgreSQL password                    |
| `JWT_SECRET`             |   yes    | JWT token secret (min. 32 chars)       |
| `JWT_ACCESS_EXPIRES_IN`  |    no    | Access token lifetime (default `15m`)  |
| `JWT_REFRESH_EXPIRES_IN` |    no    | Refresh token lifetime (default `7d`)  |
| `INIT_ADMIN_EMAIL`       |   yes    | First admin email                      |
| `INIT_ADMIN_PASSWORD`    |   yes    | First admin password                   |
| `REMNA_API_URL`          |   yes    | Remnawave panel URL                    |
| `REMNA_ADMIN_TOKEN`      |   yes    | Remnawave API token                    |
| `BOT_TOKEN`              |    no    | Telegram bot token                     |
| `USE_BUILTIN_NGINX`      |    no    | `true` for built-in nginx              |
| `CERTBOT_EMAIL`          |    no    | Email for Let's Encrypt                |

### 🌐 Custom Nginx (instead of built-in)

If external nginx was chosen during installation:

1. Config example: `nginx/external.conf.example`
2. API proxied to `http://127.0.0.1:5000`
3. Frontend static files: `/var/www/stealthnet/` or `frontend/dist/`

```bash
# Get SSL
sudo certbot --nginx -d your-domain.com

# Link config
sudo cp nginx/external.conf.example /etc/nginx/sites-available/stealthnet.conf
sudo ln -s /etc/nginx/sites-available/stealthnet.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 🗂️ Project Structure

```
remnawave-STEALTHNET-Bot/
├── backend/                  # Backend API
│   ├── src/
│   │   ├── index.ts          # Entry point
│   │   ├── modules/
│   │   │   ├── auth/         # JWT authentication
│   │   │   ├── admin/        # Admin routes and controllers
│   │   │   └── client/       # Client routes and controllers
│   │   └── ...
│   └── prisma/
│       └── schema.prisma     # Database schema
├── bot/                      # Telegram bot
│   ├── src/
│   │   ├── index.ts          # Bot logic
│   │   ├── api.ts            # Client for Backend API
│   │   └── keyboard.ts       # Keyboards and buttons
│   └── ...
├── frontend/                 # React SPA
│   ├── src/
│   │   ├── pages/            # Pages (admin + cabinet)
│   │   ├── components/       # Reusable components
│   │   └── ...
│   └── ...
├── nginx/                    # Nginx configs
│   ├── nginx.conf.template   # Template for built-in nginx
│   ├── nginx-initial.conf    # Initial config for certbot
│   └── external.conf.example # Example for external nginx
├── scripts/                  # Helper scripts
├── docker-compose.yml        # Orchestration of all services
├── install.sh                # Interactive installer
├── .env.example              # Env variables template
└── README.md                 # This file
```

---

## 🔁 Migration

Migrating from another panel? Migration is supported from two sources:

| Source                           | Script                              | Documentation                                                                        |
| -------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| **Old STEALTHNET panel (Flask)** | `scripts/migrate-from-old-panel.js` | [Detailed instructions](docs/MIGRATION.md#option-1-migration-from-the-old-panel-flask) |
| **Bedolaga Bot**                 | `scripts/migrate-from-bedolaga.js`  | [Detailed instructions](docs/MIGRATION.md#option-2-migration-from-bedolaga-bot)        |

### 🧬 Quick Migration Start

```bash
# 1. Install script dependencies (once)
cd scripts && npm install && cd ..

# 2a. Migration from old Flask panel
OLD_DB_HOST=localhost OLD_DB_NAME=stealthnet_old \
NEW_DB_HOST=localhost NEW_DB_NAME=stealthnet \
node scripts/migrate-from-old-panel.js

# 2b. Migration from Bedolaga (path to backup)
node scripts/migrate-from-bedolaga.js ./backup_20260126_000000.tar.gz
```

> The currency is determined automatically from system settings (`default_currency`).  
> Scripts are idempotent — they can be run repeatedly without the risk of duplicates.  
> Full documentation, variables, FAQ — in **[MIGRATION.md](docs/MIGRATION.md)**.

---

## 💬 Support and Community

Questions, suggestions, bug reports — all here:

<p align="center">
  <a href="https://t.me/stealthnet_admin_panel"><img src="https://img.shields.io/badge/Telegram-@stealthnet__admin__panel-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram Channel" /></a>
</p>

---

## 📜 License

This project is licensed under the **GNU AGPL-3.0** License.

<p align="center">
  <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg" alt="License-AGPL" /></a>
</p>

The full text of the license is in the [LICENSE](LICENSE) file. When using, modifying, and distributing the code, you must comply with the conditions of AGPL-3.0 (including source code disclosure of derivative works when used as a network service).

---

<p align="center">
  <b>STEALTHNET 3.0</b> — sell VPN beautifully.<br/>
  <sub>Built with TypeScript, React, Grammy, Prisma, Docker</sub><br/><br/>
</p>
