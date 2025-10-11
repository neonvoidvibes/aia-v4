import { NextResponse } from 'next/server';
import { getBackendUrl } from '@/app/api/proxyUtils';

/**
 * Prefetch endpoint to warm up the backend URL cache.
 * Called by the client after page load to avoid latency on first chat message.
 */
export async function GET() {
  try {
    const backendUrl = await getBackendUrl();

    if (!backendUrl) {
      return NextResponse.json({
        status: 'error',
        message: 'No active backend found'
      }, { status: 503 });
    }

    return NextResponse.json({
      status: 'ok',
      cached: true
    }, { status: 200 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      status: 'error',
      message: errorMessage
    }, { status: 500 });
  }
}
