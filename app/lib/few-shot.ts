// Few-shot retrieval over saved reports (per IBM's "systems learn from
// successful past queries"). Lightweight Jaccard token overlap — no vectors,
// no extra API call. Top-K matches are injected into the nl2sql prompt as
// worked examples to bias the model toward the team's actual SQL conventions.

export type Report = {
  id: string
  question: string
  sql: string
  explanation?: string
  createdAt: number
}

const STOP = new Set([
  'a','an','the','of','in','on','for','to','by','and','or','at','is','are',
  'from','with','as','vs','per','my','i','we','that','this','these','those',
  '过去','哪些','的','是','在','和','与','按','每','最','多','少','最近',
])

function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1 && !STOP.has(t))
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

export function topMatches(question: string, reports: Report[], k = 3): Report[] {
  if (reports.length === 0) return []
  const qTokens = tokens(question)
  return reports
    .map(r => ({ r, score: jaccard(qTokens, tokens(r.question)) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(x => x.r)
}
