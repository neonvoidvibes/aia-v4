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
    const agentName = formData.get('agent_name') as string | null; // Extract agent_name

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
    if (agentName) { // Add agent_name to the backend form data
      backendFormData.append('agent_name', agentName);
      console.log(`[API /api/transcribe-audio] Forwarding agent_name: ${agentName} to Python backend.`);
    } else {
      console.warn("[API /api/transcribe-audio] agent_name not received from client, not forwarding to Python backend.");
    }

    const { data: { session } } = await supabase.auth.getSession();
    const backendHeaders: HeadersInit = {};
    // Content-Type for FormData is set automatically by fetch
    if (session?.access_token) {
      backendHeaders['Authorization'] = `Bearer ${session.access_token}`;
    } else {
      console.error("[API /api/transcribe-audio] Critical: Server-side session valid but access token missing.");
      return formatErrorResponse("Internal Server Error: Failed to retrieve auth token", 500);
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 900000); // 15 minute timeout for large files
    
    const backendResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: backendHeaders,
      body: backendFormData,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    console.log(`[API /api/transcribe-audio] Backend response status: ${backendResponse.status}`);

    const responseText = await backendResponse.text(); // Get text first for robust error handling
    let responseData: any;

    try {
        responseData = JSON.parse(responseText);
        // Log a summary instead of the full data to avoid spamming logs
        const summaryForLog = {
          transcript_length: responseData.transcript?.length,
          segment_count: responseData.segments?.length,
          ...(responseData.error && { error: responseData.error }),
        };
        console.log("[API /api/transcribe-audio] Parsed responseData from Python:", JSON.stringify(summaryForLog, null, 2));
    } catch (err) {
        console.error("[API /api/transcribe-audio] Error parsing JSON from backend. Raw text:", responseText.substring(0, 500));
        // If parsing fails, but response was ok, it might be an unexpected success format or an error string.
        // If not ok, it's definitely an error.
        if (!backendResponse.ok) {
            return formatErrorResponse(`Backend error (${backendResponse.status}): ${responseText.substring(0, 200) || 'Unparseable error response'}`, backendResponse.status);
        }
        // If it was OK status but not JSON, that's an issue.
        return formatErrorResponse("Backend returned non-JSON success response.", 502); // Bad Gateway
    }


    if (!backendResponse.ok) {
      const errorMsg = responseData?.error || responseData?.message || responseData?.details || `Backend error (${backendResponse.status})`;
      console.error(`[API /api/transcribe-audio] Python backend error: ${backendResponse.status}`, errorMsg, "Full responseData:", responseData);
      return formatErrorResponse(errorMsg, backendResponse.status);
    }
    
    // Check for presence of transcript and segments; segments can be an empty array
    if (responseData && responseData.transcript !== undefined && responseData.segments !== undefined) {
      console.log(`[API /api/transcribe-audio] Transcription successful. Transcript length: ${responseData.transcript?.length || 0}, Segments count: ${responseData.segments?.length || 0}`);
      return NextResponse.json({ transcript: responseData.transcript, segments: responseData.segments });
    } else {
      const errorDetail = responseData?.error || "Transcript and/or segments data missing in backend response.";
      console.error("[API /api/transcribe-audio] Backend responded OK but transcript/segments missing/invalid in response:", responseData);
      return formatErrorResponse(errorDetail, 500);
    }

  } catch (error: any) {
    console.error("[API /api/transcribe-audio] Error in POST handler:", error);
    let message = error.message || 'An internal server error occurred during transcription.';
    let statusCode = 500;
    
    // Handle timeout errors
    if (error.name === 'AbortError') {
      message = "Transcription request timed out. This may be due to network issues or a very large file.";
      statusCode = 504; // Gateway timeout
    }
    // Handle network errors
    else if (error.name === 'TypeError' && error.message.includes('NetworkError')) {
      message = "Network error connecting to the transcription service.";
      statusCode = 503; // Service unavailable
    }
    // Handle connection errors
    else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      message = "Unable to connect to transcription service. Please try again later.";
      statusCode = 503;
    }
    // Catch specific body parsing errors for FormData
    else if (error.message && (error.message.includes("Could not parse content as FormData") || error.message.includes("Invalid input"))) {
      message = "Failed to process uploaded file. Please ensure it's a valid audio file.";
      statusCode = 400;
    }
    
    return formatErrorResponse(message, statusCode);
  }
}
