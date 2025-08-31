import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { getBackendUrl, formatErrorResponse } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export async function GET(req: NextRequest) {
  console.log("[S3 Proxy Download] Received GET request");
  const supabase = await createServerActionClient();

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.warn("[S3 Proxy Download] Unauthorized request:", authError?.message);
      // Note: Can't use formatErrorResponse directly for a streaming download failure easily
      return new Response("Unauthorized: Invalid session", { status: 401 });
    }
    console.log(`[S3 Proxy Download] Authenticated user: ${user.id}`);

    const s3Key = req.nextUrl.searchParams.get('s3Key');
    const filename = req.nextUrl.searchParams.get('filename');

    if (!s3Key) {
      return new Response("Missing 's3Key' query parameter", { status: 400 });
    }
    if (!filename) {
      return new Response("Missing 'filename' query parameter", { status: 400 });
    }

    const activeBackendUrl = await getBackendUrl();
    if (!activeBackendUrl) {
      return new Response("Could not connect to backend for S3 download.", { status: 503 });
    }

    const targetUrl = `${activeBackendUrl}/api/s3/download?s3Key=${encodeURIComponent(s3Key)}&filename=${encodeURIComponent(filename)}`;
    console.log(`[S3 Proxy Download] Forwarding GET to ${targetUrl}`);

    const { data: { session } } = await supabase.auth.getSession();
    const backendHeaders: HeadersInit = {};
    if (session?.access_token) {
      backendHeaders['Authorization'] = `Bearer ${session.access_token}`;
    } else {
        console.error("[S3 Proxy Download] Critical: Server-side session valid but access token missing.");
        return new Response("Internal Server Error: Failed to retrieve auth token", { status: 500 });
    }
    
    const backendResponse = await fetch(targetUrl, { method: 'GET', headers: backendHeaders });

    if (!backendResponse.ok) {
      const errorBody = await backendResponse.text().catch(() => `Status ${backendResponse.statusText}`);
      console.error(`[S3 Proxy Download] Backend error: ${backendResponse.status}`, errorBody);
      return new Response(`Backend error for S3 download (${backendResponse.status}): ${errorBody || backendResponse.statusText}`, { status: backendResponse.status });
    }

    // Stream the response back
    const { body, headers } = backendResponse;
    return new Response(body, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: { // Forward necessary headers
        'Content-Disposition': headers.get('Content-Disposition') || `attachment; filename="${filename}"`,
        'Content-Type': headers.get('Content-Type') || 'application/octet-stream',
      }
    });

  } catch (error: any) {
    console.error("[S3 Proxy Download] Error in GET handler:", error);
    return new Response(error.message || 'An internal server error occurred', { status: 500 });
  }
}
