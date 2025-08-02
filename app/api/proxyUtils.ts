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
        // This case implies that the `POTENTIAL_BACKEND_URLS` array, formed from `process.env.BACKEND_API_URLS`,
        // was empty *after* splitting, trimming, and filtering. This strongly suggests the env var is missing or misconfigured.
        console.error("[Proxy Util] CRITICAL: No backend URLs were provided to findActiveBackend. This usually means BACKEND_API_URLS is missing, empty, or contains only whitespace in the environment configuration. Cannot proceed to find an active backend.");
        return null;
    }
    // This log was causing EPIPE errors with pino-pretty.
    // We are replacing all console.log with a proper logger, but since the logger
    // is not available in this utility file, we will comment it out for now.
    // A more advanced solution would involve passing the logger instance.
    // console.log("[Proxy Util] Checking potential backend URLs concurrently:", urls);

    const healthCheckPromises = urls.map(baseUrl => {
        const healthUrl = `${baseUrl}/api/health`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
        }, 30000); // Increased timeout to 30s to allow for cold starts on services like Render

        return fetch(healthUrl, { method: 'GET', signal: controller.signal })
            .finally(() => clearTimeout(timeoutId));
    });

    const results = await Promise.allSettled(healthCheckPromises);

    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const url = urls[i];
 
        if (result.status === 'fulfilled' && result.value.ok) {
            // This log was also causing EPIPE errors.
            // console.log(`[Proxy Util] Success: ${url} is active.`);
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
 * @returns A string formatted for Vercel AI SDK v3 error handling.
 */
export function formatErrorChunk(errorMsg: string): string {
     // The AI SDK v3 expects an error chunk to be prefixed with '1:'
     return `1:${JSON.stringify({ error: errorMsg })}\n`;
 }

// Add formatTextChunk if needed by other proxy routes, though it's chat-specific
// export function formatTextChunk(text: string): string { ... }

// A new function to get the backend URL
export async function getBackendUrl(): Promise<string | null> {
    const backendUrls = (process.env.BACKEND_API_URLS || '').split(',').map(url => url.trim()).filter(Boolean);
    return findActiveBackend(backendUrls);
}

interface ProxyApiRouteRequestParams {
  request: Request;
  targetUrl: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: any;
}

export async function proxyApiRouteRequest({
  request,
  targetUrl,
  method = 'POST',
  body,
}: ProxyApiRouteRequestParams): Promise<NextResponse> {
  try {
    const userSession = await getSupabaseUser(request);
    if (!userSession) {
      return formatErrorResponse('Authentication failed', 401);
    }

    const requestBody = body ?? (await request.json().catch(() => ({})));

    const response = await fetch(targetUrl, {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userSession.token}`,
      },
      body: method !== 'GET' ? JSON.stringify(requestBody) : undefined,
    });

    const data = await response.json();

    if (!response.ok) {
      return formatErrorResponse(data.error || data.message || 'An error occurred', response.status);
    }

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return formatErrorResponse(errorMessage, 500);
  }
}
