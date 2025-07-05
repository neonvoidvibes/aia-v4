import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { findActiveBackend, formatErrorResponse } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export async function POST(req: NextRequest) {
    const supabase = await createServerActionClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return formatErrorResponse('Unauthorized', 401);
    }

    const { chatId, messageId } = await req.json();

    if (!chatId || !messageId) {
        return formatErrorResponse('chatId and messageId are required', 400);
    }

    try {
        const activeBackendUrl = await findActiveBackend(POTENTIAL_BACKEND_URLS);
        if (!activeBackendUrl) {
          return formatErrorResponse("Could not connect to backend for message deletion.", 503);
        }

        const targetUrl = `${activeBackendUrl}/delete_message`;
        
        const backendResponse = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // This endpoint is called from the server, so we can use a server-to-server auth key if needed
                // For now, we rely on Supabase user context passed in the body
            },
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
        return NextResponse.json({ success: true, ...result });

    } catch (error: any) {
        console.error('[API /chat/history/delete] Error deleting message:', error);
        return formatErrorResponse(error.message || 'An internal error occurred', 500);
    }
}
