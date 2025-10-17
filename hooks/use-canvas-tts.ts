/**
 * useCanvasTTS Hook
 *
 * Queue-based TTS playback for Canvas view.
 * Accepts sentences as they're detected during LLM streaming,
 * fetches audio from ElevenLabs, and plays them sequentially.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { isCanvasAudioUnlocked, markCanvasAudioLocked } from '@/lib/canvas-audio-unlock';

export interface UseCanvasTTSOptions {
  voiceId?: string;
  autoPlay?: boolean; // Default true for canvas
  onStart?: () => void;
  onComplete?: () => void;
  onError?: (error: 'autoplay-blocked' | 'playback-error' | 'generate-failed' | 'load-failed') => void;
}

export interface UseCanvasTTSReturn {
  enqueueSentence: (text: string) => void;
  isPlaying: boolean;
  isFetching: boolean;
  stop: () => void;
  clear: () => void;
  queueLength: number;
  resumePending: () => void;
}

interface QueuedSentence {
  text: string;
  audio: HTMLAudioElement | null;
  status: 'pending' | 'fetching' | 'ready' | 'playing' | 'played' | 'error';
}

// Default voice for canvas - can be different from chat
const DEFAULT_CANVAS_VOICE_ID = "aSLKtNoVBZlxQEMsnGL2"; // "Sanna Hartfield"

export function useCanvasTTS({
  voiceId = DEFAULT_CANVAS_VOICE_ID,
  autoPlay = true,
  onStart,
  onComplete,
  onError,
}: UseCanvasTTSOptions = {}): UseCanvasTTSReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [queueLength, setQueueLength] = useState(0);

  const queueRef = useRef<QueuedSentence[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const isProcessingRef = useRef(false);

  // Cleanup function to stop and clear all audio
  const cleanup = useCallback(() => {
    // Stop current audio
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.onended = null;
      currentAudioRef.current.onerror = null;
      currentAudioRef.current.onplaying = null;
      currentAudioRef.current = null;
    }

    // Clear queue
    queueRef.current = [];
    setQueueLength(0);
    setIsPlaying(false);
    setIsFetching(false);
    isProcessingRef.current = false;
  }, []);

  // Fetch audio for a sentence
  const fetchAudio = useCallback(async (text: string): Promise<HTMLAudioElement | null> => {
    try {
      setIsFetching(true);
      const audioUrl = `/api/tts-proxy?text=${encodeURIComponent(text)}&voiceId=${voiceId}`;
      const audio = new Audio();
      audio.preload = 'auto';
      audio.crossOrigin = 'anonymous';
      (audio as any).playsInline = true;
      audio.autoplay = false;
      audio.muted = false;
      audio.volume = 1;

      // Return a promise that resolves when audio is loaded
      return new Promise((resolve, reject) => {
        audio.oncanplaythrough = () => {
          setIsFetching(false);
          resolve(audio);
        };

        audio.onerror = (e) => {
          console.error('[Canvas TTS] Failed to load audio:', e);
          setIsFetching(false);
          onError?.('load-failed');
          reject(new Error('Failed to load audio'));
        };

        audio.src = audioUrl;
        audio.load();
      });
    } catch (error) {
      setIsFetching(false);
      console.error('[Canvas TTS] Error fetching audio:', error);
      onError?.('generate-failed');
      return null;
    }
  }, [voiceId, onError]);

  // Pre-fetch the next sentence in the queue to eliminate latency
  const prefetchNext = useCallback(() => {
    // Find the next pending sentence
    const nextPendingIndex = queueRef.current.findIndex(
      item => item.status === 'pending'
    );

    if (nextPendingIndex !== -1) {
      const nextSentence = queueRef.current[nextPendingIndex];
      nextSentence.status = 'fetching';

      console.log('[Canvas TTS] Pre-fetching next sentence:', nextSentence.text.substring(0, 50) + '...');

      // Fetch audio in background
      fetchAudio(nextSentence.text).then(audio => {
        if (audio && nextSentence.status === 'fetching') {
          nextSentence.audio = audio;
          nextSentence.status = 'ready';
          console.log('[Canvas TTS] Pre-fetch complete, ready to play with 0 latency');
        }
      }).catch(err => {
        console.error('[Canvas TTS] Pre-fetch failed:', err);
        nextSentence.status = 'error';
      });
    }
  }, [fetchAudio]);

  // Play the next item in the queue
  const playNext = useCallback(async () => {
    if (isProcessingRef.current) return;
    if (queueRef.current.length === 0) {
      setIsPlaying(false);
      setQueueLength(0);
      onComplete?.();
      return;
    }

    isProcessingRef.current = true;

    // Get the first pending or ready item
    const nextIndex = queueRef.current.findIndex(
      item => item.status === 'pending' || item.status === 'ready'
    );

    if (nextIndex === -1) {
      isProcessingRef.current = false;
      setIsPlaying(false);
      setQueueLength(0);
      onComplete?.();
      return;
    }

    const sentence = queueRef.current[nextIndex];

    // Fetch audio if not ready (should rarely happen with pre-fetching)
    if (sentence.status === 'pending') {
      console.log('[Canvas TTS] Fetching audio (pre-fetch missed)');
      sentence.status = 'fetching';
      const audio = await fetchAudio(sentence.text);

      if (!audio) {
        sentence.status = 'error';
        queueRef.current.splice(nextIndex, 1);
        setQueueLength(queueRef.current.length);
        isProcessingRef.current = false;
        playNext(); // Try next sentence
        return;
      }

      sentence.audio = audio;
      sentence.status = 'ready';
    }

    // Wait for audio to be ready if still fetching
    if (sentence.status === 'fetching') {
      // Poll until ready or error
      const maxWait = 100; // 10 seconds max
      let waited = 0;
      while (sentence.status === 'fetching' && waited < maxWait) {
        await new Promise(r => setTimeout(r, 100));
        waited++;
      }

      if (sentence.status !== 'ready') {
        console.error('[Canvas TTS] Audio fetch timeout');
        sentence.status = 'error';
        queueRef.current.splice(nextIndex, 1);
        setQueueLength(queueRef.current.length);
        isProcessingRef.current = false;
        playNext();
        return;
      }
    }

    // Play the audio
    if (sentence.audio && sentence.status === 'ready') {
      sentence.status = 'playing';
      currentAudioRef.current = sentence.audio;
      setIsPlaying(true);

      if (nextIndex === 0) {
        onStart?.(); // Only call onStart for the first sentence
      }

      // Pre-fetch the next sentence while this one plays
      prefetchNext();

      sentence.audio.onplaying = () => {
        console.log('[Canvas TTS] Audio playback started');
      };

      sentence.audio.onended = () => {
        console.log('[Canvas TTS] Audio playback ended');
        sentence.status = 'played';

        // Remove played sentence from queue
        queueRef.current.splice(nextIndex, 1);
        setQueueLength(queueRef.current.length);

        currentAudioRef.current = null;
        isProcessingRef.current = false;

        // Play next sentence (should be pre-fetched and ready = 0 latency)
        playNext();
      };

      sentence.audio.onerror = (e) => {
        console.error('[Canvas TTS] Audio playback error:', e);
        sentence.status = 'error';

        // Remove errored sentence from queue
        queueRef.current.splice(nextIndex, 1);
        setQueueLength(queueRef.current.length);

        currentAudioRef.current = null;
        isProcessingRef.current = false;
        onError?.('playback-error');

        // Try next sentence
        playNext();
      };

      try {
        if (!isCanvasAudioUnlocked()) {
          console.warn('[Canvas TTS] Playback blocked because audio is not unlocked');
          sentence.status = sentence.audio ? 'ready' : 'pending';
          if (sentence.audio) {
            try {
              sentence.audio.pause();
              sentence.audio.currentTime = 0;
            } catch (pauseErr) {
              console.warn('[Canvas TTS] Failed to reset audio element before unlock:', pauseErr);
            }
          }
          currentAudioRef.current = null;
          isProcessingRef.current = false;
          setIsPlaying(false);
          markCanvasAudioLocked();
          onError?.('autoplay-blocked');
          return;
        }

        await sentence.audio.play();
      } catch (error: any) {
        const isAutoplayError =
          error?.name === 'NotAllowedError' ||
          error?.code === 0 ||
          (typeof error?.message === 'string' && error.message.includes('interrupted'));

        if (isAutoplayError) {
          console.warn('[Canvas TTS] Autoplay blocked, will retry after unlock', error);
          sentence.status = sentence.audio ? 'ready' : 'pending';
          if (sentence.audio) {
            try {
              sentence.audio.pause();
              sentence.audio.currentTime = 0;
            } catch (pauseErr) {
              console.warn('[Canvas TTS] Failed to reset audio element after autoplay block:', pauseErr);
            }
          }
          currentAudioRef.current = null;
          isProcessingRef.current = false;
          setIsPlaying(false);
          markCanvasAudioLocked();
          onError?.('autoplay-blocked');
          return;
        }

        console.error('[Canvas TTS] Failed to play audio:', error);
        sentence.status = 'error';
        queueRef.current.splice(nextIndex, 1);
        setQueueLength(queueRef.current.length);
        currentAudioRef.current = null;
        isProcessingRef.current = false;
        onError?.('playback-error');
        playNext();
      }
    } else {
      isProcessingRef.current = false;
    }
  }, [fetchAudio, prefetchNext, onStart, onComplete, onError]);

  // Add a sentence to the queue
  const enqueueSentence = useCallback((text: string) => {
    const trimmedText = text.trim();
    if (!trimmedText) return;

    console.log('[Canvas TTS] Enqueueing sentence:', trimmedText.substring(0, 50) + '...');

    const newSentence: QueuedSentence = {
      text: trimmedText,
      audio: null,
      status: 'pending',
    };

    queueRef.current.push(newSentence);
    setQueueLength(queueRef.current.length);

    // If autoPlay and not currently playing, start playing FIRST
    // (before prefetchNext changes status to 'fetching')
    if (autoPlay && !isProcessingRef.current && !isPlaying) {
      playNext();
    }

    // Then pre-fetch the next sentence (if any) for zero-latency transitions
    if (queueRef.current.length <= 2) {
      prefetchNext();
    }
  }, [autoPlay, isPlaying, playNext, prefetchNext]);

  // Stop current playback
  const stop = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.onended = null;
      currentAudioRef.current.onerror = null;
      currentAudioRef.current.onplaying = null;
      currentAudioRef.current = null;
    }
    setIsPlaying(false);
    isProcessingRef.current = false;
  }, []);

  // Clear queue and stop playback
  const clear = useCallback(() => {
    cleanup();
  }, [cleanup]);

  const resumePending = useCallback(() => {
    if (!isProcessingRef.current && queueRef.current.length > 0) {
      playNext();
    }
  }, [playNext]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    enqueueSentence,
    isPlaying,
    isFetching,
    stop,
    clear,
    queueLength,
    resumePending,
  };
}
