<div align="center">
  <a title="English" style="text-decoration: none;" href="../../README.md">
    <img src="https://cdn.jsdelivr.net/gh/hampusborgos/country-flags@main/svg/us.svg" alt="EN" width="20" /> EN</a>
  </a>
  <a title="Russian" style="text-decoration: none;" href="../ru/README.md">
    <img src="https://cdn.jsdelivr.net/gh/hampusborgos/country-flags@main/svg/ru.svg" alt="RU" width="20" /> RU
  </a>
  <img src="https://cdn.jsdelivr.net/gh/hampusborgos/country-flags@main/svg/ru.svg" alt="CN" width="20" /> CN
  <a title="Persian" style="text-decoration: none;" href="../fa/README.md">
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
  <b>用于销售 VPN 订阅的完整平台</b><br/>
  Telegram 机器人 &bull; 微信小程序 (Mini App) &bull; 客户面板 &bull; 管理员面板<br/>
  <i>全部集成在一个盒子中。只需一个脚本即可运行。</i>
</p>

<p align="center">
  <a href="https://t.me/stealthnet_admin_panel"><img src="https://img.shields.io/badge/Telegram-频道-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram" /></a>
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/ecd37b8e-68ef-4616-92da-550f8bd9cdb5" width="830" alt="STEALTHNET 截图 1" />
</p>
<p align="center">
  <img src="https://github.com/user-attachments/assets/5c504c46-0b00-47d1-b767-7afed7f36983" width="830" alt="STEALTHNET 截图 2" />
</p>

<p align="center">
  <a href="#-快速开始">快速开始</a> &bull;
  <a href="#%EF%B8%8F-服务器要求">服务器要求</a> &bull;
  <a href="#-架构">架构</a> &bull;
  <a href="#-功能特性">功能特性</a> &bull;
  <a href="#-telegram-机器人">Telegram 机器人</a> &bull;
  <a href="#-web-面板">Web 面板</a> &bull;
  <a href="#-api">API</a> &bull;
  <a href="#-docker">Docker</a> &bull;
  <a href="#%EF%B8%8F-配置">配置</a> &bull;
  <a href="#-迁移">迁移</a>
</p>

---

## 🚀 快速开始

> [!CAUTION]
> 为了避免任何冲突，强烈建议将此技术栈安装在**独立的服务器**上！

```bash
apt install git -y
curl -fsSL https://get.docker.com | sh
cd /opt
git clone https://github.com/systemmaster1200-eng/remnawave-STEALTHNET-Bot.git
cd remnawave-STEALTHNET-Bot
bash install.sh
```

> [!WARNING]
> 如果在启动后您的**API 服务崩溃**，机器人回复“**❌ fetch failed**”，并且在日志（`docker compose logs -f api`）中看到错误“**Error: P1000: Authentication failed**”，如果您在此服务器上没有运行其他重要项目，您可以使用以下命令删除它们以释放空间：
> 
> docker system prune -a --volumes

交互式安装程序将在2分钟内配置好一切：

- 域名和 SSL 证书（Let's Encrypt）
- PostgreSQL、JWT 密钥、管理员凭证
- Remnawave API 连接
- Telegram 机器人
- Nginx（带有自动 SSL 的内置模式或您自己的反向代理）

---

## 🖥️ 服务器要求

在 Docker 中运行所有服务（API、前端、机器人、Nginx、PostgreSQL）的推荐配置：

| 级别         | CPU    | RAM      | 磁盘      | 适用场景                               |
| ------------ | ------ | -------- | --------- | ------------------------------------- |
| **最低配置** | 1 vCPU | 1.5–2 GB | 20 GB     | 测试、演示、最多 ~50 名活跃用户          |
| **中等配置** | 2 vCPU | 4 GB     | 40 GB SSD | 小型生产环境、最多 ~500 名用户、稳定运行 |
| **推荐配置** | 4 vCPU | 8 GB     | 80 GB SSD | 生产环境、数千名用户、快速响应           |

**一般要求：**

- 操作系统：Linux（Debian 13, Ubuntu 24.04 LTS 或类似系统），Docker 和 Docker Compose v2+。
- 开放端口：**80**（HTTP），**443**（HTTPS）；通过 `install.sh` 安装时——只需这两个端口。
- 对于中等和推荐级别，建议使用 SSD 和单独的数据库备份。

---

## 🧱 架构

```
┌──────────────────────────────────────────────────────────┐
│                      STEALTHNET 3.0                      │
├──────────────┬──────────────┬──────────────┬─────────────┤
│  Telegram    │  Mini App    │  客户        │  管理        │
│  Bot         │  (WebApp)    │  面板        │  面板        │
│  Grammy      │  React       │  React       │  React      │
├──────────────┴──────────────┴──────────────┴─────────────┤
│                   Backend API (Express)                  │
│            JWT Auth  ·  Prisma ORM  ·  Webhooks          │
├──────────────────────────────────────────────────────────┤
│          PostgreSQL          │       Remnawave API       │
│          (数据)              │       (VPN 核心)           │
├──────────────────────────────┴───────────────────────────┤
│         Nginx + Let's Encrypt  ·  Docker Compose         │
└──────────────────────────────────────────────────────────┘
```

| 服务         | 技术                                                   | 用途                                            |
| ------------ | ------------------------------------------------------ | ---------------------------------------------- |
| **backend**  | Node.js, Express, Prisma, PostgreSQL                   | REST API：授权、客户、套餐、支付、推荐、促销、分析 |
| **frontend** | React 18, Vite, Tailwind CSS, shadcn/ui, Framer Motion | 管理面板 + 客户面板 + Telegram Mini App          |
| **bot**      | Grammy (TypeScript)                                    | 带有客户面板的完整 Telegram 机器人               |
| **nginx**    | Nginx + Certbot                                        | 反向代理、SSL、静态文件、gzip                    |
| **postgres** | PostgreSQL 16                                          | 数据存储                                        |

---

## ✨ 功能特性

### 💳 支付与订阅

- **Platega.io** — 接收付款（信用卡、SBP、加密货币等）；回调 URL 在后台复制
- **YooMoney** — 余额充值和通过信用卡支付套餐（转账表单，HTTP 通知）；在设置中带有“复制”按钮的 Webhook URL
- **YooKassa** — 通过 API 接收信用卡和 SBP 支付（仅限 RUB）；符合 54-FZ 标准的发票；`payment.succeeded` webhook；回调 URL 在后台复制
- **余额支付** — 内部余额的充值和扣款
- **自动激活** — 支付后，套餐通过 webhook 立即激活（Platega, YooMoney, YooKassa）
- **支付描述** — 在所有支付网关（Platega, YooMoney, YooKassa）中，支付描述会自动填充后台设置中的**服务名称**（常规 → 服务名称）
- **灵活的套餐** — 分类、时长、流量和设备限制、绑定到 Remnawave 小队 (Squads)
- **多币种** — 支持多种货币（USD, RUB 等）

### 🤝 推荐计划 (Referral Program)

- **3 级推荐系统** — 从邀请的用户及其推荐人处赚取收益
- **自定义百分比** — 为每个级别分别设置
- **自动返佣** — 推荐人每次付款，奖金自动记入余额
- **推荐链接** — 适用于机器人和网站

### 🎟️ 促销系统

- **促销组** — 通过链接免费订阅（`/start promo_CODE`），带有激活次数限制
- **优惠券代码** — 折扣（百分比或固定金额）及免费天数
- **使用限制** — 总限制和每位客户的限制，有效期
- **激活统计** — 使用了多少次，被谁使用，什么时候使用

### 🧪 试用期 (Trial)

- **免费试用** — 可自定义时长、流量和设备限制
- **一次性激活** — 每位客户一次试用机会
- **绑定小队 (Squads)** — 为试用用户分配单独的小队

### 🔗 Remnawave 集成

- **用户管理** — 在 Remnawave 中创建、删除、阻止用户
- **订阅** — 激活、延长、状态检查
- **节点** — 监控、启用/禁用、重启
- **小队 (Squads)** — 将用户分配到不同的服务器
- **同步** — 双向数据同步（Remnawave <-> STEALTHNET）
- **Webhooks** — 自动处理来自 Remnawave 的事件

### 📱 移动版本和 Mini App

- **可折叠的套餐分类** — 在窄屏幕和 Mini App 中如果有多个分类，将以手风琴形式显示：默认展开第一个，点击展开其他
- **紧凑的套餐卡片** — 在移动端视图中，套餐单列显示，细长行（左侧名称和参数，右侧价格和“支付”）
- **统一的移动端界面** — 底部导航、紧凑的标题，在手机浏览器和 Telegram WebApp 中保持一致的样式

### 📊 分析与报告

- **仪表盘** — 实时关键指标
- **收入图表** — 最近 90 天的每日收入
- **客户增长** — 注册动态
- **畅销套餐** — 销量最高的计划
- **推荐统计** — 各级别的收益
- **转化率** — 试用 -> 付费订阅
- **销售报告** — 按日期和支付提供商筛选

### 🔐 安全性

- **JWT 身份验证** — Access + Refresh 令牌
- **强制修改密码** — 管理员首次登录时
- **电子邮件验证** — 通过邮件链接确认
- **封禁客户** — 可指定封禁原因
- **SSL/TLS** — 自动签发 Let's Encrypt 证书

---

## 🤖 Telegram 机器人

在 Telegram 中提供完整的客户面板：

| 命令 / 按钮             | 作用                                   |
| ----------------------- | ------------------------------------- |
| `/start`                | 注册和主菜单                           |
| `/start ref_CODE`       | 通过推荐链接注册                       |
| `/start promo_CODE`     | 激活促销组                            |
| **主菜单**              | 订阅状态、余额、剩余天数、流量、设备限制 |
| **套餐 (Tariffs)**      | 查看分类和套餐、购买                   |
| **充值 (Top-up)**       | 余额充值（预设值和自定义金额）          |
| **个人中心 (Profile)**  | 选择语言和货币                         |
| **推荐 (Referrals)**    | 统计数据和邀请链接                     |
| **试用 (Trial)**        | 激活免费试用期                         |
| **VPN**                 | 订阅页面（Mini App）                   |
| **优惠码 (Promo code)** | 输入以获得折扣或免费天数                 |
| **支持 (Support)**      | 支持链接、协议、使用说明                 |

**机器人特色：**
- 自定义表情符号 (Premium Emoji)
- 彩色按钮 (primary / success / danger)
- 流量使用进度条
- Telegram Mini App (WebApp) 集成
- 可自定义的文本和徽标

---

## 🌐 Web 面板

### 🛠️ 管理面板 (`/admin`)

| 模块         | 说明                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| **仪表盘**   | 统计、节点状态、快捷操作                                                                                                |
| **客户**     | 客户列表、搜索、过滤、封禁/解封、重置密码                                                                                |
| **套餐**     | 分类和套餐管理 (CRUD)                                                                                                  |
| **促销组**   | 促销链接的创建和管理                                                                                                    |
| **优惠码**   | 创建折扣和免费天数代码                                                                                                  |
| **分析**     | 收入、客户、推荐、转化率图表                                                                                             |
| **销售报告** | 带有过滤器的详细销售记录                                                                                                 |
| **设置**     | 品牌化（服务名称，徽标），SMTP，**Platega / YooMoney / YooKassa**（带复制按钮的 Webhook URLs），机器人，Remnawave，推荐系统 |

### 👤 客户面板 (`/cabinet`)

| 模块         | 说明                                           |
| ------------ | --------------------------------------------- |
| **授权**     | 电子邮件 + 密码或 Telegram 小部件               |
| **注册**     | 带有电子邮件确认                                |
| **仪表盘**   | 订阅状态、余额、付款历史、试用                    |
| **套餐**     | 查看和购买套餐                                  |
| **订阅**     | VPN 页面：各平台的应用程序，深度链接 (deep links) |
| **推荐**     | 统计和邀请链接                                  |
| **个人资料** | 语言、货币、修改密码                             |

**前端技术：**
- React 18 + TypeScript + Vite
- Tailwind CSS + shadcn/ui
- Framer Motion (动画)
- Recharts (图表)
- 黑暗/明亮主题
- 响应式设计（移动端 + 桌面端）
- PWA (Service Worker)
- Telegram Mini App

---

## 🔌 API

### 👥 客户接口 (`/api/client`)

```
POST   /auth/register                — 注册（电子邮件+密码）
POST   /auth/login                   — 登录
POST   /auth/telegram-miniapp        — Telegram Mini App 登录
GET    /auth/me                      — 当前用户

GET    /subscription                 — 订阅状态
GET    /tariffs                      — 可用的套餐

POST   /payments/platega             — 创建付款 (Platega)
POST   /payments/balance             — 余额支付
POST   /yookassa/create-payment      — 创建 YooKassa 支付，重定向到支付页面
GET    /yoomoney/auth-url            — YooMoney 授权 URL (OAuth)
POST   /yoomoney/request-topup       — 请求 YooMoney 钱包充值
POST   /yoomoney/create-form-payment — YooMoney 表单支付，返回 paymentUrl

POST   /trial                        — 激活试用
POST   /promo/activate               — 激活促销组
POST   /promo-code/check             — 检查优惠码
POST   /promo-code/activate          — 应用优惠码

GET    /referral-stats               — 推荐统计
```

### 🛡️ 管理员接口 (`/api/admin`)

```
GET    /dashboard/stats              — 仪表盘统计
GET    /clients                      — 客户列表（分页、搜索）
GET    /clients/:id                  — 客户详细信息
PATCH  /clients/:id                  — 更新客户

CRUD   /tariff-categories            — 套餐分类
CRUD   /tariffs                      — 套餐
CRUD   /promo-groups                 — 促销组
CRUD   /promo-codes                  — 优惠码

GET    /analytics                    — 分析
GET    /sales-report                 — 销售报告
GET/PATCH /settings                  — 系统设置

GET    /remna/*                      — 代理 Remnawave 请求
POST   /sync/from-remna              — 从 Remnawave 同步
POST   /sync/to-remna                — 同步到 Remnawave
```

### 🌍 公共接口 (`/api/public`)

```
GET    /config                       — 公共配置
GET    /tariffs                      — 套餐列表
GET    /subscription-page            — 订阅页面配置
GET    /deeplink                     — VPN 应用程序的深度链接
```

### 📡 Webhooks

```
POST   /webhooks/remna               — 来自 Remnawave 的事件
POST   /webhooks/platega             — Platega 回调（自动激活）
POST   /webhooks/yoomoney            — YooMoney HTTP 通知（充值、购买套餐）
POST   /webhooks/yookassa            — YooKassa 事件（payment.succeeded → 充值/套餐激活）
```

---

## 🐳 Docker

```bash
docker compose ps
```

| 容器                  | 端口        | 描述                    |
| --------------------- | ----------- | ---------------------- |
| `stealthnet-postgres` | 5432 (内部) | PostgreSQL 16 — 数据库  |
| `stealthnet-api`      | 5000        | Backend API            |
| `stealthnet-bot`      | —           | Telegram 机器人         |
| `stealthnet-nginx`    | 80, 443     | Nginx + SSL（内置模式） |
| `stealthnet-certbot`  | —           | SSL 证书自动续期        |

---

## 🧰 常用命令

```bash
# 更新到最新的提交（最新的 main 分支，不一定稳定）
git pull origin main

# 更新到特定版本（更稳定，发布版本）：
git fetch --tags
git checkout v3.1.3

# 服务状态
docker compose ps

# 实时日志
docker compose logs -f api
docker compose logs -f bot
docker compose logs -f nginx

# 重启 API 和机器人
docker compose restart api bot

# 完全停止
docker compose down

# 启动（不带内置 nginx）
docker compose up -d

# 启动（带内置 nginx + SSL）
docker compose --profile builtin-nginx up -d

# 停止（带内置 nginx + SSL）
docker compose --profile builtin-nginx down

# 代码更新后重新构建
docker compose build api bot
docker compose up frontend        # 重新编译前端
docker compose restart api bot
```

### 🔄 从 Git 更新 (git pull)

- **`nginx/nginx.conf`** — 在 `.gitignore` 中（由 install.sh 为域名生成）。如果 Git 仍然在 pull 时更新它，请执行一次：  
  `git rm --cached nginx/nginx.conf && git commit -m "Stop tracking nginx.conf"`
- **源代码** (`backend/...`, `nginx/nginx.conf.template` 等) 不要添加到忽略列表。在 `git pull` 之前，提交更改或隐藏它们：  
  `git stash && git pull && git stash pop`

---

## ⚙️ 配置

### 🔑 环境变量

所有变量都在 `.env.example` 中描述：

| 变量                     | 是否必填 | 描述                              |
| ------------------------ | :------: | -------------------------------- |
| `DOMAIN`                 |    是    | 面板域名（例如 `vpn.example.com`） |
| `POSTGRES_DB`            |    是    | 数据库名称                        |
| `POSTGRES_USER`          |    是    | PostgreSQL 用户                   |
| `POSTGRES_PASSWORD`      |    是    | PostgreSQL 密码                   |
| `JWT_SECRET`             |    是    | JWT 令牌密钥（最少 32 个字符）     |
| `JWT_ACCESS_EXPIRES_IN`  |    否    | 访问令牌过期时间（默认 `15m`）     |
| `JWT_REFRESH_EXPIRES_IN` |    否    | 刷新令牌过期时间（默认 `7d`）      |
| `INIT_ADMIN_EMAIL`       |    是    | 第一位管理员的电子邮件             |
| `INIT_ADMIN_PASSWORD`    |    是    | 第一位管理员的密码                 |
| `REMNA_API_URL`          |    是    | Remnawave 面板的 URL              |
| `REMNA_ADMIN_TOKEN`      |    是    | Remnawave API 令牌                |
| `BOT_TOKEN`              |    否    | Telegram 机器人令牌                |
| `USE_BUILTIN_NGINX`      |    否    | `true` 为使用内置 nginx            |
| `CERTBOT_EMAIL`          |    否    | Let's Encrypt 邮件地址             |

### 🌐 自定义 Nginx（替代内置）

如果在安装期间选择了外部 nginx：

1. 配置示例：`nginx/external.conf.example`
2. API 代理至 `http://127.0.0.1:5000`
3. 前端静态文件：`/var/www/stealthnet/` 或 `frontend/dist/`

```bash
# 获取 SSL
sudo certbot --nginx -d your-domain.com

# 链接配置
sudo cp nginx/external.conf.example /etc/nginx/sites-available/stealthnet.conf
sudo ln -s /etc/nginx/sites-available/stealthnet.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 🗂️ 项目结构

```
remnawave-STEALTHNET-Bot/
├── backend/                  # 后端 API
│   ├── src/
│   │   ├── index.ts          # 入口点
│   │   ├── modules/
│   │   │   ├── auth/         # JWT 身份验证
│   │   │   ├── admin/        # 管理员路由和控制器
│   │   │   └── client/       # 客户端路由和控制器
│   │   └── ...
│   └── prisma/
│       └── schema.prisma     # 数据库 Schema
├── bot/                      # Telegram 机器人
│   ├── src/
│   │   ├── index.ts          # 机器人逻辑
│   │   ├── api.ts            # 后端 API 的客户端
│   │   └── keyboard.ts       # 键盘和按钮
│   └── ...
├── frontend/                 # React SPA
│   ├── src/
│   │   ├── pages/            # 页面 (admin + cabinet)
│   │   ├── components/       # 可重用组件
│   │   └── ...
│   └── ...
├── nginx/                    # Nginx 配置
│   ├── nginx.conf.template   # 内置 nginx 模板
│   ├── nginx-initial.conf    # certbot 初始配置
│   └── external.conf.example # 外部 nginx 示例
├── scripts/                  # 辅助脚本
├── docker-compose.yml        # 所有服务的编排
├── install.sh                # 交互式安装脚本
├── .env.example              # 环境变量模板
└── README.md                 # 此文件
```

---

## 🔁 迁移

从其他面板迁移？支持从以下两个来源进行迁移：

| 来源                             | 脚本                                | 文档                                               |
| -------------------------------- | ----------------------------------- | ------------------------------------------------- |
| **旧版 STEALTHNET 面板 (Flask)** | `scripts/migrate-from-old-panel.js` | [详细说明](MIGRATION.md#选项-1从旧面板-flask-迁移)   |
| **Bedolaga Bot**                 | `scripts/migrate-from-bedolaga.js`  | [详细说明](MIGRATION.md#选项-2从-Bedolaga-Bot-迁移) |

### 🧬 迁移快速开始

```bash
# 1. 安装脚本依赖（一次性）
cd scripts && npm install && cd ..

# 2a. 从旧的 Flask 面板迁移
OLD_DB_HOST=localhost OLD_DB_NAME=stealthnet_old \
NEW_DB_HOST=localhost NEW_DB_NAME=stealthnet \
node scripts/migrate-from-old-panel.js

# 2b. 从 Bedolaga 迁移（备份路径）
node scripts/migrate-from-bedolaga.js ./backup_20260126_000000.tar.gz
```

> 货币将从系统设置 (`default_currency`) 中自动确定。  
> 脚本具有幂等性 — 可以重复运行，没有重复数据的风险。  
> 完整文档、变量和常见问题解答 — 请参见 **[MIGRATION.md](MIGRATION.md)**。

---

## 💬 支持与社区

问题、建议、错误报告 —— 全部在这里：

<p align="center">
  <a href="https://t.me/stealthnet_admin_panel"><img src="https://img.shields.io/badge/Telegram-@stealthnet__admin__panel-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram频道" /></a>
</p>

---

## 📜 许可证

本项目采用 **GNU AGPL-3.0** 许可证分发。

<p align="center">
  <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg" alt="License-AGPL" /></a>
</p>

许可证全文见 [LICENSE](../../LICENSE) 文件。在使用、修改和分发代码时，必须遵守 AGPL-3.0 协议的条件（包括在作为网络服务使用时需公开衍生作品的源代码）。

---

<p align="center">
  <b>STEALTHNET 3.0</b> — 优雅地销售 VPN。<br/>
  <sub>基于 TypeScript, React, Grammy, Prisma, Docker 构建</sub><br/><br/>
</p>