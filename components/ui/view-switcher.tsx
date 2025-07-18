"use client"

"use client"

import * as React from "react"
import { MessageSquare, LayoutGrid, AudioLines, Disc } from "lucide-react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { useMobile } from "@/hooks/use-mobile"

type View = "chat" | "canvas" | "transcribe" | "record";

interface ViewSwitcherProps {
  currentView: View
  onViewChange: (view: View) => void
  agentName?: string | null
  className?: string
  isCanvasEnabled?: boolean
}

export default function ViewSwitcher({
  currentView,
  onViewChange,
  agentName,
  className,
  isCanvasEnabled = false,
}: ViewSwitcherProps) {
  const isMobile = useMobile()

  const chatLabel = "Chat"
  const transcribeLabel = isMobile ? "Audio" : "Transcribe"
  const recordLabel = "Record"
  const canvasLabel = "Canvas"
  
  const gridColsClass = isCanvasEnabled ? "grid-cols-4" : "grid-cols-3";

  return (
    <Tabs
      value={currentView}
      onValueChange={(value) => onViewChange(value as View)}
      className={cn("w-auto mx-auto", className)}
    >
      <TabsList className={cn("grid w-full h-9 sm:h-10", gridColsClass)}>
        <TabsTrigger value="chat" className="px-2 sm:px-3 text-xs sm:text-sm h-full">
          <MessageSquare className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
          {chatLabel}
        </TabsTrigger>
        <TabsTrigger value="record" className="px-2 sm:px-3 text-xs sm:text-sm h-full">
          <Disc className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
          {recordLabel}
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
