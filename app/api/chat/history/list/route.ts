import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { getBackendUrl, formatErrorResponse } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export async function GET(req: NextRequest) {
  console.log("[Chat History List] Received GET request");
  const supabase = await createServerActionClient();

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.warn("[Chat History List] Unauthorized request:", authError?.message);
      return formatErrorResponse("Unauthorized: Invalid session", 401);
    }
    console.log(`[Chat History List] Authenticated user: ${user.id}`);

    const agentName = req.nextUrl.searchParams.get('agentName');
    if (!agentName) {
      return formatErrorResponse("Missing 'agentName' query parameter", 400);
    }

    const activeBackendUrl = await getBackendUrl();
    if (!activeBackendUrl) {
      return formatErrorResponse("Could not connect to backend for chat history.", 503);
    }

    const targetUrl = `${activeBackendUrl}/api/chat/history/list?agentName=${encodeURIComponent(agentName)}`;
    console.log(`[Chat History List] Forwarding GET to ${targetUrl}`);

    const { data: { session } } = await supabase.auth.getSession();
    const backendHeaders: HeadersInit = {};
    if (session?.access_token) {
      backendHeaders['Authorization'] = `Bearer ${session.access_token}`;
    } else {
        console.error("[Chat History List] Critical: Server-side session valid but access token missing.");
        return formatErrorResponse("Internal Server Error: Failed to retrieve auth token", 500);
    }

    const backendResponse = await fetch(targetUrl, { method: 'GET', headers: backendHeaders });

    if (!backendResponse.ok) {
      const errorBody = await backendResponse.text().catch(() => `Status ${backendResponse.statusText}`);
      console.error(`[Chat History List] Backend error: ${backendResponse.status}`, errorBody);
      return formatErrorResponse(`Backend error for chat history (${backendResponse.status}): ${errorBody || backendResponse.statusText}`, backendResponse.status);
    }

    const data = await backendResponse.json();
    return NextResponse.json(data);

  } catch (error: any) {
    console.error("[Chat History List] Error in GET handler:", error);
    return formatErrorResponse(error.message || 'An internal server error occurred', 500);
  }
}
