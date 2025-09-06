import { NextResponse } from 'next/server';
import { getSupabaseUser, getBackendUrl, formatErrorResponse } from '@/app/api/proxyUtils';

export async function GET(req: Request) {
  const user = await getSupabaseUser(req);
  if (!user?.token) {
    return formatErrorResponse('Unauthorized', 401);
  }

  const backendUrl = await getBackendUrl();
  if (!backendUrl) {
    return formatErrorResponse('Backend service not available', 503);
  }

  const { searchParams } = new URL(req.url);
  const s3Key = searchParams.get('s3Key');

  if (!s3Key) {
    return formatErrorResponse('s3Key query parameter is required', 400);
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
    const backendResponse = await fetchWithBackoff(`${backendUrl}/api/s3/view?s3Key=${encodeURIComponent(s3Key)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${user.token}`,
      },
    });

    if (!backendResponse.ok) {
      const errorData = await backendResponse.json();
      return NextResponse.json(errorData, { status: backendResponse.status });
    }

    const data = await backendResponse.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error('Error proxying to backend /api/s3/view:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return formatErrorResponse(`Failed to view file: ${errorMessage}`, 500);
  }
}
