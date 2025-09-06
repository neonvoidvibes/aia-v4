import { type NextRequest, NextResponse } from 'next/server';
// Import our specific server client helper
import { createServerActionClient } from '@/utils/supabase/server'
// We don't need cookies() import directly here anymore if using the helper
// import { cookies } from 'next/headers'
// import type { Database } from '@/types/supabase' // Comment out or remove if types not generated

// --- Copy Helper Functions Directly Here (or import if refactored later) ---

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

import { getBackendUrl } from '@/app/api/proxyUtils';

function formatErrorResponse(message: string, status: number): NextResponse {
    return NextResponse.json({ status: "error", message: message }, { status: status });
}
// --- End Helper Functions ---

// Route handler for GET (for status)
export async function GET(req: NextRequest) {
    console.log("[API /api/recording-proxy] Received GET request (for status)");
    // Instantiate client using our helper (handles cookies internally)
    const supabase = await createServerActionClient() // Use the correct helper, add await

    // --- Authenticate User ---
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        console.warn("[API /api/recording-proxy] Unauthorized GET request:", authError?.message);
        return formatErrorResponse("Unauthorized: Invalid session", 401);
    }
    console.log(`[API /api/recording-proxy] GET Authenticated user: ${user.id}`);
    // --- End Authentication ---

    const activeBackendUrl = await getBackendUrl();
    if (!activeBackendUrl) {
        return formatErrorResponse("Could not connect to backend for recording status.", 503);
    }

    const targetUrl = `${activeBackendUrl}/api/recording/status`;
    console.log(`[API /api/recording-proxy] Forwarding GET to ${targetUrl}`);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
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
        const backendResponse = await fetchWithBackoff(targetUrl, { method: 'GET', signal: controller.signal });
        clearTimeout(timeoutId);

        // Check Content-Type before assuming JSON, handle non-OK status
        const contentType = backendResponse.headers.get("content-type");
        if (backendResponse.ok && contentType && contentType.includes("application/json")) {
            const data = await backendResponse.json();
            // Ensure we return the full status object as received from the backend
            console.log("[API /api/recording-proxy] Status success:", data);
            return NextResponse.json(data); // Return the full object
        } else if (backendResponse.ok) {
             const textResponse = await backendResponse.text().catch(() => "Could not read response text");
             console.warn(`[API /api/recording-proxy] Status backend returned OK but non-JSON: ${contentType}`);
             return formatErrorResponse(`Backend returned unexpected format for status`, 502);
        } else {
            const errorBody = await backendResponse.text().catch(() => "Failed to read error body");
            console.error(`[API /api/recording-proxy] Status backend error: ${backendResponse.status}`, errorBody);
            return formatErrorResponse(`Backend error for status (${backendResponse.status}): ${errorBody || backendResponse.statusText}`, backendResponse.status);
        }
    } catch (error: any) {
         if (error.name === 'AbortError') {
             console.error(`[API /api/recording-proxy] Fetch timed out connecting to ${targetUrl} for status`);
             return formatErrorResponse(`Timeout fetching recording status from backend.`, 504);
         } else {
             console.error(`[API /api/recording-proxy] Fetch error for status: ${error.message}`, error);
             return formatErrorResponse(`Failed to fetch recording status: ${error.message}`, 500);
         }
    }
}


// Route handler for POST (for actions like start, stop)
export async function POST(req: NextRequest) {
    const supabase = await createServerActionClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return formatErrorResponse("Unauthorized", 401);
    }

    const activeBackendUrl = await getBackendUrl();
    if (!activeBackendUrl) {
        return formatErrorResponse("Backend service not available", 503);
    }

    const originalBody = await req.json();
    const action = originalBody?.action;

    if (!action || !['start', 'stop'].includes(action)) {
        return formatErrorResponse("Invalid or missing action", 400);
    }

    const targetUrl = `${activeBackendUrl}/api/recording/${action}`;
    console.log(`[API /api/recording-proxy] Forwarding POST for action '${action}' to ${targetUrl}`);

    try {
        const originalAuthHeader = req.headers.get('Authorization');
        if (!originalAuthHeader) {
            return formatErrorResponse("Authorization header missing", 401);
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
        const backendResponse = await fetchWithBackoff(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': originalAuthHeader,
            },
            body: JSON.stringify(originalBody.payload), // Forward the nested payload object
        });

        const responseData = await backendResponse.json();
        return NextResponse.json(responseData, { status: backendResponse.status });

    } catch (error: any) {
        console.error(`[API /api/recording-proxy] Fetch error for action '${action}': ${error.message}`, error);
        return formatErrorResponse(`Failed to perform recording action '${action}': ${error.message}`, 500);
    }
}
