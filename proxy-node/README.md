# Прокси-нода STEALTHNET

Контейнер для запуска на сервере админа. Регистрируется в панели по токену, шлёт heartbeat, получает список слотов (логин/пароль) для генерации конфига прокси.

## Переменные окружения

- `STEALTHNET_API_URL` — URL API панели (например https://panel.example.com)
- `PROXY_NODE_TOKEN` — токен ноды (из админки «Добавить прокси»)
- `SOCKS_PORT` — порт SOCKS5 (по умолчанию 1080)
- `HTTP_PORT` — порт HTTP-прокси (по умолчанию 8080)
- `LOG_PATH` — путь к логу 3proxy для учёта трафика (по умолчанию рядом с конфигом: `3proxy.log`). Агент парсит лог и отправляет трафик в heartbeat.

## API агента

1. **POST** `{API_URL}/api/proxy-nodes/register`  
   Заголовок: `X-Proxy-Node-Token: <token>`  
   Тело (опционально): `{ "name": "...", "socksPort": 1080, "httpPort": 8080 }`  
   Ответ: `{ "nodeId": "...", "pollIntervalSec": 60 }`

2. **POST** `{API_URL}/api/proxy-nodes/:nodeId/heartbeat`  
   Заголовок: `X-Proxy-Node-Token: <token>`  
   Тело: `{ "connections": 0, "trafficIn": 0, "trafficOut": 0, "slots": [{ "slotId": "...", "trafficUsed": 0, "connections": 0 }] }`

3. **GET** `{API_URL}/api/proxy-nodes/:nodeId/slots`  
   Заголовок: `X-Proxy-Node-Token: <token>`  
   Ответ: `{ "slots": [{ "id", "login", "password", "expiresAt", "trafficLimitBytes", "connectionLimit" }] }`

## Сборка образа

Из корня репозитория (для Dockerfile с путями `proxy-node/...`):

```bash
docker build -f proxy-node/Dockerfile -t stealthnet/proxy-node:latest .
```

Далее используйте docker-compose из админки (образ уже указан как `stealthnet/proxy-node:latest`).

## Реализация (Phase 1.5)

Образ включает **агент** и **3proxy**. Агент регистрируется, шлёт heartbeat и по GET /slots получает список слотов; по нему генерирует файл пользователей (`login:CL:password`) и конфиг 3proxy, затем запускает/перезапускает 3proxy. Доступны SOCKS5 (по умолчанию 1080) и HTTP-прокси (8080). Клиенты подключаются по выданным логин/пароль.

**Трафик и подключения:** 3proxy пишет лог в файл (формат `L %U %I %O`). Агент читает новые строки, суммирует байты по логину и по ноде и отправляет в heartbeat (`trafficIn`, `trafficOut`, `slots[].trafficUsed`). В панели отображаются «Трафик» и «Подключения» по ноде; текущее число подключений пока 0 (для него нужен отдельный источник в 3proxy).
