import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { createRequestLogger } from '@/lib/logger';
import { randomUUID } from 'crypto';

export const maxDuration = 30;

/**
 * GET /api/agents/memory-prefs?agent=<agent_name>
 * Returns memory preferences for an agent (groups_read_mode)
 */
export async function GET(req: NextRequest) {
  const requestId = randomUUID();
  const log = createRequestLogger(requestId);

  log.info("GET /api/agents/memory-prefs request received");

  try {
    const supabase = await createServerActionClient();

    // --- Authenticate User ---
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      log.warn("Auth error", { error: authError?.message });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    log.info("User authenticated", { userId: user.id });

    // --- Get agent parameter ---
    const searchParams = req.nextUrl.searchParams;
    const agentName = searchParams.get('agent');

    if (!agentName) {
      log.warn("Missing agent parameter");
      return NextResponse.json({ error: "Missing agent parameter" }, { status: 400 });
    }

    // --- Query agents table for groups_read_mode ---
    const { data, error } = await supabase
      .from('agents')
      .select('groups_read_mode')
      .eq('name', agentName)
      .single();

    if (error) {
      log.error("Error fetching agent memory prefs", { error: error.message });
      return NextResponse.json({ error: "Failed to fetch agent preferences" }, { status: 500 });
    }

    if (!data) {
      log.warn("Agent not found", { agent: agentName });
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    log.info("Agent memory prefs fetched", {
      agent: agentName,
      groupsReadMode: data.groups_read_mode
    });

    return NextResponse.json({
      groups_read_mode: data.groups_read_mode || 'none'
    });

  } catch (error: any) {
    log.error("Top-level error in GET handler", {
      error: error.message,
      stack: error.stack
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/agents/memory-prefs
 * Updates memory preferences for an agent (groups_read_mode)
 * Body: { agent: string, groups_read_mode: 'latest' | 'none' | 'all' }
 */
export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const log = createRequestLogger(requestId);

  log.info("POST /api/agents/memory-prefs request received");

  try {
    const supabase = await createServerActionClient();

    // --- Authenticate User ---
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      log.warn("Auth error", { error: authError?.message });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    log.info("User authenticated", { userId: user.id });

    // --- Parse body ---
    const body = await req.json();
    const { agent, groups_read_mode } = body;

    if (!agent) {
      log.warn("Missing agent in request body");
      return NextResponse.json({ error: "Missing agent parameter" }, { status: 400 });
    }

    if (!['latest', 'none', 'all'].includes(groups_read_mode)) {
      log.warn("Invalid groups_read_mode value", { value: groups_read_mode });
      return NextResponse.json({ error: "groups_read_mode must be 'latest', 'none', or 'all'" }, { status: 400 });
    }

    // --- Update agents table ---
    const { error } = await supabase
      .from('agents')
      .update({ groups_read_mode })
      .eq('name', agent);

    if (error) {
      log.error("Error updating agent memory prefs", { error: error.message });
      return NextResponse.json({ error: "Failed to update agent preferences" }, { status: 500 });
    }

    log.info("Agent memory prefs updated", {
      agent,
      groupsReadMode: groups_read_mode
    });

    return NextResponse.json({
      success: true,
      groups_read_mode
    });

  } catch (error: any) {
    log.error("Top-level error in POST handler", {
      error: error.message,
      stack: error.stack
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
