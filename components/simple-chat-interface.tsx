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
  Loader2, // Import Loader icon
} from "lucide-react"
import FileAttachmentMinimal, { type AttachmentFile } from "./file-attachment-minimal"
import { useMobile } from "@/hooks/use-mobile"
import { useTheme } from "next-themes"
import { motion } from "framer-motion"
import { useSearchParams } from 'next/navigation';
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
}

const SimpleChatInterface = forwardRef<ChatInterfaceHandle, SimpleChatInterfaceProps>(
  function SimpleChatInterface({ onAttachmentsUpdate }, ref: React.ForwardedRef<ChatInterfaceHandle>) {

    const searchParams = useSearchParams();
    const [agentName, setAgentName] = useState<string | null>(null);
    const [eventId, setEventId] = useState<string | null>(null);
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        const agent = searchParams.get('agent');
        const event = searchParams.get('event');
        setAgentName(agent);
        setEventId(event);
        if (agent) {
            setIsReady(true);
            console.log(`Chat Interface Ready: Agent=${agent}, Event=${event || '0000 (default)'}`);
        } else {
             console.warn("Chat Interface Waiting: Agent parameter missing from URL.");
         }
    }, [searchParams]);

    const {
      messages,
      input,
      handleInputChange,
      handleSubmit: originalHandleSubmit,
      isLoading,
      stop,
      setMessages,
      append,
    } = useChat({
      api: "/api/proxy-chat",
      body: { agent: agentName, event: eventId || '0000' },
      sendExtraMessageFields: true,
       onError: (error) => { append({ role: 'system', content: `Error: ${error.message}` }); },
       onFinish: (message: Message) => { console.log("onFinish called. ID:", message.id); }
    });

    const messagesRef = useRef<Message[]>(messages);
    useEffect(() => { messagesRef.current = messages; }, [messages]);
    useEffect(() => {
      if (filesForNextMessageRef.current.length > 0) {
        const currentMsgs = messagesRef.current;
        const lastMsg = currentMsgs[currentMsgs.length - 1];
        if (lastMsg?.role === 'user') {
          const filesWithId = filesForNextMessageRef.current.map(file => ({ ...file, messageId: lastMsg.id }));
          setAllAttachments(prev => [...prev, ...filesWithId]);
          filesForNextMessageRef.current = [];
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
    const [displayTime, setDisplayTime] = useState(0); 
    const [pendingAction, setPendingAction] = useState<string | null>(null); // Track pending API actions

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
    const pendingActionRef = useRef<string | null>(null); // Ref to track pending action
    const localTimerIntervalRef = useRef<NodeJS.Timeout | null>(null); // Ref for local timer

    useEffect(() => { pendingActionRef.current = pendingAction; }, [pendingAction]);

    // Update frontend state based on confirmed backend status
    const updateFrontendStateFromBackendStatus = useCallback((status: BackendRecordingStatus) => {
        // Only update if the state actually differs
        if (isRecording !== status.is_recording) setIsRecording(status.is_recording);
        if (isPaused !== status.is_paused) setIsPaused(status.is_paused);

        // Update refs used by local timer
        baseRecordingTimeRef.current = status.elapsed_time || 0;
        lastFetchTimestampRef.current = Date.now();

        // Set display time - local timer effect will take over if recording & not paused
        setDisplayTime(status.elapsed_time || 0);

    }, [isRecording, isPaused]); // Add state vars as deps to ensure comparison is fresh

    // Fetch status from backend (polling), guarded by pendingActionRef
    const fetchStatus = useCallback(async (logSource?: string) => {
        if (pendingActionRef.current) return; // Skip polling if an action is pending
        if (!isReady) return;
        try {
            const response = await fetch(`/api/recording-proxy`);
            if (!response.ok) throw new Error(`Status fetch failed: ${response.status}`);
            const data: BackendRecordingStatus = await response.json();
            updateFrontendStateFromBackendStatus(data);
        } catch (error: any) { console.error(`Error fetching status (source: ${logSource}):`, error.message); }
    }, [isReady, updateFrontendStateFromBackendStatus]);

    // Initial status fetch
    useEffect(() => { if (isReady) fetchStatus("initial ready"); }, [isReady, fetchStatus]);

    // Status polling interval
    useEffect(() => {
        if (isReady && isRecording) {
            if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = setInterval(() => fetchStatus("polling interval"), 1000);
        } else {
            if (pollingIntervalRef.current) { clearInterval(pollingIntervalRef.current); pollingIntervalRef.current = null; }
        }
        return () => { if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current); };
    }, [isReady, isRecording, fetchStatus]);

    // Local timer effect for smooth UI updates
    useEffect(() => {
        if (localTimerIntervalRef.current) clearInterval(localTimerIntervalRef.current); // Clear existing first

        if (isRecording && !isPaused) {
            // Start new interval only if recording and not paused
            localTimerIntervalRef.current = setInterval(() => {
                // Calculate based on last *known good* sync time from backend
                const elapsedSinceFetch = (Date.now() - lastFetchTimestampRef.current) / 1000;
                setDisplayTime(baseRecordingTimeRef.current + elapsedSinceFetch);
            }, 1000); // Update UI every second
        }
        // Cleanup function
        return () => {
            if (localTimerIntervalRef.current) clearInterval(localTimerIntervalRef.current);
        };
    }, [isRecording, isPaused]); // Rerun only when recording/paused state changes

    // --- Attachments Effect ---
    useEffect(() => { if (onAttachmentsUpdate) onAttachmentsUpdate(allAttachments); }, [allAttachments, onAttachmentsUpdate]);

    // --- API Call Handler ---
    const callRecordingApi = useCallback(async (action: string, payload?: any): Promise<{ success: boolean, newStatus?: BackendRecordingStatus }> => {
         setPendingAction(action); // Set pending flag
         const apiUrl = `/api/recording-proxy`;
         if (!isReady || !agentName ) {
             append({ role: 'system', content: `Error: Cannot ${action}. Agent missing.` });
             setPendingAction(null); return { success: false };
         }
         try {
             console.log(`API POST: action: ${action}`);
             // Small delay allows optimistic UI to render before blocking API call
             await new Promise(resolve => setTimeout(resolve, 50)); 
             const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload }) });
             const data = await response.json(); 
             if (!response.ok) throw new Error(data.message || `Failed action '${action}'`);
             
             console.log(`API OK (${action}):`, data);
             if (data.recording_status) { updateFrontendStateFromBackendStatus(data.recording_status); } // Update from response
             else { await fetchStatus(`after ${action} success_NO_STATUS`); } // Fallback poll
             setPendingAction(null); // Clear pending flag AFTER processing response
             return { success: true, newStatus: data.recording_status };
         } catch (error: any) {
             console.error(`API Error (${action}):`, error);
             append({ role: 'system', content: `Error: Failed to ${action}. ${error?.message}` });
             await fetchStatus(`after ${action} ERROR`); // Re-sync on error
             setPendingAction(null); // Clear pending flag after error handling
             return { success: false };
         }
     }, [isReady, agentName, eventId, append, fetchStatus, updateFrontendStateFromBackendStatus]);

    // --- Imperative Handle ---
     useImperativeHandle(ref, () => ({
        startNewChat: async () => {
             if (isRecording) await callRecordingApi('stop');
             setMessages([]); setAttachedFiles([]); setAllAttachments([]); filesForNextMessageRef.current = [];
         },
        getMessagesCount: () => messages.length,
        scrollToTop: () => { messagesContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); userHasScrolledRef.current = false; setShowScrollToBottom(false); },
    }), [isRecording, setMessages, messages.length, callRecordingApi]);

    // --- Formatting ---
    const formatTime = (seconds: number) => { const mins = Math.floor(seconds / 60); const secs = Math.floor(seconds % 60); return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`; };
    
    // --- Scrolling ---
    const checkScroll = useCallback(() => { const c = messagesContainerRef.current; if (!c) return; const { scrollTop: st, scrollHeight: sh, clientHeight: ch } = c; const isScrollable = sh > ch; const isBottom = sh - st - ch < 2; if (st < prevScrollTopRef.current && !isBottom && !userHasScrolledRef.current) userHasScrolledRef.current = true; else if (userHasScrolledRef.current && isBottom) userHasScrolledRef.current = false; prevScrollTopRef.current = st; setShowScrollToBottom(isScrollable && !isBottom); }, []);
    const scrollToBottom = useCallback((b: ScrollBehavior = "smooth") => { if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: b }); userHasScrolledRef.current = false; setShowScrollToBottom(false); }, []);
    useEffect(() => { if (!userHasScrolledRef.current) { const id = requestAnimationFrame(() => { setTimeout(() => { scrollToBottom('smooth'); }, 50); }); return () => cancelAnimationFrame(id); } else if (!isLoading && userHasScrolledRef.current) checkScroll(); }, [messages, isLoading, scrollToBottom, checkScroll]);
    useEffect(() => { const c = messagesContainerRef.current; if (c) { c.addEventListener("scroll", checkScroll, { passive: true }); return () => c.removeEventListener("scroll", checkScroll); } }, [checkScroll]);
    
    // --- UI Visibility/Interaction ---
    const hideRecordUI = useCallback(() => { setRecordUIVisible(false); setTimeout(() => { setShowRecordUI(false); setRecordUIVisible(true); }, 300); }, []);
    const startHideTimeout = useCallback(() => { if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current); if (!isRecording || isPaused) hideTimeoutRef.current = setTimeout(hideRecordUI, 3000); }, [isRecording, isPaused, hideRecordUI]);
    useEffect(() => { const handleClick = (e: MouseEvent) => { if (showRecordUI && recordUIRef.current && !recordUIRef.current.contains(e.target as Node) && statusRecordingRef.current && !statusRecordingRef.current.contains(e.target as Node)) { if (!isRecording || isPaused) hideRecordUI(); } if (showPlusMenu && plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) setShowPlusMenu(false); }; document.addEventListener("mousedown", handleClick, true); return () => document.removeEventListener("mousedown", handleClick, true); }, [showRecordUI, showPlusMenu, hideRecordUI, isRecording, isPaused]);
    useEffect(() => { const el = statusRecordingRef.current; if (!el) return; const enter = () => { if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current); setRecordUIVisible(true); setShowRecordUI(true); }; const leave = () => startHideTimeout(); el.addEventListener("mouseenter", enter); el.addEventListener("mouseleave", leave); return () => { el.removeEventListener("mouseenter", enter); el.removeEventListener("mouseleave", leave); }; }, [startHideTimeout]);
    useEffect(() => { return () => { if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current); }; }, []);
    
    // --- Action Handlers (with Optimistic UI and Pending Flag) ---
    const showAndPrepareRecordingControls = useCallback(() => { if (pendingAction) return; setShowPlusMenu(false); setShowRecordUI(true); setRecordUIVisible(true); if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current); fetchStatus("showAndPrepare"); startHideTimeout(); }, [pendingAction, fetchStatus, startHideTimeout]);

    const handlePlayPauseClick = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (pendingActionRef.current) return; 

        let actionToPerform: string;
        let payloadForAction: { agent: string | null; event: string } | undefined = undefined; 
        const currentIsRecording = isRecording; const currentIsPaused = isPaused;

        // --- OPTIMISTIC UPDATES ---
        if (!currentIsRecording) {
            actionToPerform = 'start';
            payloadForAction = { agent: agentName, event: eventId || '0000' };
            setIsRecording(true); setIsPaused(false); setDisplayTime(0); 
        } else if (currentIsPaused) {
            actionToPerform = 'resume';
            setIsPaused(false); 
        } else {
            actionToPerform = 'pause';
            setIsPaused(true); 
        }
        console.log(`Optimistic UI for ${actionToPerform}. Calling API.`);
        await callRecordingApi(actionToPerform, payloadForAction);
    }, [isRecording, isPaused, callRecordingApi, agentName, eventId]);

    const stopRecording = useCallback(async (e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (pendingActionRef.current) return; 
        setIsRecording(false); setIsPaused(false); setDisplayTime(0); // Optimistic Stop
        hideRecordUI();
        await callRecordingApi('stop');
    }, [callRecordingApi, hideRecordUI]);
    
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
    return (
        <div className="flex flex-col h-full">
            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto messages-container" ref={messagesContainerRef}>
                {/* Welcome / Loading Messages */}
                {messages.length === 0 && !isReady && ( <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-10"> <p className="text-2xl md:text-3xl font-bold text-center opacity-50">Loading...</p> </div> )}
                {messages.length === 0 && isReady && ( <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-10"> <p className="text-2xl md:text-3xl font-bold text-center opacity-80">What is alive today?</p> </div> )}
                {/* Chat Messages */}
                {messages.length > 0 && (
                    <div>
                        {messages.map((message: Message) => {
                            const isUser = message.role === "user"; const isSystem = message.role === "system";
                            const messageAttachments = allAttachments.filter((file) => file.messageId === message.id); const hasAttachments = messageAttachments.length > 0;
                            return (
                                <motion.div key={message.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }}
                                    className={cn( "flex flex-col relative group mb-1", isUser ? "items-end" : isSystem ? "items-center" : "items-start", !isUser && !isSystem && "mb-4" )}
                                    onMouseEnter={() => !isMobile && !isSystem && setHoveredMessage(message.id)} onMouseLeave={() => !isMobile && setHoveredMessage(null)} onClick={() => !isSystem && handleMessageInteraction(message.id)} >
                                    {isUser && hasAttachments && ( <div className="mb-2 file-attachment-wrapper self-end mr-1"> <FileAttachmentMinimal files={messageAttachments} onRemove={() => {}} className="file-attachment-message" maxVisible={1} isSubmitted={true} messageId={message.id} /> </div> )}
                                    <div className={`rounded-2xl p-3 message-bubble ${ isUser ? `bg-input-gray text-black user-bubble ${hasAttachments ? "with-attachment" : ""}` : isSystem ? `bg-transparent text-muted-foreground text-sm italic text-center max-w-[90%]` : "bg-transparent text-white ai-bubble pl-0" }`}>
                                        <span dangerouslySetInnerHTML={{ __html: message.content.replace(/\n/g, '<br />') }} />
                                    </div>
                                    {!isSystem && ( /* Message Actions */ <div className={cn( "message-actions flex", isUser ? "justify-end mr-1 mt-1" : "justify-start ml-1 -mt-2" )} style={{ opacity: hoveredMessage === message.id || copyState.id === message.id ? 1 : 0, visibility: hoveredMessage === message.id || copyState.id === message.id ? "visible" : "hidden", transition: 'opacity 0.2s ease-in-out', }} > {isUser && ( <div className="flex"> <button onClick={(e) => { e.stopPropagation(); copyToClipboard(message.content, message.id); }} className="action-button" aria-label="Copy message"> {copyState.id === message.id && copyState.copied ? <Check className="h-4 w-4 copy-button-animation" /> : <Copy className="h-4 w-4" />} </button> <button onClick={() => editMessage(message.id)} className="action-button" aria-label="Edit message"> <Pencil className="h-4 w-4" /> </button> </div> )} {!isUser && ( <div className="flex"> <button onClick={(e) => { e.stopPropagation(); copyToClipboard(message.content, message.id); }} className="action-button" aria-label="Copy message"> {copyState.id === message.id && copyState.copied ? <Check className="h-4 w-4 copy-button-animation" /> : <Copy className="h-4 w-4" />} </button> {hoveredMessage === message.id && ( <button onClick={() => readAloud(message.content)} className="action-button" aria-label="Read message aloud"> <Volume2 className="h-4 w-4" /> </button> )} </div> )} </div> )}
                                </motion.div>
                            );
                        })}
                    </div>
                )}
                {/* Thinking Indicator */}
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
                        {/* Plus Button & Menu */}
                        <div className="relative" ref={plusMenuRef}>
                            <button type="button" className={cn("p-2 text-gray-600 hover:text-gray-800", pendingAction && "opacity-50 cursor-not-allowed")} onClick={handlePlusMenuClick} aria-label="More options" disabled={!!pendingAction}> <Plus size={20} /> </button>
                            {showPlusMenu && (
                                <motion.div initial={{ opacity: 0, scale: 0.9, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 10 }} transition={{ duration: 0.2 }} className="absolute left-0 bottom-full mb-2 bg-input-gray rounded-full py-2 shadow-lg z-10 flex flex-col items-center plus-menu" >
                                    <button type="button" className="p-2 plus-menu-item" onClick={attachDocument} title="Attach file"><Paperclip size={20} /></button>
                                    <button type="button" className="p-2 plus-menu-item" onClick={saveChat} title="Save chat"><Download size={20} /></button>
                                    <button type="button" className={cn("p-2 plus-menu-item", isRecording && "recording", isPaused && "paused")} onClick={showAndPrepareRecordingControls} title={isRecording ? (isPaused ? "Recording Paused" : "Recording Live") : "Open recording controls"} >
                                        <Mic size={20} />
                                    </button>
                                </motion.div>
                            )}
                        </div>
                        {/* Recording Controls Popup */}
                        <div className="relative" ref={recordUIRef}>
                             {showRecordUI && (
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                    animate={{ opacity: recordUIVisible ? 1 : 0, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.9, y: 10 }}
                                    transition={{ duration: 0.3 }}
                                    className="absolute bottom-full mb-3 bg-input-gray rounded-full py-2 px-3 shadow-lg z-10 flex items-center gap-2 record-ui"
                                    onMouseMove={handleRecordUIMouseMove}
                                    onClick={(e) => e.stopPropagation()} >
                                    {/* Play/Pause Button */}
                                    <button type="button" className={cn("p-1 record-ui-button", pendingAction === 'start' || pendingAction === 'pause' || pendingAction === 'resume' ? "opacity-50 cursor-wait" : "")} onClick={handlePlayPauseClick} disabled={!!pendingAction} aria-label={!isRecording ? "Start recording" : (isPaused ? "Resume recording" : "Pause recording")}>
                                        {pendingAction === 'start' || pendingAction === 'pause' || pendingAction === 'resume' ? <Loader2 className="h-5 w-5 animate-spin" /> : (isRecording && !isPaused ? <Pause size={20} className="text-red-500" /> : <Play size={20} className={cn(isPaused ? "text-yellow-500" : "", !isRecording && "text-gray-700 dark:text-gray-700")} />)}
                                    </button>
                                    {/* Stop Button */}
                                    <button type="button" className={cn("p-1 record-ui-button", pendingAction === 'stop' ? "opacity-50 cursor-wait" : "")} onClick={stopRecording} disabled={!isRecording || !!pendingAction} aria-label="Stop recording">
                                         {pendingAction === 'stop' ? <Loader2 className="h-5 w-5 animate-spin" /> : <StopCircle size={20} className={!isRecording ? "text-gray-400 dark:text-gray-400" : "text-gray-700 dark:text-gray-700"}/>}
                                    </button>
                                    {/* Timer Display */}
                                    {isRecording && <span className="text-sm font-medium text-gray-700 dark:text-gray-700 ml-1">{formatTime(displayTime)}</span>}
                                </motion.div>
                             )}
                        </div>
                        {/* Text Input */}
                        <input ref={inputRef} value={input} onChange={handleInputChange} placeholder={!isReady ? "Waiting for Agent/Event..." : "Ask anything"} className="flex-1 px-3 py-1 bg-transparent border-none outline-none text-black dark:text-black" disabled={!isReady || !!pendingAction} aria-label="Chat input" />
                        {/* Submit/Stop Button */}
                        <button type="submit"
                            className={cn( "p-2 transition-all duration-200", (!isReady || (!input.trim() && attachedFiles.length === 0 && !isLoading)) && (theme === 'light' ? "text-gray-400" : "text-gray-400"), isReady && (input.trim() || attachedFiles.length > 0) && !isLoading && (theme === 'light' ? "text-gray-800 hover:text-black" : "text-black hover:opacity-80"), isLoading && (theme === 'light' ? "text-gray-800" : "text-black") )}
                            disabled={!isReady || (!input.trim() && attachedFiles.length === 0 && !isLoading) || !!pendingAction} 
                            aria-label={isLoading ? "Stop generating" : "Send message"} >
                            {isLoading ? <Square size={20} className="fill-current h-5 w-5 opacity-70" /> : <ArrowUp size={24} /> }
                        </button>
                    </div>
                    {/* Hidden File Input */}
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
                        {isRecording && <span className="ml-1">{formatTime(displayTime)}</span>}
                    </span>
                </div>
            </div>
        </div>
    )
});

export default SimpleChatInterface;