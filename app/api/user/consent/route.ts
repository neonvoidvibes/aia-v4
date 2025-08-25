// app/api/user/consent/route.ts
import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { formatErrorResponse } from '@/app/api/proxyUtils';

export async function POST(req: NextRequest) {
  const supabase = await createServerActionClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return formatErrorResponse("Unauthorized", 401);
  }

  const { workspaceId } = await req.json();

  if (!workspaceId) {
    return formatErrorResponse("workspaceId is required", 400);
  }

  try {
    // Verify the user is a member of the workspace before recording consent.
    const { data: membership, error: membershipError } = await supabase
      .from('workspace_users')
      .select('user_id')
      .eq('user_id', user.id)
      .eq('workspace_id', workspaceId)
      .single();

    if (membershipError || !membership) {
      console.warn(`User ${user.id} attempted to consent to workspace ${workspaceId} without membership.`);
      return formatErrorResponse("Forbidden: You are not a member of this workspace.", 403);
    }
    
    // Use upsert to handle cases where consent might be submitted more than once.
    // It will insert or update the record, ensuring a clean state.
    const { error: consentError } = await supabase
      .from('user_consents')
      .upsert({
        user_id: user.id,
        workspace_id: workspaceId,
        consented_at: new Date().toISOString(),
      });

    if (consentError) {
      console.error(`Error saving user consent for user ${user.id} to workspace ${workspaceId}:`, consentError);
      return formatErrorResponse("Could not save consent.", 500);
    }

    return NextResponse.json({ success: true, message: "Consent recorded." });
  } catch (error) {
    console.error("Unexpected error in /api/user/consent:", error);
    return formatErrorResponse("An internal server error occurred.", 500);
  }
}