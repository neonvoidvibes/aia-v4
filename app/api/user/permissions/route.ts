import { NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { logger } from '@/lib/logger';
import { findActiveBackend } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const supabase = await createServerActionClient();
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      logger.warn('Permissions API: Unauthorized access attempt.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    logger.info(`Permissions API: Fetching permissions for user ${user.id}`);

    // --- 1. Check User Role for Admin/Super User Override ---
    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();
    
    const userRole = (roleData?.role) || 'user';
    
    let agents = [];
    let workspaceConfigs = {};
    let userHasConsented = false;

    // --- 2. Admin/Super User Path: Fetch Everything ---
    // FUTURE-PROOFING: This admin override path provides a "god mode" for administrators,
    // allowing them to view any agent/workspace without being restricted by UI flags.
    if (userRole === 'admin' || userRole === 'super user') {
      logger.info(`Admin override for user ${user.id} (role: ${userRole}). Fetching all data.`);
      
      const { data: allAgents, error: allAgentsError } = await supabase.from('agents').select('id, name, workspace_id');
      if (allAgentsError) throw allAgentsError;
      agents = allAgents || [];

      const { data: allWorkspaces, error: allWorkspacesError } = await supabase.from('workspaces').select('id, ui_config');
      if (allWorkspacesError) throw allWorkspacesError;
      workspaceConfigs = (allWorkspaces || []).reduce((acc, ws) => {
        acc[ws.id] = ws.ui_config;
        return acc;
      }, {});

      // For admins, consent is assumed.
      userHasConsented = true;

      const responsePayload = {
        isAdminOverride: true,
        userHasConsented,
        showAgentSelector: true,
        agents: agents.map(a => ({ id: a.id, name: a.name, workspaceId: a.workspace_id })),
        workspaceConfigs,
        userRole,
      };
      return NextResponse.json(responsePayload);
    }

    // --- 3. Regular User Path: Fetch Scoped Data ---
    logger.info(`Regular user path for user ${user.id}.`);
    
    // Get all workspaces this user belongs to
    const { data: userWorkspaces, error: uwError } = await supabase
      .from('workspace_users')
      .select('workspace_id')
      .eq('user_id', user.id);
    if (uwError) throw uwError;
    
    const workspaceIds = (userWorkspaces || []).map(uw => uw.workspace_id);

    if (workspaceIds.length === 0) {
      logger.warn(`User ${user.id} does not belong to any workspaces.`);
      return NextResponse.json({ agents: [], workspaceConfigs: {}, userHasConsented: true, showAgentSelector: false, userRole });
    }

    // Fetch agents and configs for the user's workspaces
    const { data: workspaceAgents, error: waError } = await supabase
      .from('agents')
      .select('id, name, workspace_id')
      .in('workspace_id', workspaceIds);
    if (waError) throw waError;
    agents = workspaceAgents || [];
    
    const { data: workspaces, error: wsError } = await supabase
      .from('workspaces')
      .select('id, ui_config')
      .in('id', workspaceIds);
    if (wsError) throw wsError;
    workspaceConfigs = (workspaces || []).reduce((acc, ws) => {
        acc[ws.id] = ws.ui_config;
        return acc;
    }, {});
    
    // Check consent for all workspaces the user is a part of. For now, if they've consented to any, we let them in.
    const { data: consentData, error: consentError } = await supabase
        .from('user_consents')
        .select('workspace_id')
        .eq('user_id', user.id)
        .in('workspace_id', workspaceIds)
        .limit(1);
    if (consentError) throw consentError;
    userHasConsented = (consentData || []).length > 0;

    // --- 4. Get Agent Capabilities (e.g., Pinecone status) ---
    const activeBackendUrl = await findActiveBackend(POTENTIAL_BACKEND_URLS);
    let agentsWithCapabilities = agents.map(a => ({
        id: a.id,
        name: a.name,
        workspaceId: a.workspace_id,
        capabilities: { pinecone_index_exists: false }
    }));

    if (activeBackendUrl && agents.length > 0) {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const capabilitiesResponse = await fetch(`${activeBackendUrl}/api/agents/capabilities`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify({ agent_names: agents.map(a => a.name) })
            });
            if (capabilitiesResponse.ok) {
                const capabilitiesData = await capabilitiesResponse.json();
                agentsWithCapabilities = agents.map(a => ({
                    ...a,
                    workspaceId: a.workspace_id,
                    capabilities: capabilitiesData[a.name] || { pinecone_index_exists: false }
                }));
            }
        } catch (e) {
            logger.error({ error: e }, `Permissions API: Error fetching agent capabilities.`);
        }
    }
    
    const responsePayload = {
      isAdminOverride: false,
      userHasConsented,
      showAgentSelector: agents.length > 1,
      agents: agentsWithCapabilities,
      workspaceConfigs,
      userRole,
    };
    return NextResponse.json(responsePayload);

  } catch (error) {
    logger.error({ error }, 'Permissions API: Unexpected error');
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
}
