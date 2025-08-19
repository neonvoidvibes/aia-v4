// Use the server client utility we created
import { createServerActionClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger'; // Import the logger
// import type { Database } from '@/types/supabase'; // Comment out or remove if types not generated
import { findActiveBackend } from '@/app/api/proxyUtils'; // Import the backend finder

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export const dynamic = 'force-dynamic' // Ensure fresh data on each request

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

    // Fetch allowed agent NAMES for the user by joining tables
    // The `!inner` hint ensures we only get results if the agent exists in both tables
    const { data: permissions, error: dbError } = await supabase
      .from('user_agent_access')
      .select(`
        agents!inner ( name )
      `) // Select the 'name' column from the joined 'agents' table
      .eq('user_id', user.id);   // Filter by the authenticated user's ID

    if (dbError) {
      console.error(`Permissions API: Database error fetching permissions for user ${user.id}:`, dbError);
      return NextResponse.json({ error: 'Failed to fetch permissions', details: dbError.message }, { status: 500 })
    }

    // Extract just the agent names from the result
    const allowedAgentNames = permissions
      ? permissions
          .map(p => {
            const agentData = p.agents as { name: string } | { name: string }[] | null;
            if (Array.isArray(agentData)) {
              return agentData[0]?.name;
            }
            return agentData?.name;
          })
          .filter((name): name is string => typeof name === 'string' && name !== null)
      : [];
 
    logger.info({ agents: allowedAgentNames }, `Permissions API: User ${user.id} has access`);
 
    // --- NEW BATCH CAPABILITIES CHECK ---
    const activeBackendUrl = await findActiveBackend(POTENTIAL_BACKEND_URLS);
    let agentsWithCapabilities = allowedAgentNames.map(name => ({
        name,
        capabilities: { pinecone_index_exists: false } // Default to false
    }));

    if (activeBackendUrl && allowedAgentNames.length > 0) {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const capabilitiesResponse = await fetch(`${activeBackendUrl}/api/agents/capabilities`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify({ agent_names: allowedAgentNames })
            });

            if (capabilitiesResponse.ok) {
                const capabilitiesData = await capabilitiesResponse.json();
                agentsWithCapabilities = allowedAgentNames.map(name => ({
                    name,
                    capabilities: capabilitiesData[name] || { pinecone_index_exists: false }
                }));
            } else {
                logger.error("Permissions API: Failed to fetch agent capabilities from backend.");
            }
        } catch (e) {
            logger.error({ error: e }, `Permissions API: Error fetching agent capabilities.`);
        }
    }
    // --- END NEW BATCH LOGIC ---

    // --- NEW: Fetch user role ---
    let userRole = 'user'; // Default role
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
    } catch(roleError) {
        logger.warn({ error: roleError }, `Permissions API: Could not fetch role for user ${user.id}, defaulting to 'user'.`);
    }
    // --- END NEW: Fetch user role ---
 
    // Return the enhanced list of agents with their capabilities and the user's role
    return NextResponse.json({ allowedAgents: agentsWithCapabilities, userRole: userRole }, { status: 200 });
 
  } catch (error) {
    logger.error({ error }, 'Permissions API: Unexpected error');
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
}
