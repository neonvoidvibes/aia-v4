import { NextResponse } from 'next/server';
import { getSupabaseUser, getBackendUrl } from '@/app/api/proxyUtils';

export async function POST(request: Request) {
  const user = await getSupabaseUser(request);
  if (!user) {
    return new NextResponse(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const body = await request.json();
  const { s3Key, agentName } = body;

  if (!s3Key || !agentName) {
    return new NextResponse(JSON.stringify({ error: 's3Key and agentName are required' }), { status: 400 });
  }

  const backendUrl = await getBackendUrl();
  if (!backendUrl) {
    return new NextResponse(JSON.stringify({ error: 'Backend not available' }), { status: 503 });
  }

  try {
    const apiResponse = await fetch(`${backendUrl}/api/s3/manage-file`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${user.token}`,
      },
      body: JSON.stringify({
        s3Key,
        agentName,
        action: 'archive', // Using 'archive' action as per backend logic
        eventId: 'default-event', // Provide a default eventId or extract if available
      }),
    });

    const data = await apiResponse.json();
    if (apiResponse.ok) {
      return new NextResponse(JSON.stringify(data), { status: 200 });
    } else {
      return new NextResponse(JSON.stringify({ error: data.error || 'Failed to delete recording' }), { status: apiResponse.status });
    }
  } catch (error) {
    console.error('Error deleting recording:', error);
    return new NextResponse(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}
