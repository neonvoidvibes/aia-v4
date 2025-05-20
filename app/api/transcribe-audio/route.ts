import { type NextRequest, NextResponse } from 'next/server';
import { createServerActionClient } from '@/utils/supabase/server';
import { findActiveBackend, formatErrorResponse } from '@/app/api/proxyUtils';

const BACKEND_API_URLS_STRING = process.env.NEXT_PUBLIC_BACKEND_API_URLS || 'http://127.0.0.1:5001';
const POTENTIAL_BACKEND_URLS = BACKEND_API_URLS_STRING.split(',').map(url => url.trim()).filter(url => url);

export const maxDuration = 300; // Max duration 5 minutes for Vercel Hobby

export async function POST(req: NextRequest) {
  console.log("[API /api/transcribe-audio] Received POST request");
  const supabase = await createServerActionClient();

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.warn("[API /api/transcribe-audio] Unauthorized request:", authError?.message);
      return formatErrorResponse("Unauthorized: Invalid session", 401);
    }
    console.log(`[API /api/transcribe-audio] Authenticated user: ${user.id}`);

    const formData = await req.formData();
    const audioFile = formData.get('audio_file') as File | null;

    if (!audioFile) {
      return formatErrorResponse("No audio file provided in the request.", 400);
    }
    console.log(`[API /api/transcribe-audio] Received file: ${audioFile.name}, size: ${audioFile.size}, type: ${audioFile.type}`);

    const activeBackendUrl = await findActiveBackend(POTENTIAL_BACKEND_URLS);
    if (!activeBackendUrl) {
      return formatErrorResponse("Could not connect to backend for audio transcription.", 503);
    }

    const targetUrl = `${activeBackendUrl}/internal_api/transcribe_file`;
    console.log(`[API /api/transcribe-audio] Forwarding POST to Python backend: ${targetUrl}`);

    const backendFormData = new FormData();
    // Ensure the file name is passed correctly for Flask's secure_filename
    backendFormData.append('audio_file', audioFile, audioFile.name);

    const { data: { session } } = await supabase.auth.getSession();
    const backendHeaders: HeadersInit = {};
    // Content-Type for FormData is set automatically by fetch
    if (session?.access_token) {
      backendHeaders['Authorization'] = `Bearer ${session.access_token}`;
    } else {
      console.error("[API /api/transcribe-audio] Critical: Server-side session valid but access token missing.");
      return formatErrorResponse("Internal Server Error: Failed to retrieve auth token", 500);
    }
    
    const backendResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: backendHeaders,
      body: backendFormData,
    });

    const responseData = await backendResponse.json().catch((err) => {
        console.error("[API /api/transcribe-audio] Error parsing JSON from backend:", err);
        return { error: "Backend returned non-JSON response or an error occurred parsing it." };
    });


    if (!backendResponse.ok) {
      const errorMsg = responseData?.error || responseData?.message || `Backend error (${backendResponse.status})`;
      console.error(`[API /api/transcribe-audio] Python backend error: ${backendResponse.status}`, errorMsg);
      return formatErrorResponse(errorMsg, backendResponse.status);
    }
    
    if (responseData && responseData.transcript !== undefined) {
      console.log(`[API /api/transcribe-audio] Transcription successful. Transcript length: ${responseData.transcript.length}`);
      return NextResponse.json({ transcript: responseData.transcript });
    } else {
      const errorDetail = responseData?.error || "Transcript data missing in backend response.";
      console.error("[API /api/transcribe-audio] Backend responded OK but transcript missing/invalid in response:", responseData);
      return formatErrorResponse(errorDetail, 500);
    }

  } catch (error: any) {
    console.error("[API /api/transcribe-audio] Error in POST handler:", error);
    let message = error.message || 'An internal server error occurred during transcription.';
    if (error.name === 'TypeError' && error.message.includes('NetworkError')) {
         message = "Network error connecting to the transcription service.";
         return formatErrorResponse(message, 503);
    }
    // Catch specific body parsing errors for FormData
    if (error.message && (error.message.includes("Could not parse content as FormData") || error.message.includes("Invalid input"))) {
        message = "Failed to process uploaded file. Please ensure it's a valid audio file.";
        return formatErrorResponse(message, 400);
    }
    return formatErrorResponse(message, 500);
  }
}