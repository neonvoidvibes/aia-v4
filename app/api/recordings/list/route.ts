import { NextResponse } from 'next/server';
import { getSupabaseUser, getBackendUrl, formatErrorResponse } from '@/app/api/proxyUtils';

export async function POST(req: Request) {
  const user = await getSupabaseUser(req);
  if (!user?.token) {
    return formatErrorResponse('Unauthorized', 401);
  }

  const backendUrl = await getBackendUrl();
  if (!backendUrl) {
    return formatErrorResponse('Backend service not available', 503);
  }

  try {
    const body = await req.json();
    const agentName = body.agentName;

    if (!agentName) {
      return formatErrorResponse('agentName is required', 400);
    }

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
    const backendResponse = await fetchWithBackoff(`${backendUrl}/api/recordings/list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${user.token}`,
      },
      body: JSON.stringify({ agentName }),
    });

    if (!backendResponse.ok) {
      const errorData = await backendResponse.json();
      return NextResponse.json(errorData, { status: backendResponse.status });
    }

    const data = await backendResponse.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error('Error proxying to backend /api/recordings/list:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return formatErrorResponse(`Failed to list recordings: ${errorMessage}`, 500);
  }
}
