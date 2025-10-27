import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { createRequestLogger } from '@/lib/logger';
import { randomUUID } from 'crypto';

export const maxDuration = 30;

/**
 * GET /api/agents/memory-prefs?agent=<agent_name>
 * Returns memory preferences for an agent (groups_read_mode, transcript_listen_mode)
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

    // --- Query agents table for memory preferences ---
    const { data, error } = await supabase
      .from('agents')
      .select('groups_read_mode, transcript_listen_mode')
      .eq('name', agentName)
      .single();

    if (error) {
      log.error("Error fetching agent memory prefs, returning defaults", {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        agentName
      });
      // Return defaults instead of error to prevent blocking chat
      return NextResponse.json({
        groups_read_mode: 'none',
        transcript_listen_mode: 'latest'
      });
    }

    if (!data) {
      log.warn("Agent not found, returning defaults", { agent: agentName });
      // Return defaults instead of 404 to prevent blocking chat
      return NextResponse.json({
        groups_read_mode: 'none',
        transcript_listen_mode: 'latest'
      });
    }

    log.info("Agent memory prefs fetched", {
      agent: agentName,
      groupsReadMode: data.groups_read_mode,
      transcriptListenMode: data.transcript_listen_mode
    });

    return NextResponse.json({
      groups_read_mode: data.groups_read_mode || 'none',
      transcript_listen_mode: data.transcript_listen_mode || 'latest'
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
 * Updates memory preferences for an agent (groups_read_mode, transcript_listen_mode)
 * Body: {
 *   agent: string,
 *   groups_read_mode?: 'latest' | 'none' | 'all' | 'breakout',
 *   transcript_listen_mode?: 'none' | 'latest' | 'some' | 'all'
 * }
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
    const { agent, groups_read_mode, transcript_listen_mode } = body;

    if (!agent) {
      log.warn("Missing agent in request body");
      return NextResponse.json({ error: "Missing agent parameter" }, { status: 400 });
    }

    // Build update object with provided fields
    const updates: any = {};

    if (groups_read_mode !== undefined) {
      if (!['latest', 'none', 'all', 'breakout'].includes(groups_read_mode)) {
        log.warn("Invalid groups_read_mode value", { value: groups_read_mode });
        return NextResponse.json({ error: "groups_read_mode must be 'latest', 'none', 'all', or 'breakout'" }, { status: 400 });
      }
      updates.groups_read_mode = groups_read_mode;
    }

    if (transcript_listen_mode !== undefined) {
      if (!['none', 'latest', 'some', 'all'].includes(transcript_listen_mode)) {
        log.warn("Invalid transcript_listen_mode value", { value: transcript_listen_mode });
        return NextResponse.json({ error: "transcript_listen_mode must be 'none', 'latest', 'some', or 'all'" }, { status: 400 });
      }
      updates.transcript_listen_mode = transcript_listen_mode;
    }

    if (Object.keys(updates).length === 0) {
      log.warn("No valid fields to update");
      return NextResponse.json({ error: "No valid fields provided" }, { status: 400 });
    }

    // --- Update agents table ---
    const { error } = await supabase
      .from('agents')
      .update(updates)
      .eq('name', agent);

    if (error) {
      log.error("Error updating agent memory prefs", { error: error.message });
      return NextResponse.json({ error: "Failed to update agent preferences" }, { status: 500 });
    }

    log.info("Agent memory prefs updated", {
      agent,
      updates
    });

    return NextResponse.json({
      success: true,
      ...updates
    });

  } catch (error: any) {
    log.error("Top-level error in POST handler", {
      error: error.message,
      stack: error.stack
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
