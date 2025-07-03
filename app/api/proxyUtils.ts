import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function getSupabaseUser(request: Request) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name: string) {
                    return cookieStore.get(name)?.value;
                },
            },
        }
    );
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        return { user: session.user, token: session.access_token };
    }
    return null;
}

/**
 * Finds the first active backend URL from a list by checking its /api/health endpoint concurrently.
 * @param urls List of potential base URLs for the backend.
 * @returns The first active base URL found (respecting the original list's priority), or null if none respond successfully.
 */
export async function findActiveBackend(urls: string[]): Promise<string | null> {
    if (!urls || urls.length === 0) {
        // This case implies that the `POTENTIAL_BACKEND_URLS` array, formed from `process.env.NEXT_PUBLIC_BACKEND_API_URLS`,
        // was empty *after* splitting, trimming, and filtering. This strongly suggests the env var is missing or misconfigured.
        console.error("[Proxy Util] CRITICAL: No backend URLs were provided to findActiveBackend. This usually means NEXT_PUBLIC_BACKEND_API_URLS is missing, empty, or contains only whitespace in the environment configuration. Cannot proceed to find an active backend.");
        return null; // Explicitly return null, no fallback to localhost.
    }
    console.log("[Proxy Util] Checking potential backend URLs concurrently:", urls);

    const healthCheckPromises = urls.map(baseUrl => {
        const healthUrl = `${baseUrl}/api/health`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
        }, 1500); // Reduced timeout to 1.5s for faster failure detection

        return fetch(healthUrl, { method: 'GET', signal: controller.signal })
            .finally(() => clearTimeout(timeoutId));
    });

    const results = await Promise.allSettled(healthCheckPromises);

    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const url = urls[i];

        if (result.status === 'fulfilled' && result.value.ok) {
            console.log(`[Proxy Util] Success: ${url} is active.`);
            return url;
        } else {
            let reason = "Unknown error";
            if (result.status === 'fulfilled') {
                reason = `Status ${result.value.status}`;
            } else if (result.reason) {
                // @ts-ignore
                reason = result.reason.name === 'AbortError' ? 'Timeout' : result.reason.message;
            }
            console.warn(`[Proxy Util] Health check failed for ${url}: ${reason}`);
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
