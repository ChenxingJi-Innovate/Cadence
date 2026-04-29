// Auto-pick a chart for a query result.
// Heuristic: if there's a date-like column + at least one numeric → line chart
// else if a low-cardinality string column + numeric → bar chart
// else → table only.

import type { QueryResult } from './db'

export type ChartSpec =
  | { kind: 'line'; xKey: string; yKey: string; seriesKey?: string }
  | { kind: 'bar'; xKey: string; yKey: string }
  | { kind: 'none' }

const DATE_RE = /^\d{4}-\d{2}-\d{2}/

function inferType(values: (string | number | null)[]): 'date' | 'number' | 'string' {
  const sample = values.find(v => v !== null && v !== undefined)
  if (sample === undefined || sample === null) return 'string'
  if (typeof sample === 'number') return 'number'
  if (typeof sample === 'string' && DATE_RE.test(sample)) return 'date'
  return 'string'
}

export function detectChart(res: QueryResult): ChartSpec {
  if (res.rowCount === 0 || res.columns.length < 2) return { kind: 'none' }

  const cols = res.columns.map((c, i) => ({
    name: c,
    idx: i,
    type: inferType(res.rows.map(row => row[i])),
  }))

  const date = cols.find(c => c.type === 'date')
  const numeric = cols.find(c => c.type === 'number')
  const str = cols.find(c => c.type === 'string')

  if (date && numeric) {
    // optional series: a categorical column other than date
    const series = cols.find(c => c.type === 'string' && c.idx !== date.idx)
    return { kind: 'line', xKey: date.name, yKey: numeric.name, seriesKey: series?.name }
  }
  if (str && numeric && res.rowCount <= 30) {
    return { kind: 'bar', xKey: str.name, yKey: numeric.name }
  }
  return { kind: 'none' }
}

export function toChartData(res: QueryResult): Record<string, string | number | null>[] {
  return res.rows.map(row => {
    const obj: Record<string, string | number | null> = {}
    res.columns.forEach((c, i) => { obj[c] = row[i] })
    return obj
  })
}
