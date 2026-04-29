'use client'
// CSV ingestion — JD bullet "data collection". User uploads any CSV; we infer
// column types, build a CREATE TABLE, and bulk-insert into the live SQLite.
// The new table joins the warehouse alongside dim_/dwd_/etc.

import { getDb } from './db'

export type CsvImport = {
  table: string
  columns: { name: string; type: 'INTEGER' | 'REAL' | 'TEXT' }[]
  rowsInserted: number
}

function detectType(values: string[]): 'INTEGER' | 'REAL' | 'TEXT' {
  let allInt = true, allNum = true
  for (const v of values) {
    if (v === '' || v == null) continue
    if (!/^-?\d+$/.test(v)) allInt = false
    if (!/^-?\d+(\.\d+)?$/.test(v)) { allNum = false; break }
  }
  if (allInt) return 'INTEGER'
  if (allNum) return 'REAL'
  return 'TEXT'
}

// Minimal CSV parser — handles quoted fields, escaped quotes, CRLF.
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++ }
        else inQuotes = false
      } else cur += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(cur); cur = '' }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
      else if (c === '\r') {/* skip */}
      else cur += c
    }
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row) }
  return rows
}

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase().replace(/^_+|_+$/g, '') || 'col'

export async function importCsv(text: string, tableName: string): Promise<CsvImport> {
  const parsed = parseCsv(text).filter(r => r.some(c => c.length > 0))
  if (parsed.length < 2) throw new Error('CSV must have a header row + at least one data row')

  const headers = parsed[0].map(sanitize)
  const dataRows = parsed.slice(1)

  const columns = headers.map((name, i) => ({
    name,
    type: detectType(dataRows.slice(0, 200).map(r => r[i] ?? '')),
  }))

  const safeTable = sanitize(tableName)
  const db = await getDb()
  db.exec(`DROP TABLE IF EXISTS ${safeTable}`)
  db.exec(`CREATE TABLE ${safeTable} (${columns.map(c => `${c.name} ${c.type}`).join(', ')})`)

  const placeholders = '(' + columns.map(() => '?').join(',') + ')'
  const stmt = db.prepare(`INSERT INTO ${safeTable} VALUES ${placeholders}`)
  for (const r of dataRows) {
    const values = columns.map((c, i) => {
      const v = r[i]
      if (v == null || v === '') return null
      if (c.type === 'INTEGER') return parseInt(v, 10)
      if (c.type === 'REAL') return parseFloat(v)
      return v
    })
    stmt.run(values as never)
  }
  stmt.free()

  return { table: safeTable, columns, rowsInserted: dataRows.length }
}
