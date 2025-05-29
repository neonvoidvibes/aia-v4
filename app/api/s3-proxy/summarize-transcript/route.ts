import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { findActiveBackend, formatErrorResponse } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export async function POST(req: NextRequest) {
  console.log("[S3 Proxy SummarizeTranscript] Received POST request");
  const supabase = await createServerActionClient();

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.warn("[S3 Proxy SummarizeTranscript] Unauthorized request:", authError?.message);
      return formatErrorResponse("Unauthorized: Invalid session", 401);
    }
    console.log(`[S3 Proxy SummarizeTranscript] Authenticated user: ${user.id}`);

    const body = await req.json();
    // Ensure all necessary parameters are present, matching what the Python backend expects
    const { s3Key, agentName, eventId, originalFilename } = body;

    if (!s3Key || !agentName || !eventId || !originalFilename) {
      return formatErrorResponse("Missing required parameters in request body (s3Key, agentName, eventId, originalFilename)", 400);
    }
    
    console.log(`[S3 Proxy SummarizeTranscript] Request details - s3Key: ${s3Key}, agentName: ${agentName}, eventId: ${eventId}, originalFilename: ${originalFilename}`);

    const activeBackendUrl = await findActiveBackend(POTENTIAL_BACKEND_URLS);
    if (!activeBackendUrl) {
      return formatErrorResponse("Could not connect to backend for transcript summarization.", 503);
    }

    // Target the Python backend's /api/s3/summarize-transcript endpoint
    const targetUrl = `${activeBackendUrl}/api/s3/summarize-transcript`;
    console.log(`[S3 Proxy SummarizeTranscript] Forwarding POST to Python backend: ${targetUrl}`);

    const { data: { session } } = await supabase.auth.getSession();
    const backendHeaders: HeadersInit = { 'Content-Type': 'application/json' };
    if (session?.access_token) {
      backendHeaders['Authorization'] = `Bearer ${session.access_token}`;
    } else {
        console.error("[S3 Proxy SummarizeTranscript] Critical: Server-side session valid but access token missing for backend call.");
        return formatErrorResponse("Internal Server Error: Failed to retrieve auth token for backend", 500);
    }
    
    const backendResponse = await fetch(targetUrl, {
        method: 'POST',
        headers: backendHeaders,
        body: JSON.stringify(body) // Forward the original request body
    });

    const responseData = await backendResponse.json().catch(() => null); // Try to parse JSON, null if fails

    if (!backendResponse.ok) {
      const errorMsg = responseData?.error || responseData?.message || backendResponse.statusText || `Backend error (${backendResponse.status})`;
      console.error(`[S3 Proxy SummarizeTranscript] Python backend error: ${backendResponse.status}`, errorMsg);
      return formatErrorResponse(errorMsg, backendResponse.status);
    }
    
    // If backendResponse.ok, use responseData or a default success message
    return NextResponse.json(responseData || { message: "Summarization request processed by backend." }, { status: backendResponse.status });

  } catch (error: any) {
    console.error("[S3 Proxy SummarizeTranscript] Error in POST handler:", error);
    return formatErrorResponse(error.message || 'An internal server error occurred', 500);
  }
}