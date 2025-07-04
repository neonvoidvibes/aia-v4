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
    const backendResponse = await fetch(`${backendUrl}/api/s3/view?s3Key=${encodeURIComponent(s3Key)}`, {
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
