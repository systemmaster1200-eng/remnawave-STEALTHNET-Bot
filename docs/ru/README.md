<div align="center">
  <a title="English" style="text-decoration: none;" href="../../README.md">
    <img src="https://cdn.jsdelivr.net/gh/hampusborgos/country-flags@main/svg/us.svg" alt="EN" width="20" /> EN</a>
  </a>
  <img src="https://cdn.jsdelivr.net/gh/hampusborgos/country-flags@main/svg/ru.svg" alt="RU" width="20" /> RU
  <a title="Chinese" style="text-decoration: none;" href="../cn/README.md">
    <img src="https://cdn.jsdelivr.net/gh/hampusborgos/country-flags@main/svg/cn.svg" alt="CN" width="20" /> CN
  </a>
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
  <b>Полноценная платформа для продажи VPN-подписок</b><br/>
  Telegram-бот &bull; Mini App &bull; Клиентский кабинет &bull; Админ-панель<br/>
  <i>Всё в одной коробке. Один скрипт — и работает.</i>
</p>

<p align="center">
  <a href="https://t.me/stealthnet_admin_panel"><img src="https://img.shields.io/badge/Telegram-канал-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram" /></a>
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/ecd37b8e-68ef-4616-92da-550f8bd9cdb5" width="830" alt="STEALTHNET скриншот 1" />
</p>
<p align="center">
  <img src="https://github.com/user-attachments/assets/5c504c46-0b00-47d1-b767-7afed7f36983" width="830" alt="STEALTHNET скриншот 2" />
</p>


<p align="center">
  <a href="#-быстрый-старт">Быстрый старт</a> &bull;
  <a href="#%EF%B8%8F-требования-к-серверу">Требования</a> &bull;
  <a href="#-архитектура">Архитектура</a> &bull;
  <a href="#-возможности">Возможности</a> &bull;
  <a href="#-telegram-бот">Telegram-бот</a> &bull;
  <a href="#-веб-панель">Веб-панель</a> &bull;
  <a href="#-api">API</a> &bull;
  <a href="#-docker-сервисы">Docker-сервисы</a> &bull;
  <a href="#%EF%B8%8F-настройка">Настройка</a> &bull;
  <a href="#-миграция">Миграция</a>
</p>

---

## 🚀 Быстрый старт

> [!CAUTION]
> Во избежании каких-либо конфликтов, настоятельно рекомендуется устанавливать данный стек **на отдельный сервер**!

```bash
apt install git -y
curl -fsSL https://get.docker.com | sh
cd /opt
git clone https://github.com/systemmaster1200-eng/remnawave-STEALTHNET-Bot.git
cd remnawave-STEALTHNET-Bot
bash install.sh
```

> [!WARNING]
> Если после запуска у вас **падает API** сервис, бот отвечает «**❌ fetch failed**», а в логах (`docker compose logs -f api`) видим ошибку «**Error: P1000: Authentication failed**» и если у вас на этом сервере не крутится ничего другого важного (других проектов), их можно и нужно удалить, чтобы освободить место следующей командой:
> 
> docker system prune -a --volumes

Интерактивный установщик за 2 минуты настроит всё:

- Домен и SSL-сертификаты (Let's Encrypt)
- PostgreSQL, JWT-секреты, данные администратора
- Подключение к Remnawave API
- Telegram-бот
- Nginx (встроенный с авто-SSL или свой reverse proxy)

---

## 🖥️ Требования к серверу

Ориентировочные конфигурации для работы всех сервисов (API, фронтенд, бот, Nginx, PostgreSQL) в Docker:

| Уровень           | CPU    | RAM      | Диск      | Назначение                                                |
| ----------------- | ------ | -------- | --------- | --------------------------------------------------------- |
| **Минимальная**   | 1 vCPU | 1.5–2 GB | 20 GB     | Тест, демо, до ~50 активных пользователей                 |
| **Средняя**       | 2 vCPU | 4 GB     | 40 GB SSD | Небольшой прод, до ~500 пользователей, стабильная работа  |
| **Рекомендуемая** | 4 vCPU | 8 GB     | 80 GB SSD | Продакшен с запасом, тысячи пользователей, быстрый отклик |

**Общее:**

- ОС: Linux (Debian 13, Ubuntu 24.04 LTS или аналог), Docker и Docker Compose v2+.
- Открытые порты: **80** (HTTP), **443** (HTTPS); при установке через `install.sh` — только они.
- Для среднего и рекомендуемого уровня желательно SSD и отдельный бэкап БД.

---

## 🧱 Архитектура

```
┌──────────────────────────────────────────────────────────┐
│                      STEALTHNET 3.0                      │
├──────────────┬──────────────┬──────────────┬─────────────┤
│  Telegram    │  Mini App    │  Клиентский  │  Админ-     │
│  Бот         │  (WebApp)    │  кабинет     │  панель     │
│  Grammy      │  React       │  React       │  React      │
├──────────────┴──────────────┴──────────────┴─────────────┤
│                   Backend API (Express)                  │
│            JWT Auth  ·  Prisma ORM  ·  Webhooks          │
├──────────────────────────────────────────────────────────┤
│          PostgreSQL          │       Remnawave API       │
│          (данные)            │       (VPN-ядро)          │
├──────────────────────────────┴───────────────────────────┤
│         Nginx + Let's Encrypt  ·  Docker Compose         │
└──────────────────────────────────────────────────────────┘
```

| Сервис       | Технологии                                             | Назначение                                                                  |
| ------------ | ------------------------------------------------------ | --------------------------------------------------------------------------- |
| **backend**  | Node.js, Express, Prisma, PostgreSQL                   | REST API: авторизация, клиенты, тарифы, платежи, рефералы, промо, аналитика |
| **frontend** | React 18, Vite, Tailwind CSS, shadcn/ui, Framer Motion | Админ-панель + клиентский кабинет + Telegram Mini App                       |
| **bot**      | Grammy (TypeScript)                                    | Полноценный Telegram-бот с кабинетом клиента                                |
| **nginx**    | Nginx + Certbot                                        | Reverse proxy, SSL, статика, gzip                                           |
| **postgres** | PostgreSQL 16                                          | Хранение всех данных                                                        |

---

## ✨ Возможности

### 💳 Платежи и подписки

- **Platega.io** — приём платежей (карты, СПБ, криптовалюта и др.); callback URL копируется в админке
- **ЮMoney** — пополнение баланса и оплата тарифов картой (форма перевода, HTTP-уведомления); URL вебхука с кнопкой «Копировать» в настройках
- **ЮKassa** — приём платежей картой и СБП через API (только RUB); чеки 54-ФЗ; вебхук на `payment.succeeded`; URL вебхука копируется в админке
- **Оплата балансом** — пополнение и списание с внутреннего баланса
- **Автоактивация** — после оплаты тариф активируется мгновенно через webhook (Platega, ЮMoney, ЮKassa)
- **Описание платежа** — во всех платёжках (Platega, ЮMoney, ЮKassa) в описании подставляется **название сервиса** из настроек админки (Общие → Название сервиса)
- **Гибкие тарифы** — категории, сроки, лимиты трафика и устройств, привязка к Remnawave-сквадам
- **Мультивалютность** — поддержка нескольких валют (USD, RUB и др.)

### 🤝 Реферальная программа

- **3 уровня рефералов** — заработок с приглашённых и их рефералов
- **Настраиваемые проценты** — отдельно для каждого уровня
- **Автоматическое начисление** — бонусы зачисляются на баланс при каждой оплате реферала
- **Реферальные ссылки** — для бота и для сайта

### 🎟️ Промо-система

- **Промо-группы** — бесплатная подписка по ссылке (`/start promo_CODE`), с лимитом активаций
- **Промокоды** — скидки (% или фиксированная сумма) и бесплатные дни
- **Лимиты использования** — общий лимит и лимит на клиента, срок действия
- **Статистика активаций** — сколько раз использован, кем, когда

### 🧪 Пробный период (триал)

- **Бесплатный триал** — настраиваемая длительность, лимиты трафика и устройств
- **Одноразовая активация** — один триал на клиента
- **Привязка к сквадам** — отдельный сквад для триальных пользователей

### 🔗 Remnawave-интеграция

- **Управление пользователями** — создание, удаление, блокировка в Remnawave
- **Подписки** — активация, продление, проверка статуса
- **Ноды** — мониторинг, включение/отключение, перезапуск
- **Сквады** — распределение пользователей по серверам
- **Синхронизация** — двусторонняя синхронизация данных (Remnawave <-> STEALTHNET)
- **Вебхуки** — автоматическая обработка событий от Remnawave

### 📱 Мобильная версия и Mini App

- **Сворачиваемые категории тарифов** — при нескольких категориях на узком экране и в Mini App категории показываются аккордеоном: по умолчанию открыта первая, остальные раскрываются по нажатию
- **Компактные карточки тарифов** — в мобильном виде тарифы в одну колонку, длинные тонкие строки (название и параметры слева, цена и «Оплатить» справа)
- **Единый мобильный интерфейс** — нижняя навигация, компактный хедер, тот же стиль в браузере на телефоне и в Telegram WebApp

### 📊 Аналитика и отчёты

- **Дашборд** — ключевые метрики в реальном времени
- **Графики выручки** — ежедневно за 90 дней
- **Рост клиентской базы** — динамика регистраций
- **Топ тарифов** — самые продаваемые планы
- **Реферальная статистика** — заработок по уровням
- **Конверсия** — триал -> платная подписка
- **Отчёт по продажам** — фильтрация по дате и платёжному провайдеру

### 🔐 Безопасность

- **JWT-аутентификация** — access + refresh токены
- **Принудительная смена пароля** — при первом входе администратора
- **Верификация email** — подтверждение по ссылке из письма
- **Блокировка клиентов** — с указанием причины
- **SSL/TLS** — автоматические сертификаты Let's Encrypt

---

## 🤖 Telegram-бот

Полноценный клиентский кабинет прямо в Telegram:

| Команда / Кнопка    | Что делает                                                         |
| ------------------- | ------------------------------------------------------------------ |
| `/start`            | Регистрация и главное меню                                         |
| `/start ref_CODE`   | Регистрация по реферальной ссылке                                  |
| `/start promo_CODE` | Активация промо-группы                                             |
| **Главное меню**    | Статус подписки, баланс, дни до истечения, трафик, лимит устройств |
| **Тарифы**          | Просмотр категорий и тарифов, покупка                              |
| **Пополнение**      | Пополнение баланса (пресеты и произвольная сумма)                  |
| **Профиль**         | Выбор языка и валюты                                               |
| **Рефералы**        | Статистика и реферальная ссылка                                    |
| **Триал**           | Активация бесплатного пробного периода                             |
| **VPN**             | Страница подписки (Mini App)                                       |
| **Промокод**        | Ввод промокода для скидки или бесплатных дней                      |
| **Поддержка**       | Ссылки на поддержку, соглашение, оферту, инструкции                |

**Фишки бота:**
- Кастомные эмодзи (Premium Emoji)
- Цветные кнопки (primary / success / danger)
- Прогресс-бар использования трафика
- Интеграция с Telegram Mini App (WebApp)
- Настраиваемые тексты и логотип

---

## 🌐 Веб-панель

### 🛠️ Админ-панель (`/admin`)

| Раздел                | Описание                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Дашборд**           | Статистика, состояние нод, быстрые действия                                                                                                          |
| **Клиенты**           | Список клиентов, поиск, фильтры, блокировка/разблокировка, сброс пароля                                                                              |
| **Тарифы**            | Управление категориями и тарифами (CRUD)                                                                                                             |
| **Промо-группы**      | Создание и управление промо-ссылками                                                                                                                 |
| **Промокоды**         | Создание скидочных и бесплатных промокодов                                                                                                           |
| **Аналитика**         | Графики выручки, клиентов, рефералов, конверсии                                                                                                      |
| **Отчёт по продажам** | Детализация продаж с фильтрами                                                                                                                       |
| **Настройки**         | Брендинг (название сервиса, логотип), SMTP, **Platega / ЮMoney / ЮKassa** (URL вебхуков с кнопкой «Копировать»), бот, Remnawave, реферальная система |

### 👤 Клиентский кабинет (`/cabinet`)

| Раздел          | Описание                                           |
| --------------- | -------------------------------------------------- |
| **Авторизация** | Email + пароль или Telegram-виджет                 |
| **Регистрация** | С подтверждением email                             |
| **Дашборд**     | Статус подписки, баланс, история платежей, триал   |
| **Тарифы**      | Просмотр и покупка тарифов                         |
| **Подписка**    | Страница VPN: приложения по платформам, deep links |
| **Рефералы**    | Статистика и ссылка для приглашения                |
| **Профиль**     | Язык, валюта, смена пароля                         |

**Технологии фронтенда:**
- React 18 + TypeScript + Vite
- Tailwind CSS + shadcn/ui
- Framer Motion (анимации)
- Recharts (графики)
- Тёмная / светлая тема
- Адаптивный дизайн (мобильные + десктоп)
- PWA (Service Worker)
- Telegram Mini App

---

## 🔌 API

### 👥 Клиентские эндпоинты (`/api/client`)

```
POST   /auth/register                — Регистрация (email + пароль)
POST   /auth/login                   — Авторизация
POST   /auth/telegram-miniapp        — Вход через Telegram Mini App
GET    /auth/me                      — Текущий пользователь

GET    /subscription                 — Статус подписки
GET    /tariffs                      — Доступные тарифы

POST   /payments/platega             — Создать платёж (Platega)
POST   /payments/balance             — Оплата балансом
POST   /yookassa/create-payment      — Создать платёж ЮKassa (карта/СБП, RUB), редирект на страницу оплаты
GET    /yoomoney/auth-url            — URL авторизации ЮMoney (OAuth)
POST   /yoomoney/request-topup       — Запрос пополнения через кошелёк ЮMoney
POST   /yoomoney/create-form-payment — Форма ЮMoney (оплата картой), возврат paymentUrl

POST   /trial                        — Активировать триал
POST   /promo/activate               — Активировать промо-группу
POST   /promo-code/check             — Проверить промокод
POST   /promo-code/activate          — Применить промокод

GET    /referral-stats               — Статистика рефералов
```

### 🛡️ Админские эндпоинты (`/api/admin`)

```
GET    /dashboard/stats              — Статистика дашборда
GET    /clients                      — Список клиентов (пагинация, поиск)
GET    /clients/:id                  — Детали клиента
PATCH  /clients/:id                  — Обновить клиента

CRUD   /tariff-categories            — Категории тарифов
CRUD   /tariffs                      — Тарифы
CRUD   /promo-groups                 — Промо-группы
CRUD   /promo-codes                  — Промокоды

GET    /analytics                    — Аналитика
GET    /sales-report                 — Отчёт по продажам
GET/PATCH /settings                  — Системные настройки

GET    /remna/*                      — Проксирование запросов к Remnawave
POST   /sync/from-remna              — Синхронизация из Remnawave
POST   /sync/to-remna                — Синхронизация в Remnawave
```

### 🌍 Публичные эндпоинты (`/api/public`)

```
GET    /config                       — Публичная конфигурация
GET    /tariffs                      — Список тарифов
GET    /subscription-page            — Конфиг страницы подписки
GET    /deeplink                     — Deep link для VPN-приложений
```

### 📡 Вебхуки

```
POST   /webhooks/remna               — События от Remnawave
POST   /webhooks/platega             — Callback от Platega (автоактивация)
POST   /webhooks/yoomoney            — HTTP-уведомления ЮMoney (пополнение, оплата тарифа)
POST   /webhooks/yookassa            — События ЮKassa (payment.succeeded → зачисление/активация тарифа)
```

---

## 🐳 Docker-сервисы

```bash
docker compose ps
```

| Контейнер             | Порт          | Описание                        |
| --------------------- | ------------- | ------------------------------- |
| `stealthnet-postgres` | 5432 (внутр.) | PostgreSQL 16 — база данных     |
| `stealthnet-api`      | 5000          | Backend API                     |
| `stealthnet-bot`      | —             | Telegram-бот                    |
| `stealthnet-nginx`    | 80, 443       | Nginx + SSL (встроенный режим)  |
| `stealthnet-certbot`  | —             | Автообновление SSL-сертификатов |

---

## 🧰 Полезные команды

```bash
# Обновление до последнего коммита (до последней мастер ветки, не всегда стабильно)
git pull origin main


# Обновление до конкретной версии (более стабильно, релиз версии):
git fetch --tags
git checkout v3.1.3

# Статус сервисов
docker compose ps

# Логи в реальном времени
docker compose logs -f api
docker compose logs -f bot
docker compose logs -f nginx

# Перезапуск API и бота
docker compose restart api bot

# Полная остановка
docker compose down

# Запуск (без встроенного nginx)
docker compose up -d

# Запуск (со встроенным nginx + SSL)
docker compose --profile builtin-nginx up -d

# Остановка (со встроенным nginx + SSL)
docker compose --profile builtin-nginx down

# Пересборка после обновления кода
docker compose build api bot
docker compose up frontend        # пересобрать фронтенд
docker compose restart api bot
```

### 🔄 Обновление из Git (git pull)

- **`nginx/nginx.conf`** — в `.gitignore` (файл генерируется install.sh под домен). Если Git всё ещё его обновляет при pull, один раз выполните:  
  `git rm --cached nginx/nginx.conf && git commit -m "Stop tracking nginx.conf"`
- **Исходный код** (`backend/...`, `nginx/nginx.conf.template` и т.д.) в игнор не добавлять. Перед `git pull` либо закоммитьте изменения, либо спрячьте:  
  `git stash && git pull && git stash pop`

---


## ⚙️ Настройка

### 🔑 Переменные окружения

Все переменные описаны в `.env.example`:

| Переменная               | Обязательная | Описание                                       |
| ------------------------ | :----------: | ---------------------------------------------- |
| `DOMAIN`                 |      да      | Домен панели (например `vpn.example.com`)      |
| `POSTGRES_DB`            |      да      | Имя базы данных                                |
| `POSTGRES_USER`          |      да      | Пользователь PostgreSQL                        |
| `POSTGRES_PASSWORD`      |      да      | Пароль PostgreSQL                              |
| `JWT_SECRET`             |      да      | Секрет для JWT-токенов (мин. 32 символа)       |
| `JWT_ACCESS_EXPIRES_IN`  |     нет      | Время жизни access-токена (по умолчанию `15m`) |
| `JWT_REFRESH_EXPIRES_IN` |     нет      | Время жизни refresh-токена (по умолчанию `7d`) |
| `INIT_ADMIN_EMAIL`       |      да      | Email первого администратора                   |
| `INIT_ADMIN_PASSWORD`    |      да      | Пароль первого администратора                  |
| `REMNA_API_URL`          |      да      | URL панели Remnawave                           |
| `REMNA_ADMIN_TOKEN`      |      да      | API-токен Remnawave                            |
| `BOT_TOKEN`              |     нет      | Токен Telegram-бота                            |
| `USE_BUILTIN_NGINX`      |     нет      | `true` для встроенного nginx                   |
| `CERTBOT_EMAIL`          |     нет      | Email для Let's Encrypt                        |

### 🌐 Свой Nginx (вместо встроенного)

Если при установке выбран внешний nginx:

1. Пример конфига: `nginx/external.conf.example`
2. API проксируется на `http://127.0.0.1:5000`
3. Статика фронтенда: `/var/www/stealthnet/` или `frontend/dist/`

```bash
# Получить SSL
sudo certbot --nginx -d your-domain.com

# Подключить конфиг
sudo cp nginx/external.conf.example /etc/nginx/sites-available/stealthnet.conf
sudo ln -s /etc/nginx/sites-available/stealthnet.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 🗂️ Структура проекта

```
remnawave-STEALTHNET-Bot/
├── backend/                  # Backend API
│   ├── src/
│   │   ├── index.ts          # Точка входа
│   │   ├── modules/
│   │   │   ├── auth/         # JWT-аутентификация
│   │   │   ├── admin/        # Админские маршруты и контроллеры
│   │   │   └── client/       # Клиентские маршруты и контроллеры
│   │   └── ...
│   └── prisma/
│       └── schema.prisma     # Схема базы данных
├── bot/                      # Telegram-бот
│   ├── src/
│   │   ├── index.ts          # Логика бота
│   │   ├── api.ts            # Клиент к Backend API
│   │   └── keyboard.ts       # Клавиатуры и кнопки
│   └── ...
├── frontend/                 # React SPA
│   ├── src/
│   │   ├── pages/            # Страницы (admin + cabinet)
│   │   ├── components/       # Переиспользуемые компоненты
│   │   └── ...
│   └── ...
├── nginx/                    # Конфиги Nginx
│   ├── nginx.conf.template   # Шаблон для встроенного nginx
│   ├── nginx-initial.conf    # Начальный конфиг для certbot
│   └── external.conf.example # Пример для внешнего nginx
├── scripts/                  # Вспомогательные скрипты
├── docker-compose.yml        # Оркестрация всех сервисов
├── install.sh                # Интерактивный установщик
├── .env.example              # Шаблон переменных окружения
└── README.md                 # Этот файл
```

---

## 🔁 Миграция

Переходите с другой панели? Поддерживается миграция из двух источников:

| Источник                             | Скрипт                              | Документация                                                                   |
| ------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------ |
| **Старая панель STEALTHNET (Flask)** | `scripts/migrate-from-old-panel.js` | [Подробная инструкция](MIGRATION.md#вариант-1-миграция-из-старой-панели-flask) |
| **Бедолага Бот**                     | `scripts/migrate-from-bedolaga.js`  | [Подробная инструкция](MIGRATION.md#вариант-2-миграция-из-бедолага-бот)        |

### 🧬 Быстрый старт миграции

```bash
# 1. Установить зависимости скриптов (один раз)
cd scripts && npm install && cd ..

# 2a. Миграция из старой Flask-панели
OLD_DB_HOST=localhost OLD_DB_NAME=stealthnet_old \
NEW_DB_HOST=localhost NEW_DB_NAME=stealthnet \
node scripts/migrate-from-old-panel.js

# 2b. Миграция из Бедолаги (путь к бэкапу)
node scripts/migrate-from-bedolaga.js ./backup_20260126_000000.tar.gz
```

> Валюта определяется автоматически из настроек системы (`default_currency`).  
> Скрипты идемпотентные — можно запускать повторно без риска дублей.  
> Полная документация, переменные, FAQ — в **[MIGRATION.md](MIGRATION.md)**.

---

## 💬 Поддержка и сообщество

Вопросы, предложения, баг-репорты — всё сюда:

<p align="center">
  <a href="https://t.me/stealthnet_admin_panel"><img src="https://img.shields.io/badge/Telegram-@stealthnet__admin__panel-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram канал" /></a>
</p>

---

## 📜 Лицензия

Проект распространяется под лицензией **GNU AGPL-3.0**.

<p align="center">
  <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg" alt="License-AGPL" /></a>
</p>

Полный текст лицензии — в файле [LICENSE](../../LICENSE). При использовании, модификации и распространении кода необходимо соблюдать условия AGPL-3.0 (в т.ч. раскрытие исходного кода производных работ при использовании в сетевом сервисе).

---

<p align="center">
  <b>STEALTHNET 3.0</b> — продавай VPN красиво.<br/>
  <sub>Создано с помощью TypeScript, React, Grammy, Prisma, Docker</sub><br/><br/>
</p>
