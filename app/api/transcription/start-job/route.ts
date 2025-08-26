// app/api/transcription/start-job/route.ts
import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { findActiveBackend, formatErrorResponse } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(u => u.trim()).filter(Boolean);

export async function POST(req: NextRequest) {
  const supabase = await createServerActionClient();
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) return formatErrorResponse('Unauthorized: Invalid session', 401);

    const body = await req.json();
    const { agentName, s3Key, originalFilename, transcriptionLanguage } = body || {};
    if (!agentName || !s3Key || !originalFilename) {
      return formatErrorResponse('Missing required fields: agentName, s3Key, originalFilename', 400);
    }

    const backend = await findActiveBackend(POTENTIAL_BACKEND_URLS);
    if (!backend) return formatErrorResponse('Could not connect to backend to start job.', 503);

    const resp = await fetch(`${backend}/api/transcription/start-job-from-s3`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ agentName, s3Key, originalFilename, transcriptionLanguage }),
    });

    const data = await resp.json().catch(() => null);
    if (!resp.ok) return formatErrorResponse(data?.error || resp.statusText, resp.status);
    return NextResponse.json(data, { status: 200 });
  } catch (e: any) {
    return formatErrorResponse(e?.message || 'Internal error', 500);
  }
}