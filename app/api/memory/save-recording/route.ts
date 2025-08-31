import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { getBackendUrl, formatErrorResponse } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export async function POST(req: NextRequest) {
  console.log("[Memory Save Recording] Received POST request");
  const supabase = await createServerActionClient();

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return formatErrorResponse("Unauthorized: Invalid session", 401);
    }

    const body = await req.json();
    if (!body.s3Key || !body.agentName) {
      return formatErrorResponse("Missing required fields: s3Key and agentName", 400);
    }

    const activeBackendUrl = await getBackendUrl();
    if (!activeBackendUrl) {
      return formatErrorResponse("Could not connect to backend to save recording memory.", 503);
    }

    // Use the existing recordings embed endpoint since it already saves to memory
    const targetUrl = `${activeBackendUrl}/api/recordings/embed`;
    console.log(`[Memory Save Recording] Forwarding POST to ${targetUrl}`);

    const { data: { session } } = await supabase.auth.getSession();
    const backendHeaders: HeadersInit = { 'Content-Type': 'application/json' };
    if (session?.access_token) {
      backendHeaders['Authorization'] = `Bearer ${session.access_token}`;
    } else {
        return formatErrorResponse("Internal Server Error: Failed to retrieve auth token", 500);
    }

    const backendResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: backendHeaders,
      body: JSON.stringify(body)
    });

    const responseData = await backendResponse.json().catch(() => ({}));
    if (!backendResponse.ok) {
        const errorMsg = responseData.error || `Backend error: ${backendResponse.statusText}`;
        return formatErrorResponse(errorMsg, backendResponse.status);
    }
    
    // Return the response with a log_id (memory_id) for consistency with chat pattern
    return NextResponse.json({
      ...responseData,
      log_id: responseData.memory_id || responseData.log_id || `recording_${Date.now()}`
    }, { status: 200 });

  } catch (error: any) {
    console.error("[Memory Save Recording] Error in POST handler:", error);
    return formatErrorResponse(error.message || 'An internal server error occurred', 500);
  }
}
