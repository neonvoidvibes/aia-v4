import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { findActiveBackend, formatErrorResponse } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export async function DELETE(req: NextRequest) {
    console.log('[API /chat/history/delete] Received DELETE request');
    const supabase = await createServerActionClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        console.error('[API /chat/history/delete] Unauthorized access attempt.');
        return formatErrorResponse('Unauthorized', 401);
    }

    const { chatId } = await req.json();
    console.log(`[API /chat/history/delete] Processing conversation deletion for chatId: ${chatId}`);

    if (!chatId) {
        return formatErrorResponse('chatId is required', 400);
    }

    try {
        const activeBackendUrl = await findActiveBackend(POTENTIAL_BACKEND_URLS);
        if (!activeBackendUrl) {
          console.error('[API /chat/history/delete] No active backend found.');
          return formatErrorResponse("Could not connect to backend for conversation deletion.", 503);
        }

        const targetUrl = `${activeBackendUrl}/api/chat/history/delete_conversation`;
        console.log(`[API /chat/history/delete] Forwarding request to backend: ${targetUrl}`);
        
        const { data: { session } } = await supabase.auth.getSession();
        const headers: HeadersInit = {
            'Content-Type': 'application/json',
        };
        if (session?.access_token) {
            headers['Authorization'] = `Bearer ${session.access_token}`;
        }

        const backendResponse = await fetch(targetUrl, {
            method: 'POST', // The new backend endpoint expects POST
            headers: headers,
            body: JSON.stringify({
                user_id: user.id,
                chat_id: chatId,
            }),
        });

        if (!backendResponse.ok) {
            const errorBody = await backendResponse.text().catch(() => `Status ${backendResponse.statusText}`);
            console.error(`[API /chat/history/delete] Backend error: ${backendResponse.status}`, errorBody);
            return formatErrorResponse(`Backend error for conversation deletion (${backendResponse.status}): ${errorBody || backendResponse.statusText}`, backendResponse.status);
        }

        const result = await backendResponse.json();
        console.log('[API /chat/history/delete] Successfully received response from backend:', result);
        return NextResponse.json({ success: true, ...result });

    } catch (error: any) {
        console.error('[API /chat/history/delete] Error deleting conversation:', error);
        return formatErrorResponse(error.message || 'An internal error occurred', 500);
    }
}

export async function POST(req: NextRequest) {
    console.log('[API /chat/history/delete] Received POST request for message deletion');
    const supabase = await createServerActionClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        console.error('[API /chat/history/delete] Unauthorized access attempt.');
        return formatErrorResponse('Unauthorized', 401);
    }

    const { chatId, messageId } = await req.json();
    console.log(`[API /chat/history/delete] Processing message deletion for chatId: ${chatId}, messageId: ${messageId}`);

    if (!chatId || !messageId) {
        return formatErrorResponse('chatId and messageId are required', 400);
    }

    try {
        const activeBackendUrl = await findActiveBackend(POTENTIAL_BACKEND_URLS);
        if (!activeBackendUrl) {
          console.error('[API /chat/history/delete] No active backend found.');
          return formatErrorResponse("Could not connect to backend for message deletion.", 503);
        }

        const targetUrl = `${activeBackendUrl}/delete_message`;
        console.log(`[API /chat/history/delete] Forwarding request to backend: ${targetUrl}`);
        
        const { data: { session } } = await supabase.auth.getSession();
        const headers: HeadersInit = {
            'Content-Type': 'application/json',
        };
        if (session?.access_token) {
            headers['Authorization'] = `Bearer ${session.access_token}`;
        }

        const backendResponse = await fetch(targetUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                user_id: user.id,
                chat_id: chatId,
                message_id: messageId,
            }),
        });

        if (!backendResponse.ok) {
            const errorBody = await backendResponse.text().catch(() => `Status ${backendResponse.statusText}`);
            console.error(`[API /chat/history/delete] Backend error: ${backendResponse.status}`, errorBody);
            return formatErrorResponse(`Backend error for message deletion (${backendResponse.status}): ${errorBody || backendResponse.statusText}`, backendResponse.status);
        }

        const result = await backendResponse.json();
        console.log('[API /chat/history/delete] Successfully received response from backend:', result);
        return NextResponse.json({ success: true, ...result });

    } catch (error: any) {
        console.error('[API /chat/history/delete] Error deleting message:', error);
        return formatErrorResponse(error.message || 'An internal error occurred', 500);
    }
}
