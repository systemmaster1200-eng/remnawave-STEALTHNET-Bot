#!/usr/bin/env bash
cd "$(dirname "$0")"
BOT_DIR="$(pwd)"

# Останавливаем только процессы бота (не Docker-бэкенд) по PID-файлу
if [ -f /tmp/stealthnet-bot.pid ]; then
  OLD_PID=$(cat /tmp/stealthnet-bot.pid)
  if kill -0 "$OLD_PID" 2>/dev/null; then
    kill "$OLD_PID" 2>/dev/null
    sleep 3
    if kill -0 "$OLD_PID" 2>/dev/null; then
      kill -9 "$OLD_PID" 2>/dev/null
      sleep 2
    fi
  fi
  rm -f /tmp/stealthnet-bot.pid
fi

# Убиваем всех node из директории бота (на случай если PID-файл потерялся)
for pid in $(pgrep -f "node dist/index.js" 2>/dev/null); do
  cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null)
  if [ "$cwd" = "$BOT_DIR" ]; then
    kill -9 "$pid" 2>/dev/null
  fi
done
sleep 2

nohup node dist/index.js >> /tmp/stealthnet-bot.log 2>&1 &
echo "$!" > /tmp/stealthnet-bot.pid
echo "Бот запущен (PID: $!). Лог: /tmp/stealthnet-bot.log"
