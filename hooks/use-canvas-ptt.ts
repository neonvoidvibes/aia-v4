/**
 * useCanvasPTT Hook
 *
 * Simplified PTT recording for Canvas view.
 * Handles: Audio Recording → Transcription → Return transcript text
 */

import { useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';

export type PTTStatus = 'idle' | 'recording' | 'processing' | 'error';

export interface UseCanvasPTTOptions {
  agentName: string;
  onTranscriptReady?: (transcript: string) => void;
  onError?: (error: string) => void;
}

export interface UseCanvasPTTReturn {
  status: PTTStatus;
  isRecording: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string | null>;
  error: string | null;
}

export function useCanvasPTT({
  agentName,
  onTranscriptReady,
  onError,
}: UseCanvasPTTOptions): UseCanvasPTTReturn {
  const [status, setStatus] = useState<PTTStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const webSocketRef = useRef<WebSocket | null>(null);

  const cleanup = useCallback(() => {
    // Stop media recorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    // Close WebSocket
    if (webSocketRef.current) {
      webSocketRef.current.close();
      webSocketRef.current = null;
    }

    // Stop audio stream
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
      audioStreamRef.current = null;
    }

    sessionIdRef.current = null;
  }, []);

  const startRecording = useCallback(async () => {
    if (!agentName) {
      const errorMsg = 'Agent not selected';
      setError(errorMsg);
      setStatus('error');
      onError?.(errorMsg);
      return;
    }

    try {
      setStatus('recording');
      setError(null);

      // Start recording session
      const response = await fetch('/api/audio-recording-proxy?action=start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          agent: agentName,
          transcriptionLanguage: 'any',
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to start recording');
      }

      sessionIdRef.current = data.session_id;

      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;

      // Setup media recorder
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;

      // Get auth token
      const { createClient } = await import('@/utils/supabase/client');
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        throw new Error('Authentication error');
      }

      // Setup WebSocket
      const wsUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL;
      if (!wsUrl) {
        throw new Error('WebSocket URL not configured');
      }

      const webSocket = new WebSocket(
        `${wsUrl}/ws/audio_stream/${sessionIdRef.current}?token=${session.access_token}`
      );
      webSocketRef.current = webSocket;

      webSocket.onopen = () => {
        mediaRecorder.start(1000); // Send chunks every 1 second for responsiveness
      };

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && webSocket.readyState === WebSocket.OPEN) {
          webSocket.send(event.data);
        }
      };

      webSocket.onerror = (event) => {
        console.error('WebSocket error:', event);
        const errorMsg = 'Connection error during recording';
        setError(errorMsg);
        setStatus('error');
        onError?.(errorMsg);
        cleanup();
      };

    } catch (err: any) {
      console.error('Error starting recording:', err);
      const errorMsg = err.message || 'Failed to start recording';
      setError(errorMsg);
      setStatus('error');
      onError?.(errorMsg);
      cleanup();
    }
  }, [agentName, onError, cleanup]);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    if (!sessionIdRef.current) {
      console.warn('No active session to stop');
      return null;
    }

    try {
      setStatus('processing');

      // Stop media recorder
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }

      // Send stop signal via WebSocket
      if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
        webSocketRef.current.send(JSON.stringify({ action: 'stop_stream' }));
      }

      // Small delay to ensure last chunks are sent
      await new Promise(resolve => setTimeout(resolve, 500));

      // Stop session and get transcript
      const response = await fetch('/api/audio-recording-proxy?action=stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ session_id: sessionIdRef.current }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to stop recording');
      }

      cleanup();

      // Get transcript from S3
      const s3Key = data.s3Key;
      if (!s3Key) {
        throw new Error('No transcript key returned');
      }

      // Fetch transcript content
      const transcriptResponse = await fetch(`/api/s3/object?key=${encodeURIComponent(s3Key)}`, {
        method: 'GET',
        credentials: 'include',
      });

      if (!transcriptResponse.ok) {
        throw new Error('Failed to fetch transcript');
      }

      const transcriptText = await transcriptResponse.text();

      setStatus('idle');
      onTranscriptReady?.(transcriptText);

      return transcriptText;

    } catch (err: any) {
      console.error('Error stopping recording:', err);
      const errorMsg = err.message || 'Failed to process recording';
      setError(errorMsg);
      setStatus('error');
      onError?.(errorMsg);
      cleanup();
      return null;
    }
  }, [onTranscriptReady, onError, cleanup]);

  return {
    status,
    isRecording: status === 'recording',
    startRecording,
    stopRecording,
    error,
  };
}
