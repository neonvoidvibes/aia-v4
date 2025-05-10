"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { ChevronRight } from "lucide-react"
import { useMobile } from "@/hooks/use-mobile"

interface CollapsibleSectionProps {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  onToggle?: (isOpen: boolean) => void
}

export default function CollapsibleSection({ title, children, defaultOpen = true, onToggle }: CollapsibleSectionProps) {
  // Always start closed on mobile
  const [isOpen, setIsOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const isMobile = useMobile()

  // Initialize state based on device type
  useEffect(() => {
    // On desktop, always show content
    if (!isMobile && contentRef.current) {
      contentRef.current.style.maxHeight = "none"
    }
  }, [isMobile])

  const toggleSection = () => {
    const newState = !isOpen
    setIsOpen(newState)

    // Notify parent component about the toggle
    if (onToggle) {
      onToggle(newState)
    }
  }

  // If not mobile, render without toggle
  if (!isMobile) {
    return (
      // Horizontal padding removed, will be inherited from .tab-content-inner
      <div className="memory-section">
        <h3 className="memory-section-title">{title}</h3> 
        <div ref={contentRef}>{children}</div>
      </div>
    )
  }

  return (
    <div className="memory-section">
      {/* Horizontal padding removed, section-toggle takes full width and text aligns with parent padding */}
      <button className="section-toggle w-full" onClick={toggleSection}>
        <span className="memory-section-title">{title}</span> 
        <ChevronRight
          className={`section-toggle-icon ${isOpen ? "open" : ""}`}
          size={20}
          style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
        />
      </button>
      <div
        ref={contentRef}
        className={`section-content ${isOpen ? "open" : ""}`}
        style={{
          maxHeight: isOpen ? "1000px" : "0px",
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  )
}