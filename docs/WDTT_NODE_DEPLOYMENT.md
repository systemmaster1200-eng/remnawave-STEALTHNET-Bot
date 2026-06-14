# WDTT Node — Deployment & Admin Panel Setup Guide

## What is WDTT?

WDTT (WireGuard-over-TURN) — это VPN-протокол для Android, основанный на WireGuard с обфускацией через TURN-серверы. Узлы WDTT работают на базе [proxy-turn-vk-android-main](https://github.com/nicknishevkname/proxy-turn-vk-android-main).

---

## 1. Deploying a WDTT Node

### Requirements

- Linux server (Ubuntu 22.04+ / Debian 12+ recommended)
- Docker & Docker Compose
- Public IP or domain with ports 56000-56001 and 9000 open
- Minimum: 1 vCPU, 1 GB RAM

### Step 1: Clone and Configure

```bash
git clone https://github.com/nicknishevkname/proxy-turn-vk-android-main.git
cd proxy-turn-vk-android-main
```

Edit `.env` or `docker-compose.yml`:

```yaml
# Ports mapping:
#   56000 — DTLS (WireGuard over DTLS)
#   56001 — WireGuard native
#   9000  — TUN (internal)

ports:
  - "0.0.0.0:56000:56000/udp"   # DTLS
  - "0.0.0.0:56001:56001/udp"   # WireGuard
  - "0.0.0.0:9000:9000/tcp"     # TUN API
```

### Step 2: Generate an API Key

The WDTT node requires an API key for remote key management. Generate one:

```bash
openssl rand -hex 32
# Example output: a1b2c3d4e5f6...64 characters
```

Save this key — you'll need it when registering the node in the admin panel.

### Step 3: Start the Node

```bash
docker compose up -d
```

Verify it's running:

```bash
docker compose logs -f
# Look for: "Server started on port 56000" or similar
```

### Step 4: Configure the API Key in Node

Set the `X-API-Key` header value in the node's configuration. The node exposes:

- `POST /api/keys` — creates a WireGuard key (requires `X-API-Key` header)
- `DELETE /api/keys/:vk_hash` — revokes a key

Test the node API:

```bash
curl -X POST http://YOUR_SERVER_IP:9000/api/keys \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"password": "test123"}'
```

Expected response:
```json
{
  "vk_hash": "abc123...",
  "wdtt_link": "wdtt://..."
}
```

---

## 2. Registering the Node in Admin Panel

### Step 1: Open Admin Panel

Navigate to: `https://your-domain.com/admin/wdtt`

### Step 2: Add a New Node

1. Click **"Добавить ноду"** (Add Node)
2. Fill in:
   - **Название** (Name): e.g., "Node #1 — Moscow"
   - **API URL**: `http://YOUR_SERVER_IP:9000` (the TUN API endpoint)
   - **API Key**: the key you generated in Step 2 above
   - **DTLS Port**: 56000 (default)
   - **WG Port**: 56001 (default)
   - **TUN Port**: 9000 (default)
   - **Capacity**: max number of slots (null = unlimited)
3. Click **Create**

### Step 3: Test the Connection

1. Find your node in the list
2. Click the **"Test"** button (⚡)
3. The panel will ping the node's API
4. Status should change to **ONLINE** (green)

### Step 4: Create WDTT Categories

1. Go to the **"Тарифы"** tab
2. Create a category (e.g., "WDTT — 30 дней")
3. Set sort order for display

### Step 5: Create WDTT Tariffs

1. Within a category, click **"Создать тариф"** (Create Tariff)
2. Fill in:
   - **Название**: e.g., "WDTT 30 дней / 1 устройство"
   - **Количество слотов**: how many WDTT keys per purchase (usually 1)
   - **Длительность (дней)**: 30
   - **Лимит трафика (байт)**: e.g., 107374182400 (100 GB) or null for unlimited
   - **Цена**: your price
   - **Валюта**: usd / rub
   - **Включён**: yes
3. Click **Create**

### Step 6: Assign Nodes to Tariffs

For each tariff, assign which nodes can serve it:
- Leave unassigned = all ONLINE nodes are used (round-robin)
- Assign specific nodes = only those nodes will be used

---

## 3. How It Works (Flow)

1. **Client buys WDTT tariff** → via bot or web cabinet
2. **Payment confirmed** → `mark-paid.service.ts` calls `createWdttSlotsByPaymentId()`
3. **Slot activation** → system:
   - Finds available ONLINE nodes (filtered by tariff assignments)
   - Generates a password
   - Calls `POST /api/keys` on the node with the password
   - Node returns `vk_hash` and `wdtt_link`
   - Creates a `WdttSlot` record in the database
4. **Client receives** → a `wdtt://` link that can be imported into the WDTT Android app
5. **Expiration** → cron (`wdtt.cron.ts`) runs every 5 minutes, revokes expired slots by calling `DELETE /api/keys/:vk_hash` on the node

---

## 4. Bot Integration

### Enabling WDTT in the Bot

The bot menu buttons are configured in **Admin → Settings → Bot Buttons**:

- **⚡ WDTT / Warp** — opens the WDTT tariff purchase page
- **📋 Мои WDTT доступы** — opens the WDTT slots page

Both buttons are **enabled by default**. If you don't see them:

1. Go to **Admin → Settings → Bot**
2. Find the WDTT buttons in the button list
3. Enable them and set the desired order/style

### Client Flow in Bot

1. Client taps **"⚡ WDTT / Warp"**
2. Opens Mini App with WDTT tariffs
3. Selects a tariff → taps "Pay"
4. Chooses payment method (balance / crypto / YooKassa / etc.)
5. After payment → receives `wdtt://` link
6. Client imports the link into the WDTT Android app

---

## 5. Monitoring & Troubleshooting

### Node Status

- **ONLINE** — node is responding to API calls
- **OFFLINE** — last heartbeat was >5 minutes ago
- **DISABLED** — manually disabled by admin

### Common Issues

| Issue | Solution |
|-------|----------|
| Node shows OFFLINE | Check if the node's API is accessible from the server: `curl http://NODE_IP:9000/api/keys` |
| "Нет доступных WDTT нод" | No ONLINE nodes. Check node status, restart the node |
| Keys not created | Check API key is correct, node logs for errors |
| wdtt:// link not working | Verify the node's publicHost is reachable from client's device |
| Slots not appearing | Check `mark-paid.service.ts` logs, verify `wdttTariffId` is set on the payment |

### Logs

```bash
# API logs
docker compose logs -f api | grep -i wdtt

# Node logs
docker compose -f /path/to/proxy-turn-vk-android-main/logs -f
```

---

## 6. Architecture Diagram

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Telegram    │────▶│  STEALTHNET API   │────▶│  WDTT Node      │
│  Bot / Mini  │     │  (mark-paid)     │     │  (proxy-turn)   │
│  App         │     │                  │     │                 │
└─────────────┘     │  POST /api/keys  │     │  POST /api/keys │
                    │  DELETE /api/keys│     │  DELETE /api/keys│
                    └──────────────────┘     └─────────────────┘
                           │                         │
                           ▼                         ▼
                    ┌──────────────┐          ┌──────────────┐
                    │  PostgreSQL   │          │  WireGuard   │
                    │  (wdtt_slots) │          │  (DTLS/TUN)  │
                    └──────────────┘          └──────────────┘
```
