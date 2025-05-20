"use client"

import * as React from "react"
import { MessageSquare, LayoutGrid, AudioLines } from "lucide-react" // Added AudioLines
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { useMobile } from "@/hooks/use-mobile"

interface ViewSwitcherProps {
  currentView: "chat" | "canvas" | "transcribe"
  onViewChange: (view: "chat" | "canvas" | "transcribe") => void
  agentName?: string | null
  className?: string
  isCanvasEnabled?: boolean // To conditionally hide canvas tab
}

export default function ViewSwitcher({
  currentView,
  onViewChange,
  agentName,
  className,
  isCanvasEnabled = false, // Default to false if not provided
}: ViewSwitcherProps) {
  const isMobile = useMobile()

  const chatLabel = isMobile ? "Chat" : "Chat" // Simplified label, agent name might be displayed elsewhere
  const transcribeLabel = isMobile ? "Audio" : "Transcribe"
  const canvasLabel = isMobile ? "Canvas" : "Canvas"
  
  const gridColsClass = isCanvasEnabled ? "grid-cols-3" : "grid-cols-2";

  return (
    <Tabs
      value={currentView}
      onValueChange={(value) => onViewChange(value as "chat" | "canvas" | "transcribe")}
      className={cn("w-auto mx-auto", className)}
    >
      <TabsList className={cn("grid w-full h-9 sm:h-10", gridColsClass)}>
        <TabsTrigger value="chat" className="px-2 sm:px-3 text-xs sm:text-sm h-full">
          <MessageSquare className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
          {chatLabel}
        </TabsTrigger>
        <TabsTrigger value="transcribe" className="px-2 sm:px-3 text-xs sm:text-sm h-full">
          <AudioLines className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
          {transcribeLabel}
        </TabsTrigger>
        {isCanvasEnabled && (
          <TabsTrigger value="canvas" className="px-2 sm:px-3 text-xs sm:text-sm h-full">
            <LayoutGrid className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
            {canvasLabel}
          </TabsTrigger>
        )}
      </TabsList>
    </Tabs>
  )
}