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

    const backendResponse = await fetch(`${backendUrl}/api/recordings/list`, {
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
