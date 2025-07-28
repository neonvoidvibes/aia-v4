// Use the server client utility we created
import { createServerActionClient } from '@/utils/supabase/server'
// We don't need cookies() import directly here anymore if using the helper
// import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
// import type { Database } from '@/types/supabase' // Comment out or remove if types not generated
import { findActiveBackend } from '@/app/api/proxyUtils'; // Import the backend finder

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export const dynamic = 'force-dynamic' // Ensure fresh data on each request

export async function GET(request: Request) {
  // Instantiate client using our helper (handles cookies internally)
  const supabase = await createServerActionClient() // Use the correct helper, add await
  try {
    // Get the current user session
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()

    if (sessionError || !session || !session.user) {
      console.warn('Permissions API: Unauthorized access attempt.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const user = session.user;

    console.log(`Permissions API: Fetching permissions for user ${user.id}`);

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

    console.log(`Permissions API: User ${user.id} has access to agents:`, allowedAgentNames);

    // --- Check for Pinecone namespace existence for each agent ---
    const activeBackendUrl = await findActiveBackend(POTENTIAL_BACKEND_URLS);

    const agentsWithCapabilities = await Promise.all(
      allowedAgentNames.map(async (name) => {
        let hasNamespace = false;
        if (activeBackendUrl) {
          try {
            const namespaceCheckUrl = `${activeBackendUrl}/api/index/river/namespace/${name}/exists`;
            const namespaceResponse = await fetch(namespaceCheckUrl, {
              headers: {
                'Authorization': `Bearer ${session.access_token}`,
              },
            });
            if (namespaceResponse.ok) {
              const namespaceData = await namespaceResponse.json();
              hasNamespace = namespaceData.exists;
            } else {
              console.warn(`Permissions API: Namespace check for '${name}' failed with status ${namespaceResponse.status}`);
            }
          } catch (e) {
            console.error(`Permissions API: Error checking namespace for agent ${name}:`, e);
          }
        } else {
          console.error("Permissions API: No active backend found to check Pinecone namespaces.");
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
    console.error('Permissions API: Unexpected error:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 })
  }
}
