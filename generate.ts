#!/usr/bin/env tsx
/**
 * Reads the Open Archieven OpenAPI YAML and generates:
 *   generated/tools.json  — tool definitions for server.ts
 *   generated/spec.json   — full parsed spec (reference)
 *
 * Usage:
 *   npx tsx generate.ts [path-or-url]
 *   npx tsx generate.ts ../api/openapi.yaml
 *   npx tsx generate.ts https://api.openarchieven.nl/openapi.yaml
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import { parse as parseYaml } from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParamDef {
  name: string;
  description: string;
  required: boolean;
  type: 'string' | 'integer' | 'number' | 'boolean';
  enum?: (string | number)[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
}

export interface ToolDef {
  name: string;
  description: string;
  endpoint: string;
  method: 'GET';
  /** Parameters that support pagination via `start` offset */
  pageable: boolean;
  params: ParamDef[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert camelCase / PascalCase operationId to snake_case */
function toSnakeCase(s: string): string {
  return s
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

/** Fetch text from a URL or file path */
async function readSource(src: string): Promise<string> {
  if (src.startsWith('http://') || src.startsWith('https://')) {
    const res = await axios.get<string>(src, { responseType: 'text' });
    return res.data;
  }
  const resolved = path.isAbsolute(src) ? src : path.resolve(__dirname, src);
  return fs.readFileSync(resolved, 'utf8');
}

/** Map OpenAPI schema type to our simplified ParamDef type */
function mapType(schema: Record<string, unknown>): ParamDef['type'] {
  const t = schema['type'] as string | undefined;
  if (t === 'integer') return 'integer';
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  return 'string';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const src = process.argv[2] ?? '../api/openapi.yaml';
  console.log(`Reading spec from: ${src}`);

  const raw = await readSource(src);
  const spec = src.endsWith('.json')
    ? (JSON.parse(raw) as Record<string, unknown>)
    : (parseYaml(raw) as Record<string, unknown>);

  const paths = spec['paths'] as Record<string, Record<string, unknown>>;
  const tools: ToolDef[] = [];

  for (const [endpoint, methods] of Object.entries(paths)) {
    const op = methods['get'] as Record<string, unknown> | undefined;
    if (!op) continue;

    const operationId = op['operationId'] as string;
    const summary = (op['summary'] as string) ?? '';
    const description = (op['description'] as string) ?? '';
    const rawParams = (op['parameters'] as Record<string, unknown>[]) ?? [];

    // Exclude JSONP callback — irrelevant in MCP context
    const params: ParamDef[] = rawParams
      .filter((p) => p['name'] !== 'callback')
      .map((p) => {
        const schema = (p['schema'] as Record<string, unknown>) ?? {};
        const enumVals = schema['enum'] as (string | number)[] | undefined;
        const def: ParamDef = {
          name: p['name'] as string,
          description: ((p['description'] as string) ?? '').replace(/\s+/g, ' ').trim(),
          required: (p['required'] as boolean) ?? false,
          type: mapType(schema),
        };
        if (enumVals !== undefined) def.enum = enumVals;
        if (schema['default'] !== undefined) def.default = schema['default'];
        if (schema['minimum'] !== undefined) def.minimum = schema['minimum'] as number;
        if (schema['maximum'] !== undefined) def.maximum = schema['maximum'] as number;
        return def;
      });

    const descText = [summary, description.replace(/\s+/g, ' ').trim()]
      .filter(Boolean)
      .join('\n\n');

    tools.push({
      name: toSnakeCase(operationId),
      description: descText,
      endpoint,
      method: 'GET',
      pageable: params.some((p) => p.name === 'start'),
      params,
    });
  }

  // Write generated output
  const outDir = path.join(__dirname, 'generated');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'tools.json'), JSON.stringify(tools, null, 2));
  fs.writeFileSync(path.join(outDir, 'spec.json'), JSON.stringify(spec, null, 2));

  console.log(`Generated ${tools.length} tools`);
  console.log('Output: generated/tools.json, generated/spec.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
