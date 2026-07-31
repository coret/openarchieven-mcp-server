/**
 * Human-readable tool titles.
 *
 * Every tool ships a curated label in both the top-level `title` (MCP ≥ 2025-06-18
 * `BaseMetadata`) and `annotations.title` (legacy `ToolAnnotations.title`), so hosts
 * that read either location can identify the tool in their UI.
 *
 * Labels are kept in sync with the skill names in well-known/agent-card.json.
 * Tools not listed here fall back to a mechanical Title Case of their snake_case
 * name — so a newly generated endpoint (`npm run refresh-spec`) still gets a title;
 * the coverage test in tests/tool-titles.test.ts surfaces the drift.
 */

export const TOOL_TITLES: Readonly<Record<string, string>> = Object.freeze({
  // Record search and lookup.
  search_records:         'Search Records',
  show_record:            'Show Record',
  match_record:           'Match Record',

  // Civil-registry events.
  get_births:             'Find Births',
  get_births_years_ago:   'Births N Years Ago',
  get_deaths:             'Find Deaths',
  get_marriages:          'Find Marriages',

  // Archives and aggregated stats.
  get_archives:           'List Archives',
  get_record_stats:       'Record Stats',
  get_source_type_stats:  'Source-Type Stats',
  get_event_type_stats:   'Event-Type Stats',
  get_comment_stats:      'Comment Stats',
  get_family_name_stats:  'Family-Name Stats',
  get_first_name_stats:   'First-Name Stats',
  get_profession_stats:   'Profession Stats',
  get_breakdown:          'Breakdown Stats',

  // Historical context datasets.
  get_historical_weather: 'Historical Weather',
  get_census_data:        'Census Data (1795–1899)',

  // Page transcriptions.
  search_transcriptions:  'Search Transcriptions',
  browse_transcriptions:  'Browse Transcriptions',
  show_transcription:     'Show Transcription',
  view_transcription:     'View Transcription (IIIF deep-zoom)',
} satisfies Record<string, string>);

/** snake_case → Title Case, used as the fallback label. */
export function humanize(snake: string): string {
  return snake
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function titleFor(toolName: string): string {
  return TOOL_TITLES[toolName] ?? humanize(toolName);
}

/** Tool names with no curated title — emit a warning at boot to surface generator drift. */
export function findUntitledTools(toolNames: readonly string[]): string[] {
  return toolNames.filter((n) => !(n in TOOL_TITLES));
}
