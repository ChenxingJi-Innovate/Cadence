'use client'
// Data quality scanner — hits the JD bullet "ensure accuracy, completeness,
// and timeliness of data". Runs a fixed battery of integrity checks against
// every table in the loaded warehouse.

import { runSql } from './db'

export type QualityCheck = {
  table: string
  check: string
  status: 'pass' | 'warn' | 'fail'
  metric: string
  detail: string
}

const TABLES = [
  'dim_artist','dim_track','dim_sound','dim_geo',
  'dwd_track_play_event','dwd_user_action_event','dwd_video_creation_event',
  'dws_artist_country_day','dws_track_country_day','ads_artist_growth_daily',
]

async function rowCount(table: string): Promise<number> {
  const r = await runSql(`SELECT COUNT(*) FROM ${table}`)
  return Number(r.rows[0]?.[0] ?? 0)
}

async function nullCount(table: string, col: string): Promise<number> {
  const r = await runSql(`SELECT COUNT(*) FROM ${table} WHERE ${col} IS NULL`)
  return Number(r.rows[0]?.[0] ?? 0)
}

async function distinctCount(table: string, col: string): Promise<number> {
  const r = await runSql(`SELECT COUNT(DISTINCT ${col}) FROM ${table}`)
  return Number(r.rows[0]?.[0] ?? 0)
}

async function maxDt(table: string): Promise<string | null> {
  try {
    const r = await runSql(`SELECT MAX(dt) FROM ${table}`)
    return r.rows[0]?.[0] as string | null
  } catch { return null }
}

export async function runQualityScan(): Promise<QualityCheck[]> {
  const checks: QualityCheck[] = []

  // 1. Completeness: row counts per table
  for (const t of TABLES) {
    try {
      const n = await rowCount(t)
      checks.push({
        table: t, check: 'row count',
        status: n > 0 ? 'pass' : 'fail',
        metric: n.toLocaleString(),
        detail: n > 0 ? `${n.toLocaleString()} rows present` : 'table is empty',
      })
    } catch (e) {
      checks.push({
        table: t, check: 'row count', status: 'fail',
        metric: 'err', detail: e instanceof Error ? e.message : String(e),
      })
    }
  }

  // 2. Accuracy: NULL count on critical foreign keys
  const nullChecks: [string, string][] = [
    ['dim_track', 'artist_id'],
    ['dwd_track_play_event', 'track_id'],
    ['dwd_track_play_event', 'country'],
    ['dwd_track_play_event', 'dt'],
    ['dwd_user_action_event', 'track_id'],
    ['dwd_video_creation_event', 'sound_id'],
  ]
  for (const [table, col] of nullChecks) {
    try {
      const n = await nullCount(table, col)
      checks.push({
        table, check: `NULL ${col}`,
        status: n === 0 ? 'pass' : n < 10 ? 'warn' : 'fail',
        metric: String(n),
        detail: n === 0 ? `no NULLs in ${col}` : `${n} NULL value(s) in ${col}`,
      })
    } catch (e) {
      checks.push({ table, check: `NULL ${col}`, status: 'fail', metric: 'err', detail: String(e) })
    }
  }

  // 3. Uniqueness: PK uniqueness sanity (artist_id, track_id, event_id samples)
  const uniqChecks: [string, string][] = [
    ['dim_artist', 'artist_id'],
    ['dim_track', 'track_id'],
    ['dwd_track_play_event', 'event_id'],
  ]
  for (const [table, col] of uniqChecks) {
    try {
      const total = await rowCount(table)
      const distinct = await distinctCount(table, col)
      checks.push({
        table, check: `${col} unique`,
        status: distinct === total ? 'pass' : 'fail',
        metric: `${distinct} / ${total}`,
        detail: distinct === total ? `${col} is fully unique` : `${total - distinct} duplicate(s) on ${col}`,
      })
    } catch (e) {
      checks.push({ table, check: `${col} unique`, status: 'fail', metric: 'err', detail: String(e) })
    }
  }

  // 4. Timeliness: latest dt per fact / aggregate table
  const dtTables = ['dwd_track_play_event', 'dws_artist_country_day', 'ads_artist_growth_daily']
  for (const t of dtTables) {
    const latest = await maxDt(t)
    const days = latest ? Math.floor((Date.parse('2026-04-25') - Date.parse(latest)) / 86_400_000) : null
    checks.push({
      table: t, check: 'latest dt',
      status: days === null ? 'fail' : days <= 1 ? 'pass' : days <= 7 ? 'warn' : 'fail',
      metric: latest ?? 'n/a',
      detail: latest ? `latest partition is ${days}d behind anchor (2026-04-25)` : 'no dt found',
    })
  }

  // 5. Referential integrity: orphan rows
  try {
    const orphans = await runSql(`
      SELECT COUNT(*) FROM dwd_track_play_event p
      LEFT JOIN dim_track t ON t.track_id = p.track_id
      WHERE t.track_id IS NULL
    `)
    const n = Number(orphans.rows[0]?.[0] ?? 0)
    checks.push({
      table: 'dwd_track_play_event', check: 'orphan track_id',
      status: n === 0 ? 'pass' : 'fail',
      metric: String(n),
      detail: n === 0 ? 'all track_id values resolve in dim_track' : `${n} play events reference missing tracks`,
    })
  } catch {}

  return checks
}
