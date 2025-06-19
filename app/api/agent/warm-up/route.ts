import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { findActiveBackend, formatErrorResponse } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export async function POST(req: NextRequest) {
  console.log("[API /api/agent/warm-up] Received POST request");
  const supabase = await createServerActionClient();

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.warn("[API /api/agent/warm-up] Unauthorized request:", authError?.message);
      return formatErrorResponse("Unauthorized: Invalid session", 401);
    }
    console.log(`[API /api/agent/warm-up] Authenticated user: ${user.id}`);

    const body = await req.json();
    const { agent, event } = body;

    if (!agent) {
      return formatErrorResponse("Missing 'agent' in request body", 400);
    }

    const activeBackendUrl = await findActiveBackend(POTENTIAL_BACKEND_URLS);
    if (!activeBackendUrl) {
      // It's a non-critical optimization, so we can just return success without erroring out the UI
      console.warn("[API /api/agent/warm-up] No active backend found. Skipping pre-caching.");
      return NextResponse.json({ status: "skipped", message: "No active backend to warm up." }, { status: 200 });
    }

    const targetUrl = `${activeBackendUrl}/api/agent/warm-up`;
    console.log(`[API /api/agent/warm-up] Forwarding POST to ${targetUrl}`);

    const { data: { session } } = await supabase.auth.getSession();
    const backendHeaders: HeadersInit = {
        'Content-Type': 'application/json'
    };
    if (session?.access_token) {
      backendHeaders['Authorization'] = `Bearer ${session.access_token}`;
    } else {
        console.error("[API /api/agent/warm-up] Critical: Server-side session valid but access token missing.");
        return formatErrorResponse("Internal Server Error: Failed to retrieve auth token", 500);
    }
    
    // Fire-and-forget fetch to the backend. We don't wait for the full response.
    fetch(targetUrl, {
        method: 'POST',
        headers: backendHeaders,
        body: JSON.stringify({ agent, event: event || '0000' })
    }).catch(error => {
        // Log errors but don't fail the main request, as this is an optimization
        console.error(`[API /api/agent/warm-up] Error in fire-and-forget fetch to backend: ${error.message}`);
    });

    // Immediately return a success response to the frontend client
    return NextResponse.json({ status: "success", message: "Pre-caching triggered." }, { status: 202 });

  } catch (error: any) {
    console.error("[API /api/agent/warm-up] Error in POST handler:", error);
    // Don't throw a fatal error to the client for this optimization
    return formatErrorResponse(error.message || 'An error occurred while triggering cache warm-up', 500);
  }
}