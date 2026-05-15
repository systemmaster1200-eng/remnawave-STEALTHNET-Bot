FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

EXPOSE 0
CMD ["node", "dist/index.js"]
