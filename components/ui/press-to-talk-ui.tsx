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

// A simple, visually pleasing simulated waveform
const Waveform = () => {
  const bars = Array.from({ length: 40 });
  return (
    <div className="flex items-center justify-center gap-0.5 h-8">
      {bars.map((_, i) => (
        <motion.div
          key={i}
          className="w-0.5 bg-primary/70"
          initial={{ scaleY: 0.1 }}
          animate={{ scaleY: [0.2, 0.8, 0.2] }}
          transition={{
            duration: 0.8,
            repeat: Infinity,
            repeatType: 'mirror',
            delay: i * 0.05,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
};

const PressToTalkUI: React.FC<PressToTalkUIProps> = ({
  onCancel,
  onSubmit,
  recordingTime,
}) => {
  return (
    <div className={cn("chat-input-layout bg-accent rounded-full p-2 flex items-center w-full")}>
      <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-full flex items-center justify-center bg-[hsl(var(--button-submit-fg-active))] text-[hsl(var(--button-submit-bg-active))]">
        <Button
          variant="ghost"
          size="icon"
          onClick={onCancel}
          className="h-full w-full rounded-full hover:opacity-90"
          aria-label="Cancel recording"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>
      <div className="flex-1 flex items-center justify-center px-4">
        <span className="font-mono text-sm text-accent-foreground w-full text-center">
          {formatTime(recordingTime)}
        </span>
      </div>
      <button
        type="button"
        onClick={onSubmit}
        className={cn(
          "transition-all duration-200 rounded-full flex items-center justify-center",
          "h-9 w-9 sm:h-10 sm:w-10",
          "bg-[hsl(var(--button-submit-fg-active))] text-[hsl(var(--button-submit-bg-active))] hover:opacity-90"
        )}
        aria-label="Submit recording"
      >
        <ArrowUp size={24} />
      </button>
    </div>
  );
};

export default PressToTalkUI;
