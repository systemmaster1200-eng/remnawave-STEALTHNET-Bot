#!/bin/bash

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

cleanup() {
    echo "[boot] Shutting down..."
    kill $WDTT_PID 2>/dev/null
    kill $API_PID 2>/dev/null
    exit 0
}
trap cleanup SIGTERM SIGINT

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
    echo "[boot] WDTT server PID=$WDTT_PID"
}

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

# Start WDTT server
start_wdtt

echo "[boot] All services started (WDTT=$WDTT_PID, API=$API_PID)"

# Watchdog: restart WDTT server if it dies
while true; do
    wait $WDTT_PID 2>/dev/null
    echo "[boot] WDTT server stopped, restarting in 1s..."
    sleep 1
    start_wdtt
done &
WATCHDOG_PID=$!

# Wait for API wrapper
wait $API_PID 2>/dev/null
cleanup
