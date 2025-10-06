import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { useSilentChunkDetector } from '@/hooks/use-silent-chunk-detector';
import { HEARTBEAT_INTERVAL_MS, MAX_HEARTBEAT_MISSES } from '@/lib/wsPolicy';
import { getClientTimezone } from '@/lib/timezone';

type UseResilientRecordingProps = {
  agentName: string | null;
  onRecordingStopped: (recording: any) => void;
};

interface AudioChunk {
  data: Blob;
  timestamp: number;
  sequenceNumber: number;
}

enum ConnectionState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Reconnecting = 'reconnecting'
}

export function useResilientRecording({ agentName, onRecordingStopped }: UseResilientRecordingProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  isPausedRef.current = isPaused;
  const [isStopping, setIsStopping] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [bufferedChunkCount, setBufferedChunkCount] = useState(0);

  // Audio and WebSocket refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const webSocketRef = useRef<WebSocket | null>(null);

  // Heartbeat refs
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatMissesRef = useRef(0);
  const lastServerHeartbeatRef = useRef<number>(Date.now());

  // Resilience features
  const audioBufferRef = useRef<AudioChunk[]>([]);
  const sequenceNumberRef = useRef(0);
  const lastDisconnectTimeRef = useRef<number | null>(null);
  const wasConnectedBeforeRef = useRef(false);

  // Reconnection state
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 10;
  const initialReconnectDelay = 1000;
  const maxReconnectDelay = 30000;
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const graceWindowMs = 120000; // 2 minutes

  // Network monitoring
  const wasOnlineRef = useRef(navigator.onLine);

  // Session info for reconnection
  const sessionInfoRef = useRef<{
    wsUrl: string;
    token: string;
  } | null>(null);

  // Silent-chunk detection
  const { onChunkBoundary, resetDetector } = useSilentChunkDetector({
    stream: audioStream,
    isActive: isRecording && !isPaused,
    windowMs: 10_000,
    cooldownMs: 30_000,
    levelThreshold: 0.02,
    ignoreInitialChunks: 1,
    message: 'No audio detected. Check your mic/input settings.',
  });

  // Network change detection
  useEffect(() => {
    const handleOnline = () => {
      const wasOnline = wasOnlineRef.current;
      wasOnlineRef.current = true;

      if (!wasOnline && isRecording) {
        console.log('[ResilientRecording] Network restored, attempting immediate reconnection');
        reconnectAttemptsRef.current = 0; // Reset attempts for network restore
        if (connectionState === ConnectionState.Disconnected) {
          attemptReconnect();
        }
      }
    };

    const handleOffline = () => {
      wasOnlineRef.current = false;
      console.log('[ResilientRecording] Network lost, will reconnect when restored');
      setConnectionState(ConnectionState.Disconnected);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isRecording, connectionState]);

  // Page visibility handling
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isRecording) {
        console.log('[ResilientRecording] Page became visible, checking connection health');
        testConnectionHealth();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isRecording]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const isGracePeriodExpired = useCallback((): boolean => {
    if (!lastDisconnectTimeRef.current) return false;
    return (Date.now() - lastDisconnectTimeRef.current) > graceWindowMs;
  }, []);

  const sendAudio = useCallback((audioData: Blob) => {
    const audioChunk: AudioChunk = {
      data: audioData,
      timestamp: Date.now(),
      sequenceNumber: ++sequenceNumberRef.current
    };

    if (connectionState === ConnectionState.Connected &&
        webSocketRef.current?.readyState === WebSocket.OPEN) {
      // Send immediately
      webSocketRef.current.send(audioData);
    } else {
      // Buffer for later
      audioBufferRef.current.push(audioChunk);
      setBufferedChunkCount(audioBufferRef.current.length);
      console.log(`[ResilientRecording] Buffered audio chunk (${audioBufferRef.current.length} buffered)`);
    }
  }, [connectionState]);

  const sendBufferedAudio = useCallback(() => {
    const buffer = audioBufferRef.current;
    if (buffer.length === 0) return;

    console.log(`[ResilientRecording] Sending ${buffer.length} buffered audio chunks`);

    // Sort by sequence number to maintain order
    buffer.sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    // Send each chunk
    for (const chunk of buffer) {
      if (webSocketRef.current?.readyState === WebSocket.OPEN) {
        webSocketRef.current.send(chunk.data);
      }
    }

    // Clear buffer
    audioBufferRef.current = [];
    setBufferedChunkCount(0);
  }, []);

  const testConnectionHealth = useCallback(() => {
    const ws = webSocketRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;

    const now = Date.now();
    const maxSilence = Math.max(90_000, (HEARTBEAT_INTERVAL_MS || 20_000) * 4);
    if (now - lastServerHeartbeatRef.current > maxSilence) {
      console.warn('[ResilientRecording] No server heartbeat observed during visibility check.');
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current) return; // Already scheduled

    // Don't reconnect if no network
    if (!navigator.onLine) {
      console.log('[ResilientRecording] No network for reconnection, waiting...');
      return;
    }

    if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
      console.error('[ResilientRecording] Max reconnection attempts reached');
      toast.error('Connection failed permanently. Please try refreshing the page.');
      return;
    }

    setConnectionState(ConnectionState.Reconnecting);

    // Calculate delay with exponential backoff
    const delay = Math.min(
      initialReconnectDelay * Math.pow(2, reconnectAttemptsRef.current),
      maxReconnectDelay
    );

    console.log(`[ResilientRecording] Scheduling reconnection attempt ${reconnectAttemptsRef.current + 1} in ${delay}ms`);

    reconnectTimerRef.current = setTimeout(() => {
      reconnectAttemptsRef.current++;
      attemptReconnect();
    }, delay);
  }, [maxReconnectAttempts, initialReconnectDelay, maxReconnectDelay]);

  const setupWebSocket = useCallback(async (wsUrl: string, sessionId: string, token: string): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const webSocket = new WebSocket(`${wsUrl}/ws/audio_stream/${sessionId}?token=${token}`);
      webSocketRef.current = webSocket;

      // Connection timeout
      const timeout = setTimeout(() => {
        if (webSocket.readyState === WebSocket.CONNECTING) {
          webSocket.close();
          reject(new Error('Connection timeout'));
        }
      }, 10000);

      webSocket.onopen = () => {
        clearTimeout(timeout);
        console.log('[ResilientRecording] WebSocket connected');

        // Reset reconnection state
        reconnectAttemptsRef.current = 0;
        clearReconnectTimer();

        // Update state
        const wasReconnecting = connectionState === ConnectionState.Reconnecting;
        setConnectionState(ConnectionState.Connected);

        // Start heartbeat
        startHeartbeat();

        // Send buffered audio if any
        sendBufferedAudio();

        if (wasReconnecting && wasConnectedBeforeRef.current) {
          console.log('[ResilientRecording] Successfully reconnected');
          toast.success('Connection restored');
        } else {
          wasConnectedBeforeRef.current = true;
        }

        resolve(webSocket);
      };

      webSocket.onclose = (event) => {
        clearTimeout(timeout);
        console.log(`[ResilientRecording] WebSocket closed: ${event.code} - ${event.reason}`);

        stopHeartbeat();
        lastDisconnectTimeRef.current = Date.now();

        if (isRecording && !isPausedRef.current && !isStopping) {
          // Unintentional disconnect during active recording
          setConnectionState(ConnectionState.Disconnected);

          if (navigator.onLine) {
            scheduleReconnect();
          } else {
            console.log('[ResilientRecording] WebSocket closed and no network - will reconnect when network returns');
            toast.message('Connection lost. Recording continues locally - will reconnect when network returns.');
          }
        }
      };

      webSocket.onerror = (error) => {
        clearTimeout(timeout);
        console.error('[ResilientRecording] WebSocket error:', error);

        if (!wasConnectedBeforeRef.current) {
          reject(error);
        }
      };

      webSocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const ws = webSocketRef.current;

          if (data?.type === 'ping' || data?.action === 'ping') {
            lastServerHeartbeatRef.current = Date.now();
            heartbeatMissesRef.current = 0;
            try {
              ws?.send(JSON.stringify({ type: 'pong' }));
            } catch (error) {
              console.debug('[ResilientRecording] Failed to send pong response:', error);
            }
            return;
          }

          if (data?.type === 'pong' || data?.action === 'pong') {
            handlePong();
            return;
          }

          // Handle server status messages
          if (data.type === 'status' && data.state === 'RESUMED') {
            console.log('[ResilientRecording] Session successfully resumed');
          }

        } catch (error) {
          // Not JSON, handle as needed
        }
      };
    });
  }, [connectionState, isRecording, isStopping, clearReconnectTimer, startHeartbeat, stopHeartbeat, sendBufferedAudio, scheduleReconnect]);

  const attemptReconnect = useCallback(async () => {
    clearReconnectTimer();

    // Check network state before attempting
    if (!navigator.onLine) {
      console.log('[ResilientRecording] No network for reconnection, waiting...');
      return;
    }

    if (!sessionInfoRef.current || !sessionId) {
      console.error('[ResilientRecording] Missing session info for reconnection');
      return;
    }

    console.log(`[ResilientRecording] Reconnection attempt ${reconnectAttemptsRef.current}`);

    try {
      await setupWebSocket(sessionInfoRef.current.wsUrl, sessionId, sessionInfoRef.current.token);
    } catch (error: any) {
      console.error('[ResilientRecording] Reconnection failed:', error);
      scheduleReconnect();
    }
  }, [sessionId, clearReconnectTimer, setupWebSocket, scheduleReconnect]);

  const startHeartbeat = useCallback(() => {
    stopHeartbeat();

    heartbeatMissesRef.current = 0;
    lastServerHeartbeatRef.current = Date.now();

    heartbeatIntervalRef.current = setInterval(() => {
      const ws = webSocketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const now = Date.now();
      const maxSilence = Math.max(90_000, (HEARTBEAT_INTERVAL_MS || 20_000) * 4);
      if (now - lastServerHeartbeatRef.current > maxSilence) {
        const maxMisses = Math.max(1, MAX_HEARTBEAT_MISSES || 3);
        heartbeatMissesRef.current = Math.min(
          maxMisses,
          heartbeatMissesRef.current + 1,
        );
        if (heartbeatMissesRef.current === 1) {
          console.warn('[ResilientRecording] No server heartbeat for >90s; connection marked degraded.');
        }
      } else {
        heartbeatMissesRef.current = 0;
      }
    }, HEARTBEAT_INTERVAL_MS || 15000);
  }, [stopHeartbeat]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  const handlePong = useCallback(() => {
    heartbeatMissesRef.current = 0;
    lastServerHeartbeatRef.current = Date.now();
  }, []);

  const setupMediaRecorder = useCallback(async (sessionId: string) => {
    if (!sessionId) return;

    const sessionInfo = sessionInfoRef.current;
    if (!sessionInfo) {
      console.error('[ResilientRecording] No session info available for reconnection');
      return;
    }

    const { access_token } = await (await fetch('/api/auth/session')).json();
    if (!access_token) {
      toast.error("Authentication failed. Please refresh the page.");
      return;
    }

    const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
    if (!wsUrl) {
      toast.error("WebSocket URL is not configured. Cannot start recording.");
      return;
    }

    // Update session info for future reconnections
    sessionInfoRef.current = { wsUrl, token: access_token };

    try {
      await setupWebSocket(wsUrl, sessionId, access_token);

      // Start media recorder if not already started
      if (!mediaRecorderRef.current && audioStream) {
        const mediaRecorder = new MediaRecorder(audioStream);
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            onChunkBoundary();
            sendAudio(event.data);
          }
        };

        mediaRecorder.start(3000); // Send data every 3 seconds
      }
    } catch (error: any) {
      console.error('[ResilientRecording] Failed to setup WebSocket:', error);
      toast.error("Failed to establish WebSocket connection.");
    }
  }, [audioStream, setupWebSocket, onChunkBoundary, sendAudio]);

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
        setSessionId(data.session_id);
        toast.success("Recording session started!");

        // Get microphone access
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setAudioStream(stream);

        // Setup WebSocket and media recorder
        await setupMediaRecorder(data.session_id);

        setIsRecording(true);
        resetDetector();
      } else {
        toast.error(data.error || "Failed to start recording session");
      }
    } catch (error: any) {
      console.error("Error starting recording:", error);
      toast.error("Failed to start recording session");
    }
  }, [agentName, setupMediaRecorder, resetDetector]);

  const performStopRecording = useCallback(async (sessionId: string) => {
    try {
      clearReconnectTimer();
      stopHeartbeat();

      const response = await fetch('/api/audio-recording-proxy?action=stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = await response.json();

      if (response.ok) {
        onRecordingStopped(data);
        toast.success("Recording stopped successfully!");
      } else {
        console.error("Error stopping recording:", data.error);
      }
    } catch (error: any) {
      console.error("Error stopping recording:", error);
    } finally {
      // Clean up
      setSessionId(null);
      setIsRecording(false);
      setIsPaused(false);
      setIsStopping(false);
      setConnectionState(ConnectionState.Disconnected);
      setBufferedChunkCount(0);

      // Reset refs
      audioBufferRef.current = [];
      sequenceNumberRef.current = 0;
      reconnectAttemptsRef.current = 0;
      lastDisconnectTimeRef.current = null;
      wasConnectedBeforeRef.current = false;
      sessionInfoRef.current = null;

      // Clean up audio stream
      if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        setAudioStream(null);
      }

      // Clean up refs
      mediaRecorderRef.current = null;
      webSocketRef.current = null;
    }
  }, [clearReconnectTimer, stopHeartbeat, onRecordingStopped, audioStream]);

  const stopRecording = useCallback(async () => {
    if (!sessionId || isStopping) return;

    setIsStopping(true);

    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }

    if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
      setTimeout(() => {
        if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
          webSocketRef.current.send(JSON.stringify({ action: 'stop_stream' }));
        }
      }, 100);
    }

    await performStopRecording(sessionId);
  }, [sessionId, isStopping, performStopRecording]);

  const togglePause = useCallback(async () => {
    if (!isRecording) return;

    const next = !isPaused;
    setIsPaused(next);

    try {
      const ws = webSocketRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'set_processing_state', paused: next }));
      } else if (!next && sessionId) {
        // Attempt reconnection before resuming if WS is closed
        await setupMediaRecorder(sessionId);
      }
    } catch (error) {
      console.error('[ResilientRecording] Error toggling pause:', error);
    }
  }, [isRecording, isPaused, sessionId, setupMediaRecorder]);

  return {
    // State
    isRecording,
    isPaused,
    isStopping,
    sessionId,
    connectionState,
    bufferedChunkCount,

    // Actions
    startRecording,
    stopRecording,
    togglePause,

    // Audio stream for silent detection
    audioStream,
  };
}
