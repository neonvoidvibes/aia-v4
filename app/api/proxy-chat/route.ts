import { type NextRequest } from 'next/server';
// Use StreamingTextResponse from 'ai' package
import { StreamingTextResponse } from 'ai';

// Use a comma-separated list of potential backend URLs from environment variable
// Default to localhost if the variable is not set
const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
// Split the string by commas, trim whitespace from each URL, and filter out any empty strings resulting from extra commas
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',')
                                                    .map(url => url.trim())
                                                    .filter(url => url);

export const maxDuration = 60; // Increase max duration if needed

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

 // --- New Helper Function: findActiveBackend ---
 async function findActiveBackend(urls: string[]): Promise<string | null> {
    if (!urls || urls.length === 0) {
        console.error("[Proxy Health Check] No backend URLs configured.");
        // Attempt default localhost as a last resort if nothing is configured
        urls = ['http://127.0.0.1:5001'];
        // return null; // Original behavior if strict checking is needed
    }
    console.log("[Proxy Health Check] Checking potential backend URLs:", urls);

    for (const baseUrl of urls) {
        const healthUrl = `${baseUrl}/api/health`; // Assuming health check endpoint exists
        try {
            console.log(`[Proxy Health Check] Pinging ${healthUrl}...`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000); // 2-second timeout

            const response = await fetch(healthUrl, {
                method: 'GET',
                signal: controller.signal // Pass the abort signal to fetch
             });
             clearTimeout(timeoutId); // Important: clear the timeout if fetch completes

            if (response.ok) {
                // Optional: Check response body if needed, e.g., for {"status": "ok"}
                // const healthData = await response.json();
                // if (healthData.status === 'ok') { ... }
                console.log(`[Proxy Health Check] Success: ${baseUrl} is active.`);
                return baseUrl; // Found active backend
            } else {
                 // Log non-OK responses but continue checking other URLs
                 console.warn(`[Proxy Health Check] ${baseUrl} responded with status ${response.status}`);
             }
        } catch (error: any) {
            // Handle fetch errors (network issue, timeout, etc.)
            if (error.name === 'AbortError') {
                 console.warn(`[Proxy Health Check] Timeout connecting to ${healthUrl}`);
             } else {
                 console.warn(`[Proxy Health Check] Error connecting to ${healthUrl}: ${error.message}`);
             }
             // Continue to the next URL
        }
    }

    console.error("[Proxy Health Check] No active backend found among:", urls);
    return null; // No active backend found after checking all URLs
 }
 // --- End Helper Function ---


export async function POST(req: NextRequest) {
  console.log("[Proxy] Received POST request to /api/proxy-chat");
  try {
    // --- Find Active Backend URL ---
    const activeBackendUrl = await findActiveBackend(POTENTIAL_BACKEND_URLS);

    if (!activeBackendUrl) {
        // If no backend is active after checking all potential URLs
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
    const backendResponse = await fetch(backendChatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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