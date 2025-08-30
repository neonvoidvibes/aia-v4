// Simple feature flag helper
// Source: env var NEXT_PUBLIC_RECORDING_PERSISTENCE_ENABLED or localStorage key 'recording.persistence.enabled'

export function isRecordingPersistenceEnabled(): boolean {
  try {
    if (typeof window !== 'undefined') {
      const ls = window.localStorage?.getItem('recording.persistence.enabled');
      if (ls != null) return ls === 'true';
    }
  } catch {}

  const env = process.env.NEXT_PUBLIC_RECORDING_PERSISTENCE_ENABLED;
  if (env != null) return String(env).toLowerCase() === 'true';
  return false;
}

