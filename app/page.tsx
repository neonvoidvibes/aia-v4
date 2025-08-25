"use client"

import React, { useState, useRef, useCallback, useEffect, useMemo, Suspense } from "react"
import { useRouter, useSearchParams } from 'next/navigation';
import { PenSquare, ChevronDown, AlertTriangle, Eye, LayoutGrid, Loader2, History, Brain, FileClock, SlidersHorizontal, Waves, MessageCircle, Settings, Trash2, SquarePen, User, ShieldCheck } from "lucide-react"
import Sidebar from "@/components/ui/sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { VisuallyHidden } from "@radix-ui/react-visually-hidden"
import { createClient } from '@/utils/supabase/client';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ThemeToggle } from "@/components/theme-toggle"
import DocumentUpload from "@/components/document-upload"
import SimpleChatInterface, { type ChatInterfaceHandle } from "@/components/simple-chat-interface"
import FullFileTranscriber from "@/components/FullFileTranscriber";
import { EnvWarning } from "@/components/env-warning"
import { AlertDialogConfirm } from "@/components/ui/alert-dialog-confirm"
import CollapsibleSection from "@/components/collapsible-section"
import type { AttachmentFile } from "@/components/file-attachment-minimal"
import FetchedFileListItem, { type FetchedFile } from "@/components/FetchedFileListItem"
import FileEditor from "@/components/file-editor";
import { useMobile } from "@/hooks/use-mobile"
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { predefinedThemes, type ColorTheme } from "@/lib/themes";
import { useTheme } from "next-themes";
import ViewSwitcher from "@/components/ui/view-switcher";
import RecordView from "@/components/RecordView";
import CanvasView, { type CanvasInsightItem, type CanvasData } from "@/components/canvas-view"; 
import { Switch } from "@/components/ui/switch"; 
import { Label } from "@/components/ui/label"; 
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"; 
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { VADSettings, type VADAggressiveness } from "@/components/VADSettings";
import AgentSelectorMenu from "@/components/ui/agent-selector";
import { MODEL_GROUPS } from "@/lib/model-map";
import AgentDashboard from "@/components/agent-dashboard";

// --- New Component: ConsentView ---
function ConsentView({ workspaceId, onConsent }: { workspaceId: string, onConsent: () => void }) {
  const [isConsenting, setIsConsenting] = useState(false);

  const handleConsent = async () => {
    setIsConsenting(true);
    try {
      const response = await fetch('/api/user/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to record consent.");
      }
      toast.success("Thank you for your consent.");
      onConsent(); // Trigger refresh in parent component
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setIsConsenting(false);
    }
  };

  return (
    <div className="w-full flex items-center justify-center min-h-screen bg-background px-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-2xl">Consent for Participation</CardTitle>
          <CardDescription>
            Please review and agree to the terms to continue to the pilot project.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="prose prose-sm dark:prose-invert max-w-none mb-6">
            <p>Welcome to the IKEA AI Augmentation Pilot.</p>
            <p>By participating, you acknowledge that your interactions with the AI agents, including conversations and recorded audio, will be processed and stored for the purposes of system improvement, research, and analysis during this 3-month project.</p>
            <p>All data is handled in accordance with our privacy policy. Your participation is valuable to us.</p>
          </div>
          <div className="flex flex-col gap-4">
            <a href="/privacy-policy.html" target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground underline hover:text-primary">
              View Full Privacy Policy
            </a>
            <Button onClick={handleConsent} disabled={isConsenting} className="w-full">
              {isConsenting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              I Agree and Consent to Participate
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


interface ChatHistoryItem {
  id: string;
  title:string;
  updatedAt: string;
  agentId: string;
  agentName: string;
  hasSavedMessages?: boolean;
  isConversationSaved?: boolean;
}

interface Agent {
  id: string;
  name: string;
  workspaceId: string | null;
  capabilities: { pinecone_index_exists: boolean };
}

interface PermissionsData {
  isAdminOverride: boolean;
  userHasConsented: boolean;
  showAgentSelector: boolean;
  agents: Agent[];
  workspaceConfigs: Record<string, any>;
  userRole: string;
}


// Main content component that uses useSearchParams
function HomeContent() {
  const mainLayoutRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { theme, setTheme } = useTheme(); 

  const [permissionsData, setPermissionsData] = useState<PermissionsData | null>(null);
  const [activeUiConfig, setActiveUiConfig] = useState<Record<string, any>>({});
  const [currentAgent, setCurrentAgent] = useState<Agent | null>(null);
  
  const [authError, setAuthError] = useState<string | null>(null);

  // This effect is the new "gatekeeper" for the entire application.
  // It fetches all permissions and configurations once on load.
  useEffect(() => {
    const checkAuthAndPermissions = async () => {
      setAuthError(null);
      try {
        const response = await fetch('/api/user/permissions');
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Failed to parse error' }));
          if (response.status === 401) {
            router.push('/login');
            return;
          }
          throw new Error(errorData.error || `Failed to fetch permissions: ${response.statusText}`);
        }
        const data: PermissionsData = await response.json();
        setPermissionsData(data);
        
        // FUTURE-PROOFING: This logic determines the initial agent to display.
        // It can be extended to remember the last used agent per user.
        if (data.agents && data.agents.length > 0) {
          const initialAgent = data.agents[0];
          setCurrentAgent(initialAgent);
        }
      } catch (error) {
        console.error("Permissions Check Error:", error);
        setAuthError(error instanceof Error ? error.message : "An unknown error occurred.");
      }
    };
    checkAuthAndPermissions();
  }, [router]);
  
  // This effect dynamically sets the active UI configuration whenever the current agent changes.
  useEffect(() => {
    if (permissionsData && currentAgent) {
      if (permissionsData.isAdminOverride) {
        // Admins get a default, full-featured config, ignoring workspace settings.
        setActiveUiConfig({});
      } else {
        const config = currentAgent.workspaceId ? permissionsData.workspaceConfigs[currentAgent.workspaceId] : {};
        setActiveUiConfig(config || {});
        
        // Apply theme override from workspace config
        const themeOverride = config?.theme_override;
        if (themeOverride && themeOverride !== theme) {
            setTheme(themeOverride);
        }
      }
    }
  }, [currentAgent, permissionsData, theme, setTheme]);

  // The rest of the state is managed here as before...
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState("settings");
  // ... (and so on for the other state variables)
  const [previousActiveTab, setPreviousActiveTab] = useState("settings"); 
  const [showNewChatConfirm, setShowNewChatConfirm] = useState(false);
  const [allChatAttachments, setAllChatAttachments] = useState<AttachmentFile[]>([]);
  const [agentMemoryFiles, setAgentMemoryFiles] = useState<AttachmentFile[]>([]);
  const [systemPromptFiles, setSystemPromptFiles] = useState<AttachmentFile[]>([]);
  const [contextFiles, setContextFiles] = useState<AttachmentFile[]>([]);
  const [hasOpenSection, setHasOpenSection] = useState(false);
  const [agentObjectiveFunction, setBaseObjectiveFunction] = useState<FetchedFile | null>(null);
  const [baseObjectiveFunction, setAgentObjectiveFunction] = useState<FetchedFile | null>(null);
  const [transcriptionS3Files, setTranscriptionS3Files] = useState<FetchedFile[]>([]);
  const [baseSystemPromptS3Files, setBaseSystemPromptS3Files] = useState<FetchedFile[]>([]);
  const [agentSystemPromptS3Files, setAgentSystemPromptS3Files] = useState<FetchedFile[]>([]);
  const [baseFrameworkS3Files, setBaseFrameworkS3Files] = useState<FetchedFile[]>([]);
  const [agentPrimaryContextS3Files, setAgentPrimaryContextS3Files] = useState<FetchedFile[]>([]); 
  const [pineconeMemoryDocs, setPineconeMemoryDocs] = useState<{ name: string }[]>([]);
  const [savedTranscriptSummaries, setSavedTranscriptSummaries] = useState<FetchedFile[]>([]);
  const [individualMemoryToggleStates, setIndividualMemoryToggleStates] = useState<Record<string, boolean>>({});
  const [individualRawTranscriptToggleStates, setIndividualRawTranscriptToggleStates] = useState<Record<string, boolean>>({});
  const [agentDocuments, setAgentDocuments] = useState<FetchedFile[]>([]);
  const [currentAgentTheme, setCurrentAgentTheme] = useState<string | undefined>(undefined);
  const [currentView, setCurrentView] = useState<"chat" | "canvas" | "transcribe" | "record">("chat");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [canvasData, setCanvasData] = useState<CanvasData | null>(null);
  const [isCanvasLoading, setIsCanvasLoading] = useState(false);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [selectedCanvasFilter, setSelectedCanvasFilter] = useState<"mirror" | "lens" | "portal">("mirror");
  const [selectedCanvasTimeWindow, setSelectedCanvasTimeWindow] = useState<string>("Whole Meeting"); 
  const [pinnedCanvasInsights, setPinnedCanvasInsights] = useState<CanvasInsightItem[]>([]);
  const [transcriptListenMode, setTranscriptListenMode] = useState<"none" | "some" | "latest" | "all">("latest");
  const [savedTranscriptMemoryMode, setSavedTranscriptMemoryMode] = useState<"none" | "some" | "all">("none");
  const [transcriptionLanguage, setTranscriptionLanguage] = useState<"en" | "sv" | "any">("any");
  const [vadAggressiveness, setVadAggressiveness] = useState<VADAggressiveness>(1);
  const [rawSavedS3Transcripts, setRawSavedS3Transcripts] = useState<FetchedFile[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-20250514');
  const [temperature, setTemperature] = useState(0.7);
  const [recordingState, setRecordingState] = useState({ isBrowserRecording: false, isBrowserPaused: false, clientRecordingTime: 0, isReconnecting: false });
  const [noteRecordingTime, setNoteRecordingTime] = useState(0);
  type RecordingType = 'long-form-note' | 'long-form-chat' | 'press-to-talk' | null;
  type GlobalRecordingStatus = { isRecording: boolean; type: RecordingType; };
  const [globalRecordingStatus, setGlobalRecordingStatus] = useState<GlobalRecordingStatus>({ isRecording: false, type: null });
  const [s3FileToView, setS3FileToView] = useState<{ s3Key: string; name: string; type: string } | null>(null);
  const [showS3FileViewer, setShowS3FileViewer] = useState(false);
  const [showArchiveConfirmModal, setShowArchiveConfirmModal] = useState(false);
  const [fileToArchive, setFileToArchive] = useState<FetchedFile | null>(null);
  const [showSaveAsMemoryConfirmModal, setShowSaveAsMemoryConfirmModal] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [fileToSaveAsMemory, setFileToSaveAsMemory] = useState<FetchedFile | null>(null);
  const [useChatMemory, setUseChatMemory] = useState(false);
  const [savedMemories, setSavedMemories] = useState<{ id: string, created_at: string, summary: string }[]>([]);
  const [showForgetConfirmModal, setShowForgetConfirmModal] = useState(false);
  const [memoryToForget, setMemoryToForget] = useState<{ id: string, summary: string } | null>(null);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [isConversationSaved, setIsConversationSaved] = useState(false);
  const [historyNeedsRefresh, setHistoryNeedsRefresh] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isSidebarLocked, setIsSidebarLocked] = useState(false);
  const isSidebarLockedRef = useRef(isSidebarLocked);
  useEffect(() => { isSidebarLockedRef.current = isSidebarLocked; }, [isSidebarLocked]);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [chatIdToDelete, setChatIdToDelete] = useState<string | null>(null);
  const [processingFileKeys, setProcessingFileKeys] = useState<Set<string>>(new Set());
  const [fileActionTypes, setFileActionTypes] = useState<Record<string, 'saving_to_memory' | 'archiving'>>({});
  const [showAgentDashboard, setShowAgentDashboard] = useState(false);
  
  // This state is now derived from the activeUiConfig
  const isCanvasViewEnabled = permissionsData?.isAdminOverride || activeUiConfig?.show_canvas_view;
  const pageAgentName = currentAgent?.name || null;
  const searchParams = useSearchParams();
  const pageEventId = searchParams.get('event');
  const supabase = createClient();
  
  // All the other functions (handleDeleteConfirm, fetchS3Data, etc.) remain largely the same,
  // as they already depend on `pageAgentName` and `pageEventId` which are now derived from the central state.
  
  // ... (Keep all the functions like handleDeleteConfirm, handleRecordingStateChange, fetchS3Data, etc.) ...
  // ... The logic inside them does not need to change significantly because they rely on `pageAgentName`.

  useEffect(() => {
    // This effect is now simplified. It just sets the transcriptionLanguage based on uiConfig.
    if (activeUiConfig.default_transcription_language) {
      setTranscriptionLanguage(activeUiConfig.default_transcription_language);
    } else {
      // Fallback to localStorage or default if not in config
      const savedLang = localStorage.getItem(`transcriptionLanguageSetting_${pageAgentName}`);
      if (savedLang === "en" || savedLang === "sv" || savedLang === "any") {
        setTranscriptionLanguage(savedLang);
      } else {
        setTranscriptionLanguage("any");
      }
    }
  }, [activeUiConfig, pageAgentName]);

  const handleAgentChange = useCallback((agentName: string) => {
    const newAgent = permissionsData?.agents.find(a => a.name === agentName);
    if (newAgent) {
      setCurrentAgent(newAgent);
      // Optional: Update URL without reloading page for bookmarking
      const currentParams = new URLSearchParams(window.location.search);
      currentParams.set('agent', agentName);
      router.replace(`?${currentParams.toString()}`);
    }
  }, [permissionsData, router]);

  // --- Start of copy-pasted functions from the original file ---
  // (These functions are kept as they are, since their logic remains valid)
  const fetchChatHistory = useCallback(async (agentToFetch: string) => {
    if (!agentToFetch || isSidebarLockedRef.current) return;
    setIsLoadingHistory(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const response = await fetch(`/api/chat/history/list?agent=${encodeURIComponent(agentToFetch)}`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (response.ok) setChatHistory(await response.json());
    } catch (error) { console.error('Failed to fetch chat history:', error); }
    finally { setIsLoadingHistory(false); }
  }, [supabase.auth]);
  const handleDeleteInitiated = (chatId: string) => { setChatIdToDelete(chatId); setShowDeleteConfirmation(true); };
  const handleDeleteConfirm = async () => {
    if (!chatIdToDelete) return;
    setIsSidebarLocked(true);
    const originalChatHistory = [...chatHistory];
    const chatToDelete = chatHistory.find(chat => chat.id === chatIdToDelete);
    const isDeletingCurrentChat = chatIdToDelete === currentChatId;
    setChatHistory(prev => prev.filter(chat => chat.id !== chatIdToDelete));
    setShowDeleteConfirmation(false);
    if (isDeletingCurrentChat) { chatInterfaceRef.current?.startNewChat({ suppressRefresh: true }); setCurrentChatId(null); }
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Authentication error.");
        const response = await fetch(`/api/chat/history/delete`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: chatIdToDelete }) });
        if (!response.ok) throw new Error((await response.json()).error);
        toast.success("Conversation deleted.");
        setHistoryNeedsRefresh(true);
    } catch (error: any) {
        toast.error(`Failed to delete conversation: ${error.message}.`);
        setChatHistory(originalChatHistory);
        if (isDeletingCurrentChat && chatToDelete) { if (chatInterfaceRef.current) { chatInterfaceRef.current.loadChatHistory(chatToDelete.id); setCurrentChatId(chatToDelete.id); setIsConversationSaved(chatToDelete.isConversationSaved || false); } }
    } finally {
        setIsSidebarLocked(false);
        setChatIdToDelete(null);
    }
  };
  const handleRecordingStateChange = useCallback((newState: any) => {
      setRecordingState(newState);
      setGlobalRecordingStatus(prev => newState.isBrowserRecording ? { type: 'long-form-chat', isRecording: true } : (prev.type === 'long-form-chat' ? { type: null, isRecording: false } : prev));
  }, []);
  const handleNewChatRequest = () => {
      if (chatInterfaceRef.current && chatInterfaceRef.current.getMessagesCount() > 0) {
          setShowNewChatConfirm(true);
      } else {
          chatInterfaceRef.current?.startNewChat();
          setCurrentChatId(null);
      }
  };
  const confirmAndStartNewChat = () => {
      chatInterfaceRef.current?.startNewChat();
      setCurrentChatId(null);
      setShowNewChatConfirm(false);
  };
  const handleNewChatFromSidebar = () => {
      chatInterfaceRef.current?.startNewChat();
      setCurrentChatId(null);
  };
  // ... and so on for all other existing functions.
  const isAnyModalOpen = showSettings || showNewChatConfirm || showS3FileViewer || showArchiveConfirmModal || showSaveAsMemoryConfirmModal || showForgetConfirmModal || showDeleteConfirmation;
  const [fetchedDataFlags, setFetchedDataFlags] = useState({ transcriptions: false, baseSystemPrompts: false, agentSystemPrompts: false, baseFrameworks: false, agentPrimaryContext: false, savedSummaries: false, rawSavedS3TranscriptsFetched: false, pineconeMemory: false, objectiveFunctions: false, agentDocuments: false });
  const chatInterfaceRef = useRef<ChatInterfaceHandle>(null);
  const isMobile = useMobile();
  const fileEditorFileProp = useMemo(() => { if (!s3FileToView) return null; return { id: s3FileToView.s3Key, name: s3FileToView.name, type: s3FileToView.type, size: 0 }; }, [s3FileToView]);
  const updateChatAttachments = useCallback((attachments: AttachmentFile[]) => { setAllChatAttachments([...attachments].sort((a, b) => new Date(b.lastModified || 0).getTime() - new Date(a.lastModified || 0).getTime())); }, []);
  const handleAgentMemoryUpdate = useCallback((files: AttachmentFile[]) => { setAgentMemoryFiles(files); }, []);
  const handleSystemPromptUpdate = useCallback((files: AttachmentFile[]) => { setSystemPromptFiles(files); }, []);
  const handleContextUpdate = useCallback((files: AttachmentFile[]) => { setContextFiles(files); }, []);
  const handleSettingsTabChange = (value: string) => { setActiveTab(value); setPreviousActiveTab(value); };
  const cancelNewChat = () => { setShowNewChatConfirm(false); };
  const handleSectionToggle = (isOpen: boolean) => { setHasOpenSection(isOpen); };
  const memoryTabRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (memoryTabRef.current) { if (hasOpenSection) { memoryTabRef.current.classList.add("has-open-section"); } else { memoryTabRef.current.classList.remove("has-open-section"); } } }, [hasOpenSection]);
  useEffect(() => { if (pageAgentName) { const key = `transcriptListenModeSetting_${pageAgentName}`; const savedMode = localStorage.getItem(key); if (savedMode === "none" || savedMode === "latest" || savedMode === "all") { setTranscriptListenMode(savedMode as "none" | "latest" | "all"); } else { setTranscriptListenMode("latest"); localStorage.setItem(key, "latest"); } } }, [pageAgentName]);
  useEffect(() => { if (pageAgentName) { const key = `transcriptListenModeSetting_${pageAgentName}`; localStorage.setItem(key, transcriptListenMode); } }, [transcriptListenMode, pageAgentName]);
  const fetchS3Data = useCallback(async (prefix: string, onDataFetched: (data: FetchedFile[]) => void, description: string) => { const { data: { session } } = await supabase.auth.getSession(); if (!session) { return; } const proxyApiUrl = `/api/s3-proxy/list?prefix=${encodeURIComponent(prefix)}`; try { const response = await fetch(proxyApiUrl, { headers: { 'Authorization': `Bearer ${session.access_token}` }}); if (!response.ok) throw new Error(`Failed to fetch ${description}`); onDataFetched(await response.json()); } catch (error) { console.error(`Error fetching ${description}:`, error); onDataFetched([]); } }, [supabase.auth]);
  const handleViewS3File = (file: { s3Key: string; name: string; type: string }) => { setS3FileToView(file); setPreviousActiveTab(activeTab); setShowSettings(false); setShowS3FileViewer(true); };
  const handleCloseS3FileViewer = () => { setShowS3FileViewer(false); setS3FileToView(null); setShowSettings(true); setTimeout(() => { setActiveTab(previousActiveTab); }, 0); };
  // ... and the rest of the functions
  // --- End of copy-pasted functions ---

  if (!permissionsData || !currentAgent) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  
  if (authError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen text-center p-4">
        <AlertTriangle className="w-16 h-16 text-red-500 mb-4" />
        <h1 className="text-2xl font-bold mb-2">Access Error</h1>
        <p className="text-muted-foreground mb-4">{authError}</p>
        <Button onClick={() => router.push('/login')}>Go to Login</Button>
      </div>
    );
  }
  
  // Render ConsentView if consent is required and not yet given
  if (activeUiConfig && activeUiConfig.require_consent && !permissionsData.userHasConsented) {
    return <ConsentView workspaceId={currentAgent.workspaceId!} onConsent={() => window.location.reload()} />;
  }

  // Define what the "Controls" icon does based on the UI config
  const handleControlsClick = () => {
    // Admins always see settings. Others see it only if the link isn't hidden.
    if (permissionsData.isAdminOverride || !activeUiConfig.hide_sidebar_links?.includes('settings')) {
        setShowSettings(true);
    } else {
        // For simplified users like IKEA, this just toggles the plus menu.
        // We'll manage this state inside SimpleChatInterface.
        // This is a placeholder for a more direct way to trigger the plus menu.
        toast.info("Controls menu toggled.");
    }
  };


  return (
    <div ref={mainLayoutRef} className={`min-h-dvh h-dvh flex flex-col ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      <Sidebar
        isOpen={isSidebarOpen}
        onOpen={() => setIsSidebarOpen(true)}
        onClose={() => setIsSidebarOpen(false)}
        className="absolute top-[15px] left-2 md:left-6 z-20"
        setCurrentView={setCurrentView}
        setShowSettings={setShowSettings}
        agentName={pageAgentName || undefined}
        selectedModel={selectedModel}
        onNewChat={handleNewChatFromSidebar}
        onLoadChat={(chatId: string) => {
          if (chatInterfaceRef.current) {
            chatInterfaceRef.current.loadChatHistory(chatId);
            setCurrentChatId(chatId);
          }
        }}
        currentChatId={currentChatId || undefined}
        chatHistory={chatHistory}
        isLoadingHistory={isLoadingHistory}
        onDeleteChat={handleDeleteInitiated}
        transcriptListenMode={transcriptListenMode}
        savedTranscriptMemoryMode={savedTranscriptMemoryMode}
        individualMemoryToggleStates={individualMemoryToggleStates}
        uiConfig={activeUiConfig}
      />
      
      <div className="main-content flex flex-col flex-1 w-full sm:max-w-[800px] sm:mx-auto">
        <header className="py-2 px-4 text-center relative flex-shrink-0" style={{ height: 'var(--header-height)' }}>
          <div className="flex items-center justify-center h-full">
            {permissionsData.showAgentSelector && currentAgent && (
              <AgentSelectorMenu
                allowedAgents={permissionsData.agents.map(a => a.name)}
                currentAgent={currentAgent.name}
                onAgentChange={handleAgentChange}
                userRole={permissionsData.userRole}
                onDashboardClick={() => setShowAgentDashboard(true)}
              />
            )}
          </div>
        </header>
        
        <main className="flex-1 flex flex-col">
          <SimpleChatInterface
            ref={chatInterfaceRef}
            onAttachmentsUpdate={updateChatAttachments}
            isFullscreen={true} // Forcing fullscreen as default
            selectedModel={activeUiConfig.default_model || selectedModel}
            temperature={temperature}
            onModelChange={setSelectedModel}
            onRecordingStateChange={handleRecordingStateChange as any}
            isDedicatedRecordingActive={globalRecordingStatus.type === 'long-form-note'}
            vadAggressiveness={vadAggressiveness}
            globalRecordingStatus={globalRecordingStatus}
            setGlobalRecordingStatus={setGlobalRecordingStatus}
            transcriptListenMode={transcriptListenMode}
            onChatIdChange={setCurrentChatId}
            onHistoryRefreshNeeded={() => setHistoryNeedsRefresh(true)}
            savedTranscriptMemoryMode={savedTranscriptMemoryMode}
            individualMemoryToggleStates={individualMemoryToggleStates}
            savedTranscriptSummaries={savedTranscriptSummaries}
            individualRawTranscriptToggleStates={individualRawTranscriptToggleStates}
            rawTranscriptFiles={rawTranscriptFiles}
            isModalOpen={isAnyModalOpen}
            uiConfig={activeUiConfig} // Pass the active UI config down
            agentCapabilities={currentAgent?.capabilities}
          />
        </main>
      </div>

      {showAgentDashboard && (
        <AgentDashboard
          isOpen={showAgentDashboard}
          onClose={() => setShowAgentDashboard(false)}
          userRole={permissionsData.userRole}
        />
      )}

      {/* Keep confirmation modals */}
      <AlertDialogConfirm
        isOpen={showNewChatConfirm}
        onClose={cancelNewChat}
        onConfirm={confirmAndStartNewChat}
        title="Start New Chat"
        message="This will clear the current conversation."
        confirmText="Start New"
      />
    </div>
  );
}

// Default export that wraps HomeContent with Suspense
export default function HomePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
      <HomeContent />
    </Suspense>
  );
}
