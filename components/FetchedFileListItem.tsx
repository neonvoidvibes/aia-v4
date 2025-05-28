"use client"

import type React from "react"
import { FileText, Eye, DownloadCloud, BrainCircuit, Archive, Save } from "lucide-react" // Added Archive, Save
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type FetchedFile = {
  name: string
  size?: number
  lastModified?: string
  s3Key?: string
  type?: string // e.g., 'text/plain', 'application/json', 'pinecone/document'
  id?: string // Optional, can be s3Key or generated
}

type FetchedFileListItemProps = {
  file: FetchedFile
  onView?: (fileInfo: { s3Key: string; name: string; type: string }) => void
  onDownload?: (fileInfo: { s3Key: string; name: string }) => void
  onArchive?: (fileInfo: { s3Key: string; name: string }) => void // New prop
  onSaveAsMemory?: (fileInfo: { s3Key: string; name: string }) => void // New prop
  showViewIcon?: boolean
  showDownloadIcon?: boolean
  showArchiveIcon?: boolean // New prop
  showSaveAsMemoryIcon?: boolean // New prop
}

export default function FetchedFileListItem({
  file,
  onView,
  onDownload,
  onArchive,
  onSaveAsMemory,
  showViewIcon = false,
  showDownloadIcon = false,
  showArchiveIcon = false, // Default to false
  showSaveAsMemoryIcon = false, // Default to false
}: FetchedFileListItemProps) {
  const formatFileSize = (bytes?: number) => {
    if (bytes === undefined || bytes === null) return ""
    if (bytes === 0) return "0 Bytes" // Handle 0 byte files explicitly
    if (bytes < 1024) return bytes + " Bytes"
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB"
    else return (bytes / 1048576).toFixed(1) + " MB"
  }

  const getFileIcon = (fileType?: string) => {
    if (fileType === 'pinecone/document') return <BrainCircuit className="h-5 w-5 text-muted-foreground flex-shrink-0" />
    // Add more specific icons based on file.type if needed
    return <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
  }

  const handleViewClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onView && file.s3Key && file.type) {
      onView({ s3Key: file.s3Key, name: file.name, type: file.type })
    }
  }

  const handleDownloadClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onDownload && file.s3Key) {
      onDownload({ s3Key: file.s3Key, name: file.name })
    }
  }

  const handleArchiveClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onArchive && file.s3Key) {
      onArchive({ s3Key: file.s3Key, name: file.name })
    }
  }

  const handleSaveAsMemoryClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onSaveAsMemory && file.s3Key) {
      onSaveAsMemory({ s3Key: file.s3Key, name: file.name })
    }
  }

  return (
    <div className="flex items-center justify-between p-3 border rounded-md my-1 hover:bg-muted/50 transition-colors w-full overflow-hidden min-w-0"> {/* Added overflow-hidden and min-w-0 */}
    {/* Container for icon and text, allows text to truncate */}
    <div className="flex items-center gap-3 flex-1 min-w-0"> {/* flex-1 allows it to take available space, min-w-0 allows it to shrink */}
        {getFileIcon(file.type)}
        {/* Text container that will truncate. flex-1 to take available space, min-w-0 to allow shrinking, overflow-hidden for truncation effect. */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <p className="font-medium text-sm truncate" title={file.name}>
            {file.name}
          </p>
          {(file.size !== undefined || file.lastModified) && (
            <p className="text-xs text-muted-foreground">
              {file.size !== undefined && formatFileSize(file.size)}
              {file.size !== undefined && file.lastModified && " • "}
              {file.lastModified && `Modified: ${new Date(file.lastModified).toLocaleDateString()}`}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 ml-2 flex-shrink-0">
        {showViewIcon && onView && file.s3Key && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleViewClick}
            className="h-8 w-8"
            title={`View ${file.name}`}
          >
            <Eye className="h-4 w-4" />
          </Button>
        )}
        {showDownloadIcon && onDownload && file.s3Key && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDownloadClick}
            className="h-8 w-8"
            title={`Download ${file.name}`}
          >
            <DownloadCloud className="h-4 w-4" />
          </Button>
        )}
        {showArchiveIcon && onArchive && file.s3Key && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleArchiveClick}
            className="h-8 w-8"
            title={`Archive ${file.name}`}
          >
            <Archive className="h-4 w-4" />
          </Button>
        )}
        {showSaveAsMemoryIcon && onSaveAsMemory && file.s3Key && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSaveAsMemoryClick}
            className="h-8 w-8"
            title={`Save ${file.name} as Memory (Summarize)`}
            disabled // Disabled for now
          >
            <Save className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}