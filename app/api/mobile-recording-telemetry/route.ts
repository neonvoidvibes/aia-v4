// Mobile Recording Telemetry API Endpoint
// Receives and processes telemetry data from mobile recording sessions

import { NextRequest, NextResponse } from 'next/server';

interface TelemetryData {
  clientMetrics: {
    sessionId: string;
    userAgent: string;
    isMobile: boolean;
    startTime: number;
    endTime?: number;
    duration?: number;
    codecUsed: string;
    supportedMimeType: string | null;
    requiresPCMFallback: boolean;
    timeslice: number;
    wsOpenCloseEvents: number;
    reconnectAttempts: number;
    connectionDrops: number;
    heartbeatMisses: number;
    pauseResumeCount: number;
    visibilityChanges: number;
    backgroundDuration: number;
    errors: Array<{
      type: string;
      message: string;
      timestamp: number;
      stack?: string;
    }>;
    audioChunksSent: number;
    totalBytesTransferred: number;
    averageLatency: number;
    transcriptReceived: boolean;
  };
  timestamp: number;
  version: string;
}

export async function POST(request: NextRequest) {
  try {
    const data: TelemetryData = await request.json();
    const { clientMetrics } = data;

    // Validate required fields
    if (!clientMetrics?.sessionId) {
      return NextResponse.json(
        { error: 'Missing required field: sessionId' },
        { status: 400 }
      );
    }

    // Log telemetry data for monitoring
    console.log('[MobileTelemetry] Received data:', {
      sessionId: clientMetrics.sessionId,
      codecUsed: clientMetrics.codecUsed,
      duration: clientMetrics.duration,
      errors: clientMetrics.errors.length,
      connectionDrops: clientMetrics.connectionDrops,
      transcriptReceived: clientMetrics.transcriptReceived
    });

    // Check for alert conditions
    const alerts = checkAlertConditions(clientMetrics);
    if (alerts.length > 0) {
      console.warn('[MobileTelemetry] Alerts triggered:', alerts);
      // Could send to alerting system here
    }

    // Store telemetry data (could be database, analytics service, etc.)
    await storeTelemetryData(data);

    // Generate metrics summary
    const summary = generateMetricsSummary(clientMetrics);

    return NextResponse.json({
      success: true,
      received: data.timestamp,
      summary,
      alerts
    });

  } catch (error) {
    console.error('[MobileTelemetry] Error processing telemetry:', error);
    return NextResponse.json(
      { error: 'Failed to process telemetry data' },
      { status: 500 }
    );
  }
}

function checkAlertConditions(metrics: TelemetryData['clientMetrics']) {
  const alerts = [];

  // Error rate threshold (> 3%)
  const errorRate = metrics.errors.length / Math.max(1, metrics.audioChunksSent);
  if (errorRate > 0.03) {
    alerts.push({
      type: 'high_error_rate',
      message: `Error rate ${(errorRate * 100).toFixed(1)}% exceeds 3% threshold`,
      severity: 'error',
      sessionId: metrics.sessionId
    });
  }

  // Connection stability threshold
  if (metrics.connectionDrops > 2) {
    alerts.push({
      type: 'connection_instability',
      message: `${metrics.connectionDrops} connection drops detected`,
      severity: 'warning',
      sessionId: metrics.sessionId
    });
  }

  // Latency threshold (> 5s)
  if (metrics.averageLatency > 5000) {
    alerts.push({
      type: 'high_latency',
      message: `Average latency ${metrics.averageLatency.toFixed(0)}ms exceeds 5s threshold`,
      severity: 'warning',
      sessionId: metrics.sessionId
    });
  }

  // Transcription success
  if (metrics.duration && metrics.duration > 30000 && !metrics.transcriptReceived && metrics.audioChunksSent > 5) {
    alerts.push({
      type: 'transcription_failure',
      message: 'No transcript received after 30s with significant audio data',
      severity: 'error',
      sessionId: metrics.sessionId
    });
  }

  return alerts;
}

function generateMetricsSummary(metrics: TelemetryData['clientMetrics']) {
  const duration = metrics.duration || 0;
  const errorRate = metrics.errors.length / Math.max(1, metrics.audioChunksSent);

  return {
    sessionDuration: duration,
    errorRate: Math.round(errorRate * 10000) / 100, // Percentage with 2 decimal places
    connectionStability: metrics.connectionDrops <= 2 ? 'stable' : 'unstable',
    averageLatency: Math.round(metrics.averageLatency),
    codecEfficiency: metrics.requiresPCMFallback ? 'fallback' : 'native',
    backgroundTolerance: duration > 0 ? Math.round((metrics.backgroundDuration / duration) * 100) : 0,
    transcriptionSuccess: metrics.transcriptReceived
  };
}

async function storeTelemetryData(data: TelemetryData) {
  // In a real implementation, this would store to a database or analytics service
  // For now, we'll just log structured data for monitoring systems to pick up

  const logEntry = {
    timestamp: new Date().toISOString(),
    type: 'mobile_recording_telemetry',
    sessionId: data.clientMetrics.sessionId,
    metrics: {
      codec: data.clientMetrics.codecUsed,
      duration_ms: data.clientMetrics.duration,
      error_count: data.clientMetrics.errors.length,
      connection_drops: data.clientMetrics.connectionDrops,
      reconnect_attempts: data.clientMetrics.reconnectAttempts,
      average_latency_ms: data.clientMetrics.averageLatency,
      chunks_sent: data.clientMetrics.audioChunksSent,
      bytes_transferred: data.clientMetrics.totalBytesTransferred,
      transcript_received: data.clientMetrics.transcriptReceived,
      user_agent: data.clientMetrics.userAgent,
      pcm_fallback: data.clientMetrics.requiresPCMFallback
    }
  };

  console.log('[MobileTelemetry]', JSON.stringify(logEntry));

  // Here you would typically:
  // - Send to analytics service (e.g., Mixpanel, Segment)
  // - Store in database
  // - Send to monitoring system (e.g., DataDog, New Relic)
  // - Update metrics dashboards
}