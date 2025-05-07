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

    // Fetch allowed agent IDs for the user
    const { data: permissions, error: dbError } = await supabase
      .from('user_agent_access') // Make sure this table name matches your Supabase schema
      .select('agent_id')        // Select only the agent_id column
      .eq('user_id', user.id)    // Filter by the authenticated user's ID

    if (dbError) {
      console.error(`Permissions API: Database error fetching permissions for user ${user.id}:`, dbError);
      return NextResponse.json({ error: 'Failed to fetch permissions', details: dbError.message }, { status: 500 })
    }

    // Extract just the agent IDs from the result
    const allowedAgentIds = permissions ? permissions.map(p => p.agent_id) : [];

    console.log(`Permissions API: User ${user.id} has access to agents:`, allowedAgentIds);

    // Return the list of allowed agent IDs
    return NextResponse.json({ allowedAgentIds }, { status: 200 })

  } catch (error) {
    console.error('Permissions API: Unexpected error:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 })
  }
}