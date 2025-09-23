// Mobile Recording Test Script
// Run this script to test mobile recording functionality programmatically

const { execSync } = require('child_process');
const http = require('http');

console.log('🚀 Starting Mobile Recording Tests...\n');

// Test 1: Check if server is running
function checkServer() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:3002/api/health-check', (res) => {
      console.log('✅ Server health check: PASSED');
      resolve(true);
    });

    req.on('error', () => {
      console.log('❌ Server health check: FAILED - Server not running');
      resolve(false);
    });

    req.setTimeout(5000, () => {
      console.log('❌ Server health check: TIMEOUT');
      resolve(false);
    });
  });
}

// Test 2: Check mobile recording test page
function checkTestPage() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:3002/mobile-recording-test', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (data.includes('Mobile Recording Test Suite')) {
          console.log('✅ Test page accessibility: PASSED');
          resolve(true);
        } else {
          console.log('❌ Test page accessibility: FAILED - Content not found');
          resolve(false);
        }
      });
    });

    req.on('error', () => {
      console.log('❌ Test page accessibility: FAILED - Request error');
      resolve(false);
    });

    req.setTimeout(5000, () => {
      console.log('❌ Test page accessibility: TIMEOUT');
      resolve(false);
    });
  });
}

// Test 3: Check telemetry endpoint
function checkTelemetryEndpoint() {
  return new Promise((resolve) => {
    const postData = JSON.stringify({
      clientMetrics: {
        sessionId: 'test-session-' + Date.now(),
        userAgent: 'test-agent',
        isMobile: true,
        startTime: Date.now(),
        codecUsed: 'audio/webm',
        supportedMimeType: 'audio/webm',
        requiresPCMFallback: false,
        timeslice: 1000,
        wsOpenCloseEvents: 2,
        reconnectAttempts: 0,
        connectionDrops: 0,
        heartbeatMisses: 0,
        pauseResumeCount: 1,
        visibilityChanges: 2,
        backgroundDuration: 500,
        errors: [],
        audioChunksSent: 10,
        totalBytesTransferred: 50000,
        averageLatency: 150,
        transcriptReceived: true
      },
      timestamp: Date.now(),
      version: '1.0.0'
    });

    const options = {
      hostname: 'localhost',
      port: 3002,
      path: '/api/mobile-recording-telemetry',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.success) {
            console.log('✅ Telemetry endpoint: PASSED');
            console.log(`   Summary: ${JSON.stringify(result.summary)}`);
            resolve(true);
          } else {
            console.log('❌ Telemetry endpoint: FAILED - No success flag');
            resolve(false);
          }
        } catch (e) {
          console.log('❌ Telemetry endpoint: FAILED - Invalid JSON response');
          resolve(false);
        }
      });
    });

    req.on('error', () => {
      console.log('❌ Telemetry endpoint: FAILED - Request error');
      resolve(false);
    });

    req.setTimeout(5000, () => {
      console.log('❌ Telemetry endpoint: TIMEOUT');
      resolve(false);
    });

    req.write(postData);
    req.end();
  });
}

// Run all tests
async function runTests() {
  const results = [];

  console.log('1. Testing server health...');
  results.push(await checkServer());

  console.log('\n2. Testing mobile recording test page...');
  results.push(await checkTestPage());

  console.log('\n3. Testing telemetry endpoint...');
  results.push(await checkTelemetryEndpoint());

  const passedTests = results.filter(r => r).length;
  const totalTests = results.length;

  console.log('\n' + '='.repeat(50));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(50));
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${totalTests - passedTests}`);
  console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);

  if (passedTests === totalTests) {
    console.log('\n🎉 All tests passed! You can now:');
    console.log('   • Visit http://localhost:3002/mobile-recording-test');
    console.log('   • Run the interactive test suite');
    console.log('   • Test on mobile devices');
  } else {
    console.log('\n⚠️  Some tests failed. Please check the server and try again.');
  }
}

// Wait a moment for server to be fully ready
setTimeout(runTests, 2000);