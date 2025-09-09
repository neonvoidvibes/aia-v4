import { isRecordingPersistenceEnabled } from './featureFlags';
import { HEARTBEAT_INTERVAL_MS } from './wsPolicy';

export type RecordingPhase = 'idle'|'starting'|'active'|'suspended'|'stopping'|'error';
export type RecordingType = 'chat'|'note';

export interface RecordingState {
  phase: RecordingPhase;
  sessionId?: string;
  ownerTabId?: string;
  type?: RecordingType;
  chatId?: string;
  startedAt?: number;
  error?: { code: string; message: string } | null;
  paused?: boolean;
}

export interface TranscriptChunk {
  sessionId: string;
  chatId?: string;
  text: string;
  ts: number;
  isFinal: boolean;
}

export interface RecordingManager {
  start(opts: { type: RecordingType; chatId?: string; agentName?: string; eventId?: string | null }): Promise<{ sessionId: string }>;
  stop(): Promise<void>;
  attachToExisting(sessionId: string): Promise<void>; // rebind to active session
  setCurrentChat(chatId: string): void;               // routing hint
  getState(): RecordingState;
  getStream(): MediaStream | null;                    // expose current mic stream for analysis UI
  subscribe(fn: (s: RecordingState) => void): () => void;
  onTranscript(fn: (c: TranscriptChunk) => void): () => void;
  requestTakeover(): Promise<boolean>;                // cross‑tab
  pause(): void;                                      // pause local MediaRecorder + signal backend
  resume(): void;                                     // resume local MediaRecorder + signal backend
}

// Storage keys
const ACTIVE_KEY = 'activeRecording';
const LAST_SEEN_CHAT_KEY = 'recording.lastSeenChatId';
const LAST_HEARTBEAT_KEY = 'recording.lastHeartbeatAt';

type ActiveMeta = {
  sessionId: string;
  ownerTabId: string;
  startedAt: number;
  type: RecordingType;
  agentName?: string | null;
  chatId?: string;
  eventId?: string | null;
};

class RecordingManagerImpl implements RecordingManager {
  private state: RecordingState = { phase: 'idle', error: null };
  private subs = new Set<(s: RecordingState) => void>();
  private transcriptSubs = new Set<(c: TranscriptChunk) => void>();
  private bc: BroadcastChannel | null = null;
  private tabId: string;
  private hbTimer: any = null;
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private ws: WebSocket | null = null;
  private wsUrl: string | null = null;
  private pendingTakeoverResolve: ((v: boolean) => void) | null = null;

  constructor() {
    // Make a stable tab id per session
    const existing = typeof window !== 'undefined' ? window.sessionStorage.getItem('tabId') : null;
    this.tabId = existing || crypto.randomUUID();
    if (typeof window !== 'undefined' && !existing) {
      window.sessionStorage.setItem('tabId', this.tabId);
    }
    if (typeof window !== 'undefined') {
      try { this.wsUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL || null; } catch { this.wsUrl = null; }
      this.initBroadcast();
      // If page reload with active session, keep state minimal until attach
      const active = this.readActive();
      if (active) {
      this.update({
        phase: 'suspended',
        sessionId: active.sessionId,
        ownerTabId: active.ownerTabId,
        type: active.type,
        chatId: active.chatId,
        startedAt: active.startedAt,
        error: null,
        paused: false,
      });
      }
    }
  }

  getState(): RecordingState { return this.state; }
  getStream(): MediaStream | null { return this.stream; }

  subscribe(fn: (s: RecordingState) => void): () => void {
    this.subs.add(fn);
    fn(this.state);
    return () => { this.subs.delete(fn); };
  }

  onTranscript(fn: (c: TranscriptChunk) => void): () => void {
    this.transcriptSubs.add(fn);
    return () => { this.transcriptSubs.delete(fn); };
  }

  setCurrentChat(chatId: string) {
    const meta = this.readActive();
    if (meta) {
      meta.chatId = chatId;
      this.writeActive(meta);
    }
    this.update({ ...this.state, chatId });
    try { localStorage.setItem(LAST_SEEN_CHAT_KEY, chatId); } catch {}
    this.post({ kind: 'status', phase: this.state.phase, canAttach: true, chatId });
  }

  async start(opts: { type: RecordingType; chatId?: string; agentName?: string; eventId?: string | null }): Promise<{ sessionId: string }> {
    if (!isRecordingPersistenceEnabled()) {
      throw new Error('Persistence flag disabled');
    }
    if (!opts.agentName) throw new Error('Agent name required');
    if (!this.wsUrl) throw new Error('WebSocket URL not configured');

    const existing = this.readActive();
    if (existing) {
      // If owner looks alive, request stop or takeover
      const lastHb = this.readLastHb();
      const stale = Date.now() - lastHb > 5000;
      if (!stale && existing.ownerTabId !== this.tabId) {
        const granted = await this.requestTakeover();
        if (!granted) throw new Error('Owner denied takeover');
      }
      // Stop old before starting new
      await this.stop().catch(() => {});
    }

    this.update({ phase: 'starting', error: null });

    // Start server-side session via proxy (JSON body with action + payload + auth)
    const { createClient } = await import('@/utils/supabase/client');
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      this.update({ phase: 'error', error: { code: 'auth', message: 'Not authenticated' } });
      throw new Error('Authentication required');
    }
    // Prefer agent-scoped transcription language if present
    let transcriptionLanguage = 'any';
    try {
      if (typeof window !== 'undefined' && opts.agentName) {
        const k = `transcriptionLanguageSetting_${opts.agentName}`;
        const v = window.localStorage.getItem(k);
        if (v) transcriptionLanguage = v as string;
      }
    } catch {}

    const res = await fetch(`/api/recording-proxy/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: 'start', payload: { agent: opts.agentName, event: opts.eventId || '0000', transcriptionLanguage } }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.session_id) {
      const msg = data?.message || data?.error || 'Failed to start recording';
      this.update({ phase: 'error', error: { code: 'start_failed', message: msg } });
      throw new Error(msg);
    }

    const sessionId: string = data.session_id;
    const startedAt: number = Date.now();
    const meta: ActiveMeta = {
      sessionId,
      ownerTabId: this.tabId,
      startedAt,
      type: opts.type,
      agentName: opts.agentName || null,
      chatId: opts.chatId,
      eventId: opts.eventId ?? null,
    };
    this.writeActive(meta);
    this.update({ phase: 'starting', sessionId, ownerTabId: this.tabId, type: opts.type, chatId: opts.chatId, startedAt, error: null });
    this.post({ kind: 'status', phase: 'starting', canAttach: false, chatId: opts.chatId });

    await this.bindMediaAndWs(sessionId);
    return { sessionId };
  }

  async stop(): Promise<void> {
    const { sessionId } = this.state;
    if (!sessionId) return;
    this.update({ ...this.state, phase: 'stopping' });
    this.post({ kind: 'stop:request', reason: 'manual', requesterTabId: this.tabId });
    try { await this.performStop(sessionId); } finally { this.cleanupAll('idle'); }
  }

  async attachToExisting(sessionId: string): Promise<void> {
    if (!isRecordingPersistenceEnabled()) return;
    const meta = this.readActive();
    if (!meta || meta.sessionId !== sessionId) return;
    const lastHb = this.readLastHb();
    const stale = Date.now() - lastHb > 5000;
    if (stale || meta.ownerTabId === this.tabId) {
      // take ownership silently
      meta.ownerTabId = this.tabId;
      this.writeActive(meta);
      this.update({ phase: 'starting', sessionId: meta.sessionId, ownerTabId: this.tabId, type: meta.type, chatId: meta.chatId, startedAt: meta.startedAt, error: null });
      await this.bindMediaAndWs(meta.sessionId);
      return;
    }
    // viewer mode: do not request mic; just reflect status
    this.update({ phase: 'active', sessionId: meta.sessionId, ownerTabId: meta.ownerTabId, type: meta.type, chatId: meta.chatId, startedAt: meta.startedAt, error: null });
  }

  async requestTakeover(): Promise<boolean> {
    if (!this.bc) return false;
    return new Promise<boolean>((resolve) => {
      this.pendingTakeoverResolve = resolve;
      this.post({ kind: 'takeover:request', requesterTabId: this.tabId });
      // timeout after 2.5s
      setTimeout(() => {
        if (this.pendingTakeoverResolve) {
          this.pendingTakeoverResolve(false);
          this.pendingTakeoverResolve = null;
        }
      }, 2500);
    });
  }

  // Pause/resume controls (persistence mode)
  pause(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      try { this.mediaRecorder.pause(); } catch {}
      // onpause handler will update state and signal backend
    }
  }

  resume(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      try { this.mediaRecorder.resume(); } catch {}
      // onresume handler will update state and signal backend
    }
  }

  // Internal helpers
  private update(next: RecordingState) {
    this.state = next;
    for (const fn of this.subs) fn(this.state);
  }

  private emitTranscript(c: TranscriptChunk) {
    for (const fn of this.transcriptSubs) fn(c);
  }

  private initBroadcast() {
    try {
      this.bc = new BroadcastChannel('recording');
      this.bc.onmessage = (ev) => this.onBroadcast(ev.data);
    } catch {
      this.bc = null;
    }
  }

  private post(msg: any) {
    try { this.bc?.postMessage({ ...msg, sessionId: this.state.sessionId }); } catch {}
  }

  private onBroadcast(msg: any) {
    if (!msg || typeof msg !== 'object') return;
    const kind = msg.kind;
    if (kind === 'hb') {
      try { localStorage.setItem(LAST_HEARTBEAT_KEY, String(Date.now())); } catch {}
      return;
    }
    if (kind === 'status') {
      // could be used for passive views
      return;
    }
    if (kind === 'takeover:request') {
      const active = this.readActive();
      if (!active || active.ownerTabId !== this.tabId) return; // not owner
      // grant and stop locally so requester can become owner
      this.post({ kind: 'takeover:grant' });
      // Close producer cleanly but do not clear localStorage (new owner will overwrite)
      this.cleanupMediaAndWsOnly();
      return;
    }
    if (kind === 'takeover:grant' || kind === 'takeover:deny') {
      if (this.pendingTakeoverResolve) {
        this.pendingTakeoverResolve(kind === 'takeover:grant');
        this.pendingTakeoverResolve = null;
      }
      return;
    }
    if (kind === 'stop:request') {
      const active = this.readActive();
      if (!active || active.ownerTabId !== this.tabId) return;
      // Owner should stop
      if (this.state.sessionId) {
        void this.stop();
      }
      return;
    }
    if (kind === 'stopped') {
      // Passive tabs reflect idle state
      this.cleanupAll('idle');
      return;
    }
  }

  private readActive(): ActiveMeta | null {
    try {
      const raw = localStorage.getItem(ACTIVE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }
  private writeActive(meta: ActiveMeta | null) {
    try {
      if (!meta) localStorage.removeItem(ACTIVE_KEY);
      else localStorage.setItem(ACTIVE_KEY, JSON.stringify(meta));
    } catch {}
  }
  private readLastHb(): number {
    try { return Number(localStorage.getItem(LAST_HEARTBEAT_KEY) || 0); } catch { return 0; }
  }

  private async bindMediaAndWs(sessionId: string) {
    // Acquire auth
    const { createClient } = await import('@/utils/supabase/client');
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      this.update({ phase: 'error', sessionId, error: { code: 'auth', message: 'Not authenticated' } });
      throw new Error('Authentication required');
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      try { console.debug('[RM] stream acquired'); } catch {}
    } catch (e:any) {
      this.update({ phase: 'error', sessionId, error: { code: 'mic_denied', message: 'Microphone denied' } });
      throw e;
    }
    const mr = new MediaRecorder(this.stream!, { mimeType: 'audio/webm' });
    this.mediaRecorder = mr;
    const ws = new WebSocket(`${this.wsUrl}/ws/audio_stream/${sessionId}?token=${session.access_token}`);
    this.ws = ws;

    ws.onopen = () => {
      try { this.startHeartbeat(); } catch {}
      mr.start(3000);
      this.update({ ...this.state, phase: 'active', paused: false });
    };
    mr.ondataavailable = (ev) => {
      if (ev.data?.size > 0 && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(ev.data);
      }
    };
    mr.onpause = () => {
      // reflect paused state
      this.update({ ...this.state, paused: true });
      try {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ action: 'set_processing_state', paused: true }));
        }
      } catch {}
    };
    mr.onresume = () => {
      // reflect resumed state
      this.update({ ...this.state, paused: false });
      try {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ action: 'set_processing_state', paused: false }));
        }
      } catch {}
    };
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m && (m.type === 'transcript' || m.kind === 'transcript')) {
          const text = m.text || m.data?.text || '';
          if (text) {
            this.emitTranscript({ sessionId, chatId: this.state.chatId, text, ts: Date.now(), isFinal: !!m.isFinal });
          }
        }
      } catch { /* ignore non-JSON */ }
    };
    ws.onclose = () => {
      this.stopHeartbeat();
      // If we are still marked owner, go suspended to allow reconnect/reattach
      const active = this.readActive();
      if (active && active.ownerTabId === this.tabId) {
        this.update({ ...this.state, phase: 'suspended', paused: false });
      }
    };
    ws.onerror = () => {
      this.update({ ...this.state, phase: 'error', error: { code: 'ws', message: 'WebSocket error' } });
    };
  }

  private async performStop(sessionId: string) {
    try {
      // Signal ws first for flush
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try { this.ws.send(JSON.stringify({ action: 'stop_stream' })); } catch {}
      }
      const { data: { session } } = await (createClient()).auth.getSession();
      const authHeader = session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {};
      await fetch(`/api/recording-proxy/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ action: 'stop', payload: { session_id: sessionId } }),
      }).catch(() => {});
    } finally {
      this.post({ kind: 'stopped' });
    }
  }

  private cleanupMediaAndWsOnly() {
    try { this.stopHeartbeat(); } catch {}
    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
    } catch {}
    try { this.stream?.getTracks().forEach(t => t.stop()); } catch {}
    try { console.debug('[RM] stream cleared'); } catch {}
    this.stream = null;
    this.mediaRecorder = null;
    try {
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        (this.ws as any).__intentionalClose = true;
        this.ws.close(1000, 'owner handoff/stop');
      }
    } catch {}
    this.ws = null;
  }

  private cleanupAll(toPhase: RecordingPhase) {
    this.cleanupMediaAndWsOnly();
    this.writeActive(null);
    this.update({ phase: toPhase, error: null, paused: false });
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.hbTimer = setInterval(() => {
      try { localStorage.setItem(LAST_HEARTBEAT_KEY, String(Date.now())); } catch {}
      this.post({ kind: 'hb', ownerTabId: this.tabId, ts: Date.now() });
    }, Math.max(2000, HEARTBEAT_INTERVAL_MS || 2000));
  }
  private stopHeartbeat() {
    if (this.hbTimer) {
      clearInterval(this.hbTimer);
      this.hbTimer = null;
    }
  }
}

export const manager: RecordingManager = new RecordingManagerImpl();
