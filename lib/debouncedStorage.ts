/**
 * Debounced localStorage utility to batch write operations
 * Reduces main thread blocking from cascading localStorage writes
 */

const _pendingWrites: Record<string, string> = {};
let _flushTimer: NodeJS.Timeout | null = null;

export function debouncedSetItem(key: string, value: string) {
  _pendingWrites[key] = value;

  if (_flushTimer) clearTimeout(_flushTimer);

  _flushTimer = setTimeout(() => {
    Object.entries(_pendingWrites).forEach(([k, v]) => {
      try {
        localStorage.setItem(k, v);
      } catch (e) {
        console.warn('localStorage write failed:', k, e);
      }
    });
    Object.keys(_pendingWrites).forEach(k => delete _pendingWrites[k]);
  }, 100); // 100ms debounce
}

export function debouncedGetItem(key: string): string | null {
  // Check pending writes first (read-your-own-writes consistency)
  if (key in _pendingWrites) {
    return _pendingWrites[key];
  }
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.warn('localStorage read failed:', key, e);
    return null;
  }
}

export function flushPendingWrites() {
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  Object.entries(_pendingWrites).forEach(([k, v]) => {
    try {
      localStorage.setItem(k, v);
    } catch (e) {
      console.warn('localStorage flush failed:', k, e);
    }
  });
  Object.keys(_pendingWrites).forEach(k => delete _pendingWrites[k]);
}
