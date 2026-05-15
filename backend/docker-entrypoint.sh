#!/bin/sh
# Старт API: migrate deploy → node.
#
# Сценарии:
# 1) Обычный апгрейд: migrate deploy проходит — reconcile_schema_drift проверяет
#    что физическая схема совпадает со schema.prisma, и стартует node.
# 2) P3009 (зависшая failed-запись): resolve --rolled-back → снова deploy → reconcile.
# 3) P3005: БД с данными, но без истории Prisma — clone_bots при необходимости, drift
#    через psql lenient (ON_ERROR_STOP=0) → baseline всех миграций → deploy → reconcile.
# 4) Greenfield (только чистая установка): lexsort имён миграций ломает deploy на пустой БД
#    (раньше применяются инкременты без базовых таблиц). Тогда допустим ТОЛЬКО если в public
#    нет «настоящих» таблиц — только _prisma_migrations и/или pending_* — иначе это прод с
#    рассинхроном: автоматический DROP SCHEMA запрещён, нужен бэкап и ручной ремонт.
# 5) ⚠️ КРИТИЧЕСКИЙ КЕЙС: БД восстановили из старого бэкапа поверх свежего
#    `_prisma_migrations` (например через `pg_restore --data-only`). migrate deploy
#    говорит "no pending migrations", но физически таблицы (landing_theme,
#    marketplace_categories, ...) отсутствуют. reconcile_schema_drift вызывается
#    после КАЖДОГО успешного deploy'я и detect'ит этот рассинхрон по `migrate diff`.
# 7) ⚠️ КЕЙС P3018 ПОСЛЕ P3009 RECOVERY: миграция X была применена частично
#    (CREATE TABLE/ALTER успели), процесс упал → запись висит failed. После
#    `resolve --rolled-back` повторный deploy пытается СНОВА выполнить SQL и
#    падает на `column/relation X already exists` (P3018). Решение: detect
#    P3018+already-exists → `resolve --applied` (объекты уже в БД, миграция
#    фактически применена) → retry deploy. Итеративно для до 5 миграций
#    подряд в том же состоянии.
#
# 6) ⚠️ КЕЙС clone_bots SILENT-CORRUPTION: миграция `20260502160000_clone_bots`
#    помечена `applied` в `_prisma_migrations`, но физически SQL не выполнен
#    (например, `migrate resolve --applied` без накатывания файла). В `clients`
#    7к+ строк, но колонки `bot_id` нет, или есть пустая. Drift хочет
#    `ADD COLUMN bot_id TEXT NOT NULL` — psql падает на NOT NULL поверх данных,
#    `verify_drift_resolved` корректно даёт FATAL. Чтобы пользователь не звонил
#    вручную выполнять SQL, `rescue_clients_bot_id_pre_drift` лечит это сам:
#    создаёт primary bot из `BOT_TOKEN` env, добавляет колонку nullable, заполняет
#    значением, делает SET NOT NULL, добавляет индексы и FK. После этого
#    apply_sql_lenient видит «всё уже есть» и через verify drift пуст.
#
# Важно: drift применяется через psql ON_ERROR_STOP=0 (statement-by-statement),
# а НЕ через `prisma db execute` (один батч в транзакции — при первой ошибке
# 'already exists' откатывается ВСЁ, включая нужные CREATE TABLE).
#
# После любого drift apply верифицируем `migrate diff --exit-code`. Если осталась
# структурная drift (CREATE TABLE / ADD COLUMN / DROP) — fail hard, лучше явный
# отказ старта чем silent corruption.

set -eu
cd /app

log() {
  printf '%s\n' "[docker-entrypoint] $*"
}

# Применяет SQL по statement'ам через psql с ON_ERROR_STOP=0 — пропускает
# дубликаты ('already exists'/'duplicate'), но выполняет все остальные statement'ы.
# Это критично для drift SQL'я от prisma migrate diff: Prisma может включать
# `CREATE UNIQUE INDEX` для индексов, которые в Postgres автоматически создались
# вместе с UNIQUE constraint того же имени — `prisma db execute` падает в
# транзакции на первой такой строке и откатывает ВСЁ, включая нужные
# CREATE TABLE.
#
# Возвращает 0 всегда (ошибки видны в выводе psql; реальный успех проверяется
# отдельно через verify_drift_resolved).
apply_sql_lenient() {
  file="$1"
  if command -v psql >/dev/null 2>&1; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -X -q -f "$file" 2>&1 || true
    return 0
  fi
  # Fallback без psql: режем drift SQL по разделителям '-- (Create|Alter|Drop|Add)'
  # на отдельные части и применяем каждую через `prisma db execute` отдельно.
  # Дубликаты молча игнорим.
  log "psql отсутствует — пробую statement-by-statement через prisma db execute (slower fallback)"
  splitdir=$(mktemp -d)
  awk -v outdir="$splitdir" '
    BEGIN { n = 0 }
    /^-- (Create|Alter|Drop|Add)/ { n++ }
    { print > (outdir "/part." n) }
  ' "$file"
  for part in "$splitdir"/part.*; do
    [ -s "$part" ] || continue
    out=$(npx prisma db execute --url "$DATABASE_URL" --file "$part" 2>&1) || {
      if printf '%s' "$out" | grep -qiE 'already exists|duplicate (key|object|table|column|index)|relation .* already exists'; then
        :  # ok, дубликат — пропускаем
      else
        printf '%s\n' "$out" >&2
      fi
    }
  done
  rm -rf "$splitdir"
  return 0
}

# verify_drift_resolved — после apply_sql_lenient повторяет migrate diff и
# проверяет, остался ли drift. Различает два уровня остатка:
#   - benign:    только CREATE INDEX / ADD CONSTRAINT для объектов с тем же именем,
#                которые уже есть в БД (известная false-positive Prisma diff'а)
#   - structural: CREATE TABLE / ADD COLUMN / DROP TABLE / DROP COLUMN —
#                 значит lenient apply реально не смог накатать что-то критичное
#
# Возвращает:
#   0 — drift пуст или benign (ок, можно стартовать API)
#   1 — structural drift остался (FATAL, нельзя стартовать)
verify_drift_resolved() {
  drift_check=$(mktemp)
  if ! npx prisma migrate diff \
      --from-url "$DATABASE_URL" \
      --to-schema-datamodel prisma/schema.prisma \
      --script >"$drift_check" 2>/dev/null; then
    log "verify_drift_resolved: migrate diff упал — пропускаю верификацию"
    rm -f "$drift_check"
    return 0
  fi
  if ! [ -s "$drift_check" ] || ! grep -q '[^[:space:]]' "$drift_check"; then
    rm -f "$drift_check"
    return 0  # drift полностью устранён
  fi
  # Что-то осталось — анализируем степень опасности
  remaining_size=$(wc -c <"$drift_check" | tr -d ' ')
  if grep -qiE '^[[:space:]]*(CREATE TABLE|ALTER TABLE [^;]*ADD COLUMN|DROP TABLE|DROP COLUMN|ALTER TABLE [^;]*DROP)' "$drift_check"; then
    log "FATAL: после lenient apply остался structural drift (${remaining_size} байт):"
    cat "$drift_check" >&2
    rm -f "$drift_check"
    return 1
  fi
  log "verify_drift_resolved: остаточный drift — только INDEX/CONSTRAINT с уже существующими именами (benign Prisma false-positive), игнорирую"
  rm -f "$drift_check"
  return 0
}

# rescue_clients_bot_id_pre_drift — превентивно лечит сценарий 6 (clone_bots
# silent-corruption): если drift хочет добавить `clients.bot_id` NOT NULL, а в
# `clients` уже есть данные без bot_id — `apply_sql_lenient` упадёт на NOT NULL
# constraint и `verify_drift_resolved` даст FATAL. Эта функция выполняет
# rescue-сценарий, который делал бы человек руками:
#   1) Если `bots` пуст — создаём primary bot из `BOT_TOKEN` env (username
#      берётся через Telegram API getMe).
#   2) `ADD COLUMN bot_id TEXT` (nullable) если колонки ещё нет.
#   3) `UPDATE clients SET bot_id = <primary_bot.id>` для всех null'ов.
#   4) `ALTER COLUMN bot_id SET NOT NULL`.
#   5) Также добавляет смежные `telegram_unreachable`, индексы, FK
#      (всё с IF NOT EXISTS / DO-блоками — идемпотентно).
#
# После rescue последующий `apply_sql_lenient` увидит «всё уже есть» (дубликаты
# через ON_ERROR_STOP=0 пропустятся), а `verify_drift_resolved` подтвердит синк.
#
# Условия вызова: drift_file содержит ALTER на clients для bot_id NOT NULL.
# Безопасно: если триггера нет — функция сразу выходит, ничего не трогая.
rescue_clients_bot_id_pre_drift() {
  drift_file="$1"
  # Триггер: drift хочет ADD COLUMN bot_id NOT NULL в clients.
  if ! grep -qE 'ALTER TABLE "clients"[^;]*"bot_id"[^;]*NOT NULL' "$drift_file" 2>/dev/null \
       && ! grep -qE 'ALTER TABLE clients[^;]*bot_id[^;]*NOT NULL' "$drift_file" 2>/dev/null; then
    return 0
  fi
  if ! command -v psql >/dev/null 2>&1; then return 0; fi
  log "rescue_clients_bot_id: drift хочет clients.bot_id NOT NULL — проверяю состояние данных"

  # Есть ли таблица clients?
  has_clients=$(psql "$DATABASE_URL" -t -A -c "SELECT (to_regclass('public.clients') IS NOT NULL);" 2>/dev/null | tr -d '[:space:]')
  if [ "$has_clients" != "t" ]; then
    log "rescue_clients_bot_id: таблицы clients нет, rescue не нужен"
    return 0
  fi

  clients_count=$(psql "$DATABASE_URL" -t -A -c "SELECT count(*) FROM clients;" 2>/dev/null | tr -d '[:space:]')
  if [ "${clients_count:-0}" = "0" ]; then
    log "rescue_clients_bot_id: clients пуст — drift накатится без проблем"
    return 0
  fi

  # Гарантируем primary bot
  has_bots_table=$(psql "$DATABASE_URL" -t -A -c "SELECT (to_regclass('public.bots') IS NOT NULL);" 2>/dev/null | tr -d '[:space:]')
  if [ "$has_bots_table" != "t" ]; then
    log "rescue_clients_bot_id: нет таблицы bots — невозможно сделать rescue (clone_bots миграция не применена ВООБЩЕ)"
    return 1
  fi
  active_bots=$(psql "$DATABASE_URL" -t -A -c "SELECT count(*) FROM bots WHERE is_active = true;" 2>/dev/null | tr -d '[:space:]')
  if [ "${active_bots:-0}" = "0" ]; then
    if [ -z "${BOT_TOKEN:-}" ]; then
      log "rescue_clients_bot_id: bots пуст и BOT_TOKEN не установлен — не могу создать primary bot, добавьте BOT_TOKEN в .env и перезапустите"
      return 1
    fi
    log "rescue_clients_bot_id: bots пуст, создаю primary bot из BOT_TOKEN"
    bot_username="primary_bot"
    if command -v curl >/dev/null 2>&1; then
      tg_resp=$(curl -s --max-time 10 "https://api.telegram.org/bot${BOT_TOKEN}/getMe" 2>/dev/null || true)
      detected=$(printf '%s' "$tg_resp" | sed -nE 's/.*"username":"([^"]+)".*/\1/p')
      if [ -n "$detected" ]; then
        bot_username="$detected"
      fi
    fi
    log "rescue_clients_bot_id: bot username=$bot_username"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
      -v "bt=${BOT_TOKEN}" -v "bn=${bot_username}" <<'SQL' 2>&1 | sed 's/^/  /'
INSERT INTO bots (id, token, username, is_primary, is_active, markup_percent, created_at, updated_at)
SELECT 'rescue_' || replace(gen_random_uuid()::text, '-', ''),
       :'bt', :'bn', true, true, 0, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM bots WHERE is_active = true);
SQL
  fi

  primary_bot_id=$(psql "$DATABASE_URL" -t -A -c "SELECT id FROM bots WHERE is_active = true ORDER BY is_primary DESC, created_at LIMIT 1;" 2>/dev/null | tr -d '[:space:]')
  if [ -z "$primary_bot_id" ]; then
    log "rescue_clients_bot_id: не удалось определить primary bot id — abort"
    return 1
  fi
  log "rescue_clients_bot_id: primary bot id = $primary_bot_id"

  # Применяем rescue SQL (идемпотентный)
  log "rescue_clients_bot_id: применяю DDL — ADD COLUMN bot_id, UPDATE, SET NOT NULL, индексы, FK"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=0 \
    -v "pb=${primary_bot_id}" <<'SQL' 2>&1 | grep -vE '^\s*$' | sed 's/^/  /'
ALTER TABLE clients ADD COLUMN IF NOT EXISTS bot_id TEXT;
UPDATE clients SET bot_id = :'pb' WHERE bot_id IS NULL;
ALTER TABLE clients ALTER COLUMN bot_id SET NOT NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS telegram_unreachable BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS clients_bot_id_idx ON clients(bot_id);
CREATE UNIQUE INDEX IF NOT EXISTS clients_bot_id_telegram_id_unique ON clients(bot_id, telegram_id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_bot_id_fkey') THEN
    ALTER TABLE clients ADD CONSTRAINT clients_bot_id_fkey
      FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END$$;
SQL
  log "rescue_clients_bot_id: завершено"
  return 0
}

# Помечает все папки prisma/migrations как применённые (после ручного приведения схемы к schema.prisma).
apply_baseline_all() {
  log "baseline: migrate resolve --applied для всех миграций"
  for dir in $(ls -1d prisma/migrations/*/ 2>/dev/null | LC_ALL=C sort); do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    case $name in migration_lock.toml) continue ;; esac
    [ -f "$dir/migration.sql" ] || continue
    log "  resolve --applied $name"
    code=0
    out=$(npx prisma migrate resolve --applied "$name" 2>&1) || code=$?
    printf '%s\n' "$out"
    if [ "$code" -ne 0 ]; then
      case "$out" in *P3008*|*"already recorded"*) ;; *)
        log "migrate resolve --applied $name завершился с ошибкой (см. выше)"
        return 1
      ;; esac
    fi
  done
  return 0
}

if [ -z "${DATABASE_URL:-}" ]; then
  log "ERROR: DATABASE_URL is not set"
  exit 1
fi

MIGRATE_LOG=$(mktemp)
DRIFT_SQL=""
GF_SQL=""
cleanup() {
  rm -f "$MIGRATE_LOG"
  [ -n "$DRIFT_SQL" ] && rm -f "$DRIFT_SQL"
  [ -n "$GF_SQL" ] && rm -f "$GF_SQL"
}
trap cleanup EXIT INT TERM

# reconcile_schema_drift — после каждого успешного migrate deploy сверяет
# фактическую схему БД с schema.prisma через `prisma migrate diff`. Если diff
# непустой (миграции помечены applied, но их SQL по факту не выполнился —
# частый случай: восстановление БД из старого бэкапа поверх свежего
# _prisma_migrations, прерванная миграция, ручной DROP, переустановка поверх
# старого volume) — генерируем недостающий DDL и применяем через psql lenient.
# Никогда не пытается выполнить full migration.sql повторно, поэтому работает
# даже при ЧАСТИЧНОМ drift'е (одна таблица создалась, другая — нет).
#
# После apply верифицирует через verify_drift_resolved. Если осталась
# structural drift — exit 1 (явный отказ старта вместо silent corruption).
#
# Безопасно для случая «всё ок»: diff будет пустым, ничего не применится.
reconcile_schema_drift() {
  POST_DRIFT_SQL=$(mktemp)
  if ! npx prisma migrate diff \
      --from-url "$DATABASE_URL" \
      --to-schema-datamodel prisma/schema.prisma \
      --script >"$POST_DRIFT_SQL" 2>/dev/null; then
    rm -f "$POST_DRIFT_SQL"
    return 0
  fi
  # Пустой результат или только пробелы = схема уже в синке
  if ! [ -s "$POST_DRIFT_SQL" ] || ! grep -q '[^[:space:]]' "$POST_DRIFT_SQL"; then
    rm -f "$POST_DRIFT_SQL"
    return 0
  fi
  log "schema drift detected post-deploy: применяю недостающий DDL ($(wc -c <"$POST_DRIFT_SQL" | tr -d ' ') байт) — каждый statement отдельно через psql lenient"
  # Превентивный rescue для clone_bots silent-corruption (см. сценарий 6 в шапке файла).
  # Если drift хочет clients.bot_id NOT NULL поверх существующих данных — psql упал бы
  # на NOT NULL constraint и verify_drift_resolved дал бы FATAL. Эта функция всё лечит
  # сама и идемпотентна — если триггер не сработал или rescue не нужен, выходит мгновенно.
  rescue_clients_bot_id_pre_drift "$POST_DRIFT_SQL" || log "rescue_clients_bot_id_pre_drift: возникли проблемы (см. логи выше), всё равно пробую apply_sql_lenient"
  apply_sql_lenient "$POST_DRIFT_SQL"
  rm -f "$POST_DRIFT_SQL"
  if ! verify_drift_resolved; then
    log "FATAL: drift не удалось устранить — API не может стартовать с рассинхроном схемы. Сделай бэкап БД и обратись в поддержку."
    exit 1
  fi
  log "schema drift fix: применён успешно, схема в синке"
}

if npx prisma migrate deploy >"$MIGRATE_LOG" 2>&1; then
  cat "$MIGRATE_LOG" || true
  log "migrate deploy: OK"
  reconcile_schema_drift
  exec node dist/index.js
fi

cat "$MIGRATE_LOG" >&2 || true

# P3009: в _prisma_migrations висит failed-миграция (started без finished). Снимаем
# через rolled-back и снова migrate deploy — миграция выполнится заново. Нельзя сразу
# resolve --applied: при P3018 (нет таблицы) это помечало миграцию применённой без SQL.
if grep -q "P3009" "$MIGRATE_LOG"; then
  log "P3009: в истории есть failed-миграция, пытаюсь её снять"
  # Имена папок миграций: YYYYMMDD_name (8 цифр) или YYYYMMDDHHMMSS_name (14+)
  STUCK=$(grep -oE "[0-9]{8,}_[A-Za-z0-9_]+" "$MIGRATE_LOG" | head -1 || true)
  if [ -z "$STUCK" ]; then
    log "ERROR: P3009, но не получилось вычислить имя зависшей миграции из лога"
    exit 1
  fi
  log "  resolve --rolled-back $STUCK"
  npx prisma migrate resolve --rolled-back "$STUCK" || true
  log "повторный migrate deploy после снятия P3009"
  if npx prisma migrate deploy >"$MIGRATE_LOG" 2>&1; then
    cat "$MIGRATE_LOG" || true
    log "migrate deploy: OK (после P3009 recovery)"
    reconcile_schema_drift
    exec node dist/index.js
  fi
  cat "$MIGRATE_LOG" >&2 || true

  # ─── Сценарий 7: P3018 «already exists» после rolled-back ────────────
  # Случай: миграция X была частично применена (создала таблицы/колонки),
  # но процесс завершился аварийно → запись осталась failed. resolve
  # --rolled-back чистит запись, повторный deploy пытается ПРИМЕНИТЬ
  # миграцию заново → падает на «relation/column already exists» (P3018).
  # Лечение: пометить миграцию как applied (объекты УЖЕ в БД), потом
  # продолжить deploy — следующие миграции применятся нормально.
  if grep -q "P3018" "$MIGRATE_LOG" \
     && grep -qiE "already exists|duplicate" "$MIGRATE_LOG"; then
    log "P3018: миграция $STUCK падает на 'already exists' — её SQL фактически применён в прошлый раз"
    log "  resolve --applied $STUCK (помечаю применённой, продолжаю deploy)"
    npx prisma migrate resolve --applied "$STUCK" || true
    if npx prisma migrate deploy >"$MIGRATE_LOG" 2>&1; then
      cat "$MIGRATE_LOG" || true
      log "migrate deploy: OK (после P3009→P3018 adaptive recovery)"
      reconcile_schema_drift
      exec node dist/index.js
    fi
    cat "$MIGRATE_LOG" >&2 || true
    # Возможно ещё одна миграция в том же состоянии — попробуем итеративно
    log "после resolve --applied $STUCK всё ещё ошибка — возможно следующая миграция тоже частично применена"
    for _i in 1 2 3 4 5; do
      NEXT_STUCK=$(grep -oE "Migration name: [0-9]+_[A-Za-z0-9_]+" "$MIGRATE_LOG" | sed -E 's/Migration name: //' | head -1 || true)
      if [ -z "$NEXT_STUCK" ]; then break; fi
      if ! grep -qiE "already exists|duplicate" "$MIGRATE_LOG"; then break; fi
      log "  resolve --applied $NEXT_STUCK (итеративно)"
      npx prisma migrate resolve --applied "$NEXT_STUCK" || true
      if npx prisma migrate deploy >"$MIGRATE_LOG" 2>&1; then
        cat "$MIGRATE_LOG" || true
        log "migrate deploy: OK (после итеративного adaptive recovery)"
        reconcile_schema_drift
        exec node dist/index.js
      fi
      cat "$MIGRATE_LOG" >&2 || true
    done
  fi

  log "migrate deploy после P3009 recovery не прошёл — смотрю greenfield / другие ветки"
fi

if ! grep -q "P3005" "$MIGRATE_LOG"; then
  # Greenfield только если в БД ещё нет рабочей схемы: допустимы лишь _prisma_migrations и
  # pending_* (артефакт частичного migrate). Любая другая таблица = уже не «пустой инсталл» —
  # DROP SCHEMA запрещён, чтобы не уничтожить прод при рассинхроне истории миграций.
  if command -v psql >/dev/null 2>&1; then
    only_bootstrap_tables=$(psql "$DATABASE_URL" -t -A -c "SELECT NOT EXISTS (SELECT 1 FROM information_schema.tables t WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND t.table_name NOT IN ('_prisma_migrations', 'pending_telegram_links', 'pending_email_links'));" 2>/dev/null) || only_bootstrap_tables=f
    only_bootstrap_tables=$(printf '%s' "$only_bootstrap_tables" | tr -d '[:space:]')
    clients_missing=$(psql "$DATABASE_URL" -t -A -c "SELECT (to_regclass('public.clients') IS NULL);" 2>/dev/null) || clients_missing=t
    clients_missing=$(printf '%s' "$clients_missing" | tr -d '[:space:]')
    if [ "$only_bootstrap_tables" = "t" ]; then
      log "greenfield: в public только служебные таблицы (или пусто) — безопасный сброс и полная схема из Prisma + baseline миграций"
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;' || {
        log "ERROR: не удалось сбросить schema public (нужны права владельца БД)"
        exit 1
      }
      GF_SQL=$(mktemp)
      if ! npx prisma migrate diff \
        --from-empty \
        --to-schema-datamodel prisma/schema.prisma \
        --script >"$GF_SQL" 2>/tmp/gf.stderr; then
        log "migrate diff --from-empty failed:"
        cat /tmp/gf.stderr >&2 || true
        rm -f /tmp/gf.stderr
        exit 1
      fi
      rm -f /tmp/gf.stderr
      if ! [ -s "$GF_SQL" ] || ! grep -q '[^[:space:]]' "$GF_SQL"; then
        log "ERROR: migrate diff --from-empty дал пустой SQL"
        exit 1
      fi
      log "применяю полную схему ($(wc -c <"$GF_SQL" | tr -d ' ') байт)"
      # Greenfield — БД пуста, дубликатов быть не может, можно использовать
      # обычный prisma db execute (один батч в транзакции).
      npx prisma db execute --url "$DATABASE_URL" --file "$GF_SQL" || {
        log "ERROR: db execute полной схемы не прошёл"
        exit 1
      }
      rm -f "$GF_SQL"
      GF_SQL=""
      apply_baseline_all || exit 1
      log "migrate deploy (после greenfield baseline)"
      if npx prisma migrate deploy; then
        log "migrate deploy: OK (greenfield)"
        # На всякий случай — даже greenfield может содержать остаточный benign drift
        reconcile_schema_drift
        exec node dist/index.js
      fi
      log "ERROR: migrate deploy после greenfield всё ещё падает — см. лог выше"
      exit 1
    fi
    if [ "$only_bootstrap_tables" != "t" ] && [ "$clients_missing" = "t" ]; then
      log "ERROR: migrate deploy не прошёл, нет public.clients, но в БД уже есть таблицы кроме _prisma_migrations / pending_*. Автосброс public отключён (это не чистая установка). Бэкап → migrate resolve / восстановление из дампа."
      exit 1
    fi
  fi
  log "migrate deploy failed — не P3005 и не P3009 (и не greenfield). См. лог выше."
  exit 1
fi

log "P3005: БД не пустая без истории Prisma Migrate — clone_bots (при необходимости), drift через psql lenient, baseline"

CLONE_SQL="prisma/migrations/20260502160000_clone_bots/migration.sql"
if [ ! -f "$CLONE_SQL" ]; then
  log "ERROR: не найден $CLONE_SQL"
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  log "ERROR: нет psql (нужен postgresql-client) для проверки таблицы bots"
  exit 1
fi

bots_missing=$(psql "$DATABASE_URL" -t -A -c "SELECT (to_regclass('public.bots') IS NULL);" 2>/dev/null) || {
  log "ERROR: psql не смог выполнить проверку to_regclass('public.bots')"
  exit 1
}
bots_missing=$(printf '%s' "$bots_missing" | tr -d '[:space:]')

if [ "$bots_missing" = "t" ]; then
  log "таблицы bots нет — применяю $CLONE_SQL (миграция clone_bots) через psql lenient"
  apply_sql_lenient "$CLONE_SQL"
else
  log "таблица bots уже есть — шаг clone_bots пропускаю"
fi

DRIFT_SQL=$(mktemp)

if ! npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script >"$DRIFT_SQL" 2>/tmp/drift.stderr; then
  log "migrate diff failed:"
  cat /tmp/drift.stderr >&2 || true
  rm -f /tmp/drift.stderr
  exit 1
fi
rm -f /tmp/drift.stderr

# Ненулевой размер и есть непробельные символы — применяем lenient
if [ -s "$DRIFT_SQL" ] && grep -q '[^[:space:]]' "$DRIFT_SQL"; then
  log "применяю drift SQL ($(wc -c <"$DRIFT_SQL" | tr -d ' ') байт) через psql ON_ERROR_STOP=0 — каждый statement отдельно, дубликаты пропускаются молча"
  # Pre-rescue для clone_bots silent-corruption (см. сценарий 6)
  rescue_clients_bot_id_pre_drift "$DRIFT_SQL" || log "rescue_clients_bot_id_pre_drift: проблемы (см. выше), всё равно пробую apply_sql_lenient"
  apply_sql_lenient "$DRIFT_SQL"
  # Проверяем что drift реально устранён — если структурный остаток есть (CREATE
  # TABLE / ADD COLUMN), значит lenient apply упал на чём-то критичном, и идти в
  # baseline нельзя (мы помечаем миграции applied, но таблиц физически нет).
  if ! verify_drift_resolved; then
    log "FATAL: drift не устранён даже после lenient apply — отказываюсь маркировать миграции как applied. Бэкап → ручной разбор schema.prisma vs БД."
    exit 1
  fi
else
  log "drift SQL пуст — схема уже совпадает с schema.prisma, только baseline записей"
fi

apply_baseline_all || exit 1

log "migrate deploy (после baseline)"
npx prisma migrate deploy

# Финальный sanity-check: после deploy схема всё ещё может расходиться
# (см. сценарий 5 в шапке файла). reconcile применит остаточный drift и
# верифицирует результат.
reconcile_schema_drift

exec node dist/index.js
