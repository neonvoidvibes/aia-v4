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

interface BackendRecordingStatus { // For HTTP status GET, not directly used by WS recording yet
    is_recording: boolean;
    is_paused: boolean;
    elapsed_time: number;
    agent?: string;
    event?: string;
    last_pause_timestamp?: number | null;
}

const formatTime = (seconds: number): string => {
    const safeSeconds = Math.max(0, seconds);
    const mins = Math.floor(safeSeconds / 60);
    const secs = Math.floor(safeSeconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

const ACTIVE_RECORDING_SESSION_KEY = "active_recording_session_v2_websocket"; // Updated key for new logic

const SimpleChatInterface = forwardRef<ChatInterfaceHandle, SimpleChatInterfaceProps>(
  function SimpleChatInterface({ onAttachmentsUpdate }, ref: React.ForwardedRef<ChatInterfaceHandle>) {

    const searchParams = useSearchParams();
    const [agentName, setAgentName] = useState<string | null>(null);
    const [eventId, setEventId] = useState<string | null>(null);
    const [isPageReady, setIsPageReady] = useState(false); // Used to gate actions until agent/event are set

    // WebSocket and Recording State
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [sessionStartTimeUTC, setSessionStartTimeUTC] = useState<string | null>(null);
    const [wsStatus, setWsStatus] = useState<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');
    const [isBrowserRecording, setIsBrowserRecording] = useState(false); // MediaRecorder is active
    const [isBrowserPaused, setIsBrowserPaused] = useState(false);    // MediaRecorder is paused
    const [clientRecordingTime, setClientRecordingTime] = useState(0); // Timer displayed on UI

    const wsRef = useRef<WebSocket | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioStreamRef = useRef<MediaStream | null>(null);
    const localRecordingTimerRef = useRef<NodeJS.Timeout | null>(null);


    useEffect(() => {
        const agentParam = searchParams.get('agent');
        const eventParam = searchParams.get('event');
        if (agentParam) {
            setAgentName(agentParam);
            setEventId(eventParam); // Can be null
            setIsPageReady(true);
        } else {
            console.warn("Chat Interface Waiting: Agent parameter missing from URL.");
            setIsPageReady(false);
        }
    }, [searchParams]);

    const {
      messages, input, handleInputChange, handleSubmit: originalHandleSubmit,
      isLoading, stop, setMessages, append,
    } = useChat({
      api: "/api/proxy-chat",
      body: { agent: agentName, event: eventId || '0000' }, // Ensure agentName and eventId are updated
      sendExtraMessageFields: true,
      onError: (error) => { append({ role: 'system', content: `Error: ${error.message}` }); },
    });

    useEffect(() => {
        if (agentName) {
            console.log(`Chat interface ready for agent: ${agentName}, event: ${eventId || 'N/A'}`);
        }
    }, [agentName, eventId]);


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

    // --- Refs (UI/UX and Recording) ---
    const plusMenuRef = useRef<HTMLDivElement>(null);
    const recordUIRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const statusRecordingRef = useRef<HTMLSpanElement>(null); // This is the "listen: yes/no" text
    const inputContainerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const userHasScrolledRef = useRef(false);
    const prevScrollTopRef = useRef<number>(0);
    const filesForNextMessageRef = useRef<AttachmentFile[]>([]);
    const timerDisplayRef = useRef<HTMLSpanElement>(null); // In status bar
    const recordControlsTimerDisplayRef = useRef<HTMLSpanElement>(null); // In record UI panel
    const pendingActionRef = useRef<string | null>(null); // Ref for pendingAction

    // --- State (UI/UX and Recording) ---
    const [showPlusMenu, setShowPlusMenu] = useState(false);
    const [showRecordUI, setShowRecordUI] = useState(false); // Controls visibility of the detached record UI panel
    const [recordUIVisible, setRecordUIVisible] = useState(true); // For fading effect of the record UI panel
    const [attachedFiles, setAttachedFiles] = useState<AttachmentFile[]>([]);
    const [allAttachments, setAllAttachments] = useState<AttachmentFile[]>([]);
    const [hoveredMessage, setHoveredMessage] = useState<string | null>(null);
    const isMobile = useMobile();
    const [copyState, setCopyState] = useState<{ id: string; copied: boolean }>({ id: "", copied: false });
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
    const { theme } = useTheme();
    const [pendingAction, setPendingAction] = useState<string | null>(null);
    useEffect(() => { pendingActionRef.current = pendingAction; }, [pendingAction]);


    // --- UI Visibility/Interaction for Record UI (Moved Up) ---
    const hideRecordUI = useCallback(() => {
         if (pendingActionRef.current) return; // Don't hide if pending
         setRecordUIVisible(false);
         setTimeout(() => { setShowRecordUI(false); setRecordUIVisible(true); }, 300);
     }, []); // pendingActionRef is stable

    const startHideTimeout = useCallback(() => {
         if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
         if (!pendingActionRef.current) { // Set timeout ONLY if no action is pending
              hideTimeoutRef.current = setTimeout(hideRecordUI, 3000);
          }
     }, [hideRecordUI]); // pendingActionRef is stable


    useEffect(() => {
        if (isBrowserRecording && !isBrowserPaused) {
            if (localRecordingTimerRef.current) clearInterval(localRecordingTimerRef.current);
            localRecordingTimerRef.current = setInterval(() => {
                setClientRecordingTime(prevTime => prevTime + 1);
            }, 1000);
        } else {
            if (localRecordingTimerRef.current) clearInterval(localRecordingTimerRef.current);
        }
        return () => {
            if (localRecordingTimerRef.current) clearInterval(localRecordingTimerRef.current);
        };
    }, [isBrowserRecording, isBrowserPaused]);

    useEffect(() => {
        const formattedTime = formatTime(clientRecordingTime);
        if (timerDisplayRef.current) timerDisplayRef.current.textContent = formattedTime;
        if (recordControlsTimerDisplayRef.current) recordControlsTimerDisplayRef.current.textContent = formattedTime;
    }, [clientRecordingTime]);


    // --- Attachments Effect ---
    useEffect(() => { if (onAttachmentsUpdate) onAttachmentsUpdate(allAttachments); }, [allAttachments, onAttachmentsUpdate]);

    // --- API Call Handler for HTTP actions (start, stop session) ---
    const callHttpRecordingApi = useCallback(async (action: 'start' | 'stop', payload?: any): Promise<any> => {
        setPendingAction(action);
        const apiUrl = `/api/recording-proxy/`; // Proxies to backend /api/recording/{action}
        if (!isPageReady || !agentName) {
            append({ role: 'system', content: `Error: Cannot ${action} recording. Agent/Event not set.` });
            setPendingAction(null);
            return { success: false, error: "Agent/Event not set" };
        }

        const { data: { session: supabaseSession }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !supabaseSession) {
            append({ role: 'system', content: `Error: Authentication required to ${action} recording.` });
            setPendingAction(null);
            return { success: false, error: "Authentication required" };
        }

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${supabaseSession.access_token}`
                },
                body: JSON.stringify({ action, payload })
            });

            const responseData = await response.json();
            if (!response.ok) throw new Error(responseData.message || responseData.error || `Failed action '${action}'`);
            
            setPendingAction(null);
            return { success: true, data: responseData };
        } catch (error: any) {
            console.error(`API Error (${action}):`, error);
            append({ role: 'system', content: `Error: Failed to ${action} recording. ${error?.message}` });
            setPendingAction(null);
            return { success: false, error: error?.message };
        }
    }, [isPageReady, agentName, append, supabase.auth]);


    const handleStopRecording = useCallback(async (e?: React.MouseEvent, dueToError: boolean = false) => {
        e?.stopPropagation(); // Prevent event bubbling if called from UI
        if (pendingActionRef.current && !dueToError) return; // Allow stop if due to error
        
        console.log(`Stopping recording (Error: ${dueToError}). Current states: BrowserRec=${isBrowserRecording}, WS=${wsStatus}, Session=${sessionId}`);
        setPendingAction('stop');

        // 1. Stop client-side MediaRecorder
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            mediaRecorderRef.current.stop(); // This will trigger its onstop handler for cleanup
        } else {
            // If MediaRecorder wasn't active or already stopped, still ensure stream is cleaned up
            audioStreamRef.current?.getTracks().forEach(track => track.stop());
            audioStreamRef.current = null;
        }
        setIsBrowserRecording(false);
        setIsBrowserPaused(false);
        setClientRecordingTime(0);

        // 2. Inform backend via WebSocket to stop stream processing (if WS is open)
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            console.log("WebSocket: Sending stop_stream message.");
            wsRef.current.send(JSON.stringify({ action: "stop_stream" }));
        }

        // 3. Close WebSocket connection
        if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
            console.log("WebSocket: Closing connection.");
            wsRef.current.close();
        }
        wsRef.current = null; // Clear ref
        setWsStatus('closed');

        // 4. Finalize session with backend via HTTP
        if (sessionId) {
            console.log("Calling HTTP stop for session:", sessionId);
            const result = await callHttpRecordingApi('stop', { session_id: sessionId });
            if (result.success) {
                console.log("Recording session stopped (HTTP):", result.data);
            } else {
                console.error("Failed to stop recording session (HTTP):", result.error);
                if (!dueToError) append({ role: 'system', content: `Error: Could not properly stop recording session. ${result.error || ''}` });
            }
        } else if (!dueToError) {
            console.warn("No session ID available to send HTTP stop signal.");
        }
        
        // 5. UI and state cleanup
        setShowRecordUI(false);
        setRecordUIVisible(true); // Reset fade state
        if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
        setSessionId(null); // Clear session ID
        setSessionStartTimeUTC(null);
        localStorage.removeItem(ACTIVE_RECORDING_SESSION_KEY); // Clear any lingering session key
        setPendingAction(null);
        console.log("Recording fully stopped and cleaned up.");

    }, [sessionId, callHttpRecordingApi, append, isBrowserRecording, wsStatus]);


    const startBrowserMediaRecording = useCallback(async () => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            console.error("MediaRecorder: WebSocket not open. Cannot start recording.");
            append({role: 'system', content: 'Error: Could not start microphone. Stream not ready.'});
            return;
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
             console.warn("MediaRecorder: Already recording or paused.");
             return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioStreamRef.current = stream;
            
            // Determine supported MIME type
            const options = { mimeType: 'audio/webm;codecs=opus' }; // Prefer WebM Opus
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                console.warn(`${options.mimeType} not supported. Trying default.`);
                // @ts-ignore
                delete options.mimeType; 
            }

            const newMediaRecorder = new MediaRecorder(stream, options);
            mediaRecorderRef.current = newMediaRecorder;

            newMediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(event.data);
                } else if (event.data.size > 0 && wsRef.current?.readyState !== WebSocket.OPEN) {
                    console.warn("MediaRecorder: WebSocket not open, cannot send audio data.");
                }
            };

            newMediaRecorder.onstop = () => {
                console.log("MediaRecorder: Stopped.");
                audioStreamRef.current?.getTracks().forEach(track => track.stop());
                audioStreamRef.current = null;
                setIsBrowserRecording(false);
                setIsBrowserPaused(false);
            };
            
            newMediaRecorder.onerror = (event) => {
                console.error("MediaRecorder: Error:", event);
                append({role: 'system', content: `Error: Microphone recording error.`});
                 // Attempt to stop everything if MediaRecorder errors out
                handleStopRecording(undefined, true);
            };

            newMediaRecorder.start(3000); // timeslice in ms, e.g., 3 seconds
            console.log("MediaRecorder: Started.");
            setIsBrowserRecording(true);
            setIsBrowserPaused(false);
            setClientRecordingTime(0); // Reset timer
            setShowRecordUI(true); // Show recording controls
            setRecordUIVisible(true);
            startHideTimeout();

        } catch (err) {
            console.error("MediaRecorder: Error getting user media or starting recorder:", err);
            append({ role: 'system', content: 'Error: Could not access microphone. Please check permissions.' });
            // Clean up in case of error
            if (audioStreamRef.current) {
                audioStreamRef.current.getTracks().forEach(track => track.stop());
                audioStreamRef.current = null;
            }
            setIsBrowserRecording(false);
            setIsBrowserPaused(false);
        }
    }, [append, startHideTimeout, handleStopRecording]); // Added handleStopRecording

    const connectWebSocket = useCallback(async (currentSessionId: string) => {
        if (!currentSessionId) {
            console.error("WebSocket: No session ID to connect.");
            setWsStatus('error');
            return;
        }
        if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
            console.warn("WebSocket: Already connected or connecting.");
            return;
        }

        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session?.access_token) {
            console.error("WebSocket: Failed to get auth token for WebSocket.", sessionError);
            append({ role: 'system', content: 'Error: WebSocket authentication failed.' });
            setWsStatus('error');
            return;
        }
        const token = session.access_token;

        setWsStatus('connecting');
        const backendHost = process.env.NEXT_PUBLIC_WEBSOCKET_URL || // Use env var if set
                             (window.location.protocol === "https:" ? "wss://" : "ws://") + window.location.host.replace(/:\d+$/, '') + (process.env.NODE_ENV === 'development' ? ":5001" : ""); // Dynamically construct or fallback
        const wsUrl = `${backendHost}/ws/audio_stream/${currentSessionId}?token=${token}`;
        
        console.log("WebSocket: Attempting to connect to", wsUrl);
        const newWs = new WebSocket(wsUrl);

        newWs.onopen = () => {
            console.log("WebSocket: Connection opened.");
            setWsStatus('open');
            startBrowserMediaRecording(); // Start MediaRecorder now that WS is open
        };
        newWs.onmessage = (event) => {
            console.log("WebSocket: Message from server:", event.data);
            // Handle messages from server if needed
        };
        newWs.onerror = (error) => {
            console.error("WebSocket: Error:", error);
            append({ role: 'system', content: 'Error: Recording stream connection failed.' });
            setWsStatus('error');
            // Consider full stop if WS fails critically
            handleStopRecording(undefined, true); // Pass error flag
        };
        newWs.onclose = (event) => {
            console.log("WebSocket: Connection closed.", event.code, event.reason);
            setWsStatus('closed');
            // If closed unexpectedly while browser recording was active, try to stop everything.
            if (isBrowserRecording && !event.wasClean) { // wasClean might not be perfectly reliable
                 console.warn("WebSocket: Closed unexpectedly during recording.");
                 append({ role: 'system', content: 'Warning: Recording stream disconnected unexpectedly.' });
                 handleStopRecording(undefined, true); // Pass error flag to indicate unclean stop
            }
        };
        wsRef.current = newWs;
    }, [supabase.auth, append, isBrowserRecording, startBrowserMediaRecording, handleStopRecording]);


    const handleStartRecordingSession = useCallback(async () => {
        if (pendingActionRef.current || isBrowserRecording || !isPageReady || !agentName) return;
        console.log("Starting recording session...");

        const result = await callHttpRecordingApi('start', { agent: agentName, event: eventId || '0000' });

        if (result.success && result.data?.session_id) {
            console.log("Recording session started (HTTP):", result.data);
            setSessionId(result.data.session_id);
            setSessionStartTimeUTC(result.data.session_start_time_utc);
            // Now connect WebSocket, which upon opening will start MediaRecorder
            connectWebSocket(result.data.session_id);
        } else {
            console.error("Failed to start recording session (HTTP):", result.error);
            append({ role: 'system', content: `Error: Could not start recording session. ${result.error || 'Unknown error'}` });
        }
    }, [isBrowserRecording, isPageReady, agentName, eventId, callHttpRecordingApi, connectWebSocket, append]); // pendingAction removed, accessed via ref

    const handleToggleBrowserPause = useCallback(() => {
        if (!mediaRecorderRef.current || !isBrowserRecording || pendingActionRef.current) return;

        const newPausedState = !isBrowserPaused;
        if (newPausedState) {
            mediaRecorderRef.current.pause();
            console.log("MediaRecorder: Paused.");
        } else {
            mediaRecorderRef.current.resume();
            console.log("MediaRecorder: Resumed.");
        }
        setIsBrowserPaused(newPausedState);

        // Inform backend about client's recording pause/resume (for backend processing state)
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ action: "set_processing_state", paused: newPausedState }));
        }
        startHideTimeout();
    }, [isBrowserRecording, isBrowserPaused, startHideTimeout]); // pendingAction removed as it's accessed via ref

    // This function is for the Mic icon in the Plus menu
    const showAndPrepareRecordingControls = useCallback(() => {
        if (pendingActionRef.current) return;
        setShowPlusMenu(false); // Always close plus menu when interacting with mic

        if (isBrowserRecording) {
             // If already recording, just ensure controls are visible
             setShowRecordUI(true);
             setRecordUIVisible(true);
             if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
             startHideTimeout();
        } else {
            // If not recording, initiate the start process
            handleStartRecordingSession();
        }
    }, [isBrowserRecording, handleStartRecordingSession, startHideTimeout]); // pendingActionRef.current is stable


    // --- Imperative Handle (mostly unchanged, uses new recording states) ---
     useImperativeHandle(ref, () => ({
        startNewChat: async () => {
             if (isBrowserRecording) await handleStopRecording(); // Stop browser recording if active
             setMessages([]); setAttachedFiles([]); setAllAttachments([]); filesForNextMessageRef.current = [];
             setClientRecordingTime(0);
             localStorage.removeItem(ACTIVE_RECORDING_SESSION_KEY);
          },
         getMessagesCount: () => messages.length,
         scrollToTop: () => { messagesContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); userHasScrolledRef.current = false; setShowScrollToBottom(false); },
     }), [isBrowserRecording, setMessages, messages.length, handleStopRecording]);


    // --- Scrolling (unchanged) ---
    const checkScroll = useCallback(() => { const c = messagesContainerRef.current; if (!c) return; const { scrollTop: st, scrollHeight: sh, clientHeight: ch } = c; const isScrollable = sh > ch; const isBottom = sh - st - ch < 2; if (st < prevScrollTopRef.current && !isBottom && !userHasScrolledRef.current) userHasScrolledRef.current = true; else if (userHasScrolledRef.current && isBottom) userHasScrolledRef.current = false; prevScrollTopRef.current = st; setShowScrollToBottom(isScrollable && !isBottom); }, []);
    const scrollToBottom = useCallback((b: ScrollBehavior = "smooth") => { if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: b }); userHasScrolledRef.current = false; setShowScrollToBottom(false); }, []);
    useEffect(() => { if (!userHasScrolledRef.current) { const id = requestAnimationFrame(() => { setTimeout(() => { scrollToBottom('smooth'); }, 50); }); return () => cancelAnimationFrame(id); } else if (!isLoading && userHasScrolledRef.current) checkScroll(); }, [messages, isLoading, scrollToBottom, checkScroll]);
    useEffect(() => { const c = messagesContainerRef.current; if (c) { c.addEventListener("scroll", checkScroll, { passive: true }); return () => c.removeEventListener("scroll", checkScroll); } }, [checkScroll]);

    useEffect(() => { // Global click listener
         const handleClick = (e: MouseEvent) => {
             const isOutsideControls = showRecordUI && recordUIRef.current && !recordUIRef.current.contains(e.target as Node);
             const isOutsideTrigger = statusRecordingRef.current && !statusRecordingRef.current.contains(e.target as Node);
             if (isOutsideControls && isOutsideTrigger && !pendingActionRef.current) hideRecordUI();
             if (showPlusMenu && plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) setShowPlusMenu(false);
         };
         document.addEventListener("mousedown", handleClick, true);
         return () => document.removeEventListener("mousedown", handleClick, true);
     }, [showRecordUI, showPlusMenu, hideRecordUI]); // pendingActionRef is stable

    useEffect(() => { // Mouse hover trigger for status bar text
         const el = statusRecordingRef.current; if (!el) return;
         const enter = () => {
            if (isBrowserRecording) { // Only interact if already recording
                if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
                setRecordUIVisible(true); setShowRecordUI(true);
            }
         };
         const leave = () => {
            if (isBrowserRecording) startHideTimeout();
         };
         el.addEventListener("mouseenter", enter); el.addEventListener("mouseleave", leave);
         // The click handler for statusRecordingRef (showAndPrepareRecordingControls) has its own dependencies.
         return () => { el.removeEventListener("mouseenter", enter); el.removeEventListener("mouseleave", leave); };
     }, [isBrowserRecording, startHideTimeout]);

    useEffect(() => { return () => { if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current); }; }, []); // Unmount cleanup

    // This handler is for the Play/Pause button within the dedicated Record UI panel
    const handlePlayPauseMicClick = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (pendingActionRef.current) return;

        if (!isBrowserRecording) {
            // This case should ideally not be hit if the Record UI only shows when isBrowserRecording is true.
            // However, if it is, starting a new session makes sense.
            await handleStartRecordingSession();
        } else {
            // If already browser recording, this button toggles the MediaRecorder's pause/resume.
            handleToggleBrowserPause();
        }
    }, [isBrowserRecording, handleStartRecordingSession, handleToggleBrowserPause]); // Dependencies are correct here

    // --- Other Handlers (mostly unchanged) ---
    const saveChat = useCallback(() => { const chatContent = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n"); const blob = new Blob([chatContent], { type: "text/plain" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `chat-${agentName || 'agent'}-${eventId || 'event'}-${new Date().toISOString().slice(0, 10)}.txt`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); setShowPlusMenu(false); }, [messages, agentName, eventId]);
    const attachDocument = useCallback(() => { fileInputRef.current?.click(); setShowPlusMenu(false); }, []);
    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files && e.target.files.length > 0) { const newFiles = Array.from(e.target.files).map((file) => ({ id: Math.random().toString(36).substring(2, 9), name: file.name, size: file.size, type: file.type, url: URL.createObjectURL(file), })); setAttachedFiles((prev) => [...prev, ...newFiles]); } if (fileInputRef.current) fileInputRef.current.value = ""; }, []);
    const removeFile = useCallback((id: string) => { setAttachedFiles((prev) => { const fileToRemove = prev.find((file) => file.id === id); if (fileToRemove?.url) URL.revokeObjectURL(fileToRemove.url); return prev.filter((file) => file.id !== id); }); }, []);
    const handleRecordUIMouseMove = useCallback(() => { if (isBrowserRecording) { if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current); setRecordUIVisible(true); startHideTimeout(); }}, [isBrowserRecording, startHideTimeout]);
    const handlePlusMenuClick = useCallback((e: React.MouseEvent) => { e.stopPropagation(); if (showRecordUI && !isBrowserRecording) hideRecordUI(); setShowPlusMenu(prev => !prev); }, [showRecordUI, isBrowserRecording, hideRecordUI]);
    const handleMessageInteraction = useCallback((id: string) => { if (isMobile) setHoveredMessage(prev => prev === id ? null : id); }, [isMobile]);
    const copyToClipboard = useCallback((text: string, id: string) => { const notifySuccess = () => { setCopyState({ id, copied: true }); setTimeout(() => { setCopyState({ id: "", copied: false }); }, 2000); }; const notifyFailure = (err?: any) => { console.error("Failed copy: ", err); setCopyState({ id, copied: false }); }; if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(notifySuccess).catch(notifyFailure); } else { console.warn("Fallback copy (execCommand)."); try { const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.left = "-9999px"; ta.style.top = "-9999px"; document.body.appendChild(ta); ta.focus(); ta.select(); const ok = document.execCommand('copy'); document.body.removeChild(ta); if (ok) notifySuccess(); else throw new Error('execCommand fail'); } catch (err) { notifyFailure(err); } } }, []);
    const editMessage = useCallback((id: string) => console.log("Edit:", id), []);
    const readAloud = useCallback((text: string) => console.log("Read:", text), []);
    const onSubmit = useCallback((e: React.FormEvent<HTMLFormElement> | React.KeyboardEvent<HTMLInputElement>) => { e.preventDefault(); if (!isPageReady) { append({ role: 'system', content: "Error: Agent/Event not set." }); return; } if (isLoading) stop(); else if (input.trim() || attachedFiles.length > 0) { if (attachedFiles.length > 0) { filesForNextMessageRef.current = [...attachedFiles]; setAttachedFiles([]); } else filesForNextMessageRef.current = []; userHasScrolledRef.current = false; setShowScrollToBottom(false); originalHandleSubmit(e as React.FormEvent<HTMLFormElement>); } }, [input, isLoading, isPageReady, stop, originalHandleSubmit, attachedFiles, append, setAttachedFiles]);
    useEffect(() => { const lKeyDown = (e: KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey && !isLoading && (input.trim() || attachedFiles.length > 0)) { e.preventDefault(); onSubmit(e as any); } else if (e.key === "Enter" && !e.shiftKey && isLoading) e.preventDefault(); }; const el = inputRef.current; if (el) el.addEventListener("keydown", lKeyDown as EventListener); return () => { if (el) el.removeEventListener("keydown", lKeyDown as EventListener); } }, [input, isLoading, stop, attachedFiles.length, onSubmit]);

    // --- Render ---
    const micButtonClass = cn(
        "p-2 plus-menu-item",
        isBrowserRecording && "recording", // General recording state
        isBrowserRecording && isBrowserPaused && "paused" // Specifically paused while recording
    );

    return (
        <div className="flex flex-col h-full">
            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto messages-container" ref={messagesContainerRef}>
                {messages.length === 0 && !isPageReady && ( <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-10"> <p className="text-2xl md:text-3xl font-bold text-center opacity-50">Loading...</p> </div> )}
                {messages.length === 0 && isPageReady && ( <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-10"> <p className="text-2xl md:text-3xl font-bold text-center opacity-80">What is alive today?</p> </div> )}
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
                            <button type="button" className={cn("p-2 text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200", (pendingActionRef.current || !isPageReady) && "opacity-50 cursor-not-allowed")} onClick={handlePlusMenuClick} aria-label="More options" disabled={!!pendingActionRef.current || !isPageReady}> <Plus size={20} /> </button>
                            {showPlusMenu && ( <motion.div initial={{ opacity: 0, scale: 0.9, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 10 }} transition={{ duration: 0.2 }} className="absolute left-0 bottom-full mb-2 bg-input-gray rounded-full py-2 shadow-lg z-10 flex flex-col items-center plus-menu" > <button type="button" className="p-2 plus-menu-item" onClick={attachDocument} title="Attach file"><Paperclip size={20} /></button> <button type="button" className="p-2 plus-menu-item" onClick={saveChat} title="Save chat"><Download size={20} /></button> <button type="button" className={micButtonClass} onClick={showAndPrepareRecordingControls} title={isBrowserRecording ? (isBrowserPaused ? "Recording Paused" : "Recording Live") : "Start recording"} > <Mic size={20} /> </button> </motion.div> )}
                        </div>
                        <div className="relative" ref={recordUIRef}>
                             {showRecordUI && isBrowserRecording && ( // Only show if actively browser recording
                                <motion.div initial={{ opacity: 0, scale: 0.9, y: 10 }} animate={{ opacity: recordUIVisible ? 1 : 0, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 10 }} transition={{ duration: 0.3 }} className="absolute bottom-full mb-3 bg-input-gray rounded-full py-2 px-3 shadow-lg z-10 flex items-center gap-2 record-ui" onMouseMove={handleRecordUIMouseMove} onClick={(e) => e.stopPropagation()} >
                                    <button type="button" className={cn("p-1 record-ui-button", (pendingActionRef.current === 'start' || pendingActionRef.current === 'pause_stream' || pendingActionRef.current === 'resume_stream') && "opacity-50 cursor-wait")} onClick={handlePlayPauseMicClick} disabled={!!pendingActionRef.current} aria-label={isBrowserPaused ? "Resume recording" : "Pause recording"}>
                                        {(pendingActionRef.current === 'start' || pendingActionRef.current === 'pause_stream' || pendingActionRef.current === 'resume_stream')
                                          ? <Loader2 className="h-5 w-5 animate-spin text-gray-500 dark:text-gray-400" />
                                          : (isBrowserPaused
                                              ? <Play size={20} className="text-yellow-500 dark:text-yellow-400" />
                                              : <Pause size={20} className="text-red-500 dark:text-red-400" />
                                            )
                                        }
                                    </button>
                                    <button type="button" className={cn("p-1 record-ui-button", pendingActionRef.current === 'stop' && "opacity-50 cursor-wait")} onClick={handleStopRecording} disabled={!!pendingActionRef.current} aria-label="Stop recording">
                                         {pendingActionRef.current === 'stop'
                                           ? <Loader2 className="h-5 w-5 animate-spin text-gray-500 dark:text-gray-400" />
                                           : <StopCircle size={20} className="text-gray-700 dark:text-gray-300"/>
                                         }
                                    </button>
                                    <span ref={recordControlsTimerDisplayRef} className="text-sm font-medium text-gray-700 dark:text-gray-200 ml-1">{formatTime(clientRecordingTime)}</span>
                                </motion.div>
                             )}
                        </div>
                        <input
                          ref={inputRef}
                          value={input}
                          onChange={handleInputChange}
                          placeholder={!isPageReady ? "Waiting for Agent/Event..." : "Ask anything"}
                          className="flex-1 px-3 py-1 bg-transparent border-none outline-none placeholder:text-zink-500 dark:placeholder:text-zink-500"
                          disabled={!isPageReady || !!pendingActionRef.current}
                          aria-label="Chat input"
                        />
                        <button type="submit"
                            className={cn( "p-2 transition-all duration-200",
                              (!isPageReady || (!input.trim() && attachedFiles.length === 0 && !isLoading)) && "text-gray-400 dark:text-gray-400",
                              isPageReady && (input.trim() || attachedFiles.length > 0) && !isLoading && (theme === 'light' ? "text-gray-800 hover:text-black" : "text-gray-200 hover:text-white"),
                              isLoading && (theme === 'light' ? "text-red-600 hover:text-red-700" : "text-red-500 hover:text-red-400")
                            )}
                            disabled={!isPageReady || (!input.trim() && attachedFiles.length === 0 && !isLoading) || !!pendingActionRef.current}
                            aria-label={isLoading ? "Stop generating" : "Send message"} >
                            {isLoading ? <Square size={20} className="fill-current h-5 w-5" /> : <ArrowUp size={24} /> }
                        </button>
                    </div>
                    <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} multiple accept=".txt,.md,.json,.pdf,.docx" />
                </form>
                {/* Status Bar */}
                <div className={cn("text-center text-foreground/70 dark:text-foreground/70 text-xs pt-4 pb-2 font-light status-bar", pendingActionRef.current && "opacity-50")}>
                    <span className="lowercase">{agentName || '...'}</span> / <span className="lowercase">{eventId || '...'}</span> |{" "}
                    <span ref={statusRecordingRef} className="cursor-pointer" onClick={showAndPrepareRecordingControls} title={isBrowserRecording ? "Recording Status" : "Start recording"} >
                         listen:{" "}
                        {isBrowserRecording ? (
                            isBrowserPaused ? ( <>paused <span className="inline-block ml-1 h-2 w-2 rounded-full bg-yellow-500"></span></> )
                                     : ( <>live <span className="inline-block ml-1 h-2 w-2 rounded-full bg-red-500 animate-pulse"></span></> )
                        ) : ( "no" )}
                        {isBrowserRecording && <span ref={timerDisplayRef} className="ml-1">{formatTime(clientRecordingTime)}</span>}
                    </span>
                     | ws: <span className={cn(wsStatus === 'open' && "text-green-500", wsStatus === 'error' && "text-red-500", wsStatus === 'closed' && "text-yellow-500")}>{wsStatus}</span>
                </div>
            </div>
        </div>
    )
});

export default SimpleChatInterface;