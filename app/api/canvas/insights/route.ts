import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server'; // For server-side auth
import { getBackendUrl, formatErrorResponse } from '@/app/api/proxyUtils'; // Shared utils

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export async function GET(req: NextRequest) {
  console.log("[Next.js API /api/canvas/insights] Received GET request");
  const supabase = await createServerActionClient();

  try {
    // 1. Authenticate User using Supabase server client
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.warn("[Next.js API /api/canvas/insights] Unauthorized request:", authError?.message);
      return formatErrorResponse("Unauthorized: Invalid session", 401);
    }
    console.log(`[Next.js API /api/canvas/insights] Authenticated user: ${user.id}`);

    // 2. Get query parameters from the incoming Next.js request
    const agentName = req.nextUrl.searchParams.get('agent');
    const eventId = req.nextUrl.searchParams.get('event_id'); // Ensure consistent naming with frontend
    const timeWindowLabel = req.nextUrl.searchParams.get('time_window_label');

    if (!agentName) {
      return formatErrorResponse("Missing 'agent' query parameter", 400);
    }
    // timeWindowLabel is optional and might have a default on the backend

    // 3. Find active Python backend
    const activeBackendUrl = await getBackendUrl();
    if (!activeBackendUrl) {
      return formatErrorResponse("Could not connect to backend for canvas insights.", 503);
    }

    // 4. Construct target URL for the Python backend (using a new internal path)
    // The Python backend will now expose this on, e.g., /internal_api/canvas_insights
    const backendInsightsPath = '/internal_api/canvas_insights'; 
    const targetUrl = new URL(backendInsightsPath, activeBackendUrl);
    targetUrl.searchParams.append('agent', agentName);
    if (eventId) {
      targetUrl.searchParams.append('event_id', eventId);
    }
    if (timeWindowLabel) {
      targetUrl.searchParams.append('time_window_label', timeWindowLabel);
    }
    
    console.log(`[Next.js API /api/canvas/insights] Forwarding GET to Python backend: ${targetUrl.toString()}`);

    // 5. Forward the request to the Python backend, including auth token
    const { data: { session } } = await supabase.auth.getSession();
    const backendHeaders: HeadersInit = {};
    if (session?.access_token) {
      backendHeaders['Authorization'] = `Bearer ${session.access_token}`;
    } else {
      console.error("[Next.js API /api/canvas/insights] Critical: Server-side session valid but access token missing for backend call.");
      return formatErrorResponse("Internal Server Error: Failed to retrieve auth token for backend", 500);
    }

    const backendResponse = await fetch(targetUrl.toString(), { 
      method: 'GET', 
      headers: backendHeaders 
    });

    // 6. Process and return the backend's response
    if (!backendResponse.ok) {
      const errorBody = await backendResponse.text().catch(() => `Status ${backendResponse.statusText}`);
      console.error(`[Next.js API /api/canvas/insights] Python backend error: ${backendResponse.status}`, errorBody);
      return formatErrorResponse(`Backend error for canvas insights (${backendResponse.status}): ${errorBody || backendResponse.statusText}`, backendResponse.status);
    }

    const data = await backendResponse.json();
    return NextResponse.json(data);

  } catch (error: any) {
    console.error("[Next.js API /api/canvas/insights] Error in GET handler:", error);
    return formatErrorResponse(error.message || 'An internal server error occurred', 500);
  }
}
