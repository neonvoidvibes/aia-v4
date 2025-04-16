import { type NextRequest } from 'next/server';
// Use StreamingTextResponse from 'ai' package
import { StreamingTextResponse } from 'ai';

// Use NEXT_PUBLIC_ prefix to be consistent and allow access from browser if needed elsewhere
const BACKEND_API_URL = process.env.NEXT_PUBLIC_BACKEND_API_URL || 'http://127.0.0.1:5001';
export const maxDuration = 60;

// Helper function to format text chunk according to Vercel AI SDK Text Stream format
// Prefix '0:' indicates a text chunk.
function formatTextChunk(text: string): string {
    // Ensure proper JSON stringification, including escaping special chars
    return `0:${JSON.stringify(text)}\n`;
}

 // Helper function to format error chunk
 function formatErrorChunk(errorMsg: string): string {
     // Prefix '2:' for errors (common convention in Vercel AI SDK internal format)
     return `2:${JSON.stringify(errorMsg)}\n`;
 }

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Filter out system messages added by the onError handler before proxying
    const userMessages = body.messages?.filter((msg: { role: string }) => msg.role === 'user' || msg.role === 'assistant') || [];
    const { agent, event } = body;

    if (!userMessages || userMessages.length === 0) return new Response(JSON.stringify({ error: 'Missing user/assistant messages' }), { status: 400 });
    if (!agent) return new Response(JSON.stringify({ error: 'Missing agent' }), { status: 400 });

    console.log(`[Proxy] Chat request for Agent: ${agent}, Event: ${event || '0000'}`);

    const backendResponse = await fetch(`${BACKEND_API_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: userMessages, agent: agent, event: event || '0000' }),
    });

    console.log(`[Proxy] Backend fetch status: ${backendResponse.status}`); // Log status

    if (!backendResponse.ok || !backendResponse.body) {
       const errorBody = await backendResponse.text();
       console.error(`[Proxy] Backend API error: ${backendResponse.status} ${backendResponse.statusText}`, errorBody);
       return new Response(`Backend error: ${errorBody || backendResponse.statusText}`, { status: backendResponse.status });
    }

    console.log("[Proxy] Backend response OK and has body. Creating ReadableStream..."); // Log before stream creation

    // --- Manual ReadableStream Creation ---
    const backendStream = backendResponse.body;
    const textDecoder = new TextDecoder();
    let buffer = '';
    const eventSeparator = '\n\n'; // Python backend uses double newline
    const encoder = new TextEncoder(); // Need encoder to send bytes

    const readableStream = new ReadableStream({
      async start(controller) {
        console.log("[Proxy] Manual ReadableStream start() entered."); // Log entry
        const reader = backendStream.getReader();
        let chunkCounter = 0; // Count chunks

        try {
          while (true) {
            const logPrefix = `[Proxy Chunk ${++chunkCounter}]`; // Prefix for logs related to this chunk
            console.log(`${logPrefix} Reading from backend stream...`);
            const { value, done } = await reader.read();

            if (done) {
              console.log(`${logPrefix} Backend stream finished (reader.read done=true).`);
              // Process final buffer content
              if (buffer.length > 0) {
                  console.log(`${logPrefix} Processing final buffer content: '${buffer.substring(0,100)}...'`);
                   // Attempt to process even if no trailing separator
                   const lines = buffer.split('\n');
                   for (const line of lines) {
                       if (line.startsWith('data: ')) {
                           try {
                               const content = line.slice(6).trim();
                               if(content) {
                                   const jsonData = JSON.parse(content);
                                   if (jsonData.delta) {
                                       const formattedChunk = formatTextChunk(jsonData.delta);
                                       // Removed console log for final buffer chunk
                                       controller.enqueue(encoder.encode(formattedChunk));
                                   }
                               }
                           } catch(e) { console.error(`${logPrefix} Error parsing final buffer JSON:`, e, buffer);}
                       }
                   }
                   buffer = ''; // Clear buffer after final processing
               }
              console.log(`${logPrefix} Closing controller.`);
              controller.close();
              break;
            }

             if (value) {
                console.log(`${logPrefix} Received ${value.byteLength} bytes. Decoding...`);
                buffer += textDecoder.decode(value, { stream: true });
                console.log(`${logPrefix} Buffer state (first 100): '${buffer.substring(0,100)}'`);
                let eventIndex = buffer.indexOf(eventSeparator);
                console.log(`${logPrefix} Found event separator at index: ${eventIndex}`);

                while (eventIndex !== -1) {
                  const eventData = buffer.substring(0, eventIndex);
                  buffer = buffer.substring(eventIndex + eventSeparator.length); // Consume event and separator
                  console.log(`${logPrefix} Processing complete event data: '${eventData}'`);
                  console.log(`${logPrefix} Remaining buffer (first 100): '${buffer.substring(0,100)}'`);

                  const lines = eventData.split('\n');
                  for (const line of lines) {
                    if (line.startsWith('data: ')) {
                      try {
                        const content = line.slice(6).trim();
                        if (content) {
                           const jsonData = JSON.parse(content);
                           if (jsonData.delta) {
                               // Format the delta using the SDK convention '0:"..."\n'
                               const formattedChunk = formatTextChunk(jsonData.delta);
                               // Removed console log for formatted chunk
                               controller.enqueue(encoder.encode(formattedChunk)); // Enqueue encoded formatted chunk
                           } else if (jsonData.error) {
                               console.error(`${logPrefix} Error from backend stream (event data):`, jsonData.error);
                               controller.enqueue(encoder.encode(formatErrorChunk(jsonData.error)));
                           } // Ignore 'done' messages within the data payload for now
                        } else {
                             console.log(`${logPrefix} Empty data content after 'data: '`);
                         }
                      } catch (e) {
                        console.error(`${logPrefix} Error parsing backend JSON:`, e, 'Line:', line);
                      }
                    } else if (line.trim() !== '') {
                         console.warn(`${logPrefix} Received non-data line within event:`, line);
                     }
                  }
                  eventIndex = buffer.indexOf(eventSeparator); // Check for more events in the updated buffer
                  console.log(`${logPrefix} Found next event separator at index: ${eventIndex}`);
                } // end while(eventIndex !== -1)
             } else {
                 console.log(`${logPrefix} Received empty chunk value.`);
             }
          } // end while(true) reader loop
        } catch (error) {
          console.error("[Proxy] Error reading from backend stream:", error);
          try {
              const errorChunk = formatErrorChunk(`Stream read error: ${error}`);
              // Removed console log for error chunk
              controller.enqueue(encoder.encode(errorChunk));
              controller.error(error); // Propagate error to our stream
          } catch (e) {
               console.error("[Proxy] Error enqueuing/closing controller after read error:", e);
           }
        } finally {
           // Ensure controller is closed if not already
           try { controller.close(); } catch (e) {}
           console.log("[Proxy] Manual ReadableStream finally block executed.");
        }
      },
      cancel(reason) {
         console.log("[Proxy] Manual ReadableStream cancelled:", reason);
      }
    });
    # TODO: Add chat archiving logic here using s3_utils if needed

    sse_done_data = json.dumps({'done': True})
    # Removed console log for done chunk
    yield f"data: {sse_done_data}\n\n"

# Return the streaming response with correct MIME type for SSE
  } catch (error: any) {
    console.error("[Proxy] Error in top-level POST handler:", error);
    if (error.cause) { console.error("[Proxy] Fetch Error Cause:", error.cause); }
    return new Response(error.message || 'An internal server error occurred', { status: 500 });
  }
}