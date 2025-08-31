import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { formatErrorResponse } from '@/app/api/proxyUtils';

export async function GET(req: NextRequest) {
  const supabase = await createServerActionClient();
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return formatErrorResponse('Unauthorized', 401);

    const agentName = req.nextUrl.searchParams.get('agentName');
    if (!agentName) return formatErrorResponse("Missing 'agentName' query parameter", 400);

    // Fetch agents.event_labels for the named agent
    const res = await supabase
      .from('agents')
      .select('event_labels')
      .eq('name', agentName)
      .single();

    if (res.error) return formatErrorResponse(res.error.message || 'Failed to fetch labels', 500);
    const event_labels = (res.data?.event_labels && typeof res.data.event_labels === 'object') ? res.data.event_labels : {};

    return NextResponse.json({ event_labels }, { status: 200 });
  } catch (e: any) {
    return formatErrorResponse(e?.message || 'Internal error', 500);
  }
}

