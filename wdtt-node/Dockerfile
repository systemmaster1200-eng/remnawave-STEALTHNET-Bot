# WDTT Node Dockerfile
# Builds both the WDTT server and the STEALTHNET API wrapper

FROM golang:1.23-alpine AS builder

RUN apk add --no-cache git gcc musl-dev linux-headers

# Clone WDTT server source
WORKDIR /build
RUN git clone https://github.com/amurcanov/proxy-turn-vk-android.git --depth=1 wdtt-source

# Build WDTT server
WORKDIR /build/wdtt-source
RUN go mod download && \
    CGO_ENABLED=0 go build -o /wdtt-server -ldflags="-s -w" .

# Build API wrapper
WORKDIR /build/api
COPY api-server.go .
RUN CGO_ENABLED=0 go build -o /api-server -ldflags="-s -w" .

# Final image
FROM alpine:3.20

RUN apk add --no-cache bash iptables ip6tables iproute2

# Copy binaries
COPY --from=builder /wdtt-server /usr/local/bin/wdtt-server
COPY --from=builder /api-server /usr/local/bin/api-server

# Create config directory
RUN mkdir -p /etc/wdtt && chmod 700 /etc/wdtt

# Create startup script
RUN cat > /start.sh << 'EOF'
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
    ${ADMIN_ID:+-admin "$ADMIN_ADMIN_ID"} \
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
EOF
chmod +x /start.sh

EXPOSE 56000/udp 56001/udp 9000/tcp

CMD ["/start.sh"]
