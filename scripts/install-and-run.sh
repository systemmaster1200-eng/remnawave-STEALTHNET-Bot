#!/usr/bin/env bash
# STEALTHNET 3.2.6 — установка зависимостей и запуск (выполнять в терминале, где есть node и docker)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Проверка Node.js и Docker ==="
command -v node >/dev/null 2>&1 || { echo "Установите Node.js: https://nodejs.org или nvm"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm не найден (должен быть с Node.js)"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Установите Docker Desktop: https://docker.com"; exit 1; }

echo "=== Backend: установка зависимостей ==="
cd "$ROOT/backend"
npm install
npx prisma generate

echo "=== Frontend: установка зависимостей ==="
cd "$ROOT/frontend"
npm install

echo "=== Запуск PostgreSQL ==="
cd "$ROOT"
docker compose up -d postgres

echo "Ожидание готовности PostgreSQL (5 сек)..."
sleep 5

echo "=== Миграция БД ==="
cd "$ROOT/backend"
npx prisma db push

echo "=== Запуск Backend (порт 5000) ==="
cd "$ROOT/backend"
npm run dev &
API_PID=$!

echo "=== Запуск Frontend (порт 5173) ==="
cd "$ROOT/frontend"
npm run dev &
FRONT_PID=$!

echo ""
echo "=========================================="
echo "  STEALTHNET v3 запущен"
echo "  Frontend:  http://localhost:5173"
echo "  API:       http://localhost:5000"
echo "  Логин:     admin@stealthnet.local"
echo "  Пароль:    admin123"
echo "=========================================="
echo "Остановка: kill $API_PID $FRONT_PID"
echo ""

wait $API_PID $FRONT_PID 2>/dev/null || true
