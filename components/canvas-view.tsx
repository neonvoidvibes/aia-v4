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

export default function CanvasView({ depth }: CanvasViewProps) {
  const [isPressing, setIsPressing] = useState(false);
  const { theme } = useTheme();

  // Find the current theme configuration
  const currentTheme = predefinedThemes.find((t) => t.className === theme);
  const welcomeConfig = currentTheme?.welcomeMessage || G_DEFAULT_WELCOME_MESSAGE;
  const welcomeText = welcomeConfig.text || G_DEFAULT_WELCOME_MESSAGE.text;

  return (
    <div className="relative flex flex-1 items-center justify-center p-4">
      <div
        className={cn(
          "relative w-full max-w-5xl aspect-[16/9] max-h-full",
          "rounded-[1.5rem] bg-white/10 dark:bg-black/20",
          "backdrop-blur-md border border-white/20 shadow-2xl",
          "-translate-y-[33px]",
          "flex flex-col items-center justify-center"
        )}
      >
        {/* Headline placeholder */}
        <div className="pointer-events-none select-none px-8 text-center">
          <h1 className="font-semibold leading-tight tracking-tight text-[min(8vw,56px)] text-white/80 drop-shadow-[0_1px_12px_rgba(0,0,0,0.35)]">
            {welcomeText}
            <span className="hidden inline-block align-baseline ml-2 h-[0.85em] w-[0.2em] bg-white canvas-thick-cursor" />
          </h1>
        </div>

        {/* Push-to-talk ring button */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
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

      {/* Local styles for cursor + pulse */}
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
      `}</style>
    </div>
  );
}
