import { NextResponse } from 'next/server';
import { getSupabaseUser } from '@/app/api/proxyUtils';

const API_URL = process.env.API_URL;

export async function POST(request: Request) {
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

  const data = await apiResponse.json();
  return new NextResponse(JSON.stringify(data), { status: apiResponse.status });
}
