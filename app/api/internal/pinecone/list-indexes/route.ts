import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { getBackendUrl, formatErrorResponse } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export async function GET(req: NextRequest) {
  console.log("[Internal API /pinecone/list-indexes] Received GET request");
  const supabase = await createServerActionClient();

  try {
    // This is an internal API route, but we still need a valid session to forward the token.
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return formatErrorResponse("Unauthorized: Invalid session", 401);
    }

    const activeBackendUrl = await getBackendUrl();
    if (!activeBackendUrl) {
      return formatErrorResponse("Could not connect to backend.", 503);
    }

    const targetUrl = `${activeBackendUrl}/internal_api/pinecone/list-indexes`;
    console.log(`[Internal API] Forwarding GET to ${targetUrl}`);

    const { data: { session } } = await supabase.auth.getSession();
    const backendHeaders: HeadersInit = {};
    if (session?.access_token) {
      backendHeaders['Authorization'] = `Bearer ${session.access_token}`;
    } else {
        return formatErrorResponse("Internal Server Error: Failed to retrieve auth token", 500);
    }

    const backendResponse = await fetch(targetUrl, { method: 'GET', headers: backendHeaders });

    const responseData = await backendResponse.json().catch(() => ({}));
    if (!backendResponse.ok) {
        const errorMsg = responseData.error || `Backend error: ${backendResponse.statusText}`;
        return formatErrorResponse(errorMsg, backendResponse.status);
    }
    
    return NextResponse.json(responseData, { status: 200 });

  } catch (error: any) {
    console.error("[Internal API] Error in GET handler:", error);
    return formatErrorResponse(error.message || 'An internal server error occurred', 500);
  }
}
