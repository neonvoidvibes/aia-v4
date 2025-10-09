import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { getBackendUrl, formatErrorResponse } from '@/app/api/proxyUtils';
import { loadAgentEventsForUser } from '@/lib/agent-events';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export async function GET(req: NextRequest) {
  const supabase = await createServerActionClient();
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return formatErrorResponse('Unauthorized', 401);

    const agentName = req.nextUrl.searchParams.get('agentName');
    if (!agentName) return formatErrorResponse("Missing 'agentName' query parameter", 400);

    try {
      const payload = await loadAgentEventsForUser(supabase, agentName, user.id);
      if ((payload.events || []).length > 0) {
        // Pass breakout map through to the client (used by the picker)
        return NextResponse.json({
          events: payload.events,
          eventTypes: payload.eventTypes,
          allowedEvents: payload.allowedEvents,
          personalEventId: payload.personalEventId,
          eventBreakout: payload.eventBreakout ?? {},
        }, { status: 200 });
      }
    } catch (err) {
      console.warn('[s3-proxy] Failed to load events via Supabase, falling back to backend', err);
    }

    const activeBackendUrl = await getBackendUrl();
    if (!activeBackendUrl) return formatErrorResponse('Backend unavailable', 503);

    const targetUrl = `${activeBackendUrl}/api/s3/list-events?agentName=${encodeURIComponent(agentName)}`;
    const { data: { session } } = await supabase.auth.getSession();
    const headers: HeadersInit = {};
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
    else return formatErrorResponse('Failed to retrieve auth token', 500);

    async function fetchWithBackoff(url: string, init: RequestInit, attempts = 3, baseDelayMs = 300): Promise<Response> {
      let lastErr: any = null;
      for (let i = 0; i < attempts; i++) {
        try {
          const res = await fetch(url, init);
          if (!res.ok && (res.status === 429 || res.status === 503 || (res.status >= 500 && res.status < 600))) {
            lastErr = new Error(`HTTP ${res.status}`);
          } else {
            return res;
          }
        } catch (e) { lastErr = e; }
        const delay = Math.round((baseDelayMs * Math.pow(2, i)) * (0.75 + Math.random() * 0.5));
        await new Promise(r => setTimeout(r, delay));
      }
      if (lastErr) throw lastErr;
      throw new Error('Unknown error contacting backend');
    }
    const res = await fetchWithBackoff(targetUrl, { method: 'GET', headers });
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
