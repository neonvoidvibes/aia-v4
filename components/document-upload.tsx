"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { Upload, X, FileText, Edit } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { motion, AnimatePresence } from "framer-motion"
import type { AttachmentFile } from "./file-attachment-minimal"
import { AlertDialogConfirm } from "@/components/ui/alert-dialog-confirm" // New import
import FileEditor from "./file-editor"
import { cn } from "@/lib/utils" // Import cn

type DocumentUploadProps = {
  title?: string
  description: string
  type: "chat" | "memory" | "system" | "context" // Added "context"
  idSuffix: string // New prop for ensuring unique IDs
  onFilesAdded?: (files: AttachmentFile[]) => void
  existingFiles?: AttachmentFile[]
  readOnly?: boolean
  allowRemove?: boolean
  persistKey?: string
  transparentBackground?: boolean // New prop
  hideDropZone?: boolean // New prop to hide drag & drop area
}

export default function DocumentUpload({
  title = "",
  description,
  type,
  idSuffix,
  onFilesAdded,
  existingFiles = [],
  readOnly = false,
  allowRemove = true,
  persistKey,
  transparentBackground = false, // Default to false
  hideDropZone = false, // Add to destructuring with default
}: DocumentUploadProps) {
  const [files, setFiles] = useState<AttachmentFile[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [fileToRemove, setFileToRemove] = useState<string | null>(null)
  const [fileToEdit, setFileToEdit] = useState<AttachmentFile | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const isInitialMount = useRef(true)
  const filesLoadedFromStorage = useRef(false)

  // Load persisted files on mount if persistKey is provided
  useEffect(() => {
    if (persistKey) {
      const savedFiles = localStorage.getItem(persistKey)
      if (savedFiles) {
        try {
          const parsedFiles = JSON.parse(savedFiles)
          setFiles(parsedFiles)
          filesLoadedFromStorage.current = true
        } catch (e) {
          console.error("Error loading saved files:", e)
        }
      }
    }

    // Mark initial mount as complete
    isInitialMount.current = false
  }, [persistKey])

  // Use a separate effect to notify parent of files, but only after initial mount
  useEffect(() => {
    // Skip the first render and only run when files change after that
    if (!isInitialMount.current && onFilesAdded) {
      // Use setTimeout to ensure this happens after rendering is complete
      const timeoutId = setTimeout(() => {
        onFilesAdded(files)
      }, 0)

      return () => clearTimeout(timeoutId)
    }
  }, [files, onFilesAdded])

  // Save files to localStorage when they change
  useEffect(() => {
    // Skip saving during initial load from storage
    if (persistKey && !isInitialMount.current) {
      if (files.length > 0) {
        localStorage.setItem(persistKey, JSON.stringify(files))
      } else {
        localStorage.removeItem(persistKey)
      }
    }
  }, [files, persistKey])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).map((file) => {
        // Read the file content
        const reader = new FileReader()
        reader.onload = (event) => {
          if (event.target?.result) {
            // Update the file with its content
            setFiles((prevFiles) =>
              prevFiles.map((f) => (f.id === fileObj.id ? { ...f, content: event.target?.result as string } : f)),
            )
          }
        }
        reader.readAsText(file)

        const fileObj: AttachmentFile = {
          id: Math.random().toString(36).substring(2, 9),
          name: file.name,
          size: file.size,
          type: file.type,
          url: URL.createObjectURL(file),
          lastModified: new Date().toISOString(),
        }

        return fileObj
      })

      setFiles((prev) => [...prev, ...newFiles])
    }

    // Clear the input to allow selecting the same file again
    if (e.target instanceof HTMLInputElement) {
      e.target.value = ""
    }
  }

  const confirmRemoveFile = (id: string) => {
    setFileToRemove(id)
    setShowConfirmModal(true)
  }

  const handleConfirmRemove = () => {
    console.log("Confirm remove clicked for file:", fileToRemove)
    if (!fileToRemove) return

    setFiles((prev) => {
      const fileToRemoveObj = prev.find((file) => file.id === fileToRemove)
      if (fileToRemoveObj?.url) {
        URL.revokeObjectURL(fileToRemoveObj.url)
      }

      return prev.filter((file) => file.id !== fileToRemove)
    })

    setFileToRemove(null)
    setShowConfirmModal(false)
  }

  const handleCancelRemove = () => {
    console.log("Cancel remove clicked")
    setFileToRemove(null)
    setShowConfirmModal(false)
  }

  const handleEditFile = (file: AttachmentFile) => {
    setFileToEdit(file)
    setShowEditor(true)
  }

  const handleSaveFile = (updatedFile: AttachmentFile, content: string) => {
    // Update the file in the files array
    setFiles((prevFiles) => prevFiles.map((file) => (file.id === updatedFile.id ? { ...updatedFile, content } : file)))

    // If the file has a URL (from the user's device), we need to create a new blob
    if (updatedFile.url) {
      // Revoke the old URL to prevent memory leaks
      URL.revokeObjectURL(updatedFile.url)

      // Create a new blob with the updated content
      const blob = new Blob([content], { type: updatedFile.type || "text/plain" })
      const newUrl = URL.createObjectURL(blob)

      // Update the file with the new URL
      setFiles((prevFiles) => prevFiles.map((file) => (file.id === updatedFile.id ? { ...file, url: newUrl } : file)))
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " bytes"
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB"
    else return (bytes / 1048576).toFixed(1) + " MB"
  }

  // Get the appropriate accept attribute based on type
  const getAcceptTypes = () => {
    if (type === "chat") {
      return ".txt,.md,.json"
    } else if (type === "memory" || type === "system" || type === "context") { // Added "context"
      return ".txt,.md,.xml,.json"
    }
    return ""
  }

  // Get confirmation modal text based on type
  const getConfirmationText = () => {
    if (type === "memory") {
      return "Are you sure you want to remove this file from Agent Memory? This will affect the agent's long-term memory and ability to recall information."
    } else if (type === "system") {
      return "Are you sure you want to remove the System Prompt file? This will remove instructions that define the agent's behavior, which will significantly change how the agent responds in conversations."
    } else if (type === "context") {
      return "Are you sure you want to remove this context file? This may affect the information available to the agent for the current session or task."
    }
    return "Are you sure you want to remove this file?"
  }

  // The component now only displays its own state. Parent passes read-only files via existingFiles.
  const displayFiles = readOnly ? existingFiles : files;

  return (
    <>
      <Card
        className={cn(
          "document-upload-card h-full flex flex-col",
          transparentBackground && "bg-transparent border-none shadow-none p-0"
        )}
      >
        <CardHeader
          className={cn(
            "upload-header sticky-header",
            transparentBackground && "bg-transparent",
            // If no title (i.e., CollapsibleSection provides it), CardHeader has no horizontal padding.
            !title ? "pt-0 pb-3 px-0" : "p-6",
          )}
        >
          {title && <CardTitle>{title}</CardTitle>}
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent
          className={cn(
            "upload-container flex-1 flex flex-col",
            transparentBackground && "bg-transparent",
            // If no title, CardContent also has no horizontal padding.
            !title ? "pt-0 px-0" : "p-6 pt-0"
          )}
        >
          {!readOnly && !hideDropZone && (
            <div
              className={`border-2 border-dotted rounded-lg p-6 text-center mt-6 ${ // Changed to border-dotted, mt-4 to mt-6
                isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/20"
              }`}
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragging(false)

                if (e.dataTransfer.files) {
                  const newFiles = Array.from(e.dataTransfer.files).map((file) => {
                    // Read the file content
                    const reader = new FileReader()
                    const fileObj: AttachmentFile = {
                      id: Math.random().toString(36).substring(2, 9),
                      name: file.name,
                      size: file.size,
                      type: file.type,
                      url: URL.createObjectURL(file),
                      lastModified: new Date().toISOString(),
                    }

                    reader.onload = (event) => {
                      if (event.target?.result) {
                        // Update the file with its content
                        setFiles((prevFiles) =>
                          prevFiles.map((f) =>
                            f.id === fileObj.id ? { ...f, content: event.target?.result as string } : f,
                          ),
                        )
                      }
                    }
                    reader.readAsText(file)

                    return fileObj
                  })

                  setFiles((prev) => [...prev, ...newFiles])
                }
              }}
            >
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-10 w-10 text-muted-foreground" />
                <p className="text-lg font-medium">Drag & drop files here</p>
                <p className="text-sm text-muted-foreground">or</p>
                <Button type="button" variant="outline" onClick={() => document.getElementById(`file-upload-${type}-${idSuffix}`)?.click()}>
                  Browse files
                </Button>
                <input
                  id={`file-upload-${type}-${idSuffix}`}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                  accept={getAcceptTypes()}
                />
                <p className="text-xs text-muted-foreground mt-2">
                  Accepted file types: {getAcceptTypes().replace(/\./g, "")}
                </p>
              </div>
            </div>
          )}

          {displayFiles.length > 0 && (
            <div className={cn("space-y-2 document-files-container w-full overflow-hidden flex-1", !readOnly && "mt-4")}>
              <AnimatePresence>
                {displayFiles.map((file) => (
                  <motion.div
                    key={file.id}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="flex items-center justify-between p-3 border rounded-md">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate max-w-full">{file.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(file.size)}
                            {file.lastModified && (
                              <span className="ml-2">• Modified: {new Date(file.lastModified).toLocaleString()}</span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {!readOnly && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditFile(file)}
                            className="flex-shrink-0"
                            title="Edit file"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        )}
                        {!readOnly && allowRemove && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => confirmRemoveFile(file.id)}
                            className="flex-shrink-0"
                            title="Remove file"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Modal - Completely outside the Card component */}
      <AlertDialogConfirm
        isOpen={showConfirmModal}
        onClose={handleCancelRemove}
        onConfirm={handleConfirmRemove}
        title={`Remove ${type === "memory" ? "Memory" : type === "system" ? "System" : "Context"} File`}
        message={getConfirmationText()}
        confirmText="Remove"
        cancelText="Cancel"
        confirmVariant="destructive"
      />

      {/* File Editor Modal */}
      {fileToEdit && (
        <FileEditor
          file={fileToEdit}
          isOpen={showEditor}
          onClose={() => {
            setShowEditor(false)
            setFileToEdit(null)
          }}
          onSave={handleSaveFile}
        />
      )}
    </>
  )
}