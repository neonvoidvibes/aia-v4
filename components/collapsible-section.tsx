"use client"

import type React from "react"
import { useState, useRef, useEffect } from "react"
import { ChevronRight } from "lucide-react"
import { useMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils" // Import cn for potential future use

interface CollapsibleSectionProps {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  onToggle?: (isOpen: boolean) => void
}

export default function CollapsibleSection({ title, children, defaultOpen = true, onToggle }: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen) // Default to true for desktop, mobile handles its own state.
  const contentRef = useRef<HTMLDivElement>(null)
  const isMobile = useMobile()

  // Adjust initial open state for mobile if it differs from desktop default
  useEffect(() => {
    if (isMobile) {
      setIsOpen(false) // Default to closed on mobile if that's the desired UX
    } else {
      setIsOpen(defaultOpen) // Respect defaultOpen for desktop
    }
  }, [isMobile, defaultOpen])
  
  // Handle content max-height for animation
  useEffect(() => {
    if (contentRef.current) {
      if (isOpen) {
        // For mobile, or if desktop is also animated (currently not, but for future)
        contentRef.current.style.maxHeight = contentRef.current.scrollHeight + "px";
      } else {
        contentRef.current.style.maxHeight = "0px";
      }
    }
  }, [isOpen, children]) // Re-run if children change, as scrollHeight might change

  const toggleSection = () => {
    const newState = !isOpen
    setIsOpen(newState)
    if (onToggle) {
      onToggle(newState)
    }
  }

  // Common header structure
  const HeaderContent = (
    <>
      <span className="memory-section-title">{title}</span>
      <ChevronRight
        className={cn(
          "section-toggle-icon transition-transform duration-200",
          isOpen ? "rotate-90" : "rotate-0"
        )}
        size={20}
      />
    </>
  )

  return (
    // .memory-section has no horizontal padding. It inherits from .tab-content-inner.
    <div className="memory-section">
      {isMobile ? (
        // Mobile: button is the header. px-0 ensures its content aligns with .tab-content-inner padding.
        <button
          className="section-toggle w-full flex items-center justify-between px-0 py-2" // Added py-2 for consistent header height
          onClick={toggleSection}
          aria-expanded={isOpen}
        >
          {HeaderContent}
        </button>
      ) : (
        // Desktop: h3 is the header. px-0 ensures its content aligns with .tab-content-inner padding.
        // onClick added for desktop toggling as well.
        <h3
          className="memory-section-title w-full flex items-center justify-between px-0 py-2 cursor-pointer" // Added py-2, cursor-pointer
          onClick={toggleSection}
          role="button"
          aria-expanded={isOpen}
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleSection(); }}
        >
          {HeaderContent}
        </h3>
      )}
      {/* Content wrapper also has px-0. Its children will align with .tab-content-inner padding. */}
      {/* Animated container for expand/collapse. It uses overflow:hidden for the animation effect. */}
      <div
        ref={contentRef}
        className={cn(
          "overflow-hidden transition-[max-height] duration-300 ease-in-out"
          // The px-0 is removed as padding should be handled by parent (.tab-content-inner) or child content.
        )}
        style={{
           // scrollHeight here will be the offsetHeight of its direct child (the .settings-section-scrollable div),
           // which is capped by its own CSS max-height if its content overflows. This ensures the animation
           // expands to show the scrollable area correctly, up to its defined max-height.
           maxHeight: isOpen ? (contentRef.current?.scrollHeight + "px") : "0px",
        }}
      >
        {/* Scrollable container for the actual content. This div gets max-height and overflow-y from CSS. */}
        <div className="settings-section-scrollable">
          {/* This inner div was already there, contains the actual children. It should fill width. */}
          <div className="pt-1 pb-3 w-full">{children}</div>
        </div>
      </div>
    </div>
  )
}