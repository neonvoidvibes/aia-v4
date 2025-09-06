import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { getBackendUrl, formatErrorResponse } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export async function POST(req: NextRequest) {
  console.log("[API /api/agent/create] Received POST request with FormData");
  const supabase = await createServerActionClient();

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return formatErrorResponse("Unauthorized: Invalid session", 401);
    }
    const { data: { session } } = await supabase.auth.getSession();

    const activeBackendUrl = await getBackendUrl();
    if (!activeBackendUrl) {
      return formatErrorResponse("Could not connect to backend for agent creation.", 503);
    }
    
    const targetUrl = `${activeBackendUrl}/api/agent/create`;
    
    // Read the incoming request as FormData
    const formData = await req.formData();
    
    // Forward the FormData to the backend
    // Mild backoff to avoid transient failures during agent creation
    async function fetchWithBackoff(url: string, init: RequestInit, attempts = 3, baseDelayMs = 400): Promise<Response> {
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
      headers: {
        // 'Content-Type' is set automatically by fetch for FormData
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: formData,
    });
    
    const responseData = await backendResponse.json();

    if (!backendResponse.ok) {
      return formatErrorResponse(responseData.error || 'Backend agent creation failed', backendResponse.status);
    }

    return NextResponse.json(responseData, { status: backendResponse.status });

  } catch (error: any) {
    console.error("[API /api/agent/create] Error in POST handler:", error);
    return formatErrorResponse(error.message || 'An internal server error occurred', 500);
  }
}
