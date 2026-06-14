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

echo "══════════════════════════════════════════"
echo "   WDTT Node (STEALTHNET Edition)"
echo "══════════════════════════════════════════"
echo "   Config:  $CONFIG_DIR"
echo "   DTLS:    $DTLS_PORT"
echo "   WG:      $WG_PORT"
echo "   API:     $API_PORT"
echo "══════════════════════════════════════════"

# Start WDTT server in background
echo "[boot] Starting WDTT server..."
wdtt-server \
    -listen "0.0.0.0:$DTLS_PORT" \
    -wg-port "$WG_PORT" \
    -config-dir "$CONFIG_DIR" \
    -password "$MAIN_PASSWORD" \
    ${ADMIN_ID:+-admin "$ADMIN_ID"} \
    ${BOT_TOKEN:+-bot-token "$BOT_TOKEN"} &
WDTT_PID=$!

# Wait for WDTT server to initialize
sleep 2

# Start API wrapper
echo "[boot] Starting API wrapper..."
export CONFIG_DIR="$CONFIG_DIR"
export API_PORT="$API_PORT"
export WDTT_PORTS="$DTLS_PORT,$WG_PORT,9000"
export PUBLIC_HOST="$PUBLIC_HOST"
export API_KEY="$API_KEY"

api-server &
API_PID=$!

echo "[boot] Both services started (WDTT PID=$WDTT_PID, API PID=$API_PID)"

# Handle shutdown
cleanup() {
    echo "[boot] Shutting down..."
    kill $API_PID 2>/dev/null
    kill $WDTT_PID 2>/dev/null
    wait $API_PID 2>/dev/null
    wait $WDTT_PID 2>/dev/null
    echo "[boot] Done"
}
trap cleanup SIGTERM SIGINT

# Wait for either process to exit
wait -n $WDTT_PID $API_PID
cleanup
