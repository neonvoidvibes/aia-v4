import { createServerActionClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic' // Ensure fresh data on each request

export async function POST(request: Request) {
  const supabase = await createServerActionClient();
  
  try {
    // Get the current user securely
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      logger.warn('Consent API: Unauthorized access attempt.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { workspaceId } = body;

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
    }

    // Check if user has access to this workspace
    const { data: workspaceAccess, error: accessError } = await supabase
      .from('workspace_users')
      .select('workspace_id')
      .eq('user_id', user.id)
      .eq('workspace_id', workspaceId)
      .single();

    if (accessError || !workspaceAccess) {
      logger.warn(`Consent API: User ${user.id} attempted to consent to workspace ${workspaceId} without access.`);
      return NextResponse.json({ error: 'Access denied to workspace' }, { status: 403 });
    }

    // Record consent
    const { error: consentError } = await supabase
      .from('user_consents')
      .upsert({
        user_id: user.id,
        workspace_id: workspaceId,
        consented_at: new Date().toISOString()
      });

    if (consentError) {
      logger.error(`Consent API: Error recording consent for user ${user.id}, workspace ${workspaceId}:`, consentError);
      return NextResponse.json({ error: 'Failed to record consent', details: consentError.message }, { status: 500 });
    }

    logger.info(`Consent API: User ${user.id} consented to workspace ${workspaceId}`);
    return NextResponse.json({ success: true }, { status: 200 });

  } catch (error) {
    logger.error({ error }, 'Consent API: Unexpected error');
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const supabase = await createServerActionClient();
  
  try {
    // Get the current user securely
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      logger.warn('Consent API: Unauthorized access attempt.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get workspace ID from query params
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspaceId');

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId query parameter is required' }, { status: 400 });
    }

    // Check if user has consented to this workspace
    const { data: consent, error: consentError } = await supabase
      .from('user_consents')
      .select('consented_at')
      .eq('user_id', user.id)
      .eq('workspace_id', workspaceId)
      .single();

    if (consentError && consentError.code !== 'PGRST116') {
      logger.error(`Consent API: Error checking consent for user ${user.id}, workspace ${workspaceId}:`, consentError);
      return NextResponse.json({ error: 'Failed to check consent', details: consentError.message }, { status: 500 });
    }

    return NextResponse.json({ 
      hasConsented: !!consent,
      consentedAt: consent?.consented_at || null
    }, { status: 200 });

  } catch (error) {
    logger.error({ error }, 'Consent API: Unexpected error');
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
}