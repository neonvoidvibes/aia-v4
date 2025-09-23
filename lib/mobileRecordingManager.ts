// Mobile-specific recording manager with codec fallbacks and page lifecycle handling
import {
  detectAudioCapabilities,
  createAudioHeader,
  PCMAudioProcessor,
  float32ToPCM16,
  AudioCapabilities,
  AudioHeader
} from './mobileRecordingCapabilities';
import { isMobileRecordingEnabled } from './featureFlags';
import { HEARTBEAT_INTERVAL_MS, PONG_TIMEOUT_MS, MAX_HEARTBEAT_MISSES } from './wsPolicy';
import { mobileRecordingTelemetry } from './mobileRecordingTelemetry';

export interface MobileRecordingTelemetry {
  codecUsed: string;
  timeslice: number;
  pauseResumeCount: number;
  reconnectAttempts: number;
  wsOpenCloseEvents: number;
  startTime: number;
  errors: Array<{
    type: string;
    message: string;
    timestamp: number;
  }>;
}

export class MobileRecordingManager {
  private capabilities: AudioCapabilities | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private pcmProcessor: PCMAudioProcessor | null = null;
  private audioStream: MediaStream | null = null;
  private webSocket: WebSocket | null = null;
  private sessionId: string | null = null;
  private isRecording = false;
  private isPaused = false;
  private telemetry: MobileRecordingTelemetry;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private pongTimeout: NodeJS.Timeout | null = null;
  private heartbeatMisses = 0;
  private visibilityHandler: (() => void) | null = null;
  private pageHideHandler: (() => void) | null = null;
  private pageShowHandler: (() => void) | null = null;

  constructor() {
    this.telemetry = this.initTelemetry();
    this.setupPageLifecycleHandlers();
  }

  private initTelemetry(): MobileRecordingTelemetry {
    return {
      codecUsed: '',
      timeslice: 0,
      pauseResumeCount: 0,
      reconnectAttempts: 0,
      wsOpenCloseEvents: 0,
      startTime: Date.now(),
      errors: []
    };
  }

  private addTelemetryError(type: string, message: string): void {
    this.telemetry.errors.push({
      type,
      message,
      timestamp: Date.now()
    });
    console.error(`[MobileRecording] ${type}: ${message}`);
  }

  private setupPageLifecycleHandlers(): void {
    if (typeof document === 'undefined') return;

    // Handle page visibility changes (mobile backgrounding)
    this.visibilityHandler = () => {
      if (document.hidden && this.isRecording && !this.isPaused) {
        console.log('[MobileRecording] Page hidden, pausing recording');
        this.pauseRecording();
      } else if (!document.hidden && this.isRecording && this.isPaused) {
        console.log('[MobileRecording] Page visible, resuming recording');
        setTimeout(() => this.resumeRecording(), 500); // Small delay for stability
      }
    };

    // Handle page hide/show events (iOS Safari specific)
    this.pageHideHandler = () => {
      if (this.isRecording && !this.isPaused) {
        console.log('[MobileRecording] Page hide event, pausing recording');
        this.pauseRecording();
      }
    };

    this.pageShowHandler = () => {
      if (this.isRecording && this.isPaused) {
        console.log('[MobileRecording] Page show event, resuming recording');
        setTimeout(() => this.resumeRecording(), 500);
      }
    };

    document.addEventListener('visibilitychange', this.visibilityHandler);
    window.addEventListener('pagehide', this.pageHideHandler);
    window.addEventListener('pageshow', this.pageShowHandler);
  }

  public async startRecording(sessionId: string, wsUrl: string, token: string): Promise<boolean> {
    if (!isMobileRecordingEnabled()) {
      this.addTelemetryError('feature_disabled', 'Mobile recording feature flag is disabled');
      return false;
    }

    this.sessionId = sessionId;
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

      // Setup WebSocket with header protocol
      await this.setupWebSocket(wsUrl, token);

      // Setup recording method based on capabilities
      if (this.capabilities.requiresPCMFallback) {
        await this.setupPCMRecording();
      } else {
        this.setupMediaRecorderRecording();
      }

      this.isRecording = true;
      this.startHeartbeat();

      console.log(`[MobileRecording] Started with codec: ${this.capabilities.contentType}`);
      return true;

    } catch (error: any) {
      this.addTelemetryError('start_failed', error.message);
      mobileRecordingTelemetry.recordError('start_failed', error.message, error);
      await this.cleanup();
      return false;
    }
  }

  private async setupWebSocket(wsUrl: string, token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${wsUrl}/ws/audio_stream/${this.sessionId}?token=${token}`;
      this.webSocket = new WebSocket(url);

      this.webSocket.onopen = () => {
        // Send audio header first
        if (this.capabilities && this.webSocket) {
          const header = createAudioHeader(this.capabilities);
          this.webSocket.send(JSON.stringify(header));
          console.log('[MobileRecording] Sent audio header:', header);
        }
        this.telemetry.wsOpenCloseEvents++;
        mobileRecordingTelemetry.recordWebSocketEvent('open');
        resolve();
      };

      this.webSocket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg?.type === 'pong') {
            if (this.pongTimeout) {
              clearTimeout(this.pongTimeout);
              this.pongTimeout = null;
            }
            this.heartbeatMisses = 0;
          }
        } catch {
          // Ignore non-JSON messages
        }
      };

      this.webSocket.onclose = () => {
        this.telemetry.wsOpenCloseEvents++;
        mobileRecordingTelemetry.recordWebSocketEvent('close');
        if (this.isRecording && !this.isPaused) {
          console.log('[MobileRecording] WebSocket closed unexpectedly, attempting reconnect');
          mobileRecordingTelemetry.recordConnectionDrop();
          this.attemptReconnect();
        }
      };

      this.webSocket.onerror = (error) => {
        this.addTelemetryError('ws_error', 'WebSocket connection error');
        mobileRecordingTelemetry.recordError('ws_error', 'WebSocket connection error');
        reject(error);
      };

      // Timeout for connection
      setTimeout(() => {
        if (this.webSocket?.readyState !== WebSocket.OPEN) {
          this.webSocket?.close();
          reject(new Error('WebSocket connection timeout'));
        }
      }, 10000);
    });
  }

  private setupMediaRecorderRecording(): void {
    if (!this.capabilities?.supportedMimeType || !this.audioStream) return;

    this.mediaRecorder = new MediaRecorder(this.audioStream, {
      mimeType: this.capabilities.supportedMimeType
    });

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0 && this.webSocket?.readyState === WebSocket.OPEN) {
        this.webSocket.send(event.data);
      }
    };

    this.mediaRecorder.onpause = () => {
      this.sendPauseState(true);
    };

    this.mediaRecorder.onresume = () => {
      this.sendPauseState(false);
    };

    this.mediaRecorder.start(this.capabilities.recommendedTimeslice);
  }

  private async setupPCMRecording(): Promise<void> {
    if (!this.audioStream) return;

    this.pcmProcessor = new PCMAudioProcessor();

    await this.pcmProcessor.initialize(this.audioStream, (pcmData: Float32Array) => {
      if (this.webSocket?.readyState === WebSocket.OPEN && !this.isPaused) {
        const buffer = float32ToPCM16(pcmData);
        this.webSocket.send(buffer);
      }
    });
  }

  private sendPauseState(paused: boolean): void {
    if (this.webSocket?.readyState === WebSocket.OPEN) {
      this.webSocket.send(JSON.stringify({
        action: 'set_processing_state',
        paused: paused
      }));
    }
  }

  public pauseRecording(): void {
    if (!this.isRecording || this.isPaused) return;

    this.isPaused = true;
    this.telemetry.pauseResumeCount++;
    mobileRecordingTelemetry.recordPauseResume();

    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
    }

    this.sendPauseState(true);
    console.log('[MobileRecording] Paused');
  }

  public async resumeRecording(): Promise<void> {
    if (!this.isRecording || !this.isPaused) return;

    // Reconnect WebSocket if needed
    if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
      await this.attemptReconnect();
    }

    this.isPaused = false;

    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
    }

    this.sendPauseState(false);
    console.log('[MobileRecording] Resumed');
  }

  private async attemptReconnect(): Promise<void> {
    if (!this.sessionId) return;

    this.telemetry.reconnectAttempts++;
    mobileRecordingTelemetry.recordWebSocketEvent('reconnect');
    const maxAttempts = 3;
    let attempt = 0;

    while (attempt < maxAttempts && this.isRecording) {
      attempt++;
      try {
        console.log(`[MobileRecording] Reconnect attempt ${attempt}/${maxAttempts}`);

        // Get fresh token (would need to be passed in or retrieved)
        const { createClient } = await import('@/utils/supabase/client');
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();

        if (session?.access_token) {
          const wsUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL;
          if (wsUrl) {
            await this.setupWebSocket(wsUrl, session.access_token);
            console.log('[MobileRecording] Reconnected successfully');
            return;
          }
        }
      } catch (error: any) {
        this.addTelemetryError('reconnect_failed', `Attempt ${attempt}: ${error.message}`);
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt)); // Exponential backoff
        }
      }
    }

    this.addTelemetryError('reconnect_exhausted', `Failed to reconnect after ${maxAttempts} attempts`);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    // Use faster heartbeat on mobile
    const interval = this.capabilities?.isMobile ?
      Math.max(10000, HEARTBEAT_INTERVAL_MS / 2) :
      HEARTBEAT_INTERVAL_MS;

    this.heartbeatInterval = setInterval(() => {
      if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) return;

      try {
        this.webSocket.send(JSON.stringify({ action: 'ping' }));

        this.pongTimeout = setTimeout(() => {
          this.heartbeatMisses++;
          if (this.heartbeatMisses >= MAX_HEARTBEAT_MISSES) {
            this.addTelemetryError('heartbeat_timeout', 'Too many missed heartbeats');
            this.webSocket?.close(1000, 'Heartbeat timeout');
          }
        }, PONG_TIMEOUT_MS);
      } catch (error: any) {
        this.addTelemetryError('heartbeat_send_failed', error.message);
      }
    }, interval);
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
    this.heartbeatMisses = 0;
  }

  public async stopRecording(): Promise<void> {
    if (!this.isRecording) return;

    this.isRecording = false;
    this.isPaused = false;

    // End telemetry session
    const finalMetrics = mobileRecordingTelemetry.endSession();
    console.log('[MobileRecording] Final metrics:', finalMetrics);

    // Signal stop to server
    if (this.webSocket?.readyState === WebSocket.OPEN) {
      this.webSocket.send(JSON.stringify({ action: 'stop_stream' }));

      // Give server time to process stop signal
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    await this.cleanup();
    console.log('[MobileRecording] Stopped');
  }

  private async cleanup(): Promise<void> {
    this.stopHeartbeat();

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.mediaRecorder = null;

    if (this.pcmProcessor) {
      this.pcmProcessor.stop();
      this.pcmProcessor = null;
    }

    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
      this.audioStream = null;
    }

    if (this.webSocket) {
      this.webSocket.close(1000, 'Recording stopped');
      this.webSocket = null;
    }

    // Remove page lifecycle handlers
    if (typeof document !== 'undefined') {
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

  public getTelemetry(): MobileRecordingTelemetry {
    return { ...this.telemetry };
  }

  public getCapabilities(): AudioCapabilities | null {
    return this.capabilities;
  }
}