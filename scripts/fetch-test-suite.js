// Fetch-based Mobile Recording Test Suite
// Tests the mobile recording functionality using fetch requests

const fetch = require('node-fetch');

async function runFetchTests() {
  console.log('🚀 Running Fetch-based Mobile Recording Tests...\n');

  const baseUrl = 'http://localhost:3002';
  let results = [];

  // Test 1: Health Check
  try {
    console.log('1. Testing Health Check...');
    const healthResponse = await fetch(`${baseUrl}/api/health-check`);
    const healthText = await healthResponse.text();

    results.push({
      test: 'Health Check',
      passed: healthResponse.status === 200,
      details: `Status: ${healthResponse.status}, Response: ${healthText.substring(0, 100)}`
    });
  } catch (error) {
    results.push({
      test: 'Health Check',
      passed: false,
      details: `Error: ${error.message}`
    });
  }

  // Test 2: Mobile Recording Test Page
  try {
    console.log('2. Testing Mobile Recording Test Page...');
    const pageResponse = await fetch(`${baseUrl}/mobile-recording-test`);
    const pageText = await pageResponse.text();

    const hasExpectedContent = pageText.includes('Mobile Recording Test Suite') &&
                              pageText.includes('Run Mobile Recording Tests');

    results.push({
      test: 'Test Page Accessibility',
      passed: pageResponse.status === 200 && hasExpectedContent,
      details: `Status: ${pageResponse.status}, Contains expected content: ${hasExpectedContent}`
    });
  } catch (error) {
    results.push({
      test: 'Test Page Accessibility',
      passed: false,
      details: `Error: ${error.message}`
    });
  }

  // Test 3: Telemetry Endpoint
  try {
    console.log('3. Testing Telemetry Endpoint...');
    const testTelemetry = {
      clientMetrics: {
        sessionId: `fetch-test-${Date.now()}`,
        userAgent: 'NodeJS Fetch Test',
        isMobile: false,
        startTime: Date.now() - 30000,
        endTime: Date.now(),
        duration: 30000,
        codecUsed: 'audio/webm',
        supportedMimeType: 'audio/webm',
        requiresPCMFallback: false,
        timeslice: 3000,
        wsOpenCloseEvents: 2,
        reconnectAttempts: 0,
        connectionDrops: 0,
        heartbeatMisses: 0,
        pauseResumeCount: 1,
        visibilityChanges: 2,
        backgroundDuration: 5000,
        errors: [
          { type: 'test_error', message: 'Test error for validation', timestamp: Date.now() }
        ],
        audioChunksSent: 25,
        totalBytesTransferred: 125000,
        averageLatency: 200,
        transcriptReceived: true
      },
      timestamp: Date.now(),
      version: '1.0.0'
    };

    const telemetryResponse = await fetch(`${baseUrl}/api/mobile-recording-telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testTelemetry)
    });

    const telemetryData = await telemetryResponse.json();

    results.push({
      test: 'Telemetry Endpoint',
      passed: telemetryResponse.status === 200 && telemetryData.success,
      details: `Status: ${telemetryResponse.status}, Success: ${telemetryData.success}, Summary: ${JSON.stringify(telemetryData.summary)}`
    });

    // Check if alerts were triggered (we sent 1 error out of 25 chunks = 4% error rate)
    if (telemetryData.alerts && telemetryData.alerts.length > 0) {
      console.log('   📊 Alerts triggered (expected for test data):');
      telemetryData.alerts.forEach(alert => {
        console.log(`      ${alert.type}: ${alert.message}`);
      });
    }

  } catch (error) {
    results.push({
      test: 'Telemetry Endpoint',
      passed: false,
      details: `Error: ${error.message}`
    });
  }

  // Test 4: Feature Flag Validation
  try {
    console.log('4. Testing Feature Flag Response...');
    // This tests if the test page can render with different feature flag states

    const pageWithJS = await fetch(`${baseUrl}/mobile-recording-test`);
    const content = await pageWithJS.text();

    // Check if the page includes the feature flag functionality
    const hasFeatureFlagCode = content.includes('localStorage.getItem') ||
                              content.includes('recording.mobile.enabled');

    results.push({
      test: 'Feature Flag Integration',
      passed: hasFeatureFlagCode,
      details: `Feature flag code present: ${hasFeatureFlagCode}`
    });

  } catch (error) {
    results.push({
      test: 'Feature Flag Integration',
      passed: false,
      details: `Error: ${error.message}`
    });
  }

  // Print Results
  console.log('\n' + '='.repeat(60));
  console.log('📊 FETCH TEST RESULTS');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.passed).length;
  const total = results.length;

  console.log(`Total Tests: ${total}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${total - passed}`);
  console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`);
  console.log('');

  results.forEach((result, index) => {
    const status = result.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${index + 1}. ${result.test} - ${status}`);
    console.log(`   ${result.details}`);
    console.log('');
  });

  if (passed === total) {
    console.log('🎉 All fetch tests passed!');
    console.log('\n📱 To complete testing:');
    console.log('   1. Visit: http://localhost:3002/mobile-recording-test');
    console.log('   2. Enable mobile recording feature flag');
    console.log('   3. Run the interactive test suite');
    console.log('   4. Test on actual mobile devices');
    console.log('   5. Test real recording functionality');
  } else {
    console.log('⚠️  Some tests failed. Check the server and implementation.');
  }

  return results;
}

// Check for node-fetch
async function checkNodeFetch() {
  try {
    require('node-fetch');
    return true;
  } catch (error) {
    console.log('❌ node-fetch not found. Installing...');
    const { execSync } = require('child_process');
    try {
      execSync('npm install node-fetch@^2.6.7', { stdio: 'inherit' });
      return true;
    } catch (installError) {
      console.log('❌ Failed to install node-fetch. Please install manually:');
      console.log('   npm install node-fetch@^2.6.7');
      return false;
    }
  }
}

// Run tests
checkNodeFetch().then(async (hasNodeFetch) => {
  if (hasNodeFetch) {
    await runFetchTests();
  }
}).catch(console.error);