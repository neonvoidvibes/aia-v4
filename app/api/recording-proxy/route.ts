import { type NextRequest, NextResponse } from 'next/server';
// Import our specific server client helper
import { createServerActionClient } from '@/utils/supabase/server'
// We don't need cookies() import directly here anymore if using the helper
// import { cookies } from 'next/headers'
// import type { Database } from '@/types/supabase' // Comment out or remove if types not generated

// --- Copy Helper Functions Directly Here (or import if refactored later) ---

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

async function findActiveBackend(urls: string[]): Promise<string | null> {
    if (!urls || urls.length === 0) {
        console.error("[Recording Proxy Util] No backend URLs configured.");
        urls = ['http://127.0.0.1:5001'];
    }
    console.log("[Recording Proxy Util] Checking potential backend URLs:", urls);
    for (const baseUrl of urls) {
        const healthUrl = `${baseUrl}/api/health`;
        try {
            console.log(`[Recording Proxy Util] Pinging ${healthUrl}...`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            const response = await fetch(healthUrl, { method: 'GET', signal: controller.signal });
            clearTimeout(timeoutId);
            if (response.ok) {
                console.log(`[Recording Proxy Util] Success: ${baseUrl} is active.`);
                return baseUrl;
            } else {
                console.warn(`[Recording Proxy Util] ${baseUrl} responded with status ${response.status}`);
            }
        } catch (error: any) {
             if (error.name === 'AbortError') {
                 console.warn(`[Recording Proxy Util] Timeout connecting to ${healthUrl}`);
             } else {
                 console.warn(`[Recording Proxy Util] Error connecting to ${healthUrl}: ${error.message}`);
             }
        }
    }
    console.error("[Recording Proxy Util] No active backend found among:", urls);
    return null;
}

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

    const activeBackendUrl = await findActiveBackend(POTENTIAL_BACKEND_URLS);
    if (!activeBackendUrl) {
        return formatErrorResponse("Could not connect to backend for recording status.", 503);
    }

    const targetUrl = `${activeBackendUrl}/api/recording/status`;
    console.log(`[API /api/recording-proxy] Forwarding GET to ${targetUrl}`);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const backendResponse = await fetch(targetUrl, { method: 'GET', signal: controller.signal });
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

    const activeBackendUrl = await findActiveBackend(POTENTIAL_BACKEND_URLS);
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

        const backendResponse = await fetch(targetUrl, {
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
