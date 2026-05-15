#!/bin/sh
set -e
npx prisma db push --accept-data-loss 2>/dev/null || true
node dist/index.js
