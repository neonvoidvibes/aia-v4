import { useEffect, useRef } from 'react';
import { toast } from '@/hooks/use-toast';

interface TranscriptChunk {
  sessionId: string;
  text: string;
  ts: number;
  isFinal: boolean;
}

interface UseTranscriptHealthMonitorProps {
  sessionId: string | null;
  phase: string;
  startedAt: number | undefined;
  onHealthIssueDetected?: () => void;
}

const STALE_THRESHOLD_MS = 120_000; // 2 minutes
const CHECK_INTERVAL_MS = 30_000;    // Check every 30 seconds

/**
 * Monitors transcript timestamp health to detect silent recording failures.
 *
 * If the timer shows recording has been running for 2+ minutes but no transcript
 * chunks have been received recently, this indicates audio is not being captured
 * even though the UI shows it's recording.
 *
 * This is a data-driven safeguard that catches failures missed by connection monitoring.
 */
export function useTranscriptHealthMonitor({
  sessionId,
  phase,
  startedAt,
  onHealthIssueDetected
}: UseTranscriptHealthMonitorProps) {
  const lastTranscriptAt = useRef<number | null>(null);
  const healthCheckTimer = useRef<any>(null);
  const alertShown = useRef(false);
  const warningToastId = useRef<any>(null);

  // Track when transcripts arrive
  const onTranscriptReceived = (chunk: TranscriptChunk) => {
    if (chunk.sessionId === sessionId && chunk.text.trim()) {
      lastTranscriptAt.current = Date.now();

      // Dismiss any existing warning if transcripts are flowing again
      if (warningToastId.current && alertShown.current) {
        try {
          warningToastId.current.dismiss();
          warningToastId.current = null;
          alertShown.current = false;
        } catch {}
      }
    }
  };

  useEffect(() => {
    // Only monitor during active recording
    if (phase !== 'active' || !sessionId || !startedAt) {
      // Clear state when not recording
      lastTranscriptAt.current = null;
      alertShown.current = false;
      if (warningToastId.current) {
        try { warningToastId.current.dismiss(); } catch {}
        warningToastId.current = null;
      }
      if (healthCheckTimer.current) {
        clearInterval(healthCheckTimer.current);
        healthCheckTimer.current = null;
      }
      return;
    }

    // Start health check interval
    healthCheckTimer.current = setInterval(() => {
      const now = Date.now();
      const recordingDuration = now - startedAt;
      const timeSinceLastTranscript = lastTranscriptAt.current
        ? now - lastTranscriptAt.current
        : recordingDuration;

      // Only check if recording has been running long enough
      if (recordingDuration < STALE_THRESHOLD_MS) {
        return; // Too early to check
      }

      // Check if transcripts are stale
      if (timeSinceLastTranscript > STALE_THRESHOLD_MS && !alertShown.current) {
        console.error(
          `[TranscriptHealthMonitor] STALE TRANSCRIPT DETECTED: ` +
          `Recording duration: ${Math.round(recordingDuration / 1000)}s, ` +
          `Time since last transcript: ${Math.round(timeSinceLastTranscript / 1000)}s`
        );

        alertShown.current = true;

        // Show persistent warning
        toast({
          title: "⚠️ Recording may not be capturing audio",
          description: (
            <>
              <p className="mb-2">
                No transcript updates for {Math.round(timeSinceLastTranscript / 60000)} minutes.
              </p>
              <p className="text-sm text-muted-foreground">
                Your audio may not be recording properly. Consider stopping and restarting.
              </p>
            </>
          ),
          variant: "destructive",
          duration: Infinity,
          action: onHealthIssueDetected ? {
            label: 'Stop Recording',
            onClick: onHealthIssueDetected
          } : undefined
        }).then((toastResult) => {
          warningToastId.current = toastResult;
        });

        // Trigger callback if provided
        if (onHealthIssueDetected) {
          onHealthIssueDetected();
        }
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      if (healthCheckTimer.current) {
        clearInterval(healthCheckTimer.current);
        healthCheckTimer.current = null;
      }
    };
  }, [phase, sessionId, startedAt, onHealthIssueDetected]);

  return { onTranscriptReceived };
}
