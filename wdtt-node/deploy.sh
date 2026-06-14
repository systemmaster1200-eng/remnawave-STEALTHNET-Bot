#!/bin/bash
# WDTT Node Deploy Script
# Usage: ./deploy.sh [install|update|status|logs|stop]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[WDTT]${NC} $1"; }
warn() { echo -e "${YELLOW}[WDTT]${NC} $1"; }
error() { echo -e "${RED}[WDTT]${NC} $1"; exit 1; }

check_env() {
    if [ ! -f "$ENV_FILE" ]; then
        error "Файл .env не найден. Скопируйте .env.example в .env и заполните значения."
    fi
    source "$ENV_FILE"
    
    if [ "$MAIN_PASSWORD" = "changeme" ] || [ -z "$MAIN_PASSWORD" ]; then
        error "MAIN_PASSWORD не установлен. Отредактируйте .env"
    fi
    
    if [ -z "$API_KEY" ]; then
        warn "API_KEY не установлен. Генерирую автоматически..."
        API_KEY=$(openssl rand -hex 32)
        sed -i "s/^API_KEY=.*/API_KEY=$API_KEY/" "$ENV_FILE"
        log "API_KEY: $API_KEY"
    fi
}

install() {
    log "Установка WDTT ноды..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        error "Docker не установлен. Установите: curl -fsSL https://get.docker.com | sh"
    fi
    
    if ! docker compose version &> /dev/null 2>&1; then
        error "Docker Compose не установлен."
    fi
    
    check_env
    
    log "Сборка Docker образа..."
    cd "$SCRIPT_DIR"
    docker compose build --no-cache
    
    log "Запуск контейнера..."
    docker compose up -d
    
    log "Ожидание запуска..."
    sleep 3
    
    # Health check
    if curl -sf "http://localhost:${API_PORT:-9000}/api/health" -H "X-API-Key: $API_KEY" > /dev/null 2>&1; then
        log "✅ WDTT нода запущена и работает!"
        log ""
        log "API Endpoint: http://localhost:${API_PORT:-9000}"
        log "DTLS Port: ${DTLS_PORT:-56000}"
        log "WG Port: ${WG_PORT:-56001}"
        log "API Key: $API_KEY"
        log ""
        log "Для проверки: curl http://localhost:${API_PORT:-9000}/api/health -H 'X-API-Key: $API_KEY'"
    else
        warn "Контейнер запущен, но health check не прошёл. Проверьте логи:"
        warn "docker compose logs"
    fi
}

update() {
    log "Обновление WDTT ноды..."
    cd "$SCRIPT_DIR"
    docker compose pull
    docker compose build --no-cache
    docker compose up -d
    log "✅ Обновлено!"
}

status() {
    cd "$SCRIPT_DIR"
    docker compose ps
    echo ""
    
    check_env
    if curl -sf "http://localhost:${API_PORT:-9000}/api/health" -H "X-API-Key: $API_KEY" > /dev/null 2>&1; then
        log "✅ API доступен"
        curl -s "http://localhost:${API_PORT:-9000}/api/health" | jq .
    else
        warn "❌ API недоступен"
    fi
}

logs() {
    cd "$SCRIPT_DIR"
    docker compose logs -f --tail=50
}

stop() {
    cd "$SCRIPT_DIR"
    docker compose down
    log "Остановлено"
}

case "${1:-install}" in
    install) install ;;
    update) update ;;
    status) status ;;
    logs) logs ;;
    stop) stop ;;
    *)
        echo "Usage: $0 {install|update|status|logs|stop}"
        exit 1
        ;;
esac
