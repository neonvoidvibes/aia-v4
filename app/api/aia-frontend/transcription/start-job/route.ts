// app/api/transcription/start-job/route.ts
import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { getBackendUrl, formatErrorResponse } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export async function POST(req: NextRequest) {
  console.log("[API /transcription/start-job] Received POST request");
  const supabase = await createServerActionClient();

  try {
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session) {
      return formatErrorResponse("Unauthorized: Invalid session", 401);
    }

    const body = await req.json();
    if (!body.agentName || !body.s3Key || !body.originalFilename) {
      return formatErrorResponse("Missing required fields: agentName, s3Key, originalFilename", 400);
    }

    const activeBackendUrl = await getBackendUrl();
    if (!activeBackendUrl) {
      return formatErrorResponse("Could not connect to backend to start transcription job.", 503);
    }

    const targetUrl = `${activeBackendUrl}/internal_api/start-transcription-from-s3`;
    
    const backendResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body) // Forwarding body which includes s3Key, agentName, etc.
    });

    const responseData = await backendResponse.json();
    if (!backendResponse.ok) {
        const errorMsg = responseData.error || `Backend error: ${backendResponse.statusText}`;
        return formatErrorResponse(errorMsg, backendResponse.status);
    }
    
    return NextResponse.json(responseData, { status: 200 });

  } catch (error: any) {
    console.error("[API /transcription/start-job] Error in POST handler:", error);
    return formatErrorResponse(error.message || 'An internal server error occurred', 500);
  }
}
