'use client'
// In-browser SQLite via sql.js. Single shared DB instance per session.
import initSqlJs, { Database, SqlJsStatic } from 'sql.js'
import { SAMPLE_DDL, getSeedSql } from './sample'

let _SQL: SqlJsStatic | null = null
let _db: Database | null = null
let _initPromise: Promise<Database> | null = null

async function loadSqlJs(): Promise<SqlJsStatic> {
  if (_SQL) return _SQL
  // Pre-fetch the wasm bytes ourselves and hand them to sql.js via wasmBinary.
  // This bypasses Emscripten's locateFile + instantiateStreaming path, which is
  // brittle inside Next.js dev (HMR + module wrapping) and was the source of
  // "both async and sync fetching of the wasm failed".
  const candidates = ['/sql-wasm.wasm', 'https://sql.js.org/dist/sql-wasm.wasm']
  let wasmBinary: ArrayBuffer | null = null
  let lastErr: unknown = null
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: 'force-cache' })
      if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`)
      wasmBinary = await res.arrayBuffer()
      break
    } catch (e) { lastErr = e }
  }
  if (!wasmBinary) throw new Error(`Could not load sql-wasm.wasm: ${String(lastErr)}`)
  _SQL = await initSqlJs({ wasmBinary })
  return _SQL
}

export async function getDb(): Promise<Database> {
  if (_db) return _db
  if (_initPromise) return _initPromise
  const p = (async () => {
    try {
      const SQL = await loadSqlJs()
      const fresh = new SQL.Database()
      fresh.exec(SAMPLE_DDL)
      fresh.exec(getSeedSql())
      _db = fresh
      return fresh
    } catch (e) {
      // Don't leave a rejected promise cached — let the next call retry from scratch.
      _initPromise = null
      _SQL = null
      throw e
    }
  })()
  _initPromise = p
  return p
}

export type QueryResult = {
  columns: string[]
  rows: (string | number | null)[][]
  rowCount: number
}

export async function runSql(sqlText: string): Promise<QueryResult> {
  const db = await getDb()
  const stmts = db.exec(sqlText)
  // Use the LAST statement's result (so a user could include comments / setup).
  const last = stmts[stmts.length - 1]
  if (!last) return { columns: [], rows: [], rowCount: 0 }
  return {
    columns: last.columns,
    rows: last.values as (string | number | null)[][],
    rowCount: last.values.length,
  }
}

export async function resetDb(): Promise<void> {
  _db?.close()
  _db = null
  _initPromise = null
  await getDb()
}
