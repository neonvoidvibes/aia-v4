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
 
    // --- Check for Pinecone namespace existence for each agent ---
    const activeBackendUrl = await findActiveBackend(POTENTIAL_BACKEND_URLS);

    const agentsWithCapabilities = await Promise.all(
      allowedAgentNames.map(async (name) => {
        let hasNamespace = false;
        if (activeBackendUrl) {
          try {
            const namespaceCheckUrl = `${activeBackendUrl}/api/index/river/namespace/${name}/exists`;
            // We need the session token for this backend call
            const { data: { session } } = await supabase.auth.getSession();
            const namespaceResponse = await fetch(namespaceCheckUrl, {
              headers: {
                'Authorization': `Bearer ${session?.access_token}`,
              },
            });
            if (namespaceResponse.ok) {
              const namespaceData = await namespaceResponse.json();
              hasNamespace = namespaceData.exists;
            } else {
              logger.warn(`Permissions API: Namespace check for '${name}' failed with status ${namespaceResponse.status}`);
            }
          } catch (e) {
            logger.error({ error: e }, `Permissions API: Error checking namespace for agent ${name}`);
          }
        } else {
          logger.error("Permissions API: No active backend found to check Pinecone namespaces.");
        }
        return {
          name: name,
          capabilities: {
            pinecone_index_exists: hasNamespace,
          },
        };
      })
    );

    // Return the enhanced list of agents with their capabilities
    return NextResponse.json({ allowedAgents: agentsWithCapabilities }, { status: 200 });
 
  } catch (error) {
    logger.error({ error }, 'Permissions API: Unexpected error');
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
}
