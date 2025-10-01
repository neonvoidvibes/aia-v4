import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { createRequestLogger } from '@/lib/logger';
import { randomUUID } from 'crypto';

export const maxDuration = 30;

/**
 * GET /api/agents/memory-prefs?agent=<agent_name>
 * Returns memory preferences for an agent (cross_group_read_enabled)
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

    // --- Query agents table for cross_group_read_enabled ---
    const { data, error } = await supabase
      .from('agents')
      .select('cross_group_read_enabled')
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
      crossGroupReadEnabled: data.cross_group_read_enabled
    });

    return NextResponse.json({
      cross_group_read_enabled: data.cross_group_read_enabled || false
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
 * Updates memory preferences for an agent (cross_group_read_enabled)
 * Body: { agent: string, cross_group_read_enabled: boolean }
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
    const { agent, cross_group_read_enabled } = body;

    if (!agent) {
      log.warn("Missing agent in request body");
      return NextResponse.json({ error: "Missing agent parameter" }, { status: 400 });
    }

    if (typeof cross_group_read_enabled !== 'boolean') {
      log.warn("Invalid cross_group_read_enabled value", { value: cross_group_read_enabled });
      return NextResponse.json({ error: "cross_group_read_enabled must be a boolean" }, { status: 400 });
    }

    // --- Update agents table ---
    const { error } = await supabase
      .from('agents')
      .update({ cross_group_read_enabled })
      .eq('name', agent);

    if (error) {
      log.error("Error updating agent memory prefs", { error: error.message });
      return NextResponse.json({ error: "Failed to update agent preferences" }, { status: 500 });
    }

    log.info("Agent memory prefs updated", {
      agent,
      crossGroupReadEnabled: cross_group_read_enabled
    });

    return NextResponse.json({
      success: true,
      cross_group_read_enabled
    });

  } catch (error: any) {
    log.error("Top-level error in POST handler", {
      error: error.message,
      stack: error.stack
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
