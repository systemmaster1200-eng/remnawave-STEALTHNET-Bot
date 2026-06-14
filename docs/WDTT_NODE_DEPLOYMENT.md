# WDTT (Warp/WireGuard) — Полное руководство

## Содержание

1. [Что такое WDTT](#1-что-такое-wdtt)
2. [Архитектура](#2-архитектура)
3. [Быстрый старт (Docker)](#3-быстрый-старт)
4. [Ручная установка](#4-ручная-установка)
5. [Настройка STEALTHNET API](#5-настройка-stealthnet-api)
6. [Создание категорий и тарифов](#6-создание-категорий-и-тарифов)
7. [Покупка клиентом](#7-покупка-клиентом)
8. [Мониторинг](#8-мониторинг)
9. [Устранение проблем](#9-устранение-проблем)
10. [Безопасность](#10-безопасность)

---

## 1. Что такое WDTT

**WDTT** (WireGuard-over-TURN) — VPN-протокол для Android, основанный на WireGuard с обфускацией через TURN-серверы VK.

**Источник:** [github.com/amurcanov/proxy-turn-vk-android](https://github.com/amurcanov/proxy-turn-vk-android)

Особенности:
- **Обфускация** — трафик маскируется под WebRTC/DTLS
- **Скорость** — WireGuard на уровне ядра
- **Простота** — один `wdtt://` ссылка для подключения
- **Управление** — Telegram-бот + HTTP API

---

## 2. Архитектура

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│   Клиент         │     │   STEALTHNET API      │     │   WDTT-нода         │
│   (Telegram Bot  │────▶│                       │────▶│   (proxy-turn-vk)   │
│    / Mini App)   │     │   POST /api/keys      │     │                     │
│                  │     │   DELETE /api/keys/:id │     │   Порт 9000 (API)   │
│                  │     │                       │     │   Порт 56000 (DTLS) │
│                  │     │   POST /api/health    │     │   Порт 56001 (WG)   │
└─────────────────┘     └──────────────────────┘     └─────────────────────┘
```

**Жизненный цикл слота:**

```
Клиент покупает тариф
        │
        ▼
STEALTHNET API → POST /api/keys → WDTT-нода
        │
        ▼
Нода создаёт пароль → возвращает wdtt:// ссылку
        │
        ▼
Клиент получает ссылку → импортирует в WDTT App
        │
        ▼
Через N дней: DELETE /api/keys/:password → слот отозван
```

---

## 3. Быстрый старт

### Через наш репозиторий

```bash
# 1. Клонируем (или берём из основного репозитория)
cd /opt
git clone https://github.com/ASTRACAT2022/remnawave-STEALTHNET-Bot.git
cd remnawave-STEALTHNET-Bot/wdtt-node

# 2. Создаём .env
cp .env.example .env
nano .env
```

### Настройка `.env`

```bash
# Обязательные:
MAIN_PASSWORD=ваш_надёжный_пароль
API_KEY=$(openssl rand -hex 32)

# Опционально:
PUBLIC_HOST=ваш_ip_или_домен
ADMIN_ID=ваш_telegram_id
BOT_TOKEN=ваш_bot_token
```

### Запуск

```bash
# Сборка и запуск
docker compose build --no-cache
docker compose up -d

# Проверка
curl http://localhost:9000/api/health -H "X-API-Key: ВАШ_API_KEY"
```

### Или через скрипт

```bash
cd wdtt-node
chmod +x deploy.sh
./deploy.sh install
```

---

## 4. Ручная установка

Если не используете Docker:

### Установка WDTT сервера

```bash
# Устанавливаем Go
wget https://go.dev/dl/go1.23.0.linux-amd64.tar.gz
tar -C /usr/local -xzf go1.23.0.linux-amd64.tar.gz
export PATH=$PATH:/usr/local/go/bin

# Клонируем и собираем
cd /opt
git clone https://github.com/amurcanov/proxy-turn-vk-android.git wdtt-server
cd wdtt-server
go build -o /usr/local/bin/wdtt-server .

# Создаём systemd сервис
cat > /etc/systemd/system/wdtt.service << 'EOF'
[Unit]
Description=WDTT Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/wdtt-server \
    -listen 0.0.0.0:56000 \
    -wg-port 56001 \
    -config-dir /etc/wdtt \
    -password CHANGE_ME
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now wdtt
```

### Установка API-обёртки

```bash
# Собираем API-обёртку
cd /tmp
cat > api-server.go << 'GOEOF'
<содержимое wdtt-node/api-server.go>
GOEOF

go build -o /usr/local/bin/wdtt-api api-server.go

# Создаём systemd сервис
cat > /etc/systemd/system/wdtt-api.service << 'EOF'
[Unit]
Description=WDTT API Wrapper
After=network.target wdtt.service

[Service]
Type=simple
Environment=CONFIG_DIR=/etc/wdtt
Environment=API_PORT=9000
Environment=WDTT_PORTS=56000,56001,9000
Environment=API_KEY=ВАШ_API_KEY
ExecStart=/usr/local/bin/wdtt-api
Restart=always

[Install]
WantedBy=multi-user.target
EOF

systemctl enable --now wdtt-api
```

### Настройка файрвола

```bash
# UFW
ufw allow 9000/tcp    # API
ufw allow 56000/udp   # DTLS
ufw allow 56001/udp   # WireGuard

# Или iptables
iptables -A INPUT -p tcp --dport 9000 -j ACCEPT
iptables -A INPUT -p udp --dport 56000 -j ACCEPT
iptables -A INPUT -p udp --dport 56001 -j ACCEPT
```

---

## 5. Настройка STEALTHNET API

### Шаг 1: Регистрация ноды

1. Откройте админку: `https://your-domain.com/admin/wdtt`
2. Перейдите в **«Ноды»** → **«Добавить ноду»**
3. Заполните:

| Поле | Значение |
|------|----------|
| Название | `Node #1` |
| API URL | `http://YOUR_WDTT_IP:9000` |
| API Key | ваш ключ из `.env` |
| DTLS Port | `56000` |
| WG Port | `56001` |
| Capacity | `100` (или пусто) |

4. Нажмите **«Создать»**

### Шаг 2: Проверка связи

1. Найдите ноду в списке
2. Нажмите **«Тест»** (⚡)
3. Статус → **ONLINE** ✅

### Шаг 3: Публичный хост

Если клиенты подключаются напрямую:

```bash
# В .env установите:
PUBLIC_HOST=ваш_ip_или_домен

# Или через API:
curl -X PATCH http://localhost:9000/api/nodes/NODE_ID \
  -H "X-API-Key: YOUR_KEY" \
  -d '{"publicHost": "your-domain.com"}'
```

---

## 6. Создание категорий и тарифов

### Категория

1. **WDTT → Тарифы → Создать категорию**
2. Название: `WDTT — 30 дней`
3. Порядок: `0`

### Тариф

| Поле | Пример | Описание |
|------|--------|----------|
| Название | `WDTT 30 дней / 1 устройство` | Имя |
| Слотов | `1` | Ключей за покупку |
| Дней | `30` | Срок действия |
| Трафик | `107374182400` (100 ГБ) | `null` = безлимит |
| Цена | `5.00` | Цена |
| Валюта | `usd` | usd/rub |

### Примеры тарифов

| Название | Слотов | Дней | Трафик | Цена |
|----------|--------|------|--------|------|
| WDTT 30 дней | 1 | 30 | безлимит | $5 |
| WDTT 30 дней / 100 ГБ | 1 | 30 | 100 ГБ | $3 |
| WDTT 90 дней | 1 | 90 | безлимит | $12 |
| WDTT 30 дней / 3 устройства | 3 | 30 | безлимит | $12 |

---

## 7. Покупка клиентом

### Через Telegram-бот

1. **⚡ WDTT / Warp** → выбор тарифа → оплата
2. Получает `wdtt://` ссылку
3. Импортирует в **WDTT Android App**

### Через веб-кабинет

1. `/cabinet/wdtt` → вкладка **«Купить»**
2. Выбор тарифа → оплата
3. Ссылка на вкладке **«Мои доступы»**

### Подключение в WDTT App

1. Установите [WDTT](https://github.com/amurcanov/proxy-turn-vk-android/releases) (APK)
2. **«+»** → **«Импорт из ссылки»**
3. Вставьте `wdtt://` ссылку
4. **«Подключить»**

---

## 8. Мониторинг

### Health check

```bash
curl http://localhost:9000/api/health -H "X-API-Key: YOUR_KEY"
```

### Список ключей

```bash
curl http://localhost:9000/api/keys -H "X-API-Key: YOUR_KEY" | jq .
```

### Логи

```bash
# Docker
docker compose logs -f --tail=50

# Systemd
journalctl -u wdtt -f
journalctl -u wdtt-api -f
```

### Статус в админке

- **Ноды** → статус (ONLINE/OFFLINE), слоты, ёмкость
- **Слоты** → пароль, ссылка, статус, клиент

---

## 9. Устранение проблем

### Нода OFFLINE

```bash
# Проверяем контейнер
docker compose ps
docker compose logs --tail=50

# Проверяем API
curl -v http://NODE_IP:9000/api/health -H "X-API-Key: KEY"

# Файрвол
ufw allow 9000/tcp
ufw allow 56000/udp
ufw allow 56001/udp
```

### Ключи не создаются

```bash
# Проверяем API
curl -X POST http://localhost:9000/api/keys \
  -H "X-API-Key: KEY" \
  -H "Content-Type: application/json" \
  -d '{"password": "test123"}'

# Проверяем логи
docker compose logs | grep -i error
```

### wdtt:// ссылка не работает

1. Проверьте статус слота (ACTIVE)
2. Проверьте, что ключ существует: `GET /api/keys`
3. Убедитесь, что WDTT App установлен

---

## 10. Безопасность

### API-ключ

- Храните в `.env` (не в коде)
- Регулярно ротируйте
- Разные ключи для разных нод

### Файрвол

```bash
# Только необходимые порты
ufw allow 9000/tcp    # API (только для STEALTHNET)
ufw allow 56000/udp   # DTLS
ufw allow 56001/udp   # WireGuard
```

Ограничьте доступ к API:

```bash
ufw allow from STEALTHNET_IP to any port 9000 proto tcp
```

### Бэкап

```bash
# Данные ноды
tar -czf wdtt-backup-$(date +%Y%m%d).tar.gz /etc/wdtt/

# БД STEALTHNET
docker compose exec postgres pg_dump -U postgres stealthnet | gzip > backup.sql.gz
```

---

## FAQ

**Q: Сколько нод нужно?**
A: 1 для начала. 2+ для отказоустойчивости.

**Q: Как обновить?**
A: `cd wdtt-node && docker compose pull && docker compose up -d`

**Q: Поддерживается ли iOS?**
A: Да — [anton48/vk-turn-proxy-ios](https://github.com/anton48/vk-turn-proxy-ios)

**Q: Поддерживается ли Windows/Linux?**
A: Да — [luminescq/PWDTT](https://github.com/luminescq/PWDTT)

**Q: Какой максимальный трафик?**
A: Задаётся в тарифе. `null` = безлимит. 100 ГБ = 107374182400 байт.
