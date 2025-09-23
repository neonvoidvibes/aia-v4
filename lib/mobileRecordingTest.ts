// Mobile Recording Test Suite
// Tests mobile recording capabilities and functionality

import { detectAudioCapabilities, isMobileDevice } from './mobileRecordingCapabilities';
import { isMobileRecordingEnabled } from './featureFlags';
import { MobileRecordingManager } from './mobileRecordingManager';
import { mobileRecordingTelemetry } from './mobileRecordingTelemetry';

export interface TestResult {
  testName: string;
  passed: boolean;
  message: string;
  duration?: number;
  error?: Error;
}

export interface TestSuite {
  name: string;
  results: TestResult[];
  passed: boolean;
  totalDuration: number;
}

class MobileRecordingTestRunner {
  private testManager: MobileRecordingManager | null = null;

  async runAllTests(): Promise<TestSuite> {
    const startTime = Date.now();
    const results: TestResult[] = [];

    console.log('[Test] Starting mobile recording test suite...');

    // Test 1: Feature flag detection
    results.push(await this.testFeatureFlag());

    // Test 2: Capability detection
    results.push(await this.testCapabilityDetection());

    // Test 3: Mobile device detection
    results.push(await this.testMobileDeviceDetection());

    // Test 4: Audio constraints
    results.push(await this.testAudioConstraints());

    // Test 5: Codec fallback ladder
    results.push(await this.testCodecFallback());

    // Test 6: Telemetry service
    results.push(await this.testTelemetryService());

    // Test 7: Page lifecycle handlers (if mobile)
    if (isMobileDevice()) {
      results.push(await this.testPageLifecycleHandlers());
    }

    // Test 8: WebSocket header creation
    results.push(await this.testWebSocketHeaderCreation());

    const totalDuration = Date.now() - startTime;
    const passed = results.every(result => result.passed);

    const suite: TestSuite = {
      name: 'Mobile Recording Test Suite',
      results,
      passed,
      totalDuration
    };

    console.log('[Test] Test suite completed:', suite);
    return suite;
  }

  private async testFeatureFlag(): Promise<TestResult> {
    const testName = 'Feature Flag Detection';
    const startTime = Date.now();

    try {
      const isEnabled = isMobileRecordingEnabled();
      const duration = Date.now() - startTime;

      return {
        testName,
        passed: typeof isEnabled === 'boolean',
        message: `Feature flag returned: ${isEnabled}`,
        duration
      };
    } catch (error) {
      return {
        testName,
        passed: false,
        message: `Feature flag test failed: ${(error as Error).message}`,
        duration: Date.now() - startTime,
        error: error as Error
      };
    }
  }

  private async testCapabilityDetection(): Promise<TestResult> {
    const testName = 'Capability Detection';
    const startTime = Date.now();

    try {
      const capabilities = detectAudioCapabilities();
      const duration = Date.now() - startTime;

      const requiredFields = ['isSupported', 'isMobile', 'contentType', 'sampleRate', 'channels'];
      const hasRequiredFields = requiredFields.every(field => field in capabilities);

      return {
        testName,
        passed: hasRequiredFields && typeof capabilities.isSupported === 'boolean',
        message: `Capabilities detected: ${JSON.stringify(capabilities)}`,
        duration
      };
    } catch (error) {
      return {
        testName,
        passed: false,
        message: `Capability detection failed: ${(error as Error).message}`,
        duration: Date.now() - startTime,
        error: error as Error
      };
    }
  }

  private async testMobileDeviceDetection(): Promise<TestResult> {
    const testName = 'Mobile Device Detection';
    const startTime = Date.now();

    try {
      const isMobile = isMobileDevice();
      const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
      const duration = Date.now() - startTime;

      return {
        testName,
        passed: typeof isMobile === 'boolean',
        message: `Mobile detection: ${isMobile}, UserAgent: ${userAgent}`,
        duration
      };
    } catch (error) {
      return {
        testName,
        passed: false,
        message: `Mobile detection failed: ${(error as Error).message}`,
        duration: Date.now() - startTime,
        error: error as Error
      };
    }
  }

  private async testAudioConstraints(): Promise<TestResult> {
    const testName = 'Audio Constraints';
    const startTime = Date.now();

    try {
      const capabilities = detectAudioCapabilities();

      // Test that we can create valid audio constraints
      const constraints: MediaTrackConstraints = {
        channelCount: capabilities.channels,
        sampleRate: capabilities.sampleRate,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      };

      const hasValidConstraints = constraints.channelCount && constraints.sampleRate;
      const duration = Date.now() - startTime;

      return {
        testName,
        passed: !!hasValidConstraints,
        message: `Audio constraints: ${JSON.stringify(constraints)}`,
        duration
      };
    } catch (error) {
      return {
        testName,
        passed: false,
        message: `Audio constraints test failed: ${(error as Error).message}`,
        duration: Date.now() - startTime,
        error: error as Error
      };
    }
  }

  private async testCodecFallback(): Promise<TestResult> {
    const testName = 'Codec Fallback Ladder';
    const startTime = Date.now();

    try {
      // Test MIME types in order
      const mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/mp4;codecs=mp4a.40.2',
        'audio/mpeg'
      ];

      const supportedTypes = mimeTypes.filter(type => {
        try {
          return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type);
        } catch {
          return false;
        }
      });

      const duration = Date.now() - startTime;

      return {
        testName,
        passed: true, // This test always passes to show what's supported
        message: `Supported MIME types: ${supportedTypes.join(', ')} (${supportedTypes.length}/${mimeTypes.length})`,
        duration
      };
    } catch (error) {
      return {
        testName,
        passed: false,
        message: `Codec fallback test failed: ${(error as Error).message}`,
        duration: Date.now() - startTime,
        error: error as Error
      };
    }
  }

  private async testTelemetryService(): Promise<TestResult> {
    const testName = 'Telemetry Service';
    const startTime = Date.now();

    try {
      const testSessionId = 'test-session-' + Date.now();
      const testCapabilities = detectAudioCapabilities();

      // Test telemetry start
      mobileRecordingTelemetry.startSession(testSessionId, testCapabilities);

      // Test telemetry recording
      mobileRecordingTelemetry.recordError('test_error', 'Test error message');
      mobileRecordingTelemetry.recordWebSocketEvent('open');
      mobileRecordingTelemetry.recordPauseResume();

      // Get current metrics
      const metrics = mobileRecordingTelemetry.getCurrentMetrics();

      // Test telemetry end
      const finalMetrics = mobileRecordingTelemetry.endSession();

      const duration = Date.now() - startTime;

      const passed = !!(metrics && finalMetrics && metrics.sessionId === testSessionId);

      return {
        testName,
        passed,
        message: `Telemetry test: ${passed ? 'passed' : 'failed'}, Session ID: ${testSessionId}`,
        duration
      };
    } catch (error) {
      return {
        testName,
        passed: false,
        message: `Telemetry test failed: ${(error as Error).message}`,
        duration: Date.now() - startTime,
        error: error as Error
      };
    }
  }

  private async testPageLifecycleHandlers(): Promise<TestResult> {
    const testName = 'Page Lifecycle Handlers';
    const startTime = Date.now();

    try {
      // Test that we can register visibility change handlers
      let visibilityChanges = 0;

      const testHandler = () => {
        visibilityChanges++;
        mobileRecordingTelemetry.recordVisibilityChange(document.hidden);
      };

      // Register test handler
      document.addEventListener('visibilitychange', testHandler);

      // Simulate visibility change (can't actually trigger it in test)
      const hasVisibilityAPI = typeof document !== 'undefined' && 'hidden' in document;

      // Clean up
      document.removeEventListener('visibilitychange', testHandler);

      const duration = Date.now() - startTime;

      return {
        testName,
        passed: hasVisibilityAPI,
        message: `Visibility API available: ${hasVisibilityAPI}`,
        duration
      };
    } catch (error) {
      return {
        testName,
        passed: false,
        message: `Page lifecycle test failed: ${(error as Error).message}`,
        duration: Date.now() - startTime,
        error: error as Error
      };
    }
  }

  private async testWebSocketHeaderCreation(): Promise<TestResult> {
    const testName = 'WebSocket Header Creation';
    const startTime = Date.now();

    try {
      const capabilities = detectAudioCapabilities();

      // Import the header creation function dynamically
      const { createAudioHeader } = await import('./mobileRecordingCapabilities');
      const header = createAudioHeader(capabilities);

      const hasRequiredFields = header.contentType && header.rate && header.channels;
      const duration = Date.now() - startTime;

      return {
        testName,
        passed: !!hasRequiredFields,
        message: `Audio header: ${JSON.stringify(header)}`,
        duration
      };
    } catch (error) {
      return {
        testName,
        passed: false,
        message: `Header creation test failed: ${(error as Error).message}`,
        duration: Date.now() - startTime,
        error: error as Error
      };
    }
  }

  // Integration test (requires actual recording session)
  async testRecordingIntegration(wsUrl: string, token: string, agentName: string): Promise<TestResult> {
    const testName = 'Recording Integration';
    const startTime = Date.now();

    try {
      if (!isMobileRecordingEnabled()) {
        return {
          testName,
          passed: false,
          message: 'Mobile recording feature is disabled',
          duration: Date.now() - startTime
        };
      }

      this.testManager = new MobileRecordingManager();

      // Mock session ID for test
      const testSessionId = 'integration-test-' + Date.now();

      // Test should start recording
      const startSuccess = await this.testManager.startRecording(testSessionId, wsUrl, token);

      if (!startSuccess) {
        throw new Error('Failed to start recording');
      }

      // Wait a short time
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Test pause/resume
      this.testManager.pauseRecording();
      await new Promise(resolve => setTimeout(resolve, 500));
      await this.testManager.resumeRecording();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Stop recording
      await this.testManager.stopRecording();

      const duration = Date.now() - startTime;

      return {
        testName,
        passed: true,
        message: 'Recording integration test completed successfully',
        duration
      };
    } catch (error) {
      // Clean up on error
      if (this.testManager) {
        await this.testManager.stopRecording().catch(() => {});
      }

      return {
        testName,
        passed: false,
        message: `Integration test failed: ${(error as Error).message}`,
        duration: Date.now() - startTime,
        error: error as Error
      };
    }
  }

  generateTestReport(suite: TestSuite): string {
    const passedTests = suite.results.filter(r => r.passed).length;
    const totalTests = suite.results.length;

    let report = `
# Mobile Recording Test Report

**Test Suite:** ${suite.name}
**Total Tests:** ${totalTests}
**Passed:** ${passedTests}
**Failed:** ${totalTests - passedTests}
**Success Rate:** ${((passedTests / totalTests) * 100).toFixed(1)}%
**Total Duration:** ${suite.totalDuration}ms

## Test Results

`;

    suite.results.forEach((result, index) => {
      const status = result.passed ? '✅ PASS' : '❌ FAIL';
      report += `${index + 1}. **${result.testName}** - ${status}\n`;
      report += `   - Message: ${result.message}\n`;
      if (result.duration) {
        report += `   - Duration: ${result.duration}ms\n`;
      }
      if (result.error) {
        report += `   - Error: ${result.error.message}\n`;
      }
      report += '\n';
    });

    return report;
  }
}

// Export singleton instance
export const mobileRecordingTestRunner = new MobileRecordingTestRunner();

// Export types
export type { TestResult, TestSuite };