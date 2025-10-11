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
  onSentenceReady?: (sentence: string) => void; // NEW: Triggered on sentence boundary for TTS
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
  onSentenceReady,
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

      // PATH 1: Real-time accumulator for TTS (immediate, no delay)
      let realTextAccumulator = '';
      let lastEmittedIndex = 0; // Track what we've already emitted to TTS
      let sentenceBuffer: string[] = []; // Buffer to batch 2 sentences together

      // PATH 2: Display buffer (40ms delay + sentence pauses)
      let displayText = '';
      let displayBuffer = '';
      let isFirstChar = true;

      // Helper functions
      const delayBetweenChars = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      // Sentence detection: . ! ? followed by space, or double newline, or 100+ chars without punctuation
      const sentencePattern = /[.!?][\s]+|[\n]{2,}/g;

      const checkAndEmitSentences = (text: string, lastIndex: number) => {
        if (!onSentenceReady) return lastIndex;

        let match;
        let currentIndex = lastIndex;

        // Reset regex lastIndex
        sentencePattern.lastIndex = 0;

        while ((match = sentencePattern.exec(text)) !== null) {
          if (match.index >= lastIndex) {
            const sentence = text.slice(lastIndex, match.index + match[0].length).trim();
            if (sentence.length > 10) { // Avoid tiny fragments
              sentenceBuffer.push(sentence);
              currentIndex = match.index + match[0].length;

              // Emit when we have 2 sentences
              if (sentenceBuffer.length >= 2) {
                const batchedText = sentenceBuffer.join(' ');
                onSentenceReady(batchedText);
                sentenceBuffer = []; // Clear buffer
              }
            }
          }
        }

        // Fallback: Emit long text without punctuation (120+ chars)
        const remaining = text.slice(currentIndex);
        if (remaining.length > 120) {
          // Flush any buffered sentences first
          if (sentenceBuffer.length > 0) {
            const batchedText = sentenceBuffer.join(' ');
            onSentenceReady(batchedText);
            sentenceBuffer = [];
          }
          onSentenceReady(remaining);
          currentIndex = text.length;
        }

        return currentIndex;
      };

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
                // PATH 1: Real-time TTS sentence detection
                realTextAccumulator += data.delta;
                lastEmittedIndex = checkAndEmitSentences(realTextAccumulator, lastEmittedIndex);

                // PATH 2: Buffered visual display with sentence pauses
                displayBuffer += data.delta;

                // Display character by character from buffer
                while (displayBuffer.length > 0) {
                  const char = displayBuffer[0];
                  displayBuffer = displayBuffer.slice(1);
                  displayText += char;
                  setOutput(displayText);
                  onChunk?.(char);

                  // No delay for first character, then 40ms delay
                  if (!isFirstChar) {
                    await delayBetweenChars(40);
                  } else {
                    isFirstChar = false;
                  }

                  // Add 400ms pause at sentence boundaries for natural reading rhythm
                  if (char === '.' || char === '!' || char === '?') {
                    // Check if next char is a space (actual sentence end, not abbreviation)
                    if (displayBuffer.length > 0 && displayBuffer[0] === ' ') {
                      await delayBetweenChars(400);
                    }
                  }
                  // Also pause at double newlines
                  if (char === '\n' && displayText.endsWith('\n\n')) {
                    await delayBetweenChars(400);
                  }
                }
              }

              if (data.done) {
                // Flush any buffered sentences (even if < 2)
                if (sentenceBuffer.length > 0 && onSentenceReady) {
                  const batchedText = sentenceBuffer.join(' ');
                  onSentenceReady(batchedText);
                  sentenceBuffer = [];
                }

                // Emit any remaining text that didn't form a complete sentence
                if (lastEmittedIndex < realTextAccumulator.length && onSentenceReady) {
                  const remaining = realTextAccumulator.slice(lastEmittedIndex).trim();
                  if (remaining.length > 0) {
                    onSentenceReady(remaining);
                  }
                }

                setStatus('complete');
                onComplete?.(displayText, transcript);
                return;
              }
            } catch (e) {
              console.warn('Failed to parse SSE data:', line, e);
            }
          }
        }
      }

      // Flush any buffered sentences (even if < 2)
      if (sentenceBuffer.length > 0 && onSentenceReady) {
        const batchedText = sentenceBuffer.join(' ');
        onSentenceReady(batchedText);
        sentenceBuffer = [];
      }

      // Emit any remaining text
      if (lastEmittedIndex < realTextAccumulator.length && onSentenceReady) {
        const remaining = realTextAccumulator.slice(lastEmittedIndex).trim();
        if (remaining.length > 0) {
          onSentenceReady(remaining);
        }
      }

      setStatus('complete');
      onComplete?.(displayText, transcript);

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
  }, [agentName, depth, conversationHistory, onStart, onChunk, onSentenceReady, onComplete, onError]);

  return {
    streamResponse,
    output,
    status,
    error,
    isStreaming: status === 'streaming',
    reset,
  };
}
