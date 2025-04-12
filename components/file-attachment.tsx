"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { X, FileText, ImageIcon, File, Download, ChevronDown, ChevronUp } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

export type AttachmentFile = {
  id: string
  name: string
  size: number
  type: string
  url?: string // For preview
  messageId?: string // Add this to track which message the file belongs to
}

type FileAttachmentProps = {
  files: AttachmentFile[]
  onRemove: (id: string) => void
  onDownload?: (file: AttachmentFile) => void
  className?: string
  maxVisible?: number
  onToggleGroup?: (groupId: string) => void
  expandedGroup?: string | null
  isSubmitted?: boolean
  messageId?: string // Add this to filter files by message ID
}

export default function FileAttachment({
  files,
  onRemove,
  onDownload,
  className,
  maxVisible = 999,
  onToggleGroup,
  expandedGroup,
  isSubmitted = false,
  messageId,
}: FileAttachmentProps) {
  const [expandedFile, setExpandedFile] = useState<string | null>(null)
  const groupId = useRef(`file-group-${Math.random().toString(36).substring(2, 9)}`).current

  // Filter files by messageId if provided
  const filteredFiles = messageId ? files.filter((file) => file.messageId === messageId) : files

  const shouldCollapse = filteredFiles.length > maxVisible
  const isExpanded = expandedGroup === groupId

  // Debug logging
  useEffect(() => {
    console.log(`FileAttachment: Group ${groupId} - isExpanded: ${isExpanded}`)
  }, [isExpanded, groupId])

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " bytes"
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB"
    else return (bytes / 1048576).toFixed(1) + " MB"
  }

  const getFileIcon = (fileType: string) => {
    if (fileType.startsWith("image/")) return <ImageIcon className="h-4 w-4" />
    if (fileType.includes("pdf")) return <FileText className="h-4 w-4" />
    return <File className="h-4 w-4" />
  }

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedFile(expandedFile === id ? null : id)
  }

  // Reset expanded file when group collapses
  useEffect(() => {
    if (!isExpanded) {
      setExpandedFile(null)
    }
  }, [isExpanded])

  // Completely new approach for toggle handling
  const handleMoreClick = () => {
    console.log("More button clicked for group:", groupId)
    if (onToggleGroup) {
      onToggleGroup(groupId)
    }
  }

  const handleCollapseClick = () => {
    console.log("Collapse button clicked for group:", groupId)
    if (onToggleGroup) {
      onToggleGroup(groupId)
    }
  }

  if (filteredFiles.length === 0) return null

  const visibleFiles = isExpanded ? filteredFiles : filteredFiles.slice(0, maxVisible)
  const hiddenCount = filteredFiles.length - maxVisible

  return (
    <div className={`attachments-container ${className || ""}`}>
      <AnimatePresence initial={false} mode="sync">
        {visibleFiles.map((file, index) => (
          <motion.div
            key={file.id}
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: "auto", marginBottom: 6 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] }}
            className={`attachment-item file-${groupId} ${index >= maxVisible && !isExpanded ? "hidden" : ""}`}
          >
            <div
              className="flex items-center justify-between p-2 rounded-lg bg-black/5 dark:bg-white/5 backdrop-blur-sm transition-all duration-200"
              onClick={(e) => toggleExpand(file.id, e)}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="p-1.5 rounded-full bg-black/10 dark:bg-white/10">{getFileIcon(file.type)}</div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{file.name}</p>
                  <p className="text-xs text-foreground/60">{formatFileSize(file.size)}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {onDownload && (
                  <button
                    className="p-1 text-foreground/70 hover:text-foreground transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDownload(file)
                    }}
                  >
                    <Download className="h-4 w-4" />
                  </button>
                )}
                {onRemove && !isSubmitted && (
                  <button
                    className="p-1 text-foreground/70 hover:text-foreground transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemove(file.id)
                    }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Preview for images when expanded */}
            <AnimatePresence>
              {expandedFile === file.id && file.type.startsWith("image/") && file.url && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] }}
                  className="mt-2 rounded-lg overflow-hidden"
                >
                  <img
                    src={file.url || "/placeholder.svg"}
                    alt={file.name}
                    className="w-full max-h-[200px] object-contain bg-black/5 dark:bg-white/5"
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}

        {/* Show "more files" indicator if collapsed */}
        {shouldCollapse && !isExpanded && (
          <div className="flex justify-end w-full">
            <div
              id={`more-button-${groupId}`}
              className="cursor-pointer rounded-lg px-3 py-2 text-center text-sm font-medium more-button"
              style={{ width: "fit-content" }} // Reverted to original size
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                console.log("More button clicked for group:", groupId)
                // Direct DOM manipulation approach
                document.getElementById(`more-button-${groupId}`)?.classList.add("hidden")
                document.getElementById(`collapse-button-${groupId}`)?.classList.remove("hidden")
                // Show all files
                document.querySelectorAll(`.file-${groupId}`).forEach((el) => {
                  ;(el as HTMLElement).style.display = "block"
                })
                // Still call the parent handler for state consistency
                if (onToggleGroup) onToggleGroup(groupId)
              }}
              role="button"
              tabIndex={0}
              aria-expanded={false}
              aria-label={`Show ${hiddenCount} more files`}
            >
              <div className="flex items-center justify-center gap-1">
                <span>+{hiddenCount} more</span>
                {!isSubmitted && <ChevronDown className="h-5 w-5" />}
              </div>
            </div>
          </div>
        )}

        {/* Show collapse button if expanded */}
        {shouldCollapse && isExpanded && !isSubmitted && (
          <div className="flex justify-end w-full">
            <div
              id={`collapse-button-${groupId}`}
              className={`cursor-pointer rounded-lg px-3 py-2 text-center text-sm font-medium bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 collapse-button ${isExpanded ? "" : "hidden"}`}
              style={{ width: "fit-content" }} // Reverted to original size
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                console.log("Collapse button clicked for group:", groupId)
                // Direct DOM manipulation approach
                document.getElementById(`collapse-button-${groupId}`)?.classList.add("hidden")
                document.getElementById(`more-button-${groupId}`)?.classList.remove("hidden")
                // Hide extra files
                document.querySelectorAll(`.file-${groupId}`).forEach((el, index) => {
                  if (index >= maxVisible) {
                    ;(el as HTMLElement).style.display = "none"
                  }
                })
                // Still call the parent handler for state consistency
                if (onToggleGroup) onToggleGroup(groupId)
              }}
              role="button"
              tabIndex={0}
              aria-expanded={true}
              aria-label="Collapse file list"
            >
              <div className="flex items-center justify-center gap-1">
                <span>Collapse</span>
                <ChevronUp className="h-5 w-5" />
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
