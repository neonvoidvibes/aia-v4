// app/api/agent/name-exists/route.ts
import { type NextRequest } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { findActiveBackend, formatErrorResponse, proxyApiRouteRequest } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export async function GET(req: NextRequest) {
  console.log("[API /api/agent/name-exists] Received GET request");
  const supabase = await createServerActionClient();

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return formatErrorResponse("Unauthorized: Invalid session", 401);
    }

    const agentName = req.nextUrl.searchParams.get('name');
    if (!agentName) {
      return formatErrorResponse("Missing 'name' query parameter", 400);
    }

    const activeBackendUrl = await findActiveBackend(POTENTIAL_BACKEND_URLS);
    if (!activeBackendUrl) {
      return formatErrorResponse("Could not connect to backend to check agent name.", 503);
    }
    
    const targetUrl = `${activeBackendUrl}/api/agent/name-exists?name=${encodeURIComponent(agentName)}`;
    
    // The proxy will forward the GET request along with the auth header.
    const response = await fetch(targetUrl, {
        method: 'GET',
        headers: {
            'Authorization': req.headers.get('Authorization') || '',
        }
    });

    const data = await response.json();

    if (!response.ok) {
        return formatErrorResponse(data.error || 'Backend check failed', response.status);
    }
    
    return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });


  } catch (error: any) {
    console.error("[API /api/agent/name-exists] Error in GET handler:", error);
    return formatErrorResponse(error.message || 'An internal server error occurred', 500);
  }
}