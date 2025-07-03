import { useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';

type UseRecordingProps = {
  agentName: string | null;
  onRecordingStopped: (recording: any) => void;
};

export function useRecording({ agentName, onRecordingStopped }: UseRecordingProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const webSocketRef = useRef<WebSocket | null>(null);

  const startRecording = useCallback(async () => {
    if (!agentName) {
      toast.error("Agent not selected. Cannot start recording.");
      return;
    }

    try {
      const response = await fetch('/api/audio-recording-proxy?action=start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agentName, transcriptionLanguage: 'any' }),
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
        mediaRecorder.start(3000); // Send data every 3 seconds
      };

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && webSocket.readyState === WebSocket.OPEN) {
          webSocket.send(event.data);
        }
      };

      webSocket.onclose = async () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
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
    }
  };

  return {
    isRecording,
    isPaused,
    isStopping,
    startRecording,
    stopRecording,
    togglePause: () => setIsPaused(!isPaused),
  };
}
