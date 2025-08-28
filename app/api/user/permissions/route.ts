// Use the server client utility we created
import { createServerActionClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger'; // Import the logger
// import type { Database } from '@/types/supabase'; // Comment out or remove if types not generated
import { findActiveBackend } from '@/app/api/proxyUtils'; // Import the backend finder

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export const dynamic = 'force-dynamic' // Ensure fresh data on each request

type AgentWorkspaceInfo = {
  name: string;
  workspaceId: string | number | null;
  workspaceName: string | null;
  workspaceUiConfig: any;
};

export async function GET(request: Request) {
  // Instantiate client using our helper (handles cookies internally)
  const supabase = await createServerActionClient(); // Use the correct helper, add await
  try {
    // Get the current user securely
    const { data: { user }, error: userError } = await supabase.auth.getUser();
 
    if (userError || !user) {
      logger.warn('Permissions API: Unauthorized access attempt.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
 
    logger.info(`Permissions API: Fetching permissions for user ${user.id}`);

    // --- PHASE 3: Fetch user role first to determine admin override ---
    let userRole = 'user'; // Default role
    let isAdminOverride = false;
    try {
        const { data: roleData, error: roleError } = await supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', user.id)
            .single();

        if (roleError && roleError.code !== 'PGRST116') { // PGRST116: no rows found, which is not an error here
            throw roleError;
        }
        
        if (roleData) {
            userRole = roleData.role;
        }
        
        // Check if user is admin or super user for override
        isAdminOverride = userRole === 'admin' || userRole === 'super user';
    } catch(roleError) {
        logger.warn({ error: roleError }, `Permissions API: Could not fetch role for user ${user.id}, defaulting to 'user'.`);
    }

    // --- PHASE 3: Enhanced agent fetching with workspace support ---
    let agentsWithWorkspaceInfo: AgentWorkspaceInfo[] = [];
    
    if (isAdminOverride) {
      // Admin users see all agents
      const { data: allAgents, error: agentsError } = await supabase
        .from('agents')
        .select('name, workspace_id, workspaces(id, name, ui_config)');
      
      if (agentsError) {
        logger.error(`Permissions API: Error fetching all agents for admin user ${user.id}:`, agentsError);
        return NextResponse.json({ error: 'Failed to fetch agents', details: agentsError.message }, { status: 500 });
      }
      
      agentsWithWorkspaceInfo = (allAgents || []).map(agent => {
        const ws = Array.isArray(agent.workspaces) ? agent.workspaces[0] : agent.workspaces;
        return {
          name: (agent as any).name,
          workspaceId: (agent as any).workspace_id,
          workspaceName: ws?.name || null,
          workspaceUiConfig: ws?.ui_config || {}
        } as AgentWorkspaceInfo;
      });
    } else {
      // Regular users: fetch through user_agent_access and workspace_users
      const { data: permissions, error: dbError } = await supabase
        .from('user_agent_access')
        .select(`
          agents!inner ( 
            name, 
            workspace_id,
            workspaces(id, name, ui_config)
          )
        `) 
        .eq('user_id', user.id);

      if (dbError) {
        console.error(`Permissions API: Database error fetching permissions for user ${user.id}:`, dbError);
        return NextResponse.json({ error: 'Failed to fetch permissions', details: dbError.message }, { status: 500 })
      }

      // Extract agent info with workspace data
      agentsWithWorkspaceInfo = (permissions || [])
        .map(p => {
          const agentData = Array.isArray((p as any).agents) ? (p as any).agents[0] : (p as any).agents;
          if (!agentData) return null;
          const ws = Array.isArray(agentData.workspaces) ? agentData.workspaces[0] : agentData.workspaces;
          const obj: AgentWorkspaceInfo = {
            name: agentData.name,
            workspaceId: agentData.workspace_id,
            workspaceName: ws?.name || null,
            workspaceUiConfig: ws?.ui_config || {}
          };
          return obj;
        })
        .filter((a): a is AgentWorkspaceInfo => a !== null);
    }
 
    logger.info({ agentCount: agentsWithWorkspaceInfo.length }, `Permissions API: User ${user.id} has access`);
 
    // --- BATCH CAPABILITIES CHECK ---
    const activeBackendUrl = await findActiveBackend(POTENTIAL_BACKEND_URLS);
    const agentNames = agentsWithWorkspaceInfo.map(a => a.name);
    let agentsWithCapabilities = agentsWithWorkspaceInfo.map(agent => ({
        ...agent,
        capabilities: { pinecone_index_exists: false } // Default to false
    }));

    if (activeBackendUrl && agentNames.length > 0) {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const capabilitiesResponse = await fetch(`${activeBackendUrl}/api/agents/capabilities`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify({ agent_names: agentNames })
            });

            if (capabilitiesResponse.ok) {
                const capabilitiesData = await capabilitiesResponse.json();
                agentsWithCapabilities = agentsWithWorkspaceInfo.map(agent => ({
                    ...agent,
                    capabilities: capabilitiesData[agent.name] || { pinecone_index_exists: false }
                }));
            } else {
                logger.error("Permissions API: Failed to fetch agent capabilities from backend.");
            }
        } catch (e) {
            logger.error({ error: e }, `Permissions API: Error fetching agent capabilities.`);
        }
    }
    
    // --- PHASE 3: Build workspace configurations map ---
    const workspaceConfigs: Record<string, any> = {};
    agentsWithCapabilities.forEach(agent => {
      if (agent.workspaceId && agent.workspaceUiConfig) {
        workspaceConfigs[String(agent.workspaceId)] = agent.workspaceUiConfig;
      }
    });
    
    // --- PHASE 3: Determine if agent selector should be shown ---
    // IMPORTANT: Always use workspace configuration from Supabase, never hardcode UI logic!
    // Check if any workspace disables agent selector by default
    let defaultHideAgentSelector = false;
    Object.values(workspaceConfigs).forEach((config: any) => {
      if (config?.hide_agent_selector_default) {
        defaultHideAgentSelector = true;
      }
    });
    
    const showAgentSelector = isAdminOverride || (!defaultHideAgentSelector && agentsWithCapabilities.length > 1);
    
    // --- PHASE 3: Return the rich permissions data structure ---
    return NextResponse.json({ 
      isAdminOverride,
      showAgentSelector,
      agents: agentsWithCapabilities,
      workspaceConfigs,
      userRole,
      // Legacy support for existing code
      allowedAgents: agentsWithCapabilities.map(a => ({ name: a.name, capabilities: a.capabilities }))
    }, { status: 200 });
 
  } catch (error) {
    logger.error({ error }, 'Permissions API: Unexpected error');
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
}
