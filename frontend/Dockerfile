# Сборка фронтенда — результат в /app/dist
FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* .npmrc* ./
RUN npm ci
COPY . .
RUN npm run build

# Финальный образ — просто dist для копирования через docker cp или volume
FROM alpine:3.20
COPY --from=builder /app/dist /dist
CMD ["echo", "Frontend build is in /dist"]
