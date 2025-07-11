"use client"

import React, { useState, useRef, useCallback, useEffect, useMemo, Suspense } from "react" // Added Suspense
import { useRouter, useSearchParams } from 'next/navigation';
import { PenSquare, ChevronDown, AlertTriangle, Eye, LayoutGrid, Loader2, History, Brain, FileClock, SlidersHorizontal, Waves, MessageCircle, Settings, Trash2 } from "lucide-react" // Added History, Brain, FileClock, LayoutGrid, Loader2, Trash2
import Sidebar from "@/components/ui/sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog" // Removed DialogClose
import { VisuallyHidden } from "@radix-ui/react-visually-hidden"
import { createClient } from '@/utils/supabase/client';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ThemeToggle } from "@/components/theme-toggle"
import DocumentUpload from "@/components/document-upload"
import SimpleChatInterface, { type ChatInterfaceHandle } from "@/components/simple-chat-interface"
import FullFileTranscriber from "@/components/FullFileTranscriber"; // Added for new Transcribe tab
import { EnvWarning } from "@/components/env-warning"
import { AlertDialogConfirm } from "@/components/ui/alert-dialog-confirm" // New import
import CollapsibleSection from "@/components/collapsible-section"
import type { AttachmentFile } from "@/components/file-attachment-minimal"
import FetchedFileListItem, { type FetchedFile } from "@/components/FetchedFileListItem"
import FileEditor from "@/components/file-editor";
import { useMobile } from "@/hooks/use-mobile"
import { Separator } from "@/components/ui/separator"; // Import Separator
import { toast } from "sonner"; // Import toast for notifications
import { Button } from "@/components/ui/button";
// Use both Dropdown and Sheet components
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { predefinedThemes, type ColorTheme } from "@/lib/themes"; // Import themes
import { useTheme } from "next-themes"; // Import useTheme
import ViewSwitcher from "@/components/ui/view-switcher";
import RecordView from "@/components/RecordView";
import CanvasView, { type CanvasInsightItem, type CanvasData } from "@/components/canvas-view"; 
import { Switch } from "@/components/ui/switch"; 
import { Label } from "@/components/ui/label"; 
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"; 
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { VADSettings, type VADAggressiveness } from "@/components/VADSettings";

interface ChatHistoryItem {
  id: string;
  title:string;
  updatedAt: string;
  agentId: string;
  agentName: string;
  hasSavedMessages?: boolean;
  isConversationSaved?: boolean;
}

interface AgentSelectorProps {
  allowedAgents: string[];
  userName: string | null;
}

function AgentSelector({ allowedAgents, userName }: AgentSelectorProps) {
  const router = useRouter();
  const [selectedAgent, setSelectedAgent] = useState('');

  const handleContinue = () => {
    if (selectedAgent) {
      router.push(`/?agent=${selectedAgent}&event=0000`);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Welcome, {userName || 'User'}</CardTitle>
          <CardDescription>
            Please select an agent to begin your session.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {allowedAgents.length > 0 ? (
            <div className="grid gap-6">
              <div className="grid gap-2">
                <Label htmlFor="agent-select">Select Agent</Label>
                <Select value={selectedAgent} onValueChange={setSelectedAgent}>
                  <SelectTrigger id="agent-select" className="w-full">
                    <SelectValue placeholder="Choose an agent..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {allowedAgents.sort().map((agent) => (
                      <SelectItem key={agent} value={agent}>
                        {agent}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleContinue} disabled={!selectedAgent} className="w-full">
                Continue
              </Button>
            </div>
          ) : (
            <div className="text-center text-muted-foreground">
              <p>You do not have access to any agents.</p>
              <p className="text-sm">Please contact an administrator.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Main content component that uses useSearchParams
function HomeContent() {
  const searchParams = useSearchParams();
  const { theme, setTheme } = useTheme(); 

  // State managed by the page
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState("settings");
  const [previousActiveTab, setPreviousActiveTab] = useState("settings"); 
  const [showNewChatConfirm, setShowNewChatConfirm] = useState(false);
  const [allChatAttachments, setAllChatAttachments] = useState<AttachmentFile[]>([]);
  const [agentMemoryFiles, setAgentMemoryFiles] = useState<AttachmentFile[]>([]);
  const [systemPromptFiles, setSystemPromptFiles] = useState<AttachmentFile[]>([]);
  const [contextFiles, setContextFiles] = useState<AttachmentFile[]>([]);
  const [hasOpenSection, setHasOpenSection] = useState(false);
  const [agentObjectiveFunction, setAgentObjectiveFunction] = useState<FetchedFile | null>(null);
  const [baseObjectiveFunction, setBaseObjectiveFunction] = useState<FetchedFile | null>(null);

  // State for S3/Pinecone fetched files
  const [transcriptionS3Files, setTranscriptionS3Files] = useState<FetchedFile[]>([]);
  const [baseSystemPromptS3Files, setBaseSystemPromptS3Files] = useState<FetchedFile[]>([]);
  const [agentSystemPromptS3Files, setAgentSystemPromptS3Files] = useState<FetchedFile[]>([]);
  const [baseFrameworkS3Files, setBaseFrameworkS3Files] = useState<FetchedFile[]>([]);
  const [agentPrimaryContextS3Files, setAgentPrimaryContextS3Files] = useState<FetchedFile[]>([]); 
  const [pineconeMemoryDocs, setPineconeMemoryDocs] = useState<{ name: string }[]>([]);
  const [savedTranscriptSummaries, setSavedTranscriptSummaries] = useState<FetchedFile[]>([]); // New state
  const [currentAgentTheme, setCurrentAgentTheme] = useState<string | undefined>(undefined);

  // State for Canvas View enablement and general view state
  const [currentView, setCurrentView] = useState<"chat" | "canvas" | "transcribe" | "record">("chat");
  const [isCanvasViewEnabled, setIsCanvasViewEnabled] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  // Lifted state for CanvasView
  const [canvasData, setCanvasData] = useState<CanvasData | null>(null);
  const [isCanvasLoading, setIsCanvasLoading] = useState(false);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<"mirror" | "lens" | "portal">("mirror");
  const [selectedTimeWindow, setSelectedTimeWindow] = useState<string>("Whole Meeting");
  const [selectedCanvasFilter, setSelectedCanvasFilter] = useState<"mirror" | "lens" | "portal">("mirror");
  const [selectedCanvasTimeWindow, setSelectedCanvasTimeWindow] = useState<string>("Whole Meeting"); 
  
  const [pinnedCanvasInsights, setPinnedCanvasInsights] = useState<CanvasInsightItem[]>([]);

  // State for new toggles in Documents tab
  const [transcriptListenMode, setTranscriptListenMode] = useState<"none" | "latest" | "all">("latest");
  const [savedTranscriptMemoryMode, setSavedTranscriptMemoryMode] = useState<"disabled" | "enabled">("disabled");
  const [transcriptionLanguage, setTranscriptionLanguage] = useState<"en" | "sv" | "any">("any"); // Default "any"
  const [vadAggressiveness, setVadAggressiveness] = useState<VADAggressiveness>(2);
  const [rawSavedS3Transcripts, setRawSavedS3Transcripts] = useState<FetchedFile[]>([]); // New state for raw saved transcripts

  // Fullscreen mode state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-20250514'); // Default model
  const [temperature, setTemperature] = useState(0.7); // Default temperature

  // Recording state lifted from SimpleChatInterface for fullscreen indicator
  const [recordingState, setRecordingState] = useState({
    isBrowserRecording: false,
    isBrowserPaused: false,
    clientRecordingTime: 0,
    isReconnecting: false
  });

  // New global state for recording status
  type GlobalRecordingStatus = {
    type: 'transcript' | 'recording' | null;
    isRecording: boolean;
    isPaused: boolean;
    time: number;
    sessionId: string | null;
  };

  const [globalRecordingStatus, setGlobalRecordingStatus] = useState<GlobalRecordingStatus>({
    type: null,
    isRecording: false,
    isPaused: false,
    time: 0,
    sessionId: null,
  });

  // State for S3 file viewer
  const [s3FileToView, setS3FileToView] = useState<{ s3Key: string; name: string; type: string } | null>(null);
  const [showS3FileViewer, setShowS3FileViewer] = useState(false);

  // State for archive confirmation modal
  const [showArchiveConfirmModal, setShowArchiveConfirmModal] = useState(false);
  const [fileToArchive, setFileToArchive] = useState<FetchedFile | null>(null); // Changed type to FetchedFile

  // State for save as memory confirmation modal
  const [showSaveAsMemoryConfirmModal, setShowSaveAsMemoryConfirmModal] = useState(false);

  // State for S3 cache clearing
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [fileToSaveAsMemory, setFileToSaveAsMemory] = useState<FetchedFile | null>(null);

  // State for new Chat Memory feature
  const [useChatMemory, setUseChatMemory] = useState(false);
  const [savedMemories, setSavedMemories] = useState<{ id: string, created_at: string, summary: string }[]>([]);
  const [showForgetConfirmModal, setShowForgetConfirmModal] = useState(false);
  const [memoryToForget, setMemoryToForget] = useState<{ id: string, summary: string } | null>(null);

  // State for tracking current chat ID
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [isConversationSaved, setIsConversationSaved] = useState(false);
  const [historyNeedsRefresh, setHistoryNeedsRefresh] = useState(false);

  // State for Chat History
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [chatIdToDelete, setChatIdToDelete] = useState<string | null>(null);

  // State to track S3 keys of files currently being processed (saved to memory or archived)
  const [processingFileKeys, setProcessingFileKeys] = useState<Set<string>>(new Set());
  const [fileActionTypes, setFileActionTypes] = useState<Record<string, 'saving_to_memory' | 'archiving'>>({});
  const [agentCapabilities, setAgentCapabilities] = useState({ pinecone_index_exists: false });


  const handleRecordingStateChange = useCallback((newState: {
    isBrowserRecording: boolean;
    isBrowserPaused: boolean;
    clientRecordingTime: number;
    isReconnecting: boolean;
  }) => {
    setRecordingState(newState);
    if (newState.isBrowserRecording) {
      setGlobalRecordingStatus({
        type: 'transcript',
        isRecording: true,
        isPaused: newState.isBrowserPaused,
        time: newState.clientRecordingTime,
        sessionId: null, // This will be managed by the chat interface
      });
    } else {
      // Only reset if the current global recording is a transcript
      setGlobalRecordingStatus(prev => prev.type === 'transcript' ? {
        type: null,
        isRecording: false,
        isPaused: false,
        time: 0,
        sessionId: null,
      } : prev);
    }
  }, []);


  // Flags to track if data has been fetched for the current agent/event
  const [fetchedDataFlags, setFetchedDataFlags] = useState({
    transcriptions: false,
    baseSystemPrompts: false,
    agentSystemPrompts: false,
    baseFrameworks: false,
    agentPrimaryContext: false, 
    savedSummaries: false, // Added savedSummaries here
    rawSavedS3TranscriptsFetched: false, // New flag for raw saved transcripts
    pineconeMemory: false,
    objectiveFunctions: false,
  });

  const [pageAgentName, setPageAgentName] = useState<string | null>(null);
  const [pageEventId, setPageEventId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null); // Added state for user name
  const [allowedAgents, setAllowedAgents] = useState<string[]>([]);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const supabase = createClient();
  const router = useRouter();

  const fetchChatHistory = useCallback(async () => {
    if (!pageAgentName) return;
    
    setIsLoadingHistory(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const response = await fetch(`/api/chat/history/list?agent=${encodeURIComponent(pageAgentName)}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        const history = await response.json();
        setChatHistory(history);
      }
    } catch (error) {
      console.error('Failed to fetch chat history:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [pageAgentName, supabase.auth]);

  useEffect(() => {
    const agentParam = searchParams.get('agent');
    const eventParam = searchParams.get('event');

    if (pageAgentName !== agentParam || pageEventId !== eventParam) {
      setFetchedDataFlags({
        transcriptions: false,
        baseSystemPrompts: false,
        agentSystemPrompts: false,
        baseFrameworks: false,
        agentPrimaryContext: false,
        savedSummaries: false,
        rawSavedS3TranscriptsFetched: false,
        pineconeMemory: false,
        objectiveFunctions: false,
      });
    }

    setPageAgentName(agentParam);
    setPageEventId(eventParam);

    const checkAuthAndPermissions = async () => {
      setIsAuthorized(null);
      setAuthError(null);

      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (sessionError || !session) {
          // This case should be handled by middleware, but as a fallback:
          console.error("Authorization Check: No active session found.", sessionError);
          setAuthError("Not authenticated.");
          router.push('/login');
          return;
        }

        const response = await fetch('/api/user/permissions', {
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        });

        if (response.status === 401) {
          console.error("Authorization Check: Unauthorized fetching permissions.");
          setAuthError("Session expired or invalid. Please log in again.");
          await supabase.auth.signOut();
          router.push('/login');
          return;
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
          throw new Error(errorData.error || `Failed to fetch permissions: ${response.statusText}`);
        }

        const data = await response.json();
        const fetchedAllowedAgents: { name: string, capabilities: { pinecone_index_exists: boolean } }[] = data.allowedAgents || [];
        const agentNames = fetchedAllowedAgents.map(a => a.name);
        setAllowedAgents(agentNames);

        const name = session.user?.user_metadata?.full_name || session.user?.email || 'Unknown User';
        setUserName(name);

        if (agentParam) {
          if (agentNames.includes(agentParam)) {
            console.log(`Authorization Check: Access GRANTED for agent '${agentParam}'.`);
            const currentAgentData = fetchedAllowedAgents.find(a => a.name === agentParam);
            if (currentAgentData) {
              setAgentCapabilities(currentAgentData.capabilities);
            }
            setIsAuthorized(true);

            console.log(`[Cache Warmer] Triggering pre-caching for agent '${agentParam}'...`);
            fetch('/api/agent/warm-up', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
              body: JSON.stringify({ agent: agentParam, event: eventParam || '0000' })
            });

            fetchChatHistory();
          } else {
            console.warn(`Authorization Check: Access DENIED for agent '${agentParam}'.`);
            setAuthError(`You do not have permission to access the agent specified in the URL ('${agentParam}').`);
            setIsAuthorized(false);
          }
        } else {
          // User is authenticated, but no agent is in the URL.
          // This is the trigger to show the agent selector.
          console.log("Authorization Check: User authenticated, no agent in URL. Will show selector.");
          setIsAuthorized(true);
        }
      } catch (error) {
        console.error("Authorization Check: Error during permission flow:", error);
        const message = error instanceof Error ? error.message : "An unknown error occurred while checking permissions.";
        setAuthError(message);
        setIsAuthorized(false);
      }
    };

    checkAuthAndPermissions();
  }, [searchParams, supabase.auth, router, pageAgentName, pageEventId, fetchChatHistory]);


  // Refs
  const tabContentRef = useRef<HTMLDivElement>(null);
  const chatInterfaceRef = useRef<ChatInterfaceHandle>(null);
  const memoryTabRef = useRef<HTMLDivElement>(null);
  const isMobile = useMobile();

  useEffect(() => {
    if (historyNeedsRefresh && pageAgentName) {
      fetchChatHistory().then(() => {
        setHistoryNeedsRefresh(false);
      });
    }
  }, [historyNeedsRefresh, pageAgentName, fetchChatHistory]);

  const handleDeleteInitiated = (chatId: string) => {
    setChatIdToDelete(chatId);
    setShowDeleteConfirmation(true);
  };

  const handleDeleteConfirm = async () => {
    if (!chatIdToDelete) return;

    const originalChatHistory = [...chatHistory];
    const chatToDelete = chatHistory.find(chat => chat.id === chatIdToDelete);
    const isDeletingCurrentChat = chatIdToDelete === currentChatId;

    // Optimistically remove the chat from the UI
    setChatHistory(prev => prev.filter(chat => chat.id !== chatIdToDelete));
    
    // If the deleted chat is the currently active chat, start a new chat instantly
    if (isDeletingCurrentChat) {
        handleNewChatFromSidebar();
    }
    setShowDeleteConfirmation(false);

    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
            throw new Error("Authentication error. Cannot delete chat.");
        }

        const response = await fetch(`/api/chat/history/delete`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ chatId: chatIdToDelete }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: "Failed to delete chat history" }));
            throw new Error(errorData.error);
        }

        toast.success("Conversation deleted.");

    } catch (error: any) {
        console.error('Failed to delete chat history:', error);
        toast.error(`Failed to delete conversation: ${error.message}. Restoring.`);
        // Rollback UI on failure
        setChatHistory(originalChatHistory);
        // If deletion of the current chat fails, reload it.
        if (isDeletingCurrentChat && chatToDelete) {
          if (chatInterfaceRef.current) {
            chatInterfaceRef.current.loadChatHistory(chatToDelete.id);
            setCurrentChatId(chatToDelete.id);
            setIsConversationSaved(chatToDelete.isConversationSaved || false);
          }
        }
    } finally {
        setChatIdToDelete(null);
    }
  };

  const fileEditorFileProp = useMemo(() => {
    if (!s3FileToView) return null; 
    return {
      id: s3FileToView.s3Key,
      name: s3FileToView.name,
      type: s3FileToView.type,
      size: 0, 
      url: undefined,
      messageId: undefined,
      content: undefined,
      lastModified: undefined,
    };
  }, [s3FileToView]);

  // Callbacks for child components
  const updateChatAttachments = useCallback((attachments: AttachmentFile[]) => {
    // Sort attachments by lastModified date in descending order (newest first)
    const sortedAttachments = [...attachments].sort((a, b) => {
      const dateA = new Date(a.lastModified || 0).getTime();
      const dateB = new Date(b.lastModified || 0).getTime();
      return dateB - dateA;
    });
    setAllChatAttachments(sortedAttachments);
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

  const handleSettingsTabChange = (value: string) => { // Renamed to avoid confusion with main view
    setActiveTab(value);
    setPreviousActiveTab(value); 
  };

  const handleNewChatRequest = () => {
      if (chatInterfaceRef.current && chatInterfaceRef.current.getMessagesCount() > 0) {
          setShowNewChatConfirm(true);
      } else {
          console.log("No messages, calling startNewChat directly");
          chatInterfaceRef.current?.startNewChat();
          setCurrentChatId(null);
      }
  };

  const confirmAndStartNewChat = () => {
      console.log("Modal confirmed, calling startNewChat via ref");
      chatInterfaceRef.current?.startNewChat();
      setCurrentChatId(null);
      setShowNewChatConfirm(false);
      setHistoryNeedsRefresh(true); // Trigger refresh
  };

  const handleNewChatFromSidebar = () => {
      console.log("New chat requested from sidebar");
      chatInterfaceRef.current?.startNewChat();
      setCurrentChatId(null);
      setHistoryNeedsRefresh(true); // Trigger refresh
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
  
  const handleAgentThemeChange = useCallback((newThemeValue: string) => {
      if (pageAgentName) {
        const agentThemeKey = `agent-theme-${pageAgentName}`;
        localStorage.setItem(agentThemeKey, newThemeValue);
        if (predefinedThemes.some(t => t.className === newThemeValue)) {
            localStorage.setItem(`agent-custom-theme-${pageAgentName}`, newThemeValue);
        } else {
            localStorage.removeItem(`agent-custom-theme-${pageAgentName}`);
        }
        setTheme(newThemeValue);
        setCurrentAgentTheme(newThemeValue);
      }
  }, [pageAgentName, setTheme]);

  useEffect(() => {
    if (pageAgentName) {
      const agentThemeKey = `agent-theme-${pageAgentName}`;
      const savedAgentTheme = localStorage.getItem(agentThemeKey);
      if (savedAgentTheme) {
        setTheme(savedAgentTheme);
        setCurrentAgentTheme(savedAgentTheme);
        if (predefinedThemes.some(t => t.className === savedAgentTheme)) {
            localStorage.setItem(`agent-custom-theme-${pageAgentName}`, savedAgentTheme);
        }
      } else {
        setCurrentAgentTheme(theme);
      }
    }
  }, [pageAgentName, setTheme, theme]); 

  useEffect(() => {
    const savedCanvasEnabled = localStorage.getItem("canvasViewEnabled");
    if (savedCanvasEnabled !== null) {
      setIsCanvasViewEnabled(JSON.parse(savedCanvasEnabled));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("canvasViewEnabled", JSON.stringify(isCanvasViewEnabled));
    if (!isCanvasViewEnabled && currentView === "canvas") {
      setCurrentView("chat"); 
    }
  }, [isCanvasViewEnabled, currentView]);

  // Load and persist transcriptListenMode (agent-specific)
  useEffect(() => {
    if (pageAgentName) {
      const key = `transcriptListenModeSetting_${pageAgentName}`;
      const savedMode = localStorage.getItem(key);
      if (savedMode === "none" || savedMode === "latest" || savedMode === "all") {
        setTranscriptListenMode(savedMode as "none" | "latest" | "all");
      } else {
        setTranscriptListenMode("latest"); // Default to "latest"
        localStorage.setItem(key, "latest"); // Persist default if invalid or not found
      }
    }
  }, [pageAgentName]);

  useEffect(() => {
    if (pageAgentName) {
      const key = `transcriptListenModeSetting_${pageAgentName}`;
      localStorage.setItem(key, transcriptListenMode);
    }
  }, [transcriptListenMode, pageAgentName]);

  // Load and persist savedTranscriptMemoryMode (agent-specific)
  useEffect(() => {
    if (pageAgentName) {
      const key = `savedTranscriptMemoryModeSetting_${pageAgentName}`;
      const savedMode = localStorage.getItem(key);
      if (savedMode === "disabled" || savedMode === "enabled") {
        setSavedTranscriptMemoryMode(savedMode as "disabled" | "enabled");
      } else {
        setSavedTranscriptMemoryMode("disabled"); // Default if no agent-specific setting found
      }
    }
  }, [pageAgentName]);

  useEffect(() => {
    if (pageAgentName) {
      const key = `savedTranscriptMemoryModeSetting_${pageAgentName}`;
      localStorage.setItem(key, savedTranscriptMemoryMode);
    }
  }, [savedTranscriptMemoryMode, pageAgentName]);

  // Load and persist transcriptionLanguage (agent-specific)
  useEffect(() => {
    if (pageAgentName) {
      const key = `vadAggressivenessSetting_${pageAgentName}`;
      const savedValue = localStorage.getItem(key);
      if (savedValue && ["1", "2", "3"].includes(savedValue)) {
        setVadAggressiveness(parseInt(savedValue, 10) as VADAggressiveness);
      } else {
        setVadAggressiveness(2); // Default to 'Balanced'
        localStorage.setItem(key, "2");
      }
    }
  }, [pageAgentName]);

  useEffect(() => {
    if (pageAgentName) {
      const key = `vadAggressivenessSetting_${pageAgentName}`;
      localStorage.setItem(key, vadAggressiveness.toString());
    }
  }, [vadAggressiveness, pageAgentName]);

  useEffect(() => {
    if (pageAgentName) { // Ensure agentName is available
      const key = `transcriptionLanguageSetting_${pageAgentName}`;
      const savedLang = localStorage.getItem(key);
      if (savedLang === "en" || savedLang === "sv" || savedLang === "any") {
        setTranscriptionLanguage(savedLang as "en" | "sv" | "any");
        console.log(`[LangSetting] Loaded '${savedLang}' for agent '${pageAgentName}' from localStorage.`);
      } else {
        // No valid setting found for this agent, apply default and potentially save it for next time
        setTranscriptionLanguage("any"); // Initialize localStorage for this agent with default "any"
        localStorage.setItem(key, "any");
        console.log(`[LangSetting] No setting found for agent '${pageAgentName}'. Defaulted to 'any' and saved.`);
      }
    } else {
      // Optional: Handle case where pageAgentName is not yet set (e.g., on initial load)
      // For now, we can let it default to "any" as per initial state and rely on pageAgentName update to trigger correct load.
       setTranscriptionLanguage("any"); // Fallback if no agent context
       console.log(`[LangSetting] No pageAgentName, defaulting language to 'any'.`);
    }
  }, [pageAgentName]); // Dependency: pageAgentName

  useEffect(() => {
    if (pageAgentName) { // Only save if there's an agent context
      const key = `transcriptionLanguageSetting_${pageAgentName}`;
      localStorage.setItem(key, transcriptionLanguage);
      console.log(`[LangSetting] Saved '${transcriptionLanguage}' for agent '${pageAgentName}' to localStorage.`);
    }
  }, [transcriptionLanguage, pageAgentName]); // Dependencies: transcriptionLanguage, pageAgentName

  // Load/persist "Use Chat Memory" toggle state
  useEffect(() => {
    if (pageAgentName) {
      const key = `useChatMemory_${pageAgentName}`;
      const savedValue = localStorage.getItem(key);
      setUseChatMemory(savedValue === 'true');
    }
  }, [pageAgentName]);

  const handleUseChatMemoryChange = (checked: boolean) => {
    setUseChatMemory(checked);
    if (pageAgentName) {
      localStorage.setItem(`useChatMemory_${pageAgentName}`, String(checked));
    }
  };

  // Fetch saved chat memories when settings are opened
  const fetchSavedMemories = useCallback(async () => {
    if (!pageAgentName) return;
    try {
      const response = await fetch(`/api/memory/list-saved-chats?agentName=${encodeURIComponent(pageAgentName)}`);
      if (response.ok) {
        const data = await response.json();
        setSavedMemories(data);
      } else {
        console.error("Failed to fetch saved memories");
        setSavedMemories([]);
      }
    } catch (error) {
      console.error("Error fetching saved memories:", error);
      setSavedMemories([]);
    }
  }, [pageAgentName]);

  useEffect(() => {
    if (showSettings && activeTab === 'memory') {
      fetchSavedMemories();
    }
  }, [showSettings, activeTab, fetchSavedMemories]);

  // Set fullscreen mode to permanent (always true)
  useEffect(() => {
    setIsFullscreen(true);
  }, []);

  // Load and persist selectedModel (agent-specific)
  useEffect(() => {
    if (pageAgentName) {
      const key = `agent-model-${pageAgentName}`;
      const savedModel = localStorage.getItem(key);
      if (savedModel) {
        setSelectedModel(savedModel);
      } else {
        // Default to claude if no setting is found for this agent
        setSelectedModel('claude-sonnet-4-20250514');
      }
    }
  }, [pageAgentName]);

  const handleModelChange = (model: string) => {
    setSelectedModel(model);
    if (pageAgentName) {
      const key = `agent-model-${pageAgentName}`;
      localStorage.setItem(key, model);
    }
  };
  
  // Load and persist temperature (agent-specific)
  useEffect(() => {
    if (pageAgentName) {
      const key = `agent-temperature-${pageAgentName}`;
      const savedTemp = localStorage.getItem(key);
      if (savedTemp !== null && !isNaN(parseFloat(savedTemp))) {
        setTemperature(parseFloat(savedTemp));
      } else {
        setTemperature(0.7); // Default if not set or invalid
      }
    }
  }, [pageAgentName]);

  const handleTemperatureChange = (value: number[]) => {
    const newTemp = value[0];
    setTemperature(newTemp);
    if (pageAgentName) {
      const key = `agent-temperature-${pageAgentName}`;
      localStorage.setItem(key, newTemp.toString());
    }
  };

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

  const fetchS3Data = useCallback(async (prefix: string, onDataFetched: (data: FetchedFile[]) => void, description: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { console.warn(`Not fetching ${description}: no session.`); return; }

    const proxyApiUrl = `/api/s3-proxy/list?prefix=${encodeURIComponent(prefix)}`;
    try {
      const response = await fetch(proxyApiUrl, { headers: { 'Authorization': `Bearer ${session.access_token}` }});
      if (!response.ok) throw new Error(`Failed to fetch ${description} via proxy: ${response.statusText} (URL: ${proxyApiUrl})`);
      const data: FetchedFile[] = await response.json();
      onDataFetched(data);
    } catch (error) {
      console.error(`Error fetching ${description} from proxy ${proxyApiUrl}:`, error);
      onDataFetched([]);
    }
  }, [supabase.auth]);

  // Effect for Transcriptions
  useEffect(() => {
    if (!showSettings || !pageAgentName || !pageEventId || isAuthorized !== true || fetchedDataFlags.transcriptions) return;
    const prefix = `organizations/river/agents/${pageAgentName}/events/${pageEventId}/transcripts/`;
    fetchS3Data(prefix, (data) => {
      // Sort by lastModified date in descending order (newest first)
      const sortedData = [...data].sort((a, b) => {
        const dateA = new Date(a.lastModified || 0).getTime();
        const dateB = new Date(b.lastModified || 0).getTime();
        return dateB - dateA;
      });
      setTranscriptionS3Files(sortedData);
      setFetchedDataFlags(prev => ({ ...prev, transcriptions: true }));
    }, "Transcriptions");
  }, [showSettings, pageAgentName, pageEventId, isAuthorized, fetchedDataFlags.transcriptions, fetchS3Data]);

  // Effect for Base System Prompts
  useEffect(() => {
    if (!showSettings || isAuthorized !== true || fetchedDataFlags.baseSystemPrompts) return;
    fetchS3Data('_config/', (data) => {
      const basePromptRegex = new RegExp(`^systemprompt_base(\\.[^.]+)?$`);
      setBaseSystemPromptS3Files(data.filter(f => basePromptRegex.test(f.name)));
      setFetchedDataFlags(prev => ({ ...prev, baseSystemPrompts: true }));
    }, "Base System Prompts");
  }, [showSettings, isAuthorized, fetchedDataFlags.baseSystemPrompts, fetchS3Data]);
  
  // Effect for Base Frameworks
  useEffect(() => {
    if (!showSettings || isAuthorized !== true || fetchedDataFlags.baseFrameworks) return;
    fetchS3Data('_config/', (data) => {
      const baseFrameworkRegex = new RegExp(`^frameworks_base(\\.[^.]+)?$`);
      setBaseFrameworkS3Files(data.filter(f => baseFrameworkRegex.test(f.name)));
      setFetchedDataFlags(prev => ({ ...prev, baseFrameworks: true }));
    }, "Base Frameworks");
  }, [showSettings, isAuthorized, fetchedDataFlags.baseFrameworks, fetchS3Data]);

  // Effect for Agent System Prompts
  useEffect(() => {
    if (!showSettings || !pageAgentName || isAuthorized !== true || fetchedDataFlags.agentSystemPrompts) return;
    const prefix = `organizations/river/agents/${pageAgentName}/_config/`;
    fetchS3Data(prefix, (data) => {
      const agentPromptRegex = new RegExp(`^systemprompt_aID-${pageAgentName}(\\.[^.]+)?$`);
      setAgentSystemPromptS3Files(data.filter(f => agentPromptRegex.test(f.name)));
      setFetchedDataFlags(prev => ({ ...prev, agentSystemPrompts: true }));
    }, "Agent System Prompts");
  }, [showSettings, pageAgentName, isAuthorized, fetchedDataFlags.agentSystemPrompts, fetchS3Data]);

  // Effect for Agent Primary Context
  useEffect(() => {
    if (!showSettings || !pageAgentName || isAuthorized !== true || fetchedDataFlags.agentPrimaryContext) return;
    const prefix = `organizations/river/agents/${pageAgentName}/_config/`;
    fetchS3Data(prefix, (data) => {
      const agentContextRegex = new RegExp(`^context_aID-${pageAgentName}(\\.[^.]+)?$`);
      setAgentPrimaryContextS3Files(data.filter(f => agentContextRegex.test(f.name)));
      setFetchedDataFlags(prev => ({ ...prev, agentPrimaryContext: true }));
    }, "Agent Primary Context");
  }, [showSettings, pageAgentName, isAuthorized, fetchedDataFlags.agentPrimaryContext, fetchS3Data]);

  // Effect for Saved Summaries
  useEffect(() => {
    if (!showSettings || !pageAgentName || !pageEventId || isAuthorized !== true || fetchedDataFlags.savedSummaries) return;
    const prefix = `organizations/river/agents/${pageAgentName}/events/${pageEventId}/transcripts/summarized/`;
    fetchS3Data(prefix, (data) => {
      // Filter and sort by lastModified date in descending order (newest first)
      const filteredAndSorted = data
        .filter(f => f.name.endsWith('.json'))
        .map(f => ({...f, type: 'application/json'}))
        .sort((a, b) => {
          const dateA = new Date(a.lastModified || 0).getTime();
          const dateB = new Date(b.lastModified || 0).getTime();
          return dateB - dateA;
        });
      setSavedTranscriptSummaries(filteredAndSorted);
      setFetchedDataFlags(prev => ({ ...prev, savedSummaries: true }));
    }, "Saved Transcript Summaries");
  }, [showSettings, pageAgentName, pageEventId, isAuthorized, fetchedDataFlags.savedSummaries, fetchS3Data]);

  // Effect for Raw Saved Transcripts
  useEffect(() => {
    if (!showSettings || !pageAgentName || !pageEventId || isAuthorized !== true || fetchedDataFlags.rawSavedS3TranscriptsFetched) return;
    const prefix = `organizations/river/agents/${pageAgentName}/events/${pageEventId}/transcripts/saved/`;
    fetchS3Data(prefix, (data) => {
      // Filter and sort by lastModified date in descending order (newest first)
      const filteredAndSorted = data
        .filter(f => !f.name.endsWith('/'))
        .sort((a, b) => {
          const dateA = new Date(a.lastModified || 0).getTime();
          const dateB = new Date(b.lastModified || 0).getTime();
          return dateB - dateA;
        });
      setRawSavedS3Transcripts(filteredAndSorted);
      setFetchedDataFlags(prev => ({ ...prev, rawSavedS3TranscriptsFetched: true }));
    }, "Raw Saved Transcripts");
  }, [showSettings, pageAgentName, pageEventId, isAuthorized, fetchedDataFlags.rawSavedS3TranscriptsFetched, fetchS3Data]);

  // Effect for Pinecone Memory
  useEffect(() => {
    const fetchPinecone = async () => {
      if (!showSettings || !pageAgentName || isAuthorized !== true || fetchedDataFlags.pineconeMemory) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      try {
        const url = `/api/pinecone-proxy/list-docs?agentName=${encodeURIComponent(pageAgentName)}&namespace=${encodeURIComponent(pageAgentName)}`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${session.access_token}` }});
        if (!res.ok) throw new Error(`Failed to fetch Pinecone docs: ${res.statusText}`);
        const data = await res.json();
        setPineconeMemoryDocs(data.unique_document_names?.map((name: string) => ({ name })) || []);
      } catch (error) {
        console.error("Error fetching Pinecone Memory Docs:", error);
        setPineconeMemoryDocs([]);
      } finally {
        setFetchedDataFlags(prev => ({ ...prev, pineconeMemory: true }));
      }
    };
    fetchPinecone();
  }, [showSettings, pageAgentName, isAuthorized, supabase.auth, fetchedDataFlags.pineconeMemory]);

  useEffect(() => {
    const fetchObjectiveFunctions = async () => {
      if (!showSettings || !isAuthorized || fetchedDataFlags.objectiveFunctions) {
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const commonHeaders = { 'Authorization': `Bearer ${session.access_token}` };

      const fetchS3Data = async (prefix: string, onDataFetched: (data: FetchedFile[]) => void, description: string) => {
        const proxyApiUrl = `/api/s3-proxy/list?prefix=${encodeURIComponent(prefix)}`;
        try {
          const response = await fetch(proxyApiUrl, { headers: { 'Authorization': commonHeaders.Authorization }});
          if (!response.ok) throw new Error(`Failed to fetch ${description}`);
          const data: FetchedFile[] = await response.json();
          onDataFetched(data);
        } catch (error) {
          console.error(`Error fetching ${description}:`, error);
          onDataFetched([]);
        }
      };
      
      // Fetch agent-specific objective function
      if (pageAgentName) {
        await fetchS3Data(
          `organizations/river/agents/${pageAgentName}/_config/`,
          (agentConfigDocs: FetchedFile[]) => {
            const agentObjFuncRegex = new RegExp(`^objective_function_aID-${pageAgentName}(\\.[^.]+)?$`);
            const foundFile = agentConfigDocs.find(f => agentObjFuncRegex.test(f.name));
            setAgentObjectiveFunction(foundFile || null);
          },
          "Agent Objective Function"
        );
      } else {
        setAgentObjectiveFunction(null);
      }
  
      // Fetch base objective function
      await fetchS3Data(
        `_config/`,
        (allConfigDocs: FetchedFile[]) => {
          const baseObjFuncRegex = new RegExp(`^objective_function(\\.[^.]+)?$`);
          const foundFile = allConfigDocs.find(f => baseObjFuncRegex.test(f.name));
          setBaseObjectiveFunction(foundFile || null);
        },
        "Base Objective Function"
      );
      
      setFetchedDataFlags(prev => ({ ...prev, objectiveFunctions: true }));
    };

    fetchObjectiveFunctions();
  }, [showSettings, pageAgentName, isAuthorized, supabase.auth, fetchedDataFlags.objectiveFunctions]);


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

  const handleArchiveS3FileRequest = (file: FetchedFile) => { // Changed param type to FetchedFile
    setFileToArchive(file);
    setShowArchiveConfirmModal(true);
  };

  const confirmArchiveFile = async () => {
    if (!fileToArchive || !fileToArchive.s3Key || !pageAgentName || !pageEventId) return; // Added s3Key check

    const { s3Key, name } = fileToArchive;
    
    setProcessingFileKeys(prev => new Set(prev).add(s3Key!));
    setFileActionTypes(prev => ({ ...prev, [s3Key!]: 'archiving' }));
    // Immediate UI update for the specific item can still be beneficial
    setTranscriptionS3Files(prevFiles =>
      prevFiles.map(f => (f.s3Key === s3Key ? { ...f, status: 'archiving' } : f))
    );
    setShowArchiveConfirmModal(false); // Close modal immediately

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      console.error("Archive Error: No active session.");
      // Optionally show an error toast to the user
      setShowArchiveConfirmModal(false);
      setFileToArchive(null);
      return;
    }

    try {
      const response = await fetch('/api/s3-proxy/manage-file', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          s3Key,
          action: 'archive',
          agentName: pageAgentName,
          eventId: pageEventId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to archive file: ${response.statusText}`);
      }

      // On success, remove the file from the local state to update UI
      setTranscriptionS3Files((prevFiles) => prevFiles.filter((f) => f.s3Key !== s3Key)); // Remove on success
      console.log(`File ${name} archived successfully.`);
      // Optionally show a success toast

    } catch (error) {
      console.error("Error archiving file:", error);
      // Reset status to 'idle' on error
      setTranscriptionS3Files(prevFiles =>
        prevFiles.map(f =>
          f.s3Key === s3Key ? { ...f, status: 'idle' } : f
        )
      );
      // Optionally show an error toast
    } finally {
      setProcessingFileKeys(prev => {
        const next = new Set(prev);
        next.delete(s3Key!);
        return next;
      });
      setFileActionTypes(prev => {
        const next = { ...prev };
        delete next[s3Key!];
        return next;
      });
      setFileToArchive(null);
    }
  };

  const cancelArchiveFile = () => {
    setShowArchiveConfirmModal(false);
    setFileToArchive(null);
  };

  const handleSaveAsMemoryS3FileRequest = (file: FetchedFile) => {
    setFileToSaveAsMemory(file);
    setShowSaveAsMemoryConfirmModal(true);
  };

  const confirmSaveAsMemoryFile = async () => {
    if (!fileToSaveAsMemory || !fileToSaveAsMemory.s3Key) return;

    const { s3Key, name } = fileToSaveAsMemory;
    
    setProcessingFileKeys(prev => new Set(prev).add(s3Key!));
    setFileActionTypes(prev => ({ ...prev, [s3Key!]: 'saving_to_memory' }));
    // Immediate UI update for the specific item
    setTranscriptionS3Files(prevFiles =>
      prevFiles.map(f => (f.s3Key === s3Key ? { ...f, status: 'saving_to_memory' } : f))
    );
    setShowSaveAsMemoryConfirmModal(false);

    console.log(`Starting 'Save to Memory' for: ${name} (S3 Key: ${s3Key})`);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      console.error("Save As Memory Error: No active session.");
      setTranscriptionS3Files(prevFiles =>
        prevFiles.map(f => (f.s3Key === s3Key ? { ...f, status: 'idle' } : f))
      );
      // Optionally show an error toast
      setFileToSaveAsMemory(null);
      return;
    }

    try {
      const response = await fetch('/api/s3-proxy/summarize-transcript', { // Changed endpoint name to match s3-proxy structure
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          s3Key: s3Key,
          agentName: pageAgentName,
          eventId: pageEventId,
          originalFilename: name,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to process summarization request."}));
        throw new Error(errorData.error || `Summarization request failed: ${response.statusText}`);
      }

      // Check response.ok BEFORE trying to parse JSON for success case
      if (!response.ok) {
        // Attempt to parse error JSON from backend, or use statusText
        const errorData = await response.json().catch(() => ({ error: `Request failed with status: ${response.status}` }));
        throw new Error(errorData.error || errorData.message || `Summarization request failed: ${response.statusText}`);
      }

      const result = await response.json();
      console.log("Summarization successful:", result);
      
      // Update UI: remove from transcriptions list (or mark as 'saved')
      // For now, we just remove it as the next step will be to move it
      setTranscriptionS3Files(prevFiles => prevFiles.filter(f => f.s3Key !== s3Key));
      
      // TODO: In a future step, we would add the new summary to a "Memories" list if displayed in UI.
      // toast({ title: "Memory Saved", description: `"${name}" has been summarized and saved to memory as "${result.summary_filename}".` });

    } catch (error) {
      console.error("Error saving to memory:", error);
      setTranscriptionS3Files(prevFiles =>
        prevFiles.map(f => (f.s3Key === s3Key ? { ...f, status: 'idle' } : f))
      );
      // Optionally show an error toast: toast({ title: "Error", description: `Failed to save memory for "${name}". ${(error as Error).message}` });
    } finally {
      setProcessingFileKeys(prev => {
        const next = new Set(prev);
        next.delete(s3Key!);
        return next;
      });
      setFileActionTypes(prev => {
        const next = { ...prev };
        delete next[s3Key!];
        return next;
      });
      setFileToSaveAsMemory(null);
    }
  };

  const cancelSaveAsMemoryFile = () => {
    setShowSaveAsMemoryConfirmModal(false);
    setFileToSaveAsMemory(null);
  };

  const handleForgetRequest = (memory: { id: string, summary: string }) => {
    setMemoryToForget(memory);
    setShowForgetConfirmModal(true);
  };

  const confirmForgetMemory = async () => {
    if (!memoryToForget || !pageAgentName) return;
    
    const toastId = `forget-memory-${memoryToForget.id}`;
    toast.loading("Forgetting memory...", { id: toastId });
    setShowForgetConfirmModal(false);

    try {
      const response = await fetch('/api/memory/forget-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName: pageAgentName, memoryId: memoryToForget.id }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Failed to forget memory.");
      }

      toast.success("Memory forgotten.", { id: toastId });
      setSavedMemories(prev => prev.filter(m => m.id !== memoryToForget.id));
    } catch (error: any) {
      console.error("Error forgetting memory:", error);
      toast.error(`Failed to forget memory: ${error.message}`, { id: toastId });
    } finally {
      setMemoryToForget(null);
    }
  };

  const handleClearS3Cache = async () => {
    if (!pageAgentName) {
      toast.error("Cannot clear cache: No agent selected.");
      return;
    }

    setIsClearingCache(true);
    toast.info(`Reloading S3 cache for agent: ${pageAgentName}...`);

    try {
      const response = await fetch('/api/admin/clear-cache-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: pageAgentName })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || result.message || "Failed to clear cache.");
      }

      toast.success(result.message || "Cache reloaded successfully.");

      // Re-trigger the data fetch for the settings dialog
      setFetchedDataFlags({
        transcriptions: false,
        baseSystemPrompts: false,
        agentSystemPrompts: false,
        baseFrameworks: false,
        agentPrimaryContext: false,
        savedSummaries: false,
        rawSavedS3TranscriptsFetched: false,
        pineconeMemory: false,
        objectiveFunctions: false,
      });

    } catch (error: any) {
      console.error("Error clearing S3 cache:", error);
      toast.error(`Failed to reload cache: ${error.message}`);
    } finally {
      setIsClearingCache(false);
    }
  };

  const handlePinInsight = (insight: CanvasInsightItem) => {
    setPinnedCanvasInsights((prev) => {
      if (!prev.find(p => p.highlight === insight.highlight && p.explanation === insight.explanation)) { 
        return [...prev, { ...insight, id: insight.id || `${insight.category}-${Date.now()}` }]; 
      }
      return prev;
    });
  };

  const handleUnpinInsight = (insightIdOrHighlight: string) => {
    setPinnedCanvasInsights((prev) => prev.filter(p => (p.id || p.highlight) !== insightIdOrHighlight));
  };

  const handleAgentChange = (newAgent: string) => {
    if (newAgent && newAgent !== pageAgentName) {
      const currentParams = new URLSearchParams(searchParams.toString());
      currentParams.set('agent', newAgent);
      // Preserve other params like 'event' when switching agents
      router.push(`/?${currentParams.toString()}`);
    }
  };
  
  const handleSendCanvasHighlightToChat = (message: string, originalHighlight: CanvasInsightItem) => {
    if (chatInterfaceRef.current && pageAgentName) {
      const prefixedMessage = `🎨 From Canvas: ${message}`;
      
      const chatDataForSubmit = {
        current_canvas_time_window_label: selectedCanvasTimeWindow, 
        active_canvas_insights: canvasData ? JSON.stringify(canvasData) : JSON.stringify({mirror:[], lens:[], portal:[]}), 
        pinned_canvas_insights: JSON.stringify(pinnedCanvasInsights)
      };
      
      chatInterfaceRef.current.submitMessageWithCanvasContext(prefixedMessage, chatDataForSubmit);
      setCurrentView("chat"); 
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

  // If user is authorized but no agent is specified in the URL, show agent selector
  if (isAuthorized && !pageAgentName) {
    return <AgentSelector allowedAgents={allowedAgents} userName={userName} />;
  }

  return (
    <div className={`min-h-dvh h-dvh flex flex-col ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      <Sidebar
        isOpen={isSidebarOpen}
        onOpen={() => setIsSidebarOpen(true)}
        onClose={() => setIsSidebarOpen(false)}
        className="absolute top-[15px] left-4 z-20"
        setCurrentView={setCurrentView}
        setShowSettings={setShowSettings}
        agentName={pageAgentName || undefined}
        selectedModel={selectedModel}
        onNewChat={handleNewChatFromSidebar}
        onLoadChat={(chatId: string, isSaved?: boolean) => {
          if (chatInterfaceRef.current) {
            chatInterfaceRef.current.loadChatHistory(chatId);
            setCurrentChatId(chatId);
            setIsConversationSaved(isSaved || false);
          }
        }}
        currentChatId={currentChatId || undefined}
        chatHistory={chatHistory}
        isLoadingHistory={isLoadingHistory}
        onDeleteChat={handleDeleteInitiated}
      />
      
      {/* Fullscreen recording timer - positioned at very far right, outside chat container */}
      {isFullscreen && globalRecordingStatus.isRecording && (
        <div className="fixed top-[27px] right-[27px] z-20 flex items-center gap-2 text-xs text-foreground/70">
          <span className={`inline-block w-2 h-2 rounded-full ${
            globalRecordingStatus.isPaused ? 'bg-yellow-500' :
            globalRecordingStatus.type === 'transcript' ? 'bg-blue-500 animate-pulse' :
            'bg-red-500 animate-pulse'
          }`}></span>
          <span className="font-mono">
            {Math.floor(globalRecordingStatus.time / 60).toString().padStart(2, '0')}:
            {(globalRecordingStatus.time % 60).toString().padStart(2, '0')}
          </span>
        </div>
      )}
      <div className="main-content flex flex-col flex-1 w-full sm:max-w-[800px] sm:mx-auto">
        <header className={`py-2 px-4 text-center relative flex-shrink-0 ${isFullscreen ? 'fullscreen-header' : ''}`} style={{ height: 'var(--header-height)' }}>
          <div className="flex items-center justify-center h-full">
          {!isFullscreen && (
            <ViewSwitcher 
              currentView={currentView} 
              onViewChange={(newView) => setCurrentView(newView)}
              agentName={pageAgentName} 
              isCanvasEnabled={isCanvasViewEnabled} 
              className="flex-grow justify-center max-w-[calc(100%-7rem)] sm:max-w-sm" // Adjusted: 7rem leaves 3.5rem each side
            />
          )}

          </div>
        </header>
        
        <main className="flex-1 flex flex-col">
        {/* Keep SimpleChatInterface always mounted but hidden when not active to preserve state */}
        <div className={currentView === "chat" ? "flex flex-col flex-1" : "hidden"}>
          <SimpleChatInterface 
            ref={chatInterfaceRef} 
            onAttachmentsUpdate={updateChatAttachments} 
            isFullscreen={isFullscreen}
            selectedModel={selectedModel}
            temperature={temperature}
            onRecordingStateChange={handleRecordingStateChange}
            isDedicatedRecordingActive={globalRecordingStatus.type === 'recording' && globalRecordingStatus.isRecording}
            vadAggressiveness={vadAggressiveness}
            getCanvasContext={() => ({
                current_canvas_time_window_label: selectedTimeWindow,
                active_canvas_insights: canvasData ? JSON.stringify(canvasData) : JSON.stringify({mirror:[], lens:[], portal:[]}),
                pinned_canvas_insights: JSON.stringify(pinnedCanvasInsights)
            })}
            onChatIdChange={setCurrentChatId}
            onHistoryRefreshNeeded={() => setHistoryNeedsRefresh(true)}
          />
        </div>
        {currentView === "transcribe" && (
          <div className="flex flex-col" style={{ height: 'calc(100vh - var(--header-height) - var(--input-area-height))' }}>
            <div className="messages-container" style={{ paddingLeft: '8px', paddingRight: '8px' }}>
              <div className="space-y-1 pt-8 pb-4">
                <FullFileTranscriber agentName={pageAgentName} userName={userName} />
              </div>
            </div>
          </div>
        )}
        {currentView === "record" && (
          <RecordView
            agentName={pageAgentName}
            globalRecordingStatus={globalRecordingStatus}
            setGlobalRecordingStatus={setGlobalRecordingStatus}
            isTranscriptRecordingActive={globalRecordingStatus.type === 'transcript' && globalRecordingStatus.isRecording}
            agentCapabilities={agentCapabilities}
            vadAggressiveness={vadAggressiveness}
          />
        )}
        {currentView === "canvas" && isCanvasViewEnabled && (
          <CanvasView 
            agentName={pageAgentName} 
            eventId={pageEventId} 
            onSendHighlightToChat={handleSendCanvasHighlightToChat}
            pinnedInsights={pinnedCanvasInsights}
            onPinInsight={handlePinInsight}
            onUnpinInsight={handleUnpinInsight}
            className="flex-grow" // Simplified class
            isEnabled={isCanvasViewEnabled}
            initialCanvasData={canvasData}
            setCanvasData={setCanvasData}
            isCanvasLoading={isCanvasLoading}
            setIsCanvasLoading={setIsCanvasLoading}
            canvasError={canvasError}
            setCanvasError={setCanvasError}
            selectedFilter={selectedCanvasFilter} // Use dedicated state for canvas filter
            setSelectedFilter={setSelectedCanvasFilter} // Use dedicated setter
            selectedTimeWindow={selectedCanvasTimeWindow} // Use dedicated state for canvas time window
            setSelectedTimeWindow={setSelectedCanvasTimeWindow} // Use dedicated setter
          />
        )}
         {currentView === "canvas" && !isCanvasViewEnabled && (
            <div className="p-4 text-center text-muted-foreground flex flex-col items-center justify-center h-full">
                <LayoutGrid className="w-12 h-12 mb-2 text-muted-foreground/50" />
                <p>Canvas view is currently disabled.</p>
                <p className="text-sm">You can enable it in the settings menu.</p>
            </div>
        )}
        </main>
      </div>

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
            className="sm:max-w-[750px] pt-8 fixed-dialog flex flex-col"
            onPointerDownOutside={(event) => {
              if ((event.target as HTMLElement)?.closest('.file-editor-root-modal')) {
                event.preventDefault();
              }
            }}
          >
            <DialogTitle><VisuallyHidden>Settings</VisuallyHidden></DialogTitle>
            <DialogDescription><VisuallyHidden>Manage application settings, documents, system prompts, and memory.</VisuallyHidden></DialogDescription>
            <EnvWarning />
            <Tabs value={activeTab} onValueChange={handleSettingsTabChange} className="w-full flex flex-col flex-1 min-h-0">
              <TabsList className="grid w-full grid-cols-3 mb-4">
                <TabsTrigger value="settings">Settings</TabsTrigger>
                <TabsTrigger value="memory">{isMobile ? "Memory" : "Memory"}</TabsTrigger>
                <TabsTrigger value="system">System</TabsTrigger>
              </TabsList>
              <div className="tab-content-wrapper flex-1 overflow-y-auto" ref={tabContentRef}>
                <TabsContent value="settings" className="mt-0 tab-content-scrollable">
                  <div className="space-y-6 tab-content-inner px-2 md:px-4 py-3 md:leading-normal leading-relaxed">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="agent-selector">Agent</Label>
                      <Select value={pageAgentName || ''} onValueChange={handleAgentChange} disabled={allowedAgents.length <= 1}>
                        <SelectTrigger className="w-[220px]" id="agent-selector">
                          <SelectValue placeholder="Select an agent" />
                        </SelectTrigger>
                        <SelectContent>
                          {allowedAgents.sort().map(agent => (
                            <SelectItem key={agent} value={agent}>{agent}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                     <div className="flex items-center justify-between">
                      <Label htmlFor="model-selector">Chat Model</Label>
                      <Select value={selectedModel} onValueChange={handleModelChange}>
                        <SelectTrigger className="w-[220px]" id="model-selector">
                          <SelectValue placeholder="Select a model" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="claude-sonnet-4-20250514">Claude 4 Sonnet</SelectItem>
                          <SelectItem value="gpt-4.1">GPT-4.1</SelectItem>
                          <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
                          <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label htmlFor="temperature-slider">Temperature (Model Creativity)</Label>
                        <span className="text-sm text-muted-foreground font-mono">{temperature.toFixed(2)}</span>
                      </div>
                      <Slider
                        id="temperature-slider"
                        min={0}
                        max={1}
                        step={0.05}
                        value={[temperature]}
                        onValueChange={handleTemperatureChange}
                      />
                    </div>
                    <div className="flex items-center justify-between"> 
                      <Label htmlFor="transcription-language-toggle">Transcription Language</Label>
                      <ToggleGroup
                        type="single"
                        value={transcriptionLanguage}
                        onValueChange={(value) => {
                          if (value === "en" || value === "sv" || value === "any") {
                            setTranscriptionLanguage(value as "en" | "sv" | "any");
                          }
                        }}
                        className="rounded-md bg-muted p-1"
                        aria-label="Transcription language"
                      >
                        <ToggleGroupItem value="any" aria-label="Auto-detect language" size="sm" className="px-3 data-[state=on]:bg-background data-[state=on]:text-foreground">
                          {isMobile ? "Any" : "Any"}
                        </ToggleGroupItem>
                        <ToggleGroupItem value="en" aria-label="English" size="sm" className="px-3 data-[state=on]:bg-background data-[state=on]:text-foreground">
                          {isMobile ? "EN" : "English"}
                        </ToggleGroupItem>
                        <ToggleGroupItem value="sv" aria-label="Swedish" size="sm" className="px-3 data-[state=on]:bg-background data-[state=on]:text-foreground">
                          {isMobile ? "SV" : "Swedish"}
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </div>
                    <div className="flex items-center justify-between">
                      <Label>Global Theme</Label>
                      <ThemeToggle />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label>Agent Theme</Label>
                      {isMobile ? (
                        <Sheet>
                          <SheetTrigger asChild>
                             <Button variant="outline" className="w-[180px] justify-between text-sm">
                               <span>
                                 {
                                   (currentAgentTheme === "light" && "Light") ||
                                   (currentAgentTheme === "dark" && "Dark") ||
                                   (currentAgentTheme === "system" && "System") ||
                                   (predefinedThemes.find(t => t.className === currentAgentTheme)?.name) ||
                                   (theme === "light" && "Light") ||
                                   (theme === "dark" && "Dark") ||
                                   (theme === "system" && "System") ||
                                   (predefinedThemes.find(t => t.className === theme)?.name) ||
                                   "Select Theme"
                                 }
                               </span>
                               <ChevronDown className="h-4 w-4 opacity-50" />
                             </Button>
                          </SheetTrigger>
                          <SheetContent side="bottom" className="rounded-t-lg">
                             <SheetHeader>
                               <SheetTitle>Select Theme</SheetTitle>
                             </SheetHeader>
                             <div className="py-4">
                               <RadioGroup
                                 value={currentAgentTheme || theme}
                                 onValueChange={handleAgentThemeChange}
                                 className="flex flex-col gap-3"
                               >
                                  <div className="flex items-center space-x-2">
                                     <RadioGroupItem value="light" id="theme-light-mobile" />
                                     <Label htmlFor="theme-light-mobile">Light</Label>
                                  </div>
                                  <div className="flex items-center space-x-2">
                                     <RadioGroupItem value="dark" id="theme-dark-mobile" />
                                     <Label htmlFor="theme-dark-mobile">Dark</Label>
                                  </div>
                                   <div className="flex items-center space-x-2">
                                     <RadioGroupItem value="system" id="theme-system-mobile" />
                                     <Label htmlFor="theme-system-mobile">System</Label>
                                  </div>
                                  {predefinedThemes.map((customTheme) => (
                                    <div key={customTheme.className} className="flex items-center space-x-2">
                                      <RadioGroupItem value={customTheme.className} id={`theme-${customTheme.className}-mobile`} />
                                      <Label htmlFor={`theme-${customTheme.className}-mobile`}>{customTheme.name}</Label>
                                    </div>
                                  ))}
                               </RadioGroup>
                             </div>
                          </SheetContent>
                        </Sheet>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="w-[180px] justify-between text-sm">
                              <span>
                                {
                                  (currentAgentTheme === "light" && "Light") ||
                                  (currentAgentTheme === "dark" && "Dark") ||
                                  (currentAgentTheme === "system" && "System") ||
                                  (predefinedThemes.find(t => t.className === currentAgentTheme)?.name) ||
                                  (theme === "light" && "Light") ||
                                  (theme === "dark" && "Dark") ||
                                  (theme === "system" && "System") ||
                                  (predefinedThemes.find(t => t.className === theme)?.name) ||
                                  "Select Theme"
                                }
                              </span>
                              <ChevronDown className="h-4 w-4 opacity-50" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="w-[180px]" align="end">
                            <DropdownMenuRadioGroup
                              value={currentAgentTheme || theme}
                              onValueChange={handleAgentThemeChange}
                            >
                              <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
                              <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
                              <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
                              {predefinedThemes.map((customTheme) => (
                                <DropdownMenuRadioItem key={customTheme.className} value={customTheme.className}>
                                  {customTheme.name}
                                </DropdownMenuRadioItem>
                              ))}
                            </DropdownMenuRadioGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                    <VADSettings
                      aggressiveness={vadAggressiveness}
                      onAggressivenessChange={setVadAggressiveness}
                    />
                  </div>
                </TabsContent>
                <TabsContent value="memory" className="mt-0 tab-content-scrollable">
                  <div className="space-y-4 tab-content-inner px-2 md:px-4 py-3">
                    <CollapsibleSection title="Chat Attachments" defaultOpen={allChatAttachments.length > 0}>
                      <div className="document-upload-container">
                        <DocumentUpload description="Documents attached to the current chat session (Read-only)" type="chat" existingFiles={allChatAttachments} readOnly={true} allowRemove={false} transparentBackground={true} />
                      </div>
                    </CollapsibleSection>
                    <CollapsibleSection title="Transcripts" defaultOpen={true}>
                      <div className="flex items-center justify-between py-3 border-b mb-3">
                        <div className="flex items-center gap-2">
                          <History className="h-5 w-5 text-muted-foreground" />
                          <Label htmlFor="transcript-listen-toggle-group" className="memory-section-title text-sm font-medium">Listen:</Label>
                        </div>
                        <ToggleGroup
                          type="single"
                          value={transcriptListenMode}
                          onValueChange={(value) => {
                            if (value === "none" || value === "latest" || value === "all") {
                              setTranscriptListenMode(value as "none" | "latest" | "all");
                            }
                          }}
                          className="rounded-md bg-muted p-0.5"
                          aria-label="Transcript listen mode"
                          id="transcript-listen-toggle-group"
                        >
                          <ToggleGroupItem value="latest" aria-label="Latest" className="h-6 px-3 data-[state=on]:bg-background data-[state=on]:text-foreground text-xs">
                            Latest
                          </ToggleGroupItem>
                          <ToggleGroupItem value="none" aria-label="None" className="h-6 px-3 data-[state=on]:bg-background data-[state=on]:text-foreground text-xs">
                            None
                          </ToggleGroupItem>
                          <ToggleGroupItem value="all" aria-label="All" className="h-6 px-3 data-[state=on]:bg-background data-[state=on]:text-foreground text-xs">
                            All
                          </ToggleGroupItem>
                        </ToggleGroup>
                      </div>
                      <div className="pb-3 space-y-2 w-full">
                        {transcriptionS3Files.length > 0 ? (
                          transcriptionS3Files.map(originalFile => {
                            const isProcessing = processingFileKeys.has(originalFile.s3Key!);
                            const actionType = fileActionTypes[originalFile.s3Key!];
                            const fileWithPersistentStatus: FetchedFile = {
                              ...originalFile,
                              status: isProcessing ? actionType : originalFile.status,
                            };
                            return (
                              <FetchedFileListItem
                                key={fileWithPersistentStatus.s3Key || fileWithPersistentStatus.name}
                                file={fileWithPersistentStatus} 
                                onView={() => handleViewS3File({ s3Key: fileWithPersistentStatus.s3Key!, name: fileWithPersistentStatus.name, type: fileWithPersistentStatus.type || 'text/plain' })}
                                onDownload={() => handleDownloadS3File({ s3Key: fileWithPersistentStatus.s3Key!, name: fileWithPersistentStatus.name })}
                                onArchive={() => handleArchiveS3FileRequest(fileWithPersistentStatus)}
                                onSaveAsMemory={() => handleSaveAsMemoryS3FileRequest(fileWithPersistentStatus)}
                                showViewIcon={true}
                                showDownloadIcon={true}
                                showArchiveIcon={true}
                                showSaveAsMemoryIcon={true}
                              />
                            );
                          })
                        ) : (
                          <p className="text-sm text-muted-foreground">No transcriptions found in S3.</p>
                        )}
                      </div>
                    </CollapsibleSection>
                    <CollapsibleSection title="Memorized Transcripts" defaultOpen={false}>
                      <div className="flex items-center justify-between py-3 border-b mb-3">
                        <div className="flex items-center gap-2">
                          <Brain className="h-5 w-5 text-muted-foreground" />
                          <Label htmlFor="saved-transcript-memory-toggle" className="memory-section-title text-sm font-medium">Memory:</Label>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-muted-foreground w-16 text-right">
                            {savedTranscriptMemoryMode === "disabled" ? "Disabled" : "Enabled"}
                          </span>
                          <Switch
                            id="saved-transcript-memory-toggle"
                            checked={savedTranscriptMemoryMode === "enabled"}
                            onCheckedChange={(checked) =>
                              setSavedTranscriptMemoryMode(checked ? "enabled" : "disabled")
                            }
                            aria-label="Saved transcript memory mode"
                          />
                        </div>
                      </div>
                      <div className="pb-3 space-y-2 w-full">
                        {savedTranscriptSummaries.length > 0 ? (
                          savedTranscriptSummaries.map(summaryFile => (
                            <FetchedFileListItem
                              key={summaryFile.s3Key || summaryFile.name}
                              file={summaryFile} // Pass the whole file object
                              onView={() => handleViewS3File({ s3Key: summaryFile.s3Key!, name: summaryFile.name, type: summaryFile.type || 'application/json' })}
                              onDownload={() => handleDownloadS3File({ s3Key: summaryFile.s3Key!, name: summaryFile.name })}
                              showViewIcon={true}
                              showDownloadIcon={true}
                              showArchiveIcon={false} // No archive for summaries
                              showSaveAsMemoryIcon={false} // No save for already summarized
                            />
                          ))
                        ) : (<p className="text-sm text-muted-foreground">No saved transcript summaries found.</p>)}
                      </div>
                    </CollapsibleSection>
                    <CollapsibleSection title="Saved Transcripts" defaultOpen={false}>
                       <div className="flex items-center justify-between py-3 border-b mb-3">
                         <div className="flex items-center gap-2">
                           <FileClock className="h-5 w-5 text-muted-foreground" />
                           <span className="memory-section-title text-sm font-medium">Raw Transcripts:</span>
                         </div>
                       </div>
                       <div className="pb-3 space-y-2 w-full">
                         {rawSavedS3Transcripts.length > 0 ? (
                           rawSavedS3Transcripts.map(rawFile => (
                             <FetchedFileListItem
                               key={rawFile.s3Key || rawFile.name}
                               file={rawFile}
                               onView={() => handleViewS3File({ s3Key: rawFile.s3Key!, name: rawFile.name, type: rawFile.type || 'text/plain' })}
                               onDownload={() => handleDownloadS3File({ s3Key: rawFile.s3Key!, name: rawFile.name })}
                               showViewIcon={true}
                               showDownloadIcon={true}
                               showArchiveIcon={false}
                               showSaveAsMemoryIcon={false}
                             />
                           ))
                         ) : (
                           <p className="text-sm text-muted-foreground">No raw saved transcripts found in S3.</p>
                         )}
                       </div>
                    </CollapsibleSection>
                    <CollapsibleSection title="Saved Chats" defaultOpen={true}>
                      <div className="flex items-center justify-between py-3 border-b mb-3">
                        <div className="flex items-center gap-2">
                          <Brain className="h-5 w-5 text-muted-foreground" />
                          <Label htmlFor="use-chat-memory-toggle" className="memory-section-title text-sm font-medium">Use Chat Memory:</Label>
                        </div>
                        <Switch
                          id="use-chat-memory-toggle"
                          checked={useChatMemory}
                          onCheckedChange={handleUseChatMemoryChange}
                        />
                      </div>
                      <div className="pb-3 space-y-2 w-full settings-section-scrollable">
                        {savedMemories.length > 0 ? (
                          savedMemories.map((memory) => (
                            <div key={memory.id} className="flex items-center justify-between p-2 border rounded-md">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate" title={memory.summary}>{memory.summary}</p>
                                <p className="text-xs text-muted-foreground">
                                  Saved: {new Date(memory.created_at).toLocaleString()}
                                </p>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => handleForgetRequest({ id: memory.id, summary: memory.summary })}
                                title="Forget this memory"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground text-center py-4">No saved memories for this agent.</p>
                        )}
                      </div>
                    </CollapsibleSection>
                    <CollapsibleSection title="Database" defaultOpen={true}>
                      <div className="document-upload-container">
                        <DocumentUpload description="Locally added/edited memory files. Documents from Pinecone are listed below." type="memory" allowRemove={true} persistKey={`agent-memory-${pageAgentName}-${pageEventId}`} onFilesAdded={handleAgentMemoryUpdate} existingFiles={agentMemoryFiles} transparentBackground={true} hideDropZone={true} />
                      </div>
                      <div className="mt-4 space-y-2 w-full">
                        {pineconeMemoryDocs.length > 0 ? (
                          pineconeMemoryDocs.map(doc => (
                            <FetchedFileListItem key={doc.name} file={{ name: doc.name, type: 'pinecone/document' }} showViewIcon={false} />
                          ))
                        ) : (<p className="text-sm text-muted-foreground">No documents found in Pinecone memory for '{pageAgentName}'.</p>)}
                      </div>
                    </CollapsibleSection>
                  </div>
                </TabsContent>
                <TabsContent value="system" className="mt-0 tab-content-scrollable">
                  <div className="space-y-4 tab-content-inner px-2 md:px-4 py-3">
                    <CollapsibleSection title="System Prompt" defaultOpen={true}>
                      <div className="document-upload-container">
                        <DocumentUpload description="Locally added/edited system prompt files. Files from S3 are listed below." type="system" allowRemove={true} persistKey={`system-prompt-${pageAgentName}-${pageEventId}`} onFilesAdded={handleSystemPromptUpdate} existingFiles={systemPromptFiles} transparentBackground={true} hideDropZone={true} />
                      </div>
                      {baseSystemPromptS3Files.length > 0 && (
                        <div className="mt-4 space-y-2 w-full">
                          {baseSystemPromptS3Files.map(file => (
                            <FetchedFileListItem key={file.s3Key || file.name} file={file} onView={() => handleViewS3File({ s3Key: file.s3Key!, name: file.name, type: file.type || 'text/plain' })} showViewIcon={!file.name.startsWith('systemprompt_base')} />
                          ))}
                        </div>
                      )}
                      {agentSystemPromptS3Files.length > 0 && (
                        <div className="mt-2 space-y-2 w-full">
                          {agentSystemPromptS3Files.map(file => (
                            <FetchedFileListItem key={file.s3Key || file.name} file={file} onView={() => handleViewS3File({ s3Key: file.s3Key!, name: file.name, type: file.type || 'text/plain' })} showViewIcon={true} />
                          ))}
                        </div>
                      )}
                      {(baseSystemPromptS3Files.length === 0 && agentSystemPromptS3Files.length === 0) && (<p className="text-sm text-muted-foreground mt-2">No system prompts found in S3.</p>)}
                    </CollapsibleSection>
                    <CollapsibleSection title="Context" defaultOpen={true}>
                      <div className="document-upload-container">
                        <DocumentUpload description="Locally added/edited context files. Agent-specific context from S3 is listed below." type="context" allowRemove={true} persistKey={`context-files-${pageAgentName}-${pageEventId}`} onFilesAdded={handleContextUpdate} existingFiles={contextFiles} transparentBackground={true} hideDropZone={true} />
                      </div>
                      <div className="mt-4 space-y-2 w-full">
                        {agentPrimaryContextS3Files.length > 0 ? (
                          agentPrimaryContextS3Files.map(file => (
                            <FetchedFileListItem key={file.s3Key || file.name} file={file} onView={() => handleViewS3File({ s3Key: file.s3Key!, name: file.name, type: file.type || 'text/plain' })} showViewIcon={true} />
                          ))
                        ) : (<p className="text-sm text-muted-foreground">No agent-specific context files found in S3 for '{pageAgentName}'.</p>)}
                      </div>
                    </CollapsibleSection>
                    <CollapsibleSection title="Frameworks" defaultOpen={true}>
                        <div className="space-y-2 w-full">
                            {(agentObjectiveFunction || baseObjectiveFunction) && (
                                <FetchedFileListItem
                                  file={(agentObjectiveFunction || baseObjectiveFunction)!}
                                  showViewIcon={false}
                                />
                            )}
                            {baseFrameworkS3Files.length > 0 ? (
                                baseFrameworkS3Files.map(file => (
                                <FetchedFileListItem key={file.s3Key || file.name} file={file} onView={() => handleViewS3File({ s3Key: file.s3Key!, name: file.name, type: file.type || 'text/plain' })} showViewIcon={!file.name.startsWith('frameworks_base')} />
                                ))
                            ) : (
                                !(agentObjectiveFunction || baseObjectiveFunction) && <p className="text-sm text-muted-foreground">No base frameworks found in S3.</p>
                            )}
                        </div>
                    </CollapsibleSection>

                    {/* <Separator className="my-4" /> */}
                    
                    <div className="flex items-center justify-center">
                      <Button
                        variant="outline"
                        onClick={handleClearS3Cache}
                        disabled={isClearingCache}
                      >
                        {isClearingCache ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Reloading...
                          </>
                        ) : (
                          "Reload S3 Cache"
                        )}
                      </Button>
                    </div>

                  </div>
                </TabsContent>
              </div>
            </Tabs>
          </DialogContent>
        </Dialog>
      )}

      <AlertDialogConfirm
        isOpen={showNewChatConfirm}
        onClose={cancelNewChat}
        onConfirm={confirmAndStartNewChat}
        title="Start New Chat"
        message="Are you sure you want to start a new chat? This will clear the current conversation and stop any active recording."
        confirmText="Start New"
        cancelText="Cancel"
        confirmVariant="default"
      />

      <AlertDialogConfirm
        isOpen={showDeleteConfirmation}
        onClose={() => setShowDeleteConfirmation(false)}
        onConfirm={handleDeleteConfirm}
        title="Are you sure?"
        message="This will permanently delete the chat history. This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        confirmVariant="destructive"
      />

      <AlertDialogConfirm
        isOpen={showArchiveConfirmModal}
        onClose={cancelArchiveFile}
        onConfirm={confirmArchiveFile}
        title="Archive Transcript"
        message={`Are you sure you want to archive "${fileToArchive?.name}"? This will move the file to an archive location and it will no longer be actively used for real-time context unless restored.`}
        confirmText="Archive"
        cancelText="Cancel"
        confirmVariant="destructive"
      />

      <AlertDialogConfirm
        isOpen={showSaveAsMemoryConfirmModal}
        onClose={cancelSaveAsMemoryFile}
        onConfirm={confirmSaveAsMemoryFile}
        title="Save Transcript to Memory"
        message={`This will summarize the transcript and save it as a new memory file. The original transcript will then be moved to a 'saved' archive. This process cannot be undone. Proceed with "${fileToSaveAsMemory?.name}"?`}
        confirmText="Confirm & Save"
        cancelText="Cancel"
        confirmVariant="default"
      />
      
      <AlertDialogConfirm
        isOpen={showForgetConfirmModal}
        onClose={() => setShowForgetConfirmModal(false)}
        onConfirm={confirmForgetMemory}
        title="Forget Memory"
        message={
          <span>
            Are you sure you want to permanently forget this memory?
            <br />
            <strong className="font-semibold text-destructive">{memoryToForget?.summary}</strong>
            <br />
            This action cannot be undone.
          </span>
        }
        confirmText="Forget"
        cancelText="Cancel"
        confirmVariant="destructive"
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
