// Minimal, best-effort Screen Wake Lock helper for mobile recording.
// Safe to import on server; all access to navigator is guarded.
let sentinel: any | null = null;

export async function acquireWakeLock(): Promise<boolean> {
  try {
    // SSR/unsupported guard
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return false;
    // Must be called in a user-gesture chain
    sentinel = await (navigator as any).wakeLock.request('screen');
    sentinel?.addEventListener?.('release', () => {
      sentinel = null;
    });
    return true;
  } catch {
    sentinel = null;
    return false;
  }
}

export async function releaseWakeLock(): Promise<void> {
  try {
    await sentinel?.release?.();
  } catch {
    // no-op
  } finally {
    sentinel = null;
  }
}