#!/bin/bash
set -e

CONFIG_DIR="${CONFIG_DIR:-/etc/wdtt}"
MAIN_PASSWORD="${MAIN_PASSWORD:-changeme}"
ADMIN_ID="${ADMIN_ID:-}"
BOT_TOKEN="${BOT_TOKEN:-}"
API_PORT="${API_PORT:-9000}"
DTLS_PORT="${DTLS_PORT:-56000}"
WG_PORT="${WG_PORT:-56001}"
PUBLIC_HOST="${PUBLIC_HOST:-}"
API_KEY="${API_KEY:-}"
VK_HASH="${VK_HASH:-}"

echo "══════════════════════════════════════════"
echo "   WDTT Node (STEALTHNET Edition)"
echo "══════════════════════════════════════════"
echo "   Config:  $CONFIG_DIR"
echo "   DTLS:    $DTLS_PORT"
echo "   WG:      $WG_PORT"
echo "   API:     $API_PORT"
echo "   VK Hash: ${VK_HASH:-(not set)}"
echo "══════════════════════════════════════════"

# Start API wrapper in background
echo "[boot] Starting API wrapper..."
export CONFIG_DIR="$CONFIG_DIR"
export API_PORT="$API_PORT"
export WDTT_PORTS="$DTLS_PORT,$WG_PORT,9000"
export PUBLIC_HOST="$PUBLIC_HOST"
export API_KEY="$API_KEY"
export VK_HASH="$VK_HASH"

api-server &
API_PID=$!

# Function to start WDTT server
start_wdtt() {
    echo "[boot] Starting WDTT server..."
    wdtt-server \
        -listen "0.0.0.0:$DTLS_PORT" \
        -wg-port "$WG_PORT" \
        -config-dir "$CONFIG_DIR" \
        -password "$MAIN_PASSWORD" \
        ${ADMIN_ID:+-admin "$ADMIN_ID"} \
        ${BOT_TOKEN:+-bot-token "$BOT_TOKEN"} &
    WDTT_PID=$!
    echo "[boot] WDTT server started (PID=$WDTT_PID)"
}

# Start WDTT server initially
start_wdtt

# Watchdog: restart WDTT server if it dies
while true; do
    wait $WDTT_PID 2>/dev/null
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 0 ] || [ $EXIT_CODE -eq 137 ]; then
        echo "[boot] WDTT server stopped (exit=$EXIT_CODE), restarting in 2s..."
        sleep 2
        start_wdtt
    else
        echo "[boot] WDTT server crashed (exit=$EXIT_CODE), restarting in 5s..."
        sleep 5
        start_wdtt
    fi
done &
WATCHDOG_PID=$!

# Handle shutdown
cleanup() {
    echo "[boot] Shutting down..."
    kill $API_PID 2>/dev/null
    kill $WATCHDOG_PID 2>/dev/null
    kill $WDTT_PID 2>/dev/null
    wait 2>/dev/null
    echo "[boot] Done"
}
trap cleanup SIGTERM SIGINT

echo "[boot] All services started"
wait -n $API_PID $WATCHDOG_PID 2>/dev/null
cleanup
