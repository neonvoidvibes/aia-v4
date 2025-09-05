"use client"

import { useState, useEffect } from "react"

export function useMobile() {
  const [isMobile, setIsMobile] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    const checkTouchDevice = () => {
      setIsMobile(navigator.maxTouchPoints > 0)
    }
    
    // Initial check
    checkTouchDevice()
  }, [])

  return !!isMobile
}
