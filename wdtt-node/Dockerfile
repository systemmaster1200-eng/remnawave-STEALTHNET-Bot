# WDTT Node Dockerfile
# Builds both the WDTT server and the STEALTHNET API wrapper

FROM golang:alpine AS builder

ENV GOTOOLCHAIN=auto
RUN apk add --no-cache git gcc musl-dev linux-headers

# Clone WDTT server source
WORKDIR /build
RUN git clone https://github.com/amurcanov/proxy-turn-vk-android.git --depth=1 wdtt-source

# Build WDTT server
WORKDIR /build/wdtt-source
RUN go mod tidy && \
    CGO_ENABLED=0 go build -o /wdtt-server -ldflags="-s -w" .

# Build API wrapper
WORKDIR /build/api
COPY api-server.go go.mod .
RUN CGO_ENABLED=0 go build -o /api-server -ldflags="-s -w" .

# Final image
FROM alpine:3.20

RUN apk add --no-cache bash iptables ip6tables iproute2 procps

# Copy binaries
COPY --from=builder /wdtt-server /usr/local/bin/wdtt-server
COPY --from=builder /api-server /usr/local/bin/api-server

# Create config directory
RUN mkdir -p /etc/wdtt && chmod 700 /etc/wdtt

# Copy and set up startup script
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 56000/udp 56001/udp 9000/tcp

CMD ["/start.sh"]
