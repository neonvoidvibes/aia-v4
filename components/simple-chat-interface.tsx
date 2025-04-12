"use client"

import type React from "react"

import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react"
import { useChat } from "@ai-sdk/react"
import {
  Plus,
  ArrowUp,
  Square,
  Download,
  Paperclip,
  Mic,
  Play,
  Pause,
  StopCircle,
  Copy,
  Pencil,
  Volume2,
  Check,
  ChevronDown,
} from "lucide-react"
import FileAttachmentMinimal, { type AttachmentFile } from "./file-attachment-minimal"
import { useMobile } from "@/hooks/use-mobile"
import { useTheme } from "next-themes"
import ConfirmationModal from "./confirmation-modal"
import { motion } from "framer-motion"

interface SimpleChatInterfaceProps {
  onAttachmentsUpdate?: (attachments: AttachmentFile[]) => void
}

const SimpleChatInterface = forwardRef<
  {
    startNewChat: () => void
    getMessagesCount: () => number
  },
  SimpleChatInterfaceProps
>(function SimpleChatInterface({ onAttachmentsUpdate }, ref) {
  // Modified useChat to include a custom onFinish handler
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit: originalHandleSubmit,
    isLoading,
    stop,
    setMessages,
  } = useChat({
    api: "/api/chat",
  })

  const [showPlusMenu, setShowPlusMenu] = useState(false)
  const [showRecordUI, setShowRecordUI] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [recordingInterval, setRecordingInterval] = useState<NodeJS.Timeout | null>(null)
  const [recordUIVisible, setRecordUIVisible] = useState(true) // For fade animation
  const [recordUIPosition, setRecordUIPosition] = useState({ left: -8 }) // Slightly more to the right
  const [attachedFiles, setAttachedFiles] = useState<AttachmentFile[]>([])
  const [allAttachments, setAllAttachments] = useState<AttachmentFile[]>([]) // New state for all attachments
  const [hoveredMessage, setHoveredMessage] = useState<string | null>(null)
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentFile[]>([]) // New state for pending attachments
  const isMobile = useMobile()
  const [copyState, setCopyState] = useState<{ id: string; copied: boolean }>({ id: "", copied: false })
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const { theme, setTheme } = useTheme()

  const plusMenuRef = useRef<HTMLDivElement>(null)
  const recordUIRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const submissionTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const statusRecordingRef = useRef<HTMLSpanElement>(null)
  const inputContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const prevMessagesLengthRef = useRef(messages.length)
  const userHasScrolledRef = useRef(false)
  const lastMessageIdRef = useRef<string | null>(null)

  // Debug logging
  useEffect(() => {
    console.log("Messages length:", messages.length)
    console.log("Attached files:", attachedFiles)
    console.log("All attachments:", allAttachments)
    console.log("Pending attachments:", pendingAttachments)
  }, [messages.length, attachedFiles, allAttachments, pendingAttachments])

  // Update parent component with attachments
  useEffect(() => {
    if (onAttachmentsUpdate) {
      onAttachmentsUpdate(allAttachments)
    }
  }, [allAttachments, onAttachmentsUpdate])

  // COMPLETELY NEW APPROACH: Monitor messages for changes and attach pending files
  useEffect(() => {
    // If we have pending attachments and messages have changed
    if (pendingAttachments.length > 0 && messages.length > 0) {
      console.log("Checking for new messages to attach files to...")

      // Find the most recent user message
      const userMessages = messages.filter((m) => m.role === "user")
      if (userMessages.length === 0) return

      const lastUserMessage = userMessages[userMessages.length - 1]

      // Check if this is a new message we haven't processed yet
      // The key fix: we need to check if this is actually the newest message
      if (
        lastUserMessage.id !== lastMessageIdRef.current &&
        messages.indexOf(lastUserMessage) === messages.length - 1
      ) {
        console.log("Found new user message:", lastUserMessage.id)

        // Update our reference to the last processed message
        lastMessageIdRef.current = lastUserMessage.id

        // Add messageId to each pending attachment
        const filesWithMessageId = pendingAttachments.map((file) => ({
          ...file,
          messageId: lastUserMessage.id,
        }))

        console.log("Attaching files to message:", filesWithMessageId.length)

        // Add to all attachments
        setAllAttachments((prev) => [...prev, ...filesWithMessageId])

        // Clear pending attachments
        setPendingAttachments([])
      }
    }
  }, [messages, pendingAttachments])

  // Expose methods to parent component
  useImperativeHandle(
    ref,
    () => ({
      startNewChat: () => {
        // Stop recording if active
        if (isRecording) {
          setIsRecording(false)
          setIsPaused(false)
          hideRecordUI()
          setRecordingTime(0)
        }

        // Clear all messages and attachments
        setMessages([])
        setAttachedFiles([])
        setAllAttachments([])
        setPendingAttachments([])
        lastMessageIdRef.current = null

        // Close confirmation modal
        setShowConfirmModal(false)
      },
      getMessagesCount: () => {
        return messages.length
      },
    }),
    [isRecording, messages.length],
  )

  // Format recording time as MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }

  // Check if user has scrolled up
  const checkScroll = () => {
    const container = messagesContainerRef.current
    if (!container) return

    const { scrollTop, scrollHeight, clientHeight } = container
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50

    userHasScrolledRef.current = !isAtBottom
    setShowScrollToBottom(!isAtBottom && messages.length > 0)
  }

  // Scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    userHasScrolledRef.current = false
    setShowScrollToBottom(false)
  }

  // Auto-scroll to bottom when new messages arrive, but not during streaming
  useEffect(() => {
    if (messages.length > prevMessagesLengthRef.current && !userHasScrolledRef.current) {
      scrollToBottom()
    }
    prevMessagesLengthRef.current = messages.length
  }, [messages.length])

  // Add scroll event listener
  useEffect(() => {
    const container = messagesContainerRef.current
    if (container) {
      container.addEventListener("scroll", checkScroll)
      return () => container.removeEventListener("scroll", checkScroll)
    }
  }, [])

  // Start/stop recording timer
  useEffect(() => {
    if (isRecording && !isPaused) {
      const interval = setInterval(() => {
        setRecordingTime((prev) => prev + 1)
      }, 1000)
      setRecordingInterval(interval)
    } else if (recordingInterval) {
      clearInterval(recordingInterval)
      setRecordingInterval(null)
    }

    return () => {
      if (recordingInterval) {
        clearInterval(recordingInterval)
      }
    }
  }, [isRecording, isPaused])

  // Global click handler to hide record UI when clicking outside
  useEffect(() => {
    const handleGlobalClick = (event: MouseEvent) => {
      // Only hide if clicking outside the record UI and status area
      if (
        showRecordUI &&
        recordUIRef.current &&
        !recordUIRef.current.contains(event.target as Node) &&
        statusRecordingRef.current &&
        !statusRecordingRef.current.contains(event.target as Node)
      ) {
        hideRecordUI()
      }
    }

    // Use capture phase to handle the event before it reaches the buttons
    document.addEventListener("click", handleGlobalClick, true)
    return () => {
      document.removeEventListener("click", handleGlobalClick, true)
    }
  }, [showRecordUI])

  // Close plus menu when clicking outside
  useEffect(() => {
    const handleClickOutsidePlusMenu = (event: MouseEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(event.target as Node)) {
        setShowPlusMenu(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutsidePlusMenu)
    return () => {
      document.removeEventListener("mousedown", handleClickOutsidePlusMenu)
    }
  }, [])

  // Status bar recording hover effect
  useEffect(() => {
    const statusElement = statusRecordingRef.current

    if (!statusElement) return

    const handleMouseEnter = () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current)
      }
      setRecordUIVisible(true)
      setShowRecordUI(true)
    }

    const handleMouseLeave = () => {
      startHideTimeout()
    }

    statusElement.addEventListener("mouseenter", handleMouseEnter)
    statusElement.addEventListener("mouseleave", handleMouseLeave)

    return () => {
      statusElement.removeEventListener("mouseenter", handleMouseEnter)
      statusElement.removeEventListener("mouseleave", handleMouseLeave)
    }
  }, [statusRecordingRef.current])

  // Position record UI to align with input container
  useEffect(() => {
    const positionRecordUI = () => {
      if (inputContainerRef.current && recordUIRef.current) {
        const inputRect = inputContainerRef.current.getBoundingClientRect()
        const recordUIRect = recordUIRef.current.getBoundingClientRect()

        // Calculate the left position to align with input container's left edge
        // and move it more to the left again
        const leftPosition = inputRect.left - recordUIRect.left - 8

        // Store the position in state to prevent "snapping back"
        setRecordUIPosition({ left: leftPosition })
      }
    }

    if (showRecordUI) {
      // Position immediately and after a short delay to ensure accurate positioning
      positionRecordUI()
      setTimeout(positionRecordUI, 50)
    }

    window.addEventListener("resize", positionRecordUI)
    return () => window.removeEventListener("resize", positionRecordUI)
  }, [showRecordUI])

  // Auto-hide record UI after inactivity
  const startHideTimeout = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
    }

    hideTimeoutRef.current = setTimeout(() => {
      hideRecordUI()
    }, 3000)
  }

  // Fade out record UI before hiding
  const hideRecordUI = () => {
    setRecordUIVisible(false)
    setTimeout(() => {
      setShowRecordUI(false)
      setRecordUIVisible(true) // Reset for next time
    }, 300) // Match transition duration
  }

  // Clear hide timeout on unmount
  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current)
      }
      if (submissionTimeoutRef.current) {
        clearTimeout(submissionTimeoutRef.current)
      }
    }
  }, [])

  // Handle keyboard events for the input field
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        if (isLoading) {
          e.preventDefault()
          return // Prevent submission during loading
        }

        if (input.trim()) {
          e.preventDefault()
          const formEvent = new Event("submit", {
            bubbles: true,
            cancelable: true,
          }) as unknown as React.FormEvent<HTMLFormElement>
          onSubmit(formEvent)
        }
      }
    }

    const inputElement = inputRef.current
    if (inputElement) {
      inputElement.addEventListener("keydown", handleKeyDown as EventListener)
    }

    return () => {
      if (inputElement) {
        inputElement.removeEventListener("keydown", handleKeyDown as EventListener)
      }
    }
  }, [input, isLoading])

  const saveChat = () => {
    const chatContent = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n")
    const blob = new Blob([chatContent], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `river-ai-chat-${new Date().toISOString().slice(0, 10)}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setShowPlusMenu(false)
  }

  const attachDocument = () => {
    fileInputRef.current?.click()
    setShowPlusMenu(false)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files).map((file) => {
        const fileObj: AttachmentFile = {
          id: Math.random().toString(36).substring(2, 9),
          name: file.name,
          size: file.size,
          type: file.type,
        }

        // Create URL for image previews
        if (file.type.startsWith("image/")) {
          fileObj.url = URL.createObjectURL(file)
        }

        return fileObj
      })

      setAttachedFiles((prev) => [...prev, ...newFiles])
    }

    // Clear the input to allow selecting the same file again
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const removeFile = (id: string) => {
    setAttachedFiles((prev) => {
      const updatedFiles = prev.filter((file) => file.id !== id)

      // Revoke object URLs to prevent memory leaks
      const fileToRemove = prev.find((file) => file.id === id)
      if (fileToRemove?.url) {
        URL.revokeObjectURL(fileToRemove.url)
      }

      return updatedFiles
    })
  }

  const startRecording = () => {
    setShowPlusMenu(false)
    setShowRecordUI(true)
    setRecordUIVisible(true)
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
    }
  }

  const toggleRecording = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent the global click handler from firing

    if (isRecording) {
      if (isPaused) {
        // Resume recording
        setIsPaused(false)
      } else {
        // Pause recording
        setIsPaused(true)
      }
    } else {
      // Start recording
      setIsRecording(true)
      setIsPaused(false)
      setRecordingTime(0)
    }
    startHideTimeout()
  }

  const stopRecording = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent the global click handler from firing
    setIsRecording(false)
    setIsPaused(false)
    hideRecordUI()
    setRecordingTime(0)
  }

  const handleRecordUIMouseMove = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
    }
    setRecordUIVisible(true)
    startHideTimeout()
  }

  const handlePlusMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent the global click handler from firing
    if (showRecordUI) {
      hideRecordUI()
    }
    setShowPlusMenu(!showPlusMenu)
  }

  const handleMessageInteraction = (id: string) => {
    if (isMobile) {
      setHoveredMessage(hoveredMessage === id ? null : id)
    }
  }

  // Fix copy to clipboard functionality to persist checkmark
  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopyState({ id, copied: true })

    // Show the checkmark for 2 seconds, even if not hovering
    setTimeout(() => {
      setCopyState({ id: "", copied: false })
    }, 2000)
  }

  const editMessage = (id: string) => {
    // Implement edit functionality
    console.log("Edit message:", id)
  }

  const readAloud = (text: string) => {
    // Implement text-to-speech
    console.log("Reading aloud:", text)
  }

  // COMPLETELY NEW APPROACH: Custom submit handler
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    // If we have files to attach, move them to pending
    if (attachedFiles.length > 0) {
      console.log(`Moving ${attachedFiles.length} files to pending attachments`)
      setPendingAttachments([...attachedFiles])
      setAttachedFiles([])
    }

    // Call the original submit handler
    originalHandleSubmit(e)
  }

  // UPDATED: onSubmit function with new attachment approach
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (isLoading) {
      stop()
    } else if (input.trim()) {
      console.log("Submitting message with attachedFiles:", attachedFiles.length)

      // Use our custom submit handler
      handleSubmit(e)

      // Reset user scroll state to allow auto-scrolling for the new message
      userHasScrolledRef.current = false
    }
  }

  const handleNewChatClick = () => {
    // If recording is active, show confirmation modal
    if (isRecording) {
      setShowConfirmModal(true)
    } else if (messages.length > 0) {
      // If there are messages but no recording, show confirmation modal
      setShowConfirmModal(true)
    } else {
      // If no messages and no recording, just start new chat
      startNewChat()
    }
  }

  const startNewChat = () => {
    // Stop recording if active
    if (isRecording) {
      setIsRecording(false)
      setIsPaused(false)
      hideRecordUI()
      setRecordingTime(0)
    }

    // Clear all messages and attachments
    setMessages([])
    setAttachedFiles([])
    setAllAttachments([])
    setPendingAttachments([])
    lastMessageIdRef.current = null

    // Close confirmation modal
    setShowConfirmModal(false)
  }

  // Update message actions with improved styling and animation
  return (
    <div className="flex flex-col h-full">
      {/* Messages area with increased bottom padding */}
      <div className="flex-1 overflow-y-auto messages-container" ref={messagesContainerRef} onScroll={checkScroll}>
        {messages.length === 0 ? (
          <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-10">
            <p className="text-2xl md:text-3xl font-bold text-center opacity-80">What is alive today?</p>
          </div>
        ) : (
          <div className="space-y-6">
            {messages.map((message, index) => {
              const isUser = message.role === "user"
              // Filter attachments for this specific message
              const messageAttachments = allAttachments.filter((file) => file.messageId === message.id)
              const hasAttachments = messageAttachments.length > 0

              return (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.3,
                    ease: [0.04, 0.62, 0.23, 0.98],
                  }}
                  className={`flex flex-col ${isUser ? "items-end" : "items-start"} relative group mb-8`}
                  onMouseEnter={() => !isMobile && setHoveredMessage(message.id)}
                  onMouseLeave={() => !isMobile && setHoveredMessage(null)}
                  onClick={() => handleMessageInteraction(message.id)}
                >
                  {/* Show attachments above user message if this message has attachments */}
                  {isUser && hasAttachments && (
                    <div className="mb-2 file-attachment-wrapper">
                      <FileAttachmentMinimal
                        files={messageAttachments}
                        onRemove={() => {}} // No removal in chat history
                        className="file-attachment-message"
                        maxVisible={1} // Always show just 1 file for submitted messages
                        isSubmitted={true}
                        messageId={message.id} // Explicitly pass the message ID
                      />
                    </div>
                  )}
                  <div
                    className={`rounded-2xl p-3 max-w-[80%] ${
                      isUser
                        ? `bg-input-gray text-black user-bubble ${hasAttachments ? "with-attachment" : ""}`
                        : "bg-transparent text-white ai-bubble pl-0" // Remove left padding for assistant messages - must be preserved since transparent bg requires different visual spacing for balance
                    }`}
                  >
                    {message.content}
                  </div>

                  {/* Message actions with updated styling */}
                  <div
                    className={`message-actions flex ${isUser ? "user-actions" : "assistant-actions"}`}
                    style={{
                      opacity: hoveredMessage === message.id || copyState.id === message.id ? 1 : 0,
                      visibility: hoveredMessage === message.id || copyState.id === message.id ? "visible" : "hidden",
                      bottom: isUser ? "-36px" : "-24px", // Different positioning for user vs assistant
                    }}
                  >
                    {isUser && (
                      <div className="flex">
                        <button
                          onClick={() => copyToClipboard(message.content, message.id)}
                          className="action-button"
                          aria-label="Copy message"
                        >
                          {copyState.id === message.id && copyState.copied ? (
                            <Check className="h-4 w-4 copy-button-animation" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={() => editMessage(message.id)}
                          className="action-button"
                          aria-label="Edit message"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      </div>
                    )}

                    {!isUser && (
                      <div className="flex" style={{ paddingLeft: "8px" }}>
                        {/* IMPORTANT: Added more left padding to push assistant action buttons to the right */}
                        <button
                          onClick={() => copyToClipboard(message.content, message.id)}
                          className="action-button"
                          aria-label="Copy message"
                        >
                          {copyState.id === message.id && copyState.copied ? (
                            <Check className="h-4 w-4 copy-button-animation" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </button>
                        {hoveredMessage === message.id && (
                          <button
                            onClick={() => readAloud(message.content)}
                            className="action-button"
                            aria-label="Read message aloud"
                          >
                            <Volume2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to bottom button */}
      {showScrollToBottom && (
        <button onClick={scrollToBottom} className="scroll-to-bottom-button" aria-label="Scroll to bottom">
          <ChevronDown size={24} />
        </button>
      )}

      {/* Input area with attached files - further reduced padding */}
      <div className="p-2 input-area-container">
        {/* Attached files display with reduced margin */}
        {attachedFiles.length > 0 && (
          <div className="flex justify-end mb-0.5 input-attachments-container">
            <FileAttachmentMinimal
              files={attachedFiles}
              onRemove={removeFile}
              className="max-w-[50%] file-attachment-container"
              maxVisible={1} // Always show just 1 file in the input area for consistency
            />
          </div>
        )}

        <form onSubmit={onSubmit} className="relative">
          <div className="bg-input-gray rounded-full p-2 flex items-center" ref={inputContainerRef}>
            <div className="relative" ref={plusMenuRef}>
              <button type="button" className="p-2 text-gray-600 hover:text-gray-800" onClick={handlePlusMenuClick}>
                <Plus size={20} />
              </button>

              {/* Plus menu */}
              {showPlusMenu && (
                <div className="absolute left-0 bottom-full mb-2 bg-white rounded-full py-2 shadow-lg z-10 transition-all duration-200 animate-in fade-in slide-in-from-bottom-2">
                  <div
                    className="p-2 hover:text-gray-800 cursor-pointer opacity-70 hover:opacity-100"
                    onClick={attachDocument}
                  >
                    <Paperclip size={20} className="text-gray-600" />
                  </div>
                  <div
                    className="p-2 hover:text-gray-800 cursor-pointer opacity-70 hover:opacity-100"
                    onClick={saveChat}
                  >
                    <Download size={20} className="text-gray-600" />
                  </div>
                  <div
                    className="p-2 hover:text-gray-800 cursor-pointer opacity-70 hover:opacity-100"
                    onClick={startRecording}
                  >
                    <Mic
                      size={20}
                      className={isRecording ? (isPaused ? "text-yellow-500" : "text-red-500") : "text-gray-600"}
                    />
                  </div>
                </div>
              )}

              {/* Record UI */}
              {showRecordUI && (
                <div
                  className={`absolute bottom-full mb-3 bg-white rounded-full py-2 px-3 shadow-lg z-10 flex items-center gap-2 transition-all duration-300 ${
                    recordUIVisible ? "opacity-100" : "opacity-0"
                  }`}
                  ref={recordUIRef}
                  onMouseMove={handleRecordUIMouseMove}
                  onClick={(e) => e.stopPropagation()} // Prevent clicks from bubbling up
                  style={{ marginLeft: `${recordUIPosition.left}px` }}
                >
                  <button
                    className={`p-1 ${isRecording && !isPaused ? "text-red-500" : isPaused ? "text-yellow-500" : "text-gray-600"}`}
                    onClick={toggleRecording}
                  >
                    {isRecording && !isPaused ? <Pause size={20} /> : <Play size={20} />}
                  </button>
                  <button
                    className={`p-1 ${isRecording ? "text-gray-600" : "text-gray-300 cursor-default"}`}
                    onClick={stopRecording}
                    disabled={!isRecording}
                  >
                    <StopCircle size={20} />
                  </button>
                  {isRecording && (
                    <span className="text-sm font-medium text-gray-700 ml-1">{formatTime(recordingTime)}</span>
                  )}
                </div>
              )}
            </div>

            <input
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              placeholder="Ask anything"
              className="flex-1 px-3 py-1 bg-transparent border-none outline-none text-black dark:text-black"
              disabled={isLoading}
            />

            <button
              type="submit"
              className={`p-2 ${
                isLoading
                  ? "text-gray-400 hover:text-gray-600 fill-gray-400 hover:fill-gray-600"
                  : input.trim()
                    ? "text-gray-600 hover:text-gray-800"
                    : "text-gray-300 cursor-default"
              } transition-all duration-200`}
              disabled={!input.trim() && !isLoading}
              onClick={(e) => {
                if (isLoading) {
                  e.preventDefault()
                  stop()
                }
              }}
            >
              {isLoading ? (
                <Square size={20} className="fill-current opacity-70 hover:opacity-100" />
              ) : (
                <ArrowUp size={20} />
              )}
            </button>
          </div>

          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            onChange={handleFileChange}
            multiple
            accept=".txt,.md,.json"
          />
        </form>

        <div className="text-center text-white/70 dark:text-white/70 text-xs py-4 font-light status-bar">
          river |{" "}
          <span ref={statusRecordingRef} className="cursor-pointer">
            {isRecording ? (
              <>
                {isPaused ? (
                  <>
                    listening: paused <span className="inline-block ml-1 h-2 w-2 rounded-full bg-yellow-500"></span>{" "}
                    <span className="ml-1">{formatTime(recordingTime)}</span>
                  </>
                ) : (
                  <>
                    listening: live{" "}
                    <span className="inline-block ml-1 h-2  w-2 rounded-full bg-red-500 animate-pulse"></span>{" "}
                    <span className="ml-1">{formatTime(recordingTime)}</span>
                  </>
                )}
              </>
            ) : (
              "listening: no"
            )}
          </span>
        </div>
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        onConfirm={startNewChat}
        title="Start New Chat"
        message="Are you sure you want to start a new chat? This will clear the current conversation and stop any active recording."
        confirmText="Start New"
        cancelText="Cancel"
      />
    </div>
  )
})

export default SimpleChatInterface
