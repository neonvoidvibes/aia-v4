import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { findActiveBackend, formatErrorResponse } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export async function GET(req: NextRequest) {
  const supabase = await createServerActionClient();
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return formatErrorResponse('Unauthorized', 401);

    const agentName = req.nextUrl.searchParams.get('agentName');
    if (!agentName) return formatErrorResponse("Missing 'agentName' query parameter", 400);

    const activeBackendUrl = await findActiveBackend(POTENTIAL_BACKEND_URLS);
    if (!activeBackendUrl) return formatErrorResponse('Backend unavailable', 503);

    const targetUrl = `${activeBackendUrl}/api/s3/list-events?agentName=${encodeURIComponent(agentName)}`;
    const { data: { session } } = await supabase.auth.getSession();
    const headers: HeadersInit = {};
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
    else return formatErrorResponse('Failed to retrieve auth token', 500);

    const res = await fetch(targetUrl, { method: 'GET', headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return formatErrorResponse(`Backend error (${res.status}): ${body || res.statusText}`, res.status);
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: any) {
    return formatErrorResponse(e.message || 'Internal error', 500);
  }
}

