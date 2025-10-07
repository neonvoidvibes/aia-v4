"use client"

import React, { useState, useRef, useCallback, useEffect, useMemo, Suspense } from "react" // Added Suspense
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { PenSquare, ChevronDown, AlertTriangle, Eye, Loader2, History, Brain, FileClock, SlidersHorizontal, Waves, MessageCircle, Settings, Trash2, SquarePen, LogOut } from "lucide-react" // Added History, Brain, FileClock, Loader2, Trash2, SquarePen, LogOut
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
import { cn } from "@/lib/utils";
import { useLocalization } from "@/context/LocalizationContext";
import enTranslations from "@/lib/localization/en.json";
// Use both Dropdown and Sheet components
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
import { predefinedThemes, type ColorTheme } from "@/lib/themes"; // Import themes
import { useTheme } from "next-themes"; // Import useTheme
import CanvasView, { CANVAS_BACKGROUND_SRC } from "@/components/canvas-view";
import RecordView from "@/components/RecordView";
import { Switch } from "@/components/ui/switch"; 
import { Label } from "@/components/ui/label"; 
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"; 
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { VADSettings, type VADAggressiveness } from "@/components/VADSettings";
import AgentSelectorMenu from "@/components/ui/agent-selector";
import { EventSelectorContent } from "@/components/ui/event-selector";
import { MODEL_GROUPS } from "@/lib/model-map";
import AgentDashboard from "@/components/agent-dashboard"; // New import
import ConsentView from "@/components/consent-view"; // Phase 3 import
import { isRecordingPersistenceEnabled } from "@/lib/featureFlags";
import { manager as recordingManager } from "@/lib/recordingManager";
import { getCachedSession, invalidateSessionCache } from "@/lib/sessionCache";
import { debouncedSetItem, debouncedGetItem } from "@/lib/debouncedStorage";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

interface ChatHistoryItem {
  id: string;
  title:string;
  updatedAt: string;
  agentId: string;
  agentName: string;
  eventId?: string; // may be absent for legacy rows
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
      debouncedSetItem('lastUsedAgent', selectedAgent);
      router.push(`/?agent=${selectedAgent}&event=0000`);
    }
  };

  return (
    <div className="w-full flex items-center justify-center min-h-[calc(100dvh-var(--sys-banner-h))] bg-background px-4">
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
  const mainLayoutRef = useRef<HTMLDivElement>(null);
  const isInitialLoadRef = useRef(true);
  const searchParams = useSearchParams();
  const { theme, setTheme } = useTheme(); 

  const themeGroupSeparators = new Set([
    'theme-midnight-monochrome', // Dark themes
    'theme-river',             // Project themes
    'theme-forest-deep',        // Image themes
  ]);

  // VisualViewport handling: only apply height clamp for mobile keyboard, and subtract banner height.
  useEffect(() => {
    const vv = window.visualViewport
    const el = mainLayoutRef.current
    if (!vv || !el) return

    const apply = () => {
      const bannerH = (document.getElementById('service-banner')?.offsetHeight ?? 0)
      const keyboardOpen = vv.height < window.innerHeight - 120
      if (keyboardOpen) {
        el.style.height = `${Math.max(0, vv.height - bannerH)}px`
      } else {
        el.style.height = ''
      }
    }

    vv.addEventListener('resize', apply)
    window.addEventListener('sys-banner-change', apply as any)
    apply()
    return () => {
      vv.removeEventListener('resize', apply)
      window.removeEventListener('sys-banner-change', apply as any)
    }
  }, [])

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
  const [individualMemoryToggleStates, setIndividualMemoryToggleStates] = useState<Record<string, boolean>>({}); // Individual file toggle states
  const [individualRawTranscriptToggleStates, setIndividualRawTranscriptToggleStates] = useState<Record<string, boolean>>({});
  const [agentDocuments, setAgentDocuments] = useState<FetchedFile[]>([]);
  const [currentAgentTheme, setCurrentAgentTheme] = useState<string | undefined>(undefined);

  // State for view switching and layout
  const [currentView, setCurrentView] = useState<"chat" | "canvas" | "transcribe" | "record">("chat");
  const canvasDepth: 'mirror' = 'mirror';
  const layoutStyle = currentView === "canvas"
    ? ({
        backgroundImage: `url(${CANVAS_BACKGROUND_SRC})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat"
      } as React.CSSProperties)
    : undefined;
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  // Event menu state
  const [availableEvents, setAvailableEvents] = useState<string[] | null>(null);
  const [eventTypes, setEventTypes] = useState<Record<string, string>>({});
  const [, setAllowedEvents] = useState<string[] | null>(null);
  const [, setPersonalEventId] = useState<string | null>(null);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [eventFetchError, setEventFetchError] = useState<string | null>(null);
  const EVENTS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
  
  
  // State for new toggles in Documents tab
  const [transcriptListenMode, setTranscriptListenMode] = useState<"none" | "some" | "latest" | "all">("latest");
  const [savedTranscriptMemoryMode, setSavedTranscriptMemoryMode] = useState<"none" | "some" | "all">("none");
  const [transcriptionLanguage, setTranscriptionLanguage] = useState<"en" | "sv" | "any">("any"); // Default "any"
  const [vadAggressiveness, setVadAggressiveness] = useState<VADAggressiveness | null>(null);
  const [rawSavedS3Transcripts, setRawSavedS3Transcripts] = useState<FetchedFile[]>([]); // New state for raw saved transcripts
  const [groupsReadMode, setGroupsReadMode] = useState<'latest' | 'none' | 'all' | 'breakout'>('none'); // Groups read mode for event 0000

  // Fullscreen mode state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-5-20250929'); // Default model
  const [temperature, setTemperature] = useState(0.7); // Default temperature

  // Recording state lifted from SimpleChatInterface for fullscreen indicator
  const [recordingState, setRecordingState] = useState({
    isBrowserRecording: false,
    isBrowserPaused: false,
    clientRecordingTime: 0,
    isReconnecting: false
  });

  const [noteRecordingTime, setNoteRecordingTime] = useState(0);

  // State for chat history loading
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [showLoadingSpinner, setShowLoadingSpinner] = useState(false);
  const loadingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Effect to manage loading spinner visibility with a delay
  useEffect(() => {
    if (isChatLoading) {
      loadingTimerRef.current = setTimeout(() => {
        setShowLoadingSpinner(true);
      }, 1000); // 1-second delay
    } else {
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
      }
      setShowLoadingSpinner(false);
    }

    return () => {
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
      }
    };
  }, [isChatLoading]);

  // New global state for recording status
  type RecordingType = 'long-form-note' | 'long-form-chat' | 'press-to-talk' | null;

  type GlobalRecordingStatus = {
    isRecording: boolean;
    type: RecordingType;
  };

  const [globalRecordingStatus, setGlobalRecordingStatus] = useState<GlobalRecordingStatus>({
    isRecording: false,
    type: null,
  });

  const eventLabel = useCallback((e?: string | null) => (!e || e === '0000') ? 'Shared' : e, []);

  // Persistent Recording: attach/subscribe
  useEffect(() => {
    if (!isRecordingPersistenceEnabled()) return;
    const st = recordingManager.getState();
    if (st.sessionId) {
      recordingManager.attachToExisting(st.sessionId).catch(() => {});
    }
    const unsub = recordingManager.subscribe((s) => {
      const active = s.sessionId && (s.phase === 'starting' || s.phase === 'active' || s.phase === 'suspended');
      setGlobalRecordingStatus((prev) => ({
        isRecording: !!active,
        type: s.type === 'note' ? 'long-form-note' : s.type === 'chat' ? 'long-form-chat' : prev.type,
      }));
    });
    return () => { unsub(); };
  }, []);

  // State for S3 file viewer
  const [s3FileToView, setS3FileToView] = useState<{ s3Key: string; name: string; type: string } | null>(null);
  const [showS3FileViewer, setShowS3FileViewer] = useState(false);
  const [viewerFromSettings, setViewerFromSettings] = useState(false);

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
  const [isSidebarLocked, setIsSidebarLocked] = useState(false);
  const isSidebarLockedRef = useRef(isSidebarLocked);
  useEffect(() => {
    isSidebarLockedRef.current = isSidebarLocked;
  }, [isSidebarLocked]);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [chatIdToDelete, setChatIdToDelete] = useState<string | null>(null);

  // If user selects a chat that belongs to a different event/agent than the current URL,
  // store it here, navigate, and then load once the URL context matches.
  const [pendingChatToLoad, setPendingChatToLoad] = useState<{
    chatId: string;
    agentName: string;
    eventId: string;
  } | null>(null);
  const pendingLoadTriesRef = useRef(0);

  // State to track S3 keys of files currently being processed (saved to memory or archived)
  const [processingFileKeys, setProcessingFileKeys] = useState<Set<string>>(new Set());
  const [fileActionTypes, setFileActionTypes] = useState<Record<string, 'saving_to_memory' | 'archiving'>>({});
  const [agentCapabilities, setAgentCapabilities] = useState({ pinecone_index_exists: false });


  // Derived state to determine if any modal is currently open.
  // This will be passed to the chat interface to hide UI elements like the scroll-to-bottom button.
  const isAnyModalOpen =
    showSettings ||
    showNewChatConfirm ||
    showS3FileViewer ||
    showArchiveConfirmModal ||
    showSaveAsMemoryConfirmModal ||
    showForgetConfirmModal ||
    showDeleteConfirmation;

  const handleRecordingStateChange = useCallback((newState: {
    isBrowserRecording: boolean;
    isBrowserPaused: boolean;
    clientRecordingTime: number;
    isReconnecting: boolean;
  }) => {
    const wasRecording = recordingState.isBrowserRecording;
    setRecordingState(newState);
    
    if (newState.isBrowserRecording) {
      setGlobalRecordingStatus({
        type: 'long-form-chat',
        isRecording: true,
      });
      
      // Invalidate transcript cache when recording starts
      if (!wasRecording) {
        setTranscriptionS3Files([]);
        setFetchedDataFlags(prev => ({ ...prev, transcriptions: false }));
      }
    } else {
      // Only reset if the current global recording is a long-form chat
      setGlobalRecordingStatus(prev => prev.type === 'long-form-chat' ? {
        type: null,
        isRecording: false,
      } : prev);
    }
  }, [recordingState.isBrowserRecording]);


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
    agentDocuments: false,
  });

  const [pageAgentName, setPageAgentName] = useState<string | null>(null);
  const [pageEventId, setPageEventId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null); // Add state for user ID
  const [userName, setUserName] = useState<string | null>(null);
  const [allowedAgents, setAllowedAgents] = useState<string[]>([]);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showAgentDashboard, setShowAgentDashboard] = useState(false);
  const { setTranslations, setLanguage, t } = useLocalization();
  // Event labels mapping (from Supabase agents.event_labels)
  const [eventLabels, setEventLabels] = useState<Record<string, string>>({});
  // Events cache key (depends on pageAgentName) — defined after pageAgentName state
  const eventsCacheKey = useMemo(() => pageAgentName ? `events_cache_${pageAgentName}` : null, [pageAgentName]);
  
  // --- PHASE 3: New state management for dynamic workspaces ---
  const [permissionsData, setPermissionsData] = useState<{
    isAdminOverride: boolean;
    showAgentSelector: boolean;
    agents: Array<{
      name: string;
      workspaceId: string | null;
      workspaceName: string | null;
      workspaceUiConfig: any;
      language: string | null;
      capabilities: { pinecone_index_exists: boolean };
    }>;
    allAgentNames?: string[]; // For admin users - all visible agents
    workspaceConfigs: Record<string, any>;
    languageConfigs: Record<string, any>;
    userRole: string;
  } | null>(null);
  const [currentAgent, setCurrentAgent] = useState<string | null>(null);
  const [activeUiConfig, setActiveUiConfig] = useState<any>({});
  const [needsConsent, setNeedsConsent] = useState<{
    workspaceId: string;
    workspaceName: string;
  } | null>(null);
  const supabase = createClient();
  const router = useRouter();

  const fetchChatHistory = useCallback(async (agentToFetch: string) => {
    if (!agentToFetch || isSidebarLockedRef.current) return;
    
    setIsLoadingHistory(true);
    try {
      const { data: { session } } = await getCachedSession(supabase);
      if (!session?.access_token) return;

      const response = await fetchWithTimeout(`/api/chat/history/list?agentName=${encodeURIComponent(agentToFetch)}`, {
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
  }, [supabase.auth]);

  // Reset cached events when agent changes
  useEffect(() => {
    setAvailableEvents(null);
    setEventFetchError(null);
    setEventTypes({});
    setAllowedEvents(null);
    setPersonalEventId(null);
  }, [pageAgentName]);

  // Fetch event labels for the current agent (if present in Supabase)
  useEffect(() => {
    const run = async () => {
      if (!pageAgentName) { setEventLabels({}); return; }
      try {
        const res = await fetch(`/api/agents/event-labels?agentName=${encodeURIComponent(pageAgentName)}`);
        if (res.ok) {
          const data = await res.json();
          const labels = (data && typeof data === 'object' && data.event_labels) ? data.event_labels : data;
          if (labels && typeof labels === 'object') {
            setEventLabels(labels as Record<string, string>);
          } else {
            setEventLabels({});
          }
        } else {
          setEventLabels({});
        }
      } catch {
        setEventLabels({});
      }
    };
    run();
  }, [pageAgentName]);

  // Resolve display label for an event ID using Supabase-provided labels
  const labelForEvent = useCallback((e?: string | null) => {
    if (!e || e === '0000') return eventLabels['0000'] || t('sidebar.teamspace');
    return eventLabels[e] || e;
  }, [eventLabels, t]);

  const normalizeEventsOrder = useCallback((list: string[], types: Record<string, string>) => {
    const unique = Array.from(new Set(list));
    const personal = unique.filter(evt => types[evt] === 'personal').sort();
    const others = unique.filter(evt => evt !== '0000' && types[evt] !== 'personal').sort();
    const ordered = [...personal, '0000', ...others];
    return Array.from(new Set(ordered));
  }, []);

  /**
   * Split events into main vs breakout sections for the picker.
   * - Keep the existing high-level order: [personal..., '0000', others...]
   * - Within each section, we'll carve out type='breakout' into a separate array.
   * - We render a horizontal separator iff there is at least one breakout event.
   */
  const partitionedEvents = useMemo(() => {
    const list = availableEvents ?? [];
    const main: string[] = [];
    const breakout: string[] = [];

    // Split into main vs breakout while preserving the original order
    for (const id of list) {
      if (eventTypes[id] === 'breakout') breakout.push(id);
      else main.push(id);
    }

    // Sort breakout events alphabetically by label
    const label = (id: string) => labelForEvent(id).toLowerCase();
    breakout.sort((a, b) => label(a).localeCompare(label(b)));

    // Keep main in the original order (already sorted as personal, '0000', others)
    return { main, breakout };
  }, [availableEvents, eventTypes, labelForEvent]);

  // Proactively fetch events when agent is available (prevents hidden dropdown due to empty chat history)
  useEffect(() => {
    if (pageAgentName) {
      fetchAvailableEvents().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageAgentName]);

  // Event visibility helpers (place after chatHistory/pageAgentName vars are declared)
  const hasMultipleEvents = useMemo(() => {
    if (availableEvents) {
      const list = availableEvents;
      return list.length > 1 || (list.length === 1 && list[0] !== '0000');
    }
    // Fallback: infer from URL or chat history
    if (pageEventId && pageEventId !== '0000') return true;
    const events = Array.from(new Set((chatHistory || []).map(c => c.eventId || '0000')));
    return events.length > 1 || (events.length === 1 && events[0] !== '0000');
  }, [availableEvents, chatHistory, pageEventId]);

  // ikea-pilot override: always show the event dropdown for this workspace/agent
  const shouldShowEventDropdown = useMemo(() => {
    if (pageAgentName === 'ikea-pilot') return true;
    return hasMultipleEvents && !!pageEventId;
  }, [pageAgentName, hasMultipleEvents, pageEventId]);

  // ikea-pilot override: always listen to all transcripts and all memory
  useEffect(() => {
    if (pageAgentName === 'ikea-pilot') {
      setTranscriptListenMode('all');
      setSavedTranscriptMemoryMode('all');
    }
  }, [pageAgentName]);

  const fetchAvailableEvents = useCallback(async () => {
    if (!pageAgentName || isLoadingEvents) return;
    setIsLoadingEvents(true);
    setEventFetchError(null);
    let cacheEventTypes: Record<string, string> | undefined;
    let cacheAllowedEvents: string[] | undefined;
    let cachePersonalEventId: string | null | undefined;
    try {
      // Seed from local cache (fast path)
      if (eventsCacheKey) {
        try {
          const raw = debouncedGetItem(eventsCacheKey);
          if (raw) {
            const cached = JSON.parse(raw) as {
              events: string[];
              eventTypes?: Record<string, string>;
              allowedEvents?: string[];
              personalEventId?: string | null;
              ts: number;
            };
            if (cached?.events && Array.isArray(cached.events)) {
              const fresh = Date.now() - (cached.ts || 0) < EVENTS_CACHE_TTL_MS;
              if (fresh) {
                setAvailableEvents(cached.events);
                setEventTypes(cached.eventTypes || {});
                setAllowedEvents(Array.isArray(cached.allowedEvents) ? cached.allowedEvents : null);
                setPersonalEventId(cached.personalEventId ?? null);
                cacheEventTypes = cached.eventTypes;
              }
            }
          }
        } catch {}
      }

      // Authoritative fetch via proxy route
      let ok = false;
      let events: string[] = [];
      const res = await fetch(`/api/s3-proxy/list-events?agentName=${encodeURIComponent(pageAgentName)}`);
      if (res.ok) {
        const data: {
          events?: string[];
          eventTypes?: Record<string, string>;
          allowedEvents?: string[];
          personalEventId?: string | null;
        } = await res.json();
        const incomingEvents = Array.from(new Set([...(data.events || [])]));
        const incomingTypes = (data.eventTypes && typeof data.eventTypes === 'object') ? data.eventTypes : {};
        events = normalizeEventsOrder(incomingEvents, incomingTypes);
        const okTypes = data.eventTypes ?? cacheEventTypes ?? {};

        setAvailableEvents(events);
        setEventTypes(okTypes);
        setAllowedEvents(Array.isArray(data.allowedEvents) ? data.allowedEvents : null);
        setPersonalEventId(data.personalEventId ?? null);
        ok = true;

        // Update cache
        if (eventsCacheKey) {
          try {
            debouncedSetItem(eventsCacheKey, JSON.stringify({
              events,
              eventTypes: okTypes,
              allowedEvents: data.allowedEvents ?? null,
              personalEventId: data.personalEventId ?? null,
              ts: Date.now(),
            }));
          } catch {}
        }
      } else if (res.status === 404) {
        // Fallback for older backends: list by prefix and derive event IDs
        const fallbackPrefix = `organizations/river/agents/${pageAgentName}/events/`;
        const res2 = await fetch(`/api/s3-proxy/list?prefix=${encodeURIComponent(fallbackPrefix)}`);
        if (!res2.ok) {
          const t2 = await res2.text().catch(() => '');
          throw new Error(t2 || `Failed to list events via fallback (${res2.status})`);
        }
        const files: Array<{ s3Key?: string; Key?: string }> = await res2.json();
        const setEv = new Set<string>();
        for (const f of files || []) {
          const key = (f as any).s3Key || (f as any).Key || '';
          const idx = key.indexOf('/events/');
          if (idx >= 0) {
            const tail = key.substring(idx + '/events/'.length);
            const ev = tail.split('/')[0];
            if (ev) setEv.add(ev);
          }
        }
        events = normalizeEventsOrder(Array.from(setEv), fallbackTypes);
        const fallbackTypes: Record<string, string> = {};
        for (const evt of events) {
          fallbackTypes[evt] = evt.startsWith('p_') ? 'personal' : 'group';
        }
        fallbackTypes['0000'] = 'shared';
        const fallbackAllowed = Array.from(new Set([...setEv, '0000']));
        setEventTypes(fallbackTypes);
        setAllowedEvents(fallbackAllowed);
        setPersonalEventId(prev => (prev && events.includes(prev)) ? prev : null);
        cacheEventTypes = fallbackTypes;
        cacheAllowedEvents = fallbackAllowed;
        cachePersonalEventId = null;
        ok = true;
      } else {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Failed to list events (${res.status})`);
      }

      if (ok) {
        setAvailableEvents(events);
        const normalizedCurrent = pageEventId || '0000';
        if (!events.includes(normalizedCurrent)) {
          const fallbackEvent = events.includes('0000') ? '0000' : (events[0] || '0000');
          router.replace(`/?agent=${encodeURIComponent(pageAgentName)}&event=${encodeURIComponent(fallbackEvent)}`);
        }
      }
    } catch (e: any) {
      console.error('Failed to fetch events from S3:', e);
      setEventFetchError(e?.message || 'Failed to load events');
      setAvailableEvents([]);
    } finally {
      setIsLoadingEvents(false);
    }
  }, [pageAgentName, pageEventId, router, isLoadingEvents, eventsCacheKey]);

  const personalMenuEvents = useMemo(
    () => (availableEvents || []).filter(ev => eventTypes[ev] === 'personal'),
    [availableEvents, eventTypes],
  );

  const groupMenuEvents = useMemo(
    () => (availableEvents || []).filter(ev => ev !== '0000' && eventTypes[ev] !== 'personal'),
    [availableEvents, eventTypes],
  );

  const renderEventMenuItems = useCallback(() => {
    const items: React.ReactNode[] = [];
    if (personalMenuEvents.length > 0) {
      personalMenuEvents.forEach(ev => {
        items.push(
          <DropdownMenuRadioItem key={`personal-${ev}`} value={ev}>
            {labelForEvent(ev)}
          </DropdownMenuRadioItem>,
        );
      });
      items.push(<DropdownMenuSeparator key="sep-after-personal" />);
    }

    items.push(
      <DropdownMenuRadioItem key="event-0000" value="0000">
        {labelForEvent('0000')}
      </DropdownMenuRadioItem>,
    );

    const showTrailingSection = isLoadingEvents || !!eventFetchError || groupMenuEvents.length > 0;
    if (showTrailingSection) {
      items.push(<DropdownMenuSeparator key="sep-after-0000" />);
      if (isLoadingEvents) {
        items.push(
          <DropdownMenuRadioItem key="events-loading" value={pageEventId || '0000'} disabled>
            Loading events...
          </DropdownMenuRadioItem>,
        );
      } else if (eventFetchError) {
        items.push(
          <DropdownMenuRadioItem key="events-error" value={pageEventId || '0000'} disabled>
            {eventFetchError}
          </DropdownMenuRadioItem>,
        );
      } else {
        groupMenuEvents.forEach(ev => {
          items.push(
            <DropdownMenuRadioItem key={`group-${ev}`} value={ev}>
              {labelForEvent(ev)}
            </DropdownMenuRadioItem>,
          );
        });
      }
    }

    return items;
  }, [personalMenuEvents, groupMenuEvents, isLoadingEvents, eventFetchError, pageEventId, labelForEvent]);

  const [showSwitchWhileRecordingConfirm, setShowSwitchWhileRecordingConfirm] = useState(false);
  const [pendingEventId, setPendingEventId] = useState<string | null>(null);

  const handleEventChange = useCallback((newEventId: string) => {
    if (!pageAgentName) return;
    if (globalRecordingStatus.isRecording) {
      setPendingEventId(newEventId);
      setShowSwitchWhileRecordingConfirm(true);
      return;
    }
    router.push(`/?agent=${encodeURIComponent(pageAgentName)}&event=${encodeURIComponent(newEventId)}`);
  }, [router, pageAgentName, globalRecordingStatus.isRecording]);

  // After switching URL to the conversation's original agent/event, load that chat
  useEffect(() => {
    let cancelled = false;
    const attempt = async () => {
      if (cancelled) return;
      if (!pendingChatToLoad) return;

      const { chatId, agentName: targetAgent, eventId: targetEvent } = pendingChatToLoad;
      const currentEvent = pageEventId || '0000';
      const contextReady = (pageAgentName === targetAgent) && (currentEvent === (targetEvent || '0000'));
      if (!contextReady) return; // wait until URL context matches

      if (!chatInterfaceRef.current) {
        // Child not ready yet; retry shortly (max ~4.5s)
        if (pendingLoadTriesRef.current < 30) {
          pendingLoadTriesRef.current += 1;
          setTimeout(attempt, 150);
        } else {
          console.warn('[Deferred Load] Gave up waiting for chat interface to mount');
          setPendingChatToLoad(null);
        }
        return;
      }

      setIsChatLoading(true);
      try {
        await chatInterfaceRef.current.loadChatHistory(chatId);
        setCurrentChatId(chatId);
        setCurrentView('chat');
        setPendingChatToLoad(null);
      } catch (e) {
        console.warn('[Deferred Load] Failed to load chat after context switch', e);
        // Retry a few times in case backend/cache not ready yet
        if (pendingLoadTriesRef.current < 10) {
          pendingLoadTriesRef.current += 1;
          setTimeout(attempt, 250);
        } else {
          setPendingChatToLoad(null);
        }
      } finally {
        setIsChatLoading(false);
      }
    };

    // kick off attempts when deps change
    pendingLoadTriesRef.current = 0;
    attempt();
    return () => { cancelled = true; };
  }, [pageAgentName, pageEventId, pendingChatToLoad]);

  useEffect(() => {
    if (historyNeedsRefresh && pageAgentName) {
      fetchChatHistory(pageAgentName).then(() => {
        setHistoryNeedsRefresh(false);
      });
    }
  }, [historyNeedsRefresh, pageAgentName, fetchChatHistory]);

  useEffect(() => {
    const agentParam = searchParams.get('agent');
    const eventParam = searchParams.get('event');

    if (pageAgentName !== agentParam || pageEventId !== eventParam) {
      // Clear fetched flags so new agent/event data reloads
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
        agentDocuments: false,
      });
      // Reset transcript-related caches to avoid cross-agent leakage
      setTranscriptionS3Files([]);
      setSavedTranscriptSummaries([]);
      setRawSavedS3Transcripts([]);
      setIndividualRawTranscriptToggleStates({});
      setChatHistory([]);
    }

    console.log('[VAD] Setting pageAgentName:', agentParam);
    setPageAgentName(agentParam);
    setPageEventId(eventParam);

    const checkAuthAndPermissions = async () => {
      setIsAuthorized(null);
      setAuthError(null);

      try {
        const { data: { session }, error: sessionError } = await getCachedSession(supabase);

        if (sessionError || !session) {
          // This case should be handled by middleware, but as a fallback:
          console.error("Authorization Check: No active session found.", sessionError);
          setAuthError("Not authenticated.");
          router.push('/login');
          return;
        }

        // Phase 2 optimization: Set authorized immediately after session validation
        // This unblocks the UI while we fetch capabilities in the background
        setIsAuthorized(true);

        const response = await fetchWithTimeout('/api/user/permissions', {
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        }, 10000); // 10s timeout for permissions fetch

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
        
        // --- PHASE 3: Store the rich permissions data ---
        setPermissionsData(data);
        
        // Legacy support for existing code
        const fetchedAllowedAgents: { name: string, capabilities: { pinecone_index_exists: boolean } }[] = data.allowedAgents || [];
        const agentNames = fetchedAllowedAgents.map(a => a.name);
        setAllowedAgents(agentNames);
        setUserRole(data.userRole || 'user');

        const name = session.user?.user_metadata?.full_name || session.user?.email || 'Unknown User';
        setUserName(name);
        console.log('[VAD] Setting userId:', session.user.id);
        setUserId(session.user.id); // Set the user ID
        try {
          // Expose current user id for client-only components that need per-user persistence
          debouncedSetItem('currentUserId', session.user.id);
        } catch {}

        if (agentParam) {
          // Agent is in URL, validate it
          if (agentNames.includes(agentParam)) {
            console.log(`Authorization Check: Access GRANTED for agent '${agentParam}'.`);
            debouncedSetItem('lastUsedAgent', agentParam);
            
            // --- PHASE 3: Set current agent and check for consent ---
            setCurrentAgent(agentParam);
            const agentData = data.agents.find((a: any) => a.name === agentParam);
            
            if (agentData && agentData.workspaceId && agentData.workspaceUiConfig.require_consent) {
              // Check if user has consented to this workspace
              try {
                const consentResponse = await fetchWithTimeout(`/api/user/consent?workspaceId=${agentData.workspaceId}`, {}, 5000);
                if (consentResponse.ok) {
                  const consentData = await consentResponse.json();
                  if (!consentData.hasConsented) {
                    setNeedsConsent({
                      workspaceId: agentData.workspaceId,
                      workspaceName: agentData.workspaceName || 'Workspace'
                    });
                    return;
                  }
                }
              } catch (consentError) {
                console.warn('Error checking consent:', consentError);
              }
            }
            
            const currentAgentData = fetchedAllowedAgents.find(a => a.name === agentParam);
            if (currentAgentData) {
              setAgentCapabilities(currentAgentData.capabilities);
            }
            setIsAuthorized(true);

            console.log(`[Backend Prefetch] Warming up backend URL cache...`);
            fetchWithTimeout('/api/backend/prefetch', {}, 5000).catch(err => {
              console.warn('[Backend Prefetch] Failed:', err);
            });

            console.log(`[Cache Warmer] Triggering pre-caching for agent '${agentParam}'...`);
            fetchWithTimeout('/api/agent/warm-up', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
              body: JSON.stringify({ agent: agentParam, event: eventParam || '0000' })
            }, 5000).catch(err => {
              console.warn('[Cache Warmer] Failed:', err);
            });

            fetchChatHistory(agentParam);
          } else {
            console.warn(`Authorization Check: Access DENIED for agent '${agentParam}'.`);
            setAuthError(`You do not have permission to access the agent specified in the URL ('${agentParam}').`);
            setIsAuthorized(false);
          }
        } else {
          // No agent in URL, check localStorage for last used agent
          const lastUsedAgent = debouncedGetItem('lastUsedAgent');
          if (lastUsedAgent && agentNames.includes(lastUsedAgent)) {
            console.log(`Redirecting to last used agent: ${lastUsedAgent}`);
            router.push(`/?agent=${lastUsedAgent}&event=0000`);
            // The component will re-render with the new URL, so we don't need to set isAuthorized here.
          } else {
            // No valid last used agent, show the selector
            console.log("Authorization Check: User authenticated, no valid last agent. Will show selector.");
            setCurrentAgent(null);
            setIsAuthorized(true);

            console.log(`[Backend Prefetch] Warming up backend URL cache...`);
            fetchWithTimeout('/api/backend/prefetch', {}, 5000).catch(err => {
              console.warn('[Backend Prefetch] Failed:', err);
            });
          }
        }
      } catch (error) {
        console.error("Authorization Check: Error during permission flow:", error);
        const message = error instanceof Error ? error.message : "An unknown error occurred while checking permissions.";
        setAuthError(message);
        // Phase 2: Don't block UI for capability fetch failures
        // User has valid session, just couldn't load capabilities
        // isAuthorized remains true from line 887
      }
    };

    checkAuthAndPermissions();
  }, [searchParams, supabase.auth, router, pageAgentName, pageEventId, fetchChatHistory]);

  // --- PHASE 3: Dynamic UI config updates ---
  useEffect(() => {
    if (permissionsData && currentAgent) {
      const agentData = permissionsData.agents.find(a => a.name === currentAgent);
      if (agentData) {
        if (agentData.workspaceId && permissionsData.workspaceConfigs[agentData.workspaceId]) {
          const workspaceConfig = permissionsData.workspaceConfigs[agentData.workspaceId];
          setActiveUiConfig(workspaceConfig);

          // Apply workspace theme override (workspace > user > system)
          if (workspaceConfig.theme_override) {
            setTheme(workspaceConfig.theme_override);
            setCurrentAgentTheme(workspaceConfig.theme_override);
          }
          // Apply workspace model override if provided
          if (workspaceConfig.default_model) {
            setSelectedModel(workspaceConfig.default_model);
          }
          // Apply workspace transcript + summary overrides if provided
          const tlm = workspaceConfig.default_transcript_listen_mode;
          if (tlm === 'none' || tlm === 'some' || tlm === 'latest' || tlm === 'all') {
            setTranscriptListenMode(tlm);
          }
          const smm = workspaceConfig.default_saved_transcript_memory_mode;
          if (smm === 'none' || smm === 'some' || smm === 'all') {
            setSavedTranscriptMemoryMode(smm);
          }
        } else {
          setActiveUiConfig({});
        }

        // Update language translations
        const langCode = agentData.language || 'en';
        const langConfig = permissionsData.languageConfigs?.[langCode] || {};
        setTranslations({ ...enTranslations, ...langConfig });
        setLanguage(langCode);
      }
    } else {
      setActiveUiConfig({});
    }
  }, [permissionsData, currentAgent, setTheme, setTranslations, setLanguage]);

  // --- PHASE 3: Handle consent completion ---
  const handleConsentGiven = () => {
    setNeedsConsent(null);
    // Re-run authorization check to proceed with the agent
    if (currentAgent) {
      setIsAuthorized(true);
    }
  };

  // Refs
  const tabContentRef = useRef<HTMLDivElement>(null);
  const chatInterfaceRef = useRef<ChatInterfaceHandle>(null);
  const memoryTabRef = useRef<HTMLDivElement>(null);
  const isMobile = useMobile();

  useEffect(() => {
    if (historyNeedsRefresh && pageAgentName) {
      fetchChatHistory(pageAgentName).then(() => {
        setHistoryNeedsRefresh(false);
      });
    }
  }, [historyNeedsRefresh, pageAgentName, fetchChatHistory]);

  // Removed: avoid re-fetching history on every sidebar open to prevent flicker

  const handleDeleteInitiated = (chatId: string) => {
    setChatIdToDelete(chatId);
    setShowDeleteConfirmation(true);
  };

  const handleDeleteConfirm = async () => {
    if (!chatIdToDelete) return;

    setIsSidebarLocked(true); // Lock the sidebar from refreshing

    const originalChatHistory = [...chatHistory];
    const chatToDelete = chatHistory.find(chat => chat.id === chatIdToDelete);
    const isDeletingCurrentChat = chatIdToDelete === currentChatId;

    // Optimistic UI updates
    setChatHistory(prev => prev.filter(chat => chat.id !== chatIdToDelete));
    setShowDeleteConfirmation(false);

    // If deleting the current chat, clear the main window IMMEDIATELY
    if (isDeletingCurrentChat) {
        chatInterfaceRef.current?.startNewChat({ suppressRefresh: true });
        setCurrentChatId(null);
    }

    try {
        const { data: { session } } = await getCachedSession(supabase);
        if (!session?.access_token) {
            throw new Error("Authentication error. Cannot delete chat.");
        }

        const response = await fetchWithTimeout(`/api/chat/history/delete`, {
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
        
        // After successful deletion, queue a refresh for when the lock is released.
        setHistoryNeedsRefresh(true);

    } catch (error: any) {
        console.error('Failed to delete chat history:', error);
        toast.error(`Failed to delete conversation: ${error.message}. Restoring.`);
        
        // Rollback UI on failure
        setChatHistory(originalChatHistory);

        // If deletion of the current chat fails, we need to reload it,
        // since we optimistically cleared it.
        if (isDeletingCurrentChat && chatToDelete) {
          if (chatInterfaceRef.current) {
            chatInterfaceRef.current.loadChatHistory(chatToDelete.id);
            setCurrentChatId(chatToDelete.id);
            setIsConversationSaved(chatToDelete.isConversationSaved || false);
          }
        }
    } finally {
        setIsSidebarLocked(false); // Unlock the sidebar
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

  const startNewChatFlow = async () => {
    console.log("Starting new chat flow");
    setIsChatLoading(true);
    try {
      await chatInterfaceRef.current?.startNewChat();
      setCurrentChatId(null);
      setCurrentView('chat');
    } catch (error) {
      console.error("Error starting new chat flow:", error);
      toast.error("Failed to start a new chat.");
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleNewChatRequest = () => {
    if (chatInterfaceRef.current && chatInterfaceRef.current.getMessagesCount() > 0) {
      setShowNewChatConfirm(true);
    } else {
      console.log("No messages, starting new chat directly");
      startNewChatFlow();
    }
  };

  const handleIndividualMemoryToggleChange = (checked: boolean, fileKey: string) => {
    // When a user touches an individual toggle, we derive the new mode from the resulting toggles state.
    let currentStates = { ...individualMemoryToggleStates };

    // If we were in 'all' mode, we need to "materialize" the state first before applying the change.
    if (savedTranscriptMemoryMode === 'all') {
      currentStates = {}; // Start fresh
      savedTranscriptSummaries.forEach(f => { if(f.s3Key) currentStates[f.s3Key] = true; });
    }
    
    // Now, apply the user's change to the materialized or existing state
    currentStates[fileKey] = checked;
    
    // Finally, derive and set the new mode and state based on this new state.
    const toggledOnCount = Object.values(currentStates).filter(v => v).length;
    const totalFiles = savedTranscriptSummaries.length;

    if (totalFiles > 0 && toggledOnCount === totalFiles) {
      setSavedTranscriptMemoryMode('all');
      setIndividualMemoryToggleStates({}); // Clean up individual state for 'all'
    } else if (toggledOnCount > 0) {
      setSavedTranscriptMemoryMode('some');
      setIndividualMemoryToggleStates(currentStates);
    } else {
      setSavedTranscriptMemoryMode('none');
      setIndividualMemoryToggleStates({}); // Clean up individual state for 'none'
    }
  };

  const handleIndividualRawTranscriptToggleChange = (checked: boolean, fileKey: string) => {
    // When a user touches an individual toggle, we derive the new mode.
    let currentStates = { ...individualRawTranscriptToggleStates };

    // If we were in 'all' or 'latest' mode, "materialize" the current state first.
    if (transcriptListenMode === 'all') {
      currentStates = {}; // Start fresh
      transcriptionS3Files.forEach(f => { if(f.s3Key) currentStates[f.s3Key] = true; });
    } else if (transcriptListenMode === 'latest') {
      currentStates = {}; // Start fresh
      const latestKey = transcriptionS3Files[0]?.s3Key;
      if (latestKey) currentStates[latestKey] = true;
    }

    // Apply the user's change.
    currentStates[fileKey] = checked;

    // Derive and set the new mode based on the result.
    const toggledOnCount = Object.values(currentStates).filter(v => v).length;
    const totalFiles = transcriptionS3Files.length;
    const latestFileKey = transcriptionS3Files[0]?.s3Key;

    if (totalFiles > 0 && toggledOnCount === totalFiles) {
      setTranscriptListenMode('all');
      setIndividualRawTranscriptToggleStates({});
    } else if (toggledOnCount === 1 && latestFileKey && currentStates[latestFileKey]) {
      setTranscriptListenMode('latest');
      setIndividualRawTranscriptToggleStates({}); // 'latest' is also a primary mode
    } else if (toggledOnCount > 0) {
      setTranscriptListenMode('some');
      setIndividualRawTranscriptToggleStates(currentStates);
    } else {
      setTranscriptListenMode('none');
      setIndividualRawTranscriptToggleStates({});
    }
  };

  const confirmAndStartNewChat = () => {
    console.log("Modal confirmed, starting new chat flow");
    startNewChatFlow();
    setShowNewChatConfirm(false);
  };

  const handleNewChatFromSidebar = () => {
    console.log("New chat requested from sidebar, starting flow");
    startNewChatFlow();
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
      // If workspace enforces a theme, ignore user selection
      if (activeUiConfig?.theme_override) {
        setTheme(activeUiConfig.theme_override);
        setCurrentAgentTheme(activeUiConfig.theme_override);
        return;
      }
      if (pageAgentName && userId) {
        const agentThemeKey = `agent-theme-${pageAgentName}_${userId}`;
        debouncedSetItem(agentThemeKey, newThemeValue);
        if (predefinedThemes.some(t => t.className === newThemeValue)) {
            debouncedSetItem(`agent-custom-theme-${pageAgentName}_${userId}`, newThemeValue);
        } else {
            localStorage.removeItem(`agent-custom-theme-${pageAgentName}_${userId}`);
        }
        setTheme(newThemeValue);
        setCurrentAgentTheme(newThemeValue);
      }
  }, [pageAgentName, userId, setTheme, activeUiConfig?.theme_override]);

  useEffect(() => {
    if (pageAgentName && userId) {
      // If workspace enforces a theme, apply and skip user override
      if (activeUiConfig?.theme_override) {
        setTheme(activeUiConfig.theme_override);
        setCurrentAgentTheme(activeUiConfig.theme_override);
        return;
      }
      const perUserKey = `agent-theme-${pageAgentName}_${userId}`;
      const legacyKey = `agent-theme-${pageAgentName}`;
      let savedAgentTheme = debouncedGetItem(perUserKey);

      // Migrate legacy, agent-only saved theme if present
      if (!savedAgentTheme) {
        const legacy = debouncedGetItem(legacyKey);
        if (legacy) {
          try { debouncedSetItem(perUserKey, legacy); } catch {}
          savedAgentTheme = legacy;
        }
      }

      if (savedAgentTheme) {
        setTheme(savedAgentTheme);
        setCurrentAgentTheme(savedAgentTheme);
        if (predefinedThemes.some(t => t.className === savedAgentTheme)) {
          debouncedSetItem(`agent-custom-theme-${pageAgentName}_${userId}`, savedAgentTheme);
        }
      } else {
        // No saved theme for this agent+user: default to System
        setTheme('system');
        setCurrentAgentTheme('system');
      }
    }
  }, [pageAgentName, userId, setTheme, activeUiConfig?.theme_override]);

  // Enforce transcriptListenMode from workspace if provided; otherwise use saved or fallback
  useEffect(() => {
    if (pageAgentName && userId) {
      const key = `transcriptListenModeSetting_${pageAgentName}_${userId}`;
      const canOverrideSettings = !activeUiConfig?.hide_sidebar_links?.includes('settings') || permissionsData?.isAdminOverride;
      const enforced = activeUiConfig?.default_transcript_listen_mode;

      // If workspace has default AND user cannot override (no Settings access), enforce it
      if ((enforced === 'none' || enforced === 'some' || enforced === 'latest' || enforced === 'all') && !canOverrideSettings) {
        setTranscriptListenMode(enforced);
        return;
      }

      // Otherwise, check localStorage for saved preference
      const savedMode = debouncedGetItem(key);
      if (savedMode === 'none' || savedMode === 'some' || savedMode === 'latest' || savedMode === 'all') {
        setTranscriptListenMode(savedMode as any);
      } else if (enforced === 'none' || enforced === 'some' || enforced === 'latest' || enforced === 'all') {
        // No saved preference but workspace has default - use it as initial value
        setTranscriptListenMode(enforced);
      } else {
        setTranscriptListenMode('latest');
      }
    }
  }, [pageAgentName, userId, activeUiConfig, permissionsData?.isAdminOverride]);

  // Persist transcriptListenMode on any change (unless workspace enforces it for users without Settings access)
  useEffect(() => {
    if (!pageAgentName || !userId) return;
    const canOverrideSettings = !activeUiConfig?.hide_sidebar_links?.includes('settings') || permissionsData?.isAdminOverride;
    const enforced = activeUiConfig?.default_transcript_listen_mode;

    // Only prevent saving if workspace enforces AND user cannot override
    if ((enforced === 'none' || enforced === 'some' || enforced === 'latest' || enforced === 'all') && !canOverrideSettings) return;

    const key = `transcriptListenModeSetting_${pageAgentName}_${userId}`;
    try { debouncedSetItem(key, transcriptListenMode); } catch {}
  }, [transcriptListenMode, pageAgentName, userId, activeUiConfig, permissionsData?.isAdminOverride]);


  // Enforce savedTranscriptMemoryMode from workspace if provided; otherwise use saved or fallback
  useEffect(() => {
    if (pageAgentName && userId) {
      // ikea-pilot workspace override: always listen to all memory (highest priority)
      if (pageAgentName === 'ikea-pilot') {
        setSavedTranscriptMemoryMode('all');
        return;
      }
      const enforced = activeUiConfig?.default_saved_transcript_memory_mode;
      if (enforced === 'none' || enforced === 'some' || enforced === 'all') {
        setSavedTranscriptMemoryMode(enforced);
        return;
      }
      const key = `savedTranscriptMemoryModeSetting_${pageAgentName}_${userId}`;
      const savedMode = debouncedGetItem(key);
      if (savedMode === 'none' || savedMode === 'some' || savedMode === 'all') {
        setSavedTranscriptMemoryMode(savedMode as any);
      } else {
        setSavedTranscriptMemoryMode('none');
      }
    }
  }, [pageAgentName, userId, activeUiConfig]);

  useEffect(() => {
    if (pageAgentName && userId) {
      // ikea-pilot workspace override: don't save to localStorage
      if (pageAgentName === 'ikea-pilot') return;
      const key = `savedTranscriptMemoryModeSetting_${pageAgentName}_${userId}`;
      debouncedSetItem(key, savedTranscriptMemoryMode);
    }
  }, [savedTranscriptMemoryMode, pageAgentName, userId]);

  // Load and persist individual memory toggle states (agent-specific)
  useEffect(() => {
    if (pageAgentName && userId) {
      const key = `individualMemoryToggleStates_${pageAgentName}_${userId}`;
      const savedStates = debouncedGetItem(key);
      if (savedStates) {
        try {
          const parsedStates = JSON.parse(savedStates);
          setIndividualMemoryToggleStates(parsedStates);
        } catch (error) {
          console.error('Error parsing individual memory toggle states:', error);
          setIndividualMemoryToggleStates({});
        }
      }
    }
  }, [pageAgentName, userId]);

  useEffect(() => {
    if (pageAgentName && userId && Object.keys(individualMemoryToggleStates).length > 0) {
      const key = `individualMemoryToggleStates_${pageAgentName}_${userId}`;
      debouncedSetItem(key, JSON.stringify(individualMemoryToggleStates));
    }
  }, [individualMemoryToggleStates, pageAgentName, userId]);

  // Load groupsReadMode from Supabase and localStorage
  useEffect(() => {
    if (!pageAgentName || !userId) return;

    const loadGroupsReadMode = async () => {
      // First check localStorage for immediate effect
      const localKey = `groupsReadMode_${pageAgentName}_${userId}`;
      const localValue = debouncedGetItem(localKey);
      if (localValue && ['latest', 'none', 'all'].includes(localValue)) {
        setGroupsReadMode(localValue as 'latest' | 'none' | 'all');
      }

      // Then fetch from Supabase as source of truth
      try {
        const response = await fetch(`/api/agents/memory-prefs?agent=${encodeURIComponent(pageAgentName)}`);
        if (response.ok) {
          const data = await response.json();
          const dbValue = data.groups_read_mode || 'none';
          setGroupsReadMode(dbValue);
          debouncedSetItem(localKey, dbValue);
        }
      } catch (error) {
        console.error('Error loading groups read mode:', error);
      }
    };

    loadGroupsReadMode();
  }, [pageAgentName, userId]);

  // Persist groupsReadMode changes to Supabase and localStorage
  const handleGroupsReadModeChange = useCallback(async (mode: 'latest' | 'none' | 'all' | 'breakout') => {
    if (!pageAgentName || !userId) return;

    setGroupsReadMode(mode);

    // Persist to localStorage immediately
    const localKey = `groupsReadMode_${pageAgentName}_${userId}`;
    debouncedSetItem(localKey, mode);

    // Persist to Supabase
    try {
      const response = await fetch('/api/agents/memory-prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: pageAgentName,
          groups_read_mode: mode
        })
      });

      if (!response.ok) {
        console.error('Failed to save groups read mode to Supabase');
        toast.error('Failed to save preference');
      } else {
        const modeText = mode === 'none' ? 'disabled' : mode === 'latest' ? 'latest' : mode === 'all' ? 'all' : 'breakout';
        toast.success(`Transcript read mode: ${modeText}`);
      }
    } catch (error) {
      console.error('Error saving groups read mode:', error);
      toast.error('Failed to save preference');
    }
  }, [pageAgentName, userId]);

  // Mark initial load as complete after localStorage has been loaded
  useEffect(() => {
    if (pageAgentName && userId) {
      // Reset flag when agent changes
      isInitialLoadRef.current = true;
      // Set a small timeout to ensure all localStorage effects have run
      const timer = setTimeout(() => {
        isInitialLoadRef.current = false;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [pageAgentName, userId]);

  // Auto-switch memory mode to 'some' when an individual toggle is turned on
  useEffect(() => {
    // Skip during initial load to prevent overriding localStorage values
    if (isInitialLoadRef.current) return;

    const hasTogglesOn = Object.values(individualMemoryToggleStates).some(v => v);
    if (hasTogglesOn && savedTranscriptMemoryMode === 'none') {
      setSavedTranscriptMemoryMode('some');
    } else if (!hasTogglesOn && savedTranscriptMemoryMode === 'some') {
      // If the user turns off the last toggle, revert to 'none'
      setSavedTranscriptMemoryMode('none');
    }
  }, [individualMemoryToggleStates, savedTranscriptMemoryMode]);


  useEffect(() => {
    if (savedTranscriptMemoryMode === 'some' && savedTranscriptSummaries.length > 0) {
      const allToggled = savedTranscriptSummaries.every(file => file.s3Key && individualMemoryToggleStates[file.s3Key]);
      if (allToggled) {
        setSavedTranscriptMemoryMode('all');
        setIndividualMemoryToggleStates({});
      }
    }
  }, [individualMemoryToggleStates, savedTranscriptSummaries, savedTranscriptMemoryMode]);

  // Load and persist individual raw transcript toggle states (agent-specific)
  useEffect(() => {
    if (pageAgentName && userId) {
      const key = `individualRawTranscriptToggleStates_${pageAgentName}_${userId}`;
      const savedStates = debouncedGetItem(key);
      if (savedStates) {
        try {
          const parsedStates = JSON.parse(savedStates);
          setIndividualRawTranscriptToggleStates(parsedStates);
        } catch (error) {
          console.error('Error parsing individual raw transcript toggle states:', error);
          setIndividualRawTranscriptToggleStates({});
        }
      }
    }
  }, [pageAgentName, userId]);

  useEffect(() => {
    if (pageAgentName && userId && Object.keys(individualRawTranscriptToggleStates).length > 0) {
      const key = `individualRawTranscriptToggleStates_${pageAgentName}_${userId}`;
      debouncedSetItem(key, JSON.stringify(individualRawTranscriptToggleStates));
    }
  }, [individualRawTranscriptToggleStates, pageAgentName, userId]);

  // Track when VAD dependencies become ready
  const [vadDependenciesReady, setVadDependenciesReady] = useState(false);

  // Monitor VAD dependencies separately
  useEffect(() => {
    console.log('[VAD-DEPS] Checking dependencies:', { pageAgentName: !!pageAgentName, userId: !!userId });
    const ready = !!(pageAgentName && userId);
    if (ready !== vadDependenciesReady) {
      console.log('[VAD-DEPS] Dependencies ready state changed:', ready);
      setVadDependenciesReady(ready);
    }
  }, [pageAgentName, userId, vadDependenciesReady]);

  // Load and persist VAD aggressiveness (agent-specific) - triggered when dependencies become ready
  useEffect(() => {
    console.log('[VAD] Main useEffect triggered - vadDependenciesReady:', vadDependenciesReady);

    if (!vadDependenciesReady || !pageAgentName || !userId) {
      console.log('[VAD] Dependencies not ready, skipping...');
      return;
    }

    console.log('[VAD] Processing VAD with pageAgentName:', pageAgentName, 'userId:', userId);
    const key = `vadAggressivenessSetting_${pageAgentName}_${userId}`;
    const savedValue = debouncedGetItem(key);
    console.log('[VAD] localStorage check:', { key, savedValue });

    if (savedValue && ["1", "2", "3"].includes(savedValue)) {
      console.log('[VAD] Using saved value:', savedValue);
      setVadAggressiveness(parseInt(savedValue, 10) as VADAggressiveness);
    } else {
      console.log('[VAD] No saved value, fetching defaults...');
      // Get provider-specific default from backend
      fetch('/api/config/defaults')
        .then(response => response.json())
        .then(config => {
          console.log('[VAD] API response:', config);
          const defaultVad = config.defaultVadAggressiveness as VADAggressiveness;
          console.log('[VAD] Setting to provider default:', defaultVad);
          setVadAggressiveness(defaultVad);
        })
        .catch(error => {
          console.warn('[VAD] API failed, using hardcoded fallback:', error);
          // If API fails, use sensible defaults: Deepgram=1, others=2
          // We don't know the provider here, so default to 2 (Mid) as safest fallback
          setVadAggressiveness(2);
        });
    }
  }, [vadDependenciesReady, pageAgentName, userId]);

  useEffect(() => {
    if (pageAgentName && userId && vadAggressiveness !== null) {
      const key = `vadAggressivenessSetting_${pageAgentName}_${userId}`;
      debouncedSetItem(key, vadAggressiveness.toString());
    }
  }, [vadAggressiveness, pageAgentName, userId]);

  useEffect(() => {
    if (pageAgentName && userId) { // Ensure agentName and userId are available
      // ikea-pilot workspace override: always default to Swedish transcription (highest priority)
      if (pageAgentName === 'ikea-pilot') {
        setTranscriptionLanguage('sv');
        return;
      }

      const key = `transcriptionLanguageSetting_${pageAgentName}_${userId}`;
      const savedLang = debouncedGetItem(key);

      // 1. Check for a valid user-saved preference in localStorage
      if (savedLang === "en" || savedLang === "sv" || savedLang === "any") {
        setTranscriptionLanguage(savedLang as "en" | "sv" | "any");
        console.log(`[LangSetting] Loaded user preference '${savedLang}' for agent '${pageAgentName}' from localStorage.`);
      } else {
        // 2. If no user preference, use the workspace default from ui_config
        const workspaceDefault = activeUiConfig.default_transcription_language;
        
        // 3. Validate the workspace default, otherwise use hardcoded fallback
        const finalDefault = (workspaceDefault === "en" || workspaceDefault === "sv" || workspaceDefault === "any")
          ? workspaceDefault
          : "any"; // Hardcoded fallback

        setTranscriptionLanguage(finalDefault);
        console.log(`[LangSetting] No user preference for agent '${pageAgentName}'. Applied default: '${finalDefault}' (from ${workspaceDefault ? 'workspace' : 'hardcode'}).`);
        // Do not save the workspace default to localStorage, allowing it to be updated from Supabase.
      }
    } else {
       // Fallback if no agent context is available yet
       setTranscriptionLanguage("any");
       console.log(`[LangSetting] No pageAgentName or userId, defaulting language to 'any'.`);
    }
  }, [pageAgentName, userId, activeUiConfig]); // Dependency: pageAgentName, userId, and activeUiConfig


  // Load/persist "Use Chat Memory" toggle state
  useEffect(() => {
    if (pageAgentName && userId) {
      const key = `useChatMemory_${pageAgentName}_${userId}`;
      const savedValue = debouncedGetItem(key);
      setUseChatMemory(savedValue === 'true');
    }
  }, [pageAgentName, userId]);

  const handleUseChatMemoryChange = (checked: boolean) => {
    setUseChatMemory(checked);
    if (pageAgentName && userId) {
      debouncedSetItem(`useChatMemory_${pageAgentName}_${userId}`, String(checked));
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

  // Enforce model from workspace if provided; otherwise use saved or fallback
  useEffect(() => {
    if (pageAgentName && userId) {
      if (activeUiConfig?.default_model) {
        setSelectedModel(activeUiConfig.default_model);
        return;
      }
      const key = `agent-model-${pageAgentName}_${userId}`;
      const savedModel = debouncedGetItem(key);
      if (savedModel) {
        setSelectedModel(savedModel);
      } else {
        setSelectedModel('claude-sonnet-4-5-20250929');
      }
    }
  }, [pageAgentName, userId, activeUiConfig]);

  const handleModelChange = (model: string) => {
    setSelectedModel(model);
    if (pageAgentName && userId) {
      const key = `agent-model-${pageAgentName}_${userId}`;
      debouncedSetItem(key, model);
    }
  };
  
  // Load and persist temperature (agent-specific)
  useEffect(() => {
    if (pageAgentName && userId) {
      const key = `agent-temperature-${pageAgentName}_${userId}`;
      const savedTemp = debouncedGetItem(key);
      if (savedTemp !== null && !isNaN(parseFloat(savedTemp))) {
        setTemperature(parseFloat(savedTemp));
      } else {
        setTemperature(0.7); // Default if not set or invalid
      }
    }
  }, [pageAgentName, userId]);

  const handleTemperatureChange = (value: number[]) => {
    const newTemp = value[0];
    setTemperature(newTemp);
    if (pageAgentName && userId) {
      const key = `agent-temperature-${pageAgentName}_${userId}`;
      debouncedSetItem(key, newTemp.toString());
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
    const { data: { session } } = await getCachedSession(supabase);
    if (!session) { console.warn(`Not fetching ${description}: no session.`); return; }

    // Include agent and event for cross-group read support
    let proxyApiUrl = `/api/s3-proxy/list?prefix=${encodeURIComponent(prefix)}`;
    if (pageAgentName) {
      proxyApiUrl += `&agent=${encodeURIComponent(pageAgentName)}`;
    }
    if (pageEventId) {
      proxyApiUrl += `&event=${encodeURIComponent(pageEventId)}`;
    }

    try {
      const response = await fetch(proxyApiUrl, { headers: { 'Authorization': `Bearer ${session.access_token}` }});
      if (!response.ok) throw new Error(`Failed to fetch ${description} via proxy: ${response.statusText} (URL: ${proxyApiUrl})`);
      const data: FetchedFile[] = await response.json();
      const filtered = (data || []).filter(file => {
        const key = (file.s3Key || file.Key || '').split('?')[0];
        if (!key.includes('/transcripts/')) return true;

        // Block archive and saved subdirectories ONLY when listing from general transcripts/ prefix
        // Allow them when explicitly requested (prefix ends with archive/, saved/, or summarized/)
        const isExplicitSubdir = prefix.endsWith('/archive/') || prefix.endsWith('/saved/') || prefix.endsWith('/summarized/');
        if (!isExplicitSubdir && (key.includes('/transcripts/archive/') || key.includes('/transcripts/saved/'))) {
          return false;
        }

        // When explicitly fetching from archive/, saved/, or summarized/, allow all files
        if (isExplicitSubdir) {
          return true;
        }

        // Otherwise, allow only direct files in transcripts/ (not in subdirectories)
        return /^.+\/events\/[^/]+\/transcripts\/[^/]+\.[^/]+$/.test(key);
      });
      onDataFetched(filtered);
    } catch (error) {
      console.error(`Error fetching ${description} from proxy ${proxyApiUrl}:`, error);
      onDataFetched([]);
    }
  }, [supabase.auth, pageAgentName, pageEventId]);

  // Effect for Transcriptions
  useEffect(() => {
    // Load transcriptions if settings are open OR if ikea-pilot is active (needs file counts for status display)
    const shouldLoad = showSettings || pageAgentName === 'ikea-pilot';
    if (!shouldLoad || !pageAgentName || !pageEventId || isAuthorized !== true || fetchedDataFlags.transcriptions) return;
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
    // Load saved summaries if settings are open OR if ikea-pilot is active (needs file counts for status display)
    const shouldLoad = showSettings || pageAgentName === 'ikea-pilot';
    if (!shouldLoad || !pageAgentName || !pageEventId || isAuthorized !== true || fetchedDataFlags.savedSummaries) return;
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

  // Effect for Agent Documents
  useEffect(() => {
    if (!showSettings || !pageAgentName || isAuthorized !== true || fetchedDataFlags.agentDocuments) return;
    const prefix = `organizations/river/agents/${pageAgentName}/docs/`;
    fetchS3Data(prefix, (data) => {
      // Filter out directory placeholders
      const filesOnly = data.filter(f => !f.name.endsWith('/'));
      // Sort by lastModified date in descending order (newest first)
      const sortedData = [...filesOnly].sort((a, b) => {
        const dateA = new Date(a.lastModified || 0).getTime();
        const dateB = new Date(b.lastModified || 0).getTime();
        return dateB - dateA;
      });
      setAgentDocuments(sortedData);
      setFetchedDataFlags(prev => ({ ...prev, agentDocuments: true }));
    }, "Agent Documents");
  }, [showSettings, pageAgentName, isAuthorized, fetchedDataFlags.agentDocuments, fetchS3Data]);

  // Effect for Pinecone Memory
  useEffect(() => {
    const fetchPinecone = async () => {
      if (!showSettings || !pageAgentName || isAuthorized !== true || fetchedDataFlags.pineconeMemory) return;
      const { data: { session } } = await getCachedSession(supabase);
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

      const { data: { session } } = await getCachedSession(supabase);
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


  const handleViewS3File = (file: { s3Key: string; name: string; type: string }, options?: { fromSettings?: boolean }) => {
    setS3FileToView(file);
    // Only hide Settings and remember tab if launched from Settings
    const fromSettings = !!options?.fromSettings;
    setViewerFromSettings(fromSettings);
    if (fromSettings) {
      setPreviousActiveTab(activeTab);
      setShowSettings(false);
    }
    setShowS3FileViewer(true);
  };

  const handleCloseS3FileViewer = () => {
    setShowS3FileViewer(false);
    setS3FileToView(null);
    if (viewerFromSettings) {
      setShowSettings(true);
      setTimeout(() => {
        setActiveTab(previousActiveTab);
      }, 0);
    }
    setViewerFromSettings(false);
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

    const { data: { session } } = await getCachedSession(supabase);
    if (!session) {
      console.error("Archive Error: No active session.");
      // Optionally show an error toast to the user
      setShowArchiveConfirmModal(false);
      setFileToArchive(null);
      return;
    }

    try {
      const response = await fetchWithTimeout('/api/s3-proxy/manage-file', {
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

    const { data: { session } } = await getCachedSession(supabase);
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
      const response = await fetchWithTimeout('/api/s3-proxy/summarize-transcript', { // Changed endpoint name to match s3-proxy structure
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
      }, 30000); // 30s timeout for LLM summarization

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
        agentDocuments: false,
      });

    } catch (error: any) {
      console.error("Error clearing S3 cache:", error);
      toast.error(`Failed to reload cache: ${error.message}`);
    } finally {
      setIsClearingCache(false);
    }
  };

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Error logging out:', error);
      toast.error("Logout failed: " + error.message);
    } else {
      // Using window.location.href forces a full page reload,
      // which is good for clearing all application state and ensuring
      // the middleware properly redirects to the login page.
      window.location.href = '/login';
    }
  };

  const handleAgentChange = (newAgent: string) => {
    if (newAgent && newAgent !== pageAgentName) {
      const currentParams = new URLSearchParams(searchParams.toString());
      currentParams.set('agent', newAgent);
      // Reset event to main/default when switching agents
      currentParams.set('event', '0000');
      router.push(`/?${currentParams.toString()}`);
    }
  };


  // Prevent hydration mismatch for authorization state
  const [isClient, setIsClient] = useState(false);
  
  useEffect(() => {
    setIsClient(true);
  }, []);
  
  if (!isClient) {
    return (<div className="flex items-center justify-center min-h-[calc(100dvh-var(--sys-banner-h))]"><p className="text-xl animate-pulse">Loading...</p></div>);
  }

  // --- PHASE 3: Show consent view if needed (render this first) ---
  if (needsConsent) {
    return (
      <ConsentView
        workspaceId={needsConsent.workspaceId}
        workspaceName={needsConsent.workspaceName}
        onConsentGiven={handleConsentGiven}
      />
    );
  }

  // Then loading/denied states
  if (isAuthorized === null) return (<div className="flex items-center justify-center min-h-[calc(100dvh-var(--sys-banner-h))]"><p className="text-xl animate-pulse">Checking authorization...</p></div>);
  if (isAuthorized === false) return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100dvh-var(--sys-banner-h))] text-center p-4">
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
    <div
      ref={mainLayoutRef}
      className={`relative overflow-hidden min-h-[calc(100dvh-var(--sys-banner-h))] h-[calc(100dvh-var(--sys-banner-h))] flex flex-col ${isSidebarOpen ? 'sidebar-open' : ''}`}
      style={layoutStyle}
    >
      <Sidebar
        isOpen={isSidebarOpen}
        onOpen={() => setIsSidebarOpen(true)}
        onClose={() => setIsSidebarOpen(false)}
        className="absolute top-[15px] left-2 md:left-6 z-20"
        setCurrentView={setCurrentView}
        currentView={currentView}
        setShowSettings={setShowSettings}
        agentName={pageAgentName || undefined}
        currentEventId={pageEventId || undefined}
        selectedModel={selectedModel}
        onNewChat={handleNewChatFromSidebar}
        onLoadChat={async (chatId: string) => {
          // Resolve selected chat's original agent/event
          let targetAgent: string | undefined;
          let targetEvent: string = '0000';
          try {
            const target = chatHistory.find((c) => c.id === chatId);
            targetAgent = target?.agentName;
            targetEvent = target?.eventId || '0000';
          } catch (e) {
            console.warn('[Sidebar] Failed to resolve chat target agent/event', e);
          }

          const currentEvent = pageEventId || '0000';
          const needsContextSwitch = !!targetAgent && (targetAgent !== pageAgentName || targetEvent !== currentEvent);

          if (needsContextSwitch && targetAgent) {
            // Defer loading until URL reflects the conversation's agent/event
            setPendingChatToLoad({ chatId, agentName: targetAgent, eventId: targetEvent });
            router.push(`/?agent=${encodeURIComponent(targetAgent)}&event=${encodeURIComponent(targetEvent)}`);
            return;
          }

          // Same agent/event: load immediately
          if (chatInterfaceRef.current) {
            setIsChatLoading(true);
            try {
              await chatInterfaceRef.current.loadChatHistory(chatId);
              setCurrentChatId(chatId);
            } finally {
              setIsChatLoading(false);
            }
          }
        }}
      currentChatId={currentChatId || undefined}
        chatHistory={chatHistory}
        isLoadingHistory={isLoadingHistory}
        onDeleteChat={handleDeleteInitiated}
        transcriptListenMode={transcriptListenMode}
        savedTranscriptMemoryMode={savedTranscriptMemoryMode}
        individualMemoryToggleStates={individualMemoryToggleStates}
        onLogout={handleLogout}
        // --- PHASE 3: Workspace UI props ---
        isAdminOverride={permissionsData?.isAdminOverride}
        activeUiConfig={activeUiConfig}
        eventLabels={eventLabels}
        workspaceId={(permissionsData && currentAgent) ? (permissionsData.agents.find((a: any) => a.name === currentAgent)?.workspaceId) : undefined}
        workspaceName={(permissionsData && currentAgent) ? (permissionsData.agents.find((a: any) => a.name === currentAgent)?.workspaceName || undefined) : undefined}
        // --- Groups read feature props ---
        groupsReadMode={groupsReadMode}
        allowedGroupEventsCount={(availableEvents || []).filter(ev => ev !== '0000' && eventTypes[ev] === 'group').length}
        allowedBreakoutEventsCount={(availableEvents || []).filter(ev => ev !== '0000' && eventTypes[ev] === 'breakout').length}
      />
      
      {/* New Chat icon positioned right of sidebar */}
      {currentView !== 'canvas' && (
        <button
          onClick={handleNewChatRequest}
          className="top-left-icon absolute top-[17px] left-[42px] md:left-[60px] z-20 p-2 text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))] transition-colors"
          aria-label="Start new chat"
          title="Start new chat"
        >
          <SquarePen size={20} />
        </button>
      )}
      
      {/* 
        NOTE: The 'Simple' view is the standard/default view for the application,
        and any other views should be considered deprecated. This timer is part of that
        standard view and is displayed for recordings initiated from any tab (Chat, Record Note).
        It is positioned top-center on mobile and top-right on desktop.
      */}
      {isFullscreen && globalRecordingStatus.isRecording && (!isMobile && globalRecordingStatus.type !== 'press-to-talk') && (
        <div
          className={cn(
            "absolute top-[27px] z-20 flex items-center gap-2 text-xs text-foreground/70 right-1/2 translate-x-1/2 md:right-[27px] md:translate-x-0",
            (!(!permissionsData?.isAdminOverride && !!activeUiConfig?.hide_click_targets?.includes?.('open_latest_transcript'))) && 'cursor-pointer'
          )}
          onClick={async () => {
            try {
              if (!pageAgentName || !pageEventId) return;
              // Workspace flag: hide when configured (unless admin override handled upstream)
              if (!permissionsData?.isAdminOverride && !!activeUiConfig?.hide_click_targets?.includes?.('open_latest_transcript')) return;

              const openFirst = (files: FetchedFile[]) => {
                if (!files || files.length === 0) return;
                const first = files[0];
                if (first?.s3Key) {
                  handleViewS3File({ s3Key: first.s3Key, name: first.name, type: first.type || 'text/plain' });
                }
              };

              const expectedPrefix = `organizations/river/agents/${pageAgentName}/events/${pageEventId}/transcripts/`;
              const cacheMatchesContext = (
                transcriptionS3Files && transcriptionS3Files.length > 0 &&
                typeof transcriptionS3Files[0]?.s3Key === 'string' &&
                (transcriptionS3Files[0].s3Key as string).startsWith(expectedPrefix)
              );

              if (cacheMatchesContext) {
                openFirst(transcriptionS3Files);
                return;
              }
              await fetchS3Data(expectedPrefix, (data) => {
                const sorted = [...data].sort((a, b) => {
                  const dateA = new Date(a.lastModified || 0).getTime();
                  const dateB = new Date(b.lastModified || 0).getTime();
                  return dateB - dateA;
                });
                setTranscriptionS3Files(sorted);
                openFirst(sorted);
              }, 'Transcriptions (header timer open)');
            } catch (e) {
              console.warn('Open latest transcript from header failed:', e);
            }
          }}
        >
          <span className={`inline-block w-2 h-2 rounded-full ${
            (globalRecordingStatus.type === 'long-form-chat' && recordingState.isBrowserPaused) || (globalRecordingStatus.type === 'long-form-note' && noteRecordingTime > 0 && recordingState.isBrowserPaused) ? 'bg-yellow-500' :
            globalRecordingStatus.type === 'long-form-chat' ? 'bg-blue-500 animate-pulse' :
            'bg-red-500 animate-pulse'
          }`}></span>
          <span className="font-mono">
            {Math.floor((globalRecordingStatus.type === 'long-form-chat' ? recordingState.clientRecordingTime : noteRecordingTime) / 60).toString().padStart(2, '0')}:
            {((globalRecordingStatus.type === 'long-form-chat' ? recordingState.clientRecordingTime : noteRecordingTime) % 60).toString().padStart(2, '0')}
          </span>
        </div>
      )}
      <div
        className={cn(
          "main-content flex flex-col flex-1 w-full",
          currentView === "canvas" ? "max-w-none" : "sm:max-w-[800px] sm:mx-auto"
        )}
        data-current-view={currentView}
        data-theme={currentView === "canvas" ? "canvas" : undefined}
      >
        <header className={`py-2 px-4 text-center relative flex-shrink-0 ${isFullscreen ? 'fullscreen-header' : ''}`} style={{ height: 'var(--header-height)' }}>
          {currentView === 'canvas' ? (
            <div className="flex h-full w-full items-center justify-end" />
          ) : (
            <div className="flex items-center justify-center h-full">
            {/* Desktop Agent Selector - Use workspace config only, no hardcoded logic */}
            {!isMobile && pageAgentName && (!activeUiConfig.hide_agent_selector || permissionsData?.isAdminOverride) && (
              <div className="flex items-center gap-2">
                <AgentSelectorMenu
                  allowedAgents={allowedAgents}
                  allAgents={permissionsData?.allAgentNames}
                  currentAgent={pageAgentName}
                  userRole={userRole}
                  onDashboardClick={() => setShowAgentDashboard(true)}
                  isRecordingActive={globalRecordingStatus.isRecording}
                  onRequestStopRecording={async () => {
                    try { if (isRecordingPersistenceEnabled()) { await recordingManager.stop(); } } catch {}
                    try { const bc = new BroadcastChannel('recording'); bc.postMessage({ kind: 'stop:request', reason: 'agent-switch' }); bc.close(); } catch {}
                  }}
                />
                {/* Event dropdown (uses S3 events when available) */}
                {shouldShowEventDropdown ? (
                    <DropdownMenu onOpenChange={(open) => { if (open && availableEvents == null) fetchAvailableEvents(); }}>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="inline-flex items-center rounded-full bg-accent text-accent-foreground px-2 py-0.5 text-xs max-w-[200px] truncate font-semibold hover:opacity-90"
                          aria-label="Select event"
                        >
                          <span className="truncate max-w-[160px]">{labelForEvent(pageEventId)}</span>
                          <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70" />
                        </button>
                      </DropdownMenuTrigger>
                      <EventSelectorContent
                        currentEventId={pageEventId ?? '0000'}
                        events={availableEvents ?? []}
                        mainEvents={partitionedEvents.main}
                        breakoutEvents={partitionedEvents.breakout}
                        onChange={(v) => {
                          const params = new URLSearchParams(searchParams.toString());
                          params.set('event', v);
                          router.push(`/?${params.toString()}`);
                        }}
                        labelForEvent={labelForEvent}
                        eventTypes={eventTypes}
                      />
                    </DropdownMenu>
                ) : null}
              </div>
            )}
            {/* Desktop Agent Name (when selector hidden) - Use workspace name from Supabase */}
            {!isMobile && pageAgentName && (activeUiConfig.hide_agent_selector && !permissionsData?.isAdminOverride) && (
              <div className="text-sm font-medium header-workspace-title flex items-center gap-2">
                <span>{permissionsData?.agents?.find(a => a.name === pageAgentName)?.workspaceName || pageAgentName}</span>
                {shouldShowEventDropdown ? (
                    <DropdownMenu onOpenChange={(open) => { if (open && availableEvents == null) fetchAvailableEvents(); }}>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="inline-flex items-center rounded-full bg-accent text-accent-foreground px-2 py-0.5 text-xs max-w-[200px] truncate font-semibold hover:opacity-90"
                          aria-label="Select event"
                        >
                          <span className="truncate max-w-[160px]">{labelForEvent(pageEventId)}</span>
                          <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70" />
                        </button>
                      </DropdownMenuTrigger>
                      <EventSelectorContent
                        currentEventId={pageEventId ?? '0000'}
                        events={availableEvents ?? []}
                        mainEvents={partitionedEvents.main}
                        breakoutEvents={partitionedEvents.breakout}
                        onChange={(v) => {
                          const params = new URLSearchParams(searchParams.toString());
                          params.set('event', v);
                          router.push(`/?${params.toString()}`);
                        }}
                        labelForEvent={labelForEvent}
                        eventTypes={eventTypes}
                      />
                    </DropdownMenu>
                ) : null}
              </div>
            )}
            {!isMobile && !pageAgentName && (
              <ViewSwitcher 
                currentView={currentView} 
                onViewChange={(newView) => setCurrentView(newView)}
                agentName={pageAgentName}
                className="max-w-sm"
              />
            )}


            {/* Right side: Agent name (mobile) */}
            {/* Mobile Agent Selector - Use workspace config only, no hardcoded logic */}
            {isMobile && pageAgentName && (
              <div className="absolute right-6 flex items-center gap-2" style={{ marginTop: '2px' }}>
                {shouldShowEventDropdown ? (
                    <DropdownMenu onOpenChange={(open) => { if (open && availableEvents == null) fetchAvailableEvents(); }}>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="inline-flex items-center rounded-full bg-accent text-accent-foreground px-2 py-0.5 text-xs max-w-[140px] truncate font-semibold hover:opacity-90"
                          aria-label="Select event"
                        >
                          <span className="truncate max-w-[100px]">{labelForEvent(pageEventId)}</span>
                          <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70" />
                        </button>
                      </DropdownMenuTrigger>
                      <EventSelectorContent
                        currentEventId={pageEventId ?? '0000'}
                        events={availableEvents ?? []}
                        mainEvents={partitionedEvents.main}
                        breakoutEvents={partitionedEvents.breakout}
                        onChange={(v) => {
                          const params = new URLSearchParams(searchParams.toString());
                          params.set('event', v);
                          router.push(`/?${params.toString()}`);
                        }}
                        labelForEvent={labelForEvent}
                        eventTypes={eventTypes}
                      />
                    </DropdownMenu>
                ) : null}
                {(!activeUiConfig.hide_agent_selector || permissionsData?.isAdminOverride) ? (
                  <AgentSelectorMenu
                    allowedAgents={allowedAgents}
                    allAgents={permissionsData?.allAgentNames}
                    currentAgent={pageAgentName}
                    userRole={userRole}
                    onDashboardClick={() => setShowAgentDashboard(true)}
                    isRecordingActive={globalRecordingStatus.isRecording}
                    onRequestStopRecording={async () => {
                      try { if (isRecordingPersistenceEnabled()) { await recordingManager.stop(); } } catch {}
                      try { const bc = new BroadcastChannel('recording'); bc.postMessage({ kind: 'stop:request', reason: 'agent-switch' }); bc.close(); } catch {}
                    }}
                  />
                ) : (
                  <div className="text-sm font-medium header-workspace-title truncate max-w-[160px]">
                    {permissionsData?.agents?.find(a => a.name === pageAgentName)?.workspaceName || pageAgentName}
                  </div>
                )}
              </div>
            )}
            </div>
          )}
        </header>

        <main className="flex-1 flex flex-col relative">
      {showLoadingSpinner && (
        <div className="flex-1 flex items-center justify-center absolute inset-0 bg-background z-30">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}
      <div className={cn("flex flex-col flex-1 min-h-0", isChatLoading && "invisible")}>
        {/* Keep SimpleChatInterface always mounted but hidden when not active to preserve state */}
        <div className={currentView === "chat" ? "flex flex-col flex-1 min-h-0" : "hidden"}>
            <SimpleChatInterface
              ref={chatInterfaceRef}
              onAttachmentsUpdate={updateChatAttachments}
              isFullscreen={isFullscreen}
              selectedModel={selectedModel}
              temperature={temperature}
              onModelChange={handleModelChange}
              onRecordingStateChange={handleRecordingStateChange}
              isDedicatedRecordingActive={globalRecordingStatus.type === 'long-form-note' && globalRecordingStatus.isRecording}
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
              rawTranscriptFiles={transcriptionS3Files}
              isModalOpen={isAnyModalOpen}
              // --- PHASE 3: Workspace UI props ---
              isAdminOverride={permissionsData?.isAdminOverride}
              activeUiConfig={activeUiConfig}
              tooltips={activeUiConfig.tooltips || {}}
              onOpenSettings={() => setShowSettings(true)}
              // --- Groups read feature props ---
              groupsReadMode={groupsReadMode}
              allowedGroupEventsCount={(availableEvents || []).filter(ev => ev !== '0000' && eventTypes[ev] === 'group').length}
              allowedBreakoutEventsCount={(availableEvents || []).filter(ev => ev !== '0000' && eventTypes[ev] === 'breakout').length}
              onOpenLatestTranscript={async () => {
                try {
                  if (!pageAgentName || !pageEventId) return;
                  // Workspace flag: hide when configured
                  if (!permissionsData?.isAdminOverride && !!activeUiConfig?.hide_click_targets?.includes?.('open_latest_transcript')) return;

                  const openFirst = (files: FetchedFile[]) => {
                    if (!files || files.length === 0) return;
                    const first = files[0];
                    if (first?.s3Key) {
                      handleViewS3File({ s3Key: first.s3Key, name: first.name, type: first.type || 'text/plain' });
                    }
                  };

                  const expectedPrefix = `organizations/river/agents/${pageAgentName}/events/${pageEventId}/transcripts/`;
                  const cacheMatchesContext = (
                    transcriptionS3Files && transcriptionS3Files.length > 0 &&
                    typeof transcriptionS3Files[0]?.s3Key === 'string' &&
                    (transcriptionS3Files[0].s3Key as string).startsWith(expectedPrefix)
                  );

                  if (cacheMatchesContext) {
                    openFirst(transcriptionS3Files);
                    return;
                  }
                  // Fallback: fetch from S3 and then open the first (latest)
                  await fetchS3Data(expectedPrefix, (data) => {
                    const sorted = [...data].sort((a, b) => {
                      const dateA = new Date(a.lastModified || 0).getTime();
                      const dateB = new Date(b.lastModified || 0).getTime();
                      return dateB - dateA;
                    });
                    setTranscriptionS3Files(sorted);
                    openFirst(sorted);
                  }, 'Transcriptions (inline open)');
                } catch (e) {
                  console.warn('Open latest transcript failed:', e);
                }
              }}
            />
        </div>
        <div className={currentView === "canvas" ? "flex flex-col flex-1 min-h-0" : "hidden"}>
          <CanvasView depth={canvasDepth} />
        </div>
        <div className={currentView === "transcribe" ? "flex flex-col flex-1" : "hidden"}>
          <div className="flex flex-col" style={{ height: 'calc(100vh - var(--header-height) - var(--input-area-height))' }}>
            <div className="messages-container" style={{ paddingLeft: '8px', paddingRight: '8px' }}>
              <div className="space-y-1 pt-8 pb-4">
                <FullFileTranscriber agentName={pageAgentName} userName={userName} activeUiConfig={activeUiConfig} />
              </div>
            </div>
          </div>
        </div>
        <div className={currentView === "record" ? "flex flex-col flex-1" : "hidden"}>
          <div className="flex flex-col" style={{ height: 'calc(100vh - var(--header-height) - var(--input-area-height))' }}>
            <div className="messages-container" style={{ paddingLeft: '8px', paddingRight: '8px' }}>
              <div className="space-y-1 pt-8">
                <RecordView
                  agentName={pageAgentName}
                  globalRecordingStatus={globalRecordingStatus}
                  setGlobalRecordingStatus={setGlobalRecordingStatus}
                  isTranscriptRecordingActive={globalRecordingStatus.type === 'long-form-chat' && globalRecordingStatus.isRecording}
                  agentCapabilities={agentCapabilities}
                  vadAggressiveness={vadAggressiveness}
                  setRecordingTime={setNoteRecordingTime}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
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
                                  <Separator className="my-1" />
                                  {predefinedThemes.map((customTheme) => (
                                    <React.Fragment key={customTheme.className}>
                                      {themeGroupSeparators.has(customTheme.className) && <Separator className="my-1" />}
                                      <div className="flex items-center space-x-2">
                                        <RadioGroupItem value={customTheme.className} id={`theme-${customTheme.className}-mobile`} />
                                        <Label htmlFor={`theme-${customTheme.className}-mobile`}>{customTheme.name}</Label>
                                      </div>
                                    </React.Fragment>
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
                          <DropdownMenuContent className="w-[180px] max-h-72 overflow-y-auto" align="end" collisionPadding={10}>
                            <DropdownMenuRadioGroup
                              value={currentAgentTheme || theme}
                              onValueChange={handleAgentThemeChange}
                            >
                              <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
                              <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
                              <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
                              <DropdownMenuSeparator />
                              {predefinedThemes.map((customTheme) => (
                                <React.Fragment key={customTheme.className}>
                                  {themeGroupSeparators.has(customTheme.className) && <DropdownMenuSeparator />}
                                  <DropdownMenuRadioItem value={customTheme.className}>
                                    {customTheme.name}
                                  </DropdownMenuRadioItem>
                                </React.Fragment>
                              ))}
                            </DropdownMenuRadioGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                    {/* Agent Selector - Controlled entirely by workspace config in Supabase */}
                    {(!activeUiConfig.hide_agent_selector || permissionsData?.isAdminOverride) && (
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
                    )}
                     {/* Model Selector - Always shown in Settings (Settings tab handles visibility) */}
                       <div className="flex items-center justify-between">
                        <Label htmlFor="model-selector">Chat Model</Label>
                          <Select value={selectedModel} onValueChange={handleModelChange}>
                            <SelectTrigger className="w-[220px]" id="model-selector">
                              <SelectValue placeholder="Select a model" />
                            </SelectTrigger>
                            <SelectContent>
                              {MODEL_GROUPS.map((group) => (
                              <SelectGroup key={group.label}>
                                <SelectLabel className="pl-8 pr-2 uppercase text-muted-foreground font-normal text-xs opacity-75">{group.label}</SelectLabel>
                                {group.models.map((model) => (
                                  <SelectItem key={model.id} value={model.id}>
                                    {model.name}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            ))}
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
                            const newLang = value as "en" | "sv" | "any";
                            setTranscriptionLanguage(newLang);
                            // ikea-pilot workspace override: don't save to localStorage
                            if (pageAgentName === 'ikea-pilot') return;
                            // Manually save user's explicit choice to localStorage
                            if (pageAgentName && userId) {
                              const key = `transcriptionLanguageSetting_${pageAgentName}_${userId}`;
                              debouncedSetItem(key, newLang);
                              console.log(`[LangSetting] User saved '${newLang}' for agent '${pageAgentName}' to localStorage.`);
                            }
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
                        <DocumentUpload description="Documents attached to the current chat session (Read-only)" type="chat" idSuffix="chat-attachments" existingFiles={allChatAttachments} readOnly={true} allowRemove={false} transparentBackground={true} />
                      </div>
                    </CollapsibleSection>
                    <CollapsibleSection title="Transcripts" defaultOpen={false}>
                      <div className="flex items-center justify-between py-3 border-b mb-3">
                        <div className="flex items-center gap-2">
                          <History className="h-5 w-5 text-muted-foreground" />
                          <Label htmlFor="transcript-listen-toggle-group" className="memory-section-title text-sm font-medium">Listen:</Label>
                        </div>
                        <ToggleGroup
                          type="single"
                          value={transcriptListenMode}
                          onValueChange={(value) => {
                            if (value) {
                              const newMode = value as "none" | "some" | "latest" | "all" | "breakout";
                              setTranscriptListenMode(newMode);
                              // Manually save user's explicit choice to localStorage
                              if (pageAgentName && userId) {
                                const key = `transcriptListenModeSetting_${pageAgentName}_${userId}`;
                                debouncedSetItem(key, newMode);
                              }
                              // When an explicit mode is chosen, clear manual overrides
                              if (newMode !== 'some') {
                                setIndividualRawTranscriptToggleStates({});
                              }
                            }
                          }}
                          className="rounded-md bg-muted p-1"
                          aria-label="Transcript listen mode"
                          id="transcript-listen-toggle-group"
                        >
                          <ToggleGroupItem value="none" aria-label="None" className="h-6 px-3 data-[state=on]:bg-background data-[state=on]:text-foreground text-xs">None</ToggleGroupItem>
                          <ToggleGroupItem value="latest" aria-label="Latest" className="h-6 px-3 data-[state=on]:bg-background data-[state=on]:text-foreground text-xs">Latest</ToggleGroupItem>
                          <ToggleGroupItem value="some" aria-label="Some" className="h-6 px-3 data-[state=on]:bg-background data-[state=on]:text-foreground text-xs" disabled>Some</ToggleGroupItem>
                          <ToggleGroupItem value="all" aria-label="All" className="h-6 px-3 data-[state=on]:bg-background data-[state=on]:text-foreground text-xs">All</ToggleGroupItem>
                        </ToggleGroup>
                      </div>
                      {/* Groups read mode toggle - only active for event 0000 */}
                      <div className={cn("flex items-center justify-between py-3 border-b mb-3", pageEventId !== '0000' && "opacity-50")}>
                        <div className="flex flex-col gap-1">
                          <Label htmlFor="groups-read-toggle-group" className="memory-section-title text-sm font-medium">
                            Groups:
                          </Label>
                          {pageEventId !== '0000' && (
                            <span className="text-xs text-muted-foreground">Only in event 0000</span>
                          )}
                        </div>
                        <ToggleGroup
                          type="single"
                          value={groupsReadMode}
                          onValueChange={(value) => {
                            if (value && ['latest', 'none', 'all', 'breakout'].includes(value)) {
                              handleGroupsReadModeChange(value as 'latest' | 'none' | 'all' | 'breakout');
                            }
                          }}
                          className="rounded-md bg-muted p-1"
                          disabled={pageEventId !== '0000'}
                          id="groups-read-toggle-group"
                        >
                          <ToggleGroupItem value="none" aria-label="None" className="h-6 px-3 data-[state=on]:bg-background data-[state=on]:text-foreground text-xs" disabled={pageEventId !== '0000'}>None</ToggleGroupItem>
                          <ToggleGroupItem value="latest" aria-label="Latest" className="h-6 px-3 data-[state=on]:bg-background data-[state=on]:text-foreground text-xs" disabled={pageEventId !== '0000'}>Latest</ToggleGroupItem>
                          <ToggleGroupItem value="all" aria-label="All" className="h-6 px-3 data-[state=on]:bg-background data-[state=on]:text-foreground text-xs" disabled={pageEventId !== '0000'}>All</ToggleGroupItem>
                          <ToggleGroupItem value="breakout" aria-label="Breakout" className="h-6 px-3 data-[state=on]:bg-background data-[state=on]:text-foreground text-xs" disabled={pageEventId !== '0000' || ((availableEvents || []).filter(ev => ev !== '0000' && eventTypes[ev] === 'breakout').length === 0)}>Breakout</ToggleGroupItem>
                        </ToggleGroup>
                      </div>
                      <div className="pb-3 space-y-2 w-full">
                        {transcriptionS3Files.length > 0 ? (
                          transcriptionS3Files.map((originalFile, index) => {
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
                                onView={() => handleViewS3File({ s3Key: fileWithPersistentStatus.s3Key!, name: fileWithPersistentStatus.name, type: fileWithPersistentStatus.type || 'text/plain' }, { fromSettings: true })}
                                onDownload={() => handleDownloadS3File({ s3Key: fileWithPersistentStatus.s3Key!, name: fileWithPersistentStatus.name })}
                                onArchive={() => handleArchiveS3FileRequest(fileWithPersistentStatus)}
                                onSaveAsMemory={() => handleSaveAsMemoryS3FileRequest(fileWithPersistentStatus)}
                                showViewIcon={true}
                                showDownloadIcon={true}
                                showArchiveIcon={true}
                                showSaveAsMemoryIcon={true}
                                showIndividualToggle={true}
                                individualToggleChecked={
                                  transcriptListenMode === 'all' ||
                                  (transcriptListenMode === 'latest' && index === 0) ||
                                  (transcriptListenMode === 'some' && !!individualRawTranscriptToggleStates[fileWithPersistentStatus.s3Key!])
                                }
                                onIndividualToggleChange={handleIndividualRawTranscriptToggleChange}
                                individualToggleDisabled={false}
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
                        {(() => {
                          // Calculate effective mode: force "none" when "some" has no selected items
                          const hasAnySelected = Object.values(individualMemoryToggleStates || {}).some(Boolean);
                          const effectiveSavedMode = savedTranscriptMemoryMode === 'some' && !hasAnySelected ? 'none' : savedTranscriptMemoryMode;

                          return (
                        <ToggleGroup
                          type="single"
                          value={effectiveSavedMode}
                          onValueChange={(value) => {
                            if (value) {
                              const newMode = value as "none" | "some" | "all";
                              setSavedTranscriptMemoryMode(newMode);
                              // When an explicit mode is chosen, clear manual overrides
                              if (newMode !== 'some') {
                                setIndividualMemoryToggleStates({});
                              }
                            }
                          }}
                          className="rounded-md bg-muted p-1"
                          aria-label="Saved transcript memory mode"
                          id="saved-transcript-memory-toggle"
                        >
                          <ToggleGroupItem value="none" aria-label="None" className="h-6 px-3 data-[state=on]:bg-background data-[state=on]:text-foreground text-xs">None</ToggleGroupItem>
                          <ToggleGroupItem value="some" aria-label="Some" className="h-6 px-3 data-[state=on]:bg-background data-[state=on]:text-foreground text-xs" disabled>Some</ToggleGroupItem>
                          <ToggleGroupItem value="all" aria-label="All" className="h-6 px-3 data-[state=on]:bg-background data-[state=on]:text-foreground text-xs">All</ToggleGroupItem>
                        </ToggleGroup>
                        );
                        })()}
                      </div>
                      <div className="pb-3 space-y-2 w-full">
                        {savedTranscriptSummaries.length > 0 ? (
                          savedTranscriptSummaries.map(summaryFile => (
                            <FetchedFileListItem
                              key={summaryFile.s3Key || summaryFile.name}
                              file={summaryFile} // Pass the whole file object
                              onView={() => handleViewS3File({ s3Key: summaryFile.s3Key!, name: summaryFile.name, type: summaryFile.type || 'application/json' }, { fromSettings: true })}
                              onDownload={() => handleDownloadS3File({ s3Key: summaryFile.s3Key!, name: summaryFile.name })}
                              showViewIcon={true}
                              showDownloadIcon={true}
                              showArchiveIcon={false} // No archive for summaries
                              showSaveAsMemoryIcon={false} // No save for already summarized
                              showIndividualToggle={true}
                              individualToggleChecked={
                                savedTranscriptMemoryMode === 'all' ||
                                (savedTranscriptMemoryMode === 'some' && !!individualMemoryToggleStates[summaryFile.s3Key!])
                              }
                              onIndividualToggleChange={handleIndividualMemoryToggleChange}
                              individualToggleDisabled={false}
                            />
                          ))
                        ) : (<p className="text-sm text-muted-foreground">No saved transcript summaries found.</p>)}
                      </div>
                    </CollapsibleSection>
                    <CollapsibleSection title="Archived Transcripts" defaultOpen={false}>
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
                               onView={() => handleViewS3File({ s3Key: rawFile.s3Key!, name: rawFile.name, type: rawFile.type || 'text/plain' }, { fromSettings: true })}
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
                    <CollapsibleSection title="Saved Chats" defaultOpen={false}>
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
                    <CollapsibleSection title="Documents" defaultOpen={false}>
                       <div className="pb-3 space-y-2 w-full">
                         {agentDocuments.length > 0 ? (
                           agentDocuments.map(docFile => (
                             <FetchedFileListItem
                               key={docFile.s3Key || docFile.name}
                               file={docFile}
                               onView={() => handleViewS3File({ s3Key: docFile.s3Key!, name: docFile.name, type: docFile.type || 'application/octet-stream' }, { fromSettings: true })}
                               onDownload={() => handleDownloadS3File({ s3Key: docFile.s3Key!, name: docFile.name })}
                               showViewIcon={true}
                               showDownloadIcon={true}
                             />
                           ))
                         ) : (
                           <p className="text-sm text-muted-foreground">No documents found in S3.</p>
                         )}
                       </div>
                    </CollapsibleSection>
                    <CollapsibleSection title="Database" defaultOpen={false}>
                      <div className="document-upload-container">
                        <DocumentUpload description="Locally added/edited memory files. Documents from Pinecone are listed below." type="memory" idSuffix="memory-1" allowRemove={true} persistKey={`agent-memory-${pageAgentName}-${pageEventId}`} onFilesAdded={handleAgentMemoryUpdate} existingFiles={agentMemoryFiles} transparentBackground={true} hideDropZone={true} />
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
                    <CollapsibleSection title="System Prompt" defaultOpen={false}>
                      <div className="document-upload-container">
                        <DocumentUpload description="Locally added/edited system prompt files. Files from S3 are listed below." type="system" idSuffix="system-1" allowRemove={true} persistKey={`system-prompt-${pageAgentName}-${pageEventId}`} onFilesAdded={handleSystemPromptUpdate} existingFiles={systemPromptFiles} transparentBackground={true} hideDropZone={true} />
                      </div>
                      {baseSystemPromptS3Files.length > 0 && (
                        <div className="mt-4 space-y-2 w-full">
                          {baseSystemPromptS3Files.map(file => (
                            <FetchedFileListItem key={file.s3Key || file.name} file={file} onView={() => handleViewS3File({ s3Key: file.s3Key!, name: file.name, type: file.type || 'text/plain' }, { fromSettings: true })} showViewIcon={!file.name.startsWith('systemprompt_base')} />
                          ))}
                        </div>
                      )}
                      {agentSystemPromptS3Files.length > 0 && (
                        <div className="mt-2 space-y-2 w-full">
                          {agentSystemPromptS3Files.map(file => (
                            <FetchedFileListItem key={file.s3Key || file.name} file={file} onView={() => handleViewS3File({ s3Key: file.s3Key!, name: file.name, type: file.type || 'text/plain' }, { fromSettings: true })} showViewIcon={true} />
                          ))}
                        </div>
                      )}
                      {(baseSystemPromptS3Files.length === 0 && agentSystemPromptS3Files.length === 0) && (<p className="text-sm text-muted-foreground mt-2">No system prompts found in S3.</p>)}
                    </CollapsibleSection>
                    <CollapsibleSection title="Context" defaultOpen={false}>
                      <div className="document-upload-container">
                        <DocumentUpload description="Locally added/edited context files. Agent-specific context from S3 is listed below." type="context" idSuffix="context-1" allowRemove={true} persistKey={`context-files-${pageAgentName}-${pageEventId}`} onFilesAdded={handleContextUpdate} existingFiles={contextFiles} transparentBackground={true} hideDropZone={true} />
                      </div>
                      <div className="mt-4 space-y-2 w-full">
                        {agentPrimaryContextS3Files.length > 0 ? (
                          agentPrimaryContextS3Files.map(file => (
                            <FetchedFileListItem key={file.s3Key || file.name} file={file} onView={() => handleViewS3File({ s3Key: file.s3Key!, name: file.name, type: file.type || 'text/plain' }, { fromSettings: true })} showViewIcon={true} />
                          ))
                        ) : (<p className="text-sm text-muted-foreground">No agent-specific context files found in S3 for '{pageAgentName}'.</p>)}
                      </div>
                    </CollapsibleSection>
                    <CollapsibleSection title="Frameworks" defaultOpen={false}>
                        <div className="space-y-2 w-full">
                            {(agentObjectiveFunction || baseObjectiveFunction) && (
                                <FetchedFileListItem
                                  file={(agentObjectiveFunction || baseObjectiveFunction)!}
                                  showViewIcon={false}
                                />
                            )}
                            {baseFrameworkS3Files.length > 0 ? (
                                baseFrameworkS3Files.map(file => (
                                <FetchedFileListItem key={file.s3Key || file.name} file={file} onView={() => handleViewS3File({ s3Key: file.s3Key!, name: file.name, type: file.type || 'text/plain' }, { fromSettings: true })} showViewIcon={!file.name.startsWith('frameworks_base')} />
                                ))
                            ) : (
                                !(agentObjectiveFunction || baseObjectiveFunction) && <p className="text-sm text-muted-foreground">No base frameworks found in S3.</p>
                            )}
                        </div>
                    </CollapsibleSection>

                    <Separator className="my-4" />
                    
                    {(userRole === 'admin' || userRole === 'super user') && (
                      <div className="flex items-center justify-center">
                        <Button
                          onClick={() => {
                            setShowSettings(false);
                            setShowAgentDashboard(true);
                          }}
                          className="font-semibold bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] hover:bg-[hsl(var(--accent))]/90"
                        >
                          Agent Dashboard
                        </Button>
                      </div>
                    )}
                    
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
                    
                    <div className="flex items-center justify-center pt-4">
                      <Button
                        variant="destructive"
                        onClick={handleLogout}
                        className="w-full sm:w-auto"
                      >
                        <LogOut className="mr-2 h-4 w-4" />
                        {t('sidebar.logOut')}
                      </Button>
                    </div>

                  </div>
                </TabsContent>
              </div>
            </Tabs>
          </DialogContent>
        </Dialog>
      )}
      
      {showAgentDashboard && (userRole === 'admin' || userRole === 'super user') && (
        <AgentDashboard
          isOpen={showAgentDashboard}
          onClose={() => setShowAgentDashboard(false)}
          userRole={userRole}
        />
      )}

      <AlertDialogConfirm
        isOpen={showNewChatConfirm}
        onClose={cancelNewChat}
        onConfirm={confirmAndStartNewChat}
        title={t('confirmations.startNewChat.title')}
        message={t('confirmations.startNewChat.message')}
        confirmText={t('confirmations.startNewChat.confirm')}
        cancelText={t('confirmations.startNewChat.cancel')}
        confirmVariant="default"
      />

      <AlertDialogConfirm
        isOpen={showDeleteConfirmation}
        onClose={() => setShowDeleteConfirmation(false)}
        onConfirm={handleDeleteConfirm}
        title={t('confirmations.deleteConversation.title')}
        message={t('confirmations.deleteConversation.message')}
        confirmText={t('confirmations.deleteConversation.confirm')}
        cancelText={t('confirmations.deleteConversation.cancel')}
        confirmVariant="destructive"
      />

      <AlertDialogConfirm
        isOpen={showArchiveConfirmModal}
        onClose={cancelArchiveFile}
        onConfirm={confirmArchiveFile}
        title={t('confirmations.archiveTranscript.title')}
        message={t('confirmations.archiveTranscript.message').replace('{fileName}', fileToArchive?.name || '')}
        confirmText={t('confirmations.archiveTranscript.confirm')}
        cancelText={t('confirmations.archiveTranscript.cancel')}
        confirmVariant="destructive"
      />

      <AlertDialogConfirm
        isOpen={showSaveAsMemoryConfirmModal}
        onClose={cancelSaveAsMemoryFile}
        onConfirm={confirmSaveAsMemoryFile}
        title={t('confirmations.saveTranscriptToMemory.title')}
        message={t('confirmations.saveTranscriptToMemory.message').replace('{fileName}', fileToSaveAsMemory?.name || '')}
        confirmText={t('confirmations.saveTranscriptToMemory.confirm')}
        cancelText={t('confirmations.saveTranscriptToMemory.cancel')}
        confirmVariant="default"
      />
      
      <AlertDialogConfirm
        isOpen={showForgetConfirmModal}
        onClose={() => setShowForgetConfirmModal(false)}
        onConfirm={confirmForgetMemory}
        title={t('confirmations.forgetChatMemory.title')}
        message={
          <span>
            {t('confirmations.forgetChatMemory.message_prefix')}
            <br />
            <strong className="font-semibold text-destructive">{memoryToForget?.summary}</strong>
            <br />
            {t('confirmations.forgetChatMemory.message_suffix')}
          </span>
        }
        confirmText={t('confirmations.forgetChatMemory.confirm')}
        cancelText={t('confirmations.forgetChatMemory.cancel')}
        confirmVariant="destructive"
      />

      {/* Confirm switching agent/event while recording */}
      <AlertDialogConfirm
        isOpen={showSwitchWhileRecordingConfirm}
        onClose={() => { setShowSwitchWhileRecordingConfirm(false); setPendingEventId(null); }}
        onConfirm={async () => {
          setShowSwitchWhileRecordingConfirm(false);
          toast.info('Stopping recording to switch agent...');
          // Stop recording across modes
          try { if (isRecordingPersistenceEnabled()) { await recordingManager.stop(); } } catch {}
          try { const bc = new BroadcastChannel('recording'); bc.postMessage({ kind: 'stop:request', reason: 'event-switch' }); bc.close(); } catch {}
          if (pendingEventId && pageAgentName) {
            router.push(`/?agent=${encodeURIComponent(pageAgentName)}&event=${encodeURIComponent(pendingEventId)}`);
            setPendingEventId(null);
          }
        }}
        title={t('confirmations.switchAgentWhileRecording.title')}
        message={t('confirmations.switchAgentWhileRecording.message')}
        confirmText={t('confirmations.switchAgentWhileRecording.confirm')}
        cancelText={t('confirmations.switchAgentWhileRecording.cancel')}
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
    <Suspense fallback={<div className="flex items-center justify-center min-h-[calc(100dvh-var(--sys-banner-h))]"><p className="text-xl animate-pulse">Loading page...</p></div>}>
      <HomeContent />
    </Suspense>
  );
}
