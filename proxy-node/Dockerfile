# STEALTHNET proxy node: agent + 3proxy (SOCKS5 + HTTP)
# Build context: repo root (paths proxy-node/...)

# Stage 1: build 3proxy
FROM alpine:3.19 AS proxybuilder
RUN apk add --no-cache make gcc musl-dev wget
WORKDIR /build
RUN wget -q https://github.com/3proxy/3proxy/archive/0.9.4.tar.gz -O 3proxy.tar.gz && \
    tar xzf 3proxy.tar.gz && \
    cd 3proxy-0.9.4 && \
    make -f Makefile.Linux && \
    cp bin/3proxy bin/socks bin/proxy /build/

# Stage 2: node + agent + 3proxy
FROM node:20-alpine
WORKDIR /app

COPY --from=proxybuilder /build/3proxy /build/socks /build/proxy /usr/local/bin/
COPY proxy-node/package.json proxy-node/agent.js ./

# Agent writes /app/3proxy.cfg and /app/passwd, then runs 3proxy
ENV CONFIG_PATH=/app/3proxy.cfg
ENV PASSWD_PATH=/app/passwd

CMD ["node", "agent.js"]
