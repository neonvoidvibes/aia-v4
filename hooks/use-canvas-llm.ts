/**
 * useCanvasLLM Hook
 *
 * Manages streaming LLM responses for the Canvas view.
 * Handles SSE (Server-Sent Events) connection to /api/canvas/stream endpoint.
 */

import { useState, useCallback, useRef } from 'react';
import { getClientTimezone } from '@/lib/timezone';

export type CanvasStreamStatus = 'idle' | 'streaming' | 'error' | 'complete';

export interface UseCanvasLLMOptions {
  agentName: string;
  depth?: 'mirror' | 'lens' | 'portal';
  conversationHistory?: Array<{ role: string; content: string }>;
  onStart?: () => void;
  onChunk?: (chunk: string) => void;
  onComplete?: (fullText: string, userTranscript: string) => void;
  onError?: (error: string) => void;
}

export interface UseCanvasLLMReturn {
  streamResponse: (transcript: string) => Promise<void>;
  output: string;
  status: CanvasStreamStatus;
  error: string | null;
  isStreaming: boolean;
  reset: () => void;
}

export function useCanvasLLM({
  agentName,
  depth = 'mirror',
  conversationHistory = [],
  onStart,
  onChunk,
  onComplete,
  onError,
}: UseCanvasLLMOptions): UseCanvasLLMReturn {
  const [output, setOutput] = useState('');
  const [status, setStatus] = useState<CanvasStreamStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setOutput('');
    setStatus('idle');
    setError(null);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const streamResponse = useCallback(async (transcript: string) => {
    // Reset state
    setOutput('');
    setError(null);
    setStatus('streaming');

    // Abort any existing stream
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();

    try {
      onStart?.();

      const clientTimezone = getClientTimezone() || 'UTC';

      const response = await fetch('/api/canvas/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        signal: abortControllerRef.current.signal,
        body: JSON.stringify({
          agent: agentName,
          transcript,
          depth,
          history: conversationHistory,
          timezone: clientTimezone,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = ''; // Buffer for character-by-character display
      let isFirstChar = true; // Track first character for immediate display

      // Helper to delay between characters (40ms per character for slower display)
      const delayBetweenChars = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.error) {
                setError(data.error);
                setStatus('error');
                onError?.(data.error);
                return;
              }

              if (data.delta) {
                // Add chunk to buffer
                buffer += data.delta;

                // Display character by character from buffer
                while (buffer.length > 0) {
                  const char = buffer[0];
                  buffer = buffer.slice(1);
                  fullText += char;
                  setOutput(fullText);
                  onChunk?.(char);

                  // No delay for first character, then 40ms delay
                  if (!isFirstChar) {
                    await delayBetweenChars(40);
                  } else {
                    isFirstChar = false;
                  }
                }
              }

              if (data.done) {
                setStatus('complete');
                onComplete?.(fullText, transcript);
                return;
              }
            } catch (e) {
              console.warn('Failed to parse SSE data:', line, e);
            }
          }
        }
      }

      setStatus('complete');
      onComplete?.(fullText, transcript);

    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('Canvas stream aborted');
        setStatus('idle');
        return;
      }

      const errorMessage = err.message || 'Failed to stream response';
      setError(errorMessage);
      setStatus('error');
      onError?.(errorMessage);
      console.error('Canvas stream error:', err);
    } finally {
      abortControllerRef.current = null;
    }
  }, [agentName, depth, conversationHistory, onStart, onChunk, onComplete, onError]);

  return {
    streamResponse,
    output,
    status,
    error,
    isStreaming: status === 'streaming',
    reset,
  };
}
