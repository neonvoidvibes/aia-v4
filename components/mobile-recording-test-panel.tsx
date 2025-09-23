'use client';

import React, { useState } from 'react';
import { mobileRecordingTestRunner, TestSuite } from '@/lib/mobileRecordingTest';
import { isMobileRecordingEnabled } from '@/lib/featureFlags';

export function MobileRecordingTestPanel() {
  const [testSuite, setTestSuite] = useState<TestSuite | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [showReport, setShowReport] = useState(false);

  const runTests = async () => {
    setIsRunning(true);
    setTestSuite(null);
    setShowReport(false);

    try {
      const suite = await mobileRecordingTestRunner.runAllTests();
      setTestSuite(suite);
    } catch (error) {
      console.error('Test suite failed:', error);
    } finally {
      setIsRunning(false);
    }
  };

  const toggleFeatureFlag = () => {
    const current = localStorage.getItem('recording.mobile.enabled') === 'true';
    localStorage.setItem('recording.mobile.enabled', String(!current));
    window.location.reload(); // Reload to apply changes
  };

  const generateReport = () => {
    if (testSuite) {
      const report = mobileRecordingTestRunner.generateTestReport(testSuite);
      setShowReport(true);
      // Also copy to clipboard
      navigator.clipboard?.writeText(report);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4">Mobile Recording Test Panel</h2>

      {/* Feature Flag Control */}
      <div className="mb-6 p-4 bg-gray-100 rounded-lg">
        <h3 className="text-lg font-semibold mb-2">Feature Flag Control</h3>
        <p className="text-sm text-gray-600 mb-2">
          Current status: <span className="font-mono">{isMobileRecordingEnabled() ? 'Enabled' : 'Disabled'}</span>
        </p>
        <button
          onClick={toggleFeatureFlag}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Toggle Mobile Recording
        </button>
      </div>

      {/* Test Controls */}
      <div className="mb-6">
        <button
          onClick={runTests}
          disabled={isRunning}
          className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50"
        >
          {isRunning ? 'Running Tests...' : 'Run Mobile Recording Tests'}
        </button>

        {testSuite && (
          <button
            onClick={generateReport}
            className="ml-4 px-6 py-3 bg-purple-500 text-white rounded-lg hover:bg-purple-600"
          >
            Generate Report
          </button>
        )}
      </div>

      {/* Test Results */}
      {testSuite && (
        <div className="mb-6">
          <h3 className="text-xl font-semibold mb-4">Test Results</h3>

          {/* Summary */}
          <div className="mb-4 p-4 rounded-lg bg-gray-50">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-blue-600">{testSuite.results.length}</div>
                <div className="text-sm text-gray-600">Total Tests</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-600">
                  {testSuite.results.filter(r => r.passed).length}
                </div>
                <div className="text-sm text-gray-600">Passed</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-600">
                  {testSuite.results.filter(r => !r.passed).length}
                </div>
                <div className="text-sm text-gray-600">Failed</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-purple-600">{testSuite.totalDuration}ms</div>
                <div className="text-sm text-gray-600">Duration</div>
              </div>
            </div>
          </div>

          {/* Individual Test Results */}
          <div className="space-y-3">
            {testSuite.results.map((result, index) => (
              <div
                key={index}
                className={`p-4 rounded-lg border-l-4 ${
                  result.passed
                    ? 'bg-green-50 border-green-500'
                    : 'bg-red-50 border-red-500'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold flex items-center">
                    <span className="mr-2">
                      {result.passed ? '✅' : '❌'}
                    </span>
                    {result.testName}
                  </h4>
                  {result.duration && (
                    <span className="text-sm text-gray-500">{result.duration}ms</span>
                  )}
                </div>
                <p className="text-sm text-gray-700">{result.message}</p>
                {result.error && (
                  <details className="mt-2">
                    <summary className="text-sm text-red-600 cursor-pointer">
                      Error Details
                    </summary>
                    <pre className="mt-1 text-xs bg-red-100 p-2 rounded overflow-x-auto">
                      {result.error.stack || result.error.message}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Report Modal */}
      {showReport && testSuite && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg max-w-4xl max-h-3/4 overflow-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold">Test Report</h3>
              <button
                onClick={() => setShowReport(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <pre className="text-sm bg-gray-100 p-4 rounded overflow-x-auto whitespace-pre-wrap">
              {mobileRecordingTestRunner.generateTestReport(testSuite)}
            </pre>
            <div className="mt-4 text-sm text-gray-600">
              Report copied to clipboard
            </div>
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="mt-8 p-4 bg-blue-50 rounded-lg">
        <h3 className="text-lg font-semibold mb-2">Testing Instructions</h3>
        <ul className="text-sm text-gray-700 space-y-1">
          <li>• Enable mobile recording feature flag first</li>
          <li>• Run tests on both desktop and mobile devices for comparison</li>
          <li>• Check browser console for detailed logging</li>
          <li>• Integration tests require actual recording session setup</li>
          <li>• Test results are automatically logged for monitoring</li>
        </ul>
      </div>
    </div>
  );
}