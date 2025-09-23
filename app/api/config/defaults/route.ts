import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // Get backend URL from environment or default to localhost
    const backendUrl = process.env.BACKEND_API_URLS?.split(',')[0]?.trim() || 'http://localhost:5001';

    console.log('[Config Defaults Proxy] Fetching from:', `${backendUrl}/api/config/defaults`);

    const response = await fetch(`${backendUrl}/api/config/defaults`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    console.log('[Config Defaults Proxy] Backend response:', data);

    if (!response.ok) {
      return Response.json(
        { error: data.error || data.message || 'Failed to fetch config defaults' },
        { status: response.status }
      );
    }

    return Response.json(data, { status: 200 });
  } catch (error) {
    console.error('[Config Defaults Proxy] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return Response.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}