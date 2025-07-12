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
    <div className="bg-input-gray rounded-full p-2 flex items-center w-full">
      <Button
        variant="ghost"
        size="icon"
        onClick={onCancel}
        className="h-9 w-9 rounded-full text-muted-foreground hover:bg-muted/50"
        aria-label="Cancel recording"
      >
        <X className="h-5 w-5" />
      </Button>
      <div className="flex-1 flex items-center justify-center px-4">
        <Waveform />
        <span className="font-mono text-sm text-muted-foreground ml-4 w-12 text-right">
          {formatTime(recordingTime)}
        </span>
      </div>
      <Button
        onClick={onSubmit}
        className={cn(
          "transition-all duration-200 rounded-full flex items-center justify-center",
          "h-9 w-9 sm:h-10 sm:w-10",
          "bg-[hsl(var(--button-submit-bg-active))] text-[hsl(var(--button-submit-fg-active))] hover:opacity-90"
        )}
        aria-label="Submit recording"
      >
        <ArrowUp size={24} />
      </Button>
    </div>
  );
};

export default PressToTalkUI;
