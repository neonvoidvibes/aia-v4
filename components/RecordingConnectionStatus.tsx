"use client";

import React from 'react';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RecordingConnectionStatusProps {
  connectionStatus?: 'connected' | 'disconnected' | 'reconnecting';
  reconnectAttempt?: number;
  className?: string;
}

export function RecordingConnectionStatus({
  connectionStatus,
  reconnectAttempt = 0,
  className
}: RecordingConnectionStatusProps) {
  if (!connectionStatus || connectionStatus === 'connected') {
    return null; // Don't show anything when connected
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium",
        connectionStatus === 'reconnecting' && "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400",
        connectionStatus === 'disconnected' && "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400",
        className
      )}
    >
      {connectionStatus === 'reconnecting' && (
        <>
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span>Reconnecting{reconnectAttempt > 0 && ` (attempt ${reconnectAttempt})`}...</span>
        </>
      )}
      {connectionStatus === 'disconnected' && (
        <>
          <WifiOff className="h-4 w-4" />
          <span>Connection lost</span>
        </>
      )}
    </div>
  );
}
