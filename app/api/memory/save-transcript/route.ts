import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { getBackendUrl } from '@/app/api/proxyUtils';

export async function POST(req: NextRequest) {
  const supabase = await createServerActionClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { agentName, eventId = '0000', s3Key } = body || {};
  if (!agentName || !s3Key) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

  const backend = await getBackendUrl();
  if (!backend) return NextResponse.json({ error: 'Backend unavailable' }, { status: 503 });
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(`${backend}/api/transcripts/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session!.access_token}` },
    body: JSON.stringify({ agentName, eventId, s3Key })
  });

  const payload = await res.json().catch(() => ({}));
  return NextResponse.json(payload, { status: res.status });
}

