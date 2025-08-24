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
    <div className={cn("chat-input-layout bg-primary rounded-[1.8rem] md:rounded-[1.4rem] py-3 px-3 flex flex-col")}>
      <div className="w-full flex items-center justify-center h-12">
        {isLoading ? (
          <Loader2 className="h-5 w-5 text-primary-foreground animate-spin" />
        ) : (
          <div />
        )}
      </div>
      <div className="w-full flex items-center justify-between mt-1">
        <div className="w-8" />
        <div className="flex-1 flex items-center justify-center px-4">
          <span className="font-mono text-sm text-primary-foreground w-full text-center">
            {formatTime(playbackTime)}
          </span>
        </div>
        <button
          type="button"
          onClick={onStop}
          className={cn(
            "transition-all duration-200 rounded-full flex items-center justify-center mobile-tts-button",
            "h-8 w-8",
            "bg-[hsl(var(--button-submit-bg-stop))] text-[hsl(var(--button-submit-fg-stop))] hover:opacity-90"
          )}
          aria-label="Stop playback"
        >
          <Square className="fill-current mobile-tts-icon" />
        </button>
      </div>
    </div>
  );
};

export default TTSPlaybackUI;
