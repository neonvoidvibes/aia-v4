// /aia-v4-frontend/app/api/proxy-chat/route.ts
import { type NextRequest } from 'next/server';
import { StreamingTextResponse } from 'ai'; // Use Vercel AI SDK for easy streaming

// IMPORTANT: Replace with your actual backend URL
// Best practice: Use an environment variable
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://127.0.0.1:5001';

// Allow streaming responses up to 60 seconds for the proxy route
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages, agent, event } = body; // Extract necessary data

    if (!messages) {
      return new Response(JSON.stringify({ error: 'Missing messages in request body' }), { status: 400 });
    }
    if (!agent) {
       return new Response(JSON.stringify({ error: 'Missing agent in request body' }), { status: 400 });
     }
     // event can default if needed, backend handles '0000'

    console.log(`Proxying chat request for Agent: ${agent}, Event: ${event || '0000'}`);
    console.log("Messages being proxied:", JSON.stringify(messages, null, 2)); // Log messages being sent

    const backendResponse = await fetch(`${BACKEND_API_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Add any other necessary headers (like authorization if you implement it later)
      },
      body: JSON.stringify({
          messages: messages, // Pass the original messages structure
          agent: agent,
          event: event || '0000' // Ensure event is passed
      }),
      // IMPORTANT: Set duplex: 'half' to allow streaming the request body
      // (although less critical for simple JSON POST, it's vital for streaming uploads)
      // And crucially, to handle streaming *responses* from the Python backend
      // We need to tell fetch *not* to buffer the entire response.
      // However, the standard fetch doesn't directly expose low-level stream control like Node's http.request.
      // The key is that `fetch` *will* return a ReadableStream in `backendResponse.body`
      // if the server sends a chunked response, which Flask/FastAPI streaming does.
    });

    if (!backendResponse.ok) {
      const errorBody = await backendResponse.text();
      console.error(`Backend API error: ${backendResponse.status} ${backendResponse.statusText}`, errorBody);
      return new Response(JSON.stringify({ error: `Backend error: ${errorBody || backendResponse.statusText}` }), { status: backendResponse.status });
    }

    if (!backendResponse.body) {
       return new Response(JSON.stringify({ error: 'Backend response missing body' }), { status: 500 });
     }

    // --- Adapt Python SSE stream to Vercel AI SDK format ---
    const pythonStream = backendResponse.body;
    const transformStream = new TransformStream({
        async transform(chunk, controller) {
            const textDecoder = new TextDecoder();
            const chunkText = textDecoder.decode(chunk);
            // console.log("Raw chunk from backend:", chunkText); // Debugging

            // Split potential multiple SSE events in one chunk
            const lines = chunkText.split('\n').filter(line => line.trim() !== '');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                  try {
                      const jsonData = JSON.parse(line.slice(6));
                      if (jsonData.delta) {
                          // console.log("Yielding delta:", jsonData.delta); // Debugging
                          controller.enqueue(jsonData.delta); // Send only the text content
                      } else if (jsonData.error) {
                          console.error("Error received from backend stream:", jsonData.error);
                          // Handle error - maybe enqueue an error message or terminate?
                          // For now, we'll just log it. The 'done' signal won't be processed.
                          // You might want to signal an error state to the frontend differently.
                          // controller.enqueue(`[STREAM ERROR: ${jsonData.error}]`);
                      } else if (jsonData.done) {
                          console.log("Backend signaled done.");
                          // Don't enqueue anything for 'done', just let the stream close naturally
                      }
                  } catch (e) {
                      console.error('Error parsing JSON from backend stream line:', e, 'Line:', line);
                  }
              }
            }
        },
        flush(controller) {
            console.log("Proxy stream flushing and closing.");
            controller.terminate();
        }
    });

    // Pipe the Python stream through the transformer
    const readableStream = pythonStream.pipeThrough(transformStream);

    // Return the transformed stream using Vercel AI SDK's StreamingTextResponse
    return new StreamingTextResponse(readableStream);

  } catch (error: any) {
    console.error("Error in proxy chat route:", error);
    return new Response(JSON.stringify({ error: error.message || 'An internal server error occurred' }), { status: 500 });
  }
}