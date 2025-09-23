// Mobile Recording Test Page
// Dedicated page for testing mobile recording functionality

import { MobileRecordingTestPanel } from '@/components/mobile-recording-test-panel';

export default function MobileRecordingTestPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4">
        <h1 className="text-3xl font-bold text-center mb-8">
          Mobile Recording Test Suite
        </h1>

        <div className="mb-8 text-center">
          <div className="inline-block p-4 bg-yellow-100 border border-yellow-400 rounded-lg">
            <p className="text-sm text-yellow-800">
              <strong>Test Environment:</strong> {typeof window !== 'undefined' ? window.location.hostname : 'Server'}
              <br />
              <strong>User Agent:</strong> {typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 100) + '...' : 'N/A'}
            </p>
          </div>
        </div>

        <MobileRecordingTestPanel />
      </div>
    </div>
  );
}