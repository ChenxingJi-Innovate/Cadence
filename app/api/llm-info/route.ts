// Tiny info endpoint so the footer can render the active LLM provider/model
// without hardcoding it in client strings (the wrong one would otherwise stay
// stale when you swap providers via env vars).

import { MODEL, PROVIDER_NAME } from '../../lib/llm'

export async function GET() {
  return Response.json({ provider: PROVIDER_NAME, model: MODEL })
}
