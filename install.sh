#!/usr/bin/env bash
set -euo pipefail

# ╔═══════════════════════════════════════════════════════════════╗
# ║          STEALTHNET v3 — Автоустановщик                       ║
# ╚═══════════════════════════════════════════════════════════════╝

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ── Цвета ─────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

banner() {
  echo ""
  echo -e "${CYAN}${BOLD}"
  echo "  ███████╗████████╗███████╗ █████╗ ██╗  ████████╗██╗  ██╗"
  echo "  ██╔════╝╚══██╔══╝██╔════╝██╔══██╗██║  ╚══██╔══╝██║  ██║"
  echo "  ███████╗   ██║   █████╗  ███████║██║     ██║   ███████║"
  echo "  ╚════██║   ██║   ██╔══╝  ██╔══██║██║     ██║   ██╔══██║"
  echo "  ███████║   ██║   ███████╗██║  ██║███████╗██║   ██║  ██║"
  echo "  ╚══════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚══════╝╚═╝   ╚═╝  ╚═╝"
  echo -e "                         ${YELLOW}v3${NC}"
  echo -e "  ${NC}github.com/STEALTHNET-APP/remnawave-STEALTHNET-Bot${NC}"
  echo ""
}

info()    { echo -e "${CYAN}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; }

ask() {
  local prompt="$1" default="$2" var="$3"
  if [ -n "$default" ]; then
    read -rp "$(echo -e "${BOLD}$prompt${NC} [${default}]: ")" input
    eval "$var=\"\${input:-$default}\""
  else
    read -rp "$(echo -e "${BOLD}$prompt${NC}: ")" input
    eval "$var=\"\$input\""
  fi
}

ask_secret() {
  local prompt="$1" default="$2" var="$3"
  if [ -n "$default" ]; then
    read -rsp "$(echo -e "${BOLD}$prompt${NC} [***]: ")" input
    echo ""
    eval "$var=\"\${input:-$default}\""
  else
    read -rsp "$(echo -e "${BOLD}$prompt${NC}: ")" input
    echo ""
    eval "$var=\"\$input\""
  fi
}

# ── Проверка зависимостей ─────────────────────────────────────────
check_deps() {
  info "Проверка зависимостей..."

  if ! command -v docker &>/dev/null; then
    error "Docker не установлен!"
    echo ""
    echo "  Установите Docker:"
    echo "  curl -fsSL https://get.docker.com | sh"
    echo ""
    exit 1
  fi

  if ! docker compose version &>/dev/null 2>&1; then
    error "Docker Compose V2 не найден!"
    echo "  Обновите Docker или установите docker-compose-plugin"
    exit 1
  fi

  success "Docker $(docker --version | grep -oP '\d+\.\d+\.\d+') найден"
  success "Docker Compose $(docker compose version --short 2>/dev/null || echo 'OK')"
}

# ── Очистка старых данных (НОВОЕ) ─────────────────────────────────
clean_old_data() {
  echo ""
  echo -e "${BOLD}${CYAN}═══ Очистка ═══${NC}"
  
  warn "Хотите выполнить чистую установку?"
  echo -e "  Это действие выполнит:"
  echo -e "  1. Остановку текущих контейнеров."
  echo -e "  2. ${RED}Удаление базы данных${NC} (решает проблему с паролем)."
  echo -e "  3. Удаление старых образов и кеша этого проекта."
  echo ""
  echo -e "  ${YELLOW}При повторной установке: если оставить старую БД (N), пароль и пользователь"
  echo -e "  в .env должны совпадать с теми, с которыми БД была создана ранее. Иначе будет"
  echo -e "  ошибка «Authentication failed» (P1000). В таком случае выберите «y».${NC}"
  echo ""
  
  read -rp "$(echo -e "${BOLD}Удалить старые данные и БД? [y/N]${NC}: ")" CLEANUP
  if [[ "$CLEANUP" =~ ^[Yy]$ ]]; then
    info "Очистка системы..."
    
    # 1. Удаляем всё, что относится к docker-compose.yml
    # -v: удаляет Volumes (базу данных)
    # --rmi local: удаляет собранные образы
    # --remove-orphans: удаляет мусорные контейнеры
    docker compose down -v --rmi local --remove-orphans 2>/dev/null || true
    
    # 2. Дополнительно подчищаем неиспользуемые тома (те самые хеши)
    # prune -f не спрашивает подтверждения
    docker volume prune -f
    
    success "Система полностью очищена. Начинаем с чистого листа."
  else
    info "Очистка пропущена. Старая база данных будет сохранена."
  fi
}

# ── Интерактивная настройка .env ──────────────────────────────────
configure_env() {
  echo ""
  echo -e "${BOLD}${CYAN}═══ Настройка проекта ═══${NC}"
  echo ""

  # Домен
  ask "Введите домен StealthNet панели (например web.example.com), не Remnawave панели!" "" DOMAIN
  while [ -z "$DOMAIN" ]; do
    warn "Домен обязателен!"
    ask "Введите домен" "" DOMAIN
  done

  echo ""
  echo -e "${BOLD}${CYAN}── PostgreSQL ──${NC}"
  ask "Имя базы данных" "stealthnet" POSTGRES_DB
  ask "Пользователь БД" "stealthnet" POSTGRES_USER

  # Генерируем пароль без =, +, / — иначе ломается .env и DATABASE_URL
  DEFAULT_PG_PASS=$(openssl rand -base64 18 2>/dev/null | tr -d $'=+/\n' | head -c 24)
  [ -z "$DEFAULT_PG_PASS" ] && DEFAULT_PG_PASS=$(head -c 24 /dev/urandom | base64 | tr -d $'=+/\n' | head -c 24)
  ask_secret "Пароль БД (Enter = сгенерировать)" "$DEFAULT_PG_PASS" POSTGRES_PASSWORD

  echo ""
  echo -e "${BOLD}${CYAN}── JWT ──${NC}"
  DEFAULT_JWT=$(openssl rand -base64 36 2>/dev/null | tr -d $'=+/\n' | head -c 48)
  [ -z "$DEFAULT_JWT" ] && DEFAULT_JWT=$(head -c 48 /dev/urandom | base64 | tr -d $'=+/\n' | head -c 48)
  ask_secret "JWT Secret (Enter = сгенерировать)" "$DEFAULT_JWT" JWT_SECRET
  ask "Время жизни access-токена" "15m" JWT_ACCESS_EXPIRES_IN
  ask "Время жизни refresh-токена" "7d" JWT_REFRESH_EXPIRES_IN

  echo ""
  echo -e "${BOLD}${CYAN}── Админ ──${NC}"
  ask "Email администратора" "admin@stealthnet.local" INIT_ADMIN_EMAIL
  DEFAULT_ADMIN_PASS=$(openssl rand -base64 14 2>/dev/null | tr -d $'=+/\n' | head -c 20)
  [ -z "$DEFAULT_ADMIN_PASS" ] && DEFAULT_ADMIN_PASS=$(head -c 20 /dev/urandom | base64 | tr -d $'=+/\n' | head -c 20)
  ask_secret "Пароль администратора (Enter = сгенерировать)" "$DEFAULT_ADMIN_PASS" INIT_ADMIN_PASSWORD

  echo ""
  echo -e "${BOLD}${CYAN}── Remnawave ──${NC}"
  ask "URL панели Remnawave (например https://panel.example.com)" "" REMNA_API_URL
  if [ -n "$REMNA_API_URL" ]; then
    ask_secret "Токен Remnawave API (Из панели Remnawave)" "" REMNA_ADMIN_TOKEN
    echo ""
    echo -e "  ${YELLOW}Если Remnawave установлена через eGames reverse-proxy, укажите cookie-ключ.${NC}"
    echo -e "  ${YELLOW}Формат: имя:значение (из nginx-конфигурации панели). Пусто — если не используете eGames.${NC}"
    ask "eGames Secret Key (Enter = пропустить)" "" REMNA_SECRET_KEY
  else
    REMNA_ADMIN_TOKEN=""
    REMNA_SECRET_KEY=""
  fi

  echo ""
  echo -e "${BOLD}${CYAN}── Telegram Bot ──${NC}"
  ask "Токен бота от @BotFather" "" BOT_TOKEN
  if [ -z "$BOT_TOKEN" ]; then
    warn "Токен бота не указан — бот не сможет запуститься. Токен можно добавить позже в .env"
  fi

  echo ""
  echo -e "${BOLD}${CYAN}── Nginx ──${NC}"
  echo ""
  echo -e "  ${BOLD}1)${NC} Встроенный nginx + авто-SSL (Let's Encrypt) — рекомендуется"
  echo -e "  ${BOLD}2)${NC} Свой nginx / Caddy / reverse proxy — я настрою сам"
  echo ""
  read -rp "$(echo -e "${BOLD}Выберите [1/2]${NC} [1]: ")" NGINX_CHOICE
  NGINX_CHOICE="${NGINX_CHOICE:-1}"

  USE_BUILTIN_NGINX="true"
  CERTBOT_EMAIL=""
  if [ "$NGINX_CHOICE" = "1" ]; then
    USE_BUILTIN_NGINX="true"
    ask "Email для Let's Encrypt" "$INIT_ADMIN_EMAIL" CERTBOT_EMAIL
  else
    USE_BUILTIN_NGINX="false"
    echo ""
    info "Пример конфигурации nginx: ${BOLD}nginx/external.conf.example${NC}"
    info "API будет на порту 5000, фронтенд в ./frontend/dist/"
  fi

  # Записываем .env
  cat > "$SCRIPT_DIR/.env" << ENVEOF
# STEALTHNET v3 — сгенерировано install.sh $(date '+%Y-%m-%d %H:%M')
DOMAIN=$DOMAIN

# PostgreSQL
POSTGRES_DB=$POSTGRES_DB
POSTGRES_USER=$POSTGRES_USER
POSTGRES_PASSWORD=$POSTGRES_PASSWORD

# JWT
JWT_SECRET=$JWT_SECRET
JWT_ACCESS_EXPIRES_IN=$JWT_ACCESS_EXPIRES_IN
JWT_REFRESH_EXPIRES_IN=$JWT_REFRESH_EXPIRES_IN

# Admin
INIT_ADMIN_EMAIL=$INIT_ADMIN_EMAIL
INIT_ADMIN_PASSWORD=$INIT_ADMIN_PASSWORD

# Remnawave
REMNA_API_URL=$REMNA_API_URL
REMNA_ADMIN_TOKEN=$REMNA_ADMIN_TOKEN
# eGames reverse-proxy cookie (format: name:value). Leave empty if not using eGames.
REMNA_SECRET_KEY=$REMNA_SECRET_KEY

# Telegram Bot
BOT_TOKEN=$BOT_TOKEN

# Nginx
USE_BUILTIN_NGINX=$USE_BUILTIN_NGINX
CERTBOT_EMAIL=$CERTBOT_EMAIL
ENVEOF

  success "Файл .env создан"
}

# ── Генерация nginx.conf из шаблона ──────────────────────────────
generate_nginx_conf() {
  info "Генерация nginx.conf для домена $DOMAIN ..."
  sed "s/REPLACE_DOMAIN/$DOMAIN/g" "$SCRIPT_DIR/nginx/nginx.conf.template" \
    > "$SCRIPT_DIR/nginx/nginx.conf"
  success "nginx/nginx.conf сгенерирован"
}

generate_nginx_initial() {
  info "Генерация начального nginx.conf (HTTP only, для certbot)..."
  sed "s/REPLACE_DOMAIN/$DOMAIN/g" "$SCRIPT_DIR/nginx/nginx-initial.conf" \
    > "$SCRIPT_DIR/nginx/nginx.conf"
  success "nginx/nginx.conf (HTTP-only) сгенерирован"
}

# ── Получение SSL сертификата ────────────────────────────────────
obtain_ssl() {
  info "Получение SSL-сертификата от Let's Encrypt..."

  # ── 0. Pre-flight: проверяем что порт 80 не занят другим процессом ──
  # Если на хосте уже что-то слушает 80 (системный nginx/apache/etc.) — docker
  # compose не сможет забиндить порт, и certbot никогда не достучится по challenge'у.
  # Lets the user fix the conflict ДО долгого ожидания certbot timeout.
  if command -v ss >/dev/null 2>&1; then
    PORT80_USER=$(ss -tlnp 2>/dev/null | awk '$4 ~ /:80$/ {for (i=1; i<=NF; i++) if ($i ~ /users:/) {sub(/.*pid=/, "", $i); sub(/,.*/, "", $i); print $i; exit}}')
    if [ -n "$PORT80_USER" ]; then
      # Это может быть сам наш docker-proxy (после перезапуска install.sh) — проверим что это НЕ docker.
      PORT80_CMD=$(ps -p "$PORT80_USER" -o comm= 2>/dev/null || echo "")
      if [ -n "$PORT80_CMD" ] && [ "$PORT80_CMD" != "docker-proxy" ] && [ "$PORT80_CMD" != "containerd-shim" ]; then
        warn "Порт 80 уже занят процессом '$PORT80_CMD' (PID $PORT80_USER). Docker не сможет биндить порт, certbot не получит сертификат."
        echo "  Остановите конфликтующий процесс (например 'sudo systemctl stop nginx' / 'sudo systemctl stop apache2') и повторите."
        exit 1
      fi
    fi
  fi

  # 1. Запускаем nginx с HTTP-only конфигом
  generate_nginx_initial

  info "Запуск nginx (HTTP-only) для ACME-challenge..."
  docker compose --profile builtin-nginx up -d nginx 2>&1 | tail -5

  # ── Ожидание готовности nginx ──
  # Раньше было `sleep 3` — на медленных VPS этого мало, certbot стартовал
  # пока nginx ещё не поднял listen, и Lets Encrypt получал connection refused.
  # Теперь опросом ждём пока nginx начнёт отвечать на 80 (до 30 секунд).
  info "Ждём готовности nginx (до 30 сек)..."
  i=0
  while [ $i -lt 30 ]; do
    if curl -sf --max-time 2 -o /dev/null "http://127.0.0.1/" 2>/dev/null \
       || curl -sf --max-time 2 -o /dev/null "http://127.0.0.1/.well-known/acme-challenge/test" 2>/dev/null; then
      break
    fi
    # любой ответ от nginx (даже 404) показывает что он готов
    code=$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1/" 2>/dev/null || echo 000)
    if [ "$code" != "000" ]; then break; fi
    sleep 1
    i=$((i+1))
  done
  if [ $i -ge 30 ]; then
    warn "nginx не ответил за 30 сек. Проверяю что биндинг порта работает:"
    ss -tlnp 2>/dev/null | grep ':80' || true
    docker logs stealthnet-nginx --tail 20 2>&1 || true
  else
    success "nginx готов (через ${i} сек), запускаю certbot"
  fi

  # ── Проверки которые часто вызывают баги: docker iptables, firewalld, DOCKER-USER ──
  if [ -f /etc/docker/daemon.json ] && grep -q '"iptables".*false' /etc/docker/daemon.json 2>/dev/null; then
    warn "В /etc/docker/daemon.json установлено iptables:false — Docker НЕ создаёт DNAT правил и порт 80 не доступен извне. Удалите эту опцию."
  fi
  if command -v iptables >/dev/null 2>&1; then
    DROP_IN_DOCKER_USER=$(iptables -L DOCKER-USER -nv 2>/dev/null | awk 'NR>2 && $3 == "DROP" {c++} END{print c+0}')
    if [ "${DROP_IN_DOCKER_USER:-0}" -gt 0 ]; then
      warn "В iptables цепочке DOCKER-USER найдены DROP правила — они могут блокировать входящий трафик к контейнерам. Проверьте: 'iptables -L DOCKER-USER -nv'"
    fi
  fi
  if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet firewalld 2>/dev/null; then
    warn "Активен firewalld — он часто конфликтует с docker iptables. Если certbot упадёт — добавьте порт: 'firewall-cmd --add-port=80/tcp --permanent && firewall-cmd --reload'"
  fi

  # ── Внешняя проверка достижимости через сторонний прокси ──
  # Кладём тестовый файл в /var/www/certbot/.well-known/acme-challenge/, дёргаем
  # его через https://api.allorigins.win/raw?url=... — если ответ совпадает
  # с тем что положили, значит challenge будет доступен Lets Encrypt.
  TEST_TOKEN="install-test-$(date +%s)-$$"
  TEST_NAME="install-test-$(date +%s)"
  docker compose --profile builtin-nginx exec -T nginx sh -c "mkdir -p /var/www/certbot/.well-known/acme-challenge/ && echo '$TEST_TOKEN' > /var/www/certbot/.well-known/acme-challenge/$TEST_NAME" 2>/dev/null || true
  info "Внешняя проверка достижимости challenge через allorigins.win..."
  EXT_RESP=$(curl -sf --max-time 15 "https://api.allorigins.win/raw?url=http%3A%2F%2F${DOMAIN}%2F.well-known%2Facme-challenge%2F${TEST_NAME}" 2>/dev/null || echo "")
  if [ "$EXT_RESP" = "$TEST_TOKEN" ]; then
    success "Challenge доступен извне ✓ (получен правильный ответ через прокси)"
  else
    warn "Challenge НЕ доступен извне — Lets Encrypt не сможет проверить домен."
    echo "  Ожидался: '$TEST_TOKEN'"
    echo "  Получено: '$EXT_RESP'"
    echo "  Возможные причины:"
    echo "  • DNS A-запись для $DOMAIN не указывает на этот сервер ($(curl -s --max-time 3 https://api.ipify.org 2>/dev/null || echo 'IP не определён'))"
    echo "  • Хостинг блокирует входящий 80 порт на уровне VPS (проверьте панель управления)"
    echo "  • Firewall: ufw / iptables / firewalld режет 80"
    echo "  Certbot всё равно попробуется — но скорее всего тоже упадёт."
  fi

  # 2. Запускаем certbot — webroot режим (через nginx)
  info "Запуск certbot (webroot)..."
  CERTBOT_OK=0
  docker compose --profile builtin-nginx run --rm --entrypoint certbot certbot \
    certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email "$CERTBOT_EMAIL" \
    --agree-tos \
    --no-eff-email \
    -d "$DOMAIN" \
    --force-renewal 2>&1 && CERTBOT_OK=1

  # ── Fallback: standalone режим если webroot не сработал ──
  # Например, если nginx не отдаёт challenge файлы по какой-то причине, или
  # маппинг порта в docker-compose битый — standalone режим certbot biндит
  # 80 порт прямо в своём контейнере (а наш nginx надо остановить).
  if [ "$CERTBOT_OK" = "0" ]; then
    warn "webroot режим не сработал, пробую --standalone (certbot забиндит 80 сам)..."
    docker compose --profile builtin-nginx stop nginx 2>/dev/null || true
    sleep 2
    docker compose --profile builtin-nginx run --rm --service-ports --entrypoint certbot certbot \
      certonly \
      --standalone \
      --email "$CERTBOT_EMAIL" \
      --agree-tos \
      --no-eff-email \
      -d "$DOMAIN" \
      --force-renewal 2>&1 && CERTBOT_OK=1
  fi

  if [ "$CERTBOT_OK" = "0" ]; then
    error "Не удалось получить SSL-сертификат ни через webroot, ни через standalone!"
    echo ""
    echo "  Проверьте:"
    echo "  1. DNS-запись A для $DOMAIN указывает на этот сервер ($(curl -s https://api.ipify.org 2>/dev/null || echo IP-не-определён))"
    echo "  2. Порты 80 и 443 открыты в фаерволе (ufw allow 80,443/tcp)"
    echo "  3. Домен $DOMAIN доступен извне (можно проверить из другой сети)"
    echo "  4. Если у вас уже работает свой системный nginx/apache на 80 — выберите режим '2) Свой nginx' в install.sh"
    echo ""
    echo "  Текущее состояние портов:"
    ss -tlnp 2>/dev/null | grep -E ':80|:443' || echo "  ничего не слушает 80/443"
    echo ""
    echo "  После исправления запустите: bash install.sh"
    exit 1
  fi

  success "SSL-сертификат получен"

  # 3. Останавливаем nginx, генерируем полный конфиг с SSL
  docker compose --profile builtin-nginx stop nginx 2>/dev/null || true
  generate_nginx_conf
}

# ── Сборка и запуск ──────────────────────────────────────────────
build_and_start() {
  echo ""
  echo -e "${BOLD}${CYAN}═══ Сборка проекта ═══${NC}"
  echo ""

  # Определяем compose profiles
  PROFILES=""
  if [ "$USE_BUILTIN_NGINX" = "true" ]; then
    PROFILES="--profile builtin-nginx"
  fi

  # Сборка
  info "Сборка Docker-образов (это может занять несколько минут)..."
  docker compose $PROFILES build 2>&1 | tail -5
  success "Образы собраны"

  # Запуск БД
  info "Запуск PostgreSQL..."
  docker compose up -d postgres
  echo "  Ожидание готовности БД..."
  sleep 5

  # Запуск API
  info "Запуск Backend API..."
  docker compose up -d api
  sleep 3

  # Запуск бота (если токен указан)
  if [ -n "$BOT_TOKEN" ]; then
    info "Запуск Telegram Bot..."
    docker compose up -d bot
  else
    warn "BOT_TOKEN не указан — бот не запущен"
  fi

  # Сборка фронтенда
  info "Сборка фронтенда..."
  docker compose up frontend 2>&1 | tail -3

  # Nginx
  if [ "$USE_BUILTIN_NGINX" = "true" ]; then
    info "Запуск Nginx..."
    docker compose $PROFILES up -d nginx
    
    info "Запуск Certbot (авто-обновление)..."
    docker compose $PROFILES up -d certbot
  else
    # При внешнем nginx — копируем dist в нужную папку
    info "Копирование фронтенда в /var/www/stealthnet..."
    sudo mkdir -p /var/www/stealthnet
    docker compose cp frontend:/dist/. /var/www/stealthnet/ 2>/dev/null || {
      # Fallback: копируем из volume
      docker run --rm -v stealthnet_frontend_dist:/src -v /var/www/stealthnet:/dst alpine sh -c "cp -r /src/* /dst/"
    }
    success "Фронтенд скопирован в /var/www/stealthnet/"
  fi
}

# ── Финальная проверка ───────────────────────────────────────────
show_status() {
  echo ""
  echo -e "${BOLD}${CYAN}═══ Статус ═══${NC}"
  echo ""
  docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || docker compose ps
  echo ""
}

show_summary() {
  echo ""
  echo -e "${GREEN}${BOLD}╔═══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}${BOLD}║          STEALTHNET v3 — Установка завершена!                 ║${NC}"
  echo -e "${GREEN}${BOLD}╚═══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  ${BOLD}Панель:${NC}      https://$DOMAIN/admin"
  echo -e "  ${BOLD}Кабинет:${NC}     https://$DOMAIN/cabinet"
  echo -e "  ${BOLD}Администратор:${NC}       $INIT_ADMIN_EMAIL / $INIT_ADMIN_PASSWORD"
  echo ""
  if [ -n "$BOT_TOKEN" ]; then
    echo -e "  ${BOLD}Telegram Bot:${NC} запущен"
  else
    echo -e "  ${YELLOW}Telegram Bot:${NC} не настроен, добавьте BOT_TOKEN в .env"
  fi
  echo ""
  if [ "$USE_BUILTIN_NGINX" != "true" ]; then
    echo -e "  ${YELLOW}Nginx:${NC} Настройте свой reverse proxy"
    echo -e "  Пример конфига: ${BOLD}nginx/external.conf.example${NC}"
    echo -e "  API порт: ${BOLD}5000${NC}"
    echo -e "  Фронтенд: ${BOLD}/var/www/stealthnet/${NC}"
    echo ""
  fi
  echo -e "  ${BOLD}Команды:${NC}"
  echo "    docker compose ps                  — статус"
  echo "    docker compose logs -f api         — логи API"
  echo "    docker compose logs -f bot         — логи бота"
  echo "    docker compose restart api bot     — перезапуск"
  echo "    docker compose down                — остановить всё"
  echo "    docker compose up -d               — запустить всё"
  echo ""
}

# ── Основной поток ───────────────────────────────────────────────
main() {
  banner
  check_deps

  # Если .env уже есть — спрашиваем
  if [ -f "$SCRIPT_DIR/.env" ]; then
    echo ""
    warn "Файл .env уже существует!"
    read -rp "$(echo -e "${BOLD}Перезаписать? [y/N]${NC}: ")" OVERWRITE
    if [[ "$OVERWRITE" =~ ^[Yy]$ ]]; then
      configure_env
    else
      info "Используем существующий .env"
      # Загружаем переменные
      set -a
      source "$SCRIPT_DIR/.env"
      set +a
    fi
  else
    configure_env
  fi

  # Загружаем .env
  set -a
  source "$SCRIPT_DIR/.env"
  set +a

  # !!! ДОБАВЛЕННЫЙ ШАГ: Спрашиваем про очистку !!!
  clean_old_data

  # SSL + nginx
  if [ "$USE_BUILTIN_NGINX" = "true" ]; then
    obtain_ssl
  fi

  build_and_start
  show_status
  show_summary
}

main "$@"
