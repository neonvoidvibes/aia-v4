"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

type UseSilentChunkDetectorOptions = {
  stream: MediaStream | null;
  isActive: boolean;
  // Detection window size in ms (default 10s)
  windowMs?: number;
  // Minimum time between toasts in ms (default 30s)
  cooldownMs?: number;
  // RMS level threshold (0-1) below which we consider the window silent (default ~0.06)
  levelThreshold?: number;
  // Ignore the first N chunks entirely before evaluating silence
  ignoreInitialChunks?: number;
  // Optional: custom message
  message?: string;
};

// Defaults per product request: 10s window, toast no more than once every 30s,
// ignore the first chunk, keep recording uninterrupted.
const DEFAULT_WINDOW_MS = 10_000;
const DEFAULT_COOLDOWN_MS = 30_000;
const DEFAULT_LEVEL_THRESHOLD = 0.06;
const DEFAULT_IGNORE_INITIAL_CHUNKS = 1;

function debugLog(...args: any[]) {
  if (process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console
    console.debug("[SilentDetector]", ...args);
  }
}

// Convert byte time domain data [0..255] to RMS in [0..1]
function computeRmsFromByteData(buf: Uint8Array): number {
  let sumSquares = 0;
  for (let i = 0; i < buf.length; i++) {
    // Center around 128 then normalize to [-1, 1]
    const v = (buf[i] - 128) / 128;
    sumSquares += v * v;
  }
  return Math.sqrt(sumSquares / buf.length);
}

export function useSilentChunkDetector({
  stream,
  isActive,
  windowMs = DEFAULT_WINDOW_MS,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  levelThreshold = DEFAULT_LEVEL_THRESHOLD,
  ignoreInitialChunks = DEFAULT_IGNORE_INITIAL_CHUNKS,
  message = "No mic input detected in the last 10s. Check your mic/input settings?",
}: UseSilentChunkDetectorOptions) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Uint8Array | null>(null);
  const rafRef = useRef<number | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Rolling sample buffer: store [{ t, rms }]
  const samplesRef = useRef<Array<{ t: number; rms: number }>>([]);

  // Toast cooldown and chunk counting
  const lastToastAtRef = useRef<number>(0);
  const chunkCountRef = useRef<number>(0);
  const startAtRef = useRef<number>(0);

  // Reset on activation changes
  useEffect(() => {
    if (!isActive) {
      debugLog('inactive: tearing down');
      // Stop sampling and clean up
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      samplesRef.current = [];
      chunkCountRef.current = 0;
      // do not reset lastToastAt to preserve cooldown across brief toggles
      // teardown audio nodes
      try {
        if (analyserRef.current) analyserRef.current.disconnect();
        if (sourceRef.current) sourceRef.current.disconnect();
      } catch { /* noop */ }
      analyserRef.current = null;
      sourceRef.current = null;
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch(() => {});
      }
      audioContextRef.current = null;
    }
  }, [isActive]);

  // Setup analyser for the given stream
  useEffect(() => {
    if (!isActive || !stream) {
      debugLog('not starting analyser. isActive:', isActive, 'stream:', !!stream);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const AudioCtx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        debugLog('analyser setup start');
        // Try to ensure the context is running (some browsers start as 'suspended')
        if (ctx.state === 'suspended') {
          try { await ctx.resume(); } catch { /* noop */ }
        }
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.8;
        const data = new Uint8Array(analyser.fftSize);
        source.connect(analyser);
        // Keep the audio graph alive without audible output
        try {
          const zeroGain = ctx.createGain();
          zeroGain.gain.value = 0;
          analyser.connect(zeroGain);
          zeroGain.connect(ctx.destination);
        } catch { /* noop */ }

        audioContextRef.current = ctx;
        sourceRef.current = source;
        analyserRef.current = analyser;
        dataRef.current = data;

        // Mark sampling start time
        startAtRef.current = performance.now();

        const sample = () => {
          if (cancelled || !analyserRef.current || !dataRef.current) return;
          analyserRef.current.getByteTimeDomainData(dataRef.current);
          const rms = computeRmsFromByteData(dataRef.current);
          const now = performance.now();
          samplesRef.current.push({ t: now, rms });
          // Keep a small margin of past window to handle timer jitter
          const horizon = now - (windowMs + 2000);
          while (samplesRef.current.length && samplesRef.current[0].t < horizon) {
            samplesRef.current.shift();
          }
          rafRef.current = requestAnimationFrame(sample);
        };
        rafRef.current = requestAnimationFrame(sample);
        debugLog('analyser setup complete; sampling started');

        // Periodic evaluation fallback (in case ondataavailable boundaries aren't called)
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = setInterval(() => {
          // Ensure we have at least some fresh sample even if rAF is throttled
          if (analyserRef.current && dataRef.current) {
            analyserRef.current.getByteTimeDomainData(dataRef.current);
            const rms = computeRmsFromByteData(dataRef.current);
            const t = performance.now();
            samplesRef.current.push({ t, rms });
            const horizon = t - (windowMs + 2000);
            while (samplesRef.current.length && samplesRef.current[0].t < horizon) {
              samplesRef.current.shift();
            }
          }
          // Only evaluate if we have at least ~windowMs of samples since activation
          const now = performance.now();
          const oldest = samplesRef.current[0]?.t ?? 0;
          const newest = samplesRef.current[samplesRef.current.length - 1]?.t ?? 0;
          const enoughWindow = newest - oldest >= windowMs - 100;
          const pastGrace = now - startAtRef.current >= windowMs + 200; // allow first full window
          if (enoughWindow && pastGrace) {
            // Evaluate using same logic and cooldown
            const windowStart = now - windowMs;
            const windowSamples = samplesRef.current.filter((s) => s.t >= windowStart);
            let maxRms = 0;
            for (const s of windowSamples) if (s.rms > maxRms) maxRms = s.rms;
            const isSilent = maxRms < levelThreshold;
            if (isSilent) {
              const lastToastAt = lastToastAtRef.current || 0;
              if (now - lastToastAt >= cooldownMs) {
                lastToastAtRef.current = now;
                toast.info(message, { duration: 4000 });
                debugLog("[timer] Silent window detected, toast shown", { maxRms: maxRms.toFixed(3), windowMs });
              } else {
                debugLog("[timer] Silent window detected, within cooldown", { maxRms: maxRms.toFixed(3) });
              }
            } else {
              debugLog("[timer] Non-silent window", { maxRms: maxRms.toFixed(3) });
            }
          }
        }, 1000);
      } catch (err) {
        debugLog("Analyser setup failed", err);
      }
    })();

    return () => {
      cancelled = true;
      debugLog('cleanup analyser');
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      try {
        if (analyserRef.current) analyserRef.current.disconnect();
        if (sourceRef.current) sourceRef.current.disconnect();
      } catch { /* noop */ }
      analyserRef.current = null;
      sourceRef.current = null;
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch(() => {});
      }
      audioContextRef.current = null;
    };
  }, [stream, isActive, windowMs]);

  const onChunkBoundary = useCallback(() => {
    if (!isActive) return { isSilent: false };
    chunkCountRef.current += 1;
    if (chunkCountRef.current <= ignoreInitialChunks) {
      debugLog("Ignoring initial chunk", chunkCountRef.current);
      return { isSilent: false };
    }

    const now = performance.now();
    const windowStart = now - windowMs;
    const windowSamples = samplesRef.current.filter((s) => s.t >= windowStart);
    if (windowSamples.length === 0) return { isSilent: false };

    let maxRms = 0;
    for (const s of windowSamples) {
      if (s.rms > maxRms) maxRms = s.rms;
    }
    const isSilent = maxRms < levelThreshold;

    if (isSilent) {
      const lastToastAt = lastToastAtRef.current || 0;
      if (now - lastToastAt >= cooldownMs) {
        lastToastAtRef.current = now;
        toast.info(message, { duration: 4000 });
        debugLog("Silent window detected, toast shown", { maxRms: maxRms.toFixed(3), windowMs });
      } else {
        debugLog("Silent window detected, within cooldown", { maxRms: maxRms.toFixed(3) });
      }
    } else {
      debugLog("Non-silent window", { maxRms: maxRms.toFixed(3) });
    }

    return { isSilent };
  }, [cooldownMs, ignoreInitialChunks, isActive, levelThreshold, message, windowMs]);

  const resetDetector = useCallback(() => {
    samplesRef.current = [];
    chunkCountRef.current = 0;
    // Do not reset lastToastAt so cooldown persists across resets unless explicitly desired
  }, []);

  return { onChunkBoundary, resetDetector };
}
