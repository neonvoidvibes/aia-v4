import { type NextRequest, NextResponse } from 'next/server';

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


// Route handler for POST (for actions like start, stop, pause, resume)
export async function POST(req: NextRequest) {
    console.log("[API /api/recording-proxy] Received POST request");

    let action: string | undefined;
    let payload: any = {};
    try {
        const body = await req.json();
        action = body?.action; // Expect 'action' in the body
        payload = body?.payload || {}; // Optional payload for 'start'
        if (!action || !['start', 'stop', 'pause', 'resume'].includes(action)) { // Add 'resume' to valid actions
            return formatErrorResponse("Missing or invalid 'action' in request body (start, stop, pause, resume)", 400);
        }
    } catch (e) {
        return formatErrorResponse("Invalid JSON request body", 400);
    }

    console.log(`[API /api/recording-proxy] Action requested: ${action}`);

    const activeBackendUrl = await findActiveBackend(POTENTIAL_BACKEND_URLS);
    if (!activeBackendUrl) {
        return formatErrorResponse(`Could not connect to backend for action: ${action}.`, 503);
    }

    const targetUrl = `${activeBackendUrl}/api/recording/${action}`; // Construct target URL dynamically
    console.log(`[API /api/recording-proxy] Forwarding POST to ${targetUrl}`);

    try {
        const backendResponse = await fetch(targetUrl, {
            method: 'POST',
            // Send Content-Type and body only for 'start' action which requires agent/event payload
            headers: action === 'start' ? { 'Content-Type': 'application/json' } : undefined,
            // Only 'start' sends a body, other actions (stop, pause, resume) don't need one
            body: action === 'start' ? JSON.stringify(payload) : undefined
        });

        // Check Content-Type and status before assuming JSON
        const contentType = backendResponse.headers.get("content-type");
        let responseData;

        if (backendResponse.ok && contentType && contentType.includes("application/json")) {
             try {
                responseData = await backendResponse.json();
             } catch (jsonError: any) {
                 console.error(`[API /api/recording-proxy] Action '${action}' JSON parse error: ${jsonError.message}`);
                 return formatErrorResponse(`Backend returned invalid JSON for action '${action}'`, 500);
             }
        } else if (backendResponse.ok) {
             const textResponse = await backendResponse.text().catch(() => "Could not read response text");
             console.warn(`[API /api/recording-proxy] Action '${action}' backend returned OK but non-JSON: ${contentType}`);
             return formatErrorResponse(`Backend returned unexpected format for action '${action}'`, 502);
        } else {
             const errorText = await backendResponse.text().catch(() => `Status ${backendResponse.statusText}`);
             console.error(`[API /api/recording-proxy] Action '${action}' backend error: ${backendResponse.status}`, errorText);
             // Attempt to parse potential JSON error from backend
             if (contentType && contentType.includes("application/json")) {
                 try { responseData = JSON.parse(errorText); } catch { responseData = { message: errorText }; }
             } else {
                 responseData = { message: errorText };
             }
             return NextResponse.json(responseData, { status: backendResponse.status });
        }

        // If we got here, response was OK and JSON parsed
        console.log(`[API /api/recording-proxy] Action '${action}' success:`, responseData);
        return NextResponse.json(responseData);

    } catch (error: any) {
        console.error(`[API /api/recording-proxy] Fetch error for action '${action}': ${error.message}`, error);
        return formatErrorResponse(`Failed to perform recording action '${action}': ${error.message}`, 500);
    }
}