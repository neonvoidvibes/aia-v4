import { NextResponse } from 'next/server';
import { getSupabaseUser, getBackendUrl } from '@/app/api/proxyUtils';

export async function POST(request: Request) {
  const API_URL = await getBackendUrl();
  if (!API_URL) {
    return new NextResponse(JSON.stringify({ error: 'Backend service not available' }), { status: 503 });
  }

  const user = await getSupabaseUser(request);
  if (!user) {
    return new NextResponse(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const body = await request.json();

  const apiResponse = await fetch(`${API_URL}/api/recordings/embed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${user.token}`,
    },
    body: JSON.stringify(body),
  });

  if (!apiResponse.ok) {
    const errorBody = await apiResponse.text();
    console.error(`Backend error: ${apiResponse.status}`, errorBody);
    return new NextResponse(errorBody, { status: apiResponse.status });
  }

  const data = await apiResponse.json();
  return new NextResponse(JSON.stringify(data), { status: apiResponse.status });
}
