"use client"

import * as React from "react"
import { X, Send } from "lucide-react"
import { motion } from "framer-motion"
import { Textarea } from "@/components/ui/textarea" // Use Textarea for potentially longer edits
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface CanvasHighlightBubbleProps {
  highlightText: string
  explanationText: string
  isVisible: boolean
  onClose: () => void
  onSendToChat: (message: string) => void
  position: { top?: number; left?: number; right?: number; bottom?: number } // For positioning
  className?: string
}

export default function CanvasHighlightBubble({
  highlightText,
  explanationText,
  isVisible,
  onClose,
  onSendToChat,
  position,
  className,
}: CanvasHighlightBubbleProps) {
  const [editedMessage, setEditedMessage] = React.useState(highlightText)

  React.useEffect(() => {
    if (isVisible) {
      setEditedMessage(highlightText) // Reset when bubble becomes visible with new highlight
    }
  }, [isVisible, highlightText])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (editedMessage.trim()) {
      onSendToChat(editedMessage.trim())
      onClose() // Close bubble after sending
    }
  }

  if (!isVisible) {
    return null
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.15 }}
      className={cn(
        "absolute z-20 p-3 rounded-lg shadow-xl w-64 sm:w-72",
        "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]", // Theme-aware
        className
      )}
      style={{ ...position }}
      onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside bubble
    >
      <button
        onClick={onClose}
        className="absolute top-2 right-2 p-1 rounded-full hover:bg-[hsl(var(--accent)/0.8)] transition-colors"
        aria-label="Close explanation"
      >
        <X className="h-4 w-4" />
      </button>
      <p className="text-sm font-semibold mb-1">Explanation:</p>
      <p className="text-xs mb-3">{explanationText}</p>
      
      <form onSubmit={handleSubmit} className="space-y-2">
        <Textarea
          value={editedMessage}
          onChange={(e) => setEditedMessage(e.target.value)}
          placeholder="Edit message or send as is..."
          className="text-xs h-20 bg-[hsl(var(--background))] text-[hsl(var(--foreground))] border-[hsl(var(--border))]" // Themed textarea
          rows={3}
        />
        <Button
          type="submit"
          size="sm"
          className="w-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary)/0.9)]" // Themed button
        >
          Send to Chat <Send className="h-3 w-3 ml-1.5" />
        </Button>
      </form>
    </motion.div>
  )
}