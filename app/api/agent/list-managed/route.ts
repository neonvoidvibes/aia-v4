import { type NextRequest } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { getBackendUrl, formatErrorResponse, proxyApiRouteRequest } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export async function GET(req: NextRequest) {
  console.log("[API /api/agent/list-managed] Received GET request");
  const supabase = await createServerActionClient();

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return formatErrorResponse("Unauthorized: Invalid session", 401);
    }

    const activeBackendUrl = await getBackendUrl();
    if (!activeBackendUrl) {
      return formatErrorResponse("Could not connect to backend to list agents.", 503);
    }
    
    const targetUrl = `${activeBackendUrl}/api/agent/list-managed`;
    
    return proxyApiRouteRequest({
      request: req,
      targetUrl: targetUrl,
      method: 'GET',
    });

  } catch (error: any) {
    console.error("[API /api/agent/list-managed] Error in GET handler:", error);
    return formatErrorResponse(error.message || 'An internal server error occurred', 500);
  }
}
