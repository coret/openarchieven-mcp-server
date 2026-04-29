#!/usr/bin/env tsx
/**
 * Open Archieven MCP Server
 *
 * Exposes all 17 Open Archieven API endpoints as MCP tools via multiple transports:
 *   POST /              — MCP JSON-RPC (canonical, Origin-validated)
 *   POST /mcp           — MCP JSON-RPC (legacy alias, Origin-validated)
 *   GET  /health        — Health check
 *   GET  /tools         — List tool names
 *   POST /tools/:name   — Direct HTTP tool call
 *   GET  /events/:name  — SSE streaming with auto-pagination
 *   POST /stream/:name  — Chunked HTTP streaming with auto-pagination
 *
 * Run: npx tsx server.ts
 * Requires: generated/tools.json (run generate.ts first)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express, { type Request, type Response, type NextFunction } from 'express';
import axios from 'axios';
import { Redis } from 'ioredis';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import pino from 'pino';
import type { ToolDef, ParamDef } from './generate.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Logger ───────────────────────────────────────────────────────────────────

const isDev = process.env['NODE_ENV'] !== 'production';

const log = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
    },
  }),
});

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
const UPSTREAM_BASE = process.env['UPSTREAM_BASE'] ?? 'https://api.openarchieven.nl/1.1';
const RATE_LIMIT_RPS = parseInt(process.env['RATE_LIMIT_RPS'] ?? '4', 10);
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379/5';
const CACHE_TTL = parseInt(process.env['CACHE_TTL'] ?? '3600', 10);

// Origin allowlist for the remote MCP endpoint (DNS-rebinding defense).
// Hardcoded Claude origins are always allowed; ALLOWED_ORIGINS adds more.
const HARDCODED_ORIGINS = ['https://claude.ai', 'https://claude.com'];
const HARDCODED_ORIGIN_SUFFIXES = ['.claude.ai', '.claude.com'];
const EXTRA_ORIGINS = (process.env['ALLOWED_ORIGINS'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ─── Load tool definitions ────────────────────────────────────────────────────

const toolsPath = path.join(__dirname, 'generated', 'tools.json');
if (!fs.existsSync(toolsPath)) {
  log.fatal('generated/tools.json not found — run: npx tsx generate.ts');
  process.exit(1);
}
const TOOLS: ToolDef[] = JSON.parse(fs.readFileSync(toolsPath, 'utf8'));
const TOOL_MAP = new Map<string, ToolDef>(TOOLS.map((t) => [t.name, t]));

function resolveTool(name: string): ToolDef | undefined {
  return TOOL_MAP.get(name);
}

function humanize(snake: string): string {
  return snake
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // curl, server-to-server, native MCP clients
  if (HARDCODED_ORIGINS.includes(origin)) return true;
  if (EXTRA_ORIGINS.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    if (HARDCODED_ORIGIN_SUFFIXES.some((s) => host.endsWith(s))) return true;
  } catch {
    return false;
  }
  return false;
}

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

class RateLimiter {
  private queue: Array<() => void> = [];
  private processing = false;

  constructor(private rps: number) {}

  acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      if (!this.processing) this.processQueue();
    });
  }

  private processQueue() {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }
    this.processing = true;
    const resolve = this.queue.shift()!;
    resolve();
    setTimeout(() => this.processQueue(), Math.ceil(1000 / this.rps));
  }
}

const rateLimiter = new RateLimiter(RATE_LIMIT_RPS);

// ─── Redis ────────────────────────────────────────────────────────────────────

let redis: Redis | null = null;
let redisAvailable = false;

function initRedis() {
  try {
    redis = new Redis(REDIS_URL, { lazyConnect: true, enableOfflineQueue: false });
    redis.on('ready', () => {
      redisAvailable = true;
      log.info({ redis: REDIS_URL }, 'Redis connected');
    });
    redis.on('error', (err: Error) => {
      const wasAvailable = redisAvailable;
      redisAvailable = false;
      if (wasAvailable) log.warn({ err: err.message }, 'Redis disconnected — running in degraded mode');
    });
    redis.connect().catch((err: Error) => {
      redisAvailable = false;
      log.warn({ err: err.message }, 'Redis unavailable — running in degraded mode');
    });
  } catch (err) {
    redisAvailable = false;
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'Redis init failed');
  }
}

function cacheKey(toolName: string, params: Record<string, unknown>): string {
  const sorted = Object.keys(params)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => { acc[k] = params[k]; return acc; }, {});
  return `mcp:${toolName}:${JSON.stringify(sorted)}`;
}

async function cacheGet(key: string): Promise<unknown | null> {
  if (!redisAvailable || !redis) return null;
  try {
    const val = await redis.get(key);
    return val ? JSON.parse(val) : null;
  } catch {
    return null;
  }
}

async function cacheSet(key: string, value: unknown): Promise<void> {
  if (!redisAvailable || !redis) return;
  try {
    await redis.set(key, JSON.stringify(value), 'EX', CACHE_TTL);
  } catch {
    // ignore
  }
}

// ─── Zod schema builder ───────────────────────────────────────────────────────

function buildZodShape(params: ParamDef[]): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const p of params) {
    let base: z.ZodTypeAny;

    if (p.enum) {
      const vals = p.enum as [string | number, ...(string | number)[]];
      if (p.type === 'integer' || p.type === 'number') {
        const literals = vals.map((v) => z.literal(v as number));
        base = z.union(literals as [z.ZodLiteral<number>, z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]);
      } else {
        const strVals = vals.map(String) as [string, ...string[]];
        base = z.enum(strVals);
      }
    } else if (p.type === 'integer') {
      let s = z.number().int();
      if (p.minimum !== undefined) s = s.min(p.minimum);
      if (p.maximum !== undefined) s = s.max(p.maximum);
      base = s;
    } else if (p.type === 'number') {
      let s = z.number();
      if (p.minimum !== undefined) s = s.min(p.minimum);
      if (p.maximum !== undefined) s = s.max(p.maximum);
      base = s;
    } else if (p.type === 'boolean') {
      base = z.boolean();
    } else {
      base = z.string();
    }

    shape[p.name] = p.required ? base : base.optional();
  }

  return shape;
}

// ─── Upstream API caller ──────────────────────────────────────────────────────

async function callUpstream(
  tool: ToolDef,
  params: Record<string, unknown>,
): Promise<unknown> {
  const key = cacheKey(tool.name, params);
  const cached = await cacheGet(key);
  if (cached !== null) {
    log.debug({ tool: tool.name, params }, 'cache hit');
    return cached;
  }

  await rateLimiter.acquire();

  const url = `${UPSTREAM_BASE}${tool.endpoint}`;
  log.debug({ tool: tool.name, url, params }, 'upstream request');

  const t0 = Date.now();
  const res = await axios.get(url, {
    params,
    headers: { Accept: 'application/json' },
    timeout: 15_000,
  });
  log.info({ tool: tool.name, status: res.status, ms: Date.now() - t0 }, 'upstream ok');

  await cacheSet(key, res.data);
  return res.data;
}

// ─── MCP Server factory ───────────────────────────────────────────────────────

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'openarchieven',
    version: '1.0.0',
  });

  const registerTool = (name: string, tool: ToolDef) => {
    const shape = buildZodShape(tool.params);
    server.registerTool(
      name,
      {
        title: humanize(name),
        description: tool.description,
        inputSchema: shape,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: true,
        },
      },
      async (args) => {
        log.info({ tool: name, args }, 'mcp tool call');
        try {
          const result = await callUpstream(tool, args as Record<string, unknown>);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error({ tool: name, err: msg }, 'tool call failed');
          return {
            content: [{ type: 'text' as const, text: `Error: ${msg}` }],
            isError: true,
          };
        }
      },
    );
  };

  for (const tool of TOOLS) registerTool(tool.name, tool);

  return server;
}

// ─── Pagination helper ────────────────────────────────────────────────────────

interface Page {
  data: unknown;
  pageNum: number;
  done: boolean;
}

async function* paginate(
  tool: ToolDef,
  params: Record<string, unknown>,
): AsyncGenerator<Page> {
  const MAX_PAGES = 20;
  const numberShow = (params['number_show'] as number | undefined) ?? 10;

  if (!tool.pageable) {
    const data = await callUpstream(tool, params);
    yield { data, pageNum: 1, done: true };
    return;
  }

  let start = (params['start'] as number | undefined) ?? 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await callUpstream(tool, { ...params, start }) as Record<string, unknown>;
    const response = result['response'] as Record<string, unknown> | undefined;
    const docs = (response?.['docs'] as unknown[]) ?? [];
    const numberFound = (response?.['number_found'] as number | undefined) ?? 0;

    const done =
      docs.length === 0 ||
      start + numberShow >= numberFound ||
      page === MAX_PAGES;

    yield { data: result, pageNum: page, done };
    if (done) break;
    start += numberShow;
  }
}

// ─── Request logging middleware ───────────────────────────────────────────────

const app = express();
app.disable('x-powered-by');
app.use(express.json());

app.use((req: Request, res: Response, next: NextFunction) => {
  const t0 = Date.now();
  res.on('finish', () => {
    log.info({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - t0,
    }, 'request');
  });
  next();
});

// ── Discovery metadata (static, hand-editable JSON) ──────────────────────────
//   /.well-known/mcp/server-card.json  — SEP-1649 MCP Server Card
//   /.well-known/mcp.json              — SEP-1960 alias (same body)
//   /.well-known/agent-card.json       — A2A v0.3 Agent Card
//   /.well-known/agent.json            — older A2A path (same body)
const WELL_KNOWN_DIR = path.join(__dirname, 'well-known');

function serveWellKnown(filename: string) {
  return (_req: Request, res: Response) => {
    fs.readFile(path.join(WELL_KNOWN_DIR, filename), 'utf8', (err, body) => {
      if (err) {
        log.error({ file: filename, err: err.message }, 'well-known file missing');
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(body);
    });
  };
}

app.get('/.well-known/mcp/server-card.json', serveWellKnown('mcp-server-card.json'));
app.get('/.well-known/mcp.json',             serveWellKnown('mcp-server-card.json'));
app.get('/.well-known/agent-card.json',      serveWellKnown('agent-card.json'));
app.get('/.well-known/agent.json',           serveWellKnown('agent-card.json'));

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    tools: TOOLS.length,
    redis: redisAvailable,
    uptime: process.uptime(),
  });
});

// ── List tools ────────────────────────────────────────────────────────────────
app.get('/tools', (_req, res) => {
  res.json(TOOLS.map((t) => t.name));
});

// ── Direct HTTP tool call ─────────────────────────────────────────────────────
app.post('/tools/:name', async (req: Request, res: Response) => {
  const name = req.params['name'] as string;
  const tool = resolveTool(name);
  if (!tool) {
    log.warn({ tool: name }, 'unknown tool');
    res.status(404).json({ error: `Unknown tool: ${name}` });
    return;
  }

  try {
    const result = await callUpstream(tool, req.body as Record<string, unknown>);
    res.json(result);
  } catch (err) {
    const status = axios.isAxiosError(err) ? (err.response?.status ?? 500) : 500;
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ tool: name, status, err: msg }, 'http tool call failed');
    res.status(status).json({ error: msg });
  }
});

// ── SSE streaming with auto-pagination ───────────────────────────────────────
app.get('/events/:name', async (req: Request, res: Response) => {
  const name = req.params['name'] as string;
  const tool = resolveTool(name);
  if (!tool) {
    res.status(404).json({ error: `Unknown tool: ${name}` });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 10_000);
  req.on('close', () => clearInterval(heartbeat));

  try {
    const params = req.query as Record<string, unknown>;
    log.info({ tool: name, params }, 'sse stream start');
    let pages = 0;
    for await (const page of paginate(tool, params)) {
      res.write(`event: page\ndata: ${JSON.stringify(page.data)}\n\n`);
      pages++;
      if (page.done) break;
    }
    log.info({ tool: name, pages }, 'sse stream done');
    res.write('event: done\ndata: {}\n\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ tool: name, err: msg }, 'sse stream error');
    res.write(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`);
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

// ── Chunked HTTP streaming with auto-pagination ───────────────────────────────
app.post('/stream/:name', async (req: Request, res: Response) => {
  const name = req.params['name'] as string;
  const tool = resolveTool(name);
  if (!tool) {
    res.status(404).json({ error: `Unknown tool: ${name}` });
    return;
  }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');

  try {
    const params = req.body as Record<string, unknown>;
    log.info({ tool: name, params }, 'chunked stream start');
    let pages = 0;
    for await (const page of paginate(tool, params)) {
      res.write(JSON.stringify(page.data) + '\n');
      pages++;
      if (page.done) break;
    }
    log.info({ tool: name, pages }, 'chunked stream done');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ tool: name, err: msg }, 'chunked stream error');
    res.write(JSON.stringify({ error: msg }) + '\n');
  } finally {
    res.end();
  }
});

// ── MCP endpoint — custom one-shot transport (no Accept-header requirement) ───
//
// StreamableHTTPServerTransport mandates Accept: application/json, text/event-stream.
// Instead we implement a minimal Transport that handles one JSON-RPC round-trip
// and returns the response directly as JSON — no special headers required.

class OneShotTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;

  private _resolve?: (message: JSONRPCMessage) => void;

  async start(): Promise<void> {}
  async close(): Promise<void> { this.onclose?.(); }

  // Called by McpServer to send the response back to us
  async send(message: JSONRPCMessage): Promise<void> {
    // Only resolve on messages that carry an id (responses), not notifications
    if ('id' in message) this._resolve?.(message);
  }

  // Deliver the incoming request to the McpServer
  deliver(message: JSONRPCMessage): void {
    this.onmessage?.(message);
  }

  waitForResponse(timeoutMs = 30_000): Promise<JSONRPCMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('MCP response timeout')), timeoutMs);
      this._resolve = (msg) => { clearTimeout(timer); resolve(msg); };
    });
  }
}

function validateOrigin(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin as string | undefined;
  if (!isOriginAllowed(origin)) {
    log.warn({ origin, path: req.path }, 'rejected: Origin not allowed');
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }
  next();
}

async function handleMcp(req: Request, res: Response, next: NextFunction) {
  const body = req.body as JSONRPCMessage;
  const isNotification = !('id' in body);

  const server = createMcpServer();
  const transport = new OneShotTransport();

  try {
    await server.connect(transport);

    if (isNotification) {
      transport.deliver(body);
      res.status(202).end();
      return;
    }

    const responsePromise = transport.waitForResponse();
    transport.deliver(body);
    const response = await responsePromise;
    res.json(response);
  } catch (err) {
    next(err);
  } finally {
    server.close().catch(() => undefined);
  }
}

// Mounted on both / (canonical public URL) and /mcp (local/legacy).
// POST-only; Origin is validated to prevent DNS-rebinding from untrusted sites.
app.post('/', validateOrigin, handleMcp);
app.post('/mcp', validateOrigin, handleMcp);

// GET / — content-negotiated:
//   Accept: text/event-stream  → 405 (MCP spec: no server-initiated SSE here)
//   anything else (browsers)   → static landing page (index.html, hot-editable)
const INDEX_HTML_PATH = path.join(__dirname, 'index.html');

app.get('/', (req: Request, res: Response) => {
  const wants = req.accepts(['html', 'text/event-stream']);
  if (wants === 'text/event-stream') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method Not Allowed. Use POST for MCP JSON-RPC.' });
    return;
  }
  fs.readFile(INDEX_HTML_PATH, 'utf8', (err, body) => {
    if (err) {
      log.error({ err: err.message }, 'index.html missing');
      res.status(500).json({ error: 'Landing page unavailable' });
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(body);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

initRedis();

// Only bind a port when run directly (e.g. `tsx server.ts`).
// When imported (e.g. by api/index.ts on Vercel) we just export the app.
const isEntrypoint =
  import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isEntrypoint) {
  app.listen(PORT, '0.0.0.0', () => {
    log.info({
      port: PORT,
      tools: TOOLS.length,
      upstream: UPSTREAM_BASE,
      rateLimit: `${RATE_LIMIT_RPS} req/s`,
      redis: REDIS_URL,
      env: process.env['NODE_ENV'] ?? 'development',
    }, 'Open Archieven MCP server started');
  });
}

export default app;
