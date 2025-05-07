import { type NextRequest } from 'next/server';
import { StreamingTextResponse } from 'ai';
import { findActiveBackend, formatErrorChunk } from '../proxyUtils'; // Use shared util
// Import our specific server client helper
import { createServerActionClient } from '@/utils/supabase/server'
// We don't need cookies() import directly here anymore if using the helper
// import { cookies } from 'next/headers'
// import type { Database } from '@/types/supabase' // Comment out or remove if types not generated

// Re-read env var or rely on util to read it if centralized there
const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export const maxDuration = 60;

// Chat-specific text formatting remains here
function formatTextChunk(text: string): string {
    return `0:${JSON.stringify(text)}\n`;
}

export async function POST(req: NextRequest) {
  console.log("[Proxy] Received POST request to /api/proxy-chat");
  // Instantiate client using our helper (handles cookies internally)
  const supabase = await createServerActionClient() // Use the correct helper, add await

  try {
    // --- Authenticate User ---
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        console.warn("[Proxy] Unauthorized chat request:", authError?.message);
        // Return error formatted for AI SDK stream
        const errorStreamChunk = formatErrorChunk("Unauthorized: Invalid session");
        const errorStream = new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode(errorStreamChunk)); controller.close(); }
        });
        return new StreamingTextResponse(errorStream, { status: 401 });
    }
    console.log(`[Proxy] Authenticated user: ${user.id}`);
    // --- End Authentication ---

    // --- Find Active Backend URL ---
    const activeBackendUrl = await findActiveBackend(POTENTIAL_BACKEND_URLS);

    if (!activeBackendUrl) {
        const errorMsg = `Could not connect to any configured backend: ${POTENTIAL_BACKEND_URLS.join(', ')}. Please ensure the backend server is running and accessible.`;
        console.error(`[Proxy] Fatal Error: ${errorMsg}`);
        // Return an error formatted for the AI SDK stream
        const errorStreamChunk = formatErrorChunk(errorMsg);
        const errorStream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(errorStreamChunk));
            controller.close();
          }
        });
        // Use 503 Service Unavailable status code
        return new StreamingTextResponse(errorStream, { status: 503 });
    }
    // --- Use activeBackendUrl from now on ---

    const body = await req.json();
    console.log("[Proxy] Parsed request body:", body); // Log parsed body
    // Filter out system messages added by the onError handler before proxying
    const userMessages = body.messages?.filter((msg: { role: string }) => msg.role === 'user' || msg.role === 'assistant') || [];
    const { agent, event } = body;

    // Basic validation for essential fields
    if (!userMessages || userMessages.length === 0) return new Response(JSON.stringify({ error: 'Missing user/assistant messages' }), { status: 400 });
    if (!agent) return new Response(JSON.stringify({ error: 'Missing agent' }), { status: 400 });

    console.log(`[Proxy] Chat request for Agent: ${agent}, Event: ${event || '0000'}`);
    // Construct the specific API endpoint using the active base URL
    const backendChatUrl = `${activeBackendUrl}/api/chat`;
    const requestBody = JSON.stringify({ messages: userMessages, agent: agent, event: event || '0000' });
    console.log(`[Proxy] Fetching backend: ${backendChatUrl} with body:`, requestBody); // Log URL and body

    // --- Main fetch call to the selected backend ---
    // Get the access token from the server-side session we just validated
    const { data: { session } } = await supabase.auth.getSession(); // We need the session object too
    const backendHeaders: HeadersInit = { 'Content-Type': 'application/json' };

    if (session?.access_token) {
      backendHeaders['Authorization'] = `Bearer ${session.access_token}`;
      console.log("[Proxy] Adding server-side session token to backend request header.");
    } else {
        // This indicates an issue with the session validation or token availability server-side
        console.error("[Proxy] Critical: Server-side session valid but access token missing. Aborting backend call.");
        const errorStreamChunk = formatErrorChunk("Internal Server Error: Failed to retrieve auth token");
        const errorStream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(errorStreamChunk)); controller.close(); }});
        return new StreamingTextResponse(errorStream, { status: 500 });
    }

    const backendResponse = await fetch(backendChatUrl, {
      method: 'POST',
      headers: backendHeaders, // Use headers potentially including Authorization
      body: requestBody,
    });

    // Log raw status immediately
    console.log(`[Proxy] Raw backend response status: ${backendResponse.status} ${backendResponse.statusText}`);

    // Check if the backend responded successfully
    if (!backendResponse.ok) {
       let errorBody = "[Could not read error body]";
       try {
           errorBody = await backendResponse.text();
       } catch (readError) {
           console.error("[Proxy] Failed to read error body from backend response:", readError);
       }
       console.error(`[Proxy] Backend fetch failed: ${backendResponse.status} ${backendResponse.statusText}. Body:`, errorBody);
       // Format error for Vercel AI SDK stream
       const errorStreamChunk = formatErrorChunk(`Backend error (${backendResponse.status}): ${errorBody || backendResponse.statusText}`);
       const errorStream = new ReadableStream({
         start(controller) {
           controller.enqueue(new TextEncoder().encode(errorStreamChunk));
           controller.close();
         }
       });
       // Use StreamingTextResponse for consistency, returning the backend's status
       return new StreamingTextResponse(errorStream, { status: backendResponse.status });
    }

    // Check if the backend response body exists
    if (!backendResponse.body) {
        console.error(`[Proxy] Backend response OK (${backendResponse.status}) but body is null.`);
        // Format error for Vercel AI SDK stream
        const errorStreamChunk = formatErrorChunk("Backend returned empty response");
        const errorStream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(errorStreamChunk));
            controller.close();
          }
        });
        // Use StreamingTextResponse with a 500 status
        return new StreamingTextResponse(errorStream, { status: 500 });
    }
    // --- End Main Fetch Handling ---

    console.log("[Proxy] Backend response OK and has body. Creating ReadableStream for proxying...");

    // --- Manual ReadableStream Creation for Proxying Backend Stream ---
    const backendStream = backendResponse.body;
    const textDecoder = new TextDecoder();
    let buffer = '';
    const eventSeparator = '\n\n'; // Python backend uses double newline for SSE
    const encoder = new TextEncoder(); // Needed to encode formatted chunks

    const readableStream = new ReadableStream({
      async start(controller) {
        console.log("[Proxy] Manual ReadableStream start() entered.");
        const reader = backendStream.getReader();
        let chunkCounter = 0; // Count chunks for logging

        try {
          while (true) {
            const logPrefix = `[Proxy Chunk ${++chunkCounter}]`;
            // console.log(`${logPrefix} Reading from backend stream...`); // Reduce log noise
            const { value, done } = await reader.read();

            if (done) {
              console.log(`${logPrefix} Backend stream finished (reader.read done=true).`);
              // Process any final content remaining in the buffer
              if (buffer.length > 0) {
                  console.log(`${logPrefix} Processing final buffer content: '${buffer.substring(0,100)}...'`);
                   const lines = buffer.split('\n'); // Process potentially partial lines
                   for (const line of lines) {
                       if (line.startsWith('data: ')) {
                           try {
                               const content = line.slice(6).trim();
                               if(content) {
                                   const jsonData = JSON.parse(content);
                                   if (jsonData.delta) { // Check for text delta
                                       const formattedChunk = formatTextChunk(jsonData.delta);
                                       controller.enqueue(encoder.encode(formattedChunk));
                                   } // Ignore other final JSON messages like 'done' if needed
                               }
                           } catch(e) { console.error(`${logPrefix} Error parsing final buffer JSON:`, e, buffer);}
                       }
                   }
                   buffer = ''; // Clear buffer after final processing
               }
              console.log(`${logPrefix} Closing controller.`);
              controller.close(); // Signal the end of our stream
              break; // Exit the read loop
            }

             if (value) {
                // console.log(`${logPrefix} Received ${value.byteLength} bytes. Decoding...`); // Reduce log noise
                buffer += textDecoder.decode(value, { stream: true }); // Decode and append to buffer
                // console.log(`${logPrefix} Buffer state (first 100): '${buffer.substring(0,100)}'`); // Reduce log noise
                let eventIndex = buffer.indexOf(eventSeparator); // Find the SSE separator
                // console.log(`${logPrefix} Found event separator at index: ${eventIndex}`); // Reduce log noise

                // Process complete events found in the buffer
                while (eventIndex !== -1) {
                  const eventData = buffer.substring(0, eventIndex); // Extract the event data
                  buffer = buffer.substring(eventIndex + eventSeparator.length); // Remove event and separator from buffer
                  // console.log(`${logPrefix} Processing complete event data: '${eventData}'`); // Reduce log noise
                  // console.log(`${logPrefix} Remaining buffer (first 100): '${buffer.substring(0,100)}'`); // Reduce log noise

                  const lines = eventData.split('\n'); // Process lines within the event
                  for (const line of lines) {
                    if (line.startsWith('data: ')) { // Check for SSE data line
                      try {
                        const content = line.slice(6).trim(); // Extract JSON content
                        if (content) { // Ensure content is not empty
                           const jsonData = JSON.parse(content);
                           if (jsonData.delta) { // If it's a text chunk
                               const formattedChunk = formatTextChunk(jsonData.delta);
                               controller.enqueue(encoder.encode(formattedChunk)); // Enqueue formatted chunk
                           } else if (jsonData.error) { // If the backend sent an error
                               console.error(`${logPrefix} Error from backend stream (event data):`, jsonData.error);
                               controller.enqueue(encoder.encode(formatErrorChunk(jsonData.error))); // Forward formatted error
                           } // Ignore 'done' messages or other types if necessary
                        } else {
                             console.log(`${logPrefix} Empty data content after 'data: '`);
                         }
                      } catch (e) {
                        console.error(`${logPrefix} Error parsing backend JSON:`, e, 'Line:', line);
                      }
                    } else if (line.trim() !== '') { // Log unexpected lines within an event
                         console.warn(`${logPrefix} Received non-data line within event:`, line);
                     }
                  }
                  eventIndex = buffer.indexOf(eventSeparator); // Check for more events in the updated buffer
                  // console.log(`${logPrefix} Found next event separator at index: ${eventIndex}`); // Reduce log noise
                } // end while(eventIndex !== -1)
             } else {
                 console.log(`${logPrefix} Received empty chunk value.`); // Should not happen if done=false
             }
          } // end while(true) reader loop
        } catch (error: any) {
          console.error("[Proxy] Error reading from backend stream:", error);
          // Attempt to send an error message through the stream
          try {
              const errorChunk = formatErrorChunk(`Stream read error: ${error.message || error}`);
              controller.enqueue(encoder.encode(errorChunk));
              controller.error(error); // Propagate error to our stream's consumer
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
         // Log if the stream consumer cancels
         console.log("[Proxy] Manual ReadableStream cancelled:", reason);
      }
    });
    // --- End Manual ReadableStream Creation ---

    // Use StreamingTextResponse (requires import 'ai')
    // Pass the manually created and formatted stream
    console.log("[Proxy] Returning StreamingTextResponse.");
    return new StreamingTextResponse(readableStream);

  } catch (error: any) {
    // Catch top-level errors (e.g., JSON parsing error in request, initial backend find failure)
    console.error("[Proxy] Error in top-level POST handler:", error);
    let errorMessage = error.message || 'An internal server error occurred';
    // Provide more specific error for connection timeout during health check (might be caught here if findActiveBackend throws)
    if (error.message?.includes("Could not connect to any configured backend")) {
        errorMessage = error.message; // Use the specific message from findActiveBackend failure
    } else if (error.cause && error.cause.code === 'UND_ERR_CONNECT_TIMEOUT') {
        // This might catch timeouts during the main fetch if findActiveBackend succeeded but chat fetch failed
        errorMessage = `Connection timed out trying to reach the backend. Please ensure it's running and accessible.`;
    } else if (error.cause) {
        errorMessage += ` (Cause: ${error.cause.code || error.cause.message})`;
    }
    console.error("[Proxy] Error Details:", error.cause || error); // Log full cause or error object

    // Format error for Vercel AI SDK stream
    const errorStreamChunk = formatErrorChunk(errorMessage);
    const errorStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(errorStreamChunk));
        controller.close();
      }
    });
    // Use StreamingTextResponse with a 500 status
    return new StreamingTextResponse(errorStream, { status: 500 });
  }
}