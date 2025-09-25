# Resilient Mobile Recording Manager Integration Guide

## Overview
The `ResilientMobileRecordingManager` is a drop-in replacement for your existing `MobileRecordingManager` that adds network resilience capabilities.

## Key Features Added
- ✅ **Network change detection** (WiFi ↔ cellular transitions)
- ✅ **Automatic reconnection** with exponential backoff (up to 10 attempts)
- ✅ **Audio buffering** during disconnections
- ✅ **Session reattachment** using same session_id within 2-minute grace period
- ✅ **Page lifecycle handling** (background/foreground)
- ✅ **Connection health monitoring** with heartbeat/pong
- ✅ **Enhanced telemetry** tracking network events and buffering

## Migration Steps

### 1. Update Import Statements

**Before:**
```typescript
import { MobileRecordingManager } from './mobileRecordingManager';
```

**After:**
```typescript
import { ResilientMobileRecordingManager } from './resilientMobileRecordingManager';
```

### 2. Update Instance Creation

**Before:**
```typescript
const recordingManager = new MobileRecordingManager();
```

**After:**
```typescript
const recordingManager = new ResilientMobileRecordingManager();
```

### 3. API Compatibility

The `ResilientMobileRecordingManager` maintains **100% API compatibility** with your existing code:

```typescript
// All existing methods work exactly the same
await recordingManager.startRecording(sessionId, wsUrl, token);
await recordingManager.pauseRecording();
await recordingManager.resumeRecording();
await recordingManager.stopRecording();
const telemetry = recordingManager.getTelemetry();
```

### 4. New Methods Available

```typescript
// Check current connection state
const state = recordingManager.getConnectionState(); // 'connected', 'connecting', 'reconnecting', 'disconnected'

// Get buffered chunk count
const bufferedChunks = recordingManager.getBufferedChunkCount();

// Clean up resources (call on component unmount)
recordingManager.cleanup();
```

### 5. Enhanced Telemetry

The telemetry object now includes additional fields:

```typescript
interface MobileRecordingTelemetry {
  // Existing fields
  codecUsed: string;
  timeslice: number;
  pauseResumeCount: number;
  reconnectAttempts: number;
  wsOpenCloseEvents: number;
  startTime: number;
  errors: Array<{type: string, message: string, timestamp: number}>;

  // New fields
  networkChanges: number;      // Count of network state changes
  bufferedChunks: number;      // Total chunks buffered during disconnections
}
```

## Example Usage

```typescript
import { ResilientMobileRecordingManager } from './resilientMobileRecordingManager';

class RecordingComponent {
  private recordingManager: ResilientMobileRecordingManager;

  constructor() {
    this.recordingManager = new ResilientMobileRecordingManager();
  }

  async startRecording() {
    const success = await this.recordingManager.startRecording(
      sessionId,
      wsUrl,
      token
    );

    if (success) {
      console.log('Recording started with resilient connection');

      // Monitor connection state
      setInterval(() => {
        const state = this.recordingManager.getConnectionState();
        const buffered = this.recordingManager.getBufferedChunkCount();
        console.log(`Connection: ${state}, Buffered chunks: ${buffered}`);
      }, 5000);
    }
  }

  componentWillUnmount() {
    // Clean up resources
    this.recordingManager.cleanup();
  }
}
```

## Network Resilience Behavior

### WiFi Disconnection Scenario
1. **WiFi turns off** → Connection drops
2. **Audio continues recording** → Chunks buffered locally
3. **WiFi/cellular reconnects** → Immediate reconnection attempt
4. **Connection restored** → Buffered audio sent to server
5. **Recording continues** seamlessly

### Server Restart Scenario
1. **Server restarts** → WebSocket closes
2. **Client detects closure** → Begins reconnection attempts
3. **Exponential backoff** → 1s, 2s, 4s, 8s, 16s, 30s intervals
4. **Server comes back** → Connection restored
5. **Session reattaches** using same session_id (within 2min grace period)

### Background/Foreground Transitions
1. **Page goes to background** → Heartbeat interval doubled (battery saving)
2. **Page returns to foreground** → Normal heartbeat restored + connection health check

## Files Modified

To complete the integration, update these files:

1. **Components using MobileRecordingManager:**
   - `components/RecordView.tsx`
   - `hooks/use-recording.ts`
   - Any other files importing `MobileRecordingManager`

2. **Replace import:**
   ```diff
   - import { MobileRecordingManager } from './mobileRecordingManager';
   + import { ResilientMobileRecordingManager } from './resilientMobileRecordingManager';
   ```

3. **Update instantiation:**
   ```diff
   - const manager = new MobileRecordingManager();
   + const manager = new ResilientMobileRecordingManager();
   ```

## Testing the Integration

1. **Start recording** on mobile device
2. **Turn WiFi off/on** → Should see buffering and seamless reconnection
3. **Switch WiFi networks** → Should auto-reconnect
4. **Put app in background** → Should continue recording with reduced heartbeat
5. **Check server logs** → Should see successful session reattachment

## Troubleshooting

### Connection Issues
- Check browser console for `[ResilientRecording]` logs
- Verify server supports session reattachment (already implemented)
- Ensure `navigator.onLine` detection works on your target devices

### Audio Gaps
- Check `bufferedChunks` count in telemetry
- Verify server receives buffered audio after reconnection
- Monitor sequence numbers for proper ordering

The enhanced manager maintains full backward compatibility while adding robust network resilience!