# Sing-box node agent (STEALTHNET)

Агент для sing-box ноды: регистрация в панели, heartbeat, получение слотов и кастомного конфига из API, генерация конфига sing-box (JSON) и запуск процесса sing-box.

## Переменные окружения

| Переменная | Описание |
|------------|----------|
| `STEALTHNET_API_URL` | URL панели (обязательно) |
| `SINGBOX_NODE_TOKEN` | Токен ноды из админки (обязательно) |
| `PROTOCOL` | VLESS \| SHADOWSOCKS \| TROJAN \| HYSTERIA2 (по умолчанию VLESS) |
| `PORT` | Порт инбаунда (по умолчанию 443) |
| `TLS_ENABLED` | 1 или 0 (по умолчанию 1) |
| `CONFIG_PATH` | Путь к файлу конфига (по умолчанию /app/config.json) |
| `POLL_INTERVAL_SEC` | Интервал опроса слотов и heartbeat в секундах (по умолчанию 60) |

## Поведение

1. При старте — регистрация по токену (`POST /api/singbox-nodes/register`).
2. Каждые N секунд — запрос слотов (`GET /api/singbox-nodes/:id/slots`): список пользователей, а также при наличии кастомный конфиг ноды (`customConfigJson`).
3. Если в панели задан кастомный конфиг — агент подставляет в инбаунд с тегом `stealthnet-in` массив `users` из слотов. Иначе собирается минимальный конфиг по протоколу ноды.
4. Конфиг записывается в файл, sing-box перезапускается.
5. Отправляется heartbeat с метриками (трафик/подключения пока можно передавать нулями).

## Сборка и запуск

Из корня репозитория:

```bash
docker build -f singbox-node/Dockerfile -t stealthnet/singbox-node:latest .
docker run -d \
  -e STEALTHNET_API_URL=https://your-panel.example.com \
  -e SINGBOX_NODE_TOKEN=your-token-from-admin \
  -e PROTOCOL=VLESS \
  -e PORT=443 \
  -p 443:443 \
  --restart unless-stopped \
  stealthnet/singbox-node:latest
```

Образ включает бинарник sing-box (Linux amd64) из релизов [SagerNet/sing-box](https://github.com/SagerNet/sing-box).
