'use client'
import { useEffect, useMemo, useState } from 'react'
import {
  Sparkles, Database, Wand2, Play, Save, Trash2, RefreshCw, AlertCircle,
  BarChart3, LineChart as LineIcon, Table as TableIcon, Languages, Loader2,
  Check, ChevronDown, ChevronRight, FileText, BookOpen, Zap, Server, Terminal,
  Upload, ShieldCheck, Copy, ArrowRight, FileSpreadsheet, AlertTriangle,
  Link2, Download, Brain,
} from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'

import { runSql, type QueryResult } from './lib/db'
import { detectChart, toChartData, type ChartSpec } from './lib/chart'
import { SAMPLE_DDL, SAMPLE_QUESTIONS, SAMPLE_CSV, SAMPLE_CSV_TABLE } from './lib/sample'
import { getEntityHints } from './lib/entity-hints'
import { topMatches, type Report } from './lib/few-shot'
import { runQualityScan, type QualityCheck } from './lib/quality'
import { importCsv, type CsvImport } from './lib/csv'

type Lang = 'zh' | 'en'
type Stage = 'collect' | 'clean' | 'query' | 'reports'

// Default test URL for the URL→SFT card.
// Kworb's Spotify Daily Chart - Global is a public industry-grade music
// database: a server-rendered HTML table of the top 200 streamed tracks
// worldwide with artist, title, daily streams, and day-over-day deltas —
// the same shape as our dwd_track_play_event aggregated to dws/ads. This
// maps cleanly onto Cadence's schema (artist × track × country × day),
// so the LLM can produce realistic analyst NL→SQL pairs.
// Country variants exist: kr_daily / jp_daily / us_daily / br_daily etc.,
// matching dim_geo priority markets.
const SAMPLE_URL = 'https://kworb.net/spotify/country/global_daily.html'

const STAGES: { id: Stage; n: string }[] = [
  { id: 'collect',  n: '01' },
  { id: 'clean',    n: '02' },
  { id: 'query',    n: '03' },
  { id: 'reports',  n: '04' },
]

const i18n = {
  zh: {
    brand: 'CADENCE',
    sysline: 'SYS-001 · UNIFIED DATA OPS PIPELINE',

    stage_collect:  'COLLECT',
    stage_clean:    'CLEAN',
    stage_query:    'QUERY',
    stage_reports:  'REPORTS',

    stage_collect_sub:  '采集',
    stage_clean_sub:    '清洗',
    stage_query_sub:    '查询',
    stage_reports_sub:  '报表',

    workflow_title: '数据 OPS 工作流',
    workflow_sub: '一条流水线打通 JD 的 4 项职责:数据采集 / 清洗 / 查询 / 可视化报表。每一步都有对应的工具,所有数据共享同一份浏览器内 SQLite 引擎。',

    // COLLECT
    collect_title: '01 / COLLECT — 数据采集',
    collect_sub: '不是顺序流程,是三个独立的工具,任选其一或都不选都不影响下游。两类用途不要混:【入库二选一】内置 seed (默认开启) / CSV 上传 (可选附加表) —— 这两条决定 QUERY 阶段能查到什么。【独立工具】URL 抽取 —— 抓页面生成 NL→SQL 训练对,导出 JSONL 用来微调模型,不进数据库,跟 QUERY 无关。所有路径都对齐同一份不可变 DDL (4 层 10 表)。',
    collect_loaded: '已加载',
    collect_layers: '4 层数仓',
    collect_layers_sub: 'DIM · DWD · DWS · ADS',
    src_label: '数据源',
    src_builtin: '内置 seed · DDL 不可变契约',
    src_csv_none: '未上传 · 用 DDL 默认表查询',
    src_csv_loaded: '已就绪 · 跟 DDL 并存,可 JOIN',
    src_url_default: '默认: Kworb · Spotify Daily Global',
    src_url_set: '当前 URL',
    schema_immutable_note: '此 DDL 在 demo 中固定,所有 NL→SQL 都对它生成。生产环境替换时同步改 nl2sql 的 prompt。',
    group_db: 'A · 数据入库 (二选一,决定 QUERY 阶段能查到什么)',
    group_db_or: '或',
    group_training: 'B · 训练数据导出 (独立工具,不进数据库,跟 QUERY 无关)',
    btn_inspect_ddl: '查看 DDL',
    btn_upload_csv: '上传 CSV',
    csv_hint: '拖拽或点击上传 CSV 文件,首行为列名',
    csv_imported: '已导入',
    csv_table: '表名',
    csv_rows: '行数',
    btn_load_sample_csv: '一键加载示例 CSV',
    csv_sample_hint: '不想准备文件？加载内置示例 (artist_social_snapshot · 24 行) 直接体验',
    btn_download_sample: '下载示例',
    url_title: 'URL → SFT 数据集',
    url_sub: '粘贴一篇行业文章 / 博客 / 维基条目的 URL,系统会抓取页面、用 LLM 提炼为 NL→SQL 训练对,导出为 JSONL 直接喂 TRL / Unsloth / LLaMA-Factory。注意:纯 SPA 站点 (整页 JS 渲染) 抓不到正文,优先用服务端渲染的页面。',
    url_placeholder: 'https://kworb.net/spotify/country/...',
    url_try_sample: '试试 Kworb · Spotify 全球日榜 (行业级流媒体数据库,200 首歌 × 艺人 × 流量 × 涨跌)',
    btn_url_ingest: '抽取并生成数据集',
    btn_url_ingesting: '抓取中',
    btn_download_jsonl: '下载 JSONL',
    label_url_summary: '文章摘要',
    label_url_topics: '主题',
    label_url_pairs: '生成的训练对',
    label_url_records: '条记录',
    err_url: 'URL INGEST FAILED',
    label_rules: 'LLM 规则 (服务端强制)',
    rules_body:
      'R1 · 主题范围:仅处理音乐流媒体 / 艺人分析 / 创作者经济 / 唱片版权 / 社媒驱动音乐分发等相关内容。无关页面 LLM 应返回 relevant=false 并立即停止,不生成填充对。\n' +
      'R2 · SQL 约束:仅 SELECT。禁止 INSERT/UPDATE/DELETE/DROP/PRAGMA。必须引用 DDL 中至少一张表 (dim_/dwd_/dws_/ads_)。优先 dws_/ads_ 做汇总,只有需要事件粒度才下到 dwd_。\n' +
      'R3 · 问题质量:必须是分析师真会问 label/艺人的问题。语言匹配文章 (zh ↔ en)。无重复。每条问题必须由文章里某个具体概念驱动,在 rationale 里写清楚。\n' +
      'R4 · 难度配比:批次内必须包含简单聚合、时间窗口、JOIN、窗口函数各至少一条。\n' +
      'R5 · 输出预算:5-8 对,宁少而精。\n' +
      'R6 · 时间锚:demo 数据停在 2026-04-25,"过去 N 天" 用 date(\'2026-04-25\',\'-N days\')。\n\n' +
      '违反 R1/R2/R3 的对子在服务端会被自动过滤掉,不会进入 JSONL 导出。',
    rules_off_topic: '页面被判定为 OFF-TOPIC · 未生成训练对',
    rules_dropped: '违规过滤',

    // CLEAN
    clean_title: '02 / CLEAN — 数据清洗与质量校验',
    clean_sub: '运行一次性体检,覆盖完整性 (row count)、准确性 (NULL count)、唯一性 (PK)、时效性 (latest dt)、参照完整性 (orphan FK)。这就是 JD 里 "ensure accuracy / completeness / timeliness" 的实质。',
    btn_scan: '运行质量扫描',
    btn_scanning: '扫描中',
    label_pass: 'PASS',
    label_warn: 'WARN',
    label_fail: 'FAIL',
    col_table: '表',
    col_check: '检查项',
    col_metric: '值',
    col_detail: '详情',

    // QUERY
    query_title: '03 / QUERY — 自然语言查询',
    query_sub: '中文/英文皆可。系统自动:从已存报表里取相似示例 (few-shot)、注入实体名映射 (entity hints)、失败时重试一次 (self-correction)。',
    placeholder_q: '> 例:过去 30 天每个国家的总播放量,优先市场打 priority 标签',
    label_examples: 'SAMPLE QUESTIONS',
    label_fewshot: 'FEW-SHOT',
    label_entityhints: 'ENTITY HINTS',
    label_selfcorrect: 'SELF-CORRECT',
    btn_generate: 'EXECUTE',
    btn_generating: 'GENERATING',
    btn_running: 'RUNNING',
    btn_run: 'RUN',
    btn_save: 'SAVE',
    btn_saved: 'SAVED',
    btn_tableau: 'COPY FOR TABLEAU',
    btn_tableau_done: 'COPIED',

    label_sql: 'GENERATED SQL',
    label_result: 'RESULT',
    label_chart: 'AUTO CHART',
    label_table: 'TABLE',
    rows_unit: 'ROWS',

    // REPORTS
    reports_title: '04 / REPORTS — 可复用报表',
    reports_sub: '本地存储,点击重跑;命中相似问题时会作为 few-shot 注入提示词。这是 JD 里 "construction and update of data reports"。',
    empty_reports: '> 还没有报表。先去 QUERY 提问并保存。',
    btn_rerun: 'RERUN',

    msg_retry: 'EXECUTION FAILED · SELF-CORRECTING',
    err_run: 'EXECUTION FAILED',
    err_generate: 'GENERATION FAILED',
    err_profile: 'PROFILE FAILED',
    err_csv: 'CSV IMPORT FAILED',
    err_rate_limit: 'API 配额已用完 · Gemini 免费层限速 (10 RPM)。等 30 秒再试,或在 .env.local 升级到付费 key。',

    btn_profile: 'GENERATE PROFILE',
    btn_profiling: 'ANALYZING',
    label_profile: 'BUSINESS PROFILE',
    label_ddl: 'DDL',

    footer_left: 'CADENCE / SYS-001',
    footer_right: 'GEMINI-2.5-FLASH · SQL.JS · RECHARTS',
  },
  en: {
    brand: 'CADENCE',
    sysline: 'SYS-001 · UNIFIED DATA OPS PIPELINE',

    stage_collect: 'COLLECT', stage_clean: 'CLEAN', stage_query: 'QUERY', stage_reports: 'REPORTS',
    stage_collect_sub: 'ingest', stage_clean_sub: 'validate', stage_query_sub: 'ask', stage_reports_sub: 'reuse',

    workflow_title: 'DATA OPS WORKFLOW',
    workflow_sub: 'One pipeline covering all four JD bullets: data collection · cleaning · SQL queries · visualized reports. Each stage is a tab; all stages share the same in-browser SQLite engine.',

    collect_title: '01 / COLLECT — Data ingestion',
    collect_sub: 'Not a sequential pipeline — three independent tools, use any or none. Two distinct purposes: [INTO DB · pick either] built-in seed (on by default) or CSV upload (optional extra table) — these two decide what QUERY can see. [STANDALONE TOOL] URL ingestion — fetches a page and produces NL→SQL training pairs as JSONL for fine-tuning, never inserted into the DB, unrelated to QUERY. All paths align to the same immutable DDL (4 layers, 10 tables).',
    collect_loaded: 'Loaded',
    collect_layers: '4-layer warehouse',
    collect_layers_sub: 'DIM · DWD · DWS · ADS',
    src_label: 'SOURCE',
    src_builtin: 'built-in seed · DDL is the immutable contract',
    src_csv_none: 'none · using default DDL tables',
    src_csv_loaded: 'ready · coexists with DDL, JOIN-able',
    src_url_default: 'default: Kworb · Spotify Daily Global',
    src_url_set: 'current URL',
    schema_immutable_note: 'This DDL is fixed in the demo. All NL→SQL is generated against it. To swap it in production, also update the nl2sql prompt.',
    group_db: 'A · INTO DB (pick either — determines what QUERY can see)',
    group_db_or: 'OR',
    group_training: 'B · TRAINING DATA EXPORT (standalone, never inserted, unrelated to QUERY)',
    btn_inspect_ddl: 'Inspect DDL',
    btn_upload_csv: 'Upload CSV',
    csv_hint: 'Drag or click to upload a CSV file. First row = headers.',
    csv_imported: 'Imported',
    csv_table: 'Table',
    csv_rows: 'Rows',
    btn_load_sample_csv: 'Load sample CSV',
    csv_sample_hint: 'No file ready? Load the bundled sample (artist_social_snapshot · 24 rows) to try it instantly.',
    btn_download_sample: 'Download sample',
    url_title: 'URL → SFT dataset',
    url_sub: 'Paste a URL (industry article, blog, wiki). The page is fetched, distilled by an LLM into NL→SQL training pairs, and exported as JSONL ready for TRL / Unsloth / LLaMA-Factory. Note: pure SPA sites (fully JS-rendered) yield no readable text — prefer server-rendered pages.',
    url_placeholder: 'https://kworb.net/spotify/country/...',
    url_try_sample: 'Try Kworb · Spotify Daily Global chart (industry streaming database — 200 tracks × artists × streams × deltas)',
    btn_url_ingest: 'Ingest & generate',
    btn_url_ingesting: 'Fetching',
    btn_download_jsonl: 'Download JSONL',
    label_url_summary: 'SUMMARY',
    label_url_topics: 'TOPICS',
    label_url_pairs: 'TRAINING PAIRS',
    label_url_records: 'records',
    err_url: 'URL INGEST FAILED',
    label_rules: 'LLM RULES (server-enforced)',
    rules_body:
      'R1 · DOMAIN SCOPE: only music streaming / artist analytics / creator economy / label & publishing / social-driven distribution. Off-topic pages should return relevant=false and stop, no filler pairs.\n' +
      'R2 · SQL CONSTRAINTS: SELECT-only. No INSERT/UPDATE/DELETE/DROP/PRAGMA. Must reference at least one DDL table (dim_/dwd_/dws_/ads_). Prefer dws_/ads_ for rollups; drop to dwd_ only when event-grain detail is genuinely needed.\n' +
      'R3 · QUESTION QUALITY: must be questions a real artist-services analyst would ask a label / artist. Language matches the article (zh ↔ en). No duplicates. Each question motivated by a specific article concept, stated in rationale.\n' +
      'R4 · DIFFICULTY MIX: batch must include at least one simple aggregation, one time-window query, one JOIN, one window function.\n' +
      'R5 · OUTPUT BUDGET: 5-8 pairs. Better fewer high-quality than many shallow.\n' +
      'R6 · DEMO ANCHOR: demo data anchored at 2026-04-25. "Last N days" must use date(\'2026-04-25\',\'-N days\').\n\n' +
      'Pairs violating R1/R2/R3 are filtered server-side and never enter the JSONL export.',
    rules_off_topic: 'Page judged OFF-TOPIC · no training pairs generated',
    rules_dropped: 'guardrail-dropped',

    clean_title: '02 / CLEAN — Quality validation',
    clean_sub: 'Run a one-shot health scan covering completeness (row counts), accuracy (NULL counts), uniqueness (PKs), timeliness (latest dt), referential integrity (orphan FKs). This is the literal "ensure accuracy / completeness / timeliness" line from the JD.',
    btn_scan: 'Run quality scan',
    btn_scanning: 'Scanning',
    label_pass: 'PASS', label_warn: 'WARN', label_fail: 'FAIL',
    col_table: 'TABLE', col_check: 'CHECK', col_metric: 'METRIC', col_detail: 'DETAIL',

    query_title: '03 / QUERY — Natural language',
    query_sub: 'Ask in any language. The system retrieves similar saved reports (few-shot), injects canonical entity values (entity hints), and self-corrects once on execution error.',
    placeholder_q: '> e.g. plays by country in the last 30 days, with priority-market tagging',
    label_examples: 'SAMPLE QUESTIONS',
    label_fewshot: 'FEW-SHOT', label_entityhints: 'ENTITY HINTS', label_selfcorrect: 'SELF-CORRECT',
    btn_generate: 'EXECUTE', btn_generating: 'GENERATING', btn_running: 'RUNNING',
    btn_run: 'RUN', btn_save: 'SAVE', btn_saved: 'SAVED',
    btn_tableau: 'COPY FOR TABLEAU', btn_tableau_done: 'COPIED',

    label_sql: 'GENERATED SQL', label_result: 'RESULT', label_chart: 'AUTO CHART', label_table: 'TABLE', rows_unit: 'ROWS',

    reports_title: '04 / REPORTS — Reusable reports',
    reports_sub: 'Local storage; click to re-run. Matching reports auto-inject as few-shot examples. This covers the JD bullet "construction and update of data reports".',
    empty_reports: '> No reports yet. Ask a question in QUERY and save it.',
    btn_rerun: 'RERUN',

    msg_retry: 'EXECUTION FAILED · SELF-CORRECTING',
    err_run: 'EXECUTION FAILED', err_generate: 'GENERATION FAILED', err_profile: 'PROFILE FAILED',
    err_csv: 'CSV IMPORT FAILED',
    err_rate_limit: 'API quota exceeded · Gemini free tier is rate-limited (~10 RPM). Wait 30s and retry, or upgrade the key in .env.local.',

    btn_profile: 'GENERATE PROFILE', btn_profiling: 'ANALYZING',
    label_profile: 'BUSINESS PROFILE', label_ddl: 'DDL',

    footer_left: 'CADENCE / SYS-001',
    footer_right: 'GEMINI-2.5-FLASH · SQL.JS · RECHARTS',
  },
} as const

export default function Home() {
  const [lang, setLang] = useState<Lang>('zh')
  const [stage, setStage] = useState<Stage>('collect')

  // shared state
  const [reports, setReports] = useState<Report[]>([])
  const [stats, setStats] = useState<{ artists: number; tracks: number; events: number } | null>(null)
  const [error, setError] = useState('')

  // collect
  const [schemaOpen, setSchemaOpen] = useState(false)
  const [csvImport, setCsvImport] = useState<CsvImport | null>(null)
  const [url, setUrl] = useState('')
  const [urlLoading, setUrlLoading] = useState(false)
  type UrlIngest = {
    source_title: string; source_url: string; char_count: number;
    summary: string; topics: string[];
    pairs: { question: string; sql: string; rationale?: string }[];
    jsonl: string; record_count: number;
    raw_pair_count?: number; dropped_count?: number;
    rejected_off_topic?: boolean;
  }
  const [urlIngest, setUrlIngest] = useState<UrlIngest | null>(null)
  const [rulesOpen, setRulesOpen] = useState(false)

  // clean
  const [scanLoading, setScanLoading] = useState(false)
  const [checks, setChecks] = useState<QualityCheck[] | null>(null)

  // query
  const [profile, setProfile] = useState('')
  const [question, setQuestion] = useState('')
  const [sql, setSql] = useState('')
  const [explanation, setExplanation] = useState('')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [view, setView] = useState<'auto' | 'table'>('auto')
  const [usedFewshot, setUsedFewshot] = useState(0)
  const [usedHints, setUsedHints] = useState(false)
  const [retried, setRetried] = useState(false)
  const [retryNote, setRetryNote] = useState('')
  const [savedFlash, setSavedFlash] = useState(false)
  const [tableauFlash, setTableauFlash] = useState(false)

  const [loading, setLoading] = useState<'profile' | 'gen' | 'run' | null>(null)
  const t = i18n[lang]

  // Translate raw API errors into something the user can act on. The big one
  // we care about is 429 → friendly "API quota exceeded · wait 30s" message,
  // since Gemini's free tier rate-limits aggressively.
  function fmtErr(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('429') || msg.includes('RATE_LIMITED') || /quota|rate[- ]?limit/i.test(msg)) {
      return t.err_rate_limit
    }
    return msg
  }

  useEffect(() => {
    const saved = localStorage.getItem('cadence-lang') as Lang | null
    if (saved === 'zh' || saved === 'en') setLang(saved)
    const r = localStorage.getItem('cadence-reports')
    if (r) try { setReports(JSON.parse(r)) } catch {}
    ;(async () => {
      try {
        const a = await runSql('SELECT COUNT(*) FROM dim_artist')
        const tr = await runSql('SELECT COUNT(*) FROM dim_track')
        const ev = await runSql('SELECT COUNT(*) FROM dwd_track_play_event')
        setStats({
          artists: Number(a.rows[0][0] ?? 0),
          tracks: Number(tr.rows[0][0] ?? 0),
          events: Number(ev.rows[0][0] ?? 0),
        })
      } catch {}
    })()
  }, [])
  useEffect(() => { localStorage.setItem('cadence-lang', lang) }, [lang])
  useEffect(() => { localStorage.setItem('cadence-reports', JSON.stringify(reports)) }, [reports])

  /* ── COLLECT actions ── */
  async function handleCsv(file: File) {
    setError('')
    try {
      const text = await file.text()
      const tableName = file.name.replace(/\.csv$/i, '')
      const imp = await importCsv(text, tableName)
      setCsvImport(imp)
    } catch (e) {
      setError(`${t.err_csv}: ${fmtErr(e)}`)
    }
  }

  async function loadSampleCsv() {
    setError('')
    try {
      const imp = await importCsv(SAMPLE_CSV, SAMPLE_CSV_TABLE)
      setCsvImport(imp)
    } catch (e) {
      setError(`${t.err_csv}: ${fmtErr(e)}`)
    }
  }

  async function ingestUrl() {
    const u = url.trim()
    if (!u) return
    setUrlLoading(true); setError(''); setUrlIngest(null)
    try {
      const r = await fetch('/api/url-ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: u }) })
      if (!r.ok) throw new Error(await r.text())
      setUrlIngest(await r.json() as UrlIngest)
    } catch (e) {
      setError(`${t.err_url}: ${fmtErr(e)}`)
    } finally { setUrlLoading(false) }
  }

  function downloadJsonl() {
    if (!urlIngest) return
    const blob = new Blob([urlIngest.jsonl], { type: 'application/jsonl' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `cadence-sft-${Date.now()}.jsonl`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  /* ── CLEAN actions ── */
  async function handleScan() {
    setScanLoading(true); setError('')
    try {
      const res = await runQualityScan()
      setChecks(res)
    } catch (e) {
      setError(`SCAN FAILED: ${fmtErr(e)}`)
    } finally { setScanLoading(false) }
  }

  /* ── QUERY actions ── */
  async function genProfile() {
    setLoading('profile'); setError('')
    try {
      const r = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schema: SAMPLE_DDL }) })
      if (!r.ok) throw new Error(await r.text())
      const data = await r.json(); setProfile(data.profile)
    } catch (e) { setError(`${t.err_profile}: ${fmtErr(e)}`) }
    finally { setLoading(null) }
  }

  async function generateSql(q: string, retryCtx?: { sql: string; error: string }): Promise<{ sql: string; explanation: string }> {
    const examples = topMatches(q, reports, 3).map(r => ({ question: r.question, sql: r.sql }))
    const entityHints = await getEntityHints().catch(() => '')
    setUsedFewshot(examples.length); setUsedHints(Boolean(entityHints))

    const r = await fetch('/api/nl2sql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schema: SAMPLE_DDL, profile, question: q,
        examples: examples.length > 0 ? examples : undefined,
        entity_hints: entityHints || undefined,
        retry_error: retryCtx?.error,
        retry_sql: retryCtx?.sql,
      }),
    })
    if (!r.ok) throw new Error(await r.text())
    return r.json()
  }

  async function generateAndRun(q?: string) {
    const ask = (q ?? question).trim()
    if (!ask) return
    setQuestion(ask); setLoading('gen'); setError(''); setRetryNote('')
    setResult(null); setSql(''); setExplanation(''); setRetried(false)
    try {
      const data = await generateSql(ask)
      setSql(data.sql); setExplanation(data.explanation ?? '')
      setLoading('run')
      try {
        const res = await runSql(data.sql); setResult(res); setView('auto')
      } catch (execErr) {
        const errMsg = execErr instanceof Error ? execErr.message : String(execErr)
        setRetryNote(t.msg_retry); setRetried(true); setLoading('gen')
        const fixed = await generateSql(ask, { sql: data.sql, error: errMsg })
        setSql(fixed.sql); setExplanation(fixed.explanation ?? ''); setLoading('run')
        const res2 = await runSql(fixed.sql); setResult(res2); setView('auto'); setRetryNote('')
      }
    } catch (e) { setError(`${t.err_generate}: ${fmtErr(e)}`) }
    finally { setLoading(null) }
  }

  async function rerunSql(s: string) {
    setLoading('run'); setError('')
    try { const res = await runSql(s); setResult(res); setView('auto') }
    catch (e) { setError(`${t.err_run}: ${fmtErr(e)}`) }
    finally { setLoading(null) }
  }

  function saveReport() {
    if (!sql || !question) return
    const rep: Report = { id: crypto.randomUUID(), question, sql, explanation, createdAt: Date.now() }
    setReports(prev => [rep, ...prev])
    setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1500)
  }

  function copyForTableau() {
    if (!sql) return
    const header = `-- Cadence-generated query for Tableau Custom SQL\n-- Question: ${question}\n-- ${explanation}\n-- Paste into: Connect → Custom SQL Query (against your warehouse)\n\n`
    navigator.clipboard.writeText(header + sql).then(() => {
      setTableauFlash(true); setTimeout(() => setTableauFlash(false), 1800)
    })
  }

  function deleteReport(id: string) { setReports(prev => prev.filter(r => r.id !== id)) }
  function loadReport(r: Report) {
    setQuestion(r.question); setSql(r.sql); setExplanation(r.explanation ?? '')
    setStage('query'); rerunSql(r.sql)
  }

  const chartSpec: ChartSpec = useMemo(() => result ? detectChart(result) : { kind: 'none' }, [result])
  const chartData = useMemo(() => result ? toChartData(result) : [], [result])

  return (
    <main className="min-h-screen bg-void-900 text-steel-100">
      {/* TOP NAV */}
      <header className="sticky top-0 z-40 bg-void-900/95 backdrop-blur border-b border-steel-700">
        <div className="max-w-7xl mx-auto px-6 h-12 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 border border-blueprint-500 flex items-center justify-center">
                <Zap className="w-3 h-3 text-blueprint-500" strokeWidth={2.5} />
              </div>
              <span className="font-mono text-13 font-bold text-steel-50 tracking-[0.18em]">{t.brand}</span>
            </div>
            <span className="hidden md:inline font-mono text-10 text-steel-400 tracking-[0.16em]">{t.sysline}</span>
          </div>
          <button
            onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
            className="inline-flex items-center gap-1 px-2.5 py-1 border border-steel-700 hover:border-blueprint-500 font-mono text-10 font-bold text-steel-200 transition-colors tracking-widest"
          >
            <Languages className="w-3 h-3 text-blueprint-500" />
            {lang === 'zh' ? 'EN' : '中'}
          </button>
        </div>
      </header>

      {/* WORKFLOW STEPPER */}
      <section className="border-b border-steel-700 bg-void-800/30">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="font-mono text-10 text-blueprint-500 tracking-[0.24em] mb-3 flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 bg-blueprint-500 animate-pulseDot" />
            {t.workflow_title}
          </div>
          <p className="text-13 text-steel-400 leading-relaxed mb-7 max-w-3xl">{t.workflow_sub}</p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-0 border border-steel-700">
            {STAGES.map((s, idx) => {
              const labelKey = `stage_${s.id}` as keyof typeof t
              const subKey = `stage_${s.id}_sub` as keyof typeof t
              const active = stage === s.id
              return (
                <button
                  key={s.id}
                  onClick={() => setStage(s.id)}
                  className={`relative px-5 py-4 text-left transition-colors border-r last:border-r-0 border-steel-700 ${
                    active ? 'bg-blueprint-500 text-void-900' : 'bg-void-800/50 text-steel-200 hover:bg-void-700'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`font-mono text-10 font-bold tracking-[0.24em] ${active ? 'text-void-900' : 'text-blueprint-500'}`}>[{s.n}]</span>
                    <span className={`font-mono text-13 font-bold tracking-widest ${active ? 'text-void-900' : 'text-steel-50'}`}>{t[labelKey] as string}</span>
                  </div>
                  <div className={`font-mono text-10 tracking-widest ${active ? 'text-void-900/70' : 'text-steel-500'}`}>{t[subKey] as string}</div>
                  {idx < STAGES.length - 1 && (
                    <ArrowRight className={`hidden sm:block absolute -right-2 top-1/2 -translate-y-1/2 w-3 h-3 z-10 ${active ? 'text-blueprint-500' : 'text-steel-600'}`} />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* BODY — switches by stage */}
      <div className="max-w-7xl mx-auto px-6 py-10 space-y-8">

        {/* COLLECT */}
        {stage === 'collect' && (
          <section className="animate-fadeUp">
            <SectionHeader title={t.collect_title} subtitle={t.collect_sub} />

            {/* Stat overview */}
            <div className="grid grid-cols-2 sm:grid-cols-4 border border-steel-700 divide-x divide-steel-700 mb-6">
              <KpiCell label="ARTISTS" value={stats?.artists ?? '—'} />
              <KpiCell label="TRACKS"  value={stats?.tracks ?? '—'} />
              <KpiCell label="EVENTS · 60D" value={stats ? stats.events.toLocaleString() : '—'} />
              <KpiCell label="LAYERS" value="04" sub="DIM·DWD·DWS·ADS" />
            </div>

            {/* Group A — INTO DB (pick either) */}
            <div className="font-mono text-10 font-bold tracking-[0.18em] text-blueprint-500 mb-2 flex items-center gap-2">
              <span className="inline-block w-1 h-1 bg-blueprint-500" />
              {t.group_db}
            </div>
            <div className="relative grid lg:grid-cols-2 gap-4">
              {/* OR divider — only visible on lg+ where the two cards sit side-by-side */}
              <div className="hidden lg:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 items-center justify-center w-8 h-8 bg-void-900 border border-steel-700 rounded-full font-mono text-10 font-bold tracking-widest text-steel-400">
                {t.group_db_or}
              </div>
              {/* Pre-loaded warehouse panel */}
              <Card>
                <div className="flex items-center justify-between px-4 py-2 border-b border-steel-700">
                  <div className="inline-flex items-center gap-2 font-mono text-10 font-bold tracking-[0.18em] text-blueprint-500">
                    <Database className="w-3 h-3" /> {t.collect_layers}
                  </div>
                  <button onClick={() => setSchemaOpen(o => !o)} className="inline-flex items-center gap-1.5 px-3 py-1 border border-steel-600 hover:border-blueprint-500 font-mono text-10 font-bold tracking-widest text-steel-100 hover:text-blueprint-500 transition-colors">
                    {schemaOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    {t.btn_inspect_ddl}
                  </button>
                </div>
                <div className="p-5">
                  <div className="font-mono text-10 text-steel-500 tracking-[0.18em] mb-2 flex items-center gap-2">
                    <span>{t.src_label}</span>
                    <span className="inline-block w-1 h-1 bg-blueprint-500 rounded-full" />
                    <span className="text-blueprint-500 normal-case tracking-normal">{t.src_builtin}</span>
                  </div>
                  <div className="font-mono text-24 font-bold tabular-nums text-steel-50 mb-1">10 tables · 4 layers</div>
                  <div className="font-mono text-11 text-steel-400">{t.collect_layers_sub}</div>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {['dim_artist','dim_track','dim_sound','dim_geo','dwd_track_play_event','dwd_user_action_event','dwd_video_creation_event','dws_artist_country_day','dws_track_country_day','ads_artist_growth_daily'].map(t => (
                      <span key={t} className="font-mono text-10 px-1.5 py-0.5 border border-steel-700 text-steel-400 tracking-wider">{t}</span>
                    ))}
                  </div>
                </div>
                {schemaOpen && (
                  <>
                    <div className="px-4 py-2 border-t border-steel-700 bg-void-950/60 font-mono text-10 text-caution-500 tracking-wider leading-relaxed flex items-start gap-2">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                      <span>{t.schema_immutable_note}</span>
                    </div>
                    <pre className="font-mono text-11 leading-[1.7] text-steel-300 p-4 overflow-auto max-h-96 scroll-thin bg-void-950 border-t border-steel-700">{SAMPLE_DDL}</pre>
                  </>
                )}
              </Card>

              {/* CSV upload panel */}
              <Card>
                <div className="flex items-center px-4 py-2 border-b border-steel-700 font-mono text-10 font-bold tracking-[0.18em] text-blueprint-500">
                  <Upload className="w-3 h-3 mr-2" /> {t.btn_upload_csv}
                </div>
                <div className="px-5 pt-4 font-mono text-10 text-steel-500 tracking-[0.18em] flex items-center gap-2">
                  <span>{t.src_label}</span>
                  <span className={`inline-block w-1 h-1 rounded-full ${csvImport ? 'bg-blueprint-500' : 'bg-steel-600'}`} />
                  <span className={`normal-case tracking-normal ${csvImport ? 'text-blueprint-500' : 'text-steel-500'}`}>
                    {csvImport ? `${csvImport.table} · ${csvImport.rowsInserted} rows · ${t.src_csv_loaded}` : t.src_csv_none}
                  </span>
                </div>
                <label className="block px-5 pt-3 cursor-pointer hover:bg-void-800/40 transition-colors">
                  <input
                    type="file" accept=".csv" className="hidden"
                    onChange={e => e.target.files?.[0] && handleCsv(e.target.files[0])}
                  />
                  <div className="border border-dashed border-steel-700 p-6 text-center">
                    <FileSpreadsheet className="w-6 h-6 text-steel-500 mx-auto mb-2" />
                    <div className="font-mono text-12 text-steel-300 mb-1">CSV → SQLite</div>
                    <div className="font-mono text-10 text-steel-500 tracking-wider">{t.csv_hint}</div>
                  </div>
                </label>
                <div className="px-5 py-4 border-t border-steel-700/60 mt-4 flex items-center justify-between gap-3 bg-void-950/30">
                  <span className="font-mono text-10 text-steel-500 tracking-wider leading-relaxed flex-1 min-w-0">{t.csv_sample_hint}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <a
                      href="/sample.csv"
                      download="artist_social_snapshot.csv"
                      className="inline-flex items-center gap-1 px-2.5 py-1 border border-steel-700 hover:border-blueprint-500 hover:text-blueprint-500 font-mono text-10 font-bold tracking-widest text-steel-300 transition-colors"
                    >
                      <FileSpreadsheet className="w-3 h-3" />{t.btn_download_sample}
                    </a>
                    <button
                      onClick={loadSampleCsv}
                      className="inline-flex items-center gap-1.5 px-3 py-1 bg-blueprint-500 text-void-900 font-mono text-10 font-bold tracking-widest hover:bg-blueprint-300 transition-colors"
                    >
                      <Sparkles className="w-3 h-3" />{t.btn_load_sample_csv}
                    </button>
                  </div>
                </div>
                {csvImport && (
                  <div className="border-t border-steel-700 p-4 bg-void-950/40">
                    <div className="font-mono text-10 text-blueprint-500 tracking-[0.18em] mb-2">{t.csv_imported.toUpperCase()}</div>
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <div>
                        <div className="font-mono text-10 text-steel-500 tracking-widest mb-1">{t.csv_table}</div>
                        <div className="font-mono text-13 text-steel-100">{csvImport.table}</div>
                      </div>
                      <div>
                        <div className="font-mono text-10 text-steel-500 tracking-widest mb-1">{t.csv_rows}</div>
                        <div className="font-mono text-13 text-blueprint-500 tabular-nums">{csvImport.rowsInserted.toLocaleString()}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {csvImport.columns.map(c => (
                        <span key={c.name} className="font-mono text-10 px-1.5 py-0.5 border border-steel-700 text-steel-400">
                          {c.name} <span className="text-blueprint-500">{c.type}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            </div>

            {/* Group B — TRAINING DATA EXPORT (standalone) */}
            <div className="font-mono text-10 font-bold tracking-[0.18em] text-blueprint-500 mt-8 mb-2 flex items-center gap-2">
              <span className="inline-block w-1 h-1 bg-blueprint-500" />
              {t.group_training}
            </div>
            {/* URL → SFT dataset */}
            <Card className="mt-0">
              <div className="flex items-center px-4 py-2 border-b border-steel-700 font-mono text-10 font-bold tracking-[0.18em] text-blueprint-500">
                <Link2 className="w-3 h-3 mr-2" /> {t.url_title}
              </div>
              <div className="p-5">
                <div className="font-mono text-10 text-steel-500 tracking-[0.18em] mb-3 flex items-center gap-2">
                  <span>{t.src_label}</span>
                  <span className={`inline-block w-1 h-1 rounded-full ${url.trim() ? 'bg-blueprint-500' : 'bg-steel-600'}`} />
                  <span className="text-blueprint-500 normal-case tracking-normal truncate">
                    {url.trim() ? `${t.src_url_set} · ${url.trim()}` : t.src_url_default}
                  </span>
                </div>
                <p className="font-mono text-11 text-steel-400 leading-relaxed mb-3">{t.url_sub}</p>

                {/* LLM RULES — collapsible */}
                <button
                  type="button"
                  onClick={() => setRulesOpen(o => !o)}
                  className="w-full mb-3 px-3 py-2 border border-caution-500/40 bg-caution-500/5 hover:bg-caution-500/10 transition-colors flex items-center justify-between font-mono text-10 font-bold tracking-[0.18em] text-caution-500"
                >
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="w-3 h-3" />{t.label_rules}
                  </span>
                  {rulesOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </button>
                {rulesOpen && (
                  <pre className="mb-3 p-3 border border-caution-500/30 bg-void-950 font-mono text-10 leading-[1.7] text-steel-300 whitespace-pre-wrap">{t.rules_body}</pre>
                )}

                <div className="flex items-stretch gap-2">
                  <input
                    type="url"
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') ingestUrl() }}
                    placeholder={t.url_placeholder}
                    className="flex-1 min-w-0 px-3 py-2 bg-void-950 border border-steel-700 font-mono text-12 text-steel-100 placeholder-steel-600 outline-none focus:border-blueprint-500"
                  />
                  <button
                    onClick={ingestUrl}
                    disabled={urlLoading || !url.trim()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-blueprint-500 text-void-900 font-mono text-11 font-bold tracking-widest hover:bg-blueprint-300 transition-colors disabled:opacity-30"
                  >
                    {urlLoading ? <><Loader2 className="w-3 h-3 animate-spin" />{t.btn_url_ingesting}</> : <><Brain className="w-3 h-3" />{t.btn_url_ingest}</>}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setUrl(SAMPLE_URL)}
                  className="mt-2 inline-flex items-center gap-1.5 font-mono text-10 text-steel-500 hover:text-blueprint-500 tracking-wider transition-colors"
                >
                  <Sparkles className="w-3 h-3" />{t.url_try_sample}
                  <span className="text-steel-600 truncate">→ {SAMPLE_URL}</span>
                </button>
              </div>
              {urlIngest && (
                <div className="border-t border-steel-700 bg-void-950/40">
                  {urlIngest.rejected_off_topic && (
                    <div className="px-5 py-3 border-b border-alarm-500/40 bg-alarm-500/5 font-mono text-11 text-alarm-500 flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5" />{t.rules_off_topic}
                    </div>
                  )}
                  <div className="px-5 py-4 border-b border-steel-700/60">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <a href={urlIngest.source_url} target="_blank" rel="noopener noreferrer" className="font-mono text-12 text-blueprint-500 hover:text-blueprint-300 truncate flex-1 min-w-0" title={urlIngest.source_title}>
                        ▸ {urlIngest.source_title}
                      </a>
                      <div className="flex items-center gap-2 shrink-0">
                        {urlIngest.dropped_count != null && urlIngest.dropped_count > 0 && (
                          <span className="font-mono text-10 text-caution-500 tracking-widest tabular-nums px-1.5 py-0.5 border border-caution-500/40">
                            {urlIngest.dropped_count} {t.rules_dropped}
                          </span>
                        )}
                        <span className="font-mono text-10 text-steel-500 tracking-widest tabular-nums">
                          <span className="text-blueprint-500">{urlIngest.record_count}</span> {t.label_url_records}
                        </span>
                        <button
                          onClick={downloadJsonl}
                          disabled={urlIngest.record_count === 0}
                          className="inline-flex items-center gap-1 px-2.5 py-1 border border-steel-600 hover:border-blueprint-500 hover:text-blueprint-500 font-mono text-10 font-bold tracking-widest text-steel-200 transition-colors disabled:opacity-30"
                        >
                          <Download className="w-3 h-3" />{t.btn_download_jsonl}
                        </button>
                      </div>
                    </div>
                    {urlIngest.summary && (
                      <>
                        <div className="font-mono text-10 text-steel-500 tracking-[0.18em] mb-1 mt-3">{t.label_url_summary}</div>
                        <p className="text-12 text-steel-200 leading-relaxed">{urlIngest.summary}</p>
                      </>
                    )}
                    {urlIngest.topics?.length > 0 && (
                      <>
                        <div className="font-mono text-10 text-steel-500 tracking-[0.18em] mb-1 mt-3">{t.label_url_topics}</div>
                        <div className="flex flex-wrap gap-1">
                          {urlIngest.topics.map((tp, i) => (
                            <span key={i} className="font-mono text-10 px-1.5 py-0.5 border border-steel-700 text-steel-300 tracking-wider">{tp}</span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="px-5 py-4">
                    <div className="font-mono text-10 text-blueprint-500 tracking-[0.18em] mb-3">{t.label_url_pairs}</div>
                    <div className="space-y-2 max-h-96 overflow-auto scroll-thin">
                      {urlIngest.pairs.map((p, i) => (
                        <div key={i} className="border border-steel-700 bg-void-900/60">
                          <div className="px-3 py-2 border-b border-steel-700/60 flex items-start gap-2">
                            <span className="font-mono text-10 text-blueprint-500 tabular-nums shrink-0 mt-0.5">#{(i+1).toString().padStart(2,'0')}</span>
                            <span className="text-12 text-steel-100 leading-relaxed">{p.question}</span>
                          </div>
                          <pre className="font-mono text-11 text-blueprint-300 leading-[1.6] p-3 overflow-x-auto bg-void-950 scroll-thin">{p.sql}</pre>
                          {p.rationale && (
                            <div className="px-3 py-1.5 border-t border-steel-700/60 font-mono text-10 text-steel-500 leading-relaxed">
                              <span className="text-blueprint-500">// </span>{p.rationale}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </Card>

            <NextStageNudge onNext={() => setStage('clean')} label={t.stage_clean} />
          </section>
        )}

        {/* CLEAN */}
        {stage === 'clean' && (
          <section className="animate-fadeUp">
            <SectionHeader title={t.clean_title} subtitle={t.clean_sub} />

            <Card>
              <div className="flex items-center justify-between px-4 py-2 border-b border-steel-700">
                <div className="inline-flex items-center gap-2 font-mono text-10 font-bold tracking-[0.18em] text-blueprint-500">
                  <ShieldCheck className="w-3 h-3" /> QUALITY SCAN
                </div>
                <button
                  onClick={handleScan}
                  disabled={scanLoading}
                  className="inline-flex items-center gap-2 px-4 py-1.5 bg-blueprint-500 text-void-900 font-mono text-11 font-bold tracking-widest hover:bg-blueprint-300 transition-colors disabled:opacity-30"
                >
                  {scanLoading ? <><Loader2 className="w-3 h-3 animate-spin" />{t.btn_scanning}</> : <><span>▸</span>{t.btn_scan}</>}
                </button>
              </div>

              {checks === null && !scanLoading ? (
                <div className="p-8 text-center font-mono text-12 text-steel-500">
                  <ShieldCheck className="w-8 h-8 text-steel-700 mx-auto mb-3" />
                  {lang === 'zh' ? '点击「运行质量扫描」开始体检' : 'Click "Run quality scan" to start'}
                </div>
              ) : scanLoading ? (
                <div className="p-5 space-y-2">
                  {[0, 1, 2, 3, 4].map(i => (
                    <div key={i} className="h-2 bg-steel-700 animate-pulse" style={{ width: `${100 - i * 5}%`, animationDelay: `${i * 80}ms` }} />
                  ))}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 border-b border-steel-700">
                    <ScanSummary label={t.label_pass} count={checks!.filter(c => c.status === 'pass').length} tone="signal" />
                    <ScanSummary label={t.label_warn} count={checks!.filter(c => c.status === 'warn').length} tone="caution" />
                    <ScanSummary label={t.label_fail} count={checks!.filter(c => c.status === 'fail').length} tone="alarm" />
                  </div>
                  <div className="overflow-auto max-h-[500px] scroll-thin">
                    <table className="cad-table">
                      <thead>
                        <tr>
                          <th>STATUS</th>
                          <th>{t.col_table}</th>
                          <th>{t.col_check}</th>
                          <th>{t.col_metric}</th>
                          <th>{t.col_detail}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {checks!.map((c, i) => (
                          <tr key={i}>
                            <td><StatusBadge status={c.status} /></td>
                            <td><span className="font-mono text-12 text-steel-300">{c.table}</span></td>
                            <td><span className="font-mono text-12 text-steel-100">{c.check}</span></td>
                            <td className="num">{c.metric}</td>
                            <td><span className="text-12 text-steel-400">{c.detail}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Card>

            <NextStageNudge onNext={() => setStage('query')} label={t.stage_query} />
          </section>
        )}

        {/* QUERY */}
        {stage === 'query' && (
          <section className="animate-fadeUp">
            <SectionHeader title={t.query_title} subtitle={t.query_sub} />

            {/* Profile + question */}
            <Card className="mb-3">
              <div className="flex items-center justify-between px-4 py-2 border-b border-steel-700">
                <span className="font-mono text-10 font-bold tracking-[0.18em] text-blueprint-500">{t.label_profile}</span>
                <button
                  onClick={genProfile}
                  disabled={loading !== null}
                  className="inline-flex items-center gap-1.5 px-3 py-1 border border-steel-600 hover:border-blueprint-500 hover:text-blueprint-500 font-mono text-10 font-bold tracking-widest text-steel-100 transition-colors disabled:opacity-30"
                >
                  {loading === 'profile' ? <><Loader2 className="w-3 h-3 animate-spin" />{t.btn_profiling}</> : <><Wand2 className="w-3 h-3" />{t.btn_profile}</>}
                </button>
              </div>
              {profile && <pre className="font-sans whitespace-pre-wrap text-13 leading-[1.75] text-steel-200 p-5 bg-void-950/40 max-h-48 overflow-y-auto scroll-thin">{profile}</pre>}
            </Card>

            <Card>
              <textarea
                className="w-full h-24 px-4 py-3 text-14 bg-transparent text-steel-100 resize-y outline-none leading-relaxed font-mono"
                placeholder={t.placeholder_q}
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generateAndRun() }}
              />
              <div className="px-4 pb-3 pt-1 border-t border-steel-700 bg-void-800/40">
                <div className="font-mono text-10 font-semibold uppercase tracking-[0.16em] text-steel-500 mb-2">{t.label_examples}</div>
                <div className="flex flex-wrap gap-1.5">
                  {SAMPLE_QUESTIONS.map(q => (
                    <button
                      key={q}
                      onClick={() => generateAndRun(q)}
                      disabled={loading !== null}
                      className="text-left text-11 font-mono px-2.5 py-1 border border-steel-700 text-steel-300 hover:border-blueprint-500 hover:text-blueprint-500 transition-colors disabled:opacity-30"
                    >{q}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-steel-700">
                <div className="flex items-center gap-2 flex-wrap">
                  {usedFewshot > 0 && <Pill icon={<BookOpen className="w-3 h-3" />} label={`${t.label_fewshot} ${usedFewshot}`} />}
                  {usedHints && <Pill icon={<Server className="w-3 h-3" />} label={t.label_entityhints} />}
                  {retried && <Pill icon={<RefreshCw className="w-3 h-3" />} label={t.label_selfcorrect} tone="caution" />}
                </div>
                <button
                  onClick={() => generateAndRun()}
                  disabled={loading !== null || !question.trim()}
                  className="inline-flex items-center gap-2 px-5 py-1.5 bg-blueprint-500 text-void-900 font-mono text-11 font-bold tracking-widest hover:bg-blueprint-300 transition-colors disabled:opacity-30"
                >
                  {loading === 'gen' ? <><Loader2 className="w-3 h-3 animate-spin" />{t.btn_generating}</> : loading === 'run' ? <><Loader2 className="w-3 h-3 animate-spin" />{t.btn_running}</> : <><span>▸</span>{t.btn_generate}</>}
                </button>
              </div>
            </Card>

            {retryNote && (
              <div className="mt-3 px-3 py-2 border border-caution-500/40 bg-caution-500/5 font-mono text-11 text-caution-500 inline-flex items-center gap-2 animate-fadeUp">
                <RefreshCw className="w-3 h-3 animate-spinSlow" />{retryNote}
              </div>
            )}

            {(sql || loading === 'gen' || loading === 'run') && (
              <div className="mt-4 grid lg:grid-cols-[1.1fr_1fr] gap-3 animate-fadeUp">
                {/* SQL panel */}
                <Card className="overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 border-b border-steel-700 bg-void-950">
                    <div className="inline-flex items-center gap-2 font-mono text-10 font-bold tracking-[0.18em] text-blueprint-500">
                      <Terminal className="w-3 h-3" />
                      <span className="inline-block w-1.5 h-1.5 bg-blueprint-500 animate-pulseDot" />
                      {t.label_sql}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <TerminalBtn onClick={() => sql && rerunSql(sql)} disabled={!sql || loading !== null}>
                        {loading === 'run' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                        {t.btn_run}
                      </TerminalBtn>
                      <TerminalBtn onClick={saveReport} disabled={!sql || !result} active={savedFlash}>
                        {savedFlash ? <><Check className="w-3 h-3" />{t.btn_saved}</> : <><Save className="w-3 h-3" />{t.btn_save}</>}
                      </TerminalBtn>
                      <TerminalBtn onClick={copyForTableau} disabled={!sql} active={tableauFlash}>
                        {tableauFlash ? <><Check className="w-3 h-3" />{t.btn_tableau_done}</> : <><Copy className="w-3 h-3" />{t.btn_tableau}</>}
                      </TerminalBtn>
                    </div>
                  </div>
                  <div className="relative scanline">
                    {loading === 'gen' && !sql ? (
                      <div className="p-4 space-y-2 bg-void-950">
                        {[80, 60, 90, 70].map((w, i) => (
                          <div key={i} className="h-2 bg-steel-800 animate-pulse" style={{ width: `${w}%`, animationDelay: `${i * 100}ms` }} />
                        ))}
                      </div>
                    ) : (
                      <pre className="relative font-mono text-12 text-blueprint-500 leading-[1.7] p-4 overflow-x-auto bg-void-950 scroll-thin">{sql}</pre>
                    )}
                  </div>
                  {explanation && (
                    <div className="px-4 py-2 border-t border-steel-700 bg-void-950 font-mono text-11 text-steel-400 leading-relaxed">
                      <span className="text-blueprint-500">// </span>{explanation}
                    </div>
                  )}
                </Card>

                {/* Result */}
                {result && (
                  <Card className="overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2 border-b border-steel-700 bg-void-800/40">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-10 font-bold tracking-[0.18em] text-steel-200">{t.label_result}</span>
                        <span className="font-mono text-11 tabular-nums text-blueprint-500">{result.rowCount} {t.rows_unit}</span>
                      </div>
                      {chartSpec.kind !== 'none' && (
                        <div className="inline-flex items-center border border-steel-700 overflow-hidden">
                          <ToggleBtn active={view === 'auto'}  onClick={() => setView('auto')}  icon={chartSpec.kind === 'line' ? <LineIcon className="w-3 h-3" /> : <BarChart3 className="w-3 h-3" />} label={t.label_chart} />
                          <ToggleBtn active={view === 'table'} onClick={() => setView('table')} icon={<TableIcon className="w-3 h-3" />} label={t.label_table} />
                        </div>
                      )}
                    </div>
                    {view === 'auto' && chartSpec.kind !== 'none' ? (
                      <div className="p-4 bg-void-950" style={{ height: 280 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          {chartSpec.kind === 'line' ? (
                            <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                              <CartesianGrid strokeDasharray="2 4" stroke="#222222" />
                              <XAxis dataKey={chartSpec.xKey} tick={{ fontSize: 10, fill: '#737373', fontFamily: 'monospace' }} stroke="#2A2A2A" />
                              <YAxis tick={{ fontSize: 10, fill: '#737373', fontFamily: 'monospace' }} stroke="#2A2A2A" />
                              <Tooltip contentStyle={{ background: '#0A0A0A', border: '1px solid #2A2A2A', borderRadius: 0, fontSize: 11, fontFamily: 'monospace', color: '#E5E5E5' }} cursor={{ stroke: '#00E5FF', strokeWidth: 1, strokeDasharray: '2 2' }} />
                              <Line type="monotone" dataKey={chartSpec.yKey} stroke="#00E5FF" strokeWidth={1.5} dot={{ r: 2, fill: '#00E5FF' }} activeDot={{ r: 4, fill: '#00E5FF' }} />
                            </LineChart>
                          ) : (
                            <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                              <CartesianGrid strokeDasharray="2 4" stroke="#222222" />
                              <XAxis dataKey={chartSpec.xKey} tick={{ fontSize: 10, fill: '#737373', fontFamily: 'monospace' }} stroke="#2A2A2A" />
                              <YAxis tick={{ fontSize: 10, fill: '#737373', fontFamily: 'monospace' }} stroke="#2A2A2A" />
                              <Tooltip contentStyle={{ background: '#0A0A0A', border: '1px solid #2A2A2A', borderRadius: 0, fontSize: 11, fontFamily: 'monospace', color: '#E5E5E5' }} cursor={{ fill: 'rgba(0,229,255,0.08)' }} />
                              <Bar dataKey={chartSpec.yKey} fill="#00E5FF" />
                            </BarChart>
                          )}
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="overflow-auto max-h-96 scroll-thin bg-void-950"><ResultTable result={result} /></div>
                    )}
                  </Card>
                )}
              </div>
            )}

            <NextStageNudge onNext={() => setStage('reports')} label={t.stage_reports} />
          </section>
        )}

        {/* REPORTS */}
        {stage === 'reports' && (
          <section className="animate-fadeUp">
            <SectionHeader title={t.reports_title} subtitle={t.reports_sub} />

            {reports.length === 0 ? (
              <Card><div className="p-5 font-mono text-12 text-steel-500">{t.empty_reports}</div></Card>
            ) : (
              <div className="space-y-1.5">
                {reports.map(r => (
                  <Card key={r.id} className="p-3 hover:border-blueprint-500 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-13 font-medium text-steel-100 mb-1">{r.question}</p>
                        <pre className="font-mono text-10 text-steel-500 truncate">{'> ' + r.sql.split('\n')[0]}{r.sql.includes('\n') ? ' ⋯' : ''}</pre>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => loadReport(r)} className="inline-flex items-center gap-1 px-2.5 py-1 border border-steel-600 hover:border-blueprint-500 hover:text-blueprint-500 font-mono text-10 font-bold tracking-widest text-steel-200 transition-colors">
                          <RefreshCw className="w-3 h-3" />{t.btn_rerun}
                        </button>
                        <button onClick={() => deleteReport(r.id)} className="p-1.5 text-steel-500 hover:bg-alarm-500/10 hover:text-alarm-500 transition-colors">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>
        )}

        {error && (
          <div className="border border-alarm-500/40 bg-alarm-500/5 p-3 font-mono text-12 text-alarm-500 flex items-start gap-2 animate-fadeUp shadow-glow-alarm">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}
      </div>

      <footer className="border-t border-steel-700 bg-void-900 py-5">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="font-mono text-10 text-steel-500 tracking-widest">
            <span className="text-blueprint-500">▎</span> {t.footer_left}
          </div>
          <div className="font-mono text-10 text-steel-500 tracking-widest">{t.footer_right}</div>
        </div>
      </footer>
    </main>
  )
}

/* ─────── components ─────── */

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-5 border-l-2 border-blueprint-500 pl-4">
      <h2 className="font-mono text-20 font-bold text-steel-50 tracking-tight mb-1">{title}</h2>
      <p className="text-13 text-steel-400 leading-relaxed max-w-3xl">{subtitle}</p>
    </div>
  )
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-void-800 border border-steel-700 ${className ?? ''}`}>{children}</div>
}

function KpiCell({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-void-800/60 px-5 py-4">
      <div className="font-mono text-10 font-semibold tracking-[0.18em] text-steel-500 mb-2">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-32 font-bold tabular-nums text-steel-50 leading-none">{value}</span>
        {sub && <span className="font-mono text-10 text-steel-500 tracking-widest">{sub}</span>}
      </div>
    </div>
  )
}

function NextStageNudge({ onNext, label }: { onNext: () => void; label: string }) {
  return (
    <div className="mt-6 flex justify-end">
      <button onClick={onNext} className="inline-flex items-center gap-2 px-4 py-2 border border-steel-700 hover:border-blueprint-500 hover:text-blueprint-500 font-mono text-10 font-bold tracking-widest text-steel-300 transition-colors">
        NEXT · {label} <ArrowRight className="w-3 h-3" />
      </button>
    </div>
  )
}

function Pill({ icon, label, tone }: { icon: React.ReactNode; label: string; tone?: 'caution' }) {
  const styles = tone === 'caution' ? 'border-caution-500/40 text-caution-500' : 'border-blueprint-500/40 text-blueprint-500'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 font-mono text-10 font-bold tracking-widest border ${styles}`}>
      {icon}{label}
    </span>
  )
}

function StatusBadge({ status }: { status: 'pass' | 'warn' | 'fail' }) {
  const styles = {
    pass: 'border-signal-500/40 text-signal-500',
    warn: 'border-caution-500/40 text-caution-500',
    fail: 'border-alarm-500/40 text-alarm-500',
  }[status]
  const Icon = status === 'pass' ? Check : status === 'warn' ? AlertTriangle : AlertCircle
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 font-mono text-10 font-bold tracking-widest border ${styles}`}>
      <Icon className="w-2.5 h-2.5" />{status.toUpperCase()}
    </span>
  )
}

function ScanSummary({ label, count, tone }: { label: string; count: number; tone: 'signal' | 'caution' | 'alarm' }) {
  const color = { signal: 'text-signal-500', caution: 'text-caution-500', alarm: 'text-alarm-500' }[tone]
  return (
    <div className="px-4 py-3 border-r last:border-r-0 border-steel-700">
      <div className={`font-mono text-10 font-bold tracking-[0.18em] mb-1 ${color}`}>{label}</div>
      <div className={`font-mono text-24 font-bold tabular-nums ${color}`}>{count}</div>
    </div>
  )
}

function TerminalBtn({ children, onClick, disabled, active }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; active?: boolean }) {
  const styles = active ? 'bg-blueprint-500 text-void-900 border-blueprint-500' : 'bg-transparent text-steel-200 border-steel-600 hover:border-blueprint-500 hover:text-blueprint-500'
  return (
    <button onClick={onClick} disabled={disabled} className={`inline-flex items-center gap-1 px-2.5 py-0.5 border font-mono text-10 font-bold tracking-widest transition-colors disabled:opacity-30 ${styles}`}>
      {children}
    </button>
  )
}

function ToggleBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2.5 py-1 font-mono text-10 font-bold tracking-widest transition-colors ${
        active ? 'bg-blueprint-500 text-void-900' : 'bg-transparent text-steel-300 hover:text-blueprint-500'
      }`}
    >
      {icon}<span>{label}</span>
    </button>
  )
}

function ResultTable({ result }: { result: QueryResult }) {
  return (
    <table className="cad-table">
      <thead><tr>{result.columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>
        {result.rows.slice(0, 200).map((row, i) => (
          <tr key={i}>{row.map((v, j) => (
            <td key={j} className={typeof v === 'number' ? 'num' : ''}>
              {v === null ? <span className="text-steel-600">NULL</span> : String(v)}
            </td>
          ))}</tr>
        ))}
      </tbody>
    </table>
  )
}
