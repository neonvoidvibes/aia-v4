import { anthropic } from "@ai-sdk/anthropic"
import { streamText } from "ai"

// Allow streaming responses up to 30 seconds
export const maxDuration = 30

export async function POST(req: Request) {
  const { messages } = await req.json()

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY is not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }

  const result = await streamText({
    model: anthropic("claude-sonnet-4-20250514"),
    messages,
  })

  return result.toDataStreamResponse();
}
