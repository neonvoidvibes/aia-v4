"use client"

import { useState, useRef } from "react"
import { X, FileText, ImageIcon, File, Download, ChevronDown, ChevronUp } from "lucide-react"

export type AttachmentFile = {
  id: string
  name: string
  size: number
  type: string
  url?: string
  messageId?: string
  content?: string
  lastModified?: string
}

type FileAttachmentMinimalProps = {
  files: AttachmentFile[]
  onRemove: (id: string) => void
  onDownload?: (file: AttachmentFile) => void
  className?: string
  maxVisible?: number
  isSubmitted?: boolean
  messageId?: string
}

export default function FileAttachmentMinimal({
  files,
  onRemove,
  onDownload,
  className = "",
  maxVisible = 999,
  isSubmitted = false,
  messageId,
}: FileAttachmentMinimalProps) {
  // Local state for expanded/collapsed
  const [isExpanded, setIsExpanded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Filter files by messageId if provided
  const filteredFiles = messageId ? files.filter((file) => file.messageId === messageId) : files

  console.log("FileAttachmentMinimal - filteredFiles:", filteredFiles.length, "isSubmitted:", isSubmitted)

  // Always use maxVisible as provided, regardless of file count
  // This ensures consistent behavior while still allowing different display rules
  const effectiveMaxVisible = maxVisible

  const shouldCollapse = filteredFiles.length > effectiveMaxVisible
  const visibleFiles = isExpanded ? filteredFiles : filteredFiles.slice(0, effectiveMaxVisible)
  const hiddenCount = filteredFiles.length - effectiveMaxVisible

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

  // Simple toggle function
  const toggleExpand = () => {
    console.log("Toggle expand called, current state:", isExpanded)
    setIsExpanded(!isExpanded)
  }

  if (filteredFiles.length === 0) return null

  return (
    <div ref={containerRef} className={`attachments-container file-attachment-minimal ${className}`}>
      {/* Visible files */}
      {visibleFiles.map((file) => (
        <div key={file.id} className="attachment-item mb-1.5">
          <div className="flex items-center justify-between p-2 rounded-lg bg-black/5 dark:bg-white/5 backdrop-blur-sm">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="p-1.5 rounded-full bg-black/10 dark:bg-white/10 flex-shrink-0">
                {getFileIcon(file.type)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{file.name}</p>
                <p className="text-xs text-foreground/60">{formatFileSize(file.size)}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {onDownload && (
                <button
                  className="p-1 text-foreground/70 hover:text-foreground transition-colors flex-shrink-0"
                  onClick={() => onDownload(file)}
                >
                  <Download className="h-4 w-4" />
                </button>
              )}
              {onRemove && !isSubmitted && (
                <button
                  className="p-1 text-foreground/70 hover:text-foreground transition-colors flex-shrink-0"
                  onClick={() => onRemove(file.id)}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* Toggle buttons */}
      {shouldCollapse && (
        <div className="flex justify-end w-full">
          {!isExpanded ? (
            isSubmitted ? (
              // Non-interactive text for submitted attachments
              <div className="rounded-lg px-3 py-2 text-center text-sm font-medium text-foreground/70">
                +{hiddenCount} more
              </div>
            ) : (
              // Interactive button for non-submitted attachments
              <button
                type="button"
                onClick={toggleExpand}
                className="cursor-pointer rounded-lg px-3 py-2 text-center text-sm font-medium bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10"
                style={{ width: "fit-content" }}
              >
                <div className="flex items-center justify-center gap-1">
                  <span>+{hiddenCount} more</span>
                  <ChevronDown className="h-5 w-5" />
                </div>
              </button>
            )
          ) : (
            !isSubmitted && (
              <button
                type="button"
                onClick={toggleExpand}
                className="cursor-pointer rounded-lg px-3 py-2 text-center text-sm font-medium bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10"
                style={{ width: "fit-content" }}
              >
                <div className="flex items-center justify-center gap-1">
                  <span>Collapse</span>
                  <ChevronUp className="h-5 w-5" />
                </div>
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}
