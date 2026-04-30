// Shared LLM client wrapper.
// Multi-provider: prefer DeepSeek (cheap, no aggressive rate limit, workspace
// default). Fall back to Gemini if only GEMINI_API_KEY is set. Both expose
// OpenAI-compatible endpoints, so the difference is just baseURL + model.
//
// Gemini 2.5 Flash free tier is 10 RPM and overloads with 503s often;
// DeepSeek-chat has no comparable RPM cap and costs <$0.5/month for this demo.

import OpenAI from 'openai'
import type { ChatCompletionCreateParamsNonStreaming, ChatCompletion } from 'openai/resources/chat/completions'

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY
const GEMINI_KEY = process.env.GEMINI_API_KEY

const provider = DEEPSEEK_KEY ? 'deepseek' : GEMINI_KEY ? 'gemini' : null

export const llm = new OpenAI({
  apiKey: provider === 'deepseek' ? DEEPSEEK_KEY : GEMINI_KEY ?? '',
  baseURL: provider === 'deepseek'
    ? 'https://api.deepseek.com/v1'
    : 'https://generativelanguage.googleapis.com/v1beta/openai/',
})

export const MODEL = provider === 'deepseek' ? 'deepseek-chat' : 'gemini-2.5-flash'
export const PROVIDER_NAME = provider ?? 'unconfigured'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export class RateLimitedError extends Error {
  retryAfterSec: number
  constructor(retryAfterSec: number) {
    super(`RATE_LIMITED: Gemini API quota exceeded. Wait ~${retryAfterSec}s and retry.`)
    this.name = 'RateLimitedError'
    this.retryAfterSec = retryAfterSec
  }
}

function getStatus(e: unknown): number | undefined {
  if (typeof e === 'object' && e !== null && 'status' in e) {
    const s = (e as { status?: unknown }).status
    if (typeof s === 'number') return s
  }
  return undefined
}

// Retry strategy: 429 (rate-limited) and 503 (overloaded) both get one quick
// retry after 4s. Gemini's free tier returns 503 when servers are saturated,
// distinct from 429 quota errors but same recovery — wait briefly and retry.
// If the second attempt also fails the same way, throw RateLimitedError so
// the caller surfaces a friendly "wait ~30s" message instead of a raw status.
const RETRYABLE = new Set([429, 503])
export async function chatWithRetry(params: ChatCompletionCreateParamsNonStreaming): Promise<ChatCompletion> {
  try {
    return await llm.chat.completions.create(params)
  } catch (e) {
    const s = getStatus(e)
    if (s == null || !RETRYABLE.has(s)) throw e
    await sleep(4000)
    try {
      return await llm.chat.completions.create(params)
    } catch (e2) {
      const s2 = getStatus(e2)
      if (s2 != null && RETRYABLE.has(s2)) throw new RateLimitedError(30)
      throw e2
    }
  }
}

export function errorResponse(e: unknown, fallback: string): Response {
  if (e instanceof RateLimitedError) {
    return new Response(e.message, { status: 429 })
  }
  const status = getStatus(e) ?? 500
  const msg = e instanceof Error ? e.message : fallback
  if (status === 429) {
    return new Response(`RATE_LIMITED: Gemini API quota exceeded. Wait ~30s and retry.`, { status: 429 })
  }
  if (status === 503) {
    return new Response(`UPSTREAM_OVERLOAD: Gemini servers are overloaded. Wait ~30s and retry.`, { status: 503 })
  }
  return new Response(msg, { status: status >= 400 && status < 600 ? status : 500 })
}
