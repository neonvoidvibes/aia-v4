"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";

export type Depth = "mirror" | "lens" | "portal";

export const CANVAS_BACKGROUND_SRC = "/canvas/backgrounds/river_photo_01.png";

interface CanvasViewProps {
  depth: Depth;
  onDepthChange?: (depth: Depth) => void;
}

export default function CanvasView({ depth }: CanvasViewProps) {
  const [isPressing, setIsPressing] = useState(false);

  return (
    <div className="relative flex flex-1 items-center justify-center p-4">
      <div
        className={cn(
          "relative w-full max-w-5xl aspect-[16/9] max-h-full",
          "rounded-[2rem] bg-white/10 dark:bg-black/20",
          "backdrop-blur-2xl border border-white/20 shadow-2xl",
          "flex flex-col items-center justify-center"
        )}
      >
        {/* Headline placeholder */}
        <div className="pointer-events-none select-none px-8 text-center">
          <h1 className="font-extrabold leading-tight tracking-tight text-[min(12vw,88px)] text-white drop-shadow-[0_1px_12px_rgba(0,0,0,0.35)]">
            What is needed?
            <span className="inline-block align-baseline ml-2 h-[0.85em] w-[0.14em] bg-white rounded-sm canvas-thick-cursor" />
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
              "relative h-16 w-16 md:h-20 md:w-20 rounded-full",
              "ring-4 ring-white/70",
              isPressing ? "scale-[1.05]" : "scale-100",
              "transition-transform duration-100 ease-out",
              "bg-white/10"
            )}
          >
            <span
              className={cn(
                "absolute inset-2 rounded-full",
                "bg-white/40",
                isPressing ? "canvas-ptt-pulse" : ""
              )}
            />
          </button>
        </div>

        {/* Depth label */}
        <div className="absolute top-4 right-4">
          <div className="px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide bg-black/50 border border-white/30 text-white backdrop-blur">
            {depth.toUpperCase()}
          </div>
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
