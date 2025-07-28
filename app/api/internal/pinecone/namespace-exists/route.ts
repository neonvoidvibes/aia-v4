import { createServerActionClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';
import { proxyApiRouteRequest } from '@/app/api/proxyUtils';

export const dynamic = 'force-dynamic';

// This internal route is protected and requires an authenticated user.
// It proxies requests to the Python backend to check if a Pinecone namespace exists.
export async function GET(request: Request) {
  const supabase = await createServerActionClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const indexName = searchParams.get('indexName');
  const namespace = searchParams.get('namespace');

  if (!indexName || !namespace) {
    return NextResponse.json({ error: 'Missing indexName or namespace query parameter' }, { status: 400 });
  }

  // The target URL on the Python backend
  const targetUrl = `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/api/index/${indexName}/namespace/${namespace}/exists`;

  // Proxy the request using the utility function
  return proxyApiRouteRequest({ request, targetUrl, method: 'GET' });
}
