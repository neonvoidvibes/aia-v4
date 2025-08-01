import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { findActiveBackend, formatErrorResponse } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export async function POST(req: NextRequest) {
  console.log("[Memory Forget] Received POST request");
  const supabase = await createServerActionClient();

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.warn("[Memory Forget] Unauthorized request:", authError?.message);
      return formatErrorResponse("Unauthorized: Invalid session", 401);
    }
    console.log(`[Memory Forget] Authenticated user: ${user.id}`);

    const body = await req.json();
    if (!body.agentName || !body.memoryId) {
      return formatErrorResponse("Missing required fields: agentName and memoryId", 400);
    }

    const activeBackendUrl = await findActiveBackend(POTENTIAL_BACKEND_URLS);
    if (!activeBackendUrl) {
      return formatErrorResponse("Could not connect to backend for memory forget.", 503);
    }

    const targetUrl = `${activeBackendUrl}/api/memory/forget-chat`;
    console.log(`[Memory Forget] Forwarding POST to ${targetUrl}`);

    const { data: { session } } = await supabase.auth.getSession();
    const backendHeaders: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (session?.access_token) {
      backendHeaders['Authorization'] = `Bearer ${session.access_token}`;
    } else {
        console.error("[Memory Forget] Critical: Server-side session valid but access token missing.");
        return formatErrorResponse("Internal Server Error: Failed to retrieve auth token", 500);
    }

    const backendResponse = await fetch(targetUrl, { 
      method: 'POST', 
      headers: backendHeaders,
      body: JSON.stringify(body)
    });

    if (!backendResponse.ok) {
      const errorBody = await backendResponse.text().catch(() => `Status ${backendResponse.statusText}`);
      console.error(`[Memory Forget] Backend error: ${backendResponse.status}`, errorBody);
      return formatErrorResponse(`Backend error for memory forget (${backendResponse.status}): ${errorBody || backendResponse.statusText}`, backendResponse.status);
    }

    const data = await backendResponse.json();
    return NextResponse.json(data);

  } catch (error: any) {
    console.error("[Memory Forget] Error in POST handler:", error);
    return formatErrorResponse(error.message || 'An internal server error occurred', 500);
  }
}
