// "Content linking" lite (per IBM's text-to-SQL part 2):
// pull distinct values from key dimension columns and feed them to the LLM
// as canonical entity hints, so user-mentioned names ("BeatKid", "beat kid",
// "BEATKID") map to the actual stored value ('BeatKid'). For a clean demo
// this beats spinning up a vector store; a real production version would
// embed each distinct value and do nearest-neighbor lookup on the user's
// mentioned token.

import { runSql } from './db'

let _cache: string | null = null

export async function getEntityHints(): Promise<string> {
  if (_cache) return _cache

  const queries: Record<string, string> = {
    artists:   `SELECT name FROM dim_artist ORDER BY name`,
    tiers:     `SELECT DISTINCT tier FROM dim_artist ORDER BY tier`,
    countries: `SELECT country || ' (' || country_name || ')' FROM dim_geo ORDER BY country`,
    regions:   `SELECT DISTINCT region FROM dim_geo ORDER BY region`,
    genres:    `SELECT DISTINCT genre FROM dim_track ORDER BY genre`,
    sources:   `SELECT DISTINCT source FROM dwd_track_play_event ORDER BY source`,
    actions:   `SELECT DISTINCT action FROM dwd_user_action_event ORDER BY action`,
  }

  const lines: string[] = []
  for (const [name, sql] of Object.entries(queries)) {
    const r = await runSql(sql)
    const vals = r.rows.map(row => String(row[0]))
    lines.push(`${name}: ${vals.join(', ')}`)
  }

  _cache = lines.join('\n')
  return _cache
}
