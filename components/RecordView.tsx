"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, Square, Download, Bookmark, Loader2, X, Eye, ListCollapse, Mic, CheckCircle2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useMobile } from '@/hooks/use-mobile';
import {
  HEARTBEAT_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  MAX_HEARTBEAT_MISSES,
  adjusted,
  nextReconnectDelay,
} from '@/lib/wsPolicy';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { createClient } from '@/utils/supabase/client';
import { useSilentChunkDetector } from '@/hooks/use-silent-chunk-detector';

// Utility for development-only logging
const debugLog = (...args: any[]) => {
  if (process.env.NODE_ENV === 'development') {
    console.debug('[RecordView DEBUG]', ...args);
  }
};

type RecordingType = 'long-form-note' | 'long-form-chat' | 'press-to-talk' | null;

type GlobalRecordingStatus = {
  isRecording: boolean;
  type: RecordingType;
};

import { type VADAggressiveness } from './VADSettings';

interface RecordViewProps {
  agentName: string | null;
  globalRecordingStatus: GlobalRecordingStatus;
  setGlobalRecordingStatus: React.Dispatch<React.SetStateAction<GlobalRecordingStatus>>;
  isTranscriptRecordingActive: boolean;
  agentCapabilities: { pinecone_index_exists: boolean };
  vadAggressiveness: VADAggressiveness;
  setRecordingTime: React.Dispatch<React.SetStateAction<number>>;
}

interface FinishedRecording {
  s3Key: string;
  filename: string;
  agentName?: string; // Made optional as it might not come from the new API
  timestamp: string;
  isEmbedded?: boolean; // Track if recording is already embedded/bookmarked
}

const RecordView: React.FC<RecordViewProps> = ({
  agentName,
  globalRecordingStatus,
  setGlobalRecordingStatus,
  isTranscriptRecordingActive,
  agentCapabilities,
  vadAggressiveness,
  setRecordingTime,
}) => {
  const [finishedRecordings, setFinishedRecordings] = useState<FinishedRecording[]>([]);
  const [isEmbedding, setIsEmbedding] = useState<Record<string, boolean>>({});
  const [savedRecordingIds, setSavedRecordingIds] = useState<Map<string, { savedAt: Date; memoryId: string; }>>(new Map());
  const [recordingToDelete, setRecordingToDelete] = useState<FinishedRecording | null>(null);
  const [isTranscriptModalOpen, setIsTranscriptModalOpen] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState<{ filename: string; content: string } | null>(null);
  const [isLoadingTranscript, setIsLoadingTranscript] = useState(false);
  const [showFinishedRecordings, setShowFinishedRecordings] = useState<boolean>(false);
  const isMobile = useMobile();
  const isPineconeEnabled = agentCapabilities.pinecone_index_exists;

  // --- Robust WebSocket and State Management ---
  const [wsStatus, setWsStatus] = useState<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [pendingAction, setPendingAction] = useState<'start' | 'stop' | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // NOTE: The 'Simple' view is the standard/default view for the application.
  // All primary UI elements, including the recording timer, are handled in the parent `page.tsx` component.
  // This component manages the recording state logic for the dedicated 'Record Note' tab.
  // Refs to hold the latest state for use in closures like event handlers
  const pendingActionRef = useRef(pendingAction);
  useEffect(() => {
    pendingActionRef.current = pendingAction;
  }, [pendingAction]);

  const globalRecordingStatusRef = useRef(globalRecordingStatus);
  useEffect(() => {
    globalRecordingStatusRef.current = globalRecordingStatus;
  }, [globalRecordingStatus]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const webSocketRef = useRef<WebSocket | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const reconnectAttemptsRef = useRef(0);
  const prevDelayRef = useRef<number | null>(null);
  const stablePongsResetTimerRef = useRef<number | null>(null);
  const isStoppingRef = useRef(false);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pongTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const tryReconnectRef = React.useRef<() => void>(() => {});
  const supabase = createClient();

  // Detect 10s of silence and toast no more than every 30s.
  const { onChunkBoundary, resetDetector } = useSilentChunkDetector({
    stream: audioStream,
    isActive: globalRecordingStatus.isRecording,
    windowMs: 10_000,
    cooldownMs: 30_000,
    levelThreshold: 0.02,
    ignoreInitialChunks: 1,
    message: 'No audio detected. Check your mic/input settings.',
  });

  // Helper function to check if a recording is bookmarked (saved to memory)
  const isRecordingBookmarked = (s3Key: string) => {
    const savedInfo = savedRecordingIds.get(s3Key);
    return savedInfo !== undefined; // Show as bookmarked immediately, including 'pending' state
  };

  // Helper function to get storage key for agent's saved recordings
  const getStorageKey = () => `savedRecordings_${agentName}`;

  // Load saved recordings from localStorage on component mount (like chat persistence)
  useEffect(() => {
    if (!agentName) return;
    
    const storageKey = getStorageKey();
    const savedData = localStorage.getItem(storageKey);
    if (savedData) {
      try {
        const parsedData = JSON.parse(savedData);
        const restoredMap = new Map(
          Object.entries(parsedData).map(([key, value]: [string, any]) => [
            key,
            { 
              savedAt: new Date(value.savedAt), 
              memoryId: value.memoryId 
            }
          ])
        );
        setSavedRecordingIds(restoredMap);
        debugLog("[Load Saved Recordings] Restored", restoredMap.size, "saved recordings from localStorage");
      } catch (error) {
        console.error("[Load Saved Recordings] Error parsing localStorage data:", error);
      }
    }
  }, [agentName]);

  // Save to localStorage whenever savedRecordingIds changes (like chat persistence)
  useEffect(() => {
    if (!agentName) return;
    
    const storageKey = getStorageKey();
    if (savedRecordingIds.size === 0) {
      localStorage.removeItem(storageKey);
      return;
    }
    
    const dataToSave = Object.fromEntries(
      Array.from(savedRecordingIds.entries()).map(([key, value]) => [
        key,
        {
          savedAt: value.savedAt.toISOString(),
          memoryId: value.memoryId
        }
      ])
    );
    localStorage.setItem(storageKey, JSON.stringify(dataToSave));
    debugLog("[Save Recordings] Persisted", savedRecordingIds.size, "saved recordings to localStorage");
  }, [savedRecordingIds, agentName]);

  // Industry-standard reconnection parameters
  const MAX_RECONNECT_ATTEMPTS = 10;
  const heartbeatMissesRef = useRef(0);
  const pingStartTime = useRef<number>(0);

  const fetchRecordings = useCallback(async () => {
    if (!agentName) return;
    debugLog("Fetching recordings for agent:", agentName);
    try {
      // Fetch recordings list
      const response = await fetch('/api/recordings/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch recordings');
      }
      const recordings: FinishedRecording[] = await response.json();
      setFinishedRecordings(recordings);
      
      // Fetch saved recordings state from backend (like chat messages)
      try {
        const savedResponse = await fetch(`/api/memory/list-saved-recordings?agentName=${encodeURIComponent(agentName)}`);
        if (savedResponse.ok) {
          const savedData = await savedResponse.json();
          if (savedData.saved_recordings && Object.keys(savedData.saved_recordings).length > 0) {
            const newSavedRecordings = new Map(
              Object.entries(savedData.saved_recordings).map(([s3Key, info]: [string, any]) => [
                s3Key, 
                { 
                  savedAt: new Date(info.savedAt || info.saved_at), 
                  memoryId: info.memoryId || info.memory_id || info.log_id 
                }
              ])
            );
            setSavedRecordingIds(newSavedRecordings);
            debugLog("[Load Saved Recordings] Loaded", newSavedRecordings.size, "saved recordings from backend");
          }
        } else {
          // If backend doesn't support saved recordings list yet, fall back to localStorage
          debugLog("[Load Saved Recordings] Backend endpoint not available, using localStorage fallback");
        }
      } catch (savedError) {
        console.warn("[Load Saved Recordings] Error fetching saved state from backend, using localStorage:", savedError);
      }
      
      debugLog("Fetched recordings:", recordings);
    } catch (error) {
      console.error("Error fetching recordings:", error);
      toast.error(`Could not load recordings: ${(error as Error).message}`);
    }
  }, [agentName]);

  useEffect(() => {
    if (agentName) {
      fetchRecordings();
    }
  }, [agentName, fetchRecordings]);

  useEffect(() => {
    // When recording becomes active, clear the "start" pending action.
    if (globalRecordingStatus.isRecording && pendingAction === 'start') {
      setPendingAction(null);
    }
  }, [globalRecordingStatus.isRecording, pendingAction]);

  const startTimer = () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = setInterval(() => {
      setRecordingTime(prev => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  const resetRecordingStates = useCallback(() => {
    debugLog("[Resetting States] Initiated.");
    isStoppingRef.current = true;

    stopTimer();
    setGlobalRecordingStatus({ type: null, isRecording: false });
    setRecordingTime(0);
    setIsPaused(false);
    setCurrentSessionId(null);
    setWsStatus('idle');
    setIsReconnecting(false);

    // Clear all timers and intervals
    if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
    if (pongTimeoutRef.current) clearTimeout(pongTimeoutRef.current);
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    heartbeatIntervalRef.current = null;
    pongTimeoutRef.current = null;
    reconnectTimeoutRef.current = null;

    // Reset counters
    reconnectAttemptsRef.current = 0;
    heartbeatMissesRef.current = 0;

    // Cleanup WebSocket
    if (webSocketRef.current) {
      const ws = webSocketRef.current;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        (ws as any).__intentionalClose = true;
        ws.close(1000, "Client resetting states");
      }
      webSocketRef.current = null;
    }

    // Cleanup MediaRecorder
    if (mediaRecorderRef.current) {
      const mr = mediaRecorderRef.current;
      mr.ondataavailable = null;
      mr.onstop = null;
      mr.onerror = null;
      if (mr.state !== "inactive") {
        try { mr.stop(); } catch (e) { console.warn("[Reset] Error stopping MediaRecorder:", e); }
      }
      mediaRecorderRef.current = null;
    }

    // Cleanup AudioStream
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
      audioStreamRef.current = null;
    }
    
    // This function is a "dumb" resetter, it shouldn't clear pending actions
    // as the caller is responsible for that.
    
    isStoppingRef.current = false;
    debugLog("[Resetting States] Finished.");
  }, [setGlobalRecordingStatus]);

  const callHttpRecordingApi = useCallback(async (action: 'start' | 'stop' | 'pause' | 'resume', payload?: any): Promise<any> => {
    debugLog(`[HTTP API] Action: ${action}, Payload:`, payload);
    if (!agentName) {
      toast.error(`Cannot ${action} recording. Agent not set.`);
      return { success: false, error: "Agent not set" };
    }

    try {
      const response = await fetch(`/api/audio-recording-proxy?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, agent: agentName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.error || `Failed action '${action}'`);
      
      console.info(`[HTTP API] '${action}' successful.`);
      return { success: true, data };
    } catch (error: any) {
      console.error(`[HTTP API] Error (${action}):`, error);
      toast.error(`Failed to ${action} recording: ${error?.message}`);
      return { success: false, error: error?.message };
    }
  }, [agentName]);

  const handleStopRecording = useCallback(async (e?: React.MouseEvent, dueToError: boolean = false) => {
    e?.stopPropagation();
    const sessionId = currentSessionId;
    if (!sessionId || pendingActionRef.current === 'stop') {
      debugLog(`[Stop Recording] Aborted. Session ID: ${sessionId}, Pending Action: ${pendingActionRef.current}`);
      return;
    }

    debugLog(`[Stop Recording] Initiated. Finalizing session: ${sessionId}`);
    setPendingAction('stop');
    isStoppingRef.current = true;

    // Stop client-side recording immediately
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
      audioStreamRef.current = null;
    }
    stopTimer();

    // Close WebSocket gracefully
    if (webSocketRef.current) {
      const ws = webSocketRef.current;
      (ws as any).__intentionalClose = true;
      if (ws.readyState === WebSocket.OPEN) {
        // Optional: send a stop message if your backend uses it
        // ws.send(JSON.stringify({ action: "stop_stream" }));
        ws.close(1000, "Client stopped recording");
      }
      webSocketRef.current = null;
    }

    // Notify backend to finalize and save the recording
    const result = await callHttpRecordingApi('stop', { session_id: sessionId });
    if (result.success) {
      toast.success("Recording saved successfully.");
      await fetchRecordings(); // Await to ensure list is updated before state change
    } else if (!dueToError) {
      toast.error(`Server finalization failed: ${result.error || "Unknown error"}`);
    }

    // Fully reset all states now that everything is done
    setGlobalRecordingStatus({ type: null, isRecording: false });
    setRecordingTime(0);
    setIsPaused(false);
    setCurrentSessionId(null);
    setWsStatus('idle');
    setPendingAction(null);
    isStoppingRef.current = false;
    debugLog("[Stop Recording] Completed.");

  }, [currentSessionId, callHttpRecordingApi, fetchRecordings, setGlobalRecordingStatus, resetRecordingStates]);

  const startBrowserMediaRecording = useCallback(async () => {
    debugLog(`[MediaRecorder] Attempting start. WS state: ${webSocketRef.current?.readyState}`);
    if (!webSocketRef.current || webSocketRef.current.readyState !== WebSocket.OPEN) {
      toast.error('Cannot start microphone. Stream not ready.');
      if (pendingAction === 'start') setPendingAction(null);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      setAudioStream(stream);
      
      const options = { mimeType: 'audio/webm;codecs=opus' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        // @ts-ignore
        delete options.mimeType;
      }

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && webSocketRef.current?.readyState === WebSocket.OPEN) {
          webSocketRef.current.send(event.data);
        }
        // Check last 10s window on each chunk boundary
        onChunkBoundary();
      };

      mediaRecorder.onstop = () => {
        debugLog("[MediaRecorder] onstop triggered.");
        if (audioStreamRef.current) {
          audioStreamRef.current.getTracks().forEach(track => track.stop());
          audioStreamRef.current = null;
        }
        setAudioStream(null);
        resetDetector();
      };
      
      mediaRecorder.onerror = (event) => {
        console.error("[MediaRecorder] Error:", event);
        toast.error('Microphone recording error.');
        // Full stop due to unrecoverable error
        handleStopRecording(undefined, true);
      };

      mediaRecorder.start(3000); // Send data every 3 seconds
      console.info("[MediaRecorder] Started.");
      setGlobalRecordingStatus({ type: 'long-form-note', isRecording: true });
      setIsPaused(false);
      startTimer();
      // The setPendingAction(null) is now handled by a useEffect watching globalRecordingStatus.isRecording

    } catch (err) {
      console.error("[MediaRecorder] Error getting user media:", err);
      toast.error('Could not access microphone. Please check permissions.');
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach(track => track.stop());
        audioStreamRef.current = null;
      }
      setWsStatus('error');
      if (pendingAction === 'start') setPendingAction(null);
    }
  }, [pendingAction, setGlobalRecordingStatus, handleStopRecording]);

  const connectWebSocket = useCallback((sessionId: string) => {
    debugLog(`[WebSocket] Connecting for session: ${sessionId}`);
    if (webSocketRef.current && (webSocketRef.current.readyState === WebSocket.OPEN || webSocketRef.current.readyState === WebSocket.CONNECTING)) {
      console.warn(`[WebSocket] Already open or connecting.`);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.access_token) {
        toast.error('Authentication error. Cannot start recording stream.');
        setWsStatus('error');
        setPendingAction(null);
        return;
      }

      setWsStatus('connecting');
      
      const wsBaseUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL || (process.env.NEXT_PUBLIC_BACKEND_API_URL || '').replace(/^http/, 'ws');
      if (!wsBaseUrl) {
        toast.error("WebSocket URL is not configured. Set NEXT_PUBLIC_WEBSOCKET_URL or NEXT_PUBLIC_BACKEND_API_URL.");
        setWsStatus('error');
        setPendingAction(null);
        return;
      }

      const wsUrl = `${wsBaseUrl}/ws/audio_stream/${sessionId}?token=${session.access_token}`;
      
      const newWs = new WebSocket(wsUrl);
      (newWs as any).__intentionalClose = false;

      newWs.onopen = () => {
        // Assign to the global ref ONLY when the connection is officially open.
        // This prevents race conditions where other parts of the app might try to use
        // the ref while the socket is still in the "CONNECTING" state.
        webSocketRef.current = newWs;
        if (webSocketRef.current !== newWs) return;
        console.info(`[WebSocket] Connection open. Reconnecting: ${isReconnecting}`);
        setWsStatus('open');
        
        reconnectAttemptsRef.current = 0;
        prevDelayRef.current = null;
        if (stablePongsResetTimerRef.current) {
          clearTimeout(stablePongsResetTimerRef.current);
          stablePongsResetTimerRef.current = null;
        }
        
        if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
        if (pongTimeoutRef.current) clearTimeout(pongTimeoutRef.current);
        heartbeatMissesRef.current = 0;
        
        heartbeatIntervalRef.current = setInterval(() => {
          if (newWs.readyState === WebSocket.OPEN && !isStoppingRef.current) {
            if (!globalRecordingStatusRef.current.isRecording && heartbeatMissesRef.current >= MAX_HEARTBEAT_MISSES) {
              newWs.close(1000, "Heartbeat timeout (not recording)");
              return;
            }
            pingStartTime.current = Date.now();
            newWs.send(JSON.stringify({action: 'ping'}));
            pongTimeoutRef.current = setTimeout(() => {
              heartbeatMissesRef.current++;
              if (!globalRecordingStatusRef.current.isRecording && heartbeatMissesRef.current >= MAX_HEARTBEAT_MISSES) {
                newWs.close(1000, "Heartbeat timeout (not recording)");
              }
            }, adjusted(PONG_TIMEOUT_MS));
          }
        }, adjusted(HEARTBEAT_INTERVAL_MS));
        
        if (isReconnecting) {
          if (mediaRecorderRef.current?.state === "paused") {
            mediaRecorderRef.current.resume();
            setIsPaused(false);
          }
        } else {
          startBrowserMediaRecording();
        }
      };

      newWs.onmessage = (event) => {
        try {
          const messageData = JSON.parse(event.data);
          if (messageData.type === 'pong') {
            if (pongTimeoutRef.current) clearTimeout(pongTimeoutRef.current);
            const rtt = Date.now() - pingStartTime.current;
            console.log(`[RTT] ${rtt}ms`);
            if (rtt > 5000) {
              console.warn('[Network] High latency detected:', rtt);
            }
            heartbeatMissesRef.current = 0;
            
            // after 30s of stable pongs, zero the backoff attempts
            if (!stablePongsResetTimerRef.current) {
              const t = window.setTimeout(() => {
                reconnectAttemptsRef.current = 0;
                prevDelayRef.current = null;
                stablePongsResetTimerRef.current = null;
              }, 30000);
              stablePongsResetTimerRef.current = t;
            }
            
            if (isReconnecting) {
              setIsReconnecting(false);
              reconnectAttemptsRef.current = 0;
              toast.success("Connection re-established and stable.");
            }
          }
        } catch (e) { /* Non-JSON message */ }
      };

      newWs.onerror = (event) => {
        console.error(`[WebSocket] Error:`, event);
        if (webSocketRef.current === newWs) {
          toast.error('Recording stream connection failed.');
          setWsStatus('error');
        }
      };

      newWs.onclose = (event) => {
        if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
        if (pongTimeoutRef.current) clearTimeout(pongTimeoutRef.current);
      
        if (webSocketRef.current !== newWs) return;

        // If the server intentionally rejected the connection because one already exists,
        // do not attempt to reconnect. This breaks the reconnection storm loop.
        // 1008 = policy violation (duplicate connection) → do not reconnect
        if (event.code === 1008) {
            console.warn(`[WebSocket] Close received with code 1008 (Policy Violation - likely duplicate connection). Aborting reconnect.`);
            toast.warning("Another recording tab for this session may be active.");
            setWsStatus('closed');
            if (webSocketRef.current === newWs) {
              webSocketRef.current = null;
            }
            setIsReconnecting(false);
            reconnectAttemptsRef.current = 0;
            prevDelayRef.current = null;
            if (pendingActionRef.current === 'start') setPendingAction(null);
            return;
        }
        // 1005/1006 = abnormal/no close; treat as transient, avoid long waits
        if (event.code === 1005 || event.code === 1006) {
          prevDelayRef.current = 1000; // bias nextReconnectDelay to ~1s
        }
      
        const intentional = (newWs as any).__intentionalClose || pendingActionRef.current === 'stop';
        const timestamp = new Date().toISOString();
        const networkOnline = navigator.onLine;
        console.log(`[WebSocket Close] ${timestamp} - Code: ${event.code}, Online: ${networkOnline}, Reason: '${event.reason}', Intentional: ${intentional}`);
        debugLog(`[WebSocket onclose] Code: ${event.code}, Reason: '${event.reason}', Intentional: ${intentional}`);
        setWsStatus('closed');
        webSocketRef.current = null;
      
        // The main stop logic is now in `handleStopRecording` which calls `resetRecordingStates`.
        // `resetRecordingStates` nullifies the onclose handler before closing, so this code
        // should now only run for UNINTENTIONAL disconnections.
        if (!intentional && globalRecordingStatusRef.current.isRecording) {
          debugLog("[WebSocket onclose] Unexpected disconnection. Attempting to reconnect.");
          if (mediaRecorderRef.current?.state === "recording") {
            mediaRecorderRef.current.pause();
            setIsPaused(true);
          }
          if (!isReconnecting) {
            setIsReconnecting(true);
            reconnectAttemptsRef.current = 0;
            tryReconnectRef.current();
          } else {
            tryReconnectRef.current();
          }
        }
      };
    });
  }, [isReconnecting, supabase.auth, startBrowserMediaRecording, setGlobalRecordingStatus, callHttpRecordingApi, fetchRecordings, resetRecordingStates]);

  const tryReconnect = useCallback(() => {
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      toast.error('Failed to reconnect. Please stop and start recording again.');
      resetRecordingStates();
      return;
    }
    reconnectAttemptsRef.current++;
    const attempt = reconnectAttemptsRef.current;
    toast.info(`Connection lost. Paused. Reconnecting (${attempt}/${MAX_RECONNECT_ATTEMPTS})...`);
    
    const delay = nextReconnectDelay(
      prevDelayRef.current,
      { isRecording: globalRecordingStatusRef.current.isRecording === true }
    );
    prevDelayRef.current = delay;
    reconnectTimeoutRef.current = setTimeout(() => {
      const sessionId = currentSessionId;
      if (sessionId) {
        connectWebSocket(sessionId);
      } else {
        toast.error("Cannot reconnect: session info lost.");
        resetRecordingStates();
      }
    }, delay);
  }, [resetRecordingStates, connectWebSocket, currentSessionId]);

  useEffect(() => {
    tryReconnectRef.current = tryReconnect;
  }, [tryReconnect]);

  const handleStartRecording = async () => {
    if (!agentName || pendingAction || globalRecordingStatus.isRecording) return;
    if (isTranscriptRecordingActive) {
      toast.error("A chat transcript is already being recorded. Please stop it first.");
      return;
    }
    
    setPendingAction('start');
    resetRecordingStates(); // Ensure clean state before starting

    const result = await callHttpRecordingApi('start', {
      transcriptionLanguage: 'any',
      vad_aggressiveness: vadAggressiveness
    });
    if (result.success && result.data?.session_id) {
      const sessionId = result.data.session_id;
      setCurrentSessionId(sessionId);
      setGlobalRecordingStatus({ type: 'long-form-note', isRecording: true });
      connectWebSocket(sessionId);
      toast.success("Recording session initiated.");
      fetchRecordings(); // Refresh the list
    } else {
      setPendingAction(null);
    }
  };

  const handlePauseRecording = async () => {
    if (!globalRecordingStatus.isRecording || isPaused) return;
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
    }
    stopTimer();
    setIsPaused(true);
    toast.info("Recording paused.");
    // Optionally, notify backend about pause
    // await callHttpRecordingApi('pause', { session_id: currentSessionId });
  };

  const handleResumeRecording = async () => {
    if (!globalRecordingStatus.isRecording || !isPaused) return;
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
    }
    startTimer();
    setIsPaused(false);
    toast.success("Recording resumed.");
    // Optionally, notify backend about resume
    // await callHttpRecordingApi('resume', { session_id: currentSessionId });
  };


  const handleEmbedRecording = async (s3Key: string) => {
    if (!agentName) return;
    
    const savedInfo = savedRecordingIds.get(s3Key);
    if (savedInfo) {
      if (savedInfo.memoryId === 'pending') {
        toast.info("Recording is already being saved...");
        return;
      } else {
        // TODO: Implement forget recording functionality like chat messages
        toast.info("Recording already saved to memory. Forget functionality coming soon.");
        return;
      }
    }

    // Optimistic update FIRST (immediate visual feedback)
    const newSaveDate = new Date();
    const placeholderInfo = { savedAt: newSaveDate, memoryId: 'pending' };
    setSavedRecordingIds(prev => new Map(prev).set(s3Key, placeholderInfo));
    
    setIsEmbedding(prev => ({ ...prev, [s3Key]: true }));
    const toastId = `save-recording-${s3Key}`;
    toast.loading("Saving recording to memory...", { id: toastId });
    
    try {
      const response = await fetch('/api/memory/save-recording', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ s3Key, agentName }),
      });
      const result = await response.json();
      
      if (response.ok) {
        if (result.log_id) {
          // Final update with the real memoryId (like chat messages)
          setSavedRecordingIds(prev => new Map(prev).set(s3Key, { 
            savedAt: newSaveDate, 
            memoryId: result.log_id 
          }));
        } else {
          // If no log_id, something is wrong, revert.
          throw new Error("Backend did not return a memoryId.");
        }
        toast.success("Recording saved to memory.", { id: toastId });
      } else {
        throw new Error(result.error || "Failed to save recording to memory.");
      }
    } catch (error) {
      console.error("Error saving recording to memory:", error);
      toast.error(`Failed to save recording: ${(error as Error).message}. Reverting.`, { id: toastId });
      
      // Revert optimistic update on failure (like chat messages)
      setSavedRecordingIds(prev => {
        const updated = new Map(prev);
        updated.delete(s3Key);
        return updated;
      });
    } finally {
      setIsEmbedding(prev => ({ ...prev, [s3Key]: false }));
    }
  };

  const handleDownloadRecording = (s3Key: string, filename: string) => {
    const downloadUrl = `/api/s3-proxy/download?s3Key=${encodeURIComponent(s3Key)}&filename=${encodeURIComponent(filename)}`;
    window.open(downloadUrl, '_blank');
  };

  const handleDeleteRecording = async () => {
    if (!recordingToDelete || !agentName) return;
    try {
      const response = await fetch('/api/recordings/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ s3Key: recordingToDelete.s3Key, agentName }),
      });
      const data = await response.json();
      if (response.ok) {
        // Re-fetch the list from S3 to ensure UI is in sync
        fetchRecordings();
        toast.success(`Deleted recording: ${recordingToDelete.filename}`);
      } else {
        throw new Error(data.error || "Failed to delete recording.");
      }
    } catch (error) {
      console.error("Error deleting recording:", error);
      toast.error((error as Error).message);
    } finally {
      setRecordingToDelete(null);
    }
  };

  const handleViewTranscript = async (s3Key: string, filename: string) => {
    setIsLoadingTranscript(true);
    setCurrentTranscript({ filename, content: "Loading..." });
    setIsTranscriptModalOpen(true);
    try {
      const response = await fetch(`/api/s3/view?s3Key=${encodeURIComponent(s3Key)}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch transcript');
      }
      const data = await response.json();
      setCurrentTranscript({ filename, content: data.content });
    } catch (error) {
      console.error("Error fetching transcript:", error);
      toast.error(`Could not load transcript: ${(error as Error).message}`);
      setCurrentTranscript({ filename, content: `Error: ${(error as Error).message}` });
    } finally {
      setIsLoadingTranscript(false);
    }
  };

  const handlePlayPauseClick = () => {
    if (!globalRecordingStatus.isRecording) {
      handleStartRecording();
    } else if (isPaused) {
      handleResumeRecording();
    } else {
      handlePauseRecording();
    }
  };

  const isRecording = globalRecordingStatus.type === 'long-form-note' && globalRecordingStatus.isRecording;
  const isStopping = pendingAction === 'stop';

  return (
    <div className="space-y-4 p-1 sm:p-0">
      {/* Unified Recording Card */}
      <div className="border-2 rounded-lg transition-all duration-200 border-border bg-muted/20">
        <div className="p-6 sm:p-8">
          {/* Centered Header */}
          <div className="text-center mb-6">
            <div className="flex items-center justify-center gap-3 mb-2">
              <Mic className="w-6 h-6 text-primary flex-shrink-0" />
              <p className="text-base font-medium text-foreground">Voice Note Recorder</p>
            </div>
            <p className="text-sm text-muted-foreground">Record your voice notes</p>
          </div>
          
          {/* Controls - KEEPING EXACT ORIGINAL STRUCTURE */}
          <div className="flex items-center justify-center space-x-4">
            <Button
              onClick={handlePlayPauseClick}
              disabled={isTranscriptRecordingActive || isStopping || pendingAction === 'start'}
              className={cn(
                "flex items-center h-12 px-6 rounded-md text-foreground",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "transition-colors duration-200",
                isRecording ? "bg-red-500 hover:bg-red-600 text-white" : "bg-primary hover:bg-primary/90 text-primary-foreground"
              )}
              title={isRecording ? "Pause Recording" : "Start Recording"}
            >
              {pendingAction === 'start' ? (
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              ) : isRecording && !isPaused ? (
                <Pause className="w-5 h-5 mr-2" fill="currentColor" />
              ) : (
                <Play className="w-5 h-5 mr-2" fill="currentColor" />
              )}
              <span className="text-base">{pendingAction === 'start' ? "Starting..." : isRecording ? (isPaused ? "Resume" : "Pause") : "Record"}</span>
            </Button>
            <Button
              onClick={(e) => handleStopRecording(e)}
              disabled={!isRecording || isStopping}
              className={cn(
                "flex items-center h-12 px-6 rounded-md text-foreground",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "transition-colors duration-200",
                "bg-secondary hover:bg-secondary/80 text-secondary-foreground"
              )}
              title="Stop Recording"
            >
              {isStopping ? (
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              ) : (
                <Square className="w-5 h-5 mr-2" />
              )}
              <span className="text-base">{isStopping ? "Stopping..." : "Stop"}</span>
            </Button>
          </div>
          {isTranscriptRecordingActive && (
            <p className="text-xs text-muted-foreground text-center">
              Stop the chat transcript to enable recording.
            </p>
          )}
          {!isPineconeEnabled && !isTranscriptRecordingActive && (
            <p className="text-xs text-muted-foreground text-center pt-4">
              Agent has no memory index. Saving to memory is disabled.
            </p>
          )}
          {isReconnecting && (
            <p className="text-xs text-orange-500 text-center animate-pulse">
              Connection lost. Attempting to reconnect...
            </p>
          )}

        </div>
      </div>

      {/* Finished Recordings - Collapsible Accordion */}
      <AlertDialog>
        {finishedRecordings.length > 0 && (
          <div className="border rounded-lg">
            <Button 
              variant="ghost" 
              onClick={() => setShowFinishedRecordings(!showFinishedRecordings)}
              className="w-full p-4 h-auto justify-between hover:bg-muted/50"
            >
              <div className="flex items-center gap-2">
                <ListCollapse className="w-5 h-5" />
                <span className="font-medium">Finished Recordings ({finishedRecordings.length})</span>
              </div>
              <div className={cn(
                "transition-transform duration-200",
                showFinishedRecordings ? "rotate-180" : ""
              )}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </Button>
            
            {showFinishedRecordings && (
              <div className="border-t">
                <div className="p-4 space-y-2 max-h-[70vh] overflow-y-auto">
                  {finishedRecordings.map((rec) => (
                    <div key={rec.s3Key} className="flex items-center justify-between p-3 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate" title={rec.filename}>{rec.filename}</p>
                          <p className="text-xs text-muted-foreground">{new Date(rec.timestamp).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button variant="ghost" size="sm" onClick={() => handleViewTranscript(rec.s3Key, rec.filename)} className="h-8 px-2 text-muted-foreground hover:text-primary">
                          <Eye className={cn("h-3 w-3", !isMobile && "mr-1")} />
                          {!isMobile && "View"}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDownloadRecording(rec.s3Key, rec.filename)} className="h-8 px-2 text-muted-foreground hover:text-primary">
                          <Download className={cn("h-3 w-3", !isMobile && "mr-1")} />
                          {!isMobile && "Download"}
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => handleEmbedRecording(rec.s3Key)} 
                          disabled={isEmbedding[rec.s3Key] || !isPineconeEnabled} 
                          className={cn(
                            "h-8 px-2",
                            isRecordingBookmarked(rec.s3Key) 
                              ? "text-[hsl(var(--save-memory-color))] hover:text-[hsl(var(--save-memory-color))]" 
                              : "text-muted-foreground hover:text-primary"
                          )}
                        >
                          {isEmbedding[rec.s3Key] ? (
                            <Loader2 className={cn("h-3 w-3 animate-spin", !isMobile && "mr-1")} />
                          ) : (
                            <Bookmark className={cn(
                              "h-3 w-3",
                              !isMobile && "mr-1",
                              isRecordingBookmarked(rec.s3Key) 
                                ? "stroke-[hsl(var(--save-memory-color))]" 
                                : ""
                            )} />
                          )}
                          {!isMobile && "Bookmark"}
                        </Button>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" onClick={() => setRecordingToDelete(rec)} className="h-8 w-8 text-muted-foreground hover:text-destructive">
                            <X className="h-3 w-3" />
                          </Button>
                        </AlertDialogTrigger>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* AlertDialog content for deletion confirmation */}
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the recording <span className="font-bold">{recordingToDelete?.filename}</span> from storage. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDeleteRecording}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
      </AlertDialog>

      {/* Dialog for viewing transcripts */}
      <Dialog open={isTranscriptModalOpen} onOpenChange={setIsTranscriptModalOpen}>
        <DialogContent className="max-w-3xl h-4/5 flex flex-col">
          <DialogHeader>
            <DialogTitle className="truncate">Transcript: {currentTranscript?.filename}</DialogTitle>
            <DialogDescription>
              Content of the selected recording.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-grow overflow-y-auto border rounded-md p-4 bg-muted/20">
            {isLoadingTranscript ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <pre className="text-sm whitespace-pre-wrap break-words">
                {currentTranscript?.content}
              </pre>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Close
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RecordView;
