# Cadence

> Schema-aware NL→SQL analytics demo. Drop in DDL, ask in plain language, get an executable query, a result table, an auto-detected chart, and a saveable report.

See parent workspace `../CLAUDE.md` for shared context, glossary, and house style (no em dashes, etc.). UI follows `../DESIGN.md`.

## Why this exists

Built to demo data-operations capability for the TikTok PGC-Music-Artist Services intern interview. Shape of the work the JD asks for:
- SQL query / filter / aggregate to extract business data → **AI generates + browser executes**
- Tableau-style visualization → **auto-detected line / bar charts (recharts)**
- Reports that get re-run → **localStorage report library**
- AI tools for analysis & automation → **the entire pipeline**

## Pipeline

1. **Schema** — preloaded with a big-company 4-layer warehouse (dim / dwd / dws / ads), TikTok-music shape. See "Schema layering" below.
2. **Profile** (`/api/profile`) — Claude writes a 4-section schema profile (tables, relations, business semantics, dialect notes).
3. **Ask** (`/api/nl2sql`) — Claude turns a natural-language question (zh/en) into one SQLite-dialect query. The prompt teaches the layering convention so it picks the right table (dws/ads for rollups, dwd only when event-grain detail is needed).
4. **Execute** — `app/lib/db.ts` runs the SQL in browser via sql.js (WASM loaded from CDN on first call). Single shared in-memory DB.
5. **Render** — table + auto-chart (`app/lib/chart.ts` heuristic: date+numeric → line, categorical+numeric → bar).
6. **Save** — questions + SQL persist to `localStorage` as reports; one click re-runs them.

## Schema layering

Modeled on how TikTok / ByteDance and similar teams structure music analytics:

- **dim_artist / dim_track / dim_sound / dim_geo** — slowly-changing dimensions. JOIN to enrich, never aggregate from.
- **dwd_track_play_event / dwd_user_action_event / dwd_video_creation_event** — cleaned event facts, partitioned by `dt` (YYYY-MM-DD). Indexes on `dt` + `track_id`. Use for event-grain questions (by source, by app_version, completion/skip rates).
- **dws_artist_country_day / dws_track_country_day** — pre-aggregated cubes built from DWD. Use for "by day / by country / by tier" rollups. The seed populates these via `INSERT INTO ... SELECT ... GROUP BY ...` directly in SQL, mirroring the production transformation.
- **ads_artist_growth_daily** — the artist-services dashboard mart with `plays_d1 / plays_d7 / plays_d28 / listeners_d7 / videos_d7 / growth_pct_wow`, computed in SQL with window functions over DWS.

Demo data is anchored at `2026-04-25`, deterministically seeded with `mulberry32(42)`. ~3500 plays, 800 actions, 320 video creations across 60 days, 8 artists, ~24 tracks, 12 countries.

## File layout

```
app/
├── layout.tsx
├── page.tsx                  single-page UI
├── globals.css
├── lib/
│   ├── sample.ts             DDL + deterministic seed (60 days of synthetic plays/actions/videos)
│   ├── db.ts                 sql.js wrapper, in-memory DB
│   └── chart.ts              auto-chart detection + row→object transform
└── api/
    ├── profile/route.ts      schema → schema profile
    └── nl2sql/route.ts       schema + profile + question → { sql, explanation }
```

## Key conventions

- **Dialect: SQLite, NOT PostgreSQL.** The `nl2sql` prompt forces SQLite-only functions (date('YYYY-MM-DD','-N days'), strftime, substr).
- Sample data is anchored around `2026-04-25` so "last N days" queries return rows on the demo seed. The prompt tells Claude this.
- Seed is built deterministically with a `mulberry32(42)` RNG so demo runs are reproducible.
- DB is reset only on hard refresh; queries do not mutate state in the demo flow.

## Design

Pinterest Gestalt tokens (4px grid, 6 font sizes, 9-step rounding, pushpin-450 as the only accent) layered with Apple HIG aesthetic (clamp() display type, frosted glass, off-white #FAFAF7, italic accents). Tokens copied from `../StyleForge/tailwind.config.ts`. See `../DESIGN.md` for the canonical rules.

## Run

```bash
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
npm run dev          # http://localhost:3001
```

## Deploy (Vercel)

1. Push this repo to GitHub.
2. Import the repo on Vercel.
3. Set env var `ANTHROPIC_API_KEY`.
4. Deploy. No build flags needed; `next.config.mjs` already stubs out the node-only fallbacks sql.js expects.

## Iteration ideas (not yet built)

- Schema upload (CSV → infer schema + load rows)
- Data quality scan: NULL counts, dup IDs, date-range sanity, type drift
- Embed-as-iframe so reports can be dropped into Notion / Confluence
- Pairwise SQL comparison (DPO-style) for SQL fine-tuning data
- Auto-difficulty labeling on the report library
