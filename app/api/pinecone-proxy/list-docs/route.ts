import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { findActiveBackend, formatErrorResponse } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export async function GET(req: NextRequest) {
  console.log("[Pinecone Proxy ListDocs] Received GET request");
  const supabase = await createServerActionClient();

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.warn("[Pinecone Proxy ListDocs] Unauthorized request:", authError?.message);
      return formatErrorResponse("Unauthorized: Invalid session", 401);
    }
    console.log(`[Pinecone Proxy ListDocs] Authenticated user: ${user.id}`);

    const agentName = req.nextUrl.searchParams.get('agentName');
    const namespace = req.nextUrl.searchParams.get('namespace'); // Usually same as agentName

    if (!agentName) {
      return formatErrorResponse("Missing 'agentName' query parameter", 400);
    }
    if (!namespace) {
      return formatErrorResponse("Missing 'namespace' query parameter", 400);
    }


    const activeBackendUrl = await findActiveBackend(POTENTIAL_BACKEND_URLS);
    if (!activeBackendUrl) {
      return formatErrorResponse("Could not connect to backend for Pinecone listing.", 503);
    }

    // Backend route is /api/index/<string:index_name>/namespace/<string:namespace_name>/list_docs
    const targetUrl = `${activeBackendUrl}/api/index/river/namespace/${namespace}/list_docs`;
    console.log(`[Pinecone Proxy ListDocs] Forwarding GET to ${targetUrl}`);

    const { data: { session } } = await supabase.auth.getSession();
    const backendHeaders: HeadersInit = {};
    if (session?.access_token) {
      backendHeaders['Authorization'] = `Bearer ${session.access_token}`;
    } else {
        console.error("[Pinecone Proxy ListDocs] Critical: Server-side session valid but access token missing.");
        return formatErrorResponse("Internal Server Error: Failed to retrieve auth token", 500);
    }

    const backendResponse = await fetch(targetUrl, { method: 'GET', headers: backendHeaders });

    if (!backendResponse.ok) {
      const errorBody = await backendResponse.text().catch(() => `Status ${backendResponse.statusText}`);
      console.error(`[Pinecone Proxy ListDocs] Backend error: ${backendResponse.status}`, errorBody);
      return formatErrorResponse(`Backend error for Pinecone listing (${backendResponse.status}): ${errorBody || backendResponse.statusText}`, backendResponse.status);
    }

    const data = await backendResponse.json();
    return NextResponse.json(data);

  } catch (error: any) {
    console.error("[Pinecone Proxy ListDocs] Error in GET handler:", error);
    return formatErrorResponse(error.message || 'An internal server error occurred', 500);
  }
}
