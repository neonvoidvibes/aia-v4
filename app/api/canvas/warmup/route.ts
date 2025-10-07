import { type NextRequest } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { getBackendUrl, formatErrorResponse } from '@/app/api/proxyUtils';

export async function POST(req: NextRequest) {
  console.log("[API /api/canvas/warmup] Received POST request");
  const supabase = await createServerActionClient();

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.warn("[API /api/canvas/warmup] Unauthorized request:", authError?.message);
      return formatErrorResponse("Unauthorized: Invalid session", 401);
    }

    const body = await req.json();
    const { agent } = body;

    if (!agent) {
      return formatErrorResponse("Missing 'agent' in request body", 400);
    }

    console.log(`[API /api/canvas/warmup] Agent: ${agent}`);

    const activeBackendUrl = await getBackendUrl();
    if (!activeBackendUrl) {
      return formatErrorResponse("Could not connect to backend for canvas warmup.", 503);
    }

    const targetUrl = `${activeBackendUrl}/api/canvas/warmup`;
    console.log(`[API /api/canvas/warmup] Forwarding POST to Python backend: ${targetUrl}`);

    const { data: { session } } = await supabase.auth.getSession();
    const backendHeaders: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (session?.access_token) {
      backendHeaders['Authorization'] = `Bearer ${session.access_token}`;
    } else {
      console.error("[API /api/canvas/warmup] Critical: Server-side session valid but access token missing.");
      return formatErrorResponse("Internal Server Error: Failed to retrieve auth token", 500);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const backendResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: backendHeaders,
      body: JSON.stringify({ agent }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    console.log(`[API /api/canvas/warmup] Backend response status: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error(`[API /api/canvas/warmup] Python backend error: ${backendResponse.status}`, errorText);
      // Don't fail hard - warmup is optional
      return new Response(JSON.stringify({ status: "error", message: errorText }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const result = await backendResponse.json();
    console.log("[API /api/canvas/warmup] Warmup completed:", result);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error("[API /api/canvas/warmup] Error in POST handler:", error);

    // Don't fail hard - warmup is optional
    return new Response(JSON.stringify({ status: "error", message: error.message }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
