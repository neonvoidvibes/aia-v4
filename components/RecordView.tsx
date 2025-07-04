"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, Square, Download, Bookmark, Loader2, X, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
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

// Utility for development-only logging
const debugLog = (...args: any[]) => {
  if (process.env.NODE_ENV === 'development') {
    console.debug('[RecordView DEBUG]', ...args);
  }
};

type GlobalRecordingStatus = {
  type: 'transcript' | 'recording' | null;
  isRecording: boolean;
  isPaused: boolean;
  time: number;
  sessionId: string | null;
};

import { type VADAggressiveness } from './VADSettings';

interface RecordViewProps {
  agentName: string | null;
  globalRecordingStatus: GlobalRecordingStatus;
  setGlobalRecordingStatus: React.Dispatch<React.SetStateAction<GlobalRecordingStatus>>;
  isTranscriptRecordingActive: boolean;
  agentCapabilities: { pinecone_index_exists: boolean };
  vadAggressiveness: VADAggressiveness;
}

interface FinishedRecording {
  s3Key: string;
  filename: string;
  agentName?: string; // Made optional as it might not come from the new API
  timestamp: string;
}

const RecordView: React.FC<RecordViewProps> = ({
  agentName,
  globalRecordingStatus,
  setGlobalRecordingStatus,
  isTranscriptRecordingActive,
  agentCapabilities,
  vadAggressiveness,
}) => {
  const [finishedRecordings, setFinishedRecordings] = useState<FinishedRecording[]>([]);
  const [isEmbedding, setIsEmbedding] = useState<Record<string, boolean>>({});
  const [recordingToDelete, setRecordingToDelete] = useState<FinishedRecording | null>(null);
  const [isTranscriptModalOpen, setIsTranscriptModalOpen] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState<{ filename: string; content: string } | null>(null);
  const [isLoadingTranscript, setIsLoadingTranscript] = useState(false);
  const isPineconeEnabled = agentCapabilities.pinecone_index_exists;

  // --- Robust WebSocket and State Management ---
  const [wsStatus, setWsStatus] = useState<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [pendingAction, setPendingAction] = useState<'start' | 'stop' | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const webSocketRef = useRef<WebSocket | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const reconnectAttemptsRef = useRef(0);
  const isStoppingRef = useRef(false);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pongTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const tryReconnectRef = React.useRef<() => void>(() => {});
  const supabase = createClient();

  // Industry-standard reconnection and heartbeat parameters
  const MAX_RECONNECT_ATTEMPTS = 10;
  const RECONNECT_DELAY_BASE_MS = 2500;
  const HEARTBEAT_INTERVAL_MS = 25000;
  const PONG_TIMEOUT_MS = 10000;
  const MAX_HEARTBEAT_MISSES = 2;
  const heartbeatMissesRef = useRef(0);

  const fetchRecordings = useCallback(async () => {
    if (!agentName) return;
    debugLog("Fetching recordings for agent:", agentName);
    try {
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
      setGlobalRecordingStatus(prev => ({ ...prev, time: prev.time + 1 }));
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
    setGlobalRecordingStatus({ type: null, isRecording: false, isPaused: false, time: 0, sessionId: null });
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
    
    if (pendingAction === 'start') {
      setPendingAction(null);
    }
    
    isStoppingRef.current = false;
    debugLog("[Resetting States] Finished.");
  }, [setGlobalRecordingStatus, pendingAction]);

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
    const { sessionId } = globalRecordingStatus;
    if (!sessionId || pendingAction === 'stop') return;

    debugLog(`[Stop Recording] Initiated. Error: ${dueToError}, Session: ${sessionId}`);
    setPendingAction('stop');
    reconnectAttemptsRef.current = MAX_RECONNECT_ATTEMPTS + 1; // Prevent reconnects
    setIsReconnecting(false);
    stopTimer();

    // 1. Stop MediaRecorder
    if (mediaRecorderRef.current) {
      const recorder = mediaRecorderRef.current;
      recorder.onstop = () => {
        debugLog("[Stop] MediaRecorder.onstop executed.");
        if (audioStreamRef.current) {
          audioStreamRef.current.getTracks().forEach(track => track.stop());
          audioStreamRef.current = null;
        }
      };
      if (recorder.state !== "inactive") {
        recorder.stop();
      } else {
        recorder.onstop(new Event('manual_stop'));
      }
    }

    // 2. Notify server and close WebSocket
    if (webSocketRef.current) {
      const ws = webSocketRef.current;
      (ws as any).__intentionalClose = true;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: "stop_stream" }));
      }
      // Give a brief moment for the message to be sent before closing
      setTimeout(() => {
        if (ws.readyState !== WebSocket.CLOSED) {
          ws.close(1000, "Client-initiated stop");
        }
      }, 100);
    }

    // 3. Finalize via HTTP
    const result = await callHttpRecordingApi('stop', { session_id: sessionId });
    if (result.success && result.data?.s3Key) {
      // Instead of updating local state directly, re-fetch from the source of truth
      fetchRecordings();
      toast.success("Recording stopped and saved.");
    } else {
      const errorMessage = result.error || "Failed to get recording data from server.";
      if (!dueToError) {
        toast.error(`Could not finalize recording: ${errorMessage}`);
      }
      console.error("[Stop Recording] Finalization failed. Full result:", JSON.stringify(result, null, 2));
    }

    // 4. Reset State
    setGlobalRecordingStatus({ type: null, isRecording: false, isPaused: false, time: 0, sessionId: null });
    setPendingAction(null);
    debugLog("[Stop Recording] Finished.");
  }, [globalRecordingStatus, pendingAction, callHttpRecordingApi, agentName, fetchRecordings]);

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
      };

      mediaRecorder.onstop = () => {
        debugLog("[MediaRecorder] onstop triggered.");
        if (audioStreamRef.current) {
          audioStreamRef.current.getTracks().forEach(track => track.stop());
          audioStreamRef.current = null;
        }
      };
      
      mediaRecorder.onerror = (event) => {
        console.error("[MediaRecorder] Error:", event);
        toast.error('Microphone recording error.');
        // Full stop due to unrecoverable error
        handleStopRecording(undefined, true);
      };

      mediaRecorder.start(3000); // Send data every 3 seconds
      console.info("[MediaRecorder] Started.");
      setGlobalRecordingStatus(prev => ({ ...prev, isRecording: true, isPaused: false }));
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
        if (pendingAction === 'start') setPendingAction(null);
        return;
      }

      setWsStatus('connecting');
      
      // Unified WebSocket URL logic
      const wsBaseUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL || (process.env.NEXT_PUBLIC_BACKEND_API_URL || '').replace(/^http/, 'ws');
      if (!wsBaseUrl) {
        toast.error("WebSocket URL is not configured. Set NEXT_PUBLIC_WEBSOCKET_URL or NEXT_PUBLIC_BACKEND_API_URL.");
        setWsStatus('error');
        if (pendingAction === 'start') setPendingAction(null);
        return;
      }

      const wsUrl = `${wsBaseUrl}/ws/audio_stream/${sessionId}?token=${session.access_token}`;
      
      const newWs = new WebSocket(wsUrl);
      webSocketRef.current = newWs;
      (newWs as any).__intentionalClose = false;

      newWs.onopen = () => {
        if (webSocketRef.current !== newWs) return; // Stale connection
        console.info(`[WebSocket] Connection open. Reconnecting: ${isReconnecting}`);
        setWsStatus('open');
        
        // Reset heartbeat on new connection
        if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
        if (pongTimeoutRef.current) clearTimeout(pongTimeoutRef.current);
        heartbeatMissesRef.current = 0;
        
        heartbeatIntervalRef.current = setInterval(() => {
          if (newWs.readyState === WebSocket.OPEN && !isStoppingRef.current) {
            if (heartbeatMissesRef.current >= MAX_HEARTBEAT_MISSES) {
              newWs.close(1000, "Heartbeat timeout");
              return;
            }
            newWs.send(JSON.stringify({action: 'ping'}));
            pongTimeoutRef.current = setTimeout(() => {
              heartbeatMissesRef.current++;
              if (heartbeatMissesRef.current >= MAX_HEARTBEAT_MISSES) {
                newWs.close(1000, "Heartbeat timeout");
              }
            }, PONG_TIMEOUT_MS);
          }
        }, HEARTBEAT_INTERVAL_MS);
        
        if (isReconnecting) {
          if (mediaRecorderRef.current?.state === "paused") {
            mediaRecorderRef.current.resume();
            setGlobalRecordingStatus(prev => ({ ...prev, isPaused: false }));
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
            heartbeatMissesRef.current = 0;
            if (isReconnecting) {
              setIsReconnecting(false);
              reconnectAttemptsRef.current = 0;
              toast.success("Connection re-established.");
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

        if (webSocketRef.current === newWs) {
          const intentional = (newWs as any).__intentionalClose || pendingAction === 'stop';
          setWsStatus('closed');
          webSocketRef.current = null;
          if (!intentional && globalRecordingStatus.isRecording) {
            if (mediaRecorderRef.current?.state === "recording") {
              mediaRecorderRef.current.pause();
              setGlobalRecordingStatus(prev => ({ ...prev, isPaused: true }));
            }
            if (!isReconnecting) {
              setIsReconnecting(true);
              reconnectAttemptsRef.current = 0;
              tryReconnectRef.current();
            } else {
              tryReconnectRef.current();
            }
          }
        }
      };
    });
  }, [isReconnecting, supabase.auth, startBrowserMediaRecording, setGlobalRecordingStatus, pendingAction, globalRecordingStatus.isRecording]);

  const tryReconnect = useCallback(() => {
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      toast.error('Failed to reconnect. Please stop and start recording again.');
      resetRecordingStates();
      return;
    }
    reconnectAttemptsRef.current++;
    const attempt = reconnectAttemptsRef.current;
    toast.info(`Connection lost. Paused. Reconnecting (${attempt}/${MAX_RECONNECT_ATTEMPTS})...`);
    
    const delay = (RECONNECT_DELAY_BASE_MS * Math.pow(2, attempt - 1)) + (Math.random() * 1000);
    reconnectTimeoutRef.current = setTimeout(() => {
      const sessionId = globalRecordingStatus.sessionId;
      if (sessionId) {
        connectWebSocket(sessionId);
      } else {
        toast.error("Cannot reconnect: session info lost.");
        resetRecordingStates();
      }
    }, delay);
  }, [resetRecordingStates, connectWebSocket, globalRecordingStatus.sessionId]);

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
      setGlobalRecordingStatus({ type: 'recording', isRecording: false, isPaused: false, time: 0, sessionId });
      connectWebSocket(sessionId);
      toast.success("Recording session initiated.");
      fetchRecordings(); // Refresh the list
    } else {
      setPendingAction(null);
    }
  };

  const handlePauseRecording = async () => {
    if (!globalRecordingStatus.isRecording || globalRecordingStatus.isPaused) return;
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
    }
    stopTimer();
    setGlobalRecordingStatus(prev => ({ ...prev, isPaused: true }));
    toast.info("Recording paused.");
    // Optionally, notify backend about pause
    // await callHttpRecordingApi('pause', { session_id: globalRecordingStatus.sessionId });
  };

  const handleResumeRecording = async () => {
    if (!globalRecordingStatus.isRecording || !globalRecordingStatus.isPaused) return;
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
    }
    startTimer();
    setGlobalRecordingStatus(prev => ({ ...prev, isPaused: false }));
    toast.success("Recording resumed.");
    // Optionally, notify backend about resume
    // await callHttpRecordingApi('resume', { session_id: globalRecordingStatus.sessionId });
  };


  const handleEmbedRecording = async (s3Key: string) => {
    if (!agentName) return;
    setIsEmbedding(prev => ({ ...prev, [s3Key]: true }));
    try {
      const response = await fetch('/api/recordings/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ s3Key, agentName }),
      });
      const data = await response.json();
      if (response.ok) {
        toast.success("Recording successfully embedded.");
      } else {
        throw new Error(data.error || "Failed to embed recording.");
      }
    } catch (error) {
      console.error("Error embedding recording:", error);
      toast.error((error as Error).message);
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
    } else if (globalRecordingStatus.isPaused) {
      handleResumeRecording();
    } else {
      handlePauseRecording();
    }
  };

  const isRecording = globalRecordingStatus.type === 'recording' && globalRecordingStatus.isRecording;
  const isPaused = isRecording && globalRecordingStatus.isPaused;
  const isStopping = pendingAction === 'stop';

  return (
    <AlertDialog>
      <div className="flex flex-col h-full p-4 items-center justify-center">
        <div className="flex flex-col items-center justify-center space-y-2 w-full max-w-md">
          {/* Controls */}
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

          {/* Finished Recordings Section */}
          <div className="w-full pt-4">
            {finishedRecordings.length > 0 && (
              <div className="flex justify-center items-center mb-2">
                <h2 className="text-lg font-semibold">Finished Recordings</h2>
              </div>
            )}
            <div className="overflow-y-auto space-y-1 px-1" style={{ maxHeight: 'calc(100vh - 350px)' }}>
              {finishedRecordings.length > 0 ? (
                finishedRecordings.map((rec) => (
                  <div key={rec.s3Key} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" title={rec.filename}>{rec.filename}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(rec.timestamp).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center space-x-1">
                      <Button variant="ghost" size="icon" onClick={() => handleViewTranscript(rec.s3Key, rec.filename)} title="View Transcript">
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDownloadRecording(rec.s3Key, rec.filename)} title="Download">
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleEmbedRecording(rec.s3Key)} disabled={isEmbedding[rec.s3Key] || !isPineconeEnabled} title="Bookmark to Memory" className={!isPineconeEnabled ? 'cursor-not-allowed' : ''}>
                        {isEmbedding[rec.s3Key] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bookmark className="h-4 w-4" />}
                      </Button>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={() => setRecordingToDelete(rec)} title="Delete">
                          <X className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-center pt-4">
                  <p className="text-sm text-muted-foreground text-center opacity-50">No recordings yet.</p>
                </div>
              )}
            </div>
          </div>
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
        </div>
      </div>
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
    </AlertDialog>
  );
};

export default RecordView;
