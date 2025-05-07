// Use the server client utility we created
import { createRouteHandlerClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
// import type { Database } from '@/types/supabase' // Comment out or remove if types not generated

export const dynamic = 'force-dynamic' // Ensure fresh data on each request

export async function GET(request: Request) {
  // Instantiate the client using our server utility function
  // Pass the cookies object directly
  const supabase = await createRouteHandlerClient() // Removed <Database>, add await
  try {
    // Get the current user session
    const { data: { user }, error: sessionError } = await supabase.auth.getUser()

    if (sessionError || !user) {
      console.warn('Permissions API: Unauthorized access attempt.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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
    // The result shape is now [{ agents: { name: 'agent1' } }, { agents: { name: 'agent2' } }, ...]
    const allowedAgentNames = permissions
      ? permissions
          .map(p => p.agents?.name) // Safely access nested name
          .filter((name): name is string => typeof name === 'string' && name !== null) // Filter out null/undefined names
      : [];

    console.log(`Permissions API: User ${user.id} has access to agents:`, allowedAgentNames);

    // Return the list of allowed agent NAMES
    return NextResponse.json({ allowedAgentNames }, { status: 200 })

  } catch (error) {
    console.error('Permissions API: Unexpected error:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 })
  }
}