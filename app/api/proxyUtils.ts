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
    // Always fetch authenticated user from Auth server (secure)
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;
    // Then fetch session only to extract an access token for backend calls
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || '';
    return { user, token };
}

/**
 * Finds the first active backend URL from a list by checking its /healthz endpoint concurrently.
 * In development: Fast-fail health check (500ms timeout, returns immediately on first success)
 * In production: Skips health check entirely, returns first URL
 * @param urls List of potential base URLs for the backend.
 * @returns The first active base URL found (respecting the original list's priority), or null if none respond successfully.
 */
export async function findActiveBackend(urls: string[]): Promise<string | null> {
    if (!urls || urls.length === 0) {
        console.error("[Proxy Util] CRITICAL: No backend URLs were provided to findActiveBackend. This usually means BACKEND_API_URLS is missing, empty, or contains only whitespace in the environment configuration. Cannot proceed to find an active backend.");
        return null;
    }

    // PRODUCTION MODE: Skip health check, use first URL (should be production URL)
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction) {
        console.log("[Proxy Util] Production mode: Using first backend URL without health check:", urls[0]);
        return urls[0];
    }

    // DEVELOPMENT MODE: Fast-fail health check with race condition
    console.log("[Proxy Util] Development mode: Checking backends with 500ms timeout each");

    // Try backends sequentially with fast timeout
    for (const url of urls) {
        try {
            const healthUrl = `${url}/healthz`;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 500); // 500ms timeout (was 5000ms)

            const response = await fetch(healthUrl, {
                method: 'GET',
                signal: controller.signal
            }).finally(() => clearTimeout(timeoutId));

            if (response.ok) {
                console.log(`[Proxy Util] Success: ${url} is active`);
                return url;
            }
        } catch (error: any) {
            const reason = error.name === 'AbortError' ? 'Timeout (500ms)' : error.message;
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

// A new function to get the backend URL with shared promise for concurrent requests
let _backendCache: { url: string | null; ts: number } = { url: null, ts: 0 };
let _pendingHealthCheck: Promise<string | null> | null = null;
const BACKEND_CACHE_TTL_MS = 90_000; // 90 seconds

export async function getBackendUrl(): Promise<string | null> {
    const backendUrls = (process.env.BACKEND_API_URLS || '').split(',').map(url => url.trim()).filter(Boolean);
    const now = Date.now();

    // Return cached URL if still valid
    if (_backendCache.url && (now - _backendCache.ts) < BACKEND_CACHE_TTL_MS) {
        return _backendCache.url;
    }

    // If health check already in progress, wait for it instead of starting a new one
    if (_pendingHealthCheck) {
        return _pendingHealthCheck;
    }

    // Start new health check and cache the promise
    _pendingHealthCheck = findActiveBackend(backendUrls).then(url => {
        if (url) {
            _backendCache = { url, ts: Date.now() };
        }
        _pendingHealthCheck = null;
        return url;
    }).catch(err => {
        _pendingHealthCheck = null;
        throw err;
    });

    return _pendingHealthCheck;
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
