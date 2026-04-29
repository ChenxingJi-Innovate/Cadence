// URL → trainable dataset.
// User pastes a URL (industry article, JD, blog post). We fetch the page,
// strip HTML to text, then ask the LLM to convert it into NL→SQL training
// pairs grounded in Cadence's schema. Output is SFT JSONL — directly usable
// for fine-tuning (TRL / Unsloth / LLaMA-Factory / OpenAI / Anthropic APIs).

import { SAMPLE_DDL } from '../../lib/sample'
import { chatWithRetry, MODEL, errorResponse } from '../../lib/llm'

const UA = 'Mozilla/5.0 (Cadence/0.1; +https://cadence.demo) Chrome/124'

function stripHtml(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, ' ') : ''
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return { title, text }
}

export async function POST(req: Request) {
  try {
    const { url } = await req.json() as { url: string }
    if (!url || !/^https?:\/\//.test(url)) {
      return new Response('Missing or invalid url', { status: 400 })
    }

    const fetchRes = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' }, redirect: 'follow' })
    if (!fetchRes.ok) {
      return new Response(`Fetch failed: HTTP ${fetchRes.status}`, { status: 502 })
    }
    const html = await fetchRes.text()
    const { title, text } = stripHtml(html)
    const article = text.slice(0, 12000)
    if (article.length < 200) {
      return new Response('Page contained too little readable text (likely JS-rendered).', { status: 422 })
    }

    const prompt = `You are a senior data analyst on a music / artist-services team.
Your job: turn unstructured industry text into supervised fine-tuning data for an NL→SQL model.

═══════════════════════════════════════════════════════════
RULES — STRICT, NON-NEGOTIABLE
═══════════════════════════════════════════════════════════

R1 · DOMAIN SCOPE
   Only ingest content related to: music streaming, artist analytics,
   creator economy, music charts, label / publishing, social-media-driven
   music distribution, A&R, royalties, audience demographics.
   If the article is OFF-TOPIC, respond with:
   { "relevant": false, "summary": "<reason in 1 sentence>", "topics": [], "pairs": [] }
   and STOP. Do not generate filler pairs.

R2 · SQL CONSTRAINTS
   - SELECT-only. No INSERT / UPDATE / DELETE / DROP / ATTACH / PRAGMA.
   - Must execute on the schema below (SQLite dialect). No invented columns
     or tables.
   - Every query MUST reference at least one of the dim_* / dwd_* / dws_* /
     ads_* tables defined below.
   - Use the layering convention: prefer dws_/ads_ for rollups; drop to
     dwd_ only when event-grain detail (source, app_version, completion_pct,
     is_skip) is genuinely required.
   - Single statement, ending with semicolon. Always include LIMIT unless
     the query returns a small aggregate.

R3 · QUESTION QUALITY
   - Each question must be something a real artist-services analyst would
     ASK A LABEL OR ARTIST about. Not trivia ("how many rows in dim_artist"),
     not generic SQL exercises.
   - Question language: match the article (zh ↔ en).
   - No duplicate questions. No paraphrases of the same question.
   - Each question must be motivated by a SPECIFIC concept from the article;
     state which one in "rationale".

R4 · DIFFICULTY MIX (across the batch)
   - At least one simple aggregation (COUNT / SUM / AVG with WHERE).
   - At least one time-window query (last N days, WoW, MoM).
   - At least one JOIN across dim + dwd or dim + dws.
   - At least one window function (ROW_NUMBER / RANK / LAG / SUM OVER).

R5 · OUTPUT BUDGET
   Generate 5-8 pairs. Better fewer high-quality pairs than many shallow
   ones. Stay within the response token budget; if running long, cut pairs
   rather than truncate SQL.

R6 · DEMO ANCHOR
   Demo data is anchored at 2026-04-25. For "last N days" use:
   WHERE dt >= date('2026-04-25','-N days') AND dt <= '2026-04-25'.

═══════════════════════════════════════════════════════════
SCHEMA (immutable contract, SQLite dialect)
═══════════════════════════════════════════════════════════
${SAMPLE_DDL.slice(0, 4000)}

═══════════════════════════════════════════════════════════
INPUT
═══════════════════════════════════════════════════════════
ARTICLE TITLE: ${title || '(none)'}
ARTICLE URL: ${url}
ARTICLE TEXT:
"""
${article}
"""

═══════════════════════════════════════════════════════════
OUTPUT FORMAT — return JSON object, nothing else
═══════════════════════════════════════════════════════════
{
  "relevant": true,
  "summary": "2-3 sentence summary of what the article is about and why it's relevant to artist-services analytics",
  "topics": ["short tag", "short tag", "..."],
  "pairs": [
    {
      "question": "<analyst question in article's language>",
      "sql": "<one SELECT statement>",
      "rationale": "<which article concept inspired this>"
    }
  ]
}`

    const r = await chatWithRetry({
      model: MODEL,
      max_tokens: 8000,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = r.choices[0]?.message?.content ?? '{}'
    let parsed: { relevant?: boolean; summary?: string; topics?: string[]; pairs?: { question: string; sql: string; rationale?: string }[] }
    try { parsed = JSON.parse(raw) } catch {
      // Salvage path: response_format=json_object guarantees the start is JSON,
      // but Gemini occasionally truncates mid-pair. Try to parse the prefix
      // up to the last complete object in the pairs array.
      const trimmed = raw.replace(/,\s*\{[^{}]*$/, '').replace(/,\s*$/, '') + ']}'
      try {
        parsed = JSON.parse(trimmed.replace(/"pairs"\s*:\s*\[/, '"pairs":['))
      } catch {
        return new Response(`LLM returned malformed JSON (likely truncated). First 400 chars: ${raw.slice(0, 400)}`, { status: 502 })
      }
    }

    // R1: off-topic short-circuit — return what the LLM said, no pairs.
    if (parsed.relevant === false) {
      return Response.json({
        source_title: title || url,
        source_url: url,
        char_count: article.length,
        summary: parsed.summary ?? '(off-topic; no training data generated)',
        topics: parsed.topics ?? [],
        pairs: [],
        jsonl: '',
        record_count: 0,
        rejected_off_topic: true,
      })
    }

    // R2: enforce SQL constraints server-side regardless of what LLM produced.
    const ddlTables = ['dim_artist','dim_track','dim_sound','dim_geo','dwd_track_play_event','dwd_user_action_event','dwd_video_creation_event','dws_artist_country_day','dws_track_country_day','ads_artist_growth_daily']
    const FORBIDDEN = /\b(insert|update|delete|drop|attach|detach|pragma|create|alter|replace|truncate)\b/i
    const seenQuestions = new Set<string>()
    const pairs = (parsed.pairs ?? []).filter(p => {
      if (!p.question || !p.sql) return false
      const sql = p.sql.trim()
      if (FORBIDDEN.test(sql)) return false                                // R2 SELECT-only
      if (!/^\s*(with|select)\b/i.test(sql)) return false                  // R2 must start SELECT/WITH
      if (!ddlTables.some(t => new RegExp(`\\b${t}\\b`, 'i').test(sql))) return false   // R2 must reference DDL
      const qkey = p.question.trim().toLowerCase()
      if (seenQuestions.has(qkey)) return false                            // R3 no duplicates
      seenQuestions.add(qkey)
      return true
    })

    // Build SFT JSONL — one record per pair, in the universal "messages" format
    // accepted by HF TRL, Unsloth, LLaMA-Factory, OpenAI, Anthropic fine-tuning.
    const systemMsg = 'You are a senior data analyst. Translate the user question into ONE valid SQLite query against the music / artist-services warehouse.'
    const jsonl = pairs.map(p => JSON.stringify({
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: p.question },
        { role: 'assistant', content: p.sql.trim() },
      ],
      meta: {
        source_url: url,
        source_title: title,
        rationale: p.rationale ?? '',
      },
    })).join('\n')

    return Response.json({
      source_title: title || url,
      source_url: url,
      char_count: article.length,
      summary: parsed.summary ?? '',
      topics: parsed.topics ?? [],
      pairs,
      jsonl,
      record_count: pairs.length,
      raw_pair_count: parsed.pairs?.length ?? 0,
      dropped_count: (parsed.pairs?.length ?? 0) - pairs.length,
    })
  } catch (e) {
    return errorResponse(e, 'URL ingest failed')
  }
}
