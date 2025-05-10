"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { useRouter, useSearchParams } from 'next/navigation'; // Import useRouter
import { PenSquare, ChevronDown, AlertTriangle } from "lucide-react" // Added AlertTriangle
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { createClient } from '@/utils/supabase/client'; // Import Supabase client
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ThemeToggle } from "@/components/theme-toggle"
import DocumentUpload from "@/components/document-upload"
import SimpleChatInterface, { type ChatInterfaceHandle } from "@/components/simple-chat-interface" // Import handle type
import { EnvWarning } from "@/components/env-warning"
import ConfirmationModal from "@/components/confirmation-modal"
import CollapsibleSection from "@/components/collapsible-section"
import type { AttachmentFile } from "@/components/file-attachment-minimal" // Renamed import to avoid conflict
import { useMobile } from "@/hooks/use-mobile" // Assuming this hook exists and works
import { Button } from "@/components/ui/button"; // Import Button

export default function Home() {
  const searchParams = useSearchParams(); // Hook to read URL query parameters

  // State managed by the page
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState("documents");
  const [showNewChatConfirm, setShowNewChatConfirm] = useState(false);
  const [allChatAttachments, setAllChatAttachments] = useState<AttachmentFile[]>([]); // Renamed state
  const [agentMemoryFiles, setAgentMemoryFiles] = useState<AttachmentFile[]>([]);
  const [systemPromptFiles, setSystemPromptFiles] = useState<AttachmentFile[]>([]);
  const [contextFiles, setContextFiles] = useState<AttachmentFile[]>([]); // New state for Context files
  const [hasOpenSection, setHasOpenSection] = useState(false); // For mobile memory tab layout

  // Read agent/event from URL ONCE on mount for context (chat component also reads it)
  const [pageAgentName, setPageAgentName] = useState<string | null>(null);
  const [pageEventId, setPageEventId] = useState<string | null>(null);
  const [allowedAgents, setAllowedAgents] = useState<string[]>([]);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null); // null = checking, false = denied, true = allowed
  const [authError, setAuthError] = useState<string | null>(null); // Store auth/fetch errors
  const supabase = createClient(); // Instantiate Supabase client
  const router = useRouter(); // Instantiate router

  // Fetch permissions and check authorization
  useEffect(() => {
      const agentParam = searchParams.get('agent');
      const eventParam = searchParams.get('event');
      setPageAgentName(agentParam);
      setPageEventId(eventParam);

      if (!agentParam) {
          console.error("Authorization Check: Agent parameter missing from URL.");
          setAuthError("Agent parameter is missing in the URL.");
          setIsAuthorized(false); // Cannot authorize without an agent ID
          return;
      }

      const fetchPermissions = async () => {
          setIsAuthorized(null); // Set to checking state
          setAuthError(null);

          try {
              // Fetch session to get token for the API call
              const { data: { session }, error: sessionError } = await supabase.auth.getSession();

              if (sessionError || !session) {
                  console.error("Authorization Check: No active session found.", sessionError);
                  // Middleware should ideally handle this, but double-check
                  setAuthError("Not authenticated.");
                  router.push('/login'); // Redirect if middleware failed
                  return;
              }

              const response = await fetch('/api/user/permissions', {
                  headers: {
                      'Authorization': `Bearer ${session.access_token}`,
                  },
              });

              if (response.status === 401) {
                   console.error("Authorization Check: Unauthorized fetching permissions.");
                   setAuthError("Session expired or invalid. Please log in again.");
                   await supabase.auth.signOut(); // Sign out if token is invalid
                   router.push('/login');
                   return;
               }

              if (!response.ok) {
                  const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
                  throw new Error(errorData.error || `Failed to fetch permissions: ${response.statusText}`);
              }

              const data = await response.json();
              // Use the correct key from the API response
              const fetchedAllowedAgents: string[] = data.allowedAgentNames || [];
              setAllowedAgents(fetchedAllowedAgents);

              // Perform authorization check
              if (fetchedAllowedAgents.includes(agentParam)) {
                  console.log(`Authorization Check: Access GRANTED for agent '${agentParam}'.`);
                  setIsAuthorized(true);
              } else {
                  console.warn(`Authorization Check: Access DENIED for agent '${agentParam}'. Allowed: [${fetchedAllowedAgents.join(', ')}]`);
                  setAuthError(`You do not have permission to access the agent specified in the URL ('${agentParam}').`);
                  setIsAuthorized(false);
              }
          } catch (error) {
              console.error("Authorization Check: Error fetching permissions:", error);
              const message = error instanceof Error ? error.message : "An unknown error occurred while checking permissions.";
              setAuthError(message);
              setIsAuthorized(false);
          }
      };

      fetchPermissions();

  }, [searchParams, supabase.auth, router]); // Add dependencies


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

  const handleContextUpdate = useCallback((files: AttachmentFile[]) => {
    setContextFiles(files);
    // TODO: Call backend API to persist these changes if necessary
    console.log("Context files updated (frontend state):", files);
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

  // Loading State
  if (isAuthorized === null) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-xl animate-pulse">Checking authorization...</p>
      </div>
    );
  }

  // Access Denied State
  if (isAuthorized === false) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen text-center p-4">
         <AlertTriangle className="w-16 h-16 text-red-500 mb-4" />
         <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
         <p className="text-muted-foreground mb-4">
           {authError || "You do not have permission to access this resource."}
         </p>
         <Button onClick={() => router.push('/login')}>Go to Login</Button>
         {/* Optional: Add a logout button if needed */}
         {/* <Button variant="outline" className="ml-2" onClick={async () => { await supabase.auth.signOut(); router.push('/login'); }}>Logout</Button> */}
      </div>
    );
  }

  // Authorized State: Render the Chat UI
  return (
    // Use min-h-dvh and h-dvh for better mobile viewport height handling
    // Add overflow-hidden to prevent the container itself from scrolling
    // Make container full-width by default, apply max-width/centering only on sm screens and up
    <div className="w-full sm:max-w-[800px] sm:mx-auto min-h-dvh h-dvh flex flex-col overflow-hidden">
      {/* Header remains the same */}
      <header className="py-4 px-4 text-center relative flex-shrink-0" onClick={() => {
          // Scroll to top on mobile header tap
          if (isMobile && chatInterfaceRef.current) {
              chatInterfaceRef.current.scrollToTop();
          }
        }}> {/* Prevent header shrinking */}
        <div className="flex items-center justify-between">
          <button
            className="text-foreground/70 hover:text-foreground transition-all duration-200 transform hover:scale-105"
            // Prevent event bubbling up to the header's onClick
            onClick={(e) => { e.stopPropagation(); handleNewChatRequest(); }} // Use the page's handler
            aria-label="New chat"
          >
            <PenSquare size={20} />
          </button>
          <h1 className="text-lg font-extralight">{pageAgentName ? `${pageAgentName} AI` : "River AI"}</h1> {/* Display Agent Name */}
          <button
            className="text-foreground/70 hover:text-foreground transition-colors"
            // Prevent event bubbling up to the header's onClick
            onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); }}
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
        {/* Pass agent/event props to ChatInterface */}
        <SimpleChatInterface
          ref={chatInterfaceRef}
          onAttachmentsUpdate={updateChatAttachments}
          // agent={pageAgentName} // Already read internally via useSearchParams
          // eventId={pageEventId} // Already read internally via useSearchParams
        />
      </main>

      {/* Settings Dialog and Confirmation Modal remain within the authorized view */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="sm:max-w-[750px] pt-8 fixed-dialog"> {/* Adjusted width in globals.css */}
          <EnvWarning />
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <TabsList className="grid w-full grid-cols-4 mb-4"> {/* Updated to grid-cols-4 */}
              <TabsTrigger value="documents">Documents</TabsTrigger>
              <TabsTrigger value="system">System</TabsTrigger>
              <TabsTrigger value="memory">Memory</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>

            <div className="tab-content-wrapper" ref={tabContentRef}>
              <TabsContent value="documents" className="mt-0 tab-content-scrollable">
                <div className="space-y-4 tab-content-inner">
                  <CollapsibleSection
                    title="Chat Attachments"
                    defaultOpen={true}
                  >
                    <div className="document-upload-container">
                      <DocumentUpload
                        // title prop removed as CollapsibleSection handles it
                        description="Documents attached to the current chat session (Read-only)"
                        type="chat"
                        existingFiles={allChatAttachments}
                        readOnly={true}
                        allowRemove={false}
                        transparentBackground={true}
                      />
                    </div>
                  </CollapsibleSection>
                  <CollapsibleSection
                    title="Transcription"
                    defaultOpen={true}
                  >
                    <div className="pb-3"> {/* Horizontal padding inherited from .tab-content-inner */}
                      <p className="text-sm text-muted-foreground">Transcription settings and options will be available here.</p>
                    </div>
                  </CollapsibleSection>
                </div>
              </TabsContent>

              <TabsContent value="system" className="mt-0 tab-content-scrollable">
                <div className="space-y-4 tab-content-inner">
                  <CollapsibleSection
                      title="System Prompt"
                      defaultOpen={true}
                    >
                      <div className="document-upload-container">
                        <DocumentUpload
                          description="Documents that define the agent's core behavior and persona"
                          type="system"
                          allowRemove={true}
                          persistKey={`system-prompt-${pageAgentName}-${pageEventId}`}
                          onFilesAdded={handleSystemPromptUpdate}
                          existingFiles={systemPromptFiles}
                          transparentBackground={true}
                        />
                      </div>
                    </CollapsibleSection>
                </div>
              </TabsContent>

              {/* Transcript Tab Content Removed */}

              <TabsContent value="memory" className="mt-0 memory-tab-content" ref={memoryTabRef}>
                <div className="tab-content-inner tab-content-scrollable">
                  <div className={`memory-tab-grid ${isMobile && hasOpenSection ? 'has-open-section' : ''}`}>
                    <CollapsibleSection
                      title="Context"
                      defaultOpen={true}
                      onToggle={handleSectionToggle}
                    >
                      <div className="document-upload-container">
                        <DocumentUpload
                          description="Documents providing contextual information for the agent"
                          type="context"
                          allowRemove={true}
                          persistKey={`context-files-${pageAgentName}-${pageEventId}`}
                          onFilesAdded={handleContextUpdate}
                          existingFiles={contextFiles}
                          transparentBackground={true}
                        />
                      </div>
                    </CollapsibleSection>

                    <CollapsibleSection
                      title="Memory"
                      defaultOpen={true}
                      onToggle={handleSectionToggle}
                    >
                      <div className="document-upload-container">
                        <DocumentUpload
                          description="Documents stored in the agent's long-term memory"
                          type="memory"
                          allowRemove={true}
                          persistKey={`agent-memory-${pageAgentName}-${pageEventId}`}
                          onFilesAdded={handleAgentMemoryUpdate}
                          existingFiles={agentMemoryFiles}
                          transparentBackground={true}
                        />
                      </div>
                    </CollapsibleSection>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="settings" className="mt-0 tab-content-scrollable">
                <div className="space-y-4 tab-content-inner">
                  {/* Horizontal padding inherited from .tab-content-inner. Vertical padding via py-X can be added if needed, or rely on space-y-4 */}
                  <div className="flex items-center justify-between">
                    <span className="memory-section-title">Theme</span>
                    <ThemeToggle />
                  </div>
                  {/* Add other settings here, potentially wrapped in CollapsibleSections */}
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