import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TOOL_TITLES, findUntitledTools, humanize, titleFor } from '../tool-titles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('humanize', () => {
  it('turns a snake_case tool name into Title Case', () => {
    assert.equal(humanize('get_birth_records'), 'Get Birth Records');
  });

  it('ignores empty segments', () => {
    assert.equal(humanize('get__births_'), 'Get Births');
  });
});

describe('titleFor', () => {
  it('returns the curated title for a known tool', () => {
    assert.equal(titleFor('get_births_years_ago'), 'Births N Years Ago');
    assert.equal(titleFor('get_census_data'), 'Census Data (1795–1899)');
    assert.equal(titleFor('view_transcription'), 'View Transcription (IIIF deep-zoom)');
  });

  it('falls back to Title Case for unknown tools', () => {
    assert.equal(titleFor('made_up_future_tool'), 'Made Up Future Tool');
  });
});

describe('findUntitledTools', () => {
  it('returns names not present in TOOL_TITLES', () => {
    assert.deepEqual(findUntitledTools(['get_archives', 'made_up_one', 'made_up_two']), [
      'made_up_one',
      'made_up_two',
    ]);
  });

  it('returns an empty list when every name has a title', () => {
    assert.deepEqual(findUntitledTools(['get_archives', 'show_record']), []);
  });
});

describe('TOOL_TITLES coverage of generated tools', () => {
  it('every tool emitted by generate.ts has a curated title', () => {
    const toolsPath = path.join(__dirname, '..', 'generated', 'tools.json');
    if (!fs.existsSync(toolsPath)) {
      // generate.ts hasn't been run yet (e.g., first checkout). Skip rather than
      // fail — the CI workflow runs `npm run generate` before tests.
      return;
    }
    const tools = JSON.parse(fs.readFileSync(toolsPath, 'utf8')) as Array<{ name: string }>;
    const untitled = findUntitledTools(tools.map((t) => t.name));
    assert.deepEqual(
      untitled,
      [],
      `Tools missing from TOOL_TITLES: ${untitled.join(', ')}\n` +
        'Add them to tool-titles.ts so MCP hosts show a human-readable label.',
    );
  });
});

describe('TOOL_TITLES matches the A2A agent card', () => {
  it('every agent-card skill name equals the curated tool title', () => {
    const cardPath = path.join(__dirname, '..', 'well-known', 'agent-card.json');
    const card = JSON.parse(fs.readFileSync(cardPath, 'utf8')) as {
      skills: Array<{ id: string; name: string }>;
    };
    const drift = card.skills
      .filter((s) => TOOL_TITLES[s.id] !== undefined && TOOL_TITLES[s.id] !== s.name)
      .map((s) => `${s.id}: card="${s.name}" vs title="${TOOL_TITLES[s.id]}"`);
    assert.deepEqual(drift, [], `agent-card.json drifted from TOOL_TITLES:\n${drift.join('\n')}`);
  });
});

describe('TOOL_TITLES is frozen', () => {
  it('rejects mutations at runtime', () => {
    assert.throws(() => {
      // @ts-expect-error - intentionally mutating frozen object
      TOOL_TITLES.get_archives = 'Nope';
    });
  });
});
