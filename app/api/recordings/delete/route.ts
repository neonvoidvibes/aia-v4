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
    async function fetchWithBackoff(url: string, init: RequestInit, attempts = 3, baseDelayMs = 300): Promise<Response> {
      let lastErr: any = null;
      for (let i = 0; i < attempts; i++) {
        try {
          const res = await fetch(url, init);
          if (!res.ok && (res.status === 429 || res.status === 503 || (res.status >= 500 && res.status < 600))) {
            lastErr = new Error(`HTTP ${res.status}`);
          } else {
            return res;
          }
        } catch (e) { lastErr = e; }
        const delay = Math.round((baseDelayMs * Math.pow(2, i)) * (0.75 + Math.random() * 0.5));
        await new Promise(r => setTimeout(r, delay));
      }
      if (lastErr) throw lastErr;
      throw new Error('Unknown error contacting backend');
    }
    const apiResponse = await fetchWithBackoff(`${backendUrl}/api/s3/manage-file`, {
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
