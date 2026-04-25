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

## Multiple Interfaces

### MCP Remote (StreamableHTTP)

```text
POST /       ← canonical public endpoint (mcp.openarchieven.nl)
POST /mcp    ← local / legacy alias
```

Stateless JSON-RPC transport — a new MCP server instance is created per request.

> **Origin validation:** Browser requests must come from `claude.ai`,
> `claude.com`, or any domain listed in `ALLOWED_ORIGINS`. Requests with no
> `Origin` header (native MCP clients, `curl`, server-to-server) are
> accepted. Unknown origins receive **HTTP 403**.

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
| `ALLOWED_ORIGINS` | _(empty)_ | Extra Origin headers allowed on the MCP endpoint (comma-separated). Claude domains and requests without an Origin header are always allowed. |

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
  "get_census_data"
]
```

---

# 3. Tool Call

```bash
curl -X POST http://localhost:3001/tools/search_records \
-H "Content-Type: application/json" \
-d '{"name":"Jansen"}'
```

---

# 4. Show a Single Record

```bash
curl -X POST http://localhost:3001/tools/show_record \
-H "Content-Type: application/json" \
-d '{"archive":"hua","identifier":"E13B9821-C0B0-4AED-B20B-8DE627ED99BD"}'
```

---

# 5. SSE Streaming

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

# 6. Heartbeat Test

Leave SSE open for 15+ seconds — expect periodic keep-alive lines:

```text
: heartbeat
```

---

# 7. Chunked HTTP Streaming

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

# 8. MCP Initialize

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

# 9. MCP List Tools

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

# 10. MCP Call Tool

```bash
curl -X POST http://localhost:3001/ \
-H "Content-Type: application/json" \
-H "Accept: application/json, text/event-stream" \
-d '{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "search_records",
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

# Privacy & Data Handling

This server is a thin proxy over the public
[Open Archives API](https://api.openarchieven.nl). It does not require user
authentication and does not collect personal data of its own.

* **Data forwarded:** Tool arguments are passed verbatim over HTTPS to
  `https://api.openarchieven.nl/1.1`. The Open Archives privacy policy
  applies to that upstream service.
* **Caching:** When Redis is configured, upstream responses are cached for
  `CACHE_TTL` seconds (default: 1 hour) under keys of the form
  `mcp:<tool>:<sorted-params-json>`. No user identifiers are stored.
* **Logging:** Method, path, status, latency, tool name and tool arguments
  are logged via pino. Set `LOG_LEVEL=warn` in production to suppress
  argument logging.
* **Third parties:** No data is sent to any service other than the upstream
  Open Archives API.
* **Retention:** Nothing is persisted beyond the optional Redis cache, which
  expires per `CACHE_TTL`.
* **Origin validation:** The MCP endpoint validates the `Origin` header on
  every request and rejects unknown browser origins (DNS-rebinding defense).
* **Contact:** Open an issue on the
  [GitHub repository](https://github.com/coret/openarchieven-mcp-server).

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
