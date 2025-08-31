// app/api/agent/name-exists/route.ts
import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { getBackendUrl, formatErrorResponse } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export async function GET(req: NextRequest) {
  console.log("[API /api/agent/name-exists] Received GET request");
  const supabase = await createServerActionClient();

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return formatErrorResponse("Unauthorized: Invalid session", 401);
    }

    const agentName = req.nextUrl.searchParams.get('name');
    if (!agentName) {
      return formatErrorResponse("Missing 'name' query parameter", 400);
    }

    const activeBackendUrl = await getBackendUrl();
    if (!activeBackendUrl) {
      return formatErrorResponse("Could not connect to backend to check agent name.", 503);
    }
    
    const targetUrl = `${activeBackendUrl}/api/agent/name-exists?name=${encodeURIComponent(agentName)}`;
    
    // Correctly forward the request with the user's access token
    const backendResponse = await fetch(targetUrl, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
        }
    });

    const data = await backendResponse.json();

    if (!backendResponse.ok) {
        return formatErrorResponse(data.error || 'Backend check failed', backendResponse.status);
    }
    
    return NextResponse.json(data, { status: 200 });

  } catch (error: any) {
    console.error("[API /api/agent/name-exists] Error in GET handler:", error);
    return formatErrorResponse(error.message || 'An internal server error occurred', 500);
  }
}
