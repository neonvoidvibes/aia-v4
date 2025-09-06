import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { getBackendUrl, formatErrorResponse } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export async function POST(req: NextRequest) {
  console.log("[Memory Save] Received POST request");
  const supabase = await createServerActionClient();

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return formatErrorResponse("Unauthorized: Invalid session", 401);
    }

    const body = await req.json();
    if (!body.agentName || !body.messages || !body.sessionId) {
      return formatErrorResponse("Missing required fields: agentName, messages, and sessionId", 400);
    }

    const activeBackendUrl = await getBackendUrl();
    if (!activeBackendUrl) {
      return formatErrorResponse("Could not connect to backend to save memory.", 503);
    }

    const targetUrl = `${activeBackendUrl}/api/memory/save-chat`;
    console.log(`[Memory Save] Forwarding POST to ${targetUrl}`);

    const { data: { session } } = await supabase.auth.getSession();
    const backendHeaders: HeadersInit = { 'Content-Type': 'application/json' };
    if (session?.access_token) {
      backendHeaders['Authorization'] = `Bearer ${session.access_token}`;
    } else {
        return formatErrorResponse("Internal Server Error: Failed to retrieve auth token", 500);
    }

    async function fetchWithBackoff(url: string, init: RequestInit, attempts = 3, baseDelayMs = 300): Promise<Response> {
      let lastErr: any = null;
      for (let i = 0; i < attempts; i++) {
        try {
          const res = await fetch(url, init);
          if (!res.ok && (res.status === 429 || res.status === 503 || (res.status >= 500 && res.status < 600))) {
            lastErr = new Error(`HTTP ${res.status}`);
          } else {
            return res;
          }
        } catch (e) { lastErr = e; }
        const delay = Math.round((baseDelayMs * Math.pow(2, i)) * (0.75 + Math.random() * 0.5));
        await new Promise(r => setTimeout(r, delay));
      }
      if (lastErr) throw lastErr;
      throw new Error('Unknown error contacting backend');
    }
    const backendResponse = await fetchWithBackoff(targetUrl, {
      method: 'POST',
      headers: backendHeaders,
      body: JSON.stringify(body)
    });

    const responseData = await backendResponse.json().catch(() => ({}));
    if (!backendResponse.ok) {
        const errorMsg = responseData.error || `Backend error: ${backendResponse.statusText}`;
        return formatErrorResponse(errorMsg, backendResponse.status);
    }
    
    return NextResponse.json(responseData, { status: 200 });

  } catch (error: any) {
    console.error("[Memory Save] Error in POST handler:", error);
    return formatErrorResponse(error.message || 'An internal server error occurred', 500);
  }
}
