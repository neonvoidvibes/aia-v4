import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { getBackendUrl, formatErrorResponse } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export async function POST(req: NextRequest) {
  console.log("[S3 Proxy ManageFile] Received POST request");
  const supabase = await createServerActionClient();

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.warn("[S3 Proxy ManageFile] Unauthorized request:", authError?.message);
      return formatErrorResponse("Unauthorized: Invalid session", 401);
    }
    console.log(`[S3 Proxy ManageFile] Authenticated user: ${user.id}`);

    const body = await req.json();
    const { s3Key, action, agentName, eventId } = body;

    if (!s3Key || !action || !agentName || !eventId) {
      return formatErrorResponse("Missing required parameters in request body (s3Key, action, agentName, eventId)", 400);
    }
    if (action !== "archive") { // Removed "save" as it's handled by summarize-transcript now
        return formatErrorResponse("Invalid action parameter. Must be 'archive'.", 400);
    }

    // Log the S3 key being processed
    console.log(`[S3 Proxy ManageFile] Managing file with S3 Key: ${s3Key}`);

    const activeBackendUrl = await getBackendUrl();
    if (!activeBackendUrl) {
      return formatErrorResponse("Could not connect to backend for S3 file management.", 503);
    }

    // Target the new backend endpoint
    const targetUrl = `${activeBackendUrl}/api/s3/manage-file`;
    console.log(`[S3 Proxy ManageFile] Forwarding POST to ${targetUrl} for action: ${action}`);

    const { data: { session } } = await supabase.auth.getSession();
    const backendHeaders: HeadersInit = { 'Content-Type': 'application/json' };
    if (session?.access_token) {
      backendHeaders['Authorization'] = `Bearer ${session.access_token}`;
    } else {
        console.error("[S3 Proxy ManageFile] Critical: Server-side session valid but access token missing.");
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
        body: JSON.stringify({ s3Key, action, agentName, eventId }) // Pass the original body
    });

    const responseData = await backendResponse.json().catch(() => null);

    if (!backendResponse.ok) {
      // Try to get a more specific error message from the backend's JSON response
      const errorMsg = responseData?.error || responseData?.message || backendResponse.statusText || `Backend error (${backendResponse.status})`;
      console.error(`[S3 Proxy ManageFile] Backend error: ${backendResponse.status}`, errorMsg);
      return formatErrorResponse(errorMsg, backendResponse.status);
    }
    
    // If backendResponse.ok, use responseData or a default success message
    return NextResponse.json(responseData || { message: "Operation successful" }, { status: backendResponse.status });

  } catch (error: any) {
    console.error("[S3 Proxy ManageFile] Error in POST handler:", error);
    return formatErrorResponse(error.message || 'An internal server error occurred', 500);
  }
}
