import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DAY,
  HOUR,
  TOOL_TTL,
  findUnmappedTools,
  resolveTtl,
  secondsUntilUtcMidnight,
} from '../cache-ttl.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('secondsUntilUtcMidnight', () => {
  it('returns 24h when called exactly at UTC midnight', () => {
    const noon = new Date('2026-01-15T00:00:00.000Z');
    assert.equal(secondsUntilUtcMidnight(noon), DAY);
  });

  it('returns 12h when called at noon UTC', () => {
    const noon = new Date('2026-01-15T12:00:00.000Z');
    assert.equal(secondsUntilUtcMidnight(noon), 12 * HOUR);
  });

  it('returns 1 second at one millisecond before midnight (ceil, never zero)', () => {
    const eve = new Date('2026-01-15T23:59:59.999Z');
    assert.equal(secondsUntilUtcMidnight(eve), 1);
  });

  it('returns at most 86_400 seconds for any input', () => {
    for (const iso of [
      '2026-01-15T00:00:00.000Z',
      '2026-06-30T08:30:00.000Z',
      '2026-12-31T23:59:59.999Z',
    ]) {
      const s = secondsUntilUtcMidnight(new Date(iso));
      assert.ok(s >= 1 && s <= DAY, `out of range for ${iso}: ${s}`);
    }
  });

  it('crosses month boundaries correctly (Jan 31 → Feb 1)', () => {
    const eve = new Date('2026-01-31T22:00:00.000Z');
    assert.equal(secondsUntilUtcMidnight(eve), 2 * HOUR);
  });

  it('crosses year boundaries correctly (Dec 31 → Jan 1)', () => {
    const eve = new Date('2026-12-31T23:00:00.000Z');
    assert.equal(secondsUntilUtcMidnight(eve), HOUR);
  });
});

describe('resolveTtl', () => {
  it('returns the mapped strategy for a known tool', () => {
    assert.deepEqual(resolveTtl('get_historical_weather', 3600), { kind: 'never' });
    assert.deepEqual(resolveTtl('get_archives', 3600), { kind: 'fixed', seconds: 7 * DAY });
    assert.deepEqual(resolveTtl('get_births_years_ago', 3600), { kind: 'until_midnight' });
  });

  it('falls back to a fixed strategy with the supplied default for unknown tools', () => {
    assert.deepEqual(resolveTtl('made_up_future_tool', 1234), {
      kind: 'fixed',
      seconds: 1234,
    });
  });
});

describe('findUnmappedTools', () => {
  it('returns names not present in TOOL_TTL', () => {
    assert.deepEqual(findUnmappedTools(['get_archives', 'made_up_one', 'made_up_two']), [
      'made_up_one',
      'made_up_two',
    ]);
  });

  it('returns an empty list when every name is mapped', () => {
    assert.deepEqual(findUnmappedTools(['get_archives', 'show_record']), []);
  });
});

describe('TOOL_TTL coverage of generated tools', () => {
  it('every tool emitted by generate.ts has an explicit TTL entry', () => {
    const toolsPath = path.join(__dirname, '..', 'generated', 'tools.json');
    if (!fs.existsSync(toolsPath)) {
      // generate.ts hasn't been run yet (e.g., first checkout). Skip rather than
      // fail — the CI workflow runs `npm run generate` before tests.
      return;
    }
    const tools = JSON.parse(fs.readFileSync(toolsPath, 'utf8')) as Array<{ name: string }>;
    const unmapped = findUnmappedTools(tools.map((t) => t.name));
    assert.deepEqual(
      unmapped,
      [],
      `Tools missing from TOOL_TTL: ${unmapped.join(', ')}\n` +
        'Add them to cache-ttl.ts or accept the CACHE_TTL fallback intentionally.',
    );
  });
});

describe('TOOL_TTL is frozen', () => {
  it('rejects mutations at runtime', () => {
    assert.throws(() => {
      // @ts-expect-error - intentionally mutating frozen object
      TOOL_TTL.get_archives = { kind: 'never' };
    });
  });
});
