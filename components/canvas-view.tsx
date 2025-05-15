"use client"

import React, { useState, useEffect, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { Pin, PinOff, Zap, Eye, Telescope, Rocket } from "lucide-react" // Zap for general insights icon
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Slider } from "@/components/ui/slider" 
import { motion, AnimatePresence } from "framer-motion"
import CanvasHighlightBubble from "@/components/ui/canvas-highlight-bubble"
import { cn } from "@/lib/utils"

export interface CanvasInsightItem {
  highlight: string
  explanation: string
  id?: string // Optional unique ID for pinning/keying
  category?: "mirror" | "lens" | "portal" // For pinned items
}

export interface CanvasData {
  mirror: CanvasInsightItem[]
  lens: CanvasInsightItem[]
  portal: CanvasInsightItem[]
}

interface CanvasViewProps {
  agentName: string | null
  eventId: string | null
  onSendHighlightToChat: (
    message: string,
    originalHighlight: CanvasInsightItem // Pass the full insight for context
  ) => void
  pinnedInsights: CanvasInsightItem[]
  onPinInsight: (insight: CanvasInsightItem) => void
  onUnpinInsight: (insightIdOrHighlight: string) => void // Use ID or highlight string as identifier
  className?: string
  isEnabled: boolean
  // Add props for lifted state and setters
  initialCanvasData: CanvasData | null; // Renamed from canvasData to reflect usage
  setCanvasData: (data: CanvasData | null) => void;
  isCanvasLoading: boolean;
  setIsCanvasLoading: (loading: boolean) => void;
  canvasError: string | null;
  setCanvasError: (error: string | null) => void;
  selectedFilter: "mirror" | "lens" | "portal";
  setSelectedFilter: (filter: "mirror" | "lens" | "portal") => void;
  selectedTimeWindow: string; // Assuming string type for label
  setSelectedTimeWindow: (timeWindow: string) => void;
}

const TIME_WINDOW_LABELS = [
  "Now (1min)",
  "Last 3min",
  "Last 5min",
  "Last 10min",
  "Last 15min",
  "Last 30min",
  "Last 1hr",
  "Whole Meeting",
] as const;

type TimeWindowLabel = typeof TIME_WINDOW_LABELS[number];


export default function CanvasView({
  agentName,
  eventId,
  onSendHighlightToChat,
  pinnedInsights,
  onPinInsight,
  onUnpinInsight,
  className,
  isEnabled,
  // Lifted state and setters from props
  initialCanvasData,
  setCanvasData,
  isCanvasLoading,
  setIsCanvasLoading,
  canvasError,
  setCanvasError,
  selectedFilter,
  setSelectedFilter,
  selectedTimeWindow,
  setSelectedTimeWindow,
}: CanvasViewProps) {
  // Use initialCanvasData for the first render if available
  // This effect is mainly for when the component mounts or initialCanvasData prop changes identity.
  useEffect(() => {
    // If initialCanvasData is provided (e.g., from parent's state recovery),
    // and the local canvasData state hasn't been set yet or needs to reflect this initial state.
    // This helps ensure that if page.tsx already has data (e.g. from a previous session or persistence layer not yet implemented),
    // CanvasView starts with it.
    if (initialCanvasData && !isCanvasLoading) { // Check !isCanvasLoading to avoid overriding during a fetch
        setCanvasData(initialCanvasData);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCanvasData]); // Dependency on initialCanvasData (if it can change identity)


  const [activeBubble, setActiveBubble] = useState<{ insight: CanvasInsightItem; position: any } | null>(null)
  const insightRefs = React.useRef<Record<string, HTMLDivElement | null>>({})

  const fetchData = useCallback(async () => {
    if (!agentName || !isEnabled) {
      setCanvasData(null)
      return
    }
    setIsCanvasLoading(true) 
    setCanvasError(null)    
    try {
      const params = new URLSearchParams({
        agent: agentName,
        time_window_label: selectedTimeWindow,
      })
      if (eventId) {
        params.append("event_id", eventId)
      }
      const response = await fetch(`/api/canvas/insights?${params.toString()}`)
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error || `Failed to fetch canvas insights: ${response.statusText}`)
      }
      const data: CanvasData = await response.json()
      
      const addCategoryAndId = (items: CanvasInsightItem[] | undefined, category: "mirror" | "lens" | "portal"): CanvasInsightItem[] => 
        (items || []).map((item, index) => ({ ...item, id: `${category}-${index}-${Math.random().toString(16).slice(2)}`, category }));

      const processedData = {
        mirror: addCategoryAndId(data.mirror, "mirror"),
        lens: addCategoryAndId(data.lens, "lens"),
        portal: addCategoryAndId(data.portal, "portal"),
      };
      setCanvasData(processedData); 
    } catch (err: any) {
      setCanvasError(err.message) 
      setCanvasData(null)         
      console.error("CanvasView fetch error:", err)
    } finally {
      setIsCanvasLoading(false) 
    }
  }, [agentName, eventId, selectedTimeWindow, isEnabled, setCanvasData, setIsCanvasLoading, setCanvasError]) 

  useEffect(() => {
    if (!isEnabled) {
      setCanvasData(null) 
      return
    }
    fetchData() 
    const intervalId = setInterval(fetchData, 30000) 
    return () => clearInterval(intervalId)
  }, [fetchData, isEnabled, setCanvasData]) 


  const handleHighlightClick = (insight: CanvasInsightItem, e: React.MouseEvent<HTMLDivElement>) => {
    const targetElement = e.currentTarget;
    const rect = targetElement.getBoundingClientRect();
    
    let top = rect.bottom + window.scrollY + 5;
    let left = rect.left + window.scrollX;

    const bubbleHeight = 200; 
    const bubbleWidth = 288; 

    if (top + bubbleHeight > window.innerHeight + window.scrollY) {
      top = rect.top + window.scrollY - bubbleHeight - 5; 
    }
    if (left + bubbleWidth > window.innerWidth + window.scrollX) {
      left = window.innerWidth + window.scrollX - bubbleWidth - 10; 
    }
    if (left < window.scrollX) {
        left = window.scrollX + 10; 
    }

    setActiveBubble({
      insight,
      position: { top, left } 
    });
  };

  const isPinned = (insight: CanvasInsightItem) => {
    if (insight.id) {
      return pinnedInsights.some(pi => pi.id === insight.id);
    }
    return pinnedInsights.some(pi => pi.highlight === insight.highlight && pi.explanation === insight.explanation);
  };

  const togglePin = (insight: CanvasInsightItem) => {
    if (isPinned(insight)) {
      onUnpinInsight(insight.id || insight.highlight); 
    } else {
      const insightToPin = insight.id ? insight : { ...insight, id: `${insight.category}-${Math.random().toString(16).slice(2)}` };
      onPinInsight(insightToPin);
    }
  };

  // Use initialCanvasData for rendering, as it's the state managed by the parent
  const currentDisplayData = initialCanvasData;
  const currentInsights = currentDisplayData ? currentDisplayData[selectedFilter] : []

  if (!isEnabled) {
    return null; 
  }

  const filterIcons = {
    mirror: <Eye className="h-4 w-4" />,
    lens: <Telescope className="h-4 w-4" />,
    portal: <Rocket className="h-4 w-4" />,
  }

  return (
    <div className={cn("p-4 pt-2 flex flex-col h-full overflow-hidden", className)}>
      {/* Time Window Slider and Filter Toggles */}
      <div className="mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex-1 min-w-[150px]">
          <label htmlFor="time-window-slider" className="text-xs text-muted-foreground block mb-1">Analysis Window: {selectedTimeWindow /* Use prop */}</label>
          <Slider
            id="time-window-slider"
            min={0}
            max={TIME_WINDOW_LABELS.length - 1}
            step={1}
            value={[TIME_WINDOW_LABELS.indexOf(selectedTimeWindow as TimeWindowLabel)]} // Use prop
            onValueChange={(value) => setSelectedTimeWindow(TIME_WINDOW_LABELS[value[0]])} // Use prop setter
            className="w-full"
          />
        </div>
        <ToggleGroup
          type="single"
          value={selectedFilter /* Use prop */}
          onValueChange={(value) => {
            if (value) setSelectedFilter(value as "mirror" | "lens" | "portal") // Use prop setter
          }}
          className="rounded-md bg-muted p-0.5 h-9 sm:h-10"
        >
          {(["mirror", "lens", "portal"] as const).map((filter) => (
            <ToggleGroupItem key={filter} value={filter} aria-label={filter} className="px-2 py-1 text-xs sm:text-sm data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm h-full">
              {filterIcons[filter]}
              <span className="ml-1.5 hidden sm:inline">{filter.charAt(0).toUpperCase() + filter.slice(1)}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* Pinned Insights Section */}
      {pinnedInsights.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold mb-1.5 text-primary">Pinned Insights:</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {pinnedInsights.map((insight) => {
              const refKey = `pinned-${insight.id || insight.highlight}`;
              return (
              <div
                key={refKey}
                ref={(el) => { insightRefs.current[refKey] = el; }}
                className="p-2.5 rounded-md border bg-background/70 backdrop-blur-sm shadow-sm cursor-pointer hover:shadow-md transition-shadow relative"
                onClick={(e) => handleHighlightClick(insight, e)}
              >
                <p className="text-sm font-medium text-foreground truncate pr-6">{insight.highlight}</p>
                <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-6 w-6" onClick={(e) => { e.stopPropagation(); togglePin(insight); }}>
                  <PinOff className="h-3.5 w-3.5 text-primary" />
                </Button>
              </div>
            )})}
          </div>
          <hr className="my-3 border-border/50"/>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto">
        {isCanvasLoading && <p className="text-center text-muted-foreground animate-pulse">Loading insights...</p>}
        {canvasError && <p className="text-center text-destructive">Error: {canvasError}</p>}
        {!isCanvasLoading && !canvasError && currentDisplayData && currentInsights.length === 0 && (
          <p className="text-center text-muted-foreground">No {selectedFilter} insights for the selected time window.</p>
        )}
        
        <AnimatePresence>
          {currentDisplayData && currentInsights.map((insight, index) => { // Use currentDisplayData
             const uniqueKey = insight.id || `${selectedFilter}-${index}-${insight.highlight.slice(0,10)}`;
             return (
            <motion.div
              key={uniqueKey}
              ref={(el) => { insightRefs.current[uniqueKey] = el; }}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="p-3 mb-2.5 rounded-lg border bg-card/80 backdrop-blur-sm shadow-lg cursor-pointer hover:bg-card transition-colors relative"
              onClick={(e) => handleHighlightClick(insight, e)}
            >
              <p className="text-base sm:text-lg font-semibold text-card-foreground pr-8">{insight.highlight}</p>
              <Button variant="ghost" size="icon" className="absolute top-2 right-2 h-7 w-7" onClick={(e) => { e.stopPropagation(); togglePin(insight); }}>
                {isPinned(insight) ? <PinOff className="h-4 w-4 text-primary" /> : <Pin className="h-4 w-4 text-muted-foreground hover:text-primary" />}
              </Button>
            </motion.div>
          )})}
        </AnimatePresence>
      </div>

      {activeBubble && (
        <CanvasHighlightBubble
          isVisible={!!activeBubble}
          highlightText={activeBubble.insight.highlight}
          explanationText={activeBubble.insight.explanation}
          onClose={() => setActiveBubble(null)}
          onSendToChat={(message) => {
            onSendHighlightToChat(message, activeBubble.insight);
            setActiveBubble(null);
          }}
          position={activeBubble.position}
        />
      )}
    </div>
  )
}