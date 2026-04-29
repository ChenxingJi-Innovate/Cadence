import { SAMPLE_DDL, getSeedSql } from '../app/lib/sample'
import initSqlJs from 'sql.js'
import { readFileSync } from 'fs'

const wasmBinary = readFileSync('./node_modules/sql.js/dist/sql-wasm.wasm')

;(async () => {
  const SQL = await initSqlJs({ wasmBinary })
  const db = new SQL.Database()
  console.log('DDL...')
  db.exec(SAMPLE_DDL)
  console.log('seed...')
  const t0 = Date.now()
  db.exec(getSeedSql())
  console.log(`loaded in ${Date.now() - t0}ms`)

  const tables = [
    'dim_artist','dim_track','dim_sound','dim_geo',
    'dwd_track_play_event','dwd_user_action_event','dwd_video_creation_event',
    'dws_artist_country_day','dws_track_country_day','ads_artist_growth_daily',
  ]
  for (const t of tables) {
    const r = db.exec(`SELECT COUNT(*) FROM ${t}`)
    console.log(`${t.padEnd(28)} ${r[0].values[0][0]}`)
  }

  const r = db.exec(`
    SELECT a.name, a.tier, g.plays_d7, g.growth_pct_wow
    FROM ads_artist_growth_daily g
    JOIN dim_artist a ON a.artist_id = g.artist_id
    WHERE g.dt = '2026-04-25' AND a.tier = 'emerging'
    ORDER BY g.plays_d7 DESC LIMIT 5
  `)
  console.log('\nemerging-tier D7 leaderboard at latest dt:')
  console.log(r[0].columns.join('\t'))
  for (const row of r[0].values) console.log(row.join('\t'))

  db.close()
})()
