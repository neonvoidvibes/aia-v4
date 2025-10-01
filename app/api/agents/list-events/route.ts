import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { formatErrorResponse } from '@/app/api/proxyUtils';
import { loadAgentEventsForUser } from '@/lib/agent-events';

export async function GET(req: NextRequest) {
  const supabase = await createServerActionClient();
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return formatErrorResponse('Unauthorized', 401);
    }

    const agentName = req.nextUrl.searchParams.get('agentName');
    if (!agentName) {
      return formatErrorResponse("Missing 'agentName' query parameter", 400);
    }

    const payload = await loadAgentEventsForUser(supabase, agentName, user.id);
    return NextResponse.json(payload, { status: 200 });
  } catch (error: any) {
    const message = error?.message || 'Failed to load events';
    return formatErrorResponse(message, 500);
  }
}
