"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { useChat } from "@ai-sdk/react"
import { motion, AnimatePresence } from "framer-motion"
import { Square, Copy, Volume2, Plus, ArrowUp, Download, Paperclip, Mic, Play, Pause, StopCircle } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { useTheme } from "next-themes"

export default function ChatInterface() {
  const { messages, input, handleInputChange, handleSubmit, isLoading, stop } = useChat({
    api: "/api/chat",
  })

  const [hoveredMessage, setHoveredMessage] = useState<string | null>(null)
  const [showPlusMenu, setShowPlusMenu] = useState(false)
  const [showRecordUI, setShowRecordUI] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [recordUIFading, setRecordUIFading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const isMobile = useMobile()
  const plusMenuRef = useRef<HTMLDivElement>(null)
  const recordUIRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { theme } = useTheme()
  const recordUITimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Close plus menu and record UI when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(event.target as Node)) {
        setShowPlusMenu(false)
      }
      if (recordUIRef.current && !recordUIRef.current.contains(event.target as Node)) {
        // Don't close record UI if recording is active
        if (!isRecording) {
          setShowRecordUI(false)
        }
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [isRecording])

  const handleMessageInteraction = (id: string) => {
    if (isMobile) {
      setHoveredMessage(hoveredMessage === id ? null : id)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const readAloud = (text: string) => {
    // Will integrate with TTS service later
    console.log("Reading aloud:", text)
  }

  const saveChat = () => {
    console.log("Saving chat...")
    // Basic implementation for saving chat
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
      console.log("File selected:", e.target.files[0].name)
      // Implementation for handling the file would go here
    }
  }

  const startRecording = () => {
    setShowPlusMenu(false)
    setShowRecordUI(true)
  }

  const toggleRecording = () => {
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
    }
  }

  const stopRecording = () => {
    setIsRecording(false)
    setIsPaused(false)
    setShowRecordUI(false)
  }

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (isLoading) {
      stop()
    } else {
      handleSubmit(e)
    }
  }

  const handleRecordUIMouseMove = () => {
    setRecordUIFading(false)
    if (recordUITimeoutRef.current) {
      clearTimeout(recordUITimeoutRef.current)
    }
    recordUITimeoutRef.current = setTimeout(() => {
      if (isRecording) return // Don't fade if actively recording
      setRecordUIFading(true)
    }, 3000)
  }

  useEffect(() => {
    return () => {
      if (recordUITimeoutRef.current) {
        clearTimeout(recordUITimeoutRef.current)
      }
    }
  }, [])

  return (
    <>
      <ScrollArea className="flex-1 px-4">
        <div className="space-y-6 py-4">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-[50vh]">
              <p className="welcome-message">What is alive today?</p>
            </div>
          )}

          <AnimatePresence>
            {messages.map((message) => {
              const isUser = message.role === "user"
              return (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className={cn("relative group flex flex-col mb-8", isUser ? "items-end" : "items-start")}
                  onMouseEnter={() => !isMobile && setHoveredMessage(message.id)}
                  onMouseLeave={() => !isMobile && setHoveredMessage(null)}
                  onClick={() => handleMessageInteraction(message.id)}
                >
                  <div className={cn("message-bubble", isUser ? "user-message" : "ai-message")}>{message.content}</div>

                  {/* Message actions */}
                  <AnimatePresence>
                    {hoveredMessage === message.id && (
                      <motion.div
                        initial={{ opacity: 0, y: -10, height: 0 }}
                        animate={{ opacity: 1, y: 0, height: "auto" }}
                        exit={{ opacity: 0, y: -10, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="message-actions flex gap-2"
                      >
                        <button
                          onClick={() => copyToClipboard(message.content)}
                          className="text-foreground/70 hover:text-foreground transition-colors"
                        >
                          <Copy className="h-4 w-4" />
                        </button>

                        {!isUser && (
                          <button
                            onClick={() => readAloud(message.content)}
                            className="text-foreground/70 hover:text-foreground transition-colors"
                          >
                            <Volume2 className="h-4 w-4" />
                          </button>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      <div className="p-4">
        <form onSubmit={onSubmit} className="relative">
          <div className="input-container">
            <div className="relative plus-button-container" ref={plusMenuRef}>
              <button
                type="button"
                className="text-gray-400 hover:text-gray-600 transition-colors"
                onClick={() => setShowPlusMenu(!showPlusMenu)}
              >
                <Plus className="h-5 w-5" />
              </button>

              <AnimatePresence>
                {showPlusMenu && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 10 }}
                    transition={{ duration: 0.2 }}
                    className="plus-menu"
                    style={{ backgroundColor: "hsl(var(--input-gray))" }} // Add inline style
                  >
                    <div className="plus-menu-item" onClick={saveChat}>
                      <Download size={20} />
                    </div>
                    <div className="plus-menu-item" onClick={attachDocument}>
                      <Paperclip size={20} />
                    </div>
                    <div className="plus-menu-item" onClick={startRecording}>
                      <Mic size={20} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {showRecordUI && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 10 }}
                    transition={{ duration: 0.2 }}
                    className={`record-ui ${recordUIFading ? "fading" : ""}`}
                    ref={recordUIRef}
                    onMouseMove={handleRecordUIMouseMove}
                    onMouseEnter={() => setRecordUIFading(false)}
                    onMouseLeave={() => {
                      if (!isRecording) {
                        recordUITimeoutRef.current = setTimeout(() => {
                          setRecordUIFading(true)
                        }, 3000)
                      }
                    }}
                    style={{ backgroundColor: "hsl(var(--input-gray))" }} // Add inline style
                  >
                    <div
                      className={cn(
                        "record-ui-button",
                        isRecording && !isPaused ? "active" : "",
                        isRecording && isPaused ? "paused" : "",
                      )}
                      onClick={toggleRecording}
                    >
                      {isRecording && !isPaused ? <Pause size={20} /> : <Play size={20} />}
                    </div>
                    <div
                      className="record-ui-button"
                      onClick={stopRecording}
                      style={{ color: theme === "light" ? "#333" : "" }}
                    >
                      <StopCircle size={20} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <input
              value={input}
              onChange={(e) => handleInputChange(e)}
              placeholder="Ask anything"
              className="flex-1 bg-transparent border-none outline-none px-3 py-1 text-black"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  if (input.trim()) {
                    onSubmit(e as any)
                  }
                }
              }}
            />

            <button
              type="submit"
              className={cn(
                "transition-colors",
                isLoading ? "text-red-500 hover:text-red-600" : "text-gray-400 hover:text-gray-600",
              )}
              style={{ color: theme === "light" ? "#333" : "" }}
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={isLoading ? "stop" : "send"}
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  {isLoading ? <Square className="h-5 w-5" /> : <ArrowUp className="h-5 w-5" />}
                </motion.div>
              </AnimatePresence>
            </button>
          </div>

          {/* Hidden file input for attachments */}
          <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
        </form>

        <div className="status-bar">
          river |{" "}
          {isRecording ? (
            <span>
              listen:{" "}
              {isPaused ? (
                <>
                  no <span className="inline-block ml-1 h-2 w-2 rounded-full bg-yellow-500"></span>
                </>
              ) : (
                <>
                  yes <span className="inline-block ml-1 h-2 w-2 rounded-full bg-red-500 animate-pulse"></span>
                </>
              )}
            </span>
          ) : (
            "listen: no"
          )}
        </div>
      </div>
    </>
  )
}
