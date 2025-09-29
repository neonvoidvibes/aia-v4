// Enhanced Mobile Recording Manager with Resilient WebSocket Connection
// Extends the existing MobileRecordingManager with network resilience capabilities

import {
  detectAudioCapabilities,
  createAudioHeader,
  PCMAudioProcessor,
  float32ToPCM16,
  AudioCapabilities,
  AudioHeader,
  encodePCMFrame,
  PCMFrameEnvelope
} from './mobileRecordingCapabilities';
import { isMobileRecordingEnabled } from './featureFlags';
import { acquireWakeLock, releaseWakeLock } from './wakeLock';
import { HEARTBEAT_INTERVAL_MS, PONG_TIMEOUT_MS, MAX_HEARTBEAT_MISSES } from './wsPolicy';
import { mobileRecordingTelemetry } from './mobileRecordingTelemetry';

export interface MobileRecordingTelemetry {
  codecUsed: string;
  timeslice: number;
  pauseResumeCount: number;
  reconnectAttempts: number;
  wsOpenCloseEvents: number;
  startTime: number;
  networkChanges: number;
  bufferedChunks: number;
  errors: Array<{
    type: string;
    message: string;
    timestamp: number;
  }>;
}

interface AudioChunk {
  kind: 'blob';
  data: Blob;
  timestamp: number;
  sequenceNumber: number;
}

enum ConnectionState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Reconnecting = 'reconnecting'
}

export class ResilientMobileRecordingManager {
  private capabilities: AudioCapabilities | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private pcmProcessor: PCMAudioProcessor | null = null;
  private audioStream: MediaStream | null = null;
  private webSocket: WebSocket | null = null;
  private sessionId: string | null = null;
  private wsUrl: string = '';
  private token: string = '';

  // Recording state
  private isRecording = false;
  private isPaused = false;
  private connectionState: ConnectionState = ConnectionState.Disconnected;

  // Resilience features
  private audioBuffer: AudioChunk[] = [];
  private sequenceNumber = 0;
  private pcmFrameQueue: PCMFrameEnvelope[] = [];
  private pcmSequenceNumber = 0;
  private pcmHandshakeSent = false;
  private lastDisconnectTime: number | null = null;
  private wasConnectedBefore = false;

  // Reconnection logic
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private initialReconnectDelay = 1000; // 1 second
  private maxReconnectDelay = 30000;    // 30 seconds
  private reconnectTimer: NodeJS.Timeout | null = null;
  private graceWindowMs = 120000; // 2 minutes (server's grace period)

  // Network monitoring
  private networkChangeHandler: (() => void) | null = null;
  private wasOnline = navigator.onLine;

  // Heartbeat and telemetry
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private pongTimeout: NodeJS.Timeout | null = null;
  private heartbeatMisses = 0;
  private telemetry: MobileRecordingTelemetry;

  // Page lifecycle
  private visibilityHandler: (() => void) | null = null;
  private pageHideHandler: (() => void) | null = null;
  private pageShowHandler: (() => void) | null = null;

  constructor() {
    this.telemetry = this.initTelemetry();
    this.setupNetworkMonitoring();
    this.setupPageLifecycleHandlers();
  }

  private initTelemetry(): MobileRecordingTelemetry {
    return {
      codecUsed: '',
      timeslice: 0,
      pauseResumeCount: 0,
      reconnectAttempts: 0,
      wsOpenCloseEvents: 0,
      networkChanges: 0,
      bufferedChunks: 0,
      startTime: Date.now(),
      errors: []
    };
  }

  private setupNetworkMonitoring(): void {
    this.networkChangeHandler = () => {
      const isOnline = navigator.onLine;

      if (!this.wasOnline && isOnline) {
        // Network restored
        console.log('[ResilientRecording] Network restored, attempting immediate reconnection');
        this.telemetry.networkChanges++;
        this.reconnectAttempts = 0; // Reset attempts for network restore
        if (this.connectionState === ConnectionState.Disconnected && this.isRecording) {
          this.attemptReconnect();
        }
      } else if (this.wasOnline && !isOnline) {
        // Network lost
        console.log('[ResilientRecording] Network lost, will reconnect when restored');
        this.setConnectionState(ConnectionState.Disconnected);
      }

      this.wasOnline = isOnline;
    };

    window.addEventListener('online', this.networkChangeHandler);
    window.addEventListener('offline', this.networkChangeHandler);
  }

  private setupPageLifecycleHandlers(): void {
    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible' && this.isRecording) {
        console.log('[ResilientRecording] Page became visible, checking connection');
        this.testConnectionHealth();
      }
    };

    this.pageHideHandler = () => {
      if (this.isRecording) {
        console.log('[ResilientRecording] Page hidden, reducing heartbeat frequency');
        this.adjustHeartbeatForBackground();
      }
    };

    this.pageShowHandler = () => {
      if (this.isRecording) {
        console.log('[ResilientRecording] Page shown, restoring heartbeat');
        this.adjustHeartbeatForForeground();
      }
    };

    document.addEventListener('visibilitychange', this.visibilityHandler);
    window.addEventListener('pagehide', this.pageHideHandler);
    window.addEventListener('pageshow', this.pageShowHandler);
  }

  private setConnectionState(newState: ConnectionState): void {
    if (this.connectionState !== newState) {
      console.log(`[ResilientRecording] Connection state: ${this.connectionState} → ${newState}`);
      this.connectionState = newState;

      // Update UI or emit events as needed
      // You can add custom event dispatching here
    }
  }

  private addTelemetryError(type: string, message: string): void {
    this.telemetry.errors.push({
      type,
      message,
      timestamp: Date.now()
    });
    mobileRecordingTelemetry.recordError(type, message);
  }

  private isGracePeriodExpired(): boolean {
    if (!this.lastDisconnectTime) return false;
    return (Date.now() - this.lastDisconnectTime) > this.graceWindowMs;
  }

  public async startRecording(sessionId: string, wsUrl: string, token: string): Promise<boolean> {
    if (!isMobileRecordingEnabled()) {
      this.addTelemetryError('feature_disabled', 'Mobile recording feature flag is disabled');
      return false;
    }

    this.sessionId = sessionId;
    this.wsUrl = wsUrl;
    this.token = token;
    this.telemetry = this.initTelemetry();

    // Detect audio capabilities
    this.capabilities = detectAudioCapabilities();
    if (!this.capabilities.isSupported) {
      this.addTelemetryError('unsupported', 'No supported audio recording method found');
      return false;
    }

    // Start telemetry session
    mobileRecordingTelemetry.startSession(sessionId, this.capabilities);

    this.telemetry.codecUsed = this.capabilities.contentType;
    this.telemetry.timeslice = this.capabilities.recommendedTimeslice;

    try {
      // Get audio stream
      this.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: this.capabilities.channels,
          sampleRate: this.capabilities.sampleRate,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      if (isMobileRecordingEnabled()) {
        try { await acquireWakeLock(); } catch {}
      }

      // Prepare audio capture before opening WebSocket so we can advertise capabilities accurately
      await this.startAudioCapture();

      // Setup resilient WebSocket connection
      await this.connectWebSocket();

      this.isRecording = true;
      console.log('[ResilientRecording] Recording started successfully');
      return true;

    } catch (error: any) {
      this.addTelemetryError('start_failed', error.message);
      await this.stopRecording();
      return false;
    }
  }

  private async connectWebSocket(): Promise<void> {
    if (!this.sessionId) throw new Error('No session ID');

    this.setConnectionState(ConnectionState.Connecting);

    return new Promise((resolve, reject) => {
      const url = `${this.wsUrl}/ws/audio_stream/${this.sessionId}?token=${this.token}`;
      this.webSocket = new WebSocket(url);

      // Connection timeout
      const timeout = setTimeout(() => {
        if (this.webSocket?.readyState === WebSocket.CONNECTING) {
          this.webSocket.close();
          reject(new Error('Connection timeout'));
        }
      }, 10000);

      this.webSocket.onopen = () => {
        clearTimeout(timeout);
        console.log('[ResilientRecording] WebSocket connected');

        const usingPCM = this.isPCMStreamingActive();
        const initMessage: Record<string, any> = {
          type: 'init',
          supports_pcm: usingPCM,
          next_seq: this.pcmSequenceNumber + 1,
          client_timestamp: Date.now(),
        };

        if (usingPCM && this.pcmProcessor) {
          initMessage.format = 'pcm16';
          initMessage.sample_rate = this.pcmProcessor.getTargetSampleRate();
          initMessage.frame_duration_ms = this.pcmProcessor.getFrameDurationMs();
          initMessage.frame_samples = this.pcmProcessor.getFrameSampleCount();
          initMessage.channels = 1;
          initMessage.segment_target_ms = this.capabilities?.pcmSegmentTargetMs ?? 15000;
        } else if (this.capabilities) {
          initMessage.format = this.capabilities.contentType;
          initMessage.sample_rate = this.capabilities.sampleRate;
          initMessage.channels = this.capabilities.channels;
        }

        try {
          this.webSocket?.send(JSON.stringify(initMessage));
          this.pcmHandshakeSent = usingPCM;
        } catch (error) {
          console.warn('[ResilientRecording] Failed to send init message', error);
        }

        if (!usingPCM && this.capabilities && this.webSocket) {
          const header = createAudioHeader(this.capabilities);
          try {
            this.webSocket.send(JSON.stringify({ type: 'legacy_header', header }));
          } catch (error) {
            console.warn('[ResilientRecording] Failed to send legacy audio header', error);
          }
        }

        // Reset reconnection state
        this.reconnectAttempts = 0;
        this.clearReconnectTimer();

        // Update state
        const wasReconnecting = this.connectionState === ConnectionState.Reconnecting;
        this.setConnectionState(ConnectionState.Connected);

        // Start heartbeat
        this.startHeartbeat();

        if (usingPCM) {
          this.flushPCMFrameQueue();
        }

        // Send buffered audio if any
        this.sendBufferedAudio();

        if (wasReconnecting && this.wasConnectedBefore) {
          console.log('[ResilientRecording] Successfully reconnected');
        } else {
          this.wasConnectedBefore = true;
        }

        this.telemetry.wsOpenCloseEvents++;
        mobileRecordingTelemetry.recordWebSocketEvent('open');
        resolve();
      };

      this.webSocket.onclose = (event) => {
        clearTimeout(timeout);
        console.log(`[ResilientRecording] WebSocket closed: ${event.code} - ${event.reason}`);

        this.stopHeartbeat();
        this.lastDisconnectTime = Date.now();

        if (this.isRecording && !this.isPaused) {
          // Unintentional disconnect - attempt reconnection if we have network
          this.setConnectionState(ConnectionState.Disconnected);

          if (navigator.onLine) {
            this.scheduleReconnect();
          } else {
            console.log('[ResilientRecording] WebSocket closed and no network - will reconnect when network returns');
          }
        }

        this.telemetry.wsOpenCloseEvents++;
        mobileRecordingTelemetry.recordWebSocketEvent('close');
      };

      this.webSocket.onerror = (error) => {
        clearTimeout(timeout);
        console.error('[ResilientRecording] WebSocket error:', error);
        this.addTelemetryError('ws_error', 'WebSocket connection error');

        if (!this.wasConnectedBefore) {
          reject(error);
        }
      };

      this.webSocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle server status messages
          if (data.type === 'status' && data.state === 'RESUMED') {
            console.log('[ResilientRecording] Session successfully resumed');
          }

          // Handle pong responses
          if (data.type === 'pong') {
            this.handlePong();
          }

        } catch (error) {
          // Not JSON, handle as needed
        }
      };
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return; // Already scheduled

    // Don't reconnect if no network
    if (!navigator.onLine) {
      console.log('[ResilientRecording] No network for reconnection, waiting...');
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[ResilientRecording] Max reconnection attempts reached');
      this.addTelemetryError('reconnect_exhausted', `Failed after ${this.maxReconnectAttempts} attempts`);
      return;
    }

    this.setConnectionState(ConnectionState.Reconnecting);

    // Calculate delay with exponential backoff
    const delay = Math.min(
      this.initialReconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );

    console.log(`[ResilientRecording] Scheduling reconnection attempt ${this.reconnectAttempts + 1} in ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.telemetry.reconnectAttempts++;
      this.attemptReconnect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async attemptReconnect(): Promise<void> {
    this.clearReconnectTimer();

    // Check network state before attempting
    if (!navigator.onLine) {
      console.log('[ResilientRecording] No network for reconnection, waiting...');
      return;
    }

    console.log(`[ResilientRecording] Reconnection attempt ${this.reconnectAttempts}`);

    try {
      await this.connectWebSocket();
    } catch (error: any) {
      console.error('[ResilientRecording] Reconnection failed:', error);
      this.addTelemetryError('reconnect_failed', error.message);
      this.scheduleReconnect();
    }
  }

  private async startAudioCapture(): Promise<void> {
    if (!this.audioStream || !this.capabilities) return;

    const shouldUsePCM = !!this.capabilities.supportsPCMStream;

    if (!shouldUsePCM) {
      this.setupMediaRecorderCapture();
      return;
    }

    this.pcmProcessor = new PCMAudioProcessor();
    this.pcmFrameQueue = [];
    this.pcmSequenceNumber = 0;
    this.pcmHandshakeSent = false;

    const frameDurationMs = this.capabilities.pcmFrameDurationMs ?? 20;

    try {
      await this.pcmProcessor.initialize(
        this.audioStream,
        (pcmSamples: Float32Array) => {
          if (!pcmSamples.length || this.isPaused) {
            return;
          }

          const payload = float32ToPCM16(pcmSamples);
          const nextSeq = this.pcmSequenceNumber + 1;
          const frame: PCMFrameEnvelope = {
            seq: nextSeq,
            timestamp: Date.now(),
            sampleRate: this.pcmProcessor?.getTargetSampleRate() ?? 16000,
            frameDurationMs: this.pcmProcessor?.getFrameDurationMs() ?? frameDurationMs,
            frameSamples: this.pcmProcessor?.getFrameSampleCount() ?? pcmSamples.length,
            channels: 1,
            format: 'pcm16',
            payload,
          };

          this.pcmSequenceNumber = nextSeq;
          this.enqueuePCMFrame(frame);
        },
        {
          frameDurationMs,
          targetSampleRate: 16000,
        }
      );
    } catch (error) {
      console.error('[ResilientRecording] PCM initialization failed, falling back to MediaRecorder', error);
      this.pcmProcessor = null;
      this.setupMediaRecorderCapture();
    }
  }

  private setupMediaRecorderCapture(): void {
    if (!this.audioStream || !this.capabilities) return;

    this.mediaRecorder = new MediaRecorder(this.audioStream, {
      mimeType: this.capabilities.contentType,
      audioBitsPerSecond: 16000,
    });

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.sendAudio(event.data);
      }
    };

    this.mediaRecorder.start(this.capabilities.recommendedTimeslice);
  }

  private enqueuePCMFrame(frame: PCMFrameEnvelope) {
    if (this.webSocket?.readyState === WebSocket.OPEN && this.pcmHandshakeSent) {
      this.sendPCMFrame(frame);
      return;
    }

    this.pcmFrameQueue.push(frame);

    const MAX_BUFFERED_FRAMES = 500; // allow ~10s buffering for reconnection
    if (this.pcmFrameQueue.length > MAX_BUFFERED_FRAMES) {
      this.pcmFrameQueue.splice(0, this.pcmFrameQueue.length - MAX_BUFFERED_FRAMES);
    }
  }

  private flushPCMFrameQueue() {
    if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
      return;
    }

    while (this.pcmFrameQueue.length) {
      const frame = this.pcmFrameQueue.shift();
      if (frame) {
        this.sendPCMFrame(frame);
      }
    }
  }

  private sendPCMFrame(frame: PCMFrameEnvelope) {
    if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
      this.pcmFrameQueue.unshift(frame);
      return;
    }

    try {
      const encoded = encodePCMFrame(frame);
      this.webSocket.send(encoded);
    } catch (error) {
      console.warn('[ResilientRecording] Failed to send PCM frame', error);
    }
  }

  private isPCMStreamingActive(): boolean {
    return !!(this.pcmProcessor && this.pcmProcessor.isActive());
  }

  private sendAudio(audioData: Blob): void {
    const audioChunk: AudioChunk = {
      kind: 'blob',
      data: audioData,
      timestamp: Date.now(),
      sequenceNumber: ++this.sequenceNumber
    };

    if (this.connectionState === ConnectionState.Connected && this.webSocket?.readyState === WebSocket.OPEN) {
      // Send immediately
      this.webSocket.send(audioData);
    } else {
      // Buffer for later
      this.audioBuffer.push(audioChunk);
      this.telemetry.bufferedChunks++;
      console.log(`[ResilientRecording] Buffered audio chunk (${this.audioBuffer.length} chunks buffered)`);
    }
  }

  private sendBufferedAudio(): void {
    if (this.audioBuffer.length === 0) return;

    console.log(`[ResilientRecording] Sending ${this.audioBuffer.length} buffered audio chunks`);

    // Sort by sequence number to maintain order
    this.audioBuffer.sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    // Send each chunk
    for (const chunk of this.audioBuffer) {
      if (this.webSocket?.readyState === WebSocket.OPEN) {
        this.webSocket.send(chunk.data);
      }
    }

    // Clear buffer
    this.audioBuffer = [];
  }

  private testConnectionHealth(): void {
    if (this.webSocket?.readyState === WebSocket.OPEN) {
      try {
        this.webSocket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      } catch (error) {
        console.warn('[ResilientRecording] Health check ping failed:', error);
      }
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      if (this.connectionState === ConnectionState.Connected) {
        this.sendHeartbeat();
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  private sendHeartbeat(): void {
    if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) return;

    try {
      this.webSocket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));

      this.pongTimeout = setTimeout(() => {
        this.heartbeatMisses++;
        if (this.heartbeatMisses >= MAX_HEARTBEAT_MISSES) {
          console.warn('[ResilientRecording] Too many heartbeat misses, forcing reconnection');
          this.webSocket?.close();
        }
      }, PONG_TIMEOUT_MS);

    } catch (error) {
      console.warn('[ResilientRecording] Failed to send heartbeat:', error);
    }
  }

  private handlePong(): void {
    this.heartbeatMisses = 0;
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  private adjustHeartbeatForBackground(): void {
    this.stopHeartbeat();

    // Longer intervals in background to save battery
    this.heartbeatInterval = setInterval(() => {
      if (this.connectionState === ConnectionState.Connected) {
        this.sendHeartbeat();
      }
    }, HEARTBEAT_INTERVAL_MS * 2); // Double the interval
  }

  private adjustHeartbeatForForeground(): void {
    this.startHeartbeat(); // Restore normal heartbeat
  }

  public async pauseRecording(): Promise<void> {
    if (!this.isRecording || this.isPaused) return;

    this.isPaused = true;
    this.telemetry.pauseResumeCount++;

    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
    }

    if (this.pcmProcessor) {
      this.pcmProcessor.pause();
    }

    console.log('[ResilientRecording] Recording paused');
  }

  public async resumeRecording(): Promise<void> {
    if (!this.isRecording || !this.isPaused) return;

    this.isPaused = false;

    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
    }

    if (this.pcmProcessor) {
      this.pcmProcessor.resume();
    }

    // Test connection health after resuming
    this.testConnectionHealth();

    console.log('[ResilientRecording] Recording resumed');
  }

  public async stopRecording(): Promise<void> {
    if (!this.isRecording) return;

    this.isRecording = false;
    this.isPaused = false;

    // Stop audio capture
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    if (this.pcmProcessor) {
      this.pcmProcessor.stop();
      this.pcmProcessor = null;
    }

    this.pcmFrameQueue = [];
    this.pcmSequenceNumber = 0;
    this.pcmHandshakeSent = false;
    this.audioBuffer = [];

    // Close WebSocket
    this.stopHeartbeat();
    this.clearReconnectTimer();

    if (this.webSocket) {
      this.webSocket.close(1000, 'Recording stopped');
    }

    // Clean up audio stream
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
    }

    // Release wake lock
    try { await releaseWakeLock(); } catch {}

    // End telemetry session
    mobileRecordingTelemetry.endSession();

    this.setConnectionState(ConnectionState.Disconnected);
    console.log('[ResilientRecording] Recording stopped');
  }

  public getTelemetry(): MobileRecordingTelemetry {
    return { ...this.telemetry };
  }

  public getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  public getBufferedChunkCount(): number {
    return this.audioBuffer.length;
  }

  public cleanup(): void {
    this.stopRecording();

    // Remove event listeners
    if (this.networkChangeHandler) {
      window.removeEventListener('online', this.networkChangeHandler);
      window.removeEventListener('offline', this.networkChangeHandler);
    }

    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }

    if (this.pageHideHandler) {
      window.removeEventListener('pagehide', this.pageHideHandler);
    }

    if (this.pageShowHandler) {
      window.removeEventListener('pageshow', this.pageShowHandler);
    }
  }
}
