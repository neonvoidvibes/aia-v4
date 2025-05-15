"use client"

import React, { useState, useRef, useCallback, useEffect, useMemo, Suspense } from "react" // Added Suspense
import { useRouter, useSearchParams } from 'next/navigation';
import { PenSquare, ChevronDown, AlertTriangle, Eye } from "lucide-react"
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog"
import { VisuallyHidden } from "@radix-ui/react-visually-hidden"
import { createClient } from '@/utils/supabase/client';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ThemeToggle } from "@/components/theme-toggle"
import DocumentUpload from "@/components/document-upload"
import SimpleChatInterface, { type ChatInterfaceHandle } from "@/components/simple-chat-interface"
import { EnvWarning } from "@/components/env-warning"
import ConfirmationModal from "@/components/confirmation-modal"
import CollapsibleSection from "@/components/collapsible-section"
import type { AttachmentFile } from "@/components/file-attachment-minimal"
import FetchedFileListItem, { type FetchedFile } from "@/components/FetchedFileListItem"
import FileEditor from "@/components/file-editor";
import { useMobile } from "@/hooks/use-mobile"
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"; // Import Select components
import { predefinedThemes, type ColorTheme } from "@/lib/themes"; // Import themes
import { useTheme } from "next-themes"; // Import useTheme
import ViewSwitcher from "@/components/ui/view-switcher"; // New: Canvas View Switcher
import CanvasView, { type CanvasInsightItem, type CanvasData } from "@/components/canvas-view"; // New: Canvas View
import { Switch } from "@/components/ui/switch"; // For canvas toggle
import { Label } from "@/components/ui/label"; // For canvas toggle label

// Main content component that uses useSearchParams
function HomeContent() {
  const searchParams = useSearchParams();
  const { theme, setTheme } = useTheme(); // Get theme and setTheme from next-themes

  // State managed by the page
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState("documents");
  const [previousActiveTab, setPreviousActiveTab] = useState("documents"); // To restore tab
  const [showNewChatConfirm, setShowNewChatConfirm] = useState(false);
  const [allChatAttachments, setAllChatAttachments] = useState<AttachmentFile[]>([]);
  const [agentMemoryFiles, setAgentMemoryFiles] = useState<AttachmentFile[]>([]);
  const [systemPromptFiles, setSystemPromptFiles] = useState<AttachmentFile[]>([]);
  const [contextFiles, setContextFiles] = useState<AttachmentFile[]>([]);
  const [hasOpenSection, setHasOpenSection] = useState(false);

  // State for S3/Pinecone fetched files
  const [transcriptionS3Files, setTranscriptionS3Files] = useState<FetchedFile[]>([]);
  const [baseSystemPromptS3Files, setBaseSystemPromptS3Files] = useState<FetchedFile[]>([]);
  const [agentSystemPromptS3Files, setAgentSystemPromptS3Files] = useState<FetchedFile[]>([]);
  const [baseFrameworkS3Files, setBaseFrameworkS3Files] = useState<FetchedFile[]>([]);
  const [orgContextS3Files, setOrgContextS3Files] = useState<FetchedFile[]>([]);
  const [pineconeMemoryDocs, setPineconeMemoryDocs] = useState<{ name: string }[]>([]);
  const [currentAgentTheme, setCurrentAgentTheme] = useState<string | undefined>(undefined);

  // State for Canvas View
  const [currentView, setCurrentView] = useState<"chat" | "canvas">("chat");
  const [isCanvasViewEnabled, setIsCanvasViewEnabled] = useState(false); // Default to disabled
  
  // Lifted state for CanvasView
  const [canvasData, setCanvasData] = useState<CanvasData | null>(null);
  const [isCanvasLoading, setIsCanvasLoading] = useState(false);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [selectedCanvasFilter, setSelectedCanvasFilter] = useState<"mirror" | "lens" | "portal">("mirror");
  const [selectedCanvasTimeWindow, setSelectedCanvasTimeWindow] = useState<string>("Whole Meeting"); // Default, matches CanvasView state / TIME_WINDOW_LABELS
  
  const [pinnedCanvasInsights, setPinnedCanvasInsights] = useState<CanvasInsightItem[]>([]);
  // activeCanvasInsightsForChat will be derived from canvasData directly when needed for chat context
  // No need for a separate state if canvasData holds the full fetched data.


  // State for S3 file viewer
  const [s3FileToView, setS3FileToView] = useState<{ s3Key: string; name: string; type: string } | null>(null);
  const [showS3FileViewer, setShowS3FileViewer] = useState(false);

  // Flags to track if data has been fetched for the current agent/event
  const [fetchedDataFlags, setFetchedDataFlags] = useState({
    transcriptions: false,
    baseSystemPrompts: false,
    agentSystemPrompts: false,
    baseFrameworks: false,
    orgContext: false,
    pineconeMemory: false,
  });

  const [pageAgentName, setPageAgentName] = useState<string | null>(null);
  const [pageEventId, setPageEventId] = useState<string | null>(null);
  const [allowedAgents, setAllowedAgents] = useState<string[]>([]);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
      const agentParam = searchParams.get('agent');
      const eventParam = searchParams.get('event');

      if (pageAgentName !== agentParam || pageEventId !== eventParam) {
        // Reset fetched flags if agent or event changes
        setFetchedDataFlags({
          transcriptions: false,
          baseSystemPrompts: false,
          agentSystemPrompts: false,
          baseFrameworks: false,
          orgContext: false,
          pineconeMemory: false,
        });
      }

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

  }, [searchParams, supabase.auth, router, pageAgentName, pageEventId]);


  // Refs
  const tabContentRef = useRef<HTMLDivElement>(null);
  const chatInterfaceRef = useRef<ChatInterfaceHandle>(null);
  const memoryTabRef = useRef<HTMLDivElement>(null);
  const isMobile = useMobile();

  const fileEditorFileProp = useMemo(() => {
    if (!s3FileToView) return null; 
    return {
      id: s3FileToView.s3Key,
      name: s3FileToView.name,
      type: s3FileToView.type,
      size: 0, // Default size, not critical for viewer
      url: undefined,
      messageId: undefined,
      content: undefined,
      lastModified: undefined,
    };
  }, [s3FileToView]);

  // Callbacks for child components
  const updateChatAttachments = useCallback((attachments: AttachmentFile[]) => {
    setAllChatAttachments(attachments);
  }, []);

  const handleAgentMemoryUpdate = useCallback((files: AttachmentFile[]) => {
    setAgentMemoryFiles(files);
    console.log("Agent memory files updated (frontend state):", files);
  }, []);

  const handleSystemPromptUpdate = useCallback((files: AttachmentFile[]) => {
    setSystemPromptFiles(files);
    console.log("System prompt files updated (frontend state):", files);
  }, []);

  const handleContextUpdate = useCallback((files: AttachmentFile[]) => {
    setContextFiles(files);
    console.log("Context files updated (frontend state):", files);
  }, []);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setPreviousActiveTab(value); 
  };

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
  
  // Effect to load and apply agent-specific theme
  useEffect(() => {
    if (pageAgentName) {
      const agentThemeKey = `agent-theme-${pageAgentName}`;
      const savedAgentTheme = localStorage.getItem(agentThemeKey);
      if (savedAgentTheme) {
        setTheme(savedAgentTheme);
        setCurrentAgentTheme(savedAgentTheme);
        // If it's a custom theme, also store it as the "last custom" for this agent for ThemeToggle logic
        if (predefinedThemes.some(t => t.className === savedAgentTheme)) {
            localStorage.setItem(`agent-custom-theme-${pageAgentName}`, savedAgentTheme);
        }
      } else {
        // If no theme is stored for this agent, apply the global theme (from next-themes default or ThemeToggle)
        // and update currentAgentTheme state to reflect that.
        setCurrentAgentTheme(theme);
      }
    }
  }, [pageAgentName, setTheme, theme]); // Rerun if global theme changes while agent is active

  // Load/save canvas enabled state from localStorage
  useEffect(() => {
    const savedCanvasEnabled = localStorage.getItem("canvasViewEnabled");
    if (savedCanvasEnabled !== null) {
      setIsCanvasViewEnabled(JSON.parse(savedCanvasEnabled));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("canvasViewEnabled", JSON.stringify(isCanvasViewEnabled));
    if (!isCanvasViewEnabled && currentView === "canvas") {
      setCurrentView("chat"); // Switch to chat if canvas is disabled while active
    }
  }, [isCanvasViewEnabled, currentView]);


  useEffect(() => {
    if (showSettings) {
      setFetchedDataFlags(prevFlags => {
        if (prevFlags.transcriptions) { 
          console.log("Settings opened, resetting transcriptions fetch flag.");
          return {
            ...prevFlags,
            transcriptions: false,
          };
        }
        return prevFlags;
      });
    }
  }, [showSettings]); 

  useEffect(() => {
    const fetchAllData = async () => {
      if (!showSettings || !pageAgentName || isAuthorized !== true) {
        return; 
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.warn("No session, cannot fetch settings data.");
        return;
      }
      const commonHeaders = { 'Authorization': `Bearer ${session.access_token}` };

      const newFetchedDataFlags = { ...fetchedDataFlags };

      const fetchS3Data = async (prefix: string, onDataFetched: (data: FetchedFile[]) => void, description: string) => {
        const proxyApiUrl = `/api/s3-proxy/list?prefix=${encodeURIComponent(prefix)}`;
        try {
          const response = await fetch(proxyApiUrl, { headers: { 
            'Authorization': commonHeaders.Authorization 
          }});
          if (!response.ok) throw new Error(`Failed to fetch ${description} via proxy: ${response.statusText} (URL: ${proxyApiUrl})`);
          const data: FetchedFile[] = await response.json();
          onDataFetched(data);
        } catch (error) {
          console.error(`Error fetching ${description} from proxy ${proxyApiUrl}:`, error);
          onDataFetched([]);
        }
      };

      if (pageEventId && !fetchedDataFlags.transcriptions) {
        await fetchS3Data(
          `organizations/river/agents/${pageAgentName}/events/${pageEventId}/transcripts/`,
          (data: FetchedFile[]) => {
            setTranscriptionS3Files(data);
            newFetchedDataFlags.transcriptions = true;
          },
          "Transcriptions"
        );
      } else if (!pageEventId) {
        setTranscriptionS3Files([]);
        newFetchedDataFlags.transcriptions = true; 
      }
      
      if (!fetchedDataFlags.baseSystemPrompts) {
        await fetchS3Data(
          `_config/`,
          (allConfigDocs: FetchedFile[]) => {
             const basePromptRegex = new RegExp(`^systemprompt_base(\\.[^.]+)?$`);
             setBaseSystemPromptS3Files(allConfigDocs.filter(f => basePromptRegex.test(f.name)));
             newFetchedDataFlags.baseSystemPrompts = true;
          },
          "Base System Prompts"
        );
      }

      if (!fetchedDataFlags.baseFrameworks) {
        await fetchS3Data(
          `_config/`,
          (allConfigDocs: FetchedFile[]) => {
              const baseFrameworkRegex = new RegExp(`^frameworks_base(\\.[^.]+)?$`);
              setBaseFrameworkS3Files(allConfigDocs.filter(f => baseFrameworkRegex.test(f.name)));
              newFetchedDataFlags.baseFrameworks = true;
          },
          "Base Frameworks"
        );
      }

      if (!fetchedDataFlags.agentSystemPrompts) {
        await fetchS3Data(
          `organizations/river/agents/${pageAgentName}/_config/`,
          (agentConfigDocs: FetchedFile[]) => {
             const agentPromptRegex = new RegExp(`^systemprompt_aID-${pageAgentName}(\\.[^.]+)?$`);
             setAgentSystemPromptS3Files(agentConfigDocs.filter(f => agentPromptRegex.test(f.name)));
             newFetchedDataFlags.agentSystemPrompts = true;
          },
          "Agent System Prompts"
        );
      }
      
      if (!fetchedDataFlags.orgContext) {
        await fetchS3Data(
          `organizations/river/_config/`,
          (orgConfigDocs: FetchedFile[]) => {
            const orgContextRegex = new RegExp(`^context_oID-river(\\.[^.]+)?$`);
            setOrgContextS3Files(orgConfigDocs.filter(f => orgContextRegex.test(f.name)))
            newFetchedDataFlags.orgContext = true;
          },
          "Organization Context"
        );
      }

      if (!fetchedDataFlags.pineconeMemory) {
        try {
          const pineconeProxyUrl = `/api/pinecone-proxy/list-docs?agentName=${encodeURIComponent(pageAgentName)}&namespace=${encodeURIComponent(pageAgentName)}`;
          const pineconeResponse = await fetch(pineconeProxyUrl, { headers: {
            'Authorization': commonHeaders.Authorization
          }});
          if (!pineconeResponse.ok) throw new Error(`Failed to fetch Pinecone docs via proxy: ${pineconeResponse.statusText} (URL: ${pineconeProxyUrl})`);
          const pineconeData = await pineconeResponse.json();
          const mappedDocs = pineconeData.unique_document_names?.map((name: string) => ({ name })) || [];
          setPineconeMemoryDocs(mappedDocs);
          newFetchedDataFlags.pineconeMemory = true;
        } catch (error) {
          console.error("Error fetching Pinecone Memory Docs via proxy:", error);
          setPineconeMemoryDocs([]);
          newFetchedDataFlags.pineconeMemory = true; 
        }
      }
      setFetchedDataFlags(newFetchedDataFlags);
    };

    fetchAllData();
  }, [showSettings, pageAgentName, pageEventId, isAuthorized, supabase.auth, fetchedDataFlags]);


  const handleViewS3File = (file: { s3Key: string; name: string; type: string }) => {
    setS3FileToView(file);
    setPreviousActiveTab(activeTab); 
    setShowSettings(false); 
    setShowS3FileViewer(true);
  };

  const handleCloseS3FileViewer = () => {
    setShowS3FileViewer(false);
    setS3FileToView(null);
    setShowSettings(true); 
    setTimeout(() => {
        setActiveTab(previousActiveTab);
    }, 0);
  };

  const handleDownloadS3File = (file: { s3Key: string; name: string }) => {
    const downloadProxyUrl = `/api/s3-proxy/download?s3Key=${encodeURIComponent(file.s3Key)}&filename=${encodeURIComponent(file.name)}`;
    window.open(downloadProxyUrl, '_blank');
  };

  const handlePinInsight = (insight: CanvasInsightItem) => {
    setPinnedCanvasInsights((prev) => {
      if (!prev.find(p => p.highlight === insight.highlight && p.explanation === insight.explanation)) { // Avoid duplicates
        return [...prev, { ...insight, id: insight.id || `${insight.category}-${Date.now()}` }]; // Ensure ID for pinning
      }
      return prev;
    });
  };

  const handleUnpinInsight = (insightIdOrHighlight: string) => {
    setPinnedCanvasInsights((prev) => prev.filter(p => (p.id || p.highlight) !== insightIdOrHighlight));
  };
  
  const handleSendCanvasHighlightToChat = (message: string, originalHighlight: CanvasInsightItem) => {
    if (chatInterfaceRef.current && pageAgentName) {
      const prefixedMessage = `🎨 From Canvas: ${message}`;
      
      const chatDataForSubmit = {
        current_canvas_time_window_label: selectedCanvasTimeWindow, // Use lifted state
        active_canvas_insights: canvasData ? JSON.stringify(canvasData) : JSON.stringify({mirror:[], lens:[], portal:[]}), // Use lifted state
        pinned_canvas_insights: JSON.stringify(pinnedCanvasInsights)
      };
      
      chatInterfaceRef.current.submitMessageWithCanvasContext(prefixedMessage, chatDataForSubmit);
      setCurrentView("chat"); // Switch back to chat view after submission is initiated
    }
  };


  if (isAuthorized === null) return (<div className="flex items-center justify-center min-h-screen"><p className="text-xl animate-pulse">Checking authorization...</p></div>);
  if (isAuthorized === false) return (
    <div className="flex flex-col items-center justify-center min-h-screen text-center p-4">
      <AlertTriangle className="w-16 h-16 text-red-500 mb-4" />
      <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
      <p className="text-muted-foreground mb-4">{authError || "You do not have permission to access this resource."}</p>
      <Button onClick={() => router.push('/login')}>Go to Login</Button>
    </div>
  );

  const filesToHideViewIconFor = ['systemprompt_base.md', 'frameworks_base.md'];

  return (
    <div className="w-full sm:max-w-[800px] sm:mx-auto min-h-dvh h-dvh flex flex-col overflow-hidden">
      <header className="py-2 px-4 text-center relative flex-shrink-0"> {/* Adjusted padding */}
        <div className="flex items-center justify-between h-12"> {/* Fixed height for header content */}
          <button className="text-foreground/70 hover:text-foreground transition-all duration-200 transform hover:scale-105" onClick={(e) => { e.stopPropagation(); handleNewChatRequest(); }} aria-label="New chat"><PenSquare size={20} /></button>
          
          {isCanvasViewEnabled ? (
            <ViewSwitcher 
              currentView={currentView} 
              onViewChange={(newView) => {
                setCurrentView(newView);
                // Optional: if switching away from canvas, clear activeBubble from CanvasView if it were managed here
              }} 
              agentName={pageAgentName}
              className="flex-grow justify-center max-w-xs sm:max-w-sm" // Added class for sizing
            />
          ) : (
            <h1 className="text-lg font-extralight flex-grow text-center">{pageAgentName ? `${pageAgentName} AI` : "River AI"}</h1>
          )}

          <button className="text-foreground/70 hover:text-foreground transition-colors" onClick={(e) => { e.stopPropagation(); setShowSettings(!showS3FileViewer ? !showSettings : true ); }} aria-label="Toggle settings">
            <div className="chevron-rotate transition-transform duration-300" style={{ transform: showSettings && !showS3FileViewer ? "rotate(180deg)" : "rotate(0deg)" }}><ChevronDown size={24} strokeWidth={2.5} /></div>
          </button>
        </div>
      </header>
      <main className="flex-1 flex flex-col overflow-hidden">
        {currentView === "chat" || !isCanvasViewEnabled ? (
          <SimpleChatInterface 
            ref={chatInterfaceRef} 
            onAttachmentsUpdate={updateChatAttachments} 
            getCanvasContext={() => ({
                current_canvas_time_window_label: selectedCanvasTimeWindow, // Use lifted state
                active_canvas_insights: canvasData ? JSON.stringify(canvasData) : JSON.stringify({mirror:[], lens:[], portal:[]}), // Use lifted state
                pinned_canvas_insights: JSON.stringify(pinnedCanvasInsights)
            })}
          />
        ) : (
          <CanvasView 
            agentName={pageAgentName} 
            eventId={pageEventId} 
            onSendHighlightToChat={handleSendCanvasHighlightToChat}
            pinnedInsights={pinnedCanvasInsights}
            onPinInsight={handlePinInsight}
            onUnpinInsight={handleUnpinInsight}
            isEnabled={isCanvasViewEnabled}
            // Pass lifted state and setters to CanvasView
            initialCanvasData={canvasData}
            setCanvasData={setCanvasData}
            isCanvasLoading={isCanvasLoading}
            setIsCanvasLoading={setIsCanvasLoading}
            canvasError={canvasError}
            setCanvasError={setCanvasError}
            selectedFilter={selectedCanvasFilter}
            setSelectedFilter={setSelectedCanvasFilter}
            selectedTimeWindow={selectedCanvasTimeWindow}
            setSelectedTimeWindow={setSelectedCanvasTimeWindow}
          />
        )}
      </main>

      {showSettings && !showS3FileViewer && (
        <Dialog 
            open={showSettings && !showS3FileViewer} 
            onOpenChange={(open) => {
                setShowSettings(open);
                if (!open) { 
                    setShowS3FileViewer(false);
                    setS3FileToView(null);
                }
            }}
        >
          <DialogContent 
            className="sm:max-w-[750px] pt-8 fixed-dialog"
            onPointerDownOutside={(event) => {
              if ((event.target as HTMLElement)?.closest('.file-editor-root-modal')) {
                event.preventDefault();
              }
            }}
          >
            <DialogTitle><VisuallyHidden>Settings</VisuallyHidden></DialogTitle>
            <DialogDescription><VisuallyHidden>Manage application settings, documents, system prompts, and memory.</VisuallyHidden></DialogDescription>
            <EnvWarning />
            <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full overflow-hidden">
              <TabsList className="grid w-full grid-cols-4 mb-4">
                <TabsTrigger value="documents">{isMobile ? "Docs" : "Documents"}</TabsTrigger>
                <TabsTrigger value="system">System</TabsTrigger>
                <TabsTrigger value="memory">Memory</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
              </TabsList>
              <div className="tab-content-wrapper" ref={tabContentRef}>
                <TabsContent value="documents" className="mt-0 tab-content-scrollable">
                  <div className="space-y-4 tab-content-inner">
                    <CollapsibleSection title="Chat Attachments" defaultOpen={true}>
                      <div className="document-upload-container">
                        <DocumentUpload description="Documents attached to the current chat session (Read-only)" type="chat" existingFiles={allChatAttachments} readOnly={true} allowRemove={false} transparentBackground={true} />
                      </div>
                    </CollapsibleSection>
                    <CollapsibleSection title="Transcription" defaultOpen={true}>
                      <div className="pb-3 space-y-2 w-full overflow-hidden">
                        {transcriptionS3Files.length > 0 ? (
                          transcriptionS3Files.map(file => (
                            <FetchedFileListItem key={file.s3Key || file.name} file={file} onView={() => handleViewS3File({ s3Key: file.s3Key!, name: file.name, type: file.type || 'text/plain' })} onDownload={() => handleDownloadS3File({ s3Key: file.s3Key!, name: file.name })} showViewIcon={true} showDownloadIcon={true} />
                          ))
                        ) : (<p className="text-sm text-muted-foreground">No transcriptions found in S3.</p>)}
                      </div>
                    </CollapsibleSection>
                  </div>
                </TabsContent>
                <TabsContent value="system" className="mt-0 tab-content-scrollable">
                  <div className="space-y-4 tab-content-inner">
                    <CollapsibleSection title="System Prompt" defaultOpen={true}>
                      <div className="document-upload-container">
                        <DocumentUpload description="Locally added/edited system prompt files. Files from S3 are listed below." type="system" allowRemove={true} persistKey={`system-prompt-${pageAgentName}-${pageEventId}`} onFilesAdded={handleSystemPromptUpdate} existingFiles={systemPromptFiles} transparentBackground={true} hideDropZone={true} />
                      </div>
                      {baseSystemPromptS3Files.length > 0 && (
                        <div className="mt-4 space-y-2 w-full overflow-hidden">
                          {baseSystemPromptS3Files.map(file => (
                            <FetchedFileListItem key={file.s3Key || file.name} file={file} onView={() => handleViewS3File({ s3Key: file.s3Key!, name: file.name, type: file.type || 'text/plain' })} showViewIcon={!filesToHideViewIconFor.includes(file.name)} />
                          ))}
                        </div>
                      )}
                      {agentSystemPromptS3Files.length > 0 && (
                        <div className="mt-2 space-y-2 w-full overflow-hidden">
                          {agentSystemPromptS3Files.map(file => (
                            <FetchedFileListItem key={file.s3Key || file.name} file={file} onView={() => handleViewS3File({ s3Key: file.s3Key!, name: file.name, type: file.type || 'text/plain' })} showViewIcon={true} />
                          ))}
                        </div>
                      )}
                      {(baseSystemPromptS3Files.length === 0 && agentSystemPromptS3Files.length === 0) && (<p className="text-sm text-muted-foreground mt-2">No system prompts found in S3.</p>)}
                    </CollapsibleSection>
                    <CollapsibleSection title="Frameworks" defaultOpen={true}>
                      {baseFrameworkS3Files.length > 0 ? (
                        <div className="space-y-2 w-full overflow-hidden">
                          {baseFrameworkS3Files.map(file => (
                            <FetchedFileListItem key={file.s3Key || file.name} file={file} onView={() => handleViewS3File({ s3Key: file.s3Key!, name: file.name, type: file.type || 'text/plain' })} showViewIcon={!filesToHideViewIconFor.includes(file.name)} />
                          ))}
                        </div>
                      ) : (<p className="text-sm text-muted-foreground">No base frameworks found in S3.</p>)}
                    </CollapsibleSection>
                  </div>
                </TabsContent>
                <TabsContent value="memory" className="mt-0 memory-tab-content" ref={memoryTabRef}>
                  <div className="tab-content-inner tab-content-scrollable">
                    <div className={`memory-tab-grid ${isMobile && hasOpenSection ? 'has-open-section' : ''}`}>
                      <CollapsibleSection title="Context" defaultOpen={true} onToggle={handleSectionToggle}>
                        <div className="document-upload-container">
                          <DocumentUpload description="Locally added/edited context files. Organization context from S3 is listed below." type="context" allowRemove={true} persistKey={`context-files-${pageAgentName}-${pageEventId}`} onFilesAdded={handleContextUpdate} existingFiles={contextFiles} transparentBackground={true} hideDropZone={true} />
                        </div>
                        <div className="mt-4 space-y-2 w-full overflow-hidden">
                          {orgContextS3Files.length > 0 ? (
                            orgContextS3Files.map(file => (
                              <FetchedFileListItem key={file.s3Key || file.name} file={file} onView={() => handleViewS3File({ s3Key: file.s3Key!, name: file.name, type: file.type || 'text/plain' })} showViewIcon={true} />
                            ))
                          ) : (<p className="text-sm text-muted-foreground">No organization context files found in S3 for '{pageAgentName}'.</p>)}
                        </div>
                      </CollapsibleSection>
                      <CollapsibleSection title="Memory" defaultOpen={true} onToggle={handleSectionToggle}>
                        <div className="document-upload-container">
                          <DocumentUpload description="Locally added/edited memory files. Documents from Pinecone are listed below." type="memory" allowRemove={true} persistKey={`agent-memory-${pageAgentName}-${pageEventId}`} onFilesAdded={handleAgentMemoryUpdate} existingFiles={agentMemoryFiles} transparentBackground={true} hideDropZone={true} />
                        </div>
                        <div className="mt-4 space-y-2 w-full overflow-hidden">
                          {pineconeMemoryDocs.length > 0 ? (
                            pineconeMemoryDocs.map(doc => (
                              <FetchedFileListItem key={doc.name} file={{ name: doc.name, type: 'pinecone/document' }} showViewIcon={false} />
                            ))
                          ) : (<p className="text-sm text-muted-foreground">No documents found in Pinecone memory for '{pageAgentName}'.</p>)}
                        </div>
                      </CollapsibleSection>
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="settings" className="mt-0 tab-content-scrollable">
                  <div className="space-y-4 tab-content-inner">
                    <div className="flex items-center justify-between"> 
                      <span className="memory-section-title">Global Theme</span>
                      <ThemeToggle />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="memory-section-title">Agent Theme</span>
                      <Select
                        value={currentAgentTheme || theme} // Fallback to global theme if agent theme not set
                        onValueChange={(newThemeValue) => {
                          if (pageAgentName) {
                            const agentThemeKey = `agent-theme-${pageAgentName}`;
                            localStorage.setItem(agentThemeKey, newThemeValue);
                            // If the selected theme is one of the custom ones, also store it as the "last custom"
                            if (predefinedThemes.some(t => t.className === newThemeValue)) {
                                localStorage.setItem(`agent-custom-theme-${pageAgentName}`, newThemeValue);
                            } else {
                                // If a standard theme (light/dark/system) is chosen for the agent,
                                // clear the specific "last custom" preference for this agent.
                                localStorage.removeItem(`agent-custom-theme-${pageAgentName}`);
                            }
                            setTheme(newThemeValue);
                            setCurrentAgentTheme(newThemeValue);
                          }
                        }}
                      >
                        <SelectTrigger className="w-[180px]">
                          <SelectValue placeholder="Select theme" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="light">Light</SelectItem>
                          <SelectItem value="dark">Dark</SelectItem>
                          <SelectItem value="system">System</SelectItem>
                          {predefinedThemes.map((customTheme) => (
                            <SelectItem key={customTheme.className} value={customTheme.className}>
                              {customTheme.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between pt-2">
                        <Label htmlFor="canvas-view-toggle" className="memory-section-title">Enable Canvas View</Label>
                        <Switch
                            id="canvas-view-toggle"
                            checked={isCanvasViewEnabled}
                            onCheckedChange={setIsCanvasViewEnabled}
                        />
                    </div>
                  </div>
                </TabsContent>
              </div>
            </Tabs>
          </DialogContent>
        </Dialog>
      )}

      <ConfirmationModal
        isOpen={showNewChatConfirm}
        onClose={cancelNewChat}
        onConfirm={confirmAndStartNewChat}
        title="Start New Chat"
        message="Are you sure you want to start a new chat? This will clear the current conversation and stop any active recording."
        confirmText="Start New"
        cancelText="Cancel"
      />

      {showS3FileViewer && s3FileToView && fileEditorFileProp && (
        <FileEditor
          file={fileEditorFileProp}
          isOpen={showS3FileViewer}
          onClose={handleCloseS3FileViewer} 
          onSave={() => { /* No save action for S3 view mode */ }}
          s3KeyToLoad={s3FileToView.s3Key}
          fileNameToDisplay={s3FileToView.name}
        />
      )}
    </div>
  )
}

// Default export that wraps HomeContent with Suspense
export default function HomePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><p className="text-xl animate-pulse">Loading page...</p></div>}>
      <HomeContent />
    </Suspense>
  );
}