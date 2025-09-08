"use client"

import { useState, useEffect } from "react"

export function useMobile() {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const ua = navigator.userAgent || ""
    // Treat only iOS/Android as mobile; ignore Windows/macOS touch devices
    const isMobileUA =
      // Chromium userAgentData when available
      (navigator as any).userAgentData?.mobile === true ||
      /Android|iPhone|iPad|iPod/i.test(ua)
    setIsMobile(!!isMobileUA)
  }, [])

  return isMobile
}
