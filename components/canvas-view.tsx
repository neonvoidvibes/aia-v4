"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { predefinedThemes, G_DEFAULT_WELCOME_MESSAGE } from "@/lib/themes";
import { useTheme } from "next-themes";
import { Copy, Check, Play, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type Depth = "mirror" | "lens" | "portal";

export const CANVAS_BACKGROUND_SRC = "/canvas/backgrounds/idg_earth.png";

export interface AnalysisStatus {
  state: 'none' | 'analyzing' | 'ready';
  timestamp?: string; // ISO format
}

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
  messageHistory?: Array<{ role: string; content: string }>; // NEW: Message history for navigation
  analysisStatus?: AnalysisStatus; // NEW: Analysis document status
  onRefreshAnalysis?: () => void; // NEW: Manual refresh callback
  isRefreshingAnalysis?: boolean; // NEW: Loading state for refresh
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
  isTTSPlaying = false,
  messageHistory = [],
  analysisStatus = { state: 'none' },
  onRefreshAnalysis,
  isRefreshingAnalysis = false
}: CanvasViewProps) {
  const { theme } = useTheme();
  const textContainerRef = React.useRef<HTMLDivElement>(null);
  const [showChevrons, setShowChevrons] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [userHasScrolled, setUserHasScrolled] = useState(false); // Track manual scroll
  const [copied, setCopied] = useState(false); // Track copy state
  const [showResetConfirm, setShowResetConfirm] = useState(false); // Track reset confirmation modal
  const [showAnalysisConfirm, setShowAnalysisConfirm] = useState(false); // Track analysis confirmation modal

  // Message navigation state
  const assistantMessages = React.useMemo(() =>
    messageHistory.filter(msg => msg.role === 'assistant'),
    [messageHistory]
  );
  const [currentMessageIndex, setCurrentMessageIndex] = useState(assistantMessages.length - 1);

  // Update current message index when history changes (new message arrives)
  React.useEffect(() => {
    if (assistantMessages.length > 0) {
      setCurrentMessageIndex(assistantMessages.length - 1);
    }
  }, [assistantMessages.length]);

  const hasMultipleMessages = assistantMessages.length > 1;
  const isNavigationDisabled = isStreaming || isTTSPlaying;
  const canNavigateLeft = hasMultipleMessages && currentMessageIndex > 0 && !isNavigationDisabled;
  const canNavigateRight = hasMultipleMessages && currentMessageIndex < assistantMessages.length - 1 && !isNavigationDisabled;

  // When streaming, always show live llmOutput; otherwise show navigated message from history
  const displayedOutput = isStreaming
    ? llmOutput
    : (assistantMessages.length > 0 && currentMessageIndex >= 0 && currentMessageIndex < assistantMessages.length)
      ? assistantMessages[currentMessageIndex].content
      : llmOutput;

  // Get theme-specific welcome message
  const currentTheme = predefinedThemes.find(t => t.className === theme);
  const welcomeConfig = currentTheme?.welcomeMessage || G_DEFAULT_WELCOME_MESSAGE;
  const welcomeText = welcomeConfig.text || G_DEFAULT_WELCOME_MESSAGE.text || "";

  const hasLlmOutput = displayedOutput.length > 0;
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
    } else if (isStreaming && displayedOutput.length > 0) {
      // Show content immediately when streaming starts outputting
      setShowContent(true);
    } else if (!isTranscribing && !isStreaming && hasLlmOutput) {
      // Show content when idle with output
      setShowContent(true);
    }
  }, [isTranscribing, isStreaming, hasLlmOutput, displayedOutput.length]);

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

  // Reset manual scroll flag when streaming starts
  React.useEffect(() => {
    if (isStreaming) {
      setUserHasScrolled(false);
    }
  }, [isStreaming]);

  // Auto-scroll to bottom when new content arrives during streaming (only if user hasn't scrolled)
  React.useEffect(() => {
    if (isStreaming && hasLlmOutput && !userHasScrolled && textContainerRef.current) {
      const container = textContainerRef.current;
      // Direct scroll to bottom - browser handles smoothness via CSS
      container.scrollTop = 999999;
    }
  }, [displayedOutput, isStreaming, hasLlmOutput, userHasScrolled]);

  // Keep scroll at bottom after streaming finishes (unless user has de-anchored)
  React.useEffect(() => {
    if (!isStreaming && hasLlmOutput && !userHasScrolled && textContainerRef.current) {
      const container = textContainerRef.current;
      // Temporarily disable smooth scrolling to avoid jerky interruption
      const originalBehavior = container.style.scrollBehavior;
      container.style.scrollBehavior = 'auto';

      // Wait for cursor removal and layout to settle before final scroll
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          container.scrollTop = 999999;
          // Restore smooth scrolling after positioning
          requestAnimationFrame(() => {
            container.style.scrollBehavior = originalBehavior;
          });
        });
      });
    }
  }, [isStreaming, hasLlmOutput, userHasScrolled]);

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

  // Handle reset confirmation
  const handleResetConfirm = () => {
    setShowResetConfirm(false);
    onReset?.();
  };

  // Handle analysis refresh confirmation
  const handleAnalysisConfirm = () => {
    setShowAnalysisConfirm(false);
    onRefreshAnalysis?.();
  };

  // Copy canvas output to clipboard
  const copyToClipboard = () => {
    if (!displayedOutput) return;

    const notifySuccess = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    const notifyFailure = (err?: any) => {
      console.error("[Canvas Copy] Failed:", err);
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(displayedOutput).then(notifySuccess).catch(notifyFailure);
    } else {
      // Fallback for non-secure contexts
      console.warn("[Canvas Copy] Fallback copy (execCommand).");
      try {
        const ta = document.createElement("textarea");
        ta.value = displayedOutput;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        ta.style.top = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) notifySuccess();
        else throw new Error('execCommand fail');
      } catch (err) {
        notifyFailure(err);
      }
    }
  };

  // Check if mobile viewport
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768); // md breakpoint
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Format analysis status text for display
  const getAnalysisStatusText = () => {
    if (isRefreshingAnalysis) {
      return 'Analyzing';
    }

    switch (analysisStatus.state) {
      case 'none':
        return 'No Analysis';
      case 'analyzing':
        return 'Analyzing';
      case 'ready':
        // On mobile, skip date/time formatting
        if (isMobile) {
          return 'Analysis Ready';
        }
        // On desktop, show full timestamp
        if (analysisStatus.timestamp) {
          try {
            const date = new Date(analysisStatus.timestamp);
            const formatted = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} at ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
            return `Analysis Ready · ${formatted}`;
          } catch (e) {
            return 'Analysis Ready';
          }
        }
        return 'Analysis Ready';
      default:
        return 'No Analysis';
    }
  };

  return (
    <div className={cn(
      "relative flex flex-1 flex-col items-center pb-4 md:px-4 md:py-4",
      isMobile ? "px-0 pt-0" : "px-4 pt-0"
    )} style={{ minHeight: 0, paddingBottom: '3rem' }}>
      {/* Mobile: Top header row outside canvas container */}
      {isMobile && (
        <div className="fixed left-0 right-0 flex items-center px-4 z-50" style={{ top: '12px', height: '48px' }}>
          {/* Left/Right Message Navigation Chevrons - centered */}
          <div className={cn(
            "absolute left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-auto z-10",
            hasMultipleMessages ? "opacity-100" : "opacity-0 pointer-events-none"
          )}>
            <button
              type="button"
              onClick={() => {
                if (canNavigateLeft) {
                  setCurrentMessageIndex(prev => prev - 1);
                }
              }}
              className={cn(
                "transition-all",
                canNavigateLeft
                  ? "text-white/50 hover:text-white/70 opacity-100 cursor-pointer"
                  : "text-white/20 opacity-30 cursor-not-allowed"
              )}
              aria-label="Previous message"
              disabled={!canNavigateLeft}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <button
              type="button"
              onClick={() => {
                if (canNavigateRight) {
                  setCurrentMessageIndex(prev => prev + 1);
                }
              }}
              className={cn(
                "transition-all",
                canNavigateRight
                  ? "text-white/50 hover:text-white/70 opacity-100 cursor-pointer"
                  : "text-white/20 opacity-30 cursor-not-allowed"
              )}
              aria-label="Next message"
              disabled={!canNavigateRight}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* TTS indicator and Depth mode button - right side */}
          <div className="absolute right-0 flex items-center gap-3">
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
      )}

      {/* Container wrapper to maintain aspect ratio and positioning */}
      <div className="relative w-full flex items-center justify-center" style={{ minHeight: 0, flex: '1 1 0', maxHeight: 'calc(100% - 2rem)' }}>
        <div
          className={cn(
            "relative w-full h-full flex flex-col overflow-hidden",
            isMobile ? "" : "max-w-5xl rounded-[1.5rem] backdrop-blur-md border border-white/20 shadow-2xl"
          )}
          style={{
            aspectRatio: 'auto',
            maxHeight: isMobile ? '100%' : 'calc(100% - 100px)',
            backgroundColor: 'rgba(0, 0, 0, 0)' // Force transparent regardless of theme
          }}
        >
          {/* Text content area - absolute positioning to not affect layout */}
          <div className={cn(
            "absolute inset-0 flex justify-center",
            isMobile ? "px-4" : "px-16"
          )}>
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
                  "overflow-y-auto overflow-x-hidden scrollbar-hide px-2 md:px-4 pt-24 pb-24 text-left flex-1 max-w-4xl transition-opacity duration-500",
                  showContent ? "opacity-100" : "opacity-0"
                )}
                onWheel={(e) => {
                  // Detect user scrolling up to de-anchor
                  if (isStreaming && e.deltaY < 0) {
                    setUserHasScrolled(true);
                  }
                }}
                style={{
                  WebkitOverflowScrolling: 'auto',
                  userSelect: 'text',
                  scrollBehavior: 'smooth'
                }}
              >
                <h1 className="font-semibold leading-tight tracking-tight text-[min(7vw,52px)] text-white/80 drop-shadow-[0_1px_12px_rgba(0,0,0,0.35)]" style={{
                  paddingBottom: displayedOutput.split('\n').length > 5 ? '8rem' : '0'
                }}>
                  {displayedOutput}
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

          {/* Desktop: Top row inside canvas container */}
          {!isMobile && (
            <div className="absolute top-4 left-0 right-0 flex items-center justify-center">
            {/* Left/Right Message Navigation Chevrons - centered at top, dimmed during streaming/TTS, invisible when <=1 messages */}
            <div className={cn(
              "flex items-center gap-2 pointer-events-auto z-10",
              hasMultipleMessages ? "opacity-100" : "opacity-0 pointer-events-none"
            )}>
              {/* Left chevron */}
              <button
                type="button"
                onClick={() => {
                  if (canNavigateLeft) {
                    setCurrentMessageIndex(prev => prev - 1);
                  }
                }}
                className={cn(
                  "transition-all",
                  canNavigateLeft
                    ? "text-white/50 hover:text-white/70 opacity-100 cursor-pointer"
                    : "text-white/20 opacity-30 cursor-not-allowed"
                )}
                aria-label="Previous message"
                disabled={!canNavigateLeft}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>

              {/* Right chevron */}
              <button
                type="button"
                onClick={() => {
                  if (canNavigateRight) {
                    setCurrentMessageIndex(prev => prev + 1);
                  }
                }}
                className={cn(
                  "transition-all",
                  canNavigateRight
                    ? "text-white/50 hover:text-white/70 opacity-100 cursor-pointer"
                    : "text-white/20 opacity-30 cursor-not-allowed"
                )}
                aria-label="Next message"
                disabled={!canNavigateRight}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            {/* TTS indicator and Depth mode button - positioned at top right */}
            <div className={cn(
              "absolute flex items-center gap-3",
              isMobile ? "right-0" : "right-4"
            )}>
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
          </div>
          )}

          {/* Analysis status text - bottom center, same style as depth mode indicator */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none">
            <span className="text-xs regularmedium uppercase tracking-wide text-white/35">
              {getAnalysisStatusText()}
            </span>
          </div>

          {/* Action buttons - desktop: aligned with chevrons, mobile: hidden (moved to bottom row) */}
          {!isMobile && (
            <div className="absolute flex items-center gap-2" style={{ right: '1.75rem', bottom: 'calc(1rem + 4px)' }}>
              {/* Copy button - only show when there's output */}
              {hasLlmOutput && (
                <button
                  type="button"
                  onClick={copyToClipboard}
                  className="text-white/30 hover:text-white/50 transition-colors cursor-pointer"
                  aria-label="Copy canvas output"
                >
                  {copied ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    <Copy className="w-5 h-5" />
                  )}
                </button>
              )}

              {/* Restart button (left-pointing triangle icon) */}
              <button
                type="button"
                onClick={() => setShowResetConfirm(true)}
                className="text-white/30 hover:text-white/50 transition-colors cursor-pointer"
                aria-label="Restart canvas session"
              >
                <RotateCcw className="w-5 h-5" />
              </button>

              {/* Refresh Analysis button (play icon) */}
              <button
                type="button"
                onClick={() => setShowAnalysisConfirm(true)}
                className={cn(
                  "transition-colors",
                  isRefreshingAnalysis
                    ? "text-white/50 cursor-wait animate-pulse"
                    : "text-white/30 hover:text-white/50 cursor-pointer"
                )}
                aria-label="Refresh analysis"
                disabled={isRefreshingAnalysis}
              >
                <Play className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Push-to-talk ring button - positioned below container with fixed spacing */}
      <div className={cn(
        "flex-shrink-0 flex items-center gap-2",
        isMobile ? "w-full justify-between px-4" : "flex-col justify-center"
      )} style={{ marginTop: '0.5rem' }}>
        {/* Spacer for mobile to push PTT to center */}
        {isMobile && <div className="flex-1" />}

        <button
          type="button"
          aria-label="Push to talk"
          disabled={isStreaming || isRefreshingAnalysis || analysisStatus.state === 'analyzing'}
          onMouseDown={() => !isStreaming && !isRefreshingAnalysis && analysisStatus.state !== 'analyzing' && onPTTPress?.()}
          onMouseUp={() => !isStreaming && !isRefreshingAnalysis && analysisStatus.state !== 'analyzing' && onPTTRelease?.()}
          onMouseLeave={() => !isStreaming && !isRefreshingAnalysis && analysisStatus.state !== 'analyzing' && onPTTRelease?.()}
          onTouchStart={(e) => {
            e.preventDefault();
            if (!isStreaming && !isRefreshingAnalysis && analysisStatus.state !== 'analyzing') onPTTPress?.();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            if (!isStreaming && !isRefreshingAnalysis && analysisStatus.state !== 'analyzing') onPTTRelease?.();
          }}
          className={cn(
            "relative h-12 w-12 md:h-14 md:w-14 rounded-full overflow-visible",
            "transition-all duration-300 ease-out",
            (isStreaming || isRefreshingAnalysis || analysisStatus.state === 'analyzing')
              ? "ring-4 ring-white/35 opacity-80 cursor-not-allowed"
              : isPTTActive
                ? "canvas-ptt-active-ring scale-[1.08]"
                : "ring-4 ring-white/40 hover:ring-white/60 scale-100"
          )}
        >
          {!isPTTActive && (
            <span className="absolute inset-0 rounded-full bg-transparent" />
          )}
        </button>

        {/* Mobile: Action buttons on same row as PTT, right-aligned */}
        {isMobile && (
          <div className="flex-1 flex items-center justify-end gap-2">
            {/* Copy button - only show when there's output */}
            {hasLlmOutput && (
              <button
                type="button"
                onClick={copyToClipboard}
                className="text-white/30 hover:text-white/50 transition-colors cursor-pointer"
                aria-label="Copy canvas output"
              >
                {copied ? (
                  <Check className="w-5 h-5" />
                ) : (
                  <Copy className="w-5 h-5" />
                )}
              </button>
            )}

            {/* Restart button */}
            <button
              type="button"
              onClick={() => setShowResetConfirm(true)}
              className="text-white/30 hover:text-white/50 transition-colors cursor-pointer"
              aria-label="Restart canvas session"
            >
              <RotateCcw className="w-5 h-5" />
            </button>

            {/* Refresh Analysis button */}
            <button
              type="button"
              onClick={() => setShowAnalysisConfirm(true)}
              className={cn(
                "transition-colors",
                isRefreshingAnalysis
                  ? "text-white/50 cursor-wait animate-pulse"
                  : "text-white/30 hover:text-white/50 cursor-pointer"
              )}
              aria-label="Refresh analysis"
              disabled={isRefreshingAnalysis}
            >
              <Play className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>

      {/* Reset Confirmation Modal */}
      <Dialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Canvas Session</DialogTitle>
            <DialogDescription>
              Are you sure you want to reset the canvas? This will clear all current content and conversation history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setShowResetConfirm(false)}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={handleResetConfirm}
            >
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Analysis Refresh Confirmation Modal */}
      <Dialog open={showAnalysisConfirm} onOpenChange={setShowAnalysisConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Refresh Analysis</DialogTitle>
            <DialogDescription>
              Are you sure you want to refresh the analysis? This will generate a new analysis document based on the current conversation.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setShowAnalysisConfirm(false)}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={handleAnalysisConfirm}
            >
              Refresh
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

        /* Fluid crashing waves animation - contained in ring */
        @keyframes canvas-ptt-wave-crash-1 {
          0% {
            transform: rotate(0deg) scale(1);
            opacity: 0;
          }
          8% {
            opacity: 0.9;
          }
          33% {
            transform: rotate(120deg) scale(1.05);
            opacity: 1;
          }
          66% {
            transform: rotate(240deg) scale(0.95);
            opacity: 0.8;
          }
          100% {
            transform: rotate(360deg) scale(1);
            opacity: 0.9;
          }
        }

        @keyframes canvas-ptt-wave-crash-2 {
          0% {
            transform: rotate(180deg) scale(1);
            opacity: 0;
          }
          8% {
            opacity: 0.8;
          }
          33% {
            transform: rotate(60deg) scale(1.08);
            opacity: 1;
          }
          66% {
            transform: rotate(300deg) scale(0.92);
            opacity: 0.7;
          }
          100% {
            transform: rotate(540deg) scale(1);
            opacity: 0.8;
          }
        }

        @keyframes canvas-ptt-wave-crash-3 {
          0%, 100% {
            transform: rotate(90deg) scale(1);
            opacity: 0.85;
          }
          50% {
            transform: rotate(270deg) scale(1.1);
            opacity: 1;
          }
        }

        @keyframes canvas-ptt-glow-pulse {
          0%, 100% {
            box-shadow:
              inset 0 0 20px 2px rgba(255, 255, 255, 0.4),
              inset 0 0 30px 4px rgba(255, 255, 255, 0.3),
              0 0 15px 1px rgba(255, 255, 255, 0.3);
          }
          50% {
            box-shadow:
              inset 0 0 25px 3px rgba(255, 255, 255, 0.5),
              inset 0 0 35px 5px rgba(255, 255, 255, 0.4),
              0 0 20px 2px rgba(255, 255, 255, 0.4);
          }
        }

        .canvas-ptt-active-ring {
          position: relative;
          border: 6px solid transparent;
          background: transparent;
          overflow: visible;
        }

        /* First wave layer - white gradient in RING */
        .canvas-ptt-active-ring::before {
          content: '';
          position: absolute;
          inset: -6px;
          border-radius: 50%;
          padding: 6px;
          background: conic-gradient(
            from 0deg,
            rgba(255, 255, 255, 0.9) 0deg,
            rgba(255, 255, 255, 0.7) 80deg,
            rgba(255, 255, 255, 0.3) 160deg,
            transparent 240deg,
            transparent 360deg
          );
          -webkit-mask:
            radial-gradient(farthest-side, transparent calc(100% - 6px), white calc(100% - 6px));
          mask:
            radial-gradient(farthest-side, transparent calc(100% - 6px), white calc(100% - 6px));
          filter: blur(2px) saturate(2);
          transform-origin: center center;
          will-change: transform, opacity;
          animation: canvas-ptt-wave-crash-1 5s ease-in-out infinite;
        }

        /* Second wave layer - white gradient in RING */
        .canvas-ptt-active-ring::after {
          content: '';
          position: absolute;
          inset: -6px;
          border-radius: 50%;
          padding: 6px;
          background: conic-gradient(
            from 120deg,
            rgba(255, 255, 255, 0.8) 0deg,
            rgba(255, 255, 255, 0.9) 70deg,
            rgba(255, 255, 255, 0.7) 150deg,
            rgba(255, 255, 255, 0.3) 220deg,
            transparent 290deg,
            transparent 360deg
          );
          -webkit-mask:
            radial-gradient(farthest-side, transparent calc(100% - 6px), white calc(100% - 6px));
          mask:
            radial-gradient(farthest-side, transparent calc(100% - 6px), white calc(100% - 6px));
          filter: blur(2px) saturate(2);
          transform-origin: center center;
          will-change: transform, opacity;
          animation: canvas-ptt-wave-crash-2 6s ease-in-out infinite 1s;
        }

        /* Glow effect on main element */
        .canvas-ptt-active-ring {
          animation: canvas-ptt-glow-pulse 3s ease-in-out infinite;
        }

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
