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

// Mobile recording feature flag
// Source: env var NEXT_PUBLIC_MOBILE_RECORDING_ENABLED or localStorage key 'recording.mobile.enabled'
export function isMobileRecordingEnabled(): boolean {
  try {
    if (typeof window !== 'undefined') {
      const ls = window.localStorage?.getItem('recording.mobile.enabled');
      if (ls != null) return ls === 'true';
    }
  } catch {}

  const env = process.env.NEXT_PUBLIC_MOBILE_RECORDING_ENABLED;
  if (env != null) return String(env).toLowerCase() === 'true';
  return false;
}

// Transcription pause toast feature flag
// Source: env var NEXT_PUBLIC_TRANSCRIPTION_PAUSE_TOAST_ENABLED or localStorage key 'transcription.pause.toast.enabled'
export function isTranscriptionPauseToastEnabled(): boolean {
  try {
    if (typeof window !== 'undefined') {
      const ls = window.localStorage?.getItem('transcription.pause.toast.enabled');
      if (ls != null) return ls === 'true';
    }
  } catch {}

  const env = process.env.NEXT_PUBLIC_TRANSCRIPTION_PAUSE_TOAST_ENABLED;
  if (env != null) return String(env).toLowerCase() === 'true';
  return true; // default enabled
}

