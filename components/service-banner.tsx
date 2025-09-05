import React from "react";

type Props = { active: boolean; message?: string };

export function ServiceBanner({
  active,
  message = "SYSTEM MAINTENANCE - Some features may be temporarily unavailable",
}: Props) {
  if (!active) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="h-[60px] w-full bg-[#F6CE4A] text-black font-mono flex items-center justify-center px-4 border-b border-black/15"
    >
      <span className="w-full text-center font-semibold tracking-[0.02em] text-[clamp(12px,2.2vw,16px)] whitespace-nowrap overflow-hidden text-ellipsis">
        {message}
      </span>
    </div>
  );
}