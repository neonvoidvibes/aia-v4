/**
 * Test for transcription status WebSocket message handling
 */

// Mock the featureFlags module
jest.mock('../featureFlags', () => ({
  isRecordingPersistenceEnabled: jest.fn(() => true),
  isMobileRecordingEnabled: jest.fn(() => false),
  isTranscriptionPauseToastEnabled: jest.fn(() => true),
}));

// Mock the toast hook
const mockToast = jest.fn(() => ({
  id: 'test-toast-id',
  dismiss: jest.fn(),
  update: jest.fn(),
}));

jest.mock('@/hooks/use-toast', () => ({
  toast: mockToast,
}));

// Mock other dependencies
jest.mock('../wakeLock', () => ({
  acquireWakeLock: jest.fn(),
  releaseWakeLock: jest.fn(),
}));

jest.mock('../wsPolicy', () => ({
  HEARTBEAT_INTERVAL_MS: 2000,
  PONG_TIMEOUT_MS: 5000,
  MAX_HEARTBEAT_MISSES: 3,
}));

jest.mock('../mobileRecordingCapabilities', () => ({
  detectAudioCapabilities: jest.fn(() => ({
    supportedMimeType: 'audio/webm',
    isSupported: true,
    isMobile: false,
    requiresPCMFallback: false,
    recommendedTimeslice: 3000,
    contentType: 'audio/webm',
    sampleRate: 48000,
    channels: 1,
    bitDepth: 16,
    supportsPCMStream: false,
    supportsAudioWorklet: false,
    pcmFrameDurationMs: 20,
    pcmFrameSamples: 320,
    pcmSegmentTargetMs: 15000,
  })),
  createAudioHeader: jest.fn(),
  PCMAudioProcessor: jest.fn(),
  float32ToPCM16: jest.fn(),
  isMobileDevice: jest.fn(() => false),
}));

jest.mock('@/utils/supabase/client', () => ({
  createClient: jest.fn(() => ({
    auth: {
      getSession: jest.fn(() => Promise.resolve({
        data: {
          session: {
            access_token: 'mock-token',
            user: { id: 'test-user-id' }
          }
        }
      }))
    }
  }))
}));

// Global mocks
global.WebSocket = jest.fn(() => ({
  readyState: 1, // OPEN
  send: jest.fn(),
  close: jest.fn(),
  onopen: null,
  onmessage: null,
  onclose: null,
  onerror: null,
})) as any;

global.MediaRecorder = jest.fn(() => ({
  start: jest.fn(),
  stop: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  state: 'inactive',
  ondataavailable: null,
  onstart: null,
  onstop: null,
  onpause: null,
  onresume: null,
})) as any;

global.navigator = {
  mediaDevices: {
    getUserMedia: jest.fn(() => Promise.resolve({
      getTracks: jest.fn(() => [{ stop: jest.fn() }])
    }))
  }
} as any;

global.localStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
} as any;

global.sessionStorage = {
  getItem: jest.fn(() => 'test-tab-id'),
  setItem: jest.fn(),
} as any;

global.BroadcastChannel = jest.fn(() => ({
  postMessage: jest.fn(),
  onmessage: null,
})) as any;

global.crypto = {
  randomUUID: jest.fn(() => 'test-uuid')
} as any;

describe('Transcription Status WebSocket Messages', () => {
  let manager: any;
  let mockWs: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Import the manager after mocks are set up
    const { manager: recordingManager } = require('../recordingManager');
    manager = recordingManager;

    // Create a mock WebSocket
    mockWs = {
      readyState: 1,
      send: jest.fn(),
      close: jest.fn(),
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
    };

    (global.WebSocket as any).mockReturnValue(mockWs);
  });

  it('should handle PAUSED transcription status message', async () => {
    const state = manager.getState();
    expect(state.transcriptionPaused).toBeUndefined();

    // Simulate WebSocket message
    const pausedMessage = {
      type: 'transcription_status',
      state: 'PAUSED',
      reason: 'network'
    };

    // Access the handleTranscriptionStatus method (it's private, but we can test via WebSocket message)
    if (mockWs.onmessage) {
      const messageEvent = { data: JSON.stringify(pausedMessage) };
      mockWs.onmessage(messageEvent);
    }

    // Check that the state was updated
    const updatedState = manager.getState();
    expect(updatedState.transcriptionPaused).toBe(true);
  });

  it('should handle RESUMED transcription status message', async () => {
    // First set paused state
    const pausedMessage = {
      type: 'transcription_status',
      state: 'PAUSED',
      reason: 'network'
    };

    if (mockWs.onmessage) {
      mockWs.onmessage({ data: JSON.stringify(pausedMessage) });
    }

    expect(manager.getState().transcriptionPaused).toBe(true);

    // Now send RESUMED message
    const resumedMessage = {
      type: 'transcription_status',
      state: 'RESUMED'
    };

    if (mockWs.onmessage) {
      mockWs.onmessage({ data: JSON.stringify(resumedMessage) });
    }

    const finalState = manager.getState();
    expect(finalState.transcriptionPaused).toBe(false);
  });

  it('should not handle transcription status when feature flag is disabled', () => {
    const { isTranscriptionPauseToastEnabled } = require('../featureFlags');
    isTranscriptionPauseToastEnabled.mockReturnValue(false);

    const initialState = manager.getState();

    const pausedMessage = {
      type: 'transcription_status',
      state: 'PAUSED',
      reason: 'network'
    };

    if (mockWs.onmessage) {
      mockWs.onmessage({ data: JSON.stringify(pausedMessage) });
    }

    const finalState = manager.getState();
    expect(finalState.transcriptionPaused).toBe(initialState.transcriptionPaused);

    // Reset for other tests
    isTranscriptionPauseToastEnabled.mockReturnValue(true);
  });
});
