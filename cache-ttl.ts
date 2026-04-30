/**
 * Per-tool cache TTL strategy.
 *
 * Different endpoints have very different data volatility:
 *   - Historical weather/census : immutable (cache forever)
 *   - Archives metadata         : rarely changes (7 days)
 *   - Stats aggregations        : shift slowly as the index grows (1 day)
 *   - Individual record lookups : corrections are rare (1 day)
 *   - Search / match / births / : index grows in batches (6 hours)
 *     deaths / marriages /
 *     transcription search/browse
 *   - Years-ago                 : date-bound, rolls over at next UTC midnight
 *
 * Tools not in TOOL_TTL fall back to the caller-supplied default — preserving
 * existing behavior for any future endpoint a future generator pulls in
 * before this map is updated.
 */

export type TtlStrategy =
  | { kind: 'fixed'; seconds: number }
  | { kind: 'never' }
  | { kind: 'until_midnight' };

export const HOUR = 3600;
export const DAY = 24 * HOUR;

export const TOOL_TTL: Readonly<Record<string, TtlStrategy>> = Object.freeze({
  // Immutable historical data.
  get_historical_weather: { kind: 'never' },
  get_census_data:        { kind: 'never' },

  // Slowly-changing metadata.
  get_archives:           { kind: 'fixed', seconds: 7 * DAY },

  // Rolls over at the next UTC midnight.
  get_births_years_ago:   { kind: 'until_midnight' },

  // Aggregated stats — shift slowly with the index.
  get_record_stats:       { kind: 'fixed', seconds: DAY },
  get_source_type_stats:  { kind: 'fixed', seconds: DAY },
  get_event_type_stats:   { kind: 'fixed', seconds: DAY },
  get_comment_stats:      { kind: 'fixed', seconds: DAY },
  get_family_name_stats:  { kind: 'fixed', seconds: DAY },
  get_first_name_stats:   { kind: 'fixed', seconds: DAY },
  get_profession_stats:   { kind: 'fixed', seconds: DAY },
  get_breakdown:          { kind: 'fixed', seconds: DAY },

  // Individual record lookups — corrections by source archives are rare.
  show_record:            { kind: 'fixed', seconds: DAY },
  show_transcription:     { kind: 'fixed', seconds: DAY },

  // Search-style queries — results can shift as new batches are ingested.
  search_records:         { kind: 'fixed', seconds: 6 * HOUR },
  match_record:           { kind: 'fixed', seconds: 6 * HOUR },
  get_births:             { kind: 'fixed', seconds: 6 * HOUR },
  get_deaths:             { kind: 'fixed', seconds: 6 * HOUR },
  get_marriages:          { kind: 'fixed', seconds: 6 * HOUR },
  search_transcriptions:  { kind: 'fixed', seconds: 6 * HOUR },
  browse_transcriptions:  { kind: 'fixed', seconds: 6 * HOUR },
} satisfies Record<string, TtlStrategy>);

/**
 * Seconds remaining until the next UTC midnight, ceiled so the result is
 * always ≥1 (Redis EX rejects 0).
 */
export function secondsUntilUtcMidnight(now: Date = new Date()): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.ceil((next.getTime() - now.getTime()) / 1000);
}

export function resolveTtl(toolName: string, fallbackSeconds: number): TtlStrategy {
  return TOOL_TTL[toolName] ?? { kind: 'fixed', seconds: fallbackSeconds };
}

/** Tool names with no TTL entry — emit a warning at boot to surface generator drift. */
export function findUnmappedTools(toolNames: readonly string[]): string[] {
  return toolNames.filter((n) => !(n in TOOL_TTL));
}
