"use client"

import { useEffect, useState } from "react"

// Returns true if browser supports basic recording APIs we rely on
export function useRecordingSupport() {
  const [supported, setSupported] = useState(false)

  useEffect(() => {
    const has = !!(
      typeof navigator !== "undefined" &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function" &&
      typeof (window as any).MediaRecorder !== "undefined"
    )
    setSupported(has)
  }, [])

  return supported
}

