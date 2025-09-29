import { useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { useSilentChunkDetector } from '@/hooks/use-silent-chunk-detector';
import { HEARTBEAT_INTERVAL_MS, PONG_TIMEOUT_MS, MAX_HEARTBEAT_MISSES } from '@/lib/wsPolicy';
import { getClientTimezone } from '@/lib/timezone';

type UseRecordingProps = {
  agentName: string | null;
  onRecordingStopped: (recording: any) => void;
};

export function useRecording({ agentName, onRecordingStopped }: UseRecordingProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  // keep ref in sync
  isPausedRef.current = isPaused;
  const [isStopping, setIsStopping] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const webSocketRef = useRef<WebSocket | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pongTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatMissesRef = useRef(0);

  // Silent-chunk detection: 10s window, 30s toast cooldown, ignore first chunk
  const { onChunkBoundary, resetDetector } = useSilentChunkDetector({
    stream: audioStream,
    isActive: isRecording && !isPaused,
    windowMs: 10_000,
    cooldownMs: 30_000,
    levelThreshold: 0.02,
    ignoreInitialChunks: 1,
    message: 'No audio detected. Check your mic/input settings.',
  });

  const startRecording = useCallback(async () => {
    if (!agentName) {
      toast.error("Agent not selected. Cannot start recording.");
      return;
    }

    try {
      const payload: Record<string, unknown> = {
        agent: agentName,
        transcriptionLanguage: 'any',
      };

      const clientTimezone = getClientTimezone();
      if (clientTimezone) {
        payload.clientTimezone = clientTimezone;
      }

      const response = await fetch('/api/audio-recording-proxy?action=start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (response.ok) {
        const newSessionId = data.session_id;
        setSessionId(newSessionId);
        setIsRecording(true);
        setIsPaused(false);
        await setupMediaRecorder(newSessionId);
        toast.success("Recording started.");
      } else {
        throw new Error(data.message || "Failed to start recording.");
      }
    } catch (error) {
      console.error("Error starting recording:", error);
      toast.error((error as Error).message);
    }
  }, [agentName]);

  const setupMediaRecorder = async (sessionId: string) => {
    try {
      const { createClient } = await import('@/utils/supabase/client');
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        toast.error("Authentication error. Cannot start recording.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setAudioStream(stream);
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;

      const wsUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL;
      if (!wsUrl) {
        toast.error("WebSocket URL is not configured. Cannot start recording.");
        return;
      }
      const webSocket = new WebSocket(`${wsUrl}/ws/audio_stream/${sessionId}?token=${session.access_token}`);
      webSocketRef.current = webSocket;

      webSocket.onopen = () => {
        // Start WS keepalive ping/pong
        if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
        if (pongTimeoutRef.current) clearTimeout(pongTimeoutRef.current);
        heartbeatMissesRef.current = 0;
        heartbeatIntervalRef.current = setInterval(() => {
          if (!webSocketRef.current || webSocketRef.current.readyState !== WebSocket.OPEN) return;
          try {
            webSocketRef.current.send(JSON.stringify({ action: 'ping' }));
            if (pongTimeoutRef.current) clearTimeout(pongTimeoutRef.current);
            pongTimeoutRef.current = setTimeout(() => {
              heartbeatMissesRef.current++;
              if (heartbeatMissesRef.current >= (MAX_HEARTBEAT_MISSES || 3)) {
                try { webSocketRef.current?.close(1000, 'Heartbeat timeout'); } catch {}
              }
            }, PONG_TIMEOUT_MS || 5000);
          } catch {}
        }, HEARTBEAT_INTERVAL_MS || 15000);

        mediaRecorder.start(3000); // Send data every 3 seconds
      };

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && webSocket.readyState === WebSocket.OPEN) {
          webSocket.send(event.data);
        }
        onChunkBoundary();
      };

      webSocket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg?.type === 'pong') {
            if (pongTimeoutRef.current) clearTimeout(pongTimeoutRef.current);
            heartbeatMissesRef.current = 0;
          }
        } catch {
          /* ignore non-JSON */
        }
      };

      webSocket.onclose = async () => {
        if (heartbeatIntervalRef.current) { clearInterval(heartbeatIntervalRef.current); heartbeatIntervalRef.current = null; }
        if (pongTimeoutRef.current) { clearTimeout(pongTimeoutRef.current); pongTimeoutRef.current = null; }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
        // If closed while paused, do not finalize the session immediately; allow resume-driven reconnect
        if (isPausedRef.current) {
          // Leave sessionId in state; UI remains paused; reconnection will occur on resume
          webSocketRef.current = null;
          toast.message('Connection lost during pause. Will reconnect on resume.');
          return;
        }
        await performStopRecording(sessionId);
      };

      webSocket.onerror = (event) => {
        console.error("WebSocket error:", event);
        toast.error("A WebSocket connection error occurred.");
        stopRecording();
      };

    } catch (error) {
      console.error("Error setting up media recorder:", error);
      toast.error("Could not start recording. Please check microphone permissions.");
    }
  };

  const stopRecording = useCallback(async () => {
    if (!sessionId || isStopping) return;

    setIsStopping(true);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
      setTimeout(() => {
        if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
          webSocketRef.current.send(JSON.stringify({ action: 'stop_stream' }));
        }
      }, 100);
    } else {
      await performStopRecording(sessionId);
    }
  }, [sessionId, isStopping]);

  const performStopRecording = async (sessionId: string) => {
    try {
      if (heartbeatIntervalRef.current) { clearInterval(heartbeatIntervalRef.current); heartbeatIntervalRef.current = null; }
      if (pongTimeoutRef.current) { clearTimeout(pongTimeoutRef.current); pongTimeoutRef.current = null; }
      const response = await fetch('/api/audio-recording-proxy?action=stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = await response.json();
      if (response.ok) {
        onRecordingStopped(data);
        toast.success("Recording stopped and saved.");
      } else {
        throw new Error(data.message || "Failed to stop recording.");
      }
    } catch (error) {
      console.error("Error stopping recording:", error);
      toast.error((error as Error).message);
    } finally {
      setIsRecording(false);
      setIsPaused(false);
      setIsStopping(false);
      setSessionId(null);
      setAudioStream(null);
      resetDetector();
    }
  };

  return {
    isRecording,
    isPaused,
    isStopping,
    startRecording,
    stopRecording,
    togglePause: () => {
      const next = !isPaused;
      setIsPaused(next);
      try {
        const ws = webSocketRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'set_processing_state', paused: next }));
        } else if (!next && sessionId) {
          // Attempt reconnection before resuming if WS is closed
          void setupMediaRecorder(sessionId);
        }
      } catch {}
    },
  };
}
