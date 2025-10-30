/**
 * useCanvasPTT Hook
 *
 * PTT recording for Canvas view - matches chat view STT button behavior.
 * Handles: Audio Recording → Batch Transcription → Return transcript text
 */

import { useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';

export type PTTStatus = 'idle' | 'recording' | 'transcribing' | 'error';

export interface UseCanvasPTTOptions {
  agentName: string;
  onTranscriptReady?: (transcript: string) => void;
  onError?: (error: string) => void;
}

export type CanvasPTTPermissionResult = 'granted' | 'newly-granted' | 'denied';

export interface UseCanvasPTTReturn {
  status: PTTStatus;
  isRecording: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  cancelRecording: () => void;
  error: string | null;
  ensurePermission: () => Promise<CanvasPTTPermissionResult>;
  hasPermission: boolean | null;
  isRequestingPermission: boolean;
}

export function useCanvasPTT({
  agentName,
  onTranscriptReady,
  onError,
}: UseCanvasPTTOptions): UseCanvasPTTReturn {
  const [status, setStatus] = useState<PTTStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const transcriptionRequestIdRef = useRef<string | null>(null);
  const hasPermissionRef = useRef<boolean | null>(null);
  const permissionRequestPromiseRef = useRef<Promise<CanvasPTTPermissionResult> | null>(null);

  const cleanup = useCallback(() => {
    // Stop media recorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    // Stop audio stream
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
      audioStreamRef.current = null;
    }

    audioChunksRef.current = [];
  }, []);

  const transcribeAndProcess = useCallback(async (audioBlob: Blob, retryCount = 0) => {
    const MAX_RETRIES = 2;
    // Generate unique request ID to prevent duplicate processing
    const requestId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9);
    transcriptionRequestIdRef.current = requestId;

    const formData = new FormData();
    formData.append('audio_file', audioBlob, 'canvas_voice.webm');
    if (agentName) {
      formData.append('agent_name', agentName);
    }

    try {
      const response = await fetch('/api/transcribe-audio', {
        method: 'POST',
        body: formData,
      });

      // Check if this request is still the current one (prevents race conditions)
      if (transcriptionRequestIdRef.current !== requestId) {
        console.log('Ignoring outdated canvas transcription request');
        return;
      }

      if (!response.ok) {
        const errorData = await response.json();
        const errorMsg = errorData.error || 'Transcription failed';

        // Retry on transient errors (5xx, network issues)
        if (retryCount < MAX_RETRIES && (response.status >= 500 || response.status === 429)) {
          const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
          console.log(`[Canvas PTT] Retrying transcription in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
          toast.info(`Transcription failed, retrying... (${retryCount + 1}/${MAX_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return transcribeAndProcess(audioBlob, retryCount + 1);
        }

        throw new Error(errorMsg);
      }

      const result = await response.json();
      let transcribedText = result.transcript;

      if (transcribedText) {
        const parts = transcribedText.split('\n\n');
        let content = parts.length > 1 ? parts.slice(1).join('\n\n') : transcribedText;

        // Remove the prepended mic emoji if it exists and trim whitespace
        content = content.replace(/^🎙️\s*/, '').trim();

        if (content) {
          onTranscriptReady?.(content);
        } else {
          toast.error("No speech detected in the recording");
        }
      } else {
        toast.error("No speech detected in the recording");
      }
    } catch (err: any) {
      // Only show error if this is still the current request
      if (transcriptionRequestIdRef.current === requestId) {
        console.error('Canvas transcription error:', err);
        const errorMsg = err.message || 'Transcription failed';
        setError(errorMsg);
        onError?.(errorMsg);
        toast.error(errorMsg);
      }
    } finally {
      // Only update state if this is still the current request
      if (transcriptionRequestIdRef.current === requestId) {
        setStatus('idle');
        transcriptionRequestIdRef.current = null;
      }
    }
  }, [agentName, onTranscriptReady, onError]);

  const ensurePermission = useCallback(async (): Promise<CanvasPTTPermissionResult> => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      const errorMsg = 'Microphone access is not supported in this environment';
      setError(errorMsg);
      toast.error(errorMsg);
      return 'denied';
    }

    if (hasPermissionRef.current === true) {
      return 'granted';
    }

    if (permissionRequestPromiseRef.current) {
      return permissionRequestPromiseRef.current;
    }

    const request = (async (): Promise<CanvasPTTPermissionResult> => {
      try {
        setIsRequestingPermission(true);
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        const previouslyGranted = hasPermissionRef.current === true;
        setHasPermission(true);
        hasPermissionRef.current = true;
        setError(null);
        return previouslyGranted ? 'granted' : 'newly-granted';
      } catch (err: any) {
        console.error('Canvas microphone permission error:', err);
        const errorMsg = err?.name === 'NotAllowedError'
          ? 'Microphone access denied'
          : err?.message || 'Microphone access failed';
        setHasPermission(false);
        hasPermissionRef.current = false;
        setError(errorMsg);
        onError?.(errorMsg);
        toast.error(errorMsg);
        return 'denied';
      } finally {
        setIsRequestingPermission(false);
        permissionRequestPromiseRef.current = null;
      }
    })();

    permissionRequestPromiseRef.current = request;
    return request;
  }, [onError]);

  const startRecording = useCallback(async () => {
    if (!agentName) {
      const errorMsg = 'Agent not selected';
      setError(errorMsg);
      setStatus('error');
      onError?.(errorMsg);
      toast.error(errorMsg);
      return;
    }

    try {
      setStatus('recording');
      setError(null);

      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      setHasPermission(true);
      hasPermissionRef.current = true;

      // Setup media recorder with fallback
      const options = { mimeType: 'audio/webm;codecs=opus' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        console.warn(`[Canvas PTT] ${options.mimeType} not supported, trying audio/webm`);
        options.mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
          console.warn('[Canvas PTT] audio/webm not supported, using default');
          delete (options as any).mimeType;
        }
      }
      const mediaRecorder = new MediaRecorder(stream, Object.keys(options).length ? options : undefined);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

        // CRITICAL: Validate blob before attempting transcription
        if (audioBlob.size === 0) {
          console.error('[Canvas PTT] Empty audio blob detected - no data recorded');
          const errorMsg = 'Recording failed: No audio data captured. Please try again.';
          setError(errorMsg);
          setStatus('error');
          onError?.(errorMsg);
          toast.error(errorMsg);

          // Clean up stream
          if (audioStreamRef.current) {
            audioStreamRef.current.getTracks().forEach(track => {
              if (track.readyState !== 'ended') {
                track.stop();
              }
            });
            audioStreamRef.current = null;
          }
          mediaRecorderRef.current = null;
          return;
        }

        // Minimum size check (WebM header is ~200 bytes minimum)
        if (audioBlob.size < 300) {
          console.warn(`[Canvas PTT] Audio blob suspiciously small: ${audioBlob.size} bytes`);
          const errorMsg = 'Recording too short or corrupted. Please try again.';
          setError(errorMsg);
          setStatus('error');
          onError?.(errorMsg);
          toast.error(errorMsg);

          // Clean up stream
          if (audioStreamRef.current) {
            audioStreamRef.current.getTracks().forEach(track => {
              if (track.readyState !== 'ended') {
                track.stop();
              }
            });
            audioStreamRef.current = null;
          }
          mediaRecorderRef.current = null;
          return;
        }

        console.log(`[Canvas PTT] Audio blob validated: ${audioBlob.size} bytes`);
        setStatus('transcribing');
        transcribeAndProcess(audioBlob);

        // Clean up stream
        if (audioStreamRef.current) {
          audioStreamRef.current.getTracks().forEach(track => {
            if (track.readyState !== 'ended') {
              track.stop();
            }
          });
          audioStreamRef.current = null;
        }
        mediaRecorderRef.current = null;
      };

      // CRITICAL FIX: Use timeslice to ensure data is collected periodically
      // This prevents empty blobs on long recordings (>1 min) on mobile/certain browsers
      // Without timeslice, browser buffers all audio in memory until stop() - can fail for long recordings
      mediaRecorder.start(100); // Collect data every 100ms

    } catch (err: any) {
      console.error('Error starting canvas recording:', err);
      const errorMsg = err.message || 'Could not access microphone';
      setError(errorMsg);
      setStatus('error');
      onError?.(errorMsg);
      toast.error(errorMsg);
      cleanup();
      setHasPermission(false);
      hasPermissionRef.current = false;
    }
  }, [agentName, onError, cleanup, transcribeAndProcess]);

  const stopRecording = useCallback(async () => {
    // Prevent duplicate submissions
    if (status === 'transcribing') {
      return;
    }

    // IMMEDIATELY stop audio stream tracks
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop(); // This will trigger the onstop handler
    }
  }, [status]);

  const cancelRecording = useCallback(() => {
    // Cancel any pending transcription request
    transcriptionRequestIdRef.current = null;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.onstop = null; // Detach onstop to prevent transcription
      mediaRecorderRef.current.stop();

      // Explicitly clean up resources on cancel
      audioStreamRef.current?.getTracks().forEach(track => track.stop());
      audioStreamRef.current = null;
      mediaRecorderRef.current = null;
    }

    audioChunksRef.current = [];
    setStatus('idle');
    setError(null);
  }, []);

  return {
    status,
    isRecording: status === 'recording',
    startRecording,
    stopRecording,
    cancelRecording,
    error,
    ensurePermission,
    hasPermission,
    isRequestingPermission,
  };
}
