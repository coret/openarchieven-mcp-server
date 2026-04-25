# Open Archives MCP Server

Production-grade hybrid MCP + HTTP + SSE server generated from the Open Archives OpenAPI specification.

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

# Use with Claude

## Add as a custom connector

A hosted endpoint is available — no installation required.

In **claude.ai** or **Claude Desktop**:

1. Open **Settings → Connectors**.
2. Click **Add custom connector**.
3. Enter the URL: `https://mcp.openarchieven.nl/`
4. Save and approve when prompted.

No authentication is required — Open Archives is a public dataset.

## Example queries

Once the connector is added you can ask Claude, for example:

* *"Who are the ancestors of Johannes Gregorius Marinus Coret? Give me an overview, including source citations in markdown format with the links to the original archives if possible, otherwise provide the Open Archieven links and provide a tree in SVG."*
* *"Did Johannes Coret and Antonia Uphus have descendants? Give me an overview, including source citations in markdown format with the links to the original archives if possible, otherwise provide the Open Archieven links, include thumbnails from scans from archival sources if available and provide a tree in SVG."*
* *"Provide me with a list of sourcetypes per archive(name) where I can find information about the Coret family. Show the result in a markdown document including links to the search pages on Open Archieven. Instead of the archive code use the ISIL if available."*
* *"What was the weather in Amsterdam on 1953-02-01?"*
* *"What does the 1850 census say about Utrecht?"*

Claude will call the matching tool (`search_records`, `show_record`,
`get_marriages`, `get_historical_weather`, `get_census_data`, …) and
return links to the corresponding record pages on
`https://www.openarchieven.nl`.

## Self-hosted (stdio)

If you prefer running the server locally as a stdio MCP server:

```bash
npx -y @coret/openarchieven-mcp-server
```

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
-d '{"name":"Coret"}'
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
-d '{"name":"Coret"}'
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
    "arguments": { "name": "Coret" }
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

# Privacy Policy

This server is a thin proxy over the public
[Open Archives API](https://api.openarchieven.nl). It does not require user
authentication and does not collect personal data of its own.

The full privacy policies of the operators apply in addition to this section:

* [Open Archives — Disclaimer & Privacy](https://www.openarchieven.nl/disclaimer.php?lang=en)
* [Coret Genealogy — Privacy Policy](https://genealogie.coret.org/en/beleid/privacy.php)

## Data collection

* **Tool arguments** (e.g. a search name, an archive code, a record
  identifier) are received from the MCP client.
* **HTTP request metadata** — method, path, status code, latency, and the
  source IP — is observed by the reverse proxy in front of the hosted
  endpoint at `mcp.openarchieven.nl`.
* No accounts, cookies, tokens, or session identifiers are collected.
  The server is anonymous-by-design.

## Use and storage

* Tool arguments are forwarded verbatim over HTTPS to
  `https://api.openarchieven.nl/1.1` to fulfill the request, and the
  upstream response is returned to the caller.
* **Application logs** (tool name, arguments, status, latency) are written
  to `stdout` via [pino](https://github.com/pinojs/pino). On the hosted
  endpoint these logs are **ephemeral**: they are not written to disk and
  are lost on process restart. Set `LOG_LEVEL=warn` to suppress argument
  logging.
* **Cache** (optional): when Redis is configured, upstream responses are
  cached under keys of the form `mcp:<tool>:<sorted-params-json>`. The
  cache contains response bodies only; no user identifiers are stored.

## Third-party sharing

No data is sent to any service other than the upstream Open Archives API
listed above. There are no analytics, telemetry, advertising, or
observability third parties involved.

## Data retention

| Data | Retention |
| --- | --- |
| Tool arguments and responses | Not persisted by the application |
| Application logs | Ephemeral (`stdout`, lost on restart) |
| Redis cache entries | `CACHE_TTL` seconds (default 1 hour), then evicted |
| Reverse-proxy access logs | Per the hosting provider's standard retention policy |

## Security

The MCP endpoint validates the `Origin` header on every request and
rejects unknown browser origins (DNS-rebinding defense). All transport is
over HTTPS.

## External links surfaced to clients

Tool responses include URLs that point to record pages on
`https://www.openarchieven.nl`. The submission declares the following
allowed link URI so users are not prompted to confirm each link:

* `https://www.openarchieven.nl`

## Contact

For privacy questions or requests, contact:

* **Email:** `genealogie@coret.org`
* **GitHub:** [open an issue](https://github.com/coret/openarchieven-mcp-server/issues)

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

Schema-perfect OpenAPI-generated MCP server for Open Archives.
