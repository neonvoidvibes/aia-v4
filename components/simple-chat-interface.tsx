"use client"

import type React from "react"
import { useState, useRef, useEffect, forwardRef, useImperativeHandle, useCallback } from "react"
import { useChat, type Message } from "@ai-sdk/react"
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
  Loader2,
} from "lucide-react"
import FileAttachmentMinimal, { type AttachmentFile } from "./file-attachment-minimal"
import { useMobile } from "@/hooks/use-mobile"
import { useTheme } from "next-themes"
import { motion } from "framer-motion"
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/utils/supabase/client' // Import Supabase client
import { cn } from "@/lib/utils"

interface SimpleChatInterfaceProps {
  onAttachmentsUpdate?: (attachments: AttachmentFile[]) => void
}

export interface ChatInterfaceHandle {
  startNewChat: () => void;
  getMessagesCount: () => number;
  scrollToTop: () => void;
}

interface BackendRecordingStatus {
    is_recording: boolean;
    is_paused: boolean;
    elapsed_time: number;
    agent?: string;
    event?: string;
    last_pause_timestamp?: number | null; // Added this field
}

// Helper function outside component for formatting
const formatTime = (seconds: number): string => {
    const safeSeconds = Math.max(0, seconds);
    const mins = Math.floor(safeSeconds / 60);
    const secs = Math.floor(safeSeconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

const ACTIVE_RECORDING_SESSION_KEY = "active_recording_session"; // localStorage key

const SimpleChatInterface = forwardRef<ChatInterfaceHandle, SimpleChatInterfaceProps>(
  function SimpleChatInterface({ onAttachmentsUpdate }, ref: React.ForwardedRef<ChatInterfaceHandle>) {

    const searchParams = useSearchParams();
    const [agentName, setAgentName] = useState<string | null>(null);
    const [eventId, setEventId] = useState<string | null>(null);
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        const agent = searchParams.get('agent');
        const event = searchParams.get('event');
        // Don't set state here if localStorage restore is pending
        // Let the restore effect handle setting agent/event initially
        // setAgentName(agent);
        // setEventId(event);
        // if (agent) setIsReady(true);
        // else console.warn("Chat Interface Waiting: Agent parameter missing.");
    }, [searchParams]);

    const {
      messages, input, handleInputChange, handleSubmit: originalHandleSubmit,
      isLoading, stop, setMessages, append,
    } = useChat({
      api: "/api/proxy-chat",
      body: { agent: agentName, event: eventId || '0000' },
      sendExtraMessageFields: true,
      // headers removed - rely on cookies verified by the API route
      onError: (error) => { append({ role: 'system', content: `Error: ${error.message}` }); },
      onFinish: (message: Message) => {}
    }, [agentName, eventId]); // Add dependencies here

    // Instantiate Supabase client for other API calls
    const supabase = createClient();

    const messagesRef = useRef<Message[]>(messages);
    useEffect(() => { messagesRef.current = messages; }, [messages]);
    useEffect(() => {
      if (filesForNextMessageRef.current.length > 0) {
        const lastMsg = messagesRef.current[messagesRef.current.length - 1];
        if (lastMsg?.role === 'user') {
          const filesWithId = filesForNextMessageRef.current.map(file => ({ ...file, messageId: lastMsg.id }));
          setAllAttachments(prev => [...prev, ...filesWithId]); filesForNextMessageRef.current = [];
        }
      }
    }, [messages]);

    // --- State ---
    const [showPlusMenu, setShowPlusMenu] = useState(false)
    const [showRecordUI, setShowRecordUI] = useState(false)
    const [isRecording, setIsRecording] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [recordUIVisible, setRecordUIVisible] = useState(true)
    const [attachedFiles, setAttachedFiles] = useState<AttachmentFile[]>([])
    const [allAttachments, setAllAttachments] = useState<AttachmentFile[]>([])
    const [hoveredMessage, setHoveredMessage] = useState<string | null>(null)
    const isMobile = useMobile()
    const [copyState, setCopyState] = useState<{ id: string; copied: boolean }>({ id: "", copied: false })
    const [showScrollToBottom, setShowScrollToBottom] = useState(false)
    const { theme } = useTheme()
    const [pendingAction, setPendingAction] = useState<string | null>(null);

    // --- Refs ---
    const plusMenuRef = useRef<HTMLDivElement>(null)
    const recordUIRef = useRef<HTMLDivElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const statusRecordingRef = useRef<HTMLSpanElement>(null)
    const inputContainerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const messagesContainerRef = useRef<HTMLDivElement>(null)
    const userHasScrolledRef = useRef(false)
    const prevScrollTopRef = useRef<number>(0);
    const filesForNextMessageRef = useRef<AttachmentFile[]>([]);
    const baseRecordingTimeRef = useRef(0);
    const lastFetchTimestampRef = useRef(0);
    const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const pendingActionRef = useRef<string | null>(null);
    const localTimerIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const timerDisplayRef = useRef<HTMLSpanElement>(null);
    const recordControlsTimerDisplayRef = useRef<HTMLSpanElement>(null);

    useEffect(() => { pendingActionRef.current = pendingAction; }, [pendingAction]);

    // --- State Restoration Effect ---
    useEffect(() => {
        const restoreSession = async () => {
            const storedSession = localStorage.getItem(ACTIVE_RECORDING_SESSION_KEY);
            if (!storedSession) {
                 console.log("No active recording session found in localStorage.");
                 // Ensure URL params are still set if no localStorage found
                 const agent = searchParams.get('agent');
                 const event = searchParams.get('event');
                 setAgentName(agent);
                 setEventId(event);
                 if (agent) setIsReady(true);
                 else console.warn("Chat Interface Waiting: Agent parameter missing.");
                 return;
             }

            console.log("Found active recording session in localStorage:", storedSession);
            localStorage.removeItem(ACTIVE_RECORDING_SESSION_KEY); // Clear immediately after reading

            let parsedSession: { agentName: string; eventId: string; isRecording: boolean; isPaused: boolean; };
            try {
                parsedSession = JSON.parse(storedSession);
            } catch (e) {
                console.error("Error parsing stored session:", e);
                // Fallback to URL params if parsing fails
                const agent = searchParams.get('agent');
                const event = searchParams.get('event');
                setAgentName(agent);
                setEventId(event);
                if (agent) setIsReady(true);
                 else console.warn("Chat Interface Waiting: Agent parameter missing.");
                return;
            }

             // Set agent/event from stored data FIRST
             setAgentName(parsedSession.agentName);
             setEventId(parsedSession.eventId);
             setIsReady(true); // Assume ready if we have stored data

            console.log(`Attempting to restore session for Agent: ${parsedSession.agentName}, Event: ${parsedSession.eventId}`);

            // Fetch current backend status to verify
            try {
                console.log("Fetching current backend status...");
                // Fetch Supabase token for the API call
                const { data: { session }, error: sessionError } = await supabase.auth.getSession();
                if (sessionError || !session) {
                    throw new Error("Authentication required to fetch status.");
                }
                const response = await fetch(`/api/recording-proxy`, {
                     headers: { 'Authorization': `Bearer ${session.access_token}` }
                });

                if (!response.ok) {
                    const errorBody = await response.text().catch(() => `Status ${response.status}`);
                    throw new Error(`Backend status fetch failed: ${response.status} - ${errorBody}`);
                }
                const backendStatus: BackendRecordingStatus = await response.json();
                console.log("Received backend status:", backendStatus);

                // --- Restore Logic ---
                // Case 1: Backend confirms recording is PAUSED for the right agent/event
                if (
                    backendStatus.is_recording &&
                    backendStatus.is_paused &&
                    backendStatus.agent === parsedSession.agentName &&
                    backendStatus.event === parsedSession.eventId
                ) {
                    console.log("Backend confirms paused recording session. Restoring state.");
                    updateFrontendStateFromBackendStatus(backendStatus);
                    setShowRecordUI(true); // Show the controls as paused
                    setRecordUIVisible(true);
                    startHideTimeout();
                }
                // Case 2: Backend confirms recording is ACTIVE (not paused) for the right agent/event
                // This handles cases where the beforeunload pause might have failed but the session is still running.
                else if (
                    backendStatus.is_recording &&
                    !backendStatus.is_paused && // Explicitly check it's not paused
                    backendStatus.agent === parsedSession.agentName &&
                    backendStatus.event === parsedSession.eventId
                ) {
                    console.warn("Backend reports recording is still active (beforeunload pause likely failed). Restoring active state based on backend.");
                    updateFrontendStateFromBackendStatus(backendStatus); // Restore based on what backend says
                    setShowRecordUI(true); // Show controls as active/running
                    setRecordUIVisible(true);
                    startHideTimeout();
                }
                // Case 3: Backend reports not recording, or agent/event mismatch
                else {
                    console.warn("Backend status does not match expected state (not recording, or wrong agent/event). Resetting frontend recording state.", { backendStatus, parsedSession });
                    // Reset frontend state if backend doesn't match or isn't recording
                    setIsRecording(false);
                    setIsPaused(false);
                    updateTimerDisplays(0);
                    setShowRecordUI(false);
                }
            } catch (error: any) {
                console.error("Error fetching/reconciling backend status:", error.message);
                append({ role: 'system', content: `Error restoring recording: ${error.message}` });
                // Reset frontend state on error
                setIsRecording(false);
                setIsPaused(false);
                updateTimerDisplays(0);
                setShowRecordUI(false);
            }
        };

        restoreSession();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Run only once on mount


    // Helper to update BOTH timer displays directly via ref
    const updateTimerDisplays = useCallback((timeInSeconds: number) => {
        const formattedTime = formatTime(timeInSeconds);
        if (timerDisplayRef.current) timerDisplayRef.current.textContent = formattedTime;
        if (recordControlsTimerDisplayRef.current) recordControlsTimerDisplayRef.current.textContent = formattedTime;
    }, []);

    // Update React state and timer refs based on confirmed backend status
    const updateFrontendStateFromBackendStatus = useCallback((status: BackendRecordingStatus) => {
        const statusChanged = isRecording !== status.is_recording || isPaused !== status.is_paused;
        if (isRecording !== status.is_recording) setIsRecording(status.is_recording);
        if (isPaused !== status.is_paused) setIsPaused(status.is_paused);
        baseRecordingTimeRef.current = status.elapsed_time || 0;
        lastFetchTimestampRef.current = Date.now();
        if (statusChanged || !status.is_recording) {
             updateTimerDisplays(status.elapsed_time || 0);
        }
    }, [isRecording, isPaused, updateTimerDisplays]);

    // Fetch status from backend (polling), guarded by pendingActionRef
    const fetchStatus = useCallback(async (logSource?: string) => {
        if (pendingActionRef.current) return;
        if (!isReady) return;
        try {
            // Fetch Supabase token for the API call
             const { data: { session }, error: sessionError } = await supabase.auth.getSession();
             if (sessionError || !session) {
                 console.warn(`Fetch Status (${logSource}): No session, cannot fetch.`);
                 // Optionally attempt logout or redirect here if needed
                 return;
             }
            const response = await fetch(`/api/recording-proxy`, {
                 headers: { 'Authorization': `Bearer ${session.access_token}` }
            });
            // Handle 401/403 from status fetch
            if (response.status === 401 || response.status === 403) {
                console.warn(`Fetch Status (${logSource}): Unauthorized (${response.status}).`);
                // Optionally handle logout/redirect
                return;
            }
            if (!response.ok) throw new Error(`Status fetch failed: ${response.status}`);
            const data: BackendRecordingStatus = await response.json();
            updateFrontendStateFromBackendStatus(data);
        } catch (error: any) { console.error(`Error fetching status (source: ${logSource}):`, error.message); }
    }, [isReady, updateFrontendStateFromBackendStatus, supabase.auth]);

    // Initial status fetch - now handled by restoreSession effect

    // Status polling interval
    useEffect(() => {
        if (isReady && isRecording) {
            if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = setInterval(() => fetchStatus("polling interval"), 1000); // Reduced interval for faster updates
        } else {
            if (pollingIntervalRef.current) { clearInterval(pollingIntervalRef.current); pollingIntervalRef.current = null; }
        }
        return () => { if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current); };
    }, [isReady, isRecording, fetchStatus]);

    // Local timer effect for smooth UI updates via DOM
    useEffect(() => {
        if (localTimerIntervalRef.current) clearInterval(localTimerIntervalRef.current);
        if (isRecording && !isPaused) {
             if (lastFetchTimestampRef.current > 0 || baseRecordingTimeRef.current > 0) {
                localTimerIntervalRef.current = setInterval(() => {
                    const elapsedSinceFetch = (Date.now() - lastFetchTimestampRef.current) / 1000;
                    const calculatedTime = Math.max(0, baseRecordingTimeRef.current + elapsedSinceFetch);
                    updateTimerDisplays(calculatedTime);
                }, 1000);
             } else { updateTimerDisplays(baseRecordingTimeRef.current); }
        } else { updateTimerDisplays(baseRecordingTimeRef.current); }
        return () => { if (localTimerIntervalRef.current) clearInterval(localTimerIntervalRef.current); };
    }, [isRecording, isPaused, updateTimerDisplays]);

    // --- Before Unload Effect ---
    useEffect(() => {
        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
             // Use refs to access the latest state without causing re-renders
             if (pendingActionRef.current) {
                 console.log("beforeunload: Pending action, not pausing/saving.");
                 return;
             }
            if (isRecording) { // Check component state directly here
                console.log("beforeunload: Recording active. Saving state and attempting pause.");
                const sessionState = {
                    agentName: agentName, // Use state variable
                    eventId: eventId,     // Use state variable
                    isRecording: true,
                    isPaused: true // Assume pause is successful
                };
                try {
                    localStorage.setItem(ACTIVE_RECORDING_SESSION_KEY, JSON.stringify(sessionState));
                    console.log("beforeunload: Saved session state to localStorage:", sessionState);
                } catch (e) {
                    console.error("beforeunload: Error saving state to localStorage:", e);
                }

                // Attempt to pause backend - Fire and forget using keepalive
                 // Need to get token synchronously if possible, or skip if not available
                 // Note: navigator.sendBeacon is preferred for reliability but requires endpoint changes
                 // Trying fetch with keepalive, but cannot await async token fetch here.
                 // Best effort: If a token was recently fetched/available it might work.
                 // THIS IS UNRELIABLE for sending auth headers in beforeunload.
                 // Consider alternative approaches if reliable pause on close is critical.
                const payload = { action: 'pause' };
                try {
                    // Cannot reliably get auth token here synchronously.
                    // Send without auth header as a fallback, backend might reject.
                    fetch('/api/recording-proxy', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }, // Sending without Auth
                        body: JSON.stringify(payload),
                        keepalive: true, // Crucial for beforeunload
                    });
                     console.log("beforeunload: Sent pause request to backend (keepalive, no auth).");
                } catch (e) {
                    console.error("beforeunload: Error sending pause request:", e);
                }
            } else {
                 console.log("beforeunload: Not recording. Clearing any stale session state.");
                 try {
                     localStorage.removeItem(ACTIVE_RECORDING_SESSION_KEY);
                 } catch (e) {
                      console.error("beforeunload: Error removing state from localStorage:", e);
                 }
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [isRecording, agentName, eventId]); // Depend on state variables that influence the handler's logic

    // --- Attachments Effect ---
    useEffect(() => { if (onAttachmentsUpdate) onAttachmentsUpdate(allAttachments); }, [allAttachments, onAttachmentsUpdate]);

    // --- API Call Handler ---
    const callRecordingApi = useCallback(async (action: string, payload?: any): Promise<{ success: boolean, newStatus?: BackendRecordingStatus }> => {
         setPendingAction(action);
         const apiUrl = `/api/recording-proxy`;
         if (!isReady || !agentName ) { append({ role: 'system', content: `Error: Cannot ${action}. Agent missing.` }); setPendingAction(null); return { success: false }; }

         // Fetch Supabase token for the API call
         const { data: { session }, error: sessionError } = await supabase.auth.getSession();
         const headers: HeadersInit = { 'Content-Type': 'application/json' };
         if (session?.access_token) {
           headers['Authorization'] = `Bearer ${session.access_token}`;
         } else {
             console.warn(`No Supabase token found for recording action: ${action}`);
             append({ role: 'system', content: `Error: Authentication missing.` });
             setPendingAction(null);
             return { success: false };
         }

         try {
             await new Promise(resolve => setTimeout(resolve, 50));
             // Use updated headers
             const response = await fetch(apiUrl, { method: 'POST', headers: headers, body: JSON.stringify({ action, payload }) });

             // Improved error handling for non-JSON responses (like 401/403 HTML pages)
             let data;
             if (response.headers.get('content-type')?.includes('application/json')) {
                 data = await response.json();
             } else {
                 // If not JSON, read as text and create a basic error object
                 const errorText = await response.text();
                 data = { message: errorText || `Request failed with status ${response.status}` };
                 // Throw an error if response was not OK, using the text as message
                 if (!response.ok) throw new Error(data.message);
             }

             if (!response.ok) throw new Error(data.message || data.error || `Failed action '${action}'`);

             let statusReceived = data.recording_status;
             if (statusReceived) { updateFrontendStateFromBackendStatus(statusReceived); }
             else { console.warn(`API response missing 'recording_status'. Polling.`); await fetchStatus(`after ${action} success_NO_STATUS`); const finalStatusResponse = await fetch(`/api/recording-proxy`, { headers: { 'Authorization': `Bearer ${session.access_token}` }}); if (finalStatusResponse.ok) { statusReceived = await finalStatusResponse.json(); } }
             setPendingAction(null);
             return { success: true, newStatus: statusReceived };
         } catch (error: any) {
             console.error(`API Error (${action}):`, error);
             append({ role: 'system', content: `Error: Failed to ${action}. ${error?.message}` });
             await fetchStatus(`after ${action} ERROR`); // Fetch status even after error
             setPendingAction(null);
             return { success: false };
         }
        }, [isReady, agentName, append, fetchStatus, updateFrontendStateFromBackendStatus, supabase.auth]); // Added supabase.auth

        // --- Action Handlers (Moved stopRecording earlier) ---
        const stopRecording = useCallback(async (e?: React.MouseEvent) => {
            e?.stopPropagation();
            if (pendingActionRef.current) return;
            setIsRecording(false); setIsPaused(false); // Optimistic Stop
            updateTimerDisplays(0); // Optimistic time reset
            // Keep controls visible while pending
            const result = await callRecordingApi('stop');
            // Clear localStorage on explicit stop, AFTER backend call attempt
            try { localStorage.removeItem(ACTIVE_RECORDING_SESSION_KEY); console.log("Cleared localStorage on stop."); } catch(e) { console.error("Error clearing localStorage on stop:", e); }
            // Hide controls after successful stop or error
            if (result.success || !result.success) { // Hide regardless of success/fail now
                 setShowRecordUI(false);
             }
        }, [callRecordingApi, updateTimerDisplays]);

        // --- Imperative Handle ---
         useImperativeHandle(ref, () => ({
            startNewChat: async () => {
                 if (isRecording) await stopRecording(); // Now stopRecording is defined
                 setMessages([]); setAttachedFiles([]); setAllAttachments([]); filesForNextMessageRef.current = [];
                 updateTimerDisplays(0);
              // Ensure localStorage is cleared even if not recording
              try { localStorage.removeItem(ACTIVE_RECORDING_SESSION_KEY); } catch(e) { console.error("Error clearing localStorage on new chat:", e); }
          },
         getMessagesCount: () => messages.length,
         scrollToTop: () => { messagesContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); userHasScrolledRef.current = false; setShowScrollToBottom(false); },
     }), [isRecording, setMessages, messages.length, stopRecording, updateTimerDisplays]); // Add stopRecording


    // --- Scrolling ---
    const checkScroll = useCallback(() => { const c = messagesContainerRef.current; if (!c) return; const { scrollTop: st, scrollHeight: sh, clientHeight: ch } = c; const isScrollable = sh > ch; const isBottom = sh - st - ch < 2; if (st < prevScrollTopRef.current && !isBottom && !userHasScrolledRef.current) userHasScrolledRef.current = true; else if (userHasScrolledRef.current && isBottom) userHasScrolledRef.current = false; prevScrollTopRef.current = st; setShowScrollToBottom(isScrollable && !isBottom); }, []);
    const scrollToBottom = useCallback((b: ScrollBehavior = "smooth") => { if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: b }); userHasScrolledRef.current = false; setShowScrollToBottom(false); }, []);
    useEffect(() => { if (!userHasScrolledRef.current) { const id = requestAnimationFrame(() => { setTimeout(() => { scrollToBottom('smooth'); }, 50); }); return () => cancelAnimationFrame(id); } else if (!isLoading && userHasScrolledRef.current) checkScroll(); }, [messages, isLoading, scrollToBottom, checkScroll]);
    useEffect(() => { const c = messagesContainerRef.current; if (c) { c.addEventListener("scroll", checkScroll, { passive: true }); return () => c.removeEventListener("scroll", checkScroll); } }, [checkScroll]);

    // --- UI Visibility/Interaction (Hide Logic Updated) ---
    const hideRecordUI = useCallback(() => {
         if (pendingActionRef.current) return; // Don't hide if pending
         setRecordUIVisible(false);
         setTimeout(() => { setShowRecordUI(false); setRecordUIVisible(true); }, 300);
     }, []);

    const startHideTimeout = useCallback(() => {
         if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
         // Set timeout ONLY if no action is pending (allow hide even if recording)
         if (!pendingActionRef.current) {
              hideTimeoutRef.current = setTimeout(hideRecordUI, 3000);
          }
     }, [hideRecordUI]); // Removed isRecording/isPaused deps

    useEffect(() => { // Global click listener
         const handleClick = (e: MouseEvent) => {
             const isOutsideControls = showRecordUI && recordUIRef.current && !recordUIRef.current.contains(e.target as Node);
             const isOutsideTrigger = statusRecordingRef.current && !statusRecordingRef.current.contains(e.target as Node);

             // Hide if click is outside and no action is pending
             if (isOutsideControls && isOutsideTrigger && !pendingActionRef.current) {
                 hideRecordUI();
             }
             // Hide plus menu if click is outside
             if (showPlusMenu && plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
                 setShowPlusMenu(false);
             }
         };
         document.addEventListener("mousedown", handleClick, true);
         return () => document.removeEventListener("mousedown", handleClick, true);
     }, [showRecordUI, showPlusMenu, hideRecordUI]);

    useEffect(() => { // Mouse hover trigger
         const el = statusRecordingRef.current; if (!el) return;
         const enter = () => { if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current); setRecordUIVisible(true); setShowRecordUI(true); };
         const leave = () => startHideTimeout();
         el.addEventListener("mouseenter", enter); el.addEventListener("mouseleave", leave);
         return () => { el.removeEventListener("mouseenter", enter); el.removeEventListener("mouseleave", leave); };
     }, [startHideTimeout]);

    useEffect(() => { return () => { if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current); }; }, []); // Unmount cleanup

    // --- Action Handlers ---
    const showAndPrepareRecordingControls = useCallback(() => { if (pendingActionRef.current) return; setShowPlusMenu(false); setShowRecordUI(true); setRecordUIVisible(true); if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current); fetchStatus("showAndPrepare"); startHideTimeout(); }, [pendingActionRef, fetchStatus, startHideTimeout]);

    const handlePlayPauseClick = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (pendingActionRef.current) return;
        let actionToPerform: string; let payloadForAction: { agent: string | null; event: string } | undefined = undefined;
        const currentIsRecording = isRecording; const currentIsPaused = isPaused;

        if (!currentIsRecording) {
            actionToPerform = 'start'; payloadForAction = { agent: agentName, event: eventId || '0000' };
            setIsRecording(true); setIsPaused(false); // Optimistic UI update
            baseRecordingTimeRef.current = 0; lastFetchTimestampRef.current = Date.now();
            updateTimerDisplays(0);
        }
        else if (currentIsPaused) {
            actionToPerform = 'resume';
            setIsPaused(false); // Optimistic UI update
        }
        else {
            actionToPerform = 'pause';
            setIsPaused(true); // Optimistic UI update
        }

        await callRecordingApi(actionToPerform, payloadForAction);
    }, [isRecording, isPaused, callRecordingApi, agentName, eventId, updateTimerDisplays]);


    // --- Other Handlers ---
    const saveChat = useCallback(() => { const chatContent = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n"); const blob = new Blob([chatContent], { type: "text/plain" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `chat-${agentName || 'agent'}-${eventId || 'event'}-${new Date().toISOString().slice(0, 10)}.txt`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); setShowPlusMenu(false); }, [messages, agentName, eventId]);
    const attachDocument = useCallback(() => { fileInputRef.current?.click(); setShowPlusMenu(false); }, []);
    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files && e.target.files.length > 0) { const newFiles = Array.from(e.target.files).map((file) => ({ id: Math.random().toString(36).substring(2, 9), name: file.name, size: file.size, type: file.type, url: URL.createObjectURL(file), })); setAttachedFiles((prev) => [...prev, ...newFiles]); } if (fileInputRef.current) fileInputRef.current.value = ""; }, []);
    const removeFile = useCallback((id: string) => { setAttachedFiles((prev) => { const fileToRemove = prev.find((file) => file.id === id); if (fileToRemove?.url) URL.revokeObjectURL(fileToRemove.url); return prev.filter((file) => file.id !== id); }); }, []);
    const handleRecordUIMouseMove = useCallback(() => { if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current); setRecordUIVisible(true); startHideTimeout(); }, [startHideTimeout]);
    const handlePlusMenuClick = useCallback((e: React.MouseEvent) => { e.stopPropagation(); if (showRecordUI && !isRecording) hideRecordUI(); setShowPlusMenu(prev => !prev); }, [showRecordUI, isRecording, hideRecordUI]);
    const handleMessageInteraction = useCallback((id: string) => { if (isMobile) setHoveredMessage(prev => prev === id ? null : id); }, [isMobile]);
    const copyToClipboard = useCallback((text: string, id: string) => { const notifySuccess = () => { setCopyState({ id, copied: true }); setTimeout(() => { setCopyState({ id: "", copied: false }); }, 2000); }; const notifyFailure = (err?: any) => { console.error("Failed copy: ", err); setCopyState({ id, copied: false }); }; if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(notifySuccess).catch(notifyFailure); } else { console.warn("Fallback copy (execCommand)."); try { const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.left = "-9999px"; ta.style.top = "-9999px"; document.body.appendChild(ta); ta.focus(); ta.select(); const ok = document.execCommand('copy'); document.body.removeChild(ta); if (ok) notifySuccess(); else throw new Error('execCommand fail'); } catch (err) { notifyFailure(err); } } }, []);
    const editMessage = useCallback((id: string) => console.log("Edit:", id), []);
    const readAloud = useCallback((text: string) => console.log("Read:", text), []);
    const onSubmit = useCallback((e: React.FormEvent<HTMLFormElement> | React.KeyboardEvent<HTMLInputElement>) => { e.preventDefault(); if (!isReady) { append({ role: 'system', content: "Error: Agent/Event not set." }); return; } if (isLoading) stop(); else if (input.trim() || attachedFiles.length > 0) { if (attachedFiles.length > 0) { filesForNextMessageRef.current = [...attachedFiles]; setAttachedFiles([]); } else filesForNextMessageRef.current = []; userHasScrolledRef.current = false; setShowScrollToBottom(false); originalHandleSubmit(e as React.FormEvent<HTMLFormElement>); } }, [input, isLoading, isReady, stop, originalHandleSubmit, attachedFiles, append, setAttachedFiles]);
    useEffect(() => { const lKeyDown = (e: KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey && !isLoading && (input.trim() || attachedFiles.length > 0)) { e.preventDefault(); onSubmit(e as any); } else if (e.key === "Enter" && !e.shiftKey && isLoading) e.preventDefault(); }; const el = inputRef.current; if (el) el.addEventListener("keydown", lKeyDown as EventListener); return () => { if (el) el.removeEventListener("keydown", lKeyDown as EventListener); } }, [input, isLoading, stop, attachedFiles.length, onSubmit]);

    // --- Render ---
    // Log state just before rendering buttons
    console.log(`Rendering with isRecording=${isRecording}, isPaused=${isPaused}, pendingAction=${pendingAction}`);

    return (
        <div className="flex flex-col h-full">
            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto messages-container" ref={messagesContainerRef}>
                {messages.length === 0 && !isReady && ( <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-10"> <p className="text-2xl md:text-3xl font-bold text-center opacity-50">Loading...</p> </div> )}
                {messages.length === 0 && isReady && ( <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-10"> <p className="text-2xl md:text-3xl font-bold text-center opacity-80">What is alive today?</p> </div> )}
                {messages.length > 0 && ( <div> {messages.map((message: Message) => { const isUser = message.role === "user"; const isSystem = message.role === "system"; const messageAttachments = allAttachments.filter((file) => file.messageId === message.id); const hasAttachments = messageAttachments.length > 0; return ( <motion.div key={message.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }} className={cn( "flex flex-col relative group mb-1", isUser ? "items-end" : isSystem ? "items-center" : "items-start", !isUser && !isSystem && "mb-4" )} onMouseEnter={() => !isMobile && !isSystem && setHoveredMessage(message.id)} onMouseLeave={() => !isMobile && setHoveredMessage(null)} onClick={() => !isSystem && handleMessageInteraction(message.id)} > {isUser && hasAttachments && ( <div className="mb-2 file-attachment-wrapper self-end mr-1"> <FileAttachmentMinimal files={messageAttachments} onRemove={() => {}} className="file-attachment-message" maxVisible={1} isSubmitted={true} messageId={message.id} /> </div> )} <div className={`rounded-2xl p-3 message-bubble ${ isUser ? `bg-input-gray text-black user-bubble ${hasAttachments ? "with-attachment" : ""}` : isSystem ? `bg-transparent text-muted-foreground text-sm italic text-center max-w-[90%]` : "bg-transparent text-white ai-bubble pl-0" }`}> <span dangerouslySetInnerHTML={{ __html: message.content.replace(/\n/g, '<br />') }} /> </div> {!isSystem && ( <div className={cn( "message-actions flex", isUser ? "justify-end mr-1 mt-1" : "justify-start ml-1 -mt-2" )} style={{ opacity: hoveredMessage === message.id || copyState.id === message.id ? 1 : 0, visibility: hoveredMessage === message.id || copyState.id === message.id ? "visible" : "hidden", transition: 'opacity 0.2s ease-in-out', }} > {isUser && ( <div className="flex"> <button onClick={(e) => { e.stopPropagation(); copyToClipboard(message.content, message.id); }} className="action-button" aria-label="Copy message"> {copyState.id === message.id && copyState.copied ? <Check className="h-4 w-4 copy-button-animation" /> : <Copy className="h-4 w-4" />} </button> <button onClick={() => editMessage(message.id)} className="action-button" aria-label="Edit message"> <Pencil className="h-4 w-4" /> </button> </div> )} {!isUser && ( <div className="flex"> <button onClick={(e) => { e.stopPropagation(); copyToClipboard(message.content, message.id); }} className="action-button" aria-label="Copy message"> {copyState.id === message.id && copyState.copied ? <Check className="h-4 w-4 copy-button-animation" /> : <Copy className="h-4 w-4" />} </button> {hoveredMessage === message.id && ( <button onClick={() => readAloud(message.content)} className="action-button" aria-label="Read message aloud"> <Volume2 className="h-4 w-4" /> </button> )} </div> )} </div> )} </motion.div> ); })} </div> )}
                {isLoading && messages[messages.length - 1]?.role === 'user' && ( <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="thinking-indicator flex self-start mb-1 mt-1 ml-1"> <span className="thinking-dot"></span> </motion.div> )}
                <div ref={messagesEndRef} />
            </div>

            {/* Scroll Button */}
            {showScrollToBottom && ( <button onClick={() => scrollToBottom()} className="scroll-to-bottom-button" aria-label="Scroll to bottom"> <ChevronDown size={24} /> </button> )}

            {/* Input Area */}
            <div className="p-2 input-area-container">
                {attachedFiles.length > 0 && ( <div className="flex justify-end mb-0.5 input-attachments-container"> <FileAttachmentMinimal files={attachedFiles} onRemove={removeFile} className="max-w-[50%] file-attachment-container" maxVisible={1} /> </div> )}
                <form onSubmit={onSubmit} className="relative">
                    <div className="bg-input-gray rounded-full p-2 flex items-center" ref={inputContainerRef}>
                        <div className="relative" ref={plusMenuRef}>
                            <button type="button" className={cn("p-2 text-gray-600 hover:text-gray-800", pendingAction && "opacity-50 cursor-not-allowed")} onClick={handlePlusMenuClick} aria-label="More options" disabled={!!pendingAction}> <Plus size={20} /> </button>
                            {showPlusMenu && ( <motion.div initial={{ opacity: 0, scale: 0.9, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 10 }} transition={{ duration: 0.2 }} className="absolute left-0 bottom-full mb-2 bg-input-gray rounded-full py-2 shadow-lg z-10 flex flex-col items-center plus-menu" > <button type="button" className="p-2 plus-menu-item" onClick={attachDocument} title="Attach file"><Paperclip size={20} /></button> <button type="button" className="p-2 plus-menu-item" onClick={saveChat} title="Save chat"><Download size={20} /></button> <button type="button" className={cn("p-2 plus-menu-item", isRecording && "recording", isPaused && "paused")} onClick={showAndPrepareRecordingControls} title={isRecording ? (isPaused ? "Recording Paused" : "Recording Live") : "Open recording controls"} > <Mic size={20} /> </button> </motion.div> )}
                        </div>
                        <div className="relative" ref={recordUIRef}>
                             {showRecordUI && (
                                <motion.div initial={{ opacity: 0, scale: 0.9, y: 10 }} animate={{ opacity: recordUIVisible ? 1 : 0, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 10 }} transition={{ duration: 0.3 }} className="absolute bottom-full mb-3 bg-input-gray rounded-full py-2 px-3 shadow-lg z-10 flex items-center gap-2 record-ui" onMouseMove={handleRecordUIMouseMove} onClick={(e) => e.stopPropagation()} >
                                    <button type="button" className={cn("p-1 record-ui-button", (pendingAction === 'start' || pendingAction === 'pause' || pendingAction === 'resume') && "opacity-50 cursor-wait")} onClick={handlePlayPauseClick} disabled={!!pendingAction} aria-label={!isRecording ? "Start recording" : (isPaused ? "Resume recording" : "Pause recording")}>
                                        {(pendingAction === 'start' || pendingAction === 'pause' || pendingAction === 'resume') ? <Loader2 className="h-5 w-5 animate-spin" /> : (isRecording && !isPaused ? <Pause size={20} className="text-red-500" /> : <Play size={20} className={cn(isPaused ? "text-yellow-500" : "", !isRecording && "text-gray-700 dark:text-gray-700")} />)}
                                    </button>
                                    <button type="button" className={cn("p-1 record-ui-button", pendingAction === 'stop' && "opacity-50 cursor-wait")} onClick={stopRecording} disabled={!isRecording || !!pendingAction} aria-label="Stop recording">
                                         {pendingAction === 'stop' ? <Loader2 className="h-5 w-5 animate-spin" /> : <StopCircle size={20} className={!isRecording ? "text-gray-400 dark:text-gray-400" : "text-gray-700 dark:text-gray-700"}/>}
                                    </button>
                                    {/* Controls Timer Span */}
                                    {isRecording && <span ref={recordControlsTimerDisplayRef} className="text-sm font-medium text-gray-700 dark:text-gray-700 ml-1">{formatTime(baseRecordingTimeRef.current)}</span>}
                                </motion.div>
                             )}
                        </div>
                        <input ref={inputRef} value={input} onChange={handleInputChange} placeholder={!isReady ? "Waiting for Agent/Event..." : "Ask anything"} className="flex-1 px-3 py-1 bg-transparent border-none outline-none text-black dark:text-black" disabled={!isReady || !!pendingAction} aria-label="Chat input" />
                        <button type="submit"
                            className={cn( "p-2 transition-all duration-200", (!isReady || (!input.trim() && attachedFiles.length === 0 && !isLoading)) && (theme === 'light' ? "text-gray-400" : "text-gray-400"), isReady && (input.trim() || attachedFiles.length > 0) && !isLoading && (theme === 'light' ? "text-gray-800 hover:text-black" : "text-black hover:opacity-80"), isLoading && (theme === 'light' ? "text-gray-800" : "text-black") )}
                            disabled={!isReady || (!input.trim() && attachedFiles.length === 0 && !isLoading) || !!pendingAction}
                            aria-label={isLoading ? "Stop generating" : "Send message"} >
                            {isLoading ? <Square size={20} className="fill-current h-5 w-5 opacity-70" /> : <ArrowUp size={24} /> }
                        </button>
                    </div>
                    <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} multiple accept=".txt,.md,.json,.pdf,.docx" />
                </form>
                {/* Status Bar */}
                <div className={cn("text-center text-foreground/70 dark:text-foreground/70 text-xs pt-4 pb-2 font-light status-bar", pendingAction && "opacity-50")}>
                    <span className="lowercase">{agentName || '...'}</span> / <span className="lowercase">{eventId || '...'}</span> |{" "}
                    <span ref={statusRecordingRef} className="cursor-pointer" onClick={showAndPrepareRecordingControls} title={isRecording ? "Recording Status" : "Open recording controls"} >
                         listen:{" "}
                        {isRecording ? (
                            isPaused ? ( <>paused <span className="inline-block ml-1 h-2 w-2 rounded-full bg-yellow-500"></span></> )
                                     : ( <>live <span className="inline-block ml-1 h-2 w-2 rounded-full bg-red-500 animate-pulse"></span></> )
                        ) : ( "no" )}
                        {/* Status Bar Timer Span */}
                        {isRecording && <span ref={timerDisplayRef} className="ml-1">{formatTime(baseRecordingTimeRef.current)}</span>}
                    </span>
                </div>
            </div>
        </div>
    )
});

export default SimpleChatInterface;