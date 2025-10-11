import { type NextRequest, NextResponse } from 'next/server';
import { getBackendUrl, formatErrorChunk } from '../proxyUtils'; // Use shared util
// Import our specific server client helper
import { createServerActionClient } from '@/utils/supabase/server'
import { createRequestLogger, sanitizeForLogging } from '@/lib/logger';
import { randomUUID } from 'crypto';
import { loadAgentEventsForUser } from '@/lib/agent-events';
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
  const requestId = randomUUID();
  const log = createRequestLogger(requestId);
  const requestStartTime = Date.now();

  log.info("Proxy-chat request received");
  // Instantiate client using our helper (handles cookies internally)
  const supabase = await createServerActionClient() // Use the correct helper, add await

  try {
    // --- Authenticate User ---
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        log.warn("Chat request auth error", { error: authError?.message });
        // Differentiate between a network error and a real auth error.
        if (authError?.message.includes("fetch failed")) {
            return NextResponse.json({ error: "Network error: Could not contact authentication server." }, { status: 503 });
        }
        // For other auth errors, treat as Unauthorized.
        return NextResponse.json({ error: "Unauthorized: Invalid session." }, { status: 401 });
    }
    log.info("User authenticated", { userId: user.id });
    // --- End Authentication ---

    // --- Find Active Backend URL ---
    const activeBackendUrl = await getBackendUrl();

    if (!activeBackendUrl) {
        const errorMsg = `Could not connect to any configured backend: ${POTENTIAL_BACKEND_URLS.join(', ')}. Please ensure the backend server is running and accessible.`;
        log.error("No active backend found", { 
          configuredBackends: POTENTIAL_BACKEND_URLS,
          error: errorMsg 
        });
        // Also return a standard JSON error response here.
        return NextResponse.json({ error: errorMsg }, { status: 503 });
    }
    // --- Use activeBackendUrl from now on ---

    const body = await req.json();
    log.debug("Request body parsed", sanitizeForLogging(body));
    // Filter out system messages added by the onError handler before proxying
    const userMessages = body.messages?.filter((msg: { role: string }) => msg.role === 'user' || msg.role === 'assistant') || [];
    // Prioritize settings from body.data if they exist, as simple-chat-interface places them there.
    const agent = body.agent || body.data?.agent;
    const inputEvent = body.event || body.data?.event;
    const model = body.model || body.data?.model;
    const temperature = body.temperature ?? body.data?.temperature ?? 0.5;
    
    const initialContext = body.data?.initialContext || body.initialContext; // For _aicreator agent
    const currentDraftContent = body.data?.currentDraftContent || body.currentDraftContent; // For _aicreator feedback loop
    const disableRetrieval = body.data?.disableRetrieval || body.disableRetrieval || false; // For wizard chat

    // WIZARD DETECTION: A wizard session is defined by disabling retrieval and providing initial context.
    const isWizard = disableRetrieval && !!initialContext;

    // Force transcripts off for wizard; prevents backend transcript branches.
    let transcriptListenModeSetting = isWizard ? "none" : (body.data?.transcriptListenMode || body.transcriptListenMode || "latest");
    if (!["none", "latest", "all", "some"].includes(transcriptListenModeSetting)) {
      transcriptListenModeSetting = "latest"; // Default to "latest" if invalid value
    }
    
    // Strip unused transcription language in wizard path. Use "any" as a safe default for backend.
    const transcriptionLanguageSetting = isWizard ? "any" : (body.data?.transcriptionLanguage || body.transcriptionLanguage || "any");

    let savedTranscriptMemoryModeSetting = body.data?.savedTranscriptMemoryMode || body.savedTranscriptMemoryMode || "none";
    if (!["none","some","all"].includes(savedTranscriptMemoryModeSetting)) {
      savedTranscriptMemoryModeSetting = "none";
    }
    const individualMemoryToggleStates = body.data?.individualMemoryToggleStates || body.individualMemoryToggleStates || {};
    const savedTranscriptSummaries = body.data?.savedTranscriptSummaries || body.savedTranscriptSummaries || [];
    const individualRawTranscriptToggleStates = body.data?.individualRawTranscriptToggleStates || body.individualRawTranscriptToggleStates || {};
    const rawTranscriptFiles = body.data?.rawTranscriptFiles || body.rawTranscriptFiles || [];
    
    // Remove the settings from data if they are now top-level to avoid confusion, keep other data props
    const { transcriptListenMode, savedTranscriptMemoryMode, individualMemoryToggleStates: _imts, savedTranscriptSummaries: _sts, individualRawTranscriptToggleStates: _irts, rawTranscriptFiles: _rtf, transcriptionLanguage, model: _model, temperature: _temp, initialContext: _ic, currentDraftContent: _cdc, disableRetrieval: _dr, ...dataWithoutSettings } = body.data || {};
    const { agent:_a, event:_e, model: _m_from_body, temperature: _t_from_body, transcriptListenMode:_tlm, savedTranscriptMemoryMode:_stmm, individualMemoryToggleStates:_imts2, savedTranscriptSummaries:_sts2, individualRawTranscriptToggleStates: _irts2, rawTranscriptFiles: _rtf2, transcriptionLanguage: _trl, currentDraftContent: _cdc_body, disableRetrieval: _dr_body, messages:_m, ...restOfBody } = body;


    // Basic validation for essential fields
    if (!userMessages || userMessages.length === 0) {
      log.warn("Missing user/assistant messages in request");
      return new Response(JSON.stringify({ error: 'Missing user/assistant messages' }), { status: 400 });
    }
    if (!agent) {
      log.warn("Missing agent in request");
      return new Response(JSON.stringify({ error: 'Missing agent' }), { status: 400 });
    }

    // Validate event against available events for this agent; default to main event "0000" if missing/invalid
    let safeEvent: string = inputEvent || '0000';
    if (agent) {
      let verifiedViaSupabase = false;
      try {
        const agentEvents = await loadAgentEventsForUser(supabase, agent, user.id);
        const allowedSet = new Set<string>([...(agentEvents.allowedEvents || agentEvents.events || []), '0000']);
        if (!allowedSet.has(safeEvent)) {
          safeEvent = '0000';
        }
        verifiedViaSupabase = true;
      } catch (err) {
        log.warn('Event allow-list lookup via Supabase failed, falling back to backend', { error: err });
      }

      if (!verifiedViaSupabase) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (token) {
            const eventsUrl = `${activeBackendUrl}/api/s3/list-events?agentName=${encodeURIComponent(agent)}`;
            const res = await fetch(eventsUrl, { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) {
              const json = await res.json().catch(() => ({}));
              const events: string[] = Array.isArray(json?.events) ? json.events : [];
              if (!events.includes(safeEvent)) {
                safeEvent = '0000';
              }
            } else {
              safeEvent = '0000';
            }
          } else {
            safeEvent = '0000';
          }
        } catch {
          safeEvent = '0000';
        }
      }
    } else {
      safeEvent = '0000';
    }

    log.info("Chat request validated", {
      agent,
      event: safeEvent,
      messageCount: userMessages.length,
      transcriptListenMode: transcriptListenModeSetting,
      savedTranscriptMemoryMode: savedTranscriptMemoryModeSetting,
      individualMemoryToggleStates: individualMemoryToggleStates,
      savedTranscriptSummariesCount: savedTranscriptSummaries.length,
      transcriptionLanguage: transcriptionLanguageSetting
    });

    // Construct the specific API endpoint using the active base URL
    const backendChatUrl = `${activeBackendUrl}/api/chat`;
    const requestBodyPayload = {
      messages: userMessages,
      agent: agent,
      event: safeEvent,
      model: model,
      temperature: temperature,
      transcriptListenMode: transcriptListenModeSetting,
      savedTranscriptMemoryMode: savedTranscriptMemoryModeSetting,
      individualMemoryToggleStates: individualMemoryToggleStates,
      savedTranscriptSummaries: savedTranscriptSummaries,
      individualRawTranscriptToggleStates: individualRawTranscriptToggleStates,
      rawTranscriptFiles: rawTranscriptFiles,
      transcriptionLanguage: transcriptionLanguageSetting, // Added
      initialContext: initialContext, // For _aicreator agent
      currentDraftContent: currentDraftContent, // For _aicreator feedback loop
      disableRetrieval: disableRetrieval, // To bypass RAG in wizard
      data: dataWithoutSettings, // Pass through other data fields if they exist
      ...restOfBody // Include any other top-level properties from original body (excluding those already handled)
    };
    const requestBody = JSON.stringify(requestBodyPayload);
    // Log the final payload being sent to Python backend
    log.info("Proxying to backend", { 
      backendUrl: backendChatUrl,
      payload: sanitizeForLogging(requestBodyPayload)
    });

    // --- Main fetch call to the selected backend ---
    // Get the access token from the server-side session we just validated
    const { data: { session } } = await supabase.auth.getSession(); // We need the session object too
    const backendHeaders: HeadersInit = { 'Content-Type': 'application/json' };

    if (session?.access_token) {
      backendHeaders['Authorization'] = `Bearer ${session.access_token}`;
      backendHeaders['X-Request-ID'] = requestId;
      log.debug("Added auth token and request ID to backend headers");
    } else {
        // This indicates an issue with the session validation or token availability server-side
        log.error("Server-side session valid but access token missing");
        const errorStreamChunk = formatErrorChunk("Internal Server Error: Failed to retrieve auth token");
        const errorStream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(errorStreamChunk)); controller.close(); }});
        return new Response(errorStream, { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    // Retry the initial backend request with exponential backoff to avoid hammering the server
    async function fetchWithBackoff(url: string, init: RequestInit, attempts = 3, baseDelayMs = 400): Promise<Response> {
      let lastErr: any = null;
      for (let i = 0; i < attempts; i++) {
        try {
          const res = await fetch(url, init);
          // If we get a 429/503 or 500-range, optionally retry
          if (!res.ok && (res.status === 429 || res.status === 503 || (res.status >= 500 && res.status < 600))) {
            lastErr = new Error(`HTTP ${res.status}`);
          } else {
            return res;
          }
        } catch (e) {
          lastErr = e;
        }
        // Exponential backoff with jitter
        const delay = Math.round((baseDelayMs * Math.pow(2, i)) * (0.75 + Math.random() * 0.5));
        await new Promise(r => setTimeout(r, delay));
      }
      if (lastErr) throw lastErr;
      throw new Error('Unknown error contacting backend');
    }

    const backendFetchStart = Date.now();
    log.info(`[PERF] Sending to backend, delta from request: ${backendFetchStart - requestStartTime}ms`);

    const backendResponse = await fetchWithBackoff(backendChatUrl, {
      method: 'POST',
      headers: backendHeaders, // Use headers potentially including Authorization
      body: requestBody,
    });

    const backendResponseTime = Date.now() - backendFetchStart;
    // Log raw status immediately
    log.info(`[PERF] Backend response received: ${backendResponseTime}ms`, {
      status: backendResponse.status,
      statusText: backendResponse.statusText
    });

    // Check if the backend responded successfully
    if (!backendResponse.ok) {
       let errorBody = { error: `Backend fetch failed with status ${backendResponse.status}` };
       try {
           errorBody = await backendResponse.json();
       } catch (readError) {
           log.error("Failed to parse backend error response", { error: readError });
       }
       log.error("Backend request failed", { 
         status: backendResponse.status, 
         statusText: backendResponse.statusText,
         errorBody 
       });
       // Return a standard JSON error response. The UI will handle this.
       return NextResponse.json(errorBody, { status: backendResponse.status });
    }

    // Check if the backend response body exists
    if (!backendResponse.body) {
        log.error("Backend response missing body", { status: backendResponse.status });
        // Return a standard JSON error response
        return NextResponse.json({ error: "Backend returned an empty response." }, { status: 500 });
    }
    // --- End Main Fetch Handling ---

    log.info("Backend response OK, starting stream processing");

    // --- Stream Translation Layer ---
    // The Python backend sends SSE. The Vercel AI SDK frontend expects its own format.
    // This new ReadableStream will read the backend's SSE and translate it on the fly.
    const transformStream = new ReadableStream({
      async start(controller) {
        const reader = backendResponse.body!.getReader();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        let buffer = "";
        let firstChunkTime: number | null = null;
        let lastChunkTime: number = Date.now();

        function pushToClient(chunk: string) {
          controller.enqueue(encoder.encode(chunk));
        }

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              break;
            }
            buffer += decoder.decode(value, { stream: true });

            // Process buffer line by line for SSE messages
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep the last (potentially incomplete) line

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const jsonStr = line.substring(6);
                if (jsonStr.trim()) {
                  try {
                    const data = JSON.parse(jsonStr);

                    if (data.delta) {
                      if (!firstChunkTime) {
                        firstChunkTime = Date.now();
                        log.info(`[PERF] First chunk received from backend: ${firstChunkTime - backendFetchStart}ms from fetch start, ${firstChunkTime - requestStartTime}ms from request start`);
                      }
                      lastChunkTime = Date.now();
                      // This is a text chunk. Translate to AI SDK format.
                      // The format is `0:"<text_chunk>"\n`
                      pushToClient(`0:${JSON.stringify(data.delta)}\n`);
                    } else if (data.done) {
                      // This is the final message from the backend.
                      // Handle reinforcement and then we're done.
                      const docIds = data.retrieved_doc_ids || [];
                      if (docIds.length > 0 && agent) {
                        log.info("Triggering memory reinforcement", { docCount: docIds.length, agent });
                        // Fire-and-forget reinforcement call
                        fetch(`${activeBackendUrl}/api/memory/reinforce`, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': backendHeaders['Authorization'] || '',
                            'X-Request-ID': requestId
                          },
                          body: JSON.stringify({
                            agent: agent,
                            doc_ids: docIds
                          })
                        }).catch(err => log.error("Memory reinforcement failed", { error: err }));
                      }
                      // We don't forward the 'done' message. The stream closing is the signal.
                    } else if (data.error) {
                        // Forward error from backend stream
                        log.error("Error in backend stream", { error: data.error });
                        pushToClient(formatErrorChunk(data.error));
                    }
                  } catch (e) {
                    log.error("Failed to parse backend stream JSON", { jsonStr, error: e });
                  }
                }
              }
            }
          }
        } catch (error) {
          log.error("Error reading from backend stream", { error });
          pushToClient(formatErrorChunk("Error reading from backend service."));
        } finally {
          const totalStreamTime = Date.now() - requestStartTime;
          const streamProcessingTime = firstChunkTime ? Date.now() - firstChunkTime : 0;
          log.info(`[PERF] Stream complete: total=${totalStreamTime}ms, processing=${streamProcessingTime}ms`);
          log.debug("Closing client stream controller");
          controller.close();
        }
      }
    });

    return new Response(transformStream, {
      status: backendResponse.status,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8', // The AI SDK expects text/plain
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      }
    });

  } catch (error: any) {
    // Catch top-level errors (e.g., JSON parsing error in request, initial backend find failure)
    log.error("Top-level error in proxy handler", { 
      error: error.message,
      cause: error.cause,
      stack: error.stack 
    });
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

    // Return a standard JSON error response, which `useChat`'s onError can handle
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
