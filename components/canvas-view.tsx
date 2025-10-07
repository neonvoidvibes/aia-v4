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
}

export default function CanvasView({ depth, onDepthChange }: CanvasViewProps) {
  const [isPressing, setIsPressing] = useState(false);
  const { theme } = useTheme();
  const textContainerRef = React.useRef<HTMLDivElement>(null);
  const [showChevrons, setShowChevrons] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const [canScrollUp, setCanScrollUp] = useState(false);

  // Find the current theme configuration
  const currentTheme = predefinedThemes.find((t) => t.className === theme);
  const welcomeConfig = currentTheme?.welcomeMessage || G_DEFAULT_WELCOME_MESSAGE;
  // const welcomeText = welcomeConfig.text || G_DEFAULT_WELCOME_MESSAGE.text;
  const welcomeText = "The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog.";

  // Check scroll position to show/hide chevrons
  const checkScroll = React.useCallback(() => {
    const container = textContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    // More sensitive detection - check if content is larger than visible area
    const hasScroll = scrollHeight > clientHeight + 1;
    const isAtTop = scrollTop <= 1;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1;

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
      container.addEventListener('scroll', checkScroll);
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
  }, [checkScroll, welcomeText]);

  const scrollToPage = (direction: 'up' | 'down') => {
    const container = textContainerRef.current;
    if (!container) return;

    const scrollAmount = container.clientHeight;
    const currentScrollTop = container.scrollTop;
    const targetScrollTop = direction === 'down'
      ? Math.ceil((currentScrollTop + scrollAmount) / scrollAmount) * scrollAmount
      : Math.floor((currentScrollTop - scrollAmount) / scrollAmount) * scrollAmount;

    container.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior: 'smooth'
    });
  };

  return (
    <div className="relative flex flex-1 flex-col items-center px-4 py-4" style={{ minHeight: 0, paddingBottom: '3rem' }}>
      {/* Container wrapper to maintain aspect ratio and positioning */}
      <div className="relative w-full flex items-center justify-center" style={{ minHeight: 0, flex: '1 1 0', maxHeight: 'calc(100% - 2rem)' }}>
        <div
          className={cn(
            "relative w-full max-w-5xl h-full",
            "rounded-[1.5rem] bg-white/100 dark:bg-black/0",
            "backdrop-blur-xl border border-white/20 shadow-2xl",
            "flex flex-col overflow-hidden"
          )}
          style={{
            aspectRatio: 'auto',
            maxHeight: 'calc(100% - 100px)'
          }}
        >
          {/* Text content area with scroll - absolute positioning to not affect layout */}
          <div className="absolute inset-0 flex items-center justify-center px-16 pt-16 pb-16">
            {/* Scrollable text container */}
            <div
              ref={textContainerRef}
              className="overflow-y-auto overflow-x-hidden scrollbar-hide px-4 pt-16 text-center pointer-events-none flex-1 max-w-4xl"
              onWheel={(e) => e.preventDefault()}
              onTouchMove={(e) => e.preventDefault()}
              style={{
                WebkitOverflowScrolling: 'auto',
                maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, black 10%, black 90%, rgba(0,0,0,0.6) 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, black 10%, black 90%, rgba(0,0,0,0.6) 100%)'
              }}
            >
              <h1 className="font-semibold leading-tight tracking-tight text-[min(8vw,56px)] text-white/80 drop-shadow-[0_1px_12px_rgba(0,0,0,0.35)]">
                {welcomeText}
                <span className="hidden inline-block align-baseline ml-2 h-[0.85em] w-[0.2em] bg-white canvas-thick-cursor" />
              </h1>
            </div>
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

          {/* Depth label */}
          <div className="absolute top-4 right-4">
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
        </div>
      </div>

      {/* Push-to-talk ring button - positioned below container with fixed spacing */}
      <div className="flex-shrink-0 flex items-center justify-center" style={{ marginTop: '0.5rem' }}>
        <button
          type="button"
          aria-label="Push to talk"
          onMouseDown={() => setIsPressing(true)}
          onMouseUp={() => setIsPressing(false)}
          onMouseLeave={() => setIsPressing(false)}
          onTouchStart={() => setIsPressing(true)}
          onTouchEnd={() => setIsPressing(false)}
          className={cn(
            "relative h-12 w-12 md:h-14 md:w-14 rounded-full",
            "ring-4 ring-white/40",
            isPressing ? "scale-[1.05]" : "scale-100",
            "transition-transform duration-100 ease-out",
            "bg-white/5"
          )}
        >
          <span
            className={cn(
              "absolute inset-[6px] rounded-full",
              isPressing ? "bg-white/80 canvas-ptt-pulse" : "opacity-0"
            )}
          />
        </button>
      </div>

      {/* Local styles for cursor + pulse + scrollbar hide */}
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
