"use client"

import { useState, useEffect, useRef } from "react"
import { createPortal } from "react-dom" // Import createPortal
import { X, DownloadCloud, FileText, Code, FileJson } from "lucide-react"
import { motion } from "framer-motion"
import type { AttachmentFile } from "./file-attachment-minimal"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

type FileEditorProps = {
  file: AttachmentFile
  isOpen: boolean
  onClose: () => void
  onSave: (file: AttachmentFile, content: string) => void
  s3KeyToLoad?: string // New prop for loading S3 file content
  fileNameToDisplay?: string // New prop for displaying S3 file name
}

export default function FileEditor({
  file,
  isOpen,
  onClose,
  onSave,
  s3KeyToLoad,
  fileNameToDisplay,
}: FileEditorProps) {
  const [content, setContent] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true); // Component has mounted, safe to use document.body for portal
  }, []);

  // Manage body scroll when modal is open/closed
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }
    return () => {
      document.body.style.overflow = "auto"; // Ensure cleanup on unmount
    };
  }, [isOpen]);

  // Load file content when the editor opens
  useEffect(() => {
    if (isOpen && (file || s3KeyToLoad)) {
      setIsLoading(true)
      setContent("") // Reset content

      if (s3KeyToLoad) {
        const proxyApiUrl = `/api/s3-proxy/view?s3Key=${encodeURIComponent(s3KeyToLoad)}`;
        // console.log(`FileEditor: Fetching S3 content from Next.js proxy URL: ${proxyApiUrl}`);

        // Fetch content from S3 via Next.js proxy API
        // No explicit auth header needed here as the proxy route will use the server session (cookie)
        fetch(proxyApiUrl) 
          .then((response) => {
            if (!response.ok) {
              throw new Error(`Failed to fetch S3 content via proxy: ${response.statusText} (URL: ${proxyApiUrl})`)
            }
            return response.json()
          })
          .then((data) => {
            setContent(data.content || "// Empty file or error loading content")
            setIsLoading(false)
          })
          .catch((error) => {
            console.error("Error loading S3 file content:", error)
            setContent(`// Error loading file content for ${fileNameToDisplay || s3KeyToLoad}:\n// ${error.message}`)
            setIsLoading(false)
          })
      } else if (file) {
        // Original logic for client-side files
        if (file.url) {
          fetch(file.url)
            .then((response) => response.text())
            .then((text) => {
              setContent(text)
              setIsLoading(false)
            })
            .catch((error) => {
              console.error("Error loading file content:", error)
              setContent("// Error loading file content")
              setIsLoading(false)
            })
        } else if (file.content) {
          setContent(file.content)
          setIsLoading(false)
        } else {
          setContent(`// ${file.name} content would be loaded here`)
          setIsLoading(false)
        }
      } else {
        // Should not happen if isOpen is true and one of file/s3KeyToLoad is present
        setContent("// No file specified for editor")
        setIsLoading(false)
      }
    }
  }, [isOpen, file, s3KeyToLoad, fileNameToDisplay])


  // Focus the editor when it opens
  useEffect(() => {
    if (!isLoading && isOpen && editorRef.current) {
      editorRef.current.focus()
    }
  }, [isLoading, isOpen])

  // Handle save
  const handleSave = () => {
    setIsSaving(true)

    // Create a new file object with the updated content
    const updatedFile = {
      ...file,
      content: content,
      lastModified: new Date().toISOString(),
    }

    // Call the onSave callback with the updated file
    onSave(updatedFile, content)

    // Create a blob with the content
    const blob = new Blob([content], { type: file.type || "text/plain" })

    // Create a download link
    const downloadLink = document.createElement("a")
    downloadLink.href = URL.createObjectURL(blob)
    downloadLink.download = file.name

    // Append to the body, click it, and remove it
    document.body.appendChild(downloadLink)
    downloadLink.click()
    document.body.removeChild(downloadLink)

    // Revoke the URL to avoid memory leaks
    setTimeout(() => {
      URL.revokeObjectURL(downloadLink.href)
      setIsSaving(false)
      onClose()
    }, 500)
  }

  // Get the appropriate icon based on file type
  const getFileIcon = () => {
    const currentFileType = s3KeyToLoad ? (file?.type || "text/plain") : (file?.type || "text/plain");
    if (currentFileType.includes("json")) return <FileJson className="h-5 w-5" />
    if (currentFileType.includes("xml")) return <Code className="h-5 w-5" />
    return <FileText className="h-5 w-5" />
  }

  if (!isOpen || !isMounted) return null // Don't render or portal if not open or not mounted

  const editorModalContent = (
    // Removed z-[10000] from overlay, portal handles stacking. file-editor-root-modal kept for specific targeting if needed.
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center file-editor-root-modal" onClick={onClose} style={{ zIndex: 10000 }}> {/* Explicit high z-index for portal container */}
      <motion.div
        // Removed z-[10001] from content, relative to overlay.
        className="bg-background rounded-lg w-full max-w-3xl mx-4 overflow-hidden shadow-xl"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            {getFileIcon()}
            <h2 className="text-lg font-medium text-foreground">
              {s3KeyToLoad ? fileNameToDisplay || "S3 File" : file.name}
            </h2>
          </div>
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Editor */}
        <div className="p-4">
          {isLoading ? (
            <div className="h-64 flex items-center justify-center">
              <div className="animate-pulse text-muted-foreground">Loading...</div>
            </div>
          ) : (
            <textarea
              ref={editorRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full h-64 p-3 bg-background text-foreground font-mono text-sm resize-none focus-visible:outline-none"
              spellCheck={false}
              readOnly={!!s3KeyToLoad} // Make readOnly if viewing S3 file
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-border">
          {s3KeyToLoad ? (
            <button
              className={cn(buttonVariants({ variant: "default" }), "px-4 py-2")}
              onClick={onClose}
            >
              Close
            </button>
          ) : (
            <>
              <button
                className={cn(buttonVariants({ variant: "outline" }), "px-4 py-2")}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className={cn(buttonVariants({ variant: "default" }), "px-4 py-2 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed")}
                onClick={handleSave}
                disabled={isLoading || isSaving}
              >
                {isSaving ? (
                  <>
                    <div className="h-4 w-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin"></div>
                    Saving...
                  </>
                ) : (
                  <>
                    <DownloadCloud className="h-4 w-4" />
                    Save & Download
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );

  return createPortal(editorModalContent, document.body);
}