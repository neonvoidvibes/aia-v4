/**
 * Manual test helper for transcription status functionality
 * This can be imported and used in the browser console for testing
 */

import { manager } from './recordingManager';
import { isTranscriptionPauseToastEnabled } from './featureFlags';

export const transcriptionStatusTestHelper = {
  // Check if feature is enabled
  isFeatureEnabled: () => {
    console.log('Transcription pause toast enabled:', isTranscriptionPauseToastEnabled());
    return isTranscriptionPauseToastEnabled();
  },

  // Get current recording state
  getState: () => {
    const state = manager.getState();
    console.log('Current recording state:', state);
    return state;
  },

  // Simulate receiving a PAUSED message (for testing purposes)
  simulatePausedMessage: () => {
    console.log('Simulating PAUSED transcription status message...');

    // Get the WebSocket instance from manager (this is a hack for testing)
    const ws = (manager as any).ws;
    if (ws && ws.onmessage) {
      const pausedMessage = {
        type: 'transcription_status',
        state: 'PAUSED',
        reason: 'network'
      };

      const event = { data: JSON.stringify(pausedMessage) };
      ws.onmessage(event);

      console.log('PAUSED message sent, check for toast and state change');
    } else {
      console.warn('No active WebSocket connection found');
    }
  },

  // Simulate receiving a RESUMED message (for testing purposes)
  simulateResumedMessage: () => {
    console.log('Simulating RESUMED transcription status message...');

    const ws = (manager as any).ws;
    if (ws && ws.onmessage) {
      const resumedMessage = {
        type: 'transcription_status',
        state: 'RESUMED'
      };

      const event = { data: JSON.stringify(resumedMessage) };
      ws.onmessage(event);

      console.log('RESUMED message sent, toast should be dismissed and state updated');
    } else {
      console.warn('No active WebSocket connection found');
    }
  },

  // Toggle the feature flag for testing
  toggleFeatureFlag: (enabled: boolean) => {
    const key = 'transcription.pause.toast.enabled';
    if (typeof window !== 'undefined') {
      if (enabled) {
        window.localStorage.setItem(key, 'true');
      } else {
        window.localStorage.setItem(key, 'false');
      }
      console.log(`Feature flag set to: ${enabled}`);
    }
  },

  // Instructions for manual testing
  getTestInstructions: () => {
    return `
Manual Testing Instructions:
1. Start a recording session using the main UI
2. Open browser console and run:
   - transcriptionStatusTestHelper.isFeatureEnabled() // Check if feature is on
   - transcriptionStatusTestHelper.simulatePausedMessage() // Show toast
   - transcriptionStatusTestHelper.getState() // Check transcriptionPaused: true
   - transcriptionStatusTestHelper.simulateResumedMessage() // Hide toast
   - transcriptionStatusTestHelper.getState() // Check transcriptionPaused: false

3. Test feature flag toggle:
   - transcriptionStatusTestHelper.toggleFeatureFlag(false) // Disable
   - Refresh page and try simulatePausedMessage() // Should not show toast
   - transcriptionStatusTestHelper.toggleFeatureFlag(true) // Re-enable

4. Test backend integration:
   - Start a recording and trigger actual Deepgram/Whisper failures
   - Observe real PAUSED/RESUMED messages from backend
    `;
  }
};

// Make available globally for console testing
if (typeof window !== 'undefined') {
  (window as any).transcriptionStatusTestHelper = transcriptionStatusTestHelper;
}

console.log('Transcription status test helper loaded. Use transcriptionStatusTestHelper in console.');
console.log(transcriptionStatusTestHelper.getTestInstructions());