"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { predefinedThemes, G_DEFAULT_WELCOME_MESSAGE } from "@/lib/themes";
import { useTheme } from "next-themes";

export type Depth = "mirror" | "lens" | "portal";

export const CANVAS_BACKGROUND_SRC = "/canvas/backgrounds/river_photo_01.png";

interface CanvasViewProps {
  depth: Depth;
  onDepthChange?: (depth: Depth) => void;
  llmOutput?: string;
  isStreaming?: boolean;
  onPTTPress?: () => void;
  onPTTRelease?: () => void;
  isPTTActive?: boolean;
  statusMessage?: string;
  isTranscribing?: boolean;
  onReset?: () => void;
  isTTSPlaying?: boolean; // NEW: Show audio indicator when TTS is playing
}

export default function CanvasView({
  depth,
  onDepthChange,
  llmOutput = "",
  isStreaming = false,
  onPTTPress,
  onPTTRelease,
  isPTTActive = false,
  statusMessage = "",
  isTranscribing = false,
  onReset,
  isTTSPlaying = false
}: CanvasViewProps) {
  const { theme } = useTheme();
  const textContainerRef = React.useRef<HTMLDivElement>(null);
  const [showChevrons, setShowChevrons] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const [canScrollUp, setCanScrollUp] = useState(false);

  // Find the current theme configuration
  const currentTheme = predefinedThemes.find((t) => t.className === theme);
  const welcomeConfig = currentTheme?.welcomeMessage || G_DEFAULT_WELCOME_MESSAGE;
  const welcomeText = welcomeConfig.text || G_DEFAULT_WELCOME_MESSAGE.text;

  const hasLlmOutput = llmOutput.length > 0;
  const [showWelcome, setShowWelcome] = React.useState(true);
  const [showContent, setShowContent] = React.useState(true);

  // Fade out welcome when PTT is released
  React.useEffect(() => {
    if (!isPTTActive && statusMessage) {
      setShowWelcome(false);
    }
  }, [isPTTActive, statusMessage]);

  // Reset welcome when output is cleared
  React.useEffect(() => {
    if (!hasLlmOutput && !isTranscribing && !isStreaming) {
      setShowWelcome(true);
    }
  }, [hasLlmOutput, isTranscribing, isStreaming]);

  // Manage content visibility during transcription and streaming
  React.useEffect(() => {
    if (isTranscribing && hasLlmOutput) {
      // Fade out existing content when transcribing starts
      setShowContent(false);
      // Hide chevrons during transcription
      setShowChevrons(false);
    } else if (isStreaming && llmOutput.length > 0) {
      // Show content immediately when streaming starts outputting
      setShowContent(true);
    } else if (!isTranscribing && !isStreaming && hasLlmOutput) {
      // Show content when idle with output
      setShowContent(true);
    }
  }, [isTranscribing, isStreaming, hasLlmOutput, llmOutput.length]);

  // Hide chevrons when resetting (no output)
  React.useEffect(() => {
    if (!hasLlmOutput) {
      setShowChevrons(false);
    }
  }, [hasLlmOutput]);

  // Check scroll position to show/hide chevrons
  const checkScroll = React.useCallback(() => {
    const container = textContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    // More sensitive detection - check if content is larger than visible area
    const hasScroll = scrollHeight > clientHeight + 1;
    const isAtTop = scrollTop <= 5;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 5;

    setShowChevrons(hasScroll);
    setCanScrollUp(hasScroll && !isAtTop);
    setCanScrollDown(hasScroll && !isAtBottom);
  }, []);

  React.useEffect(() => {
    // Add a small delay to ensure DOM has settled
    const timeoutId = setTimeout(() => {
      checkScroll();
    }, 100);

    const container = textContainerRef.current;
    if (container) {
      // Use passive event listener for better scroll performance
      container.addEventListener('scroll', checkScroll, { passive: true });
      // Also check on resize
      const resizeObserver = new ResizeObserver(() => {
        // Delay check after resize to let layout settle
        setTimeout(checkScroll, 50);
      });
      resizeObserver.observe(container);
      return () => {
        clearTimeout(timeoutId);
        container.removeEventListener('scroll', checkScroll);
        resizeObserver.disconnect();
      };
    }
    return () => clearTimeout(timeoutId);
  }, [checkScroll, welcomeText, llmOutput]);

  // Auto-scroll to bottom when new content arrives during streaming
  React.useEffect(() => {
    if (isStreaming && hasLlmOutput && textContainerRef.current) {
      const container = textContainerRef.current;
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth'
      });
      // Delay checkScroll to allow scroll animation to complete
      setTimeout(checkScroll, 300);
    }
  }, [llmOutput, isStreaming, hasLlmOutput, checkScroll]);

  const scrollToPage = (direction: 'up' | 'down') => {
    const container = textContainerRef.current;
    if (!container) return;

    // Use the visible height (clientHeight) minus padding for scroll amount
    const scrollAmount = container.clientHeight * 0.9; // Scroll 90% of visible height
    const currentScrollTop = container.scrollTop;

    const targetScrollTop = direction === 'down'
      ? currentScrollTop + scrollAmount
      : Math.max(0, currentScrollTop - scrollAmount);

    container.scrollTo({
      top: targetScrollTop,
      behavior: 'smooth'
    });

    // Update chevron state after scroll animation
    setTimeout(checkScroll, 300);
  };

  return (
    <div className="relative flex flex-1 flex-col items-center px-4 py-4" style={{ minHeight: 0, paddingBottom: '3rem' }}>
      {/* Container wrapper to maintain aspect ratio and positioning */}
      <div className="relative w-full flex items-center justify-center" style={{ minHeight: 0, flex: '1 1 0', maxHeight: 'calc(100% - 2rem)' }}>
        <div
          className={cn(
            "relative w-full max-w-5xl h-full",
            "rounded-[1.5rem]",
            "backdrop-blur-md border border-white/20 shadow-2xl",
            "flex flex-col overflow-hidden"
          )}
          style={{
            aspectRatio: 'auto',
            maxHeight: 'calc(100% - 100px)',
            backgroundColor: 'rgba(0, 0, 0, 0)' // Force transparent regardless of theme
          }}
        >
          {/* Text content area - absolute positioning to not affect layout */}
          <div className="absolute inset-0 flex justify-center px-16">
            {!hasLlmOutput && !isTranscribing && !isStreaming && showWelcome ? (
              /* Welcome message - vertically centered, fades out when PTT released */
              <div className={cn(
                "flex items-center justify-center flex-1 max-w-4xl text-center pointer-events-none transition-opacity duration-500",
                showWelcome ? "opacity-100" : "opacity-0"
              )}>
                <h1 className="font-semibold leading-tight tracking-tight text-[min(8vw,56px)] text-white/80 drop-shadow-[0_1px_12px_rgba(0,0,0,0.35)]">
                  {welcomeText}
                </h1>
              </div>
            ) : (!showWelcome && !hasLlmOutput) || isTranscribing || (isStreaming && !showContent) ? (
              /* Breathing dot while transcribing, waiting for stream, or streaming with faded content - larger, centered */
              <div className="flex items-center justify-center flex-1">
                <div
                  className="rounded-full bg-white/80"
                  style={{
                    width: '32px',
                    height: '32px',
                    animation: 'breathing-dot 2.5s ease-in-out infinite'
                  }}
                />
              </div>
            ) : hasLlmOutput ? (
              /* LLM output - scrollable, top-aligned, left-aligned text, fades out when transcribing */
              <div
                ref={textContainerRef}
                className={cn(
                  "overflow-y-auto overflow-x-hidden scrollbar-hide px-4 pt-16 text-left flex-1 max-w-4xl transition-opacity duration-500",
                  showContent ? "opacity-100" : "opacity-0"
                )}
                onWheel={(e) => e.preventDefault()}
                onTouchMove={(e) => e.preventDefault()}
                style={{
                  WebkitOverflowScrolling: 'auto',
                  maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, black 10%, black 90%, rgba(0,0,0,0.6) 100%)',
                  WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, black 10%, black 90%, rgba(0,0,0,0.6) 100%)',
                  userSelect: 'text'
                }}
              >
                <h1 className="font-semibold leading-tight tracking-tight text-[min(8vw,56px)] text-white/80 drop-shadow-[0_1px_12px_rgba(0,0,0,0.35)]">
                  {llmOutput}
                  {/* Show blinking cursor during streaming */}
                  <span className={cn(
                    "inline-block align-baseline ml-2 h-[0.85em] w-[0.2em] bg-white canvas-thick-cursor",
                    isStreaming ? "" : "hidden"
                  )} />
                </h1>
              </div>
            ) : null}
          </div>

          {/* Chevron controls - positioned to the right of text, vertically centered */}
          {showChevrons && (
            <div className="absolute top-1/2 -translate-y-1/2" style={{ right: '1.75rem' }}>
              <div className="flex flex-col items-center gap-2 pointer-events-auto z-10">
                {/* Up chevron */}
                <button
                  type="button"
                  onClick={() => canScrollUp && scrollToPage('up')}
                  className={cn(
                    "transition-all",
                    canScrollUp
                      ? "text-white/50 hover:text-white/70 opacity-100 cursor-pointer"
                      : "text-white/20 opacity-30 cursor-not-allowed"
                  )}
                  aria-label="Scroll up"
                  disabled={!canScrollUp}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                </button>

                {/* Down chevron */}
                <button
                  type="button"
                  onClick={() => canScrollDown && scrollToPage('down')}
                  className={cn(
                    "transition-all",
                    canScrollDown
                      ? "text-white/50 hover:text-white/70 opacity-100 cursor-pointer"
                      : "text-white/20 opacity-30 cursor-not-allowed"
                  )}
                  aria-label="Scroll down"
                  disabled={!canScrollDown}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Depth label and TTS indicator */}
          <div className="absolute top-4 right-4 flex items-center gap-3">
            {/* TTS Audio Indicator - subtle animated waves */}
            {isTTSPlaying && (
              <div className="flex items-center gap-[3px]" aria-label="Audio playing">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="w-[3px] bg-white/60 rounded-full canvas-audio-wave"
                    style={{
                      height: '12px',
                      animationDelay: `${i * 0.15}s`
                    }}
                  />
                ))}
              </div>
            )}

            {/* Depth mode button */}
            <button
              type="button"
              onClick={() => {
                const depths: Depth[] = ["mirror", "lens", "portal"];
                const currentIndex = depths.indexOf(depth);
                const nextIndex = (currentIndex + 1) % depths.length;
                onDepthChange?.(depths[nextIndex]);
              }}
              className="px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide text-white/50 hover:text-white/70 transition-colors cursor-pointer"
            >
              {depth.toUpperCase()}
            </button>
          </div>

          {/* Reset button - horizontally aligned with chevrons */}
          <div className="absolute" style={{ right: '1.75rem', bottom: 'calc(1rem + 4px)' }}>
            <button
              type="button"
              onClick={() => {
                onReset?.();
              }}
              className="text-white/30 hover:text-white/50 transition-colors cursor-pointer"
              aria-label="Reset canvas"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray="1 3.5"
                viewBox="0 0 24 24"
              >
                {/* Dotted circle */}
                <circle cx="12" cy="12" r="9" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Push-to-talk ring button - positioned below container with fixed spacing */}
      <div className="flex-shrink-0 flex flex-col items-center justify-center gap-2" style={{ marginTop: '0.5rem' }}>
        <button
          type="button"
          aria-label="Push to talk"
          onMouseDown={() => onPTTPress?.()}
          onMouseUp={() => onPTTRelease?.()}
          onMouseLeave={() => onPTTRelease?.()}
          onTouchStart={(e) => {
            e.preventDefault();
            onPTTPress?.();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            onPTTRelease?.();
          }}
          className={cn(
            "relative h-12 w-12 md:h-14 md:w-14 rounded-full",
            "ring-4 ring-white/40",
            isPTTActive ? "scale-[1.05]" : "scale-100",
            "transition-transform duration-100 ease-out",
            "bg-white/5"
          )}
        >
          <span
            className={cn(
              "absolute inset-[6px] rounded-full",
              isPTTActive ? "bg-white/80 canvas-ptt-pulse" : "opacity-0"
            )}
          />
        </button>
      </div>

      {/* Local styles for cursor + pulse + audio wave + scrollbar hide */}
      <style>{`
        @keyframes canvas-thick-cursor-keyframe {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        .canvas-thick-cursor { animation: canvas-thick-cursor-keyframe 1.1s steps(1) infinite; }

        @keyframes canvas-ptt-pulse-keyframe {
          0% { box-shadow: 0 0 0 0 rgba(255,255,255,0.55); }
          70% { box-shadow: 0 0 0 18px rgba(255,255,255,0); }
          100% { box-shadow: 0 0 0 0 rgba(255,255,255,0); }
        }
        .canvas-ptt-pulse { animation: canvas-ptt-pulse-keyframe 1.6s ease-out infinite; }

        @keyframes canvas-audio-wave-keyframe {
          0%, 100% { height: 6px; opacity: 0.5; }
          50% { height: 16px; opacity: 1; }
        }
        .canvas-audio-wave { animation: canvas-audio-wave-keyframe 0.9s ease-in-out infinite; }

        /* Hide scrollbar but keep functionality */
        .scrollbar-hide {
          -ms-overflow-style: none;  /* IE and Edge */
          scrollbar-width: none;  /* Firefox */
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;  /* Chrome, Safari and Opera */
        }
      `}</style>
    </div>
  );
}
