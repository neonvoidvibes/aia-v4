import React from 'react';
import { Square, Loader2 } from 'lucide-react';
import WaveformIcon from './waveform-icon';
import { cn } from '../../lib/utils';

interface TTSPlaybackUIProps {
  onStop: () => void;
  playbackTime: number;
  isLoading: boolean;
}

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const TTSPlaybackUI: React.FC<TTSPlaybackUIProps> = ({ onStop, playbackTime, isLoading }) => {
  return (
    <div className={cn("chat-input-layout bg-primary rounded-full p-2 flex items-center w-full")}>
      <div className="h-9 w-9 sm:h-10 sm:w-10" />
      <div className="flex-1 flex items-center justify-center px-4">
        {isLoading ? (
          <Loader2 className="h-5 w-5 text-primary-foreground animate-spin" />
        ) : (
          <span className="font-mono text-sm text-primary-foreground w-full text-center">
            {formatTime(playbackTime)}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onStop}
        className={cn(
          "transition-all duration-200 rounded-full flex items-center justify-center",
          "h-9 w-9 sm:h-10 sm:w-10",
          "bg-[hsl(var(--button-submit-bg-stop))] text-[hsl(var(--button-submit-fg-stop))] hover:opacity-90"
        )}
        aria-label="Stop playback"
      >
        <Square size={18} className="fill-current" />
      </button>
    </div>
  );
};

export default TTSPlaybackUI;
