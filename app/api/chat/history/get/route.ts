import { type NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createServerActionClient } from '@/utils/supabase/server';
import { getBackendUrl, formatErrorResponse } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export async function GET(req: NextRequest) {
  console.log("[Chat History Get] Received GET request");
  const supabase = await createServerActionClient();

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.warn("[Chat History Get] Unauthorized request:", authError?.message);
      return formatErrorResponse("Unauthorized: Invalid session", 401);
    }
    console.log(`[Chat History Get] Authenticated user: ${user.id}`);

    const chatId = req.nextUrl.searchParams.get('chatId');
    if (!chatId) {
      return formatErrorResponse("Missing 'chatId' query parameter", 400);
    }

    const activeBackendUrl = await getBackendUrl();
    if (!activeBackendUrl) {
      return formatErrorResponse("Could not connect to backend for chat history.", 503);
    }

    const targetUrl = `${activeBackendUrl}/api/chat/history/get?chatId=${encodeURIComponent(chatId)}`;
    console.log(`[Chat History Get] Forwarding GET to ${targetUrl}`);

    const { data: { session } } = await supabase.auth.getSession();
    const backendHeaders: HeadersInit = {};
    if (session?.access_token) {
      backendHeaders['Authorization'] = `Bearer ${session.access_token}`;
    } else {
        console.error("[Chat History Get] Critical: Server-side session valid but access token missing.");
        return formatErrorResponse("Internal Server Error: Failed to retrieve auth token", 500);
    }

    const backendResponse = await fetch(targetUrl, { method: 'GET', headers: backendHeaders });

    if (!backendResponse.ok) {
      const errorBody = await backendResponse.text().catch(() => `Status ${backendResponse.statusText}`);
      console.error(`[Chat History Get] Backend error: ${backendResponse.status}`, errorBody);
      return formatErrorResponse(`Backend error for chat history get (${backendResponse.status}): ${errorBody || backendResponse.statusText}`, backendResponse.status);
    }

    const data = await backendResponse.json();

    // Compute a stable ETag from key fields (id, last_message_at, messages summary)
    const chatIdForHash = String(data?.id ?? chatId);
    const lastMessageAt = String(data?.last_message_at ?? data?.updatedAt ?? '');
    const messages = Array.isArray(data?.messages) ? data.messages : [];
    const lastMsgId = messages.length ? String(messages[messages.length - 1]?.id ?? '') : '';
    const lastMsgAt = messages.length ? String(messages[messages.length - 1]?.createdAt ?? '') : '';
    // Include saved state signals so clients refresh when bookmarks/conversation save changes
    const savedMessageIds = data?.savedMessageIds && typeof data.savedMessageIds === 'object' ? data.savedMessageIds : {};
    const savedCount = Object.keys(savedMessageIds).length;
    const lastSaveMarker = String(data?.last_message_id_at_save ?? '');
    const convoMemId = String(data?.conversationMemoryId ?? '');
    const payloadForHash = `${chatIdForHash}|${lastMessageAt}|${messages.length}|${lastMsgId}|${lastMsgAt}|saved:${savedCount}|marker:${lastSaveMarker}|mem:${convoMemId}`;
    const etag = 'W/"' + crypto.createHash('sha1').update(payloadForHash).digest('hex') + '"';

    const ifNoneMatch = req.headers.get('if-none-match');
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag } });
    }

    const res = NextResponse.json(data);
    res.headers.set('ETag', etag);
    res.headers.set('Cache-Control', 'private, no-store');
    return res;

  } catch (error: any) {
    console.error("[Chat History Get] Error in GET handler:", error);
    return formatErrorResponse(error.message || 'An internal server error occurred', 500);
  }
}
