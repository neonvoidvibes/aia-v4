// WebSocket policy: heartbeat + reconnect
// Target behavior:
// - Heartbeat tolerant to timer clamping/jitter
// - Capped, decorrelated-jitter backoff (AWS style)
// - Short cap while actively recording to avoid long stalls
export const HEARTBEAT_INTERVAL_MS = 20000;  // 20s
export const PONG_TIMEOUT_MS = 15000;        // 15s
export const MAX_HEARTBEAT_MISSES = 3;       // ~45–60s grace

// Triple thresholds in background or with Data Saver enabled
export function adjusted(ms: number): number {
  try {
    const hidden = typeof document !== "undefined" && document.hidden;
    const saveData =
      typeof navigator !== "undefined" &&
      // @ts-ignore - connection is not fully typed across browsers
      !!(navigator as any).connection?.saveData;
    return (hidden || saveData) ? ms * 3 : ms;
  } catch {
    return ms;
  }
}

// Decorrelated jitter backoff with a hard cap.
// See: "Exponential Backoff And Jitter" (AWS Architecture Blog).
export function nextReconnectDelay(
  prevMs: number | null,
  opts: { isRecording: boolean }
): number {
  const base = 1000; // 1s
  const cap  = opts.isRecording ? 5000 : 15000; // 5s cap while recording, 15s otherwise
  const prev = prevMs ?? base;
  const min  = Math.min(cap, prev);
  const max  = Math.min(cap, prev * 3);
  const r    = Math.random();
  const jitter = Math.floor(min + r * (max - min));
  return Math.max(1000, Math.min(cap, jitter));
}