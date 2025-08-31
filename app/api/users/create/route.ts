import { type NextRequest } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { getBackendUrl, formatErrorResponse, proxyApiRouteRequest } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export async function POST(req: NextRequest) {
  console.log("[API /api/users/create] Received POST request");
  const supabase = await createServerActionClient();

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return formatErrorResponse("Unauthorized: Invalid session", 401);
    }

    const activeBackendUrl = await getBackendUrl();
    if (!activeBackendUrl) {
      return formatErrorResponse("Could not connect to backend to create user.", 503);
    }
    
    const targetUrl = `${activeBackendUrl}/api/users/create`;
    
    // The proxyApiRouteRequest utility handles auth, body forwarding, and response streaming
    return proxyApiRouteRequest({
      request: req,
      targetUrl: targetUrl,
      method: 'POST',
      // Body will be passed through by the proxy utility
    });

  } catch (error: any) {
    console.error("[API /api/users/create] Error in POST handler:", error);
    return formatErrorResponse(error.message || 'An internal server error occurred', 500);
  }
}
