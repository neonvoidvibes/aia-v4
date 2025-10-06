import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner'; // or your existing toast; must support { id, duration: Infinity }

type PingShape = {
  type?: string; action?: string;
  ts?: number; t?: number;
  is_recording?: boolean;
  audio_ms?: number;
  ws_connected?: boolean;
};

export function useAuthoritativeRecordingTimer(
  ws: WebSocket | null,
  sessionId: string,
  maxSilenceMs = 90_000,
  stickyId = 'rec-paused'
) {
  const server = useRef({ isRecording: false, audioMs: 0, lastPingAt: 0, wsConnected: false });
  const [displayMs, setDisplayMs] = useState(0);
  const [authoritativeRecording, setAuthoritativeRecording] = useState(false);

  const showSticky = (msg: string) => {
    toast(msg, { id: stickyId, duration: Infinity });
  };
  const dismissSticky = () => toast.dismiss(stickyId);

  // WS messages drive truth
  useEffect(() => {
    if (!ws) return;
    const onMsg = (e: MessageEvent) => {
      let m: PingShape;
      try { m = JSON.parse(e.data); } catch { return; }
      if (!(m?.type === 'ping' || m?.action === 'ping' || m?.type === 'pong' || m?.action === 'pong')) return;

      const now = Date.now();
      server.current.lastPingAt = now;

      if (m.type === 'ping' || m.action === 'ping') {
        try { ws.send(JSON.stringify({ type: 'pong' })); } catch {}
      }
      if (typeof m.is_recording === 'boolean') server.current.isRecording = m.is_recording;
      if (typeof m.audio_ms === 'number') server.current.audioMs = Math.max(0, m.audio_ms);
      if (typeof m.ws_connected === 'boolean') server.current.wsConnected = m.ws_connected;

      const ticking = server.current.isRecording && server.current.wsConnected;
      setAuthoritativeRecording(ticking);
      if (ticking) dismissSticky();
    };
    ws.addEventListener('message', onMsg);
    return () => ws.removeEventListener('message', onMsg);
  }, [ws]);

  // WS close → pause UI, sticky toast
  useEffect(() => {
    if (!ws) return;
    const onClose = () => {
      setAuthoritativeRecording(false);
      showSticky('Connection lost. Recording paused.');
    };
    ws.addEventListener('close', onClose);
    return () => ws.removeEventListener('close', onClose);
  }, [ws]);

  // Visibility regain → poll backend status once
  useEffect(() => {
    const onVis = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await fetch(`/api/recording/status?session=${encodeURIComponent(sessionId)}`);
        const s = await r.json();
        server.current.isRecording = !!s.is_recording;
        server.current.audioMs = Number(s.audio_ms || 0);
        server.current.wsConnected = !!s.ws_connected;
        setAuthoritativeRecording(server.current.isRecording && server.current.wsConnected);
        if (server.current.isRecording && server.current.wsConnected) dismissSticky();
        else showSticky('Connection lost. Recording paused.');
      } catch {
        // keep sticky, no state change
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [sessionId]);

  // UI timer tick, strictly derived from server truth
  useEffect(() => {
    let id: number | null = null;
    const tick = () => {
      const { isRecording, wsConnected, audioMs, lastPingAt } = server.current;
      if (isRecording && wsConnected) {
        const base = audioMs;
        const elapsed = Math.max(0, Date.now() - lastPingAt);
        setDisplayMs(base + elapsed);
      } else {
        setDisplayMs(server.current.audioMs);
      }
      // silence watchdog
      if (Date.now() - server.current.lastPingAt > maxSilenceMs) {
        if (authoritativeRecording) setAuthoritativeRecording(false);
        showSticky('Connection lost. Recording paused.');
      }
      id = window.setTimeout(tick, 1000) as unknown as number;
    };
    tick();
    return () => { if (id) window.clearTimeout(id); };
  }, [authoritativeRecording, maxSilenceMs]);

  return { displayMs, authoritativeRecording };
}
