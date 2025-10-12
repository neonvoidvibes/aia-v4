import { type NextRequest } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { getBackendUrl, formatErrorResponse } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export const maxDuration = 300; // Max duration 5 minutes for Vercel Hobby

export async function POST(req: NextRequest) {
  console.log("[API /api/canvas/analysis/refresh] Received POST request");
  const supabase = await createServerActionClient();

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.warn("[API /api/canvas/analysis/refresh] Unauthorized request:", authError?.message);
      return formatErrorResponse("Unauthorized: Invalid session", 401);
    }
    console.log(`[API /api/canvas/analysis/refresh] Authenticated user: ${user.id}`);

    const body = await req.json();
    const { agent, clearPrevious, individualRawTranscriptToggleStates, transcriptListenMode, groupsReadMode } = body;

    if (!agent) {
      return formatErrorResponse("Missing 'agent' in request body", 400);
    }

    console.log(`[API /api/canvas/analysis/refresh] Agent: ${agent}, Clear previous: ${clearPrevious || false}`);

    const activeBackendUrl = await getBackendUrl();
    if (!activeBackendUrl) {
      return formatErrorResponse("Could not connect to backend for canvas analysis refresh.", 503);
    }

    const targetUrl = `${activeBackendUrl}/api/canvas/analysis/refresh`;
    console.log(`[API /api/canvas/analysis/refresh] Forwarding POST to Python backend: ${targetUrl}`);

    const { data: { session } } = await supabase.auth.getSession();
    const backendHeaders: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (session?.access_token) {
      backendHeaders['Authorization'] = `Bearer ${session.access_token}`;
    } else {
      console.error("[API /api/canvas/analysis/refresh] Critical: Server-side session valid but access token missing.");
      return formatErrorResponse("Internal Server Error: Failed to retrieve auth token", 500);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minute timeout

    const backendResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: backendHeaders,
      body: JSON.stringify({
        agent,
        clearPrevious,
        individualRawTranscriptToggleStates,
        transcriptListenMode,  // FIXED: Forward mode to backend
        groupsReadMode         // FIXED: Forward mode to backend
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    console.log(`[API /api/canvas/analysis/refresh] Backend response status: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error(`[API /api/canvas/analysis/refresh] Python backend error: ${backendResponse.status}`, errorText);
      return formatErrorResponse(errorText || `Backend error (${backendResponse.status})`, backendResponse.status);
    }

    const data = await backendResponse.json();
    console.log("[API /api/canvas/analysis/refresh] Successfully refreshed canvas analysis");

    return Response.json(data, { status: 200 });

  } catch (error: any) {
    console.error("[API /api/canvas/analysis/refresh] Error in POST handler:", error);
    let message = error.message || 'An internal server error occurred during canvas analysis refresh.';
    let statusCode = 500;

    // Handle timeout errors
    if (error.name === 'AbortError') {
      message = "Canvas analysis refresh request timed out.";
      statusCode = 504;
    }
    // Handle network errors
    else if (error.name === 'TypeError' && error.message.includes('NetworkError')) {
      message = "Network error connecting to the canvas analysis service.";
      statusCode = 503;
    }
    // Handle connection errors
    else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      message = "Unable to connect to canvas analysis service. Please try again later.";
      statusCode = 503;
    }

    return formatErrorResponse(message, statusCode);
  }
}
