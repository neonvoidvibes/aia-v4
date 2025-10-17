const SESSION_KEY = 'canvasAudioUnlocked';

let runtimeUnlocked = false;
let unlockPromise: Promise<boolean> | null = null;
let sharedAudioContext: AudioContext | null = null;

function inBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

export function isCanvasAudioUnlocked(): boolean {
  if (runtimeUnlocked) return true;
  if (!inBrowser()) return false;

  try {
    return window.sessionStorage?.getItem(SESSION_KEY) === 'true';
  } catch (error) {
    console.warn('[Canvas Audio] sessionStorage read failed:', error);
    return false;
  }
}

export function markCanvasAudioLocked(): void {
  runtimeUnlocked = false;
  if (!inBrowser()) return;

  try {
    window.sessionStorage?.removeItem(SESSION_KEY);
  } catch (error) {
    console.warn('[Canvas Audio] sessionStorage remove failed:', error);
  }
}

async function tryResumeAudioContext(): Promise<boolean> {
  if (!inBrowser()) return false;

  const AudioContextClass: typeof AudioContext | undefined =
    (window as any).AudioContext || (window as any).webkitAudioContext;

  if (!AudioContextClass) return false;

  try {
    if (!sharedAudioContext) {
      sharedAudioContext = new AudioContextClass();
    }

    if (sharedAudioContext.state === 'suspended') {
      await sharedAudioContext.resume();
    }

    // Play a short silent buffer to fully unlock output
    const buffer = sharedAudioContext.createBuffer(
      1,
      Math.max(1, Math.floor(sharedAudioContext.sampleRate / 50)),
      sharedAudioContext.sampleRate
    );
    const source = sharedAudioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(sharedAudioContext.destination);
    source.start();
    source.stop(sharedAudioContext.currentTime + 0.02);

    return true;
  } catch (error) {
    console.warn('[Canvas Audio] AudioContext unlock failed:', error);
    return false;
  }
}

async function trySilentElement(): Promise<boolean> {
  if (!inBrowser()) return false;

  try {
    const silentAudio = new Audio();
    silentAudio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAACJWAAAAAEASW5mbwAAAA8AAAACAAACAAACAAAASW5mbyBkYXRhAAAAAA==';
    silentAudio.muted = true;
    silentAudio.volume = 0;
    silentAudio.loop = false;
    (silentAudio as any).playsInline = true;

    // Even if this rejects (e.g., due to lack of user gesture), allow caller to handle it.
    await silentAudio.play();
    silentAudio.pause();
    return true;
  } catch (error) {
    console.warn('[Canvas Audio] Silent element unlock failed:', error);
    return false;
  }
}

export async function unlockCanvasAudio(): Promise<boolean> {
  if (runtimeUnlocked) {
    return true;
  }

  if (!inBrowser()) {
    return false;
  }

  if (unlockPromise) {
    return unlockPromise;
  }

  unlockPromise = (async () => {
    const results = await Promise.allSettled([
      tryResumeAudioContext(),
      trySilentElement(),
    ]);

    const succeeded = results.some(result => result.status === 'fulfilled' && result.value);

    if (succeeded) {
      runtimeUnlocked = true;
      try {
        window.sessionStorage?.setItem(SESSION_KEY, 'true');
      } catch (error) {
        console.warn('[Canvas Audio] sessionStorage write failed:', error);
      }
    }

    unlockPromise = null;
    return succeeded;
  })();

  return unlockPromise;
}
