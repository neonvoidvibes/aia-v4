"use client"

import React from "react"

interface ServiceBannerProps {
  message?: string
}

export default function ServiceBanner({ message }: ServiceBannerProps) {
  const text = message?.trim() || process.env.NEXT_PUBLIC_SERVICE_BANNER_MESSAGE?.trim() || 'SYSTEM MAINTENANCE - Some features may be temporarily unavailable'
  return (
    <div
      id="service-banner"
      role="status"
      aria-live="polite"
      className="relative w-full z-[9999] flex items-center justify-center bg-[#F6CE4A] text-black font-mono overflow-hidden"
      style={{ lineHeight: 1, height: 'var(--sys-banner-h)' }}
    >
      <span className="truncate text-sm px-3">{text}</span>
    </div>
  )
}
