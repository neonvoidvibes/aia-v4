import { NextResponse } from 'next/server';
import { getSupabaseUser, getBackendUrl } from '@/app/api/proxyUtils';

async function proxyRequest(request: Request, endpoint: string) {
  const user = await getSupabaseUser(request);
  if (!user) {
    return new NextResponse(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const body = await request.json();
  const backendUrl = await getBackendUrl();

  if (!backendUrl) {
    return new NextResponse(JSON.stringify({ error: 'Backend not available' }), { status: 503 });
  }

  const apiResponse = await fetch(`${backendUrl}/api/recording/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${user.token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await apiResponse.json();
  return new NextResponse(JSON.stringify(data), { status: apiResponse.status });
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  if (action === 'start') {
    return proxyRequest(request, 'start');
  } else if (action === 'stop') {
    return proxyRequest(request, 'stop');
  } else if (action === 'pause') {
    return proxyRequest(request, 'pause');
  } else if (action === 'resume') {
    return proxyRequest(request, 'resume');
  } else {
    return new NextResponse(JSON.stringify({ error: 'Invalid action' }), { status: 400 });
  }
}
