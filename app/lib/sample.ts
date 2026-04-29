// Big-company 4-layer warehouse pattern (DIM / DWD / DWS / ADS).
// Modeled on how TikTok/ByteDance and similar music-analytics teams structure
// their warehouses:
//   dim_*  slowly-changing dimensions (artists, tracks, sounds, geo)
//   dwd_*  cleaned fact events (one row per event), partitioned by dt
//   dws_*  pre-aggregated wide cubes (artist × country × day, etc.)
//   ads_*  application marts feeding dashboards / artist-services tools
//
// SQLite has no native partitioning, so dt (YYYY-MM-DD) + an index is the
// canonical proxy. Times are stored as TEXT in 'YYYY-MM-DD HH:MM:SS' UTC.

export const SAMPLE_DDL = `-- ─────────────────────────────────────────────────────────
-- DIM LAYER — slowly-changing dimensions
-- ─────────────────────────────────────────────────────────

CREATE TABLE dim_artist (
  artist_id             INTEGER PRIMARY KEY,
  artist_external_id    TEXT,
  name                  TEXT NOT NULL,
  country               TEXT,
  tier                  TEXT,
  label_name            TEXT,
  is_verified           INTEGER DEFAULT 0,
  signed_at             TEXT,
  monthly_listener_band TEXT,
  is_active             INTEGER DEFAULT 1,
  created_at            TEXT,
  updated_at            TEXT
);

CREATE TABLE dim_track (
  track_id     INTEGER PRIMARY KEY,
  artist_id    INTEGER REFERENCES dim_artist(artist_id),
  album_id     INTEGER,
  title        TEXT NOT NULL,
  isrc         TEXT,
  language     TEXT,
  genre        TEXT,
  duration_ms  INTEGER,
  release_date TEXT,
  is_explicit  INTEGER DEFAULT 0,
  is_active    INTEGER DEFAULT 1,
  created_at   TEXT,
  updated_at   TEXT
);

CREATE TABLE dim_sound (
  sound_id    INTEGER PRIMARY KEY,
  track_id    INTEGER REFERENCES dim_track(track_id),
  is_original INTEGER DEFAULT 0,
  duration_ms INTEGER,
  created_at  TEXT
);

CREATE TABLE dim_geo (
  country            TEXT PRIMARY KEY,
  country_name       TEXT,
  region             TEXT,
  is_priority_market INTEGER DEFAULT 0
);

-- ─────────────────────────────────────────────────────────
-- DWD LAYER — cleaned fact events (partitioned by dt in production)
-- ─────────────────────────────────────────────────────────

CREATE TABLE dwd_track_play_event (
  event_id       INTEGER PRIMARY KEY,
  dt             TEXT NOT NULL,
  event_time     TEXT,
  user_id        INTEGER,
  device_id      TEXT,
  track_id       INTEGER REFERENCES dim_track(track_id),
  sound_id       INTEGER REFERENCES dim_sound(sound_id),
  source         TEXT,
  country        TEXT REFERENCES dim_geo(country),
  os             TEXT,
  app_version    TEXT,
  ms_played      INTEGER,
  completion_pct REAL,
  is_skip        INTEGER DEFAULT 0
);
CREATE INDEX idx_dwd_play_dt    ON dwd_track_play_event(dt);
CREATE INDEX idx_dwd_play_track ON dwd_track_play_event(track_id);

CREATE TABLE dwd_user_action_event (
  event_id   INTEGER PRIMARY KEY,
  dt         TEXT NOT NULL,
  event_time TEXT,
  user_id    INTEGER,
  track_id   INTEGER REFERENCES dim_track(track_id),
  action     TEXT,
  country    TEXT,
  os         TEXT
);
CREATE INDEX idx_dwd_action_dt ON dwd_user_action_event(dt);

CREATE TABLE dwd_video_creation_event (
  event_id    INTEGER PRIMARY KEY,
  dt          TEXT NOT NULL,
  event_time  TEXT,
  creator_id  INTEGER,
  video_id    INTEGER,
  sound_id    INTEGER REFERENCES dim_sound(sound_id),
  track_id    INTEGER REFERENCES dim_track(track_id),
  country     TEXT,
  view_count  INTEGER,
  like_count  INTEGER,
  share_count INTEGER
);
CREATE INDEX idx_dwd_video_dt ON dwd_video_creation_event(dt);

-- ─────────────────────────────────────────────────────────
-- DWS LAYER — pre-aggregated cubes (built from DWD via SQL)
-- ─────────────────────────────────────────────────────────

CREATE TABLE dws_artist_country_day (
  dt               TEXT,
  artist_id        INTEGER REFERENCES dim_artist(artist_id),
  country          TEXT,
  plays            INTEGER,
  unique_listeners INTEGER,
  likes            INTEGER,
  shares           INTEGER,
  saves            INTEGER,
  video_creations  INTEGER,
  PRIMARY KEY (dt, artist_id, country)
);

CREATE TABLE dws_track_country_day (
  dt               TEXT,
  track_id         INTEGER REFERENCES dim_track(track_id),
  country          TEXT,
  plays            INTEGER,
  unique_listeners INTEGER,
  completion_avg   REAL,
  skip_rate        REAL,
  video_creations  INTEGER,
  PRIMARY KEY (dt, track_id, country)
);

-- ─────────────────────────────────────────────────────────
-- ADS LAYER — application mart for artist-services dashboards
-- ─────────────────────────────────────────────────────────

CREATE TABLE ads_artist_growth_daily (
  dt             TEXT,
  artist_id      INTEGER REFERENCES dim_artist(artist_id),
  plays_d1       INTEGER,
  plays_d7       INTEGER,
  plays_d28      INTEGER,
  listeners_d7   INTEGER,
  videos_d7      INTEGER,
  growth_pct_wow REAL,
  PRIMARY KEY (dt, artist_id)
);`

// Deterministic RNG so the demo is reproducible.
function mulberry32(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const sqlEscape = (s: string) => s.replace(/'/g, "''")

type Artist = {
  artist_id: number; artist_external_id: string; name: string; country: string;
  tier: 'emerging' | 'established' | 'superstar';
  label_name: string; is_verified: number; signed_at: string;
  monthly_listener_band: string;
}
type Track = {
  track_id: number; artist_id: number; album_id: number; title: string;
  isrc: string; language: string; genre: string; duration_ms: number;
  release_date: string; is_explicit: number;
}

function buildSeed(): string {
  const r = mulberry32(42)
  const pick = <T,>(arr: T[]) => arr[Math.floor(r() * arr.length)]
  const randInt = (lo: number, hi: number) => Math.floor(r() * (hi - lo + 1)) + lo

  // ── dim_geo ──────────────────────────────────────────────
  const geo = [
    { country: 'US', country_name: 'United States',  region: 'NAMER', is_priority_market: 1 },
    { country: 'BR', country_name: 'Brazil',         region: 'LATAM', is_priority_market: 1 },
    { country: 'MX', country_name: 'Mexico',         region: 'LATAM', is_priority_market: 1 },
    { country: 'ID', country_name: 'Indonesia',      region: 'APAC',  is_priority_market: 1 },
    { country: 'KR', country_name: 'South Korea',    region: 'APAC',  is_priority_market: 1 },
    { country: 'JP', country_name: 'Japan',          region: 'APAC',  is_priority_market: 1 },
    { country: 'IN', country_name: 'India',          region: 'APAC',  is_priority_market: 1 },
    { country: 'PH', country_name: 'Philippines',    region: 'APAC',  is_priority_market: 0 },
    { country: 'VN', country_name: 'Vietnam',        region: 'APAC',  is_priority_market: 0 },
    { country: 'TH', country_name: 'Thailand',       region: 'APAC',  is_priority_market: 0 },
    { country: 'GB', country_name: 'United Kingdom', region: 'EMEA',  is_priority_market: 1 },
    { country: 'DE', country_name: 'Germany',        region: 'EMEA',  is_priority_market: 0 },
  ]

  // ── dim_artist ───────────────────────────────────────────
  const artists: Artist[] = [
    { artist_id: 1, artist_external_id: 'EXT-A001', name: 'Lia Park',        country: 'KR', tier: 'emerging',    label_name: 'Indie',         is_verified: 1, signed_at: '2024-09-12', monthly_listener_band: '100k-1M' },
    { artist_id: 2, artist_external_id: 'EXT-A002', name: 'BeatKid',         country: 'US', tier: 'established', label_name: 'Atlantic',      is_verified: 1, signed_at: '2022-03-04', monthly_listener_band: '>1M' },
    { artist_id: 3, artist_external_id: 'EXT-A003', name: 'Indah Sari',      country: 'ID', tier: 'emerging',    label_name: 'Self',          is_verified: 0, signed_at: '2025-01-21', monthly_listener_band: '10k-100k' },
    { artist_id: 4, artist_external_id: 'EXT-A004', name: 'Marina Costa',    country: 'BR', tier: 'superstar',   label_name: 'Sony Music BR', is_verified: 1, signed_at: '2020-06-15', monthly_listener_band: '>1M' },
    { artist_id: 5, artist_external_id: 'EXT-A005', name: 'Aarav',           country: 'IN', tier: 'emerging',    label_name: 'Self',          is_verified: 0, signed_at: '2025-02-08', monthly_listener_band: '<10k' },
    { artist_id: 6, artist_external_id: 'EXT-A006', name: 'Nova Lin',        country: 'US', tier: 'established', label_name: 'Republic',      is_verified: 1, signed_at: '2023-11-30', monthly_listener_band: '100k-1M' },
    { artist_id: 7, artist_external_id: 'EXT-A007', name: 'Yuki Hoshino',    country: 'JP', tier: 'emerging',    label_name: 'Indie',         is_verified: 0, signed_at: '2025-03-15', monthly_listener_band: '10k-100k' },
    { artist_id: 8, artist_external_id: 'EXT-A008', name: 'Carmen Vega',     country: 'MX', tier: 'established', label_name: 'Universal LA',  is_verified: 1, signed_at: '2021-08-22', monthly_listener_band: '>1M' },
  ]

  // ── dim_track ────────────────────────────────────────────
  const trackTitles = [
    'Midnight Drive','Honey Slow','Kerosene','Lemonade Sky','Loop You In','Static Rain',
    'Petal Storm','Cloud Floor','Velvet Hours','Open Window','After Glow','Soft Static',
    'Hourglass','Slow Bloom','Tape Loop','Paper Plane','Neon Tide','Ribbon','Mirror Lake',
    'Gold Hour','Boom Boom','Cinta Lama','Saudade','Tokyo Sundown',
  ]
  const genres = ['pop','hip-hop','rnb','edm','k-pop','latin','j-pop','indonesian-pop','indie']
  const langs  = ['en','ko','id','pt','hi','ja','es']

  const tracks: Track[] = []
  let tid = 1
  for (const a of artists) {
    const n = randInt(2, 4)
    for (let i = 0; i < n; i++) {
      const offset = randInt(0, 200)
      const d = new Date('2025-09-01'); d.setDate(d.getDate() - offset)
      tracks.push({
        track_id: tid,
        artist_id: a.artist_id,
        album_id: 100 + Math.floor(tid / 3),
        title: pick(trackTitles),
        isrc: `XX-${String(2024 + (tid % 2)).slice(2)}-${String(tid).padStart(5,'0')}`,
        language: pick(langs),
        genre: pick(genres),
        duration_ms: randInt(150_000, 240_000),
        release_date: d.toISOString().slice(0,10),
        is_explicit: r() < 0.15 ? 1 : 0,
      })
      tid++
    }
  }

  // ── dim_sound ────────────────────────────────────────────
  // One sound per track + a few user-original sounds (no track).
  const sounds: { sound_id: number; track_id: number | null; is_original: number; duration_ms: number; created_at: string }[] = []
  let sid = 1
  for (const tr of tracks) {
    sounds.push({ sound_id: sid++, track_id: tr.track_id, is_original: 0, duration_ms: randInt(15_000, 30_000), created_at: tr.release_date + ' 00:00:00' })
  }
  for (let i = 0; i < 8; i++) {
    sounds.push({ sound_id: sid++, track_id: null, is_original: 1, duration_ms: randInt(8_000, 30_000), created_at: '2026-04-' + String(randInt(1, 25)).padStart(2,'0') + ' 12:00:00' })
  }

  // ── DWD events ───────────────────────────────────────────
  const anchor = new Date('2026-04-25')
  const sources = ['fyp','search','profile','playlist','music_tab']
  const oses = ['ios','android']
  const appVersions = ['33.5.0','33.6.1','34.0.0','34.1.0']
  const actions = ['like','share','save','follow_artist','use_in_video']

  const playRows: string[] = []
  let pid = 1
  for (let day = 0; day < 60; day++) {
    const d = new Date(anchor); d.setDate(d.getDate() - day)
    const dt = d.toISOString().slice(0,10)
    const dayPlays = randInt(50, 90)
    for (let i = 0; i < dayPlays; i++) {
      // Tier weighting + emerging-rise in the last 14 days for "growth" queries to have signal.
      let artist = artists[Math.floor(r() * artists.length)]
      if (day < 14 && r() < 0.45) artist = artists[2] // Indah Sari surge
      if (day < 7  && r() < 0.30) artist = artists[6] // Yuki Hoshino late-emerging

      const tracksOfArtist = tracks.filter(t => t.artist_id === artist.artist_id)
      const tr = pick(tracksOfArtist)
      const sd = sounds.find(s => s.track_id === tr.track_id)!
      const country = pick(geo).country
      const ms = randInt(8_000, tr.duration_ms)
      const completion = ms / tr.duration_ms
      const isSkip = completion < 0.30 ? 1 : 0
      const eventTime = `${dt} ${String(randInt(0,23)).padStart(2,'0')}:${String(randInt(0,59)).padStart(2,'0')}:${String(randInt(0,59)).padStart(2,'0')}`
      playRows.push(`(${pid},'${dt}','${eventTime}',${randInt(1,5000)},'dev_${randInt(1000,9999)}',${tr.track_id},${sd.sound_id},'${pick(sources)}','${country}','${pick(oses)}','${pick(appVersions)}',${ms},${completion.toFixed(3)},${isSkip})`)
      pid++
    }
  }

  const actionRows: string[] = []
  let aid = 1
  for (let i = 0; i < 800; i++) {
    const tr = pick(tracks)
    const day = randInt(0, 59)
    const d = new Date(anchor); d.setDate(d.getDate() - day)
    const dt = d.toISOString().slice(0,10)
    const eventTime = `${dt} ${String(randInt(0,23)).padStart(2,'0')}:${String(randInt(0,59)).padStart(2,'0')}:${String(randInt(0,59)).padStart(2,'0')}`
    actionRows.push(`(${aid},'${dt}','${eventTime}',${randInt(1,5000)},${tr.track_id},'${pick(actions)}','${pick(geo).country}','${pick(oses)}')`)
    aid++
  }

  const videoRows: string[] = []
  let vid = 1
  for (let i = 0; i < 320; i++) {
    // Some sounds are "viral" with disproportionate UGC volume.
    let s = pick(sounds)
    if (r() < 0.25) s = sounds[2] || s   // first real track sound becomes viral
    if (r() < 0.15) s = sounds[sounds.length - 1] // a UGC-original sound also viral
    const day = randInt(0, 59)
    const d = new Date(anchor); d.setDate(d.getDate() - day)
    const dt = d.toISOString().slice(0,10)
    const eventTime = `${dt} ${String(randInt(0,23)).padStart(2,'0')}:${String(randInt(0,59)).padStart(2,'0')}:${String(randInt(0,59)).padStart(2,'0')}`
    const trackId = s.track_id === null ? 'NULL' : String(s.track_id)
    videoRows.push(`(${vid},'${dt}','${eventTime}',${randInt(1,80000)},${randInt(100000,999999)},${s.sound_id},${trackId},'${pick(geo).country}',${randInt(120,800_000)},${randInt(0,50_000)},${randInt(0,5_000)})`)
    vid++
  }

  // Multi-row INSERTs (chunked to keep individual statements small).
  const chunk = <T,>(arr: T[], n: number) => {
    const out: T[][] = []
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
    return out
  }
  const wrap = (table: string, cols: string, rows: string[]) =>
    chunk(rows, 400).map(c => `INSERT INTO ${table} (${cols}) VALUES\n${c.join(',\n')};`).join('\n')

  const geoInserts = `INSERT INTO dim_geo (country,country_name,region,is_priority_market) VALUES\n${
    geo.map(g => `('${g.country}','${sqlEscape(g.country_name)}','${g.region}',${g.is_priority_market})`).join(',\n')
  };`

  const artistInserts = `INSERT INTO dim_artist (artist_id,artist_external_id,name,country,tier,label_name,is_verified,signed_at,monthly_listener_band,is_active,created_at,updated_at) VALUES\n${
    artists.map(a => `(${a.artist_id},'${a.artist_external_id}','${sqlEscape(a.name)}','${a.country}','${a.tier}','${sqlEscape(a.label_name)}',${a.is_verified},'${a.signed_at}','${a.monthly_listener_band}',1,'${a.signed_at} 00:00:00','${a.signed_at} 00:00:00')`).join(',\n')
  };`

  const trackInserts = `INSERT INTO dim_track (track_id,artist_id,album_id,title,isrc,language,genre,duration_ms,release_date,is_explicit,is_active,created_at,updated_at) VALUES\n${
    tracks.map(t => `(${t.track_id},${t.artist_id},${t.album_id},'${sqlEscape(t.title)}','${t.isrc}','${t.language}','${t.genre}',${t.duration_ms},'${t.release_date}',${t.is_explicit},1,'${t.release_date} 00:00:00','${t.release_date} 00:00:00')`).join(',\n')
  };`

  const soundInserts = `INSERT INTO dim_sound (sound_id,track_id,is_original,duration_ms,created_at) VALUES\n${
    sounds.map(s => `(${s.sound_id},${s.track_id === null ? 'NULL' : s.track_id},${s.is_original},${s.duration_ms},'${s.created_at}')`).join(',\n')
  };`

  const playInserts   = wrap('dwd_track_play_event',     'event_id,dt,event_time,user_id,device_id,track_id,sound_id,source,country,os,app_version,ms_played,completion_pct,is_skip', playRows)
  const actionInserts = wrap('dwd_user_action_event',    'event_id,dt,event_time,user_id,track_id,action,country,os', actionRows)
  const videoInserts  = wrap('dwd_video_creation_event', 'event_id,dt,event_time,creator_id,video_id,sound_id,track_id,country,view_count,like_count,share_count', videoRows)

  // DWS layer: aggregate from DWD using SQL itself (mirrors how a real warehouse populates downstream layers).
  const dwsRollup = `
INSERT INTO dws_artist_country_day (dt, artist_id, country, plays, unique_listeners, likes, shares, saves, video_creations)
SELECT
  p.dt,
  t.artist_id,
  p.country,
  COUNT(*)                                                               AS plays,
  COUNT(DISTINCT p.user_id)                                              AS unique_listeners,
  COALESCE(la.likes,  0)                                                 AS likes,
  COALESCE(la.shares, 0)                                                 AS shares,
  COALESCE(la.saves,  0)                                                 AS saves,
  COALESCE(vc.video_creations, 0)                                        AS video_creations
FROM dwd_track_play_event p
JOIN dim_track t ON t.track_id = p.track_id
LEFT JOIN (
  SELECT a.dt, t.artist_id, a.country,
         SUM(CASE WHEN a.action='like'  THEN 1 ELSE 0 END) AS likes,
         SUM(CASE WHEN a.action='share' THEN 1 ELSE 0 END) AS shares,
         SUM(CASE WHEN a.action='save'  THEN 1 ELSE 0 END) AS saves
  FROM dwd_user_action_event a
  JOIN dim_track t ON t.track_id = a.track_id
  GROUP BY a.dt, t.artist_id, a.country
) la ON la.dt = p.dt AND la.artist_id = t.artist_id AND la.country = p.country
LEFT JOIN (
  SELECT v.dt, t.artist_id, v.country, COUNT(*) AS video_creations
  FROM dwd_video_creation_event v
  JOIN dim_track t ON t.track_id = v.track_id
  GROUP BY v.dt, t.artist_id, v.country
) vc ON vc.dt = p.dt AND vc.artist_id = t.artist_id AND vc.country = p.country
GROUP BY p.dt, t.artist_id, p.country;

INSERT INTO dws_track_country_day (dt, track_id, country, plays, unique_listeners, completion_avg, skip_rate, video_creations)
SELECT
  p.dt,
  p.track_id,
  p.country,
  COUNT(*)                                                AS plays,
  COUNT(DISTINCT p.user_id)                               AS unique_listeners,
  ROUND(AVG(p.completion_pct), 3)                         AS completion_avg,
  ROUND(1.0 * SUM(p.is_skip) / COUNT(*), 3)               AS skip_rate,
  COALESCE(vc.video_creations, 0)                         AS video_creations
FROM dwd_track_play_event p
LEFT JOIN (
  SELECT dt, track_id, country, COUNT(*) AS video_creations
  FROM dwd_video_creation_event
  WHERE track_id IS NOT NULL
  GROUP BY dt, track_id, country
) vc ON vc.dt = p.dt AND vc.track_id = p.track_id AND vc.country = p.country
GROUP BY p.dt, p.track_id, p.country;`

  // ADS layer: rolling windows for the artist-services dashboard.
  const adsRollup = `
INSERT INTO ads_artist_growth_daily (dt, artist_id, plays_d1, plays_d7, plays_d28, listeners_d7, videos_d7, growth_pct_wow)
WITH base AS (
  SELECT dt, artist_id,
         SUM(plays)            AS plays,
         SUM(unique_listeners) AS listeners,
         SUM(video_creations)  AS videos
  FROM dws_artist_country_day
  GROUP BY dt, artist_id
)
SELECT
  b.dt,
  b.artist_id,
  b.plays                                                                                AS plays_d1,
  SUM(b.plays)     OVER (PARTITION BY b.artist_id ORDER BY b.dt ROWS  6 PRECEDING)       AS plays_d7,
  SUM(b.plays)     OVER (PARTITION BY b.artist_id ORDER BY b.dt ROWS 27 PRECEDING)       AS plays_d28,
  SUM(b.listeners) OVER (PARTITION BY b.artist_id ORDER BY b.dt ROWS  6 PRECEDING)       AS listeners_d7,
  SUM(b.videos)    OVER (PARTITION BY b.artist_id ORDER BY b.dt ROWS  6 PRECEDING)       AS videos_d7,
  ROUND(
    100.0 * (
      SUM(b.plays) OVER (PARTITION BY b.artist_id ORDER BY b.dt ROWS  6 PRECEDING)
      - COALESCE(SUM(b.plays) OVER (PARTITION BY b.artist_id ORDER BY b.dt ROWS BETWEEN 13 PRECEDING AND 7 PRECEDING), 0)
    )
    / NULLIF(SUM(b.plays) OVER (PARTITION BY b.artist_id ORDER BY b.dt ROWS BETWEEN 13 PRECEDING AND 7 PRECEDING), 0),
    1
  ) AS growth_pct_wow
FROM base b;`

  return [
    geoInserts,
    artistInserts,
    trackInserts,
    soundInserts,
    playInserts,
    actionInserts,
    videoInserts,
    dwsRollup,
    adsRollup,
  ].join('\n\n')
}

let _seedCache: string | null = null
export function getSeedSql(): string {
  if (_seedCache) return _seedCache
  _seedCache = buildSeed()
  return _seedCache
}

// Demo questions tuned to the layered schema.
// Each one exercises a specific JD-relevant SQL skill: time windows, JOINs across
// dim+dwd, window functions, CTEs, ratio metrics.
// Sample questions tuned to the demo's actual data scale (8 artists, ~24 tracks,
// 12 countries, 60 days). Numbers like "Top 10" are intentionally avoided —
// the seed simply doesn't have 10 emerging-tier artists in APAC, so a real
// "Top 10" query returns 4 rows and looks broken. Phrasing without explicit
// caps lets the LLM pick a sensible LIMIT for the data on hand.
export const SAMPLE_QUESTIONS = [
  '过去 30 天每个国家的总播放量,优先市场打 priority 标签,按播放量降序',
  'Emerging-tier artists in APAC ranked by week-over-week growth',
  '7-day rolling plays per artist over the last 30 days',
  '哪些 sound 的视频创作率最高 (videos / plays),最近 14 天',
  'Tracks with highest skip rate in the last 14 days, broken down by source',
  'Artists ranked within their tier by D7 plays, latest dt only',
  '把 artist_social_snapshot 和 dim_artist JOIN,看每个 tier 在 tiktok 上的平均粉丝数和互动率',
  '最近 7 天每个 source (for_you / search / profile) 的播放分布',
  'Top 3 tracks by completion rate in each country, last 14 days',
]

// Bundled CSV used by the "load sample CSV" button on the COLLECT stage.
// Theme: a marketing-team export of social-follower snapshots, joinable to
// dim_artist via artist_external_id. Mixed types so the importer's
// INTEGER / REAL / TEXT detection is visible.
export const SAMPLE_CSV_TABLE = 'artist_social_snapshot'
export const SAMPLE_CSV = `artist_external_id,artist_name,platform,snapshot_dt,followers,engagement_rate,posts_last_30d,top_country
EXT-A001,Lia Park,tiktok,2026-04-25,820000,0.094,22,KR
EXT-A001,Lia Park,instagram,2026-04-25,410000,0.062,14,KR
EXT-A001,Lia Park,youtube,2026-04-25,185000,0.038,4,KR
EXT-A002,BeatKid,tiktok,2026-04-25,3140000,0.071,18,US
EXT-A002,BeatKid,instagram,2026-04-25,2680000,0.041,11,US
EXT-A002,BeatKid,youtube,2026-04-25,1820000,0.029,6,US
EXT-A003,Indah Sari,tiktok,2026-04-25,52000,0.123,31,ID
EXT-A003,Indah Sari,instagram,2026-04-25,28000,0.087,19,ID
EXT-A003,Indah Sari,youtube,2026-04-25,9400,0.052,2,ID
EXT-A004,Marina Costa,tiktok,2026-04-25,5820000,0.058,12,BR
EXT-A004,Marina Costa,instagram,2026-04-25,7140000,0.034,9,BR
EXT-A004,Marina Costa,youtube,2026-04-25,3210000,0.022,3,BR
EXT-A005,Aarav,tiktok,2026-04-25,8200,0.156,28,IN
EXT-A005,Aarav,instagram,2026-04-25,4100,0.098,21,IN
EXT-A005,Aarav,youtube,2026-04-25,1200,0.041,1,IN
EXT-A006,Nova Lin,tiktok,2026-04-25,690000,0.082,16,US
EXT-A006,Nova Lin,instagram,2026-04-25,540000,0.055,12,US
EXT-A006,Nova Lin,youtube,2026-04-25,220000,0.031,5,US
EXT-A007,Yuki Hoshino,tiktok,2026-04-25,71000,0.108,24,JP
EXT-A007,Yuki Hoshino,instagram,2026-04-25,38000,0.073,17,JP
EXT-A007,Yuki Hoshino,youtube,2026-04-25,12500,0.044,3,JP
EXT-A008,Carmen Vega,tiktok,2026-04-25,4280000,0.066,14,MX
EXT-A008,Carmen Vega,instagram,2026-04-25,5610000,0.038,10,MX
EXT-A008,Carmen Vega,youtube,2026-04-25,2470000,0.025,4,MX
`
