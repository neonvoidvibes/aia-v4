# Resilient Recording Hook Integration Guide

## Overview
The `useResilientRecording` hook is a **drop-in replacement** for your existing `useRecording` hook that adds network resilience capabilities while maintaining 100% API compatibility.

## ✅ **Key Features Added**
- **Network change detection** (WiFi ↔ cellular transitions)
- **Automatic reconnection** with exponential backoff (up to 10 attempts)
- **Audio buffering** during disconnections
- **Session reattachment** using same session_id within 2-minute grace period
- **Page visibility handling** (background/foreground)
- **Connection health monitoring** with heartbeat/pong
- **Real-time connection state** and buffered chunk count

## 🔄 **Migration Steps**

### Step 1: Update Import Statement

**Before:**
```typescript
import { useRecording } from '@/hooks/use-recording';
```

**After:**
```typescript
import { useResilientRecording } from '@/hooks/use-resilient-recording';
```

### Step 2: Update Hook Usage

**Before:**
```typescript
const {
  isRecording,
  isPaused,
  isStopping,
  sessionId,
  startRecording,
  stopRecording,
  togglePause,
  audioStream,
} = useRecording({ agentName, onRecordingStopped });
```

**After:**
```typescript
const {
  // Existing API (100% compatible)
  isRecording,
  isPaused,
  isStopping,
  sessionId,
  startRecording,
  stopRecording,
  togglePause,
  audioStream,

  // NEW: Network resilience features
  connectionState,      // 'connected', 'connecting', 'reconnecting', 'disconnected'
  bufferedChunkCount,   // Number of audio chunks buffered during disconnection
} = useResilientRecording({ agentName, onRecordingStopped });
```

### Step 3: Update Your Components

Find components that use `useRecording` and update them. Based on your file structure, check:

- `components/RecordView.tsx`
- Any other components importing `useRecording`

## 📱 **Enhanced UI Features**

You can now show network resilience status to users:

```tsx
function RecordingComponent() {
  const {
    isRecording,
    connectionState,
    bufferedChunkCount,
    startRecording,
    stopRecording,
  } = useResilientRecording({ agentName, onRecordingStopped });

  const getConnectionStatus = () => {
    switch (connectionState) {
      case 'connected':
        return { text: 'Connected', color: 'green' };
      case 'connecting':
        return { text: 'Connecting...', color: 'yellow' };
      case 'reconnecting':
        return { text: 'Reconnecting...', color: 'orange' };
      case 'disconnected':
        return { text: 'Disconnected', color: 'red' };
    }
  };

  const status = getConnectionStatus();

  return (
    <div>
      {/* Existing recording UI */}
      <button onClick={startRecording} disabled={isRecording}>
        Start Recording
      </button>

      {/* NEW: Connection status indicator */}
      <div style={{ color: status.color }}>
        Status: {status.text}
        {bufferedChunkCount > 0 && (
          <span> (📦 {bufferedChunkCount} chunks buffered)</span>
        )}
      </div>

      {/* Show helpful messages */}
      {connectionState === 'reconnecting' && (
        <div className="alert alert-info">
          Connection lost. Recording continues locally - reconnecting...
        </div>
      )}

      {bufferedChunkCount > 0 && (
        <div className="alert alert-warning">
          {bufferedChunkCount} audio chunks buffered. Will send when reconnected.
        </div>
      )}
    </div>
  );
}
```

## 🧪 **Testing Network Resilience**

After integration, test these scenarios:

### 1. WiFi Disconnection Test
1. Start recording
2. Turn WiFi off (or disconnect from WiFi)
3. **Expected**: Status shows "Reconnecting...", chunks get buffered
4. Turn WiFi back on
5. **Expected**: Automatic reconnection, buffered chunks sent, recording continues

### 2. Network Switching Test
1. Start recording on WiFi
2. Switch to cellular (or different WiFi network)
3. **Expected**: Brief disconnection, automatic reconnection

### 3. Background/Foreground Test
1. Start recording
2. Switch to another app or minimize browser
3. Return to recording app
4. **Expected**: Connection health check, seamless continuation

### 4. Server Restart Test
1. Start recording
2. Restart the server
3. **Expected**: Multiple reconnection attempts, eventual success when server is back

## 🔧 **Configuration Options**

The hook includes sensible defaults, but you can customize them by modifying these constants in the hook:

```typescript
const maxReconnectAttempts = 10;        // Max reconnection attempts
const initialReconnectDelay = 1000;     // Initial delay (1 second)
const maxReconnectDelay = 30000;        // Max delay (30 seconds)
const graceWindowMs = 120000;           // Server grace period (2 minutes)
```

## 🐛 **Troubleshooting**

### Issue: "Connection failed permanently"
- **Cause**: Max reconnection attempts reached
- **Solution**: Check server status, network connectivity, refresh page

### Issue: Audio chunks not being sent after reconnection
- **Cause**: WebSocket not properly reconnected
- **Solution**: Check browser console for `[ResilientRecording]` logs

### Issue: Reconnection not happening after network restore
- **Cause**: Browser's `navigator.onLine` detection issues
- **Solution**: Manually refresh page or implement custom network detection

## 📊 **Monitoring**

The hook provides detailed console logging with `[ResilientRecording]` prefix:

```
[ResilientRecording] WebSocket connected
[ResilientRecording] Buffered audio chunk (3 chunks buffered)
[ResilientRecording] Network restored, attempting immediate reconnection
[ResilientRecording] Sending 3 buffered audio chunks
[ResilientRecording] Successfully reconnected
```

## 🚀 **Ready to Deploy**

1. ✅ **Create the hook file** (`use-resilient-recording.ts`)
2. ✅ **Update imports** in your components
3. ✅ **Test network scenarios** on mobile/desktop
4. ✅ **Monitor server logs** for successful reattachments
5. ✅ **Deploy with confidence** 🎯

The enhanced hook maintains full backward compatibility while adding robust network resilience - your users will experience uninterrupted recording even during network outages!