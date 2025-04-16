"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { PenSquare, ChevronDown } from "lucide-react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ThemeToggle } from "@/components/theme-toggle"
import DocumentUpload from "@/components/document-upload"
import SimpleChatInterface, { type ChatInterfaceHandle } from "@/components/simple-chat-interface" // Import handle type
import { EnvWarning } from "@/components/env-warning"
import ConfirmationModal from "@/components/confirmation-modal"
import CollapsibleSection from "@/components/collapsible-section"
import type { AttachmentFile } from "@/components/file-attachment-minimal" // Renamed import to avoid conflict
import { useMobile } from "@/hooks/use-mobile" // Assuming this hook exists and works
import { useSearchParams } from 'next/navigation'; // Import useSearchParams for reading initial params

export default function Home() {
  const searchParams = useSearchParams(); // Hook to read URL query parameters

  // State managed by the page
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState("documents");
  const [showNewChatConfirm, setShowNewChatConfirm] = useState(false);
  const [allChatAttachments, setAllChatAttachments] = useState<AttachmentFile[]>([]); // Renamed state
  const [agentMemoryFiles, setAgentMemoryFiles] = useState<AttachmentFile[]>([]);
  const [systemPromptFiles, setSystemPromptFiles] = useState<AttachmentFile[]>([]);
  const [hasOpenSection, setHasOpenSection] = useState(false); // For mobile memory tab layout

  // Read agent/event from URL ONCE on mount for context (chat component also reads it)
  const [pageAgentName, setPageAgentName] = useState<string | null>(null);
  const [pageEventId, setPageEventId] = useState<string | null>(null);

  useEffect(() => {
      setPageAgentName(searchParams.get('agent'));
      setPageEventId(searchParams.get('event'));
  }, [searchParams]);


  // Refs
  const tabContentRef = useRef<HTMLDivElement>(null);
  const chatInterfaceRef = useRef<ChatInterfaceHandle>(null); // Use the handle type
  const memoryTabRef = useRef<HTMLDivElement>(null);
  const isMobile = useMobile();

  // Callbacks for child components
  const updateChatAttachments = useCallback((attachments: AttachmentFile[]) => {
    setAllChatAttachments(attachments);
  }, []);

  const handleAgentMemoryUpdate = useCallback((files: AttachmentFile[]) => {
    setAgentMemoryFiles(files);
    // TODO: Call backend API to persist these changes if necessary
    console.log("Agent memory files updated (frontend state):", files);
  }, []);

  const handleSystemPromptUpdate = useCallback((files: AttachmentFile[]) => {
    setSystemPromptFiles(files);
    // TODO: Call backend API to persist these changes if necessary
    console.log("System prompt files updated (frontend state):", files);
  }, []);

  // Settings Dialog Tabs
  const handleTabChange = (value: string) => {
    setActiveTab(value);
  };

  // New Chat Logic (Managed by Page)
  const handleNewChatRequest = () => {
      if (chatInterfaceRef.current && chatInterfaceRef.current.getMessagesCount() > 0) {
          setShowNewChatConfirm(true);
      } else {
          console.log("No messages, calling startNewChat directly");
          chatInterfaceRef.current?.startNewChat();
      }
  };

  const confirmAndStartNewChat = () => {
      console.log("Modal confirmed, calling startNewChat via ref");
      chatInterfaceRef.current?.startNewChat();
      setShowNewChatConfirm(false);
  };

  const cancelNewChat = () => {
       setShowNewChatConfirm(false);
   };


  // Mobile Memory Tab Layout Logic
  const handleSectionToggle = (isOpen: boolean) => {
    // A bit simplified: if ANY section is open, set the flag
    // A more precise implementation might track open sections individually
    setHasOpenSection(isOpen);
  };

  useEffect(() => {
    if (memoryTabRef.current) {
      if (hasOpenSection) {
        memoryTabRef.current.classList.add("has-open-section");
      } else {
        memoryTabRef.current.classList.remove("has-open-section");
      }
    }
  }, [hasOpenSection]);

  return (
    // Use min-h-dvh and h-dvh for better mobile viewport height handling
    // Add overflow-hidden to prevent the container itself from scrolling
    // Make container full-width by default, apply max-width/centering only on sm screens and up
    <div className="w-full sm:max-w-[800px] sm:mx-auto min-h-dvh h-dvh flex flex-col overflow-hidden">
      <header className="py-4 px-4 text-center relative flex-shrink-0"> {/* Prevent header shrinking */}
        <div className="flex items-center justify-between">
          <button
            className="text-foreground/70 hover:text-foreground transition-all duration-200 transform hover:scale-105"
            onClick={handleNewChatRequest} // Use the page's handler
            aria-label="New chat"
          >
            <PenSquare size={20} />
          </button>
          <h1 className="text-lg font-extralight">{pageAgentName ? `${pageAgentName} AI` : "River AI"}</h1> {/* Display Agent Name */}
          <button
            className="text-foreground/70 hover:text-foreground transition-colors"
            onClick={() => setShowSettings(!showSettings)}
            aria-label="Toggle settings"
          >
            <div className="chevron-rotate transition-transform duration-300" style={{ transform: showSettings ? "rotate(180deg)" : "rotate(0deg)" }}>
              <ChevronDown size={24} strokeWidth={2.5} />
            </div>
          </button>
        </div>
      </header>

      {/* Ensure main grows and contains overflow */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Pass the ref */}
        <SimpleChatInterface ref={chatInterfaceRef} onAttachmentsUpdate={updateChatAttachments} />
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
                    {/* This likely needs adjustment based on how attachments are tracked */}
                    <DocumentUpload
                      title="Chat Attachments"
                      description="Documents attached to the current chat session (Read-only)"
                      type="chat"
                      existingFiles={allChatAttachments} // Use renamed state
                      readOnly={true}
                      allowRemove={false}
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="memory" className="mt-0 memory-tab-content" ref={memoryTabRef}>
                <div className="tab-content-inner">
                  <h2 className="text-xl font-semibold mb-2">Memory Management</h2>
                  <div className={`memory-tab-grid ${isMobile && hasOpenSection ? 'has-open-section' : ''}`}>
                    <CollapsibleSection
                      title="Agent Memory"
                      defaultOpen={false} // Start closed on mobile implicitly handled by component
                      onToggle={handleSectionToggle}
                    >
                      <div className="document-upload-container">
                        <DocumentUpload
                          description="Documents stored in the agent's long-term memory"
                          type="memory"
                          allowRemove={true}
                          persistKey={`agent-memory-${pageAgentName}-${pageEventId}`} // Include agent/event in key
                          onFilesAdded={handleAgentMemoryUpdate}
                          // Pass existingFiles if loaded from backend
                        />
                      </div>
                    </CollapsibleSection>

                    <CollapsibleSection
                      title="System Prompt"
                      defaultOpen={false}
                      onToggle={handleSectionToggle}
                    >
                      <div className="document-upload-container">
                        <DocumentUpload
                          description="Documents that define the agent's behavior"
                          type="system"
                          allowRemove={true}
                          persistKey={`system-prompt-${pageAgentName}-${pageEventId}`} // Include agent/event in key
                          onFilesAdded={handleSystemPromptUpdate}
                           // Pass existingFiles if loaded from backend
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
                  {/* Add other settings here */}
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Confirmation Modal (Managed by Page) */}
      <ConfirmationModal
        isOpen={showNewChatConfirm}
        onClose={cancelNewChat}
        onConfirm={confirmAndStartNewChat}
        title="Start New Chat"
        message="Are you sure you want to start a new chat? This will clear the current conversation and stop any active recording."
        confirmText="Start New"
        cancelText="Cancel"
      />
    </div>
  )
}