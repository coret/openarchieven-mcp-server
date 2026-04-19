# Open Archieven MCP Server v1.0

Production-grade hybrid MCP + HTTP + SSE server generated from the Open Archieven OpenAPI specification.

OpenAPI source used to generate tools:

```
../api/openapi.yaml   (local)
https://api.openarchieven.nl/openapi.yaml   (remote)
```

---

# Overview

A schema-aware server that automatically converts the OpenAPI specification into callable tools and exposes them through multiple transports:

* MCP Remote (JSON-RPC over StreamableHTTP)
* HTTP JSON API
* SSE streaming with auto-pagination
* Chunked HTTP streaming with auto-pagination
* Redis caching (optional)
* Health checks

---

# Core Features

## OpenAPI Auto-Generation

Every API operation becomes a tool automatically via `generate.ts`.

All 17 operations:

| Tool Name | Description |
| ---------------------- | -------------------------------------------- |
| `search_records` | Search genealogical records |
| `show_record` | Show a single genealogical record |
| `match_record` | Match a person to birth and death records |
| `get_births_years_ago` | List births from N years ago |
| `get_births` | Find birth records |
| `get_deaths` | Find death records |
| `get_marriages` | Find marriage records |
| `get_archives` | List all archives with statistics |
| `get_record_stats` | Record count per archive |
| `get_source_type_stats` | Record count per source type |
| `get_event_type_stats` | Record count per event type |
| `get_comment_stats` | Comment count statistics |
| `get_family_name_stats` | Family name frequency |
| `get_first_name_stats` | First name frequency |
| `get_profession_stats` | Profession frequency |
| `get_historical_weather` | Historical weather from KNMI |
| `get_census_data` | Dutch census data 1795–1899 |

> **Note:** The `callback` (JSONP) parameter present in the upstream API is excluded from all tools — it is irrelevant in an MCP/JSON-RPC context.

---

## Schema-Perfect Validation

Uses actual OpenAPI parameter schemas. Validates:

* required parameters
* integer fields
* number fields
* enum values
* minimum / maximum constraints

---

## Tool Aliases

Friendly aliases are included:

| Alias | Real Tool |
| -------------- | --------------- |
| `search_person` | `search_records` |
| `get_record` | `show_record` |
| `list_archives` | `get_archives` |

---

## Multiple Interfaces

### MCP Remote (StreamableHTTP)

```text
POST /       ← canonical public endpoint (mcp.openarchieven.nl)
POST /mcp    ← local / legacy alias
```

Stateless JSON-RPC transport — a new MCP server instance is created per request.

> **Required header:** All MCP `POST` requests must include `Accept: application/json, text/event-stream`. Omitting it returns a `-32000 Not Acceptable` error. MCP clients (Claude Desktop, etc.) send this automatically.

### HTTP JSON

```text
GET  /tools
POST /tools/:name
```

### SSE Streaming (auto-paginating)

```text
GET /events/:name
```

### Chunked HTTP Streaming (auto-paginating)

```text
POST /stream/:name
```

---

## Pagination

Streaming endpoints (`/events/:name`, `/stream/:name`) automatically paginate through results for endpoints that support a `start` offset:

* Increments `start` by `number_show` per page
* Stops when results are exhausted or after 20 pages (safety cap)
* SSE sends a `: heartbeat` comment every 10 seconds to keep connections alive

---

## Redis Cache

Optional Redis support.

If Redis is running:

* responses are cached for 1 hour (configurable via `CACHE_TTL`)

If Redis is unavailable:

* server still runs normally (degraded mode)

---

## Rate Limiting

The upstream API enforces **4 requests per second per IP**. The server queues all upstream calls through a token-bucket rate limiter (configurable via `RATE_LIMIT_RPS`).

---

## Health Checks

```text
GET /health
```

---

# Project Files

```text
generate.ts
server.ts
tsconfig.json
package.json
.env.example
generated/
  tools.json
  spec.json
```

---

# Requirements

* Node.js 18+
* npm
* optional Redis server

---

# Configuration

Copy `.env.example` to `.env` and adjust:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|-----------------|--------------------------------------|-------------------------------|
| `PORT` | `3001` | HTTP port |
| `OPENAPI_PATH` | `../api/openapi.yaml` | Path or URL to OpenAPI spec |
| `UPSTREAM_BASE` | `https://api.openarchieven.nl/1.1` | Upstream API base URL |
| `RATE_LIMIT_RPS`| `4` | Upstream requests per second |
| `REDIS_URL` | `redis://localhost:6379/5` | Redis connection URL (db 5) |
| `CACHE_TTL` | `3600` | Cache TTL in seconds |
| `LOG_LEVEL` | `info` | `trace` `debug` `info` `warn` `error` `fatal` |
| `NODE_ENV` | _(unset)_ | Set to `production` for JSON logs (default: pretty-printed) |

---

# Install

```bash
npm install
```

---

# Generate Tools from OpenAPI YAML

Run from local spec:

```bash
npx tsx generate.ts
```

Or from remote URL:

```bash
npx tsx generate.ts https://api.openarchieven.nl/openapi.yaml
```

Expected result:

```text
Generated 17 tools
Output: generated/tools.json, generated/spec.json
```

Creates:

```text
generated/tools.json
generated/spec.json
```

---

# Start Server

```bash
npx tsx server.ts
```

Expected startup (development — pretty-printed):

```text
[12:00:00] INFO: Open Archieven MCP server started
    port: 3001
    tools: 17
    aliases: 3
    upstream: "https://api.openarchieven.nl/1.1"
    rateLimit: "4 req/s"
    redis: "redis://localhost:6379/5"
    env: "development"
```

In production (`NODE_ENV=production`) each log line is a single JSON object.

Server binds to:

```text
http://0.0.0.0:3001
```

---

# Test All Features

---

# 1. Health Check

```bash
curl http://localhost:3001/health
```

Expected:

```json
{
  "ok": true,
  "tools": 17,
  "aliases": 3,
  "redis": false,
  "uptime": 1.23
}
```

---

# 2. List Tools

```bash
curl http://localhost:3001/tools
```

Expected:

```json
[
  "search_records",
  "show_record",
  "match_record",
  "get_births_years_ago",
  "get_births",
  "get_deaths",
  "get_marriages",
  "get_archives",
  "get_record_stats",
  "get_source_type_stats",
  "get_event_type_stats",
  "get_comment_stats",
  "get_family_name_stats",
  "get_first_name_stats",
  "get_profession_stats",
  "get_historical_weather",
  "get_census_data",
  "search_person",
  "get_record",
  "list_archives"
]
```

---

# 3. Normal Tool Call (via alias)

```bash
curl -X POST http://localhost:3001/tools/search_person \
-H "Content-Type: application/json" \
-d '{"name":"Jansen"}'
```

---

# 4. Canonical Tool Call

```bash
curl -X POST http://localhost:3001/tools/search_records \
-H "Content-Type: application/json" \
-d '{"name":"Jansen"}'
```

---

# 5. Show a Single Record

```bash
curl -X POST http://localhost:3001/tools/show_record \
-H "Content-Type: application/json" \
-d '{"archive":"hua","identifier":"E13B9821-C0B0-4AED-B20B-8DE627ED99BD"}'
```

---

# 6. SSE Streaming

```bash
curl -N "http://localhost:3001/events/search_records?name=Coret"
```

Expected stream:

```text
event: page
data: {...}

event: page
data: {...}

event: done
data: {}
```

---

# 7. Heartbeat Test

Leave SSE open for 15+ seconds — expect periodic keep-alive lines:

```text
: heartbeat
```

---

# 8. Chunked HTTP Streaming

```bash
curl -N -X POST http://localhost:3001/stream/search_records \
-H "Content-Type: application/json" \
-d '{"name":"Jansen"}'
```

Expected (newline-delimited JSON):

```text
{"query":{...},"response":{"number_found":...,"docs":[...]}}
{"query":{...},"response":{"number_found":...,"docs":[...]}}
```

---

# 9. MCP Initialize

```bash
curl -X POST http://localhost:3001/ \
-H "Content-Type: application/json" \
-H "Accept: application/json, text/event-stream" \
-d '{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "capabilities": {},
    "clientInfo": { "name": "test", "version": "1.0" }
  }
}'
```

---

# 10. MCP List Tools

```bash
curl -X POST http://localhost:3001/ \
-H "Content-Type: application/json" \
-H "Accept: application/json, text/event-stream" \
-d '{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list"
}'
```

---

# 11. MCP Call Tool

```bash
curl -X POST http://localhost:3001/ \
-H "Content-Type: application/json" \
-H "Accept: application/json, text/event-stream" \
-d '{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "search_person",
    "arguments": { "name": "Jansen" }
  }
}'
```

---

# Redis Testing

## Start Redis

```bash
redis-server
```

Restart the MCP server. Expected in `/health`:

```json
{ "redis": true }
```

## Without Redis

Stop Redis and restart. Expected:

```json
{ "redis": false }
```

---

# Common Commands

## Regenerate after API changes

```bash
npx tsx generate.ts
```

## Restart server

```bash
npx tsx server.ts
```

---

# Troubleshooting

## Generated files missing

```bash
npx tsx generate.ts
```

## Port already in use

**Linux / macOS:**

```bash
lsof -i :3001
kill -9 <PID>
```

**Windows:**

```powershell
netstat -ano | findstr :3001
taskkill /PID <PID> /F
```

## Redis not connecting

Server runs normally without Redis. Check `REDIS_URL` in `.env`.

## Rate limit errors (429)

The upstream API allows 4 req/s per IP. The built-in rate limiter queues requests automatically. If you are running multiple server instances, reduce `RATE_LIMIT_RPS` or use a shared queue.

---

# Recommended Production Upgrades

* HTTPS reverse proxy (nginx / caddy)
* PM2 or systemd process manager
* Structured JSON logging (pino / winston)
* Request tracing (OpenTelemetry)
* Auth middleware if server is public-facing
* Shared Redis for multi-instance deployments

---

# Version

```text
v1.0
```

Schema-perfect OpenAPI-generated MCP server for Open Archieven.
