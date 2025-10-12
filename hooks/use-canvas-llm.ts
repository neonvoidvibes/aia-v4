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
  forceRefreshAnalysis?: boolean; // Force refresh analysis documents
  clearPrevious?: boolean; // Clear previous analysis on new meeting/context
  individualRawTranscriptToggleStates?: Record<string, boolean>; // For "some" mode
  transcriptListenMode?: 'none' | 'latest' | 'some' | 'all'; // Transcript mode
  groupsReadMode?: 'none' | 'latest' | 'all' | 'breakout'; // Groups mode
  onStart?: () => void;
  onChunk?: (chunk: string) => void;
  onSentenceReady?: (sentence: string) => void; // Triggered on sentence boundary for TTS
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
  forceRefreshAnalysis = false,
  clearPrevious = false,
  individualRawTranscriptToggleStates = {},
  transcriptListenMode = 'latest',
  groupsReadMode = 'none',
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

      // DEBUG: Log toggle states being sent
      if (individualRawTranscriptToggleStates && Object.keys(individualRawTranscriptToggleStates).length > 0) {
        console.log('[Canvas Hook DEBUG] Sending toggle states:', {
          count: Object.keys(individualRawTranscriptToggleStates).length,
          keys: Object.keys(individualRawTranscriptToggleStates).slice(0, 3),
          sample: Object.entries(individualRawTranscriptToggleStates).slice(0, 2)
        });
      }

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
          forceRefreshAnalysis,
          clearPrevious,
          individualRawTranscriptToggleStates,
          transcriptListenMode,  // FIXED: Send mode in request
          groupsReadMode,        // FIXED: Send mode in request
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
              onSentenceReady(sentence);
              currentIndex = match.index + match[0].length;
            }
          }
        }

        // Helper: Find last word boundary before maxIndex to avoid mid-word splits
        const findLastWordBoundary = (str: string, maxIndex: number): number => {
          if (maxIndex >= str.length) return str.length;

          // Look for last whitespace (space, newline, tab) before maxIndex
          const beforeMax = str.slice(0, maxIndex);
          const lastSpace = Math.max(
            beforeMax.lastIndexOf(' '),
            beforeMax.lastIndexOf('\n'),
            beforeMax.lastIndexOf('\t')
          );

          // If we found a space, split after it; otherwise use maxIndex as fallback
          return lastSpace > 0 ? lastSpace + 1 : maxIndex;
        };

        // Fallback strategies for text that doesn't have clear sentence boundaries
        const remaining = text.slice(currentIndex);

        // 1. Long text without punctuation (150+ chars) - WORD BOUNDARY AWARE
        if (remaining.length > 150) {
          // Find last word boundary before char 150 to avoid splitting mid-word
          const splitPoint = findLastWordBoundary(remaining, 150);
          const chunk = remaining.slice(0, splitPoint).trim();

          if (chunk.length > 10) {
            console.log('[Canvas TTS] Emitting long text at word boundary (150+ chars):', chunk.substring(0, 50) + '...');
            onSentenceReady(chunk);
            currentIndex += splitPoint;
          }
        }
        // 2. Text with substantial content and any punctuation (50+ chars)
        // This catches paragraphs after breaks and partial sentences
        else if (remaining.length > 50 && /[.!?]/.test(remaining)) {
          console.log('[Canvas TTS] Emitting substantial text (50+ chars with punctuation):', remaining.substring(0, 50) + '...');
          onSentenceReady(remaining);
          currentIndex = text.length;
        }
        // 3. Text ends with sentence punctuation (even short sentences, 10+ chars)
        else if (remaining.length > 10 && /[.!?]\s*$/.test(remaining)) {
          console.log('[Canvas TTS] Emitting sentence ending with punctuation:', remaining.substring(0, 50) + '...');
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
                // Emit any remaining text that didn't form a complete sentence
                if (lastEmittedIndex < realTextAccumulator.length && onSentenceReady) {
                  const remaining = realTextAccumulator.slice(lastEmittedIndex).trim();
                  if (remaining.length > 0) {
                    console.log('[Canvas TTS] Cleanup: Emitting remaining text from data.done:', remaining.substring(0, 50) + '...');
                    onSentenceReady(remaining);
                  }
                } else {
                  console.log('[Canvas TTS] Cleanup: No remaining text to emit (lastEmittedIndex:', lastEmittedIndex, 'accumulator length:', realTextAccumulator.length, ')');
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

      // Emit any remaining text (fallback after while loop)
      if (lastEmittedIndex < realTextAccumulator.length && onSentenceReady) {
        const remaining = realTextAccumulator.slice(lastEmittedIndex).trim();
        if (remaining.length > 0) {
          console.log('[Canvas TTS] Final cleanup: Emitting remaining text:', remaining.substring(0, 50) + '...');
          onSentenceReady(remaining);
        }
      } else {
        console.log('[Canvas TTS] Final cleanup: No remaining text to emit');
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
  }, [agentName, depth, conversationHistory, forceRefreshAnalysis, clearPrevious, individualRawTranscriptToggleStates, transcriptListenMode, groupsReadMode, onStart, onChunk, onSentenceReady, onComplete, onError]);

  return {
    streamResponse,
    output,
    status,
    error,
    isStreaming: status === 'streaming',
    reset,
  };
}
