"use client"

import { useState, useEffect } from "react"

export function useMobile() {
  const [isMobile, setIsMobile] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)")
    const onChange = () => {
      setIsMobile(window.innerWidth < 768)
    }
    
    // Initial check
    setIsMobile(window.innerWidth < 768)
    
    // Add event listener
    mql.addEventListener("change", onChange)

    // Clean up
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
