// Mobile Recording Telemetry Service
// Collects and reports metrics for mobile recording sessions

export interface MobileRecordingMetrics {
  // Session info
  sessionId: string;
  userAgent: string;
  isMobile: boolean;
  startTime: number;
  endTime?: number;
  duration?: number;

  // Capabilities and codec
  codecUsed: string;
  supportedMimeType: string | null;
  requiresPCMFallback: boolean;
  timeslice: number;

  // Connection events
  wsOpenCloseEvents: number;
  reconnectAttempts: number;
  connectionDrops: number;
  heartbeatMisses: number;

  // Lifecycle events
  pauseResumeCount: number;
  visibilityChanges: number;
  backgroundDuration: number; // Time spent in background

  // Error tracking
  errors: Array<{
    type: string;
    message: string;
    timestamp: number;
    stack?: string;
  }>;

  // Performance metrics
  audioChunksSent: number;
  totalBytesTransferred: number;
  averageLatency: number;
  transcriptReceived: boolean;
}

export interface ServerTelemetryData {
  // Server processing metrics
  headerParsed: boolean;
  detectedCodec: string;
  transcodeAttempts: number;
  transcodeSuccesses: number;
  transcodeFailures: number;
  sttLatency: number;
  errorRate: number;
}

class MobileRecordingTelemetryService {
  private metrics: MobileRecordingMetrics | null = null;
  private startTimes: Map<string, number> = new Map();

  startSession(sessionId: string, capabilities: any): void {
    this.metrics = {
      sessionId,
      userAgent: navigator.userAgent,
      isMobile: /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|Mobile|Tablet/i.test(navigator.userAgent),
      startTime: Date.now(),
      codecUsed: capabilities.contentType || 'unknown',
      supportedMimeType: capabilities.supportedMimeType,
      requiresPCMFallback: capabilities.requiresPCMFallback || false,
      timeslice: capabilities.recommendedTimeslice || 3000,
      wsOpenCloseEvents: 0,
      reconnectAttempts: 0,
      connectionDrops: 0,
      heartbeatMisses: 0,
      pauseResumeCount: 0,
      visibilityChanges: 0,
      backgroundDuration: 0,
      errors: [],
      audioChunksSent: 0,
      totalBytesTransferred: 0,
      averageLatency: 0,
      transcriptReceived: false
    };

    console.log('[Telemetry] Started mobile recording session:', sessionId);
  }

  endSession(): MobileRecordingMetrics | null {
    if (this.metrics) {
      this.metrics.endTime = Date.now();
      this.metrics.duration = this.metrics.endTime - this.metrics.startTime;

      // Send telemetry data
      this.sendTelemetryData(this.metrics);

      console.log('[Telemetry] Session ended:', this.metrics.sessionId);
      const finalMetrics = { ...this.metrics };
      this.metrics = null;
      return finalMetrics;
    }
    return null;
  }

  recordError(type: string, message: string, error?: Error): void {
    if (!this.metrics) return;

    this.metrics.errors.push({
      type,
      message,
      timestamp: Date.now(),
      stack: error?.stack
    });

    console.error('[Telemetry] Error recorded:', { type, message });
  }

  recordWebSocketEvent(event: 'open' | 'close' | 'reconnect'): void {
    if (!this.metrics) return;

    switch (event) {
      case 'open':
      case 'close':
        this.metrics.wsOpenCloseEvents++;
        break;
      case 'reconnect':
        this.metrics.reconnectAttempts++;
        break;
    }
  }

  recordConnectionDrop(): void {
    if (!this.metrics) return;
    this.metrics.connectionDrops++;
  }

  recordHeartbeatMiss(): void {
    if (!this.metrics) return;
    this.metrics.heartbeatMisses++;
  }

  recordPauseResume(): void {
    if (!this.metrics) return;
    this.metrics.pauseResumeCount++;
  }

  recordVisibilityChange(hidden: boolean): void {
    if (!this.metrics) return;

    this.metrics.visibilityChanges++;

    if (hidden) {
      this.startTimes.set('background', Date.now());
    } else {
      const backgroundStart = this.startTimes.get('background');
      if (backgroundStart) {
        this.metrics.backgroundDuration += Date.now() - backgroundStart;
        this.startTimes.delete('background');
      }
    }
  }

  recordAudioChunk(byteSize: number): void {
    if (!this.metrics) return;

    this.metrics.audioChunksSent++;
    this.metrics.totalBytesTransferred += byteSize;
  }

  recordTranscriptReceived(): void {
    if (!this.metrics) return;
    this.metrics.transcriptReceived = true;
  }

  recordLatency(latencyMs: number): void {
    if (!this.metrics) return;

    // Simple moving average
    const currentAvg = this.metrics.averageLatency;
    const count = this.metrics.audioChunksSent;
    this.metrics.averageLatency = ((currentAvg * (count - 1)) + latencyMs) / count;
  }

  getCurrentMetrics(): MobileRecordingMetrics | null {
    return this.metrics ? { ...this.metrics } : null;
  }

  private async sendTelemetryData(metrics: MobileRecordingMetrics): Promise<void> {
    try {
      // Send to analytics endpoint
      await fetch('/api/mobile-recording-telemetry', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientMetrics: metrics,
          timestamp: Date.now(),
          version: '1.0.0'
        })
      });

      console.log('[Telemetry] Data sent successfully');
    } catch (error) {
      console.error('[Telemetry] Failed to send data:', error);
      // Store locally for retry
      try {
        const stored = localStorage.getItem('mobile-recording-telemetry-queue') || '[]';
        const queue = JSON.parse(stored);
        queue.push(metrics);
        localStorage.setItem('mobile-recording-telemetry-queue', JSON.stringify(queue));
      } catch {}
    }
  }

  // Retry sending queued telemetry data
  async retryQueuedTelemetry(): Promise<void> {
    try {
      const stored = localStorage.getItem('mobile-recording-telemetry-queue');
      if (!stored) return;

      const queue = JSON.parse(stored);
      if (queue.length === 0) return;

      // Try to send queued data
      for (const metrics of queue) {
        await this.sendTelemetryData(metrics);
      }

      // Clear queue on success
      localStorage.removeItem('mobile-recording-telemetry-queue');
      console.log('[Telemetry] Queued data sent successfully');
    } catch (error) {
      console.error('[Telemetry] Failed to send queued data:', error);
    }
  }

  // Generate alert if thresholds are exceeded
  checkAlertThresholds(): Array<{ type: string; message: string; severity: 'warning' | 'error' }> {
    if (!this.metrics) return [];

    const alerts = [];

    // Check error rate (> 3% per session)
    const errorRate = this.metrics.errors.length / Math.max(1, this.metrics.audioChunksSent);
    if (errorRate > 0.03) {
      alerts.push({
        type: 'high_error_rate',
        message: `Error rate ${(errorRate * 100).toFixed(1)}% exceeds 3% threshold`,
        severity: 'error' as const
      });
    }

    // Check connection drops (> 2 per session)
    if (this.metrics.connectionDrops > 2) {
      alerts.push({
        type: 'connection_instability',
        message: `${this.metrics.connectionDrops} connection drops detected`,
        severity: 'warning' as const
      });
    }

    // Check average latency (> 5s)
    if (this.metrics.averageLatency > 5000) {
      alerts.push({
        type: 'high_latency',
        message: `Average latency ${this.metrics.averageLatency.toFixed(0)}ms exceeds 5s threshold`,
        severity: 'warning' as const
      });
    }

    // Check if no transcript received after significant time
    const duration = Date.now() - this.metrics.startTime;
    if (duration > 30000 && !this.metrics.transcriptReceived && this.metrics.audioChunksSent > 5) {
      alerts.push({
        type: 'no_transcript',
        message: 'No transcript received after 30 seconds with audio data',
        severity: 'error' as const
      });
    }

    return alerts;
  }
}

// Export singleton instance
export const mobileRecordingTelemetry = new MobileRecordingTelemetryService();

// Export types for use elsewhere
export type { MobileRecordingMetrics, ServerTelemetryData };