import { NextResponse } from 'next/server';
import { getSupabaseUser } from '@/app/api/proxyUtils';

const API_URL = process.env.API_URL;

async function proxyRequest(request: Request, endpoint: string) {
  const user = await getSupabaseUser(request);
  if (!user) {
    return new NextResponse(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const body = await request.json();

  const apiResponse = await fetch(`${API_URL}/api/audio-recording/${endpoint}`, {
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
  } else {
    return new NextResponse(JSON.stringify({ error: 'Invalid action' }), { status: 400 });
  }
}
