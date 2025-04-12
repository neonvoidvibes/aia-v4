"use client"

import { useState, useEffect, useRef } from "react"
import { X, DownloadCloud, FileText, Code, FileJson } from "lucide-react"
import { motion } from "framer-motion"
import type { AttachmentFile } from "./file-attachment-minimal"

type FileEditorProps = {
  file: AttachmentFile
  isOpen: boolean
  onClose: () => void
  onSave: (file: AttachmentFile, content: string) => void
}

export default function FileEditor({ file, isOpen, onClose, onSave }: FileEditorProps) {
  const [content, setContent] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const editorRef = useRef<HTMLTextAreaElement>(null)

  // Load file content when the editor opens
  useEffect(() => {
    if (isOpen && file) {
      setIsLoading(true)

      // If we have a URL (for files from the user's device), fetch the content
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
        // If we already have the content stored in the file object
        setContent(file.content)
        setIsLoading(false)
      } else {
        // For demo purposes, if no content is available
        setContent(`// ${file.name} content would be loaded here`)
        setIsLoading(false)
      }
    }
  }, [isOpen, file])

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
    if (file.type.includes("json")) return <FileJson className="h-5 w-5" />
    if (file.type.includes("xml")) return <Code className="h-5 w-5" />
    return <FileText className="h-5 w-5" />
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]" onClick={onClose}>
      <motion.div
        className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-3xl mx-4 overflow-hidden shadow-xl"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            {getFileIcon()}
            <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">{file.name}</h2>
          </div>
          <button
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Editor */}
        <div className="p-4">
          {isLoading ? (
            <div className="h-64 flex items-center justify-center">
              <div className="animate-pulse text-gray-500 dark:text-gray-400">Loading...</div>
            </div>
          ) : (
            <textarea
              ref={editorRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full h-64 p-3 border rounded-md font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700"
              spellCheck={false}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t">
          <button
            className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 text-white bg-blue-500 hover:bg-blue-600 rounded-md transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSave}
            disabled={isLoading || isSaving}
          >
            {isSaving ? (
              <>
                <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Saving...
              </>
            ) : (
              <>
                <DownloadCloud className="h-4 w-4" />
                Save
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  )
}
