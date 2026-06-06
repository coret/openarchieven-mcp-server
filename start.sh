#!/bin/bash
set -e
cd /home/http/www.openarch.nl/mcp

export NODE_ENV=production
export PORT=3001
export LOG_LEVEL=info
# export ALLOWED_ORIGINS=
# export REDIS_URL=redis://localhost:6379/5
# export CACHE_TTL=3600

./node_modules/.bin/tsx generate.ts ./openapi.yaml
./node_modules/.bin/vite build

exec ./node_modules/.bin/tsx server.ts
