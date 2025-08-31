// app/api/transcription/status/[jobId]/route.ts
import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { getBackendUrl, formatErrorResponse } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(u => u.trim()).filter(Boolean);

export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const supabase = await createServerActionClient();
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) return formatErrorResponse('Unauthorized: Invalid session', 401);

    const { jobId } = await params;
    if (!jobId) {
      return formatErrorResponse('Missing job ID', 400);
    }

    const backend = await getBackendUrl();
    if (!backend) return formatErrorResponse('Could not connect to backend to get status.', 503);

    const resp = await fetch(`${backend}/api/transcription/status/${jobId}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    });

    const data = await resp.json().catch(() => null);
    if (!resp.ok) return formatErrorResponse(data?.error || resp.statusText, resp.status);
    return NextResponse.json(data, { status: resp.status });
  } catch (e: any) {
    return formatErrorResponse(e?.message || 'Internal error', 500);
  }
}
