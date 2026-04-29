import { chatWithRetry, MODEL, errorResponse } from '../../lib/llm'

export async function POST(req: Request) {
  try {
    const { schema } = await req.json()
    if (!schema?.trim()) return new Response('Missing schema', { status: 400 })

    const r = await chatWithRetry({
      model: MODEL,
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `你是数据工程师。下面是一份运行在分析侧的 SQL schema (SQLite 方言),请输出一份"Schema 档案",让一个生成 SQL 的 LLM 一眼看懂这个数据库。

输出 4 部分,每部分用编号开头:

1. 表清单 (按 dim / dwd / dws / ads 分层简述每张表装什么数据)
2. 关键关系 (哪些外键、哪些表通常需要 JOIN 才有意义)
3. 业务语义 (这个 schema 表达的业务、典型的分析问题、常见 KPI)
4. SQL 风格建议 (生成 SQL 时应注意的方言/约定,例如时间字段是 'YYYY-MM-DD HH:MM:SS' 字符串、日期截断使用 substr() 或 strftime() 等;何时优先用 dws/ads 而不是直接打 dwd)

Schema:
"""
${schema}
"""

直接输出,不要 markdown 标题、不要 code block。`
      }],
    })

    const profile = r.choices[0]?.message?.content ?? ''
    return Response.json({ profile })
  } catch (e: unknown) {
    return errorResponse(e, 'profile failed')
  }
}
