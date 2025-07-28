import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { supabaseAdmin } from '@/utils/supabase/service';
import { findActiveBackend, formatErrorResponse } from '@/app/api/proxyUtils';

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("[API Admin] CRITICAL: SUPABASE_SERVICE_ROLE_KEY is not set. Admin functionality will be disabled.");
}

const BACKEND_API_URLS_STRING = process.env.BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export async function POST(req: NextRequest) {
  console.log("[API /api/admin/clear-cache-proxy] Received POST request");
  const supabase = await createServerActionClient();

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.warn("[API /api/admin/clear-cache-proxy] Unauthorized request:", authError?.message);
      return formatErrorResponse("Unauthorized: Invalid session", 401);
    }
    console.log(`[API /api/admin/clear-cache-proxy] Authenticated user: ${user.id}`);

    // Step 2: Authorization (NEW) - Use the admin client to bypass RLS
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return formatErrorResponse("Forbidden: Admin functionality is not configured.", 403);
    }
    const { data: roleData, error: roleError } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (roleError || !roleData || roleData.role !== 'admin') {
      console.warn(`[API Admin] Forbidden access attempt by user: ${user.id}`);
      return formatErrorResponse("Forbidden: Administrator access required.", 403);
    }
    console.log(`[API Admin] User ${user.id} authorized as admin.`);

    const body = await req.json();
    const { scope } = body;

    if (!scope) {
      return formatErrorResponse("Missing 'scope' in request body (e.g., agentName or 'all')", 400);
    }

    const activeBackendUrl = await findActiveBackend(POTENTIAL_BACKEND_URLS);
    if (!activeBackendUrl) {
      return formatErrorResponse("Could not connect to backend to clear cache.", 503);
    }

    const targetUrl = `${activeBackendUrl}/api/admin/clear-cache`;
    console.log(`[API /api/admin/clear-cache-proxy] Forwarding POST to ${targetUrl} for scope: ${scope}`);

    const { data: { session } } = await supabase.auth.getSession();
    const backendHeaders: HeadersInit = {
        'Content-Type': 'application/json'
    };
    if (session?.access_token) {
      backendHeaders['Authorization'] = `Bearer ${session.access_token}`;
    } else {
        console.error("[API /api/admin/clear-cache-proxy] Critical: Server-side session valid but access token missing.");
        return formatErrorResponse("Internal Server Error: Failed to retrieve auth token", 500);
    }
    
    const backendResponse = await fetch(targetUrl, {
        method: 'POST',
        headers: backendHeaders,
        body: JSON.stringify({ scope })
    });
    
    const responseData = await backendResponse.json().catch(() => ({}));

    if (!backendResponse.ok) {
        const errorMsg = responseData.error || responseData.message || `Backend error: ${backendResponse.statusText}`;
        console.error(`[API /api/admin/clear-cache-proxy] Backend error: ${backendResponse.status}`, errorMsg);
        return formatErrorResponse(errorMsg, backendResponse.status);
    }

    return NextResponse.json(responseData, { status: 200 });

  } catch (error: any) {
    console.error("[API /api/admin/clear-cache-proxy] Error in POST handler:", error);
    return formatErrorResponse(error.message || 'An internal server error occurred', 500);
  }
}
