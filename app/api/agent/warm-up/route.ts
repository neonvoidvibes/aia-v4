// FILE: app/api/agent/warm-up/route.ts
import { type NextRequest } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { findActiveBackend, formatErrorResponse, proxyApiRouteRequest } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export async function POST(req: NextRequest) {
  console.log("[API /api/agent/warm-up] Received POST request");
  const supabase = await createServerActionClient();

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return formatErrorResponse("Unauthorized: Invalid session", 401);
    }

    const activeBackendUrl = await findActiveBackend(POTENTIAL_BACKEND_URLS);
    if (!activeBackendUrl) {
      return formatErrorResponse("Could not connect to backend for warm-up.", 503);
    }
    
    // This is a fire-and-forget call, but we still proxy it correctly.
    // The backend will handle caching in the background.
    const targetUrl = `${activeBackendUrl}/api/agent/warm-up`;
    
    // The proxyApiRouteRequest utility handles auth, body forwarding, and response streaming
    return proxyApiRouteRequest({
      request: req,
      targetUrl: targetUrl,
      method: 'POST',
    });

  } catch (error: any) {
    console.error("[API /api/agent/warm-up] Error in POST handler:", error);
    return formatErrorResponse(error.message || 'An internal server error occurred', 500);
  }
}
