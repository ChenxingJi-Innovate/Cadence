import { chatWithRetry, MODEL, errorResponse } from '../../lib/llm'

type Example = { question: string; sql: string }

export async function POST(req: Request) {
  try {
    const { schema, profile, question, examples, entity_hints, retry_error, retry_sql } = await req.json() as {
      schema: string
      profile?: string
      question: string
      examples?: Example[]
      entity_hints?: string
      retry_error?: string
      retry_sql?: string
    }
    if (!schema?.trim() || !question?.trim()) {
      return new Response('Missing schema or question', { status: 400 })
    }

    const fewShotBlock = examples && examples.length > 0
      ? `\n\nWORKED EXAMPLES from this team's past successful queries (mimic the style and table choice):\n${
          examples.map((ex, i) => `Example ${i+1}:\nQ: ${ex.question}\nSQL:\n${ex.sql}`).join('\n\n')
        }\n`
      : ''

    const entityBlock = entity_hints
      ? `\n\nCANONICAL ENTITY VALUES in the database (use these literal strings; map user-mentioned variations to them):\n${entity_hints}\n`
      : ''

    const retryBlock = retry_error && retry_sql
      ? `\n\nSELF-CORRECTION: A previous attempt failed. Generate a corrected query.\nFailed SQL:\n${retry_sql}\n\nError from SQLite:\n${retry_error}\n`
      : ''

    const r = await chatWithRetry({
      model: MODEL,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: `You are a senior data analyst on a music / artist-services team.
Convert the user's question into ONE executable SQL query against the schema below.

WAREHOUSE LAYERING — CHOOSE THE RIGHT TABLE:
- dim_*  : dimensions (artist / track / sound / geo). JOIN to enrich, never aggregate from here.
- dwd_*  : raw cleaned event facts. Use only when the question needs event-level detail (by source, by app_version, completion_pct, is_skip).
- dws_*  : daily aggregate cubes (artist×country×day, track×country×day). PREFER these for "by day / by country / by tier" rollup questions.
- ads_artist_growth_daily : the artist-services dashboard mart with pre-computed plays_d1/d7/d28, growth_pct_wow. PREFER for growth / momentum / rolling-window questions at the artist grain.

DIALECT — SQLite:
- Dates stored as TEXT. dt is the partition key in 'YYYY-MM-DD'. event_time is 'YYYY-MM-DD HH:MM:SS' UTC.
- Demo data is anchored at 2026-04-25, so for "last N days" use:  WHERE dt >= date('2026-04-25','-N days') AND dt <= '2026-04-25'.
- Window functions (ROW_NUMBER, RANK, LAG, SUM/AVG OVER ...) and CTEs (WITH ...) are supported.
- Use NULLIF to guard division. Use ROUND(x, n) for ratios.

OUTPUT REQUIREMENTS:
- A single statement, ending with a semicolon. No comments inside the SQL.
- Always LIMIT 100 unless the question is an aggregate that returns few rows.
- Prefer readable formatting with line breaks before SELECT / FROM / JOIN / WHERE / GROUP BY / ORDER BY.${entityBlock}${fewShotBlock}${retryBlock}

Schema:
"""
${schema}
"""

${profile ? `Schema profile:\n"""\n${profile}\n"""\n\n` : ''}User question:
"""
${question}
"""

Return JSON ONLY:
{"sql":"...","explanation":"one short sentence in the user's language explaining what the query does and which warehouse layer it hits"}`
      }],
    })

    const text = r.choices[0]?.message?.content ?? '{}'
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/```\s*$/, '').trim()
    const parsed = JSON.parse(cleaned)
    return Response.json(parsed)
  } catch (e: unknown) {
    return errorResponse(e, 'nl2sql failed')
  }
}
