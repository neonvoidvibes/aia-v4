"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { PenSquare, ChevronDown } from "lucide-react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ThemeToggle } from "@/components/theme-toggle"
import DocumentUpload from "@/components/document-upload"
import SimpleChatInterface from "@/components/simple-chat-interface"
import { EnvWarning } from "@/components/env-warning"
import ConfirmationModal from "@/components/confirmation-modal"
import CollapsibleSection from "@/components/collapsible-section"
import type { AttachmentFile } from "@/components/file-attachment-minimal"
import { useMobile } from "@/hooks/use-mobile"

export default function Home() {
  const [showSettings, setShowSettings] = useState(false)
  const [activeTab, setActiveTab] = useState("documents")
  const [showNewChatConfirm, setShowNewChatConfirm] = useState(false)
  const [allAttachments, setAllAttachments] = useState<AttachmentFile[]>([])
  const [agentMemoryFiles, setAgentMemoryFiles] = useState<AttachmentFile[]>([])
  const [systemPromptFiles, setSystemPromptFiles] = useState<AttachmentFile[]>([])
  const [hasOpenSection, setHasOpenSection] = useState(false)
  const tabContentRef = useRef<HTMLDivElement>(null)
  const chatInterfaceRef = useRef<any>(null)
  const memoryTabRef = useRef<HTMLDivElement>(null)
  const isMobile = useMobile()

  // Use useCallback to memoize the handler functions
  const updateAttachments = useCallback((attachments: AttachmentFile[]) => {
    setAllAttachments(attachments)
  }, [])

  const handleAgentMemoryUpdate = useCallback((files: AttachmentFile[]) => {
    setAgentMemoryFiles(files)
  }, [])

  const handleSystemPromptUpdate = useCallback((files: AttachmentFile[]) => {
    setSystemPromptFiles(files)
  }, [])

  // Handle tab change
  const handleTabChange = (value: string) => {
    setActiveTab(value)
  }

  const handleNewChat = () => {
    // If there are messages, show confirmation modal
    if (
      chatInterfaceRef.current &&
      chatInterfaceRef.current.getMessagesCount &&
      chatInterfaceRef.current.getMessagesCount() > 0
    ) {
      setShowNewChatConfirm(true)
    } else {
      // If no messages, just start new chat
      confirmNewChat()
    }
  }

  const confirmNewChat = () => {
    // Access the chat interface component and call its startNewChat method
    if (chatInterfaceRef.current && chatInterfaceRef.current.startNewChat) {
      chatInterfaceRef.current.startNewChat()
    }
    setShowNewChatConfirm(false)
  }

  // Handle section toggle to update scroll behavior
  const handleSectionToggle = (isOpen: boolean) => {
    setHasOpenSection(isOpen)
  }

  // Update memory tab class when hasOpenSection changes
  useEffect(() => {
    if (memoryTabRef.current) {
      if (hasOpenSection) {
        memoryTabRef.current.classList.add("has-open-section")
      } else {
        memoryTabRef.current.classList.remove("has-open-section")
      }
    }
  }, [hasOpenSection])

  return (
    <div className="max-w-[800px] mx-auto h-screen flex flex-col">
      <header className="py-4 px-4 text-center relative">
        <div className="flex items-center justify-between">
          <button
            className="text-foreground/70 hover:text-foreground transition-all duration-200 transform hover:scale-105"
            onClick={handleNewChat}
            aria-label="New chat"
          >
            <PenSquare size={20} />
          </button>
          <h1 className="text-lg font-extralight">River AI</h1>
          <button
            className="text-foreground/70 hover:text-foreground transition-colors"
            onClick={() => setShowSettings(!showSettings)}
          >
            <div className="chevron-rotate" style={{ transform: showSettings ? "rotate(180deg)" : "rotate(0deg)" }}>
              <ChevronDown size={24} strokeWidth={2.5} />
            </div>
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col overflow-hidden">
        <SimpleChatInterface ref={chatInterfaceRef} onAttachmentsUpdate={updateAttachments} />
      </main>

      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="sm:max-w-[600px] pt-8 fixed-dialog">
          <EnvWarning />
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-4">
              <TabsTrigger value="documents">Documents</TabsTrigger>
              <TabsTrigger value="memory">Memory</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>

            <div className="tab-content-wrapper" ref={tabContentRef}>
              <TabsContent value="documents" className="mt-0 tab-content-scrollable">
                <div className="space-y-4 tab-content-inner">
                  <h2 className="text-xl font-semibold">Document Management</h2>
                  <div className="grid gap-4">
                    <DocumentUpload
                      title="Chat Attachments"
                      description="Documents attached to the current chat session"
                      type="chat"
                      existingFiles={allAttachments}
                      readOnly={true}
                      allowRemove={false}
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="memory" className="mt-0 memory-tab-content" ref={memoryTabRef}>
                <div className="tab-content-inner">
                  <h2 className="text-xl font-semibold mb-2">Memory Management</h2>
                  <div className="memory-tab-grid">
                    <CollapsibleSection
                      title="Agent Memory"
                      defaultOpen={false}
                      onToggle={(isOpen) => {
                        // Only update hasOpenSection if opening
                        if (isOpen) setHasOpenSection(true)
                      }}
                    >
                      <div className="document-upload-container">
                        <DocumentUpload
                          description="Documents stored in the agent's long-term memory"
                          type="memory"
                          allowRemove={true}
                          persistKey="agent-memory-files"
                          onFilesAdded={handleAgentMemoryUpdate}
                        />
                      </div>
                    </CollapsibleSection>

                    <CollapsibleSection
                      title="System Prompt"
                      defaultOpen={false}
                      onToggle={(isOpen) => {
                        // Only update hasOpenSection if opening
                        if (isOpen) setHasOpenSection(true)
                      }}
                    >
                      <div className="document-upload-container">
                        <DocumentUpload
                          description="Documents that define the agent's behavior"
                          type="system"
                          allowRemove={true}
                          persistKey="system-prompt-files"
                          onFilesAdded={handleSystemPromptUpdate}
                        />
                      </div>
                    </CollapsibleSection>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="settings" className="mt-0 tab-content-scrollable">
                <div className="space-y-4 tab-content-inner">
                  <h2 className="text-xl font-semibold">Settings</h2>
                  <div className="flex items-center justify-between">
                    <span>Theme</span>
                    <ThemeToggle />
                  </div>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Confirmation Modal for New Chat */}
      <ConfirmationModal
        isOpen={showNewChatConfirm}
        onClose={() => {
          console.log("Close new chat confirm modal")
          setShowNewChatConfirm(false)
        }}
        onConfirm={() => {
          console.log("Confirm new chat")
          confirmNewChat()
        }}
        title="Start New Chat"
        message="Are you sure you want to start a new chat? This will clear the current conversation and stop any active recording."
        confirmText="Start New"
        cancelText="Cancel"
      />
    </div>
  )
}
