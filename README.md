# Cadence

**Ask data in plain language.** Drop in a SQL schema, type a question in Chinese or English, and Cadence generates an executable query, runs it in-browser, renders a table + auto-chart, and lets you save it as a reusable report.

Built around a big-company 4-layer warehouse pattern (`dim_*` / `dwd_*` / `dws_*` / `ads_*`), TikTok-music shape, with 60 days of deterministically seeded event data. The downstream layers (`dws_*`, `ads_artist_growth_daily`) are populated via SQL transformations from the raw event tables, mirroring how a real warehouse builds rollups.

## What it does

1. **Schema profile** — Claude reads the DDL and writes a business profile (tables, relations, semantics, dialect notes).
2. **NL → SQL** — your question becomes one executable SQLite query, with a one-line explanation.
3. **Execute** — runs in the browser via sql.js (no backend DB).
4. **Auto-chart** — line chart for time series, bar chart for categorical breakdowns, table fallback otherwise.
5. **Save reports** — one click stores `(question, sql)` to localStorage. Click any saved report to re-run.

## Stack

- Next.js 14 (App Router) + TypeScript
- Tailwind, with Pinterest Gestalt tokens + Apple HIG aesthetic (see `../DESIGN.md`)
- `@anthropic-ai/sdk` (Claude Sonnet 4.5) for schema profiling and NL→SQL
- `sql.js` for in-browser SQLite execution
- `recharts` for auto-rendered charts
- `lucide-react` for icons

## Run locally

```bash
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
npm run dev          # http://localhost:3001
```

## Deploy on Vercel (one-click after the repo is on GitHub)

1. Push this folder to a GitHub repo.
2. Go to https://vercel.com/new and import the repo.
3. Add an environment variable: `ANTHROPIC_API_KEY` = your Anthropic API key.
4. Deploy. The included `next.config.mjs` already sets the webpack fallbacks sql.js needs.

## Try these questions on the sample data

- 过去 30 天每个国家的总播放量,优先市场打 priority 标签,按播放量降序
- Top 10 emerging-tier artists by week-over-week growth in APAC region
- 7-day rolling plays per artist over the last 30 days
- 哪些 sound 的视频创作率最高 (videos / plays),最近 14 天
- Tracks with highest skip rate in the last 14 days, broken down by source
- Artists ranked within their tier by D7 plays, latest dt only

The demo data is anchored at 2026-04-25, so "last N days" queries will return rows. Cadence will pick the right warehouse layer per question (dws / ads for rollups, dwd only when event-grain detail is needed).
