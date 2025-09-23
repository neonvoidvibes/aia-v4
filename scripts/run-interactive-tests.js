// Interactive Mobile Recording Test Runner
// Runs browser-based tests using headless Chrome

const puppeteer = require('puppeteer');

async function runInteractiveTests() {
  let browser;

  try {
    console.log('🚀 Starting Interactive Mobile Recording Tests...\n');

    // Launch browser
    browser = await puppeteer.launch({
      headless: false, // Set to true for headless mode
      devtools: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // Set mobile viewport for testing
    await page.setViewport({
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      isLandscape: false
    });

    // Set user agent to simulate mobile device
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1');

    console.log('📱 Simulating mobile device (iPhone)');
    console.log('🌐 Navigating to test page...');

    // Navigate to test page
    await page.goto('http://localhost:3002/mobile-recording-test', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    console.log('✅ Test page loaded successfully');

    // Enable mobile recording feature flag
    await page.evaluate(() => {
      localStorage.setItem('recording.mobile.enabled', 'true');
    });

    console.log('✅ Mobile recording feature flag enabled');

    // Wait for test panel to load
    await page.waitForSelector('button:has-text("Run Mobile Recording Tests")', { timeout: 10000 });

    console.log('🔧 Running automated tests...');

    // Click the run tests button
    await page.click('button:has-text("Run Mobile Recording Tests")');

    // Wait for tests to complete
    await page.waitForSelector('div:has-text("Test Results")', { timeout: 15000 });

    // Get test results
    const testResults = await page.evaluate(() => {
      const results = [];
      const testElements = document.querySelectorAll('[class*="border-l-4"]');

      testElements.forEach(element => {
        const testName = element.querySelector('h4')?.textContent?.replace(/[✅❌]\s*/, '') || 'Unknown Test';
        const passed = element.textContent.includes('✅');
        const message = element.querySelector('p')?.textContent || '';

        results.push({ testName, passed, message });
      });

      return results;
    });

    // Get summary stats
    const summary = await page.evaluate(() => {
      const summaryElements = document.querySelectorAll('.text-2xl.font-bold');
      return {
        total: summaryElements[0]?.textContent || '0',
        passed: summaryElements[1]?.textContent || '0',
        failed: summaryElements[2]?.textContent || '0',
        duration: summaryElements[3]?.textContent || '0ms'
      };
    });

    console.log('\n' + '='.repeat(60));
    console.log('📊 INTERACTIVE TEST RESULTS');
    console.log('='.repeat(60));
    console.log(`Total Tests: ${summary.total}`);
    console.log(`Passed: ${summary.passed}`);
    console.log(`Failed: ${summary.failed}`);
    console.log(`Duration: ${summary.duration}`);
    console.log('');

    testResults.forEach((result, index) => {
      const status = result.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`${index + 1}. ${result.testName} - ${status}`);
      console.log(`   ${result.message.substring(0, 100)}${result.message.length > 100 ? '...' : ''}`);
      console.log('');
    });

    // Test mobile-specific features
    console.log('🔍 Testing Mobile-Specific Features...');

    // Test device detection
    const mobileDetected = await page.evaluate(() => {
      return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|Mobile|Tablet/i.test(navigator.userAgent);
    });

    console.log(`📱 Mobile Device Detection: ${mobileDetected ? '✅ DETECTED' : '❌ NOT DETECTED'}`);

    // Test MediaRecorder support
    const mediaRecorderSupport = await page.evaluate(() => {
      return typeof MediaRecorder !== 'undefined';
    });

    console.log(`🎙️  MediaRecorder API: ${mediaRecorderSupport ? '✅ SUPPORTED' : '❌ NOT SUPPORTED'}`);

    // Test supported MIME types
    const supportedMimeTypes = await page.evaluate(() => {
      const types = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/mp4;codecs=mp4a.40.2'
      ];

      return types.filter(type => {
        try {
          return MediaRecorder.isTypeSupported(type);
        } catch {
          return false;
        }
      });
    });

    console.log(`🎵 Supported MIME Types: ${supportedMimeTypes.length > 0 ? supportedMimeTypes.join(', ') : 'None detected'}`);

    // Generate final report
    const finalReport = {
      timestamp: new Date().toISOString(),
      environment: 'Mobile Simulation (iPhone)',
      serverUrl: 'http://localhost:3002',
      testResults,
      summary,
      mobileFeatures: {
        deviceDetected: mobileDetected,
        mediaRecorderSupported: mediaRecorderSupport,
        supportedMimeTypes
      }
    };

    console.log('\n🎉 Interactive tests completed successfully!');
    console.log('\n💡 Next steps:');
    console.log('   • Test on actual mobile devices');
    console.log('   • Test recording functionality with microphone');
    console.log('   • Test background/foreground scenarios');
    console.log('   • Test network connectivity issues');

    return finalReport;

  } catch (error) {
    console.error('❌ Interactive tests failed:', error.message);
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Check if puppeteer is available
async function checkDependencies() {
  try {
    require('puppeteer');
    return true;
  } catch (error) {
    console.log('❌ Puppeteer not found. To run interactive tests:');
    console.log('   npm install puppeteer');
    console.log('\nFor now, please visit: http://localhost:3002/mobile-recording-test');
    return false;
  }
}

// Run tests if puppeteer is available, otherwise provide manual instructions
checkDependencies().then(async (hasDepends) => {
  if (hasDepends) {
    const report = await runInteractiveTests();
    if (report) {
      console.log('\n📝 Test report saved to browser console');
    }
  }
});