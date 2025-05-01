import { NextResponse } from 'next/server';

/**
 * Finds the first active backend URL from a list by checking its /api/health endpoint.
 * @param urls List of potential base URLs for the backend.
 * @returns The first active base URL found, or null if none respond successfully.
 */
export async function findActiveBackend(urls: string[]): Promise<string | null> {
    if (!urls || urls.length === 0) {
        console.error("[Proxy Util] No backend URLs provided to findActiveBackend.");
        // Optionally return default or throw error based on requirements
        urls = ['http://127.0.0.1:5001']; // Fallback to localhost if empty
        // return null;
    }
    console.log("[Proxy Util] Checking potential backend URLs:", urls);

    for (const baseUrl of urls) {
        const healthUrl = `${baseUrl}/api/health`;
        try {
            console.log(`[Proxy Util] Pinging ${healthUrl}...`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000); // Short timeout

            const response = await fetch(healthUrl, { method: 'GET', signal: controller.signal });
            clearTimeout(timeoutId);

            if (response.ok) {
                console.log(`[Proxy Util] Success: ${baseUrl} is active.`);
                return baseUrl;
            } else {
                console.warn(`[Proxy Util] ${baseUrl} responded with status ${response.status}`);
            }
        } catch (error: any) {
             if (error.name === 'AbortError') {
                 console.warn(`[Proxy Util] Timeout connecting to ${healthUrl}`);
             } else {
                 console.warn(`[Proxy Util] Error connecting to ${healthUrl}: ${error.message}`);
             }
        }
    }

    console.error("[Proxy Util] No active backend found among:", urls);
    return null;
}

/**
 * Formats an error message into a standard JSON response for API routes.
 * @param message The error message string.
 * @param status The HTTP status code.
 * @returns A NextResponse object with the formatted error.
 */
export function formatErrorResponse(message: string, status: number): NextResponse {
    return NextResponse.json({ status: "error", message: message }, { status: status });
}

/**
 * Formats an error message for the Vercel AI SDK stream protocol.
 * @param errorMsg The error message string.
 * @returns A string formatted as '2:"error message"\n'.
 */
export function formatErrorChunk(errorMsg: string): string {
     return `2:${JSON.stringify(errorMsg)}\n`;
 }

// Add formatTextChunk if needed by other proxy routes, though it's chat-specific
// export function formatTextChunk(text: string): string { ... }