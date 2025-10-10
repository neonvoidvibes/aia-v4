"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, Square, Download, Bookmark, Loader2, X, Eye, ListCollapse, Mic, CheckCircle2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useMobile } from '@/hooks/use-mobile';
import {
  HEARTBEAT_INTERVAL_MS,
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
import { useAuthoritativeRecordingTimer } from '@/hooks/useAuthoritativeRecordingTimer';
import { getClientTimezone } from '@/lib/timezone';

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
  vadAggressiveness: VADAggressiveness | null;
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
  const sessionIdRef = useRef<string | null>(null);  // Persists across state resets

  const reconnectAttemptsRef = useRef(0);
  const prevDelayRef = useRef<number | null>(null);
  const stablePongsResetTimerRef = useRef<number | null>(null);
  const isStoppingRef = useRef(false);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastServerHeartbeatRef = useRef<number>(Date.now());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const BUFFER_GRACE_MS = 120_000;
  const bufferedChunksRef = useRef<Array<{ blob: Blob; queuedAt: number }>>([]);
  const bufferedDurationMsRef = useRef(0);
  const bufferingToastIdRef = useRef<string | null>(null);
  const networkGraceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autoPausedRef = useRef(false);
  const chunkTimesliceMsRef = useRef(3000);
  const lastChunkTimeRef = useRef<number>(Date.now());
  const mediaRecorderHealthIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isRestartingMediaRecorderRef = useRef(false);
  const mediaRecorderRestartAttemptsRef = useRef(0);
  const MAX_MEDIARECORDER_RESTART_ATTEMPTS = 3;

  const tryReconnectRef = React.useRef<() => void>(() => {});
  const supabase = createClient();

  const { displayMs: timerMs, authoritativeRecording } =
    useAuthoritativeRecordingTimer(webSocketRef.current, sessionIdRef.current || currentSessionId || '');

  useEffect(() => {
    setRecordingTime(Math.floor(timerMs / 1000));
  }, [timerMs, setRecordingTime]);

  useEffect(() => {
    setGlobalRecordingStatus(prev => ({ ...prev, isRecording: authoritativeRecording }));
  }, [authoritativeRecording, setGlobalRecordingStatus]);

  // Detect 10s of silence and toast no more than every 30s.
  const { onChunkBoundary, resetDetector } = useSilentChunkDetector({
    stream: audioStream,
    isActive: globalRecordingStatus.isRecording && !isPaused,
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

  const startTimer = () => {};

  const stopTimer = () => {};

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
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    if (mediaRecorderHealthIntervalRef.current) clearInterval(mediaRecorderHealthIntervalRef.current);
    heartbeatIntervalRef.current = null;
    reconnectTimeoutRef.current = null;
    mediaRecorderHealthIntervalRef.current = null;
    lastServerHeartbeatRef.current = Date.now();

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
    
    // Clear buffered chunks and network timers
    if (networkGraceTimerRef.current) {
      clearTimeout(networkGraceTimerRef.current);
      networkGraceTimerRef.current = null;
    }
    if (bufferingToastIdRef.current) {
      try { toast.dismiss(bufferingToastIdRef.current); } catch (_err) {}
      bufferingToastIdRef.current = null;
    }
    bufferedChunksRef.current = [];
    bufferedDurationMsRef.current = 0;
    autoPausedRef.current = false;
    chunkTimesliceMsRef.current = 3000;

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
      const requestBody: Record<string, unknown> = {
        ...(payload ?? {}),
        agent: agentName,
      };

      if (action === 'start') {
        const clientTimezone = getClientTimezone();
        if (clientTimezone) {
          requestBody.clientTimezone = clientTimezone;
        }
      }

      const response = await fetch(`/api/audio-recording-proxy?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
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
    const sessionId = sessionIdRef.current || currentSessionId;  // Try ref first, fallback to state
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
    // Clear health monitoring interval
    if (mediaRecorderHealthIntervalRef.current) {
      clearInterval(mediaRecorderHealthIntervalRef.current);
      mediaRecorderHealthIntervalRef.current = null;
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
    sessionIdRef.current = null;  // Clear ref too
    setWsStatus('idle');
    setPendingAction(null);
    isStoppingRef.current = false;
    debugLog("[Stop Recording] Completed.");

  }, [currentSessionId, callHttpRecordingApi, fetchRecordings, setGlobalRecordingStatus, resetRecordingStates]);

  const clearNetworkGraceTimer = useCallback(() => {
    if (networkGraceTimerRef.current) {
      clearTimeout(networkGraceTimerRef.current);
      networkGraceTimerRef.current = null;
    }
  }, []);

  const dismissBufferingToast = useCallback((variant?: 'success' | 'error', message?: string) => {
    const toastId = bufferingToastIdRef.current;
    if (!toastId) {
      if (variant === 'success') {
        toast.success(message ?? 'Connection re-established.');
      } else if (variant === 'error') {
        toast.error(message ?? 'Recording paused due to extended network outage.');
      }
      return;
    }

    if (variant === 'success') {
      toast.success(message ?? 'Connection re-established.', { id: toastId });
    } else if (variant === 'error') {
      toast.error(message ?? 'Recording paused due to extended network outage.', { id: toastId });
    } else {
      toast.dismiss(toastId);
    }

    bufferingToastIdRef.current = null;
  }, []);

  const showBufferingToast = useCallback(() => {
    const toastId = bufferingToastIdRef.current ?? `recording-buffer-${Date.now()}`;
    bufferingToastIdRef.current = toastId;
    toast.loading('Connection lost. Buffering audio for up to 120 seconds...', {
      id: toastId,
      duration: Infinity,
    });
  }, []);

  const autoPauseDueToNetwork = useCallback(() => {
    if (autoPausedRef.current || !globalRecordingStatusRef.current.isRecording) {
      return;
    }

    autoPausedRef.current = true;
    clearNetworkGraceTimer();

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      try {
        recorder.pause();
      } catch (error) {
        console.warn('[Network Auto-Pause] Failed to pause recorder:', error);
      }
    }

    stopTimer();
    setIsPaused(true);
    dismissBufferingToast('error', 'Network outage exceeded 2 minutes. Recording paused.');
  }, [clearNetworkGraceTimer, dismissBufferingToast]);

  const startNetworkGraceTimer = useCallback(() => {
    clearNetworkGraceTimer();
    networkGraceTimerRef.current = setTimeout(() => {
      if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
        return;
      }
      autoPauseDueToNetwork();
    }, BUFFER_GRACE_MS);
  }, [autoPauseDueToNetwork, clearNetworkGraceTimer]);

  const flushBufferedChunks = useCallback(() => {
    const ws = webSocketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || bufferedChunksRef.current.length === 0) {
      return;
    }

    let failed = false;
    while (bufferedChunksRef.current.length > 0) {
      const next = bufferedChunksRef.current.shift();
      if (!next) break;

      try {
        ws.send(next.blob);
        bufferedDurationMsRef.current = Math.max(
          bufferedDurationMsRef.current - chunkTimesliceMsRef.current,
          0,
        );
      } catch (error) {
        console.warn('[Buffered Flush] Failed to send chunk, will retry on next reconnect:', error);
        bufferedChunksRef.current.unshift(next);
        failed = true;
        break;
      }
    }

    if (!failed && bufferedChunksRef.current.length === 0) {
      dismissBufferingToast('success', 'Connection restored. Buffered audio delivered.');
      clearNetworkGraceTimer();
    }
  }, [clearNetworkGraceTimer, dismissBufferingToast]);

  const enqueueBufferedChunk = useCallback((blob: Blob) => {
    bufferedChunksRef.current.push({ blob, queuedAt: Date.now() });
    bufferedDurationMsRef.current += chunkTimesliceMsRef.current;

    if (bufferedDurationMsRef.current >= BUFFER_GRACE_MS && !autoPausedRef.current) {
      autoPauseDueToNetwork();
    }
  }, [autoPauseDueToNetwork]);

  const sendChunkOrBuffer = useCallback((blob: Blob) => {
    const ws = webSocketRef.current;
    let offline = !ws || ws.readyState !== WebSocket.OPEN;

    if (!offline && bufferedChunksRef.current.length === 0) {
      try {
        ws.send(blob);
        return;
      } catch (error) {
        console.warn('[Chunk Send] Direct send failed. Falling back to buffer:', error);
        offline = true;
      }
    }

    enqueueBufferedChunk(blob);

    if (offline) {
      showBufferingToast();
      startNetworkGraceTimer();
    }

    flushBufferedChunks();
  }, [enqueueBufferedChunk, flushBufferedChunks, showBufferingToast, startNetworkGraceTimer]);

  // Stable restartMediaRecorder callback with guard and retry limit
  const restartMediaRecorder = useCallback(async () => {
    // Guard: prevent concurrent restarts
    if (isRestartingMediaRecorderRef.current) {
      console.warn("[MediaRecorder Health] Restart already in progress, skipping.");
      return;
    }

    // Check retry limit
    if (mediaRecorderRestartAttemptsRef.current >= MAX_MEDIARECORDER_RESTART_ATTEMPTS) {
      console.error(`[MediaRecorder Health] Max restart attempts (${MAX_MEDIARECORDER_RESTART_ATTEMPTS}) reached. Stopping recording.`);
      toast.error("Recording failed after multiple restart attempts. Stopping.");
      handleStopRecording(undefined, true);
      return;
    }

    isRestartingMediaRecorderRef.current = true;
    mediaRecorderRestartAttemptsRef.current++;

    console.error("[MediaRecorder Health] Attempting to restart MediaRecorder...");
    toast.error("Recording stalled - attempting restart...");

    try {
      // Stop old recorder
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        try { mediaRecorderRef.current.stop(); } catch (e) {}
      }

      // Get fresh media stream
      const freshStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = freshStream;
      setAudioStream(freshStream);

      // Add audio stream health monitoring to fresh stream
      const audioTrack = freshStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.onended = () => {
          console.error("[Audio Track] Track ended unexpectedly!");
          toast.error("Microphone disconnected. Please check your audio device.");
          handleStopRecording(undefined, true);
        };

        audioTrack.onmute = () => {
          console.warn("[Audio Track] Track muted");
          toast.warning("Microphone muted. Recording may be paused.");
        };

        audioTrack.onunmute = () => {
          console.info("[Audio Track] Track unmuted");
          toast.success("Microphone unmuted.");
        };
      }

      // Create new MediaRecorder
      const options = { mimeType: 'audio/webm;codecs=opus' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        // @ts-ignore
        delete options.mimeType;
      }

      const newRecorder = new MediaRecorder(freshStream, options);
      mediaRecorderRef.current = newRecorder;

      // Reattach handlers
      newRecorder.ondataavailable = (event) => {
        lastChunkTimeRef.current = Date.now();
        if (event.data?.size > 0) {
          sendChunkOrBuffer(event.data);
          onChunkBoundary();
        }
      };

      newRecorder.onstop = () => {
        debugLog("[MediaRecorder] onstop triggered.");
        if (audioStreamRef.current) {
          audioStreamRef.current.getTracks().forEach(track => track.stop());
          audioStreamRef.current = null;
        }
        setAudioStream(null);
        resetDetector();
      };

      newRecorder.onerror = (event) => {
        console.error("[MediaRecorder] Error:", event);
        toast.error('Microphone recording error.');
        handleStopRecording(undefined, true);
      };

      // Start recording again
      newRecorder.start(chunkTimesliceMsRef.current);
      lastChunkTimeRef.current = Date.now();

      // Success: reset retry counter
      mediaRecorderRestartAttemptsRef.current = 0;

      toast.success("Recording restarted successfully.");
      console.info("[MediaRecorder Health] Restart successful.");
    } catch (restartErr) {
      console.error("[MediaRecorder Health] Failed to restart:", restartErr);
      toast.error("Failed to restart recording. Please stop and start manually.");
      handleStopRecording(undefined, true);
    } finally {
      isRestartingMediaRecorderRef.current = false;
    }
  }, [sendChunkOrBuffer, onChunkBoundary, resetDetector, handleStopRecording, setAudioStream]);

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

      // Add audio stream health monitoring
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.onended = () => {
          console.error("[Audio Track] Track ended unexpectedly!");
          toast.error("Microphone disconnected. Please check your audio device.");
          handleStopRecording(undefined, true);
        };

        audioTrack.onmute = () => {
          console.warn("[Audio Track] Track muted");
          toast.warning("Microphone muted. Recording may be paused.");
        };

        audioTrack.onunmute = () => {
          console.info("[Audio Track] Track unmuted");
          toast.success("Microphone unmuted.");
        };
      }

      const options = { mimeType: 'audio/webm;codecs=opus' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        // @ts-ignore
        delete options.mimeType;
      }

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        lastChunkTimeRef.current = Date.now(); // Track chunk receipt for health monitoring
        if (event.data?.size > 0) {
          sendChunkOrBuffer(event.data);
          onChunkBoundary();
        }
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

      chunkTimesliceMsRef.current = 3000;
      mediaRecorder.start(chunkTimesliceMsRef.current); // Send data every 3 seconds
      console.info("[MediaRecorder] Started.");

      // Start MediaRecorder health monitoring
      lastChunkTimeRef.current = Date.now();
      const CHUNK_TIMEOUT_MS = 15000; // 15 seconds without chunks = stalled

      mediaRecorderHealthIntervalRef.current = setInterval(() => {
        const timeSinceLastChunk = Date.now() - lastChunkTimeRef.current;
        // Check if stalled and not already restarting
        if (timeSinceLastChunk > CHUNK_TIMEOUT_MS && !isStoppingRef.current && !isRestartingMediaRecorderRef.current) {
          console.error(`[MediaRecorder Health] Stalled! No chunks for ${timeSinceLastChunk}ms`);
          restartMediaRecorder();
        }
      }, 10000); // Check every 10 seconds

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
  }, [pendingAction, setGlobalRecordingStatus, handleStopRecording, sendChunkOrBuffer, onChunkBoundary, resetDetector, restartMediaRecorder]);

  const connectWebSocket = useCallback((sessionId: string) => {
    // Stable per-tab id (already used elsewhere in the app)
    let clientId: string | null = null;
    try {
      clientId = window.sessionStorage.getItem('tabId');
      if (!clientId) {
        clientId = crypto.randomUUID();
        window.sessionStorage.setItem('tabId', clientId);
      }
    } catch { clientId = `anon-${Math.random().toString(36).slice(2)}`; }

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

      // Mark reconnect intent to allow safe server-side takeover
      const resume = isReconnecting ? '1' : '0';
      const wsUrl = `${wsBaseUrl}/ws/audio_stream/${sessionId}`
        + `?token=${session.access_token}`
        + `&client_id=${encodeURIComponent(clientId || '')}`
        + `&resume=${resume}`;
      
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
        heartbeatMissesRef.current = 0;
        lastServerHeartbeatRef.current = Date.now();

        const hadBufferedAudio = bufferedChunksRef.current.length > 0;
        flushBufferedChunks();
        if (!hadBufferedAudio) {
          clearNetworkGraceTimer();
          dismissBufferingToast('success', 'Connection re-established.');
        }

        const heartbeatIntervalMs = adjusted(HEARTBEAT_INTERVAL_MS);
        const maxSilenceMs = Math.max(90_000, heartbeatIntervalMs * 4);
        heartbeatIntervalRef.current = setInterval(() => {
          if (newWs.readyState !== WebSocket.OPEN || isStoppingRef.current) return;

          const now = Date.now();
          if (now - lastServerHeartbeatRef.current > maxSilenceMs) {
            const maxMisses = Math.max(1, MAX_HEARTBEAT_MISSES || 3);
            heartbeatMissesRef.current = Math.min(
              maxMisses,
              heartbeatMissesRef.current + 1,
            );
            if (heartbeatMissesRef.current === 1) {
              console.warn('[WebSocket] No server heartbeat for >90s; monitoring connection health.');
            }
          } else {
            heartbeatMissesRef.current = 0;
          }
        }, heartbeatIntervalMs);
        
        if (isReconnecting) {
          if (mediaRecorderRef.current?.state === "paused" && !autoPausedRef.current) {
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
          if (messageData?.type === 'ping' || messageData?.action === 'ping') {
            lastServerHeartbeatRef.current = Date.now();
            heartbeatMissesRef.current = 0;

            const rawTs = typeof messageData.ts === 'number'
              ? messageData.ts
              : typeof messageData.t === 'number'
                ? messageData.t
                : undefined;
            if (rawTs !== undefined) {
              const serverMs = rawTs > 1e12 ? rawTs : rawTs * 1000;
              const rtt = Math.max(0, Date.now() - serverMs);
              console.log(`[RTT] ${rtt}ms`);
              if (rtt > 5000) {
                console.warn('[Network] High latency detected:', rtt);
              }
            }

            try {
              newWs.send(JSON.stringify({ type: 'pong' }));
            } catch (err) {
              console.debug('[WebSocket] Failed to send pong response:', err);
            }

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
            }

            return;
          }

          if (messageData?.type === 'pong' || messageData?.action === 'pong') {
            lastServerHeartbeatRef.current = Date.now();
            heartbeatMissesRef.current = 0;

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
            }

            return;
          }

          // Handle server warnings (e.g., no audio detected)
          if (messageData?.type === 'warning') {
            if (messageData.event === 'no_audio_detected') {
              const silenceDuration = messageData.silence_duration_sec || 0;
              console.warn(`[Server Warning] No audio detected for ${silenceDuration}s`);
              toast.warning(`No audio received for ${silenceDuration} seconds. Check your microphone.`, {
                duration: 10000, // Increased from 5000ms to 10000ms
                id: 'server-audio-timeout' // Prevent duplicate warnings
              });
            }
            return;
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
        if (webSocketRef.current !== newWs) return;

        // If the server intentionally rejected the connection because one already exists,
        // do not attempt to reconnect. This breaks the reconnection storm loop.
        // 1008 = policy violation (duplicate connection) → do not reconnect
        if (event.code === 1008 && isReconnecting) {
          console.warn(`[WebSocket] 1008 on resume; attempting one forced resume reconnect.`);
          setTimeout(() => {
            // bias short delay
            prevDelayRef.current = 500;
            setIsReconnecting(true);
            tryReconnectRef.current?.();
          }, 300);
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
          showBufferingToast();
          startNetworkGraceTimer();
          if (!isReconnecting) {
            setIsReconnecting(true);
            reconnectAttemptsRef.current = 0;
            tryReconnectRef.current();
          } else {
            tryReconnectRef.current();
          }
        } else {
          clearNetworkGraceTimer();
          dismissBufferingToast();
        }
      };
    });
  }, [isReconnecting, supabase.auth, startBrowserMediaRecording, setGlobalRecordingStatus, callHttpRecordingApi, fetchRecordings, resetRecordingStates, showBufferingToast, startNetworkGraceTimer, clearNetworkGraceTimer, dismissBufferingToast, flushBufferedChunks]);

  const tryReconnect = useCallback(() => {
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      toast.error('Failed to reconnect. Please stop and start recording again.');
      resetRecordingStates();
      return;
    }
    reconnectAttemptsRef.current++;
    const attempt = reconnectAttemptsRef.current;

    // Use ref instead of state - survives resetRecordingStates()
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      console.warn("[Reconnect] No sessionId in ref, skipping reconnection attempt");
      // Don't show error toast or reset states - session may be stopping naturally
      return;
    }

    console.log(`[Reconnect] Attempt ${attempt} with session ${sessionId}`);
    const delay = nextReconnectDelay(
      prevDelayRef.current,
      { isRecording: globalRecordingStatusRef.current.isRecording === true }
    );
    prevDelayRef.current = delay;
    reconnectTimeoutRef.current = setTimeout(() => {
      // Use the sessionId captured at call time
      connectWebSocket(sessionId);
    }, delay);
  }, [resetRecordingStates, connectWebSocket]);

  useEffect(() => {
    tryReconnectRef.current = tryReconnect;
  }, [tryReconnect]);

  // Network change detection - proactive connection health monitoring
  useEffect(() => {
    const handleOnline = () => {
      console.info("[Network] Browser reports online");
      // Dismiss the network-offline toast when connection is restored
      toast.dismiss('network-offline');

      // Don't attempt reconnection if WebSocket is still open (buffering mode)
      // Only reconnect if WebSocket actually closed
      if (globalRecordingStatusRef.current.isRecording && !webSocketRef.current) {
        console.info("[Network] Recording active but WebSocket disconnected. Attempting reconnect...");
        toast.info("Network reconnected. Attempting to resume recording...");
        if (!isReconnecting) {
          setIsReconnecting(true);
          reconnectAttemptsRef.current = 0;
          tryReconnectRef.current();
        }
      }
    };

    const handleOffline = () => {
      console.warn("[Network] Browser reports offline");
      if (globalRecordingStatusRef.current.isRecording) {
        toast.warning("Network connection lost. Recording will buffer audio...", { duration: Infinity, id: 'network-offline' });
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isReconnecting, setIsReconnecting]);

  const handleStartRecording = async () => {
    if (!agentName || pendingAction || globalRecordingStatus.isRecording) return;
    if (isTranscriptRecordingActive) {
      toast.error("A chat transcript is already being recorded. Please stop it first.");
      return;
    }
    
    setPendingAction('start');
    resetRecordingStates(); // Ensure clean state before starting

    // Ensure VAD aggressiveness is loaded before starting recording
    if (vadAggressiveness === null) {
      toast.error('VAD settings are still loading. Please wait a moment and try again.');
      setPendingAction(null);
      return;
    }

    const result = await callHttpRecordingApi('start', {
      transcriptionLanguage: 'any',
      vad_aggressiveness: vadAggressiveness
    });
    if (result.success && result.data?.session_id) {
      const sessionId = result.data.session_id;
      sessionIdRef.current = sessionId;  // Store in ref
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
    autoPausedRef.current = true;
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
    autoPausedRef.current = false;
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
