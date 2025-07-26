import React from 'react';
import { Square } from 'lucide-react';
import WaveformIcon from './waveform-icon'; // Reuse existing waveform
import { cn } from '../../lib/utils';

interface TTSPlaybackUIProps {
  onStop: () => void;
}

const TTSPlaybackUI: React.FC<TTSPlaybackUIProps> = ({ onStop }) => {
  return (
    <div className={cn("chat-input-layout bg-accent rounded-full p-2 flex items-center w-full")}>
      <div className="flex-1 flex items-center justify-center px-4">
        <WaveformIcon className="h-6 w-10 text-accent-foreground" />
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
