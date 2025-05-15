"use client"

import * as React from "react"
import { MessageSquare, LayoutGrid } from "lucide-react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { useMobile } from "@/hooks/use-mobile" // Assuming this hook exists

interface ViewSwitcherProps {
  currentView: "chat" | "canvas"
  onViewChange: (view: "chat" | "canvas") => void
  agentName?: string | null
  className?: string
}

export default function ViewSwitcher({
  currentView,
  onViewChange,
  agentName,
  className,
}: ViewSwitcherProps) {
  const isMobile = useMobile()

  const chatLabel = isMobile ? "Chat" : agentName ? `Chat with ${agentName}` : "Chat"
  const canvasLabel = isMobile ? "Canvas" : "Canvas"

  return (
    <Tabs
      value={currentView}
      onValueChange={(value) => onViewChange(value as "chat" | "canvas")}
      className={cn("w-auto mx-auto", className)} // w-auto to shrink to content
    >
      <TabsList className="grid w-full grid-cols-2 h-9 sm:h-10">
        <TabsTrigger value="chat" className="px-2 sm:px-3 text-xs sm:text-sm h-full">
          <MessageSquare className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
          {chatLabel}
        </TabsTrigger>
        <TabsTrigger value="canvas" className="px-2 sm:px-3 text-xs sm:text-sm h-full">
          <LayoutGrid className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
          {canvasLabel}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}