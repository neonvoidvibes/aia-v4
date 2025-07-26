import { type NextRequest, NextResponse } from 'next/server';
import { getSupabaseUser } from '../proxyUtils';

// Default Voice ID for "Rachel" on ElevenLabs - a known good fallback.
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

export const maxDuration = 60; // Allow up to 60 seconds for TTS generation

export async function POST(req: NextRequest) {
  try {
    const userSession = await getSupabaseUser(req);
    if (!userSession) {
      return new NextResponse(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const { text, voiceId } = await req.json();
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
    // NextResponse.json() is not needed here; we return a Response with the stream.
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
