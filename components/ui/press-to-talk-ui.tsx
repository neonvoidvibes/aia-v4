"use client";

import React from 'react';
import { X, ArrowUp } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from './button';
import { cn } from '@/lib/utils';

interface PressToTalkUIProps {
  onCancel: () => void;
  onSubmit: () => void;
  recordingTime: number;
}

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const PressToTalkUI: React.FC<PressToTalkUIProps> = ({
  onCancel,
  onSubmit,
  recordingTime,
}) => {
  return (
    <div className={cn("chat-input-layout bg-primary rounded-[1.8rem] py-3 px-3 flex flex-col")}>
      <div className="w-full flex items-center justify-center h-12">
        {/* Waveform removed as per request */}
      </div>
      <div className="w-full flex items-center justify-between mt-1">
        <div className="h-8 w-8 rounded-full flex items-center justify-center bg-[hsl(var(--button-submit-fg-active))] text-[hsl(var(--button-submit-bg-active))] mobile-stt-button">
          <Button
            variant="ghost"
            size="icon"
            onClick={onCancel}
            className="h-full w-full rounded-full hover:opacity-90 mobile-stt-button"
            aria-label="Cancel recording"
          >
            <X className="mobile-stt-cancel-icon" />
          </Button>
        </div>
        <div className="flex-1 flex items-center justify-center px-4">
          <span className="font-mono text-sm text-primary-foreground w-full text-center">
            {formatTime(recordingTime)}
          </span>
        </div>
        <button
          type="button"
          onClick={onSubmit}
          className={cn(
            "transition-all duration-200 rounded-full flex items-center justify-center mobile-stt-button",
            "h-8 w-8",
            "bg-[hsl(var(--button-submit-fg-active))] text-[hsl(var(--button-submit-bg-active))] hover:opacity-90"
          )}
          aria-label="Submit recording"
        >
          <ArrowUp className="mobile-stt-icon" />
        </button>
      </div>
    </div>
  );
};

export default PressToTalkUI;
