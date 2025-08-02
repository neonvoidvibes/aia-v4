import { type NextRequest, NextResponse } from 'next/server';
import { getSupabaseUser } from '../proxyUtils';

// Default Voice ID for "Rachel" on ElevenLabs - a known good fallback.
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

export const maxDuration = 300; // Allow up to 5 minutes for TTS generation to handle longer texts

export async function GET(req: NextRequest) {
  try {
    // Auth check can be lighter for GET requests if needed, but we'll keep it for now
    const userSession = await getSupabaseUser(req);
    if (!userSession) {
      return new NextResponse(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const text = searchParams.get('text');
    const voiceId = searchParams.get('voiceId');

    if (!text) {
      return new NextResponse(JSON.stringify({ error: 'Text is required' }), { status: 400 });
    }

    const selectedVoiceId = voiceId || DEFAULT_VOICE_ID;

    const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
    if (!elevenLabsApiKey) {
      return new NextResponse(JSON.stringify({ error: 'TTS service is not configured' }), { status: 500 });
    }

    const ttsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}/stream`;

    const response = await fetch(ttsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': elevenLabsApiKey,
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.json();
      console.error("ElevenLabs API Error:", errorBody);
      return new NextResponse(JSON.stringify(errorBody), { status: response.status });
    }

    // The response body is a direct audio stream. We can pipe it to our client.
    return new Response(response.body, {
      headers: {
        'Content-Type': 'audio/mpeg',
      },
    });

  } catch (error) {
    console.error("TTS Proxy Error:", error);
    return new NextResponse(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
  }
}
