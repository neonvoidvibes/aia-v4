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

  const apiResponse = await fetchWithBackoff(`${API_URL}/api/recordings/embed`, {
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
