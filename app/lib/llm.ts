// Shared LLM client wrapper.
// Gemini exposes an OpenAI-compatible endpoint. The free tier rate-limits
// aggressively (10 RPM is common), so we retry once on 429 with a short
// delay and surface a readable error if the limit is still hit afterwards.

import OpenAI from 'openai'
import type { ChatCompletionCreateParamsNonStreaming, ChatCompletion } from 'openai/resources/chat/completions'

export const llm = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
})

export const MODEL = 'gemini-2.5-flash'

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

// Retry strategy: one quick retry after 4s on 429. If that also 429s, throw a
// RateLimitedError telling the caller to wait ~30s. Other errors propagate.
export async function chatWithRetry(params: ChatCompletionCreateParamsNonStreaming): Promise<ChatCompletion> {
  try {
    return await llm.chat.completions.create(params)
  } catch (e) {
    if (getStatus(e) !== 429) throw e
    await sleep(4000)
    try {
      return await llm.chat.completions.create(params)
    } catch (e2) {
      if (getStatus(e2) === 429) throw new RateLimitedError(30)
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
  return new Response(msg, { status: status >= 400 && status < 600 ? status : 500 })
}
