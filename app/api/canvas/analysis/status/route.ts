import { type NextRequest } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { getBackendUrl, formatErrorResponse } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export const maxDuration = 60; // Max duration 1 minute

export async function GET(req: NextRequest) {
  console.log("[API /api/canvas/analysis/status] Received GET request");
  const supabase = await createServerActionClient();

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.warn("[API /api/canvas/analysis/status] Unauthorized request:", authError?.message);
      return formatErrorResponse("Unauthorized: Invalid session", 401);
    }
    console.log(`[API /api/canvas/analysis/status] Authenticated user: ${user.id}`);

    // Parse query parameters
    const searchParams = req.nextUrl.searchParams;
    const agent = searchParams.get('agent');
    const depth = searchParams.get('depth') || 'mirror';

    if (!agent) {
      return formatErrorResponse("Missing 'agent' query parameter", 400);
    }

    console.log(`[API /api/canvas/analysis/status] Agent: ${agent}, Depth: ${depth}`);

    const activeBackendUrl = await getBackendUrl();
    if (!activeBackendUrl) {
      return formatErrorResponse("Could not connect to backend for canvas analysis status.", 503);
    }

    const targetUrl = `${activeBackendUrl}/api/canvas/analysis/status?agent=${encodeURIComponent(agent)}&depth=${encodeURIComponent(depth)}`;
    console.log(`[API /api/canvas/analysis/status] Forwarding GET to Python backend: ${targetUrl}`);

    const { data: { session } } = await supabase.auth.getSession();
    const backendHeaders: HeadersInit = {};

    if (session?.access_token) {
      backendHeaders['Authorization'] = `Bearer ${session.access_token}`;
    } else {
      console.error("[API /api/canvas/analysis/status] Critical: Server-side session valid but access token missing.");
      return formatErrorResponse("Internal Server Error: Failed to retrieve auth token", 500);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 1 minute timeout

    const backendResponse = await fetch(targetUrl, {
      method: 'GET',
      headers: backendHeaders,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    console.log(`[API /api/canvas/analysis/status] Backend response status: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error(`[API /api/canvas/analysis/status] Python backend error: ${backendResponse.status}`, errorText);
      return formatErrorResponse(errorText || `Backend error (${backendResponse.status})`, backendResponse.status);
    }

    const data = await backendResponse.json();
    console.log("[API /api/canvas/analysis/status] Successfully retrieved canvas analysis status");

    return Response.json(data, { status: 200 });

  } catch (error: any) {
    console.error("[API /api/canvas/analysis/status] Error in GET handler:", error);
    let message = error.message || 'An internal server error occurred during canvas analysis status check.';
    let statusCode = 500;

    // Handle timeout errors
    if (error.name === 'AbortError') {
      message = "Canvas analysis status request timed out.";
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
