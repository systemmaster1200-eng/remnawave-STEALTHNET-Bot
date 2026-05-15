# 迁移到 STEALTHNET 3.0

从先前版本的面板迁移数据的说明。

> **重要提示：**在进行任何迁移之前，请备份新的数据库。  
> 所有脚本都是**幂等的** —— 重新运行时将跳过重复项。

---

## 目录

- [常规：准备工作](#常规准备工作)
- [确定货币](#确定货币)
- [选项 1：从旧面板 (Flask) 迁移](#选项-1从旧面板-flask-迁移)
- [选项 2：从 Bedolaga Bot 迁移](#选项-2从-bedolaga-bot-迁移)
- [常见问题解答 (FAQ)](#常见问题解答-faq)

---

## 常规：准备工作

### 1. 确保新面板正在运行

```bash
docker compose ps
# 所有服务都应处于 Up 状态
```

### 2. 安装迁移脚本依赖项（仅一次）

```bash
cd /opt/remnawave-STEALTHNET-Bot/scripts
npm install
cd ..
```

### 3. 备份新数据库

```bash
docker compose exec postgres pg_dump -U stealthnet stealthnet > backup_before_migration.sql
```

---

## 确定货币

两个迁移脚本都会从新面板设置（`system_settings` 表，`default_currency` 键）中**自动确定系统货币**。

| 系统货币 | 会发生什么                       |
| -------- | ------------------------------ |
| `rub`    | 余额、价格和付款将以**卢布**迁移 |
| `usd`    | 一切都将转换为**美元**          |

可以在运行迁移**之前**通过管理面板设置（设置 → 默认货币）来设定货币，或者通过 ENV（环境变量）覆盖：

```bash
DEFAULT_CURRENCY=rub node scripts/migrate-from-old-panel.js
```

---

## 选项 1：从旧面板 (Flask) 迁移

> 脚本：`scripts/migrate-from-old-panel.js`  
> 来源：以前的 STEALTHNET 面板（Flask + SQLAlchemy）的 PostgreSQL 数据库

### 迁移内容

| 旧面板 (Flask)              | STEALTHNET 3.0   | 详细信息                                                            |
| --------------------------- | ---------------- | ------------------------------------------------------------------ |
| `User`                      | `Client`         | email, telegram_id, 余额, referral_code, remnawave_uuid, trial_used |
| `TariffLevel` / `tier` 字段 | `TariffCategory` | basic → "基础版", pro → "高级版", elite → "精英版"                   |
| `Tariff`                    | `Tariff`         | 价格取自系统货币列（`price_rub` / `price_usd` / `price_uah`）        |
| `Payment`                   | `Payment`        | 供应商的所有付款历史记录                                             |
| `PromoCode`                 | `PromoCode`      | PERCENT → DISCOUNT, DAYS → FREE_DAYS                               |
| `referrer_id` 关系          | `referrerId`     | 推荐人关系链                                                        |
| `SystemSetting`             | `SystemSettings` | 语言、货币、启用的语言/货币                                          |
| `BotConfig`                 | `SystemSettings` | 服务名称、技术支持、试用天数                                         |
| `BrandingSetting`           | `SystemSettings` | Logo, favicon, 标题名称                                             |
| `ReferralSetting`           | `SystemSettings` | 推荐返利百分比、小队试用                                             |
| `TrialSettings`             | `SystemSettings` | 天数、设备数、流量                                                  |

### 运行迁移

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

> 如果两个数据库在同一台服务器上，请指定不同的 `OLD_DB_NAME` / `NEW_DB_NAME`。

### 所有变量

| 变量               | 默认值                          | 描述                     |
| ------------------ | ------------------------------- | ----------------------- |
| `OLD_DB_HOST`      | `localhost`                     | 旧 PostgreSQL 主机       |
| `OLD_DB_PORT`      | `5432`                          | 旧数据库端口             |
| `OLD_DB_NAME`      | `stealthnet`                    | 旧数据库名称             |
| `OLD_DB_USER`      | `stealthnet`                    | 旧数据库用户             |
| `OLD_DB_PASSWORD`  | `stealthnet_password_change_me` | 旧数据库密码             |
| `NEW_DB_HOST`      | `localhost`                     | 新 PostgreSQL 主机      |
| `NEW_DB_PORT`      | `5432`                          | 新数据库端口             |
| `NEW_DB_NAME`      | `stealthnet`                    | 新数据库名称             |
| `NEW_DB_USER`      | `stealthnet`                    | 新数据库用户             |
| `NEW_DB_PASSWORD`  | `stealthnet_change_me`          | 新数据库密码             |
| `DEFAULT_CURRENCY` | *（来自 system_settings）*      | 覆盖货币（`rub`, `usd`）  |

### 输出示例

```
  💱  系统货币: RUB
      余额和价格将以 RUB 为单位进行迁移

═══════════════════════════════════════════════════════════════
  1/7  资费类别 (TariffLevel → TariffCategory)
═══════════════════════════════════════════════════════════════
  ✅  类别 "基础版" (basic)
  ✅  类别 "高级版" (pro)
  ...

╔══════════════════════════════════════════════════════════════╗
║                         迁移已完成                            ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  客户端:        42 已创建       0 已跳过       0 错误          ║
║  类别:          3 已创建       0 已跳过                       ║
║  资费:          9 已创建       0 已跳过       0 错误          ║
║  付款:        156 已创建       0 已跳过       0 错误          ║
║  促销代码:       5 已创建       0 已跳过       0 错误          ║
║  推荐:         18 已关联                      0 错误          ║
║  设置:         12 已迁移                                      ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

### 迁移后

- [ ] 进入 **管理面板** → 检查客户端、资费和付款记录
- [ ] 在“设置”部分配置**支付系统** (Platega)
- [ ] 在管理面板中点击 **“Sync from Remna”** —— 此操作将关联当前的订阅
- [ ] 检查 `.env` 文件中的 **bot token** （如果是新机器人 —— 运行 `docker compose restart bot`）

---

## 选项 2：从 Bedolaga Bot 迁移

> 脚本：`scripts/migrate-from-bedolaga.js`  
> 来源：来自 remnawave-bedolaga-telegram-bot 的 JSON 备份（`backup_*.tar.gz`）

### 迁移内容

| Bedolaga Bot        | STEALTHNET 3.0     | 详细信息                                                         |
| ------------------- | ------------------ | --------------------------------------------------------------- |
| `users`             | `clients`          | telegram_id, username, 名字, 余额, remnawave_uuid, referral_code |
| `subscriptions`     | `trial_used` 更新  | 订阅数据已存在于 Remnawave 中 —— 将通过 Sync 拉取                  |
| `transactions`      | `payments`         | 所有交易记录：存款、购买、奖金                                     |
| `referred_by_id`    | `referrerId`       | 推荐人关系链                                                     |
| `referral_earnings` | `referral_credits` | 给推荐人的收益                                                   |
| `system_settings`   | `system_settings`  | 常规设置（将跳过密钥/令牌）                                       |

### 货币换算 (戈比)

Bedolaga 将金额以**戈比 (kopecks)** 的形式存储。脚本会自动进行转换：

| 系统货币 | 公式                        | 示例：30000 戈比                  |
| -------- | --------------------------- | ------------------------------- |
| `rub`    | 戈比 ÷ 100                  | **300 ₽**                       |
| `usd`    | 戈比 × `KOPEKS_TO_USD` 汇率 | **3.00 $** （当汇率为 0.0001 时） |

### 运行迁移

```bash
cd /opt/remnawave-STEALTHNET-Bot

# 将备份路径作为参数
node scripts/migrate-from-bedolaga.js ./backup_20260126_000000.tar.gz
```

或使用变量：

```bash
NEW_DB_HOST=localhost \
NEW_DB_PORT=5432 \
NEW_DB_NAME=stealthnet \
NEW_DB_USER=stealthnet \
NEW_DB_PASSWORD=new_password \
KOPEKS_TO_USD=0.0001 \
node scripts/migrate-from-bedolaga.js ./backup.tar.gz
```

### 所有变量

| 变量               | 默认值                     | 描述                                      |
| ------------------ | -------------------------- | ---------------------------------------- |
| `NEW_DB_HOST`      | `localhost`                | 新 PostgreSQL 主机                        |
| `NEW_DB_PORT`      | `5432`                     | 端口                                      |
| `NEW_DB_NAME`      | `stealthnet`               | 数据库名称                                |
| `NEW_DB_USER`      | `stealthnet`               | 用户                                      |
| `NEW_DB_PASSWORD`  | `stealthnet_change_me`     | 密码                                      |
| `DEFAULT_CURRENCY` | *（来自 system_settings）* | 覆盖货币                                   |
| `KOPEKS_TO_USD`    | `0.0001`                   | 美元汇率（1 戈比 = X 美元）。仅适用于 `usd` |

### 输出示例

```
  💱  系统货币: RUB
      戈比 → 卢布 (÷100)

╔══════════════════════════════════════════════════════════════╗
║                从 BEDOLAGA 迁移已完成                         ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  客户端:         17 已创建      0 已跳过       0 错误          ║
║  订阅:           6 已更新      0 已跳过                        ║
║  付款:          11 已创建      0 已跳过       0 错误           ║
║  推荐:           2 已关联                     0 错误           ║
║  推荐奖金:        1 已创建                     0 错误          ║
║  设置:           4 已迁移                                     ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

### 迁移后

- [ ] 在 **管理面板** 中检查客户端
- [ ] 点击 **“Sync from Remna”** —— 这将从 Remnawave 拉取订阅
- [ ] 手动 **创建资费**（Bedolaga 中没有资费计划）
- [ ] 配置 **支付系统** (Platega)
- [ ] 如有必要，请调整汇率并重新启动迁移

---

## 常见问题解答 (FAQ)

### 迁移可以重新运行吗？

可以。两个脚本都是幂等的 —— 会根据 `telegram_id`、`email`、`order_id` 跳过重复项。数据不会被重复记录。

### 如何回滚迁移？

恢复备份：

```bash
docker compose exec -T postgres psql -U stealthnet stealthnet < backup_before_migration.sql
```

### 我的旧面板使用的是 SQLite，而不是 PostgreSQL

`migrate-from-old-panel.js` 脚本仅适用于 PostgreSQL。如果旧面板运行的是 SQLite，请先将其迁移到 PostgreSQL（旧面板中有一个 `migration/manual/migrate_to_postgresql.py` 脚本），然后再运行我们的脚本。

### 如何查看系统中设置的货币？

```bash
docker compose exec postgres psql -U stealthnet stealthnet \
  -c "SELECT value FROM system_settings WHERE key = 'default_currency';"
```

或者进入管理面板 → **设置** → “默认货币”部分。

### 迁移后的余额货币不正确

1. 在管理面板（设置 → 货币）中设置所需的货币
2. 清除已迁移的客户端（或恢复备份）
3. 重新启动迁移 —— 它将提取当前的货币

### Bedolaga 备份在哪里？

在 Bedolaga Bot 设置 → 备份中，或在容器内的 `/app/data/backups/` 文件夹中：

```bash
docker cp stealthnet-bot:/app/data/backups/ ./bedolaga-backups/
ls ./bedolaga-backups/
```