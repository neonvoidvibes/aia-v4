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

  // Enable streaming with proper configuration
  const result = streamText({
    model: anthropic("claude-3-sonnet-20240229"),
    messages,
    providerOptions: {
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
    },
    // Enable proper streaming configuration
    stream: true,
  })

  return result.toDataStreamResponse()
}
