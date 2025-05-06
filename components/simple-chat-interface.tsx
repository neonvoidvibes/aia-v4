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
      body: {
          agent: agentName,
          event: eventId || '0000',
      },
      sendExtraMessageFields: true,
       onError: (error) => {
         console.error("Chat Hook Error:", error);
         append({ role: 'system', content: `Error: ${error.message}` });
       },
       onFinish: (message: Message) => {
            console.log("onFinish called. Assistant message ID:", message.id);
       }
    });

    const messagesRef = useRef<Message[]>(messages);
    useEffect(() => {
      messagesRef.current = messages;
    }, [messages]);

    useEffect(() => {
      if (filesForNextMessageRef.current.length > 0) {
        const currentMsgs = messagesRef.current;
        const lastMsg = currentMsgs[currentMsgs.length - 1];
        if (lastMsg?.role === 'user') {
          const filesWithId = filesForNextMessageRef.current.map(file => ({
            ...file,
            messageId: lastMsg.id,
          }));
          setAllAttachments(prev => [...prev, ...filesWithId]);
          filesForNextMessageRef.current = [];
        }
      }
    }, [messages]);

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

    const plusMenuRef = useRef<HTMLDivElement>(null)
    const recordUIRef = useRef<HTMLDivElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const statusRecordingRef = useRef<HTMLSpanElement>(null)
    const inputContainerRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const messagesContainerRef = useRef<HTMLDivElement>(null)
    const prevMessagesLengthRef = useRef(messages.length)
    const userHasScrolledRef = useRef(false)
    const prevScrollTopRef = useRef<number>(0);
    const filesForNextMessageRef = useRef<AttachmentFile[]>([]);
    const lastMessageIdRef = useRef<string | null>(null)
    
    const baseRecordingTimeRef = useRef(0);
    const lastFetchTimestampRef = useRef(0);
    const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

    const fetchStatus = useCallback(async (logSource?: string) => {
        if (!isReady) return;
        // console.log(`fetchStatus called from: ${logSource || 'unknown'}`);
        try {
            const response = await fetch(`/api/recording-proxy`);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: `Status fetch failed: ${response.status}` }));
                throw new Error(errorData.message || `Status fetch failed: ${response.status}`);
            }
            const data = await response.json();
            
            setIsRecording(data.is_recording || false);
            setIsPaused(data.is_paused || false);

            if (data.is_recording) {
                baseRecordingTimeRef.current = data.elapsed_time || 0;
                lastFetchTimestampRef.current = Date.now();
                // Always update displayTime to the fetched time if recording,
                // interval will continue smoothly if not paused.
                // If paused, this correctly freezes the display.
                setDisplayTime(data.elapsed_time || 0);
            } else {
                 setDisplayTime(0);
                 baseRecordingTimeRef.current = 0;
                 lastFetchTimestampRef.current = 0;
            }

        } catch (error: any) {
            console.error(`Error fetching/processing recording status via proxy (source: ${logSource}):`, error.message);
            // Optionally reset state on error or rely on next successful poll
            // setIsRecording(false); setIsPaused(false); setDisplayTime(0);
        }
    }, [isReady]);

    useEffect(() => {
        if (isReady) {
            fetchStatus("initial component ready");
        }
    }, [isReady, fetchStatus]);

    useEffect(() => {
        if (isReady && isRecording) {
            if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = setInterval(() => {
                fetchStatus("polling interval");
            }, 1000); // Poll every 1 second
        } else {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
            }
        }
        return () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
            }
        };
    }, [isReady, isRecording, fetchStatus]);

    useEffect(() => {
        let timerIntervalId: NodeJS.Timeout | null = null;
        if (isRecording && !isPaused) {
            if (lastFetchTimestampRef.current > 0) { // Ensure we have a valid base timestamp
                timerIntervalId = setInterval(() => {
                    const elapsedSinceFetch = (Date.now() - lastFetchTimestampRef.current) / 1000;
                    setDisplayTime(baseRecordingTimeRef.current + elapsedSinceFetch);
                }, 1000);
            } else {
                // If no valid timestamp, rely on fetchStatus to set displayTime initially
                setDisplayTime(baseRecordingTimeRef.current);
            }
        } else {
            if (timerIntervalId) clearInterval(timerIntervalId);
            // If paused, displayTime is already set by fetchStatus to the exact paused time.
            // If stopped, displayTime is set to 0 by fetchStatus.
        }
        return () => {
            if (timerIntervalId) clearInterval(timerIntervalId);
        };
    }, [isRecording, isPaused]); // Removed baseRecordingTimeRef, lastFetchTimestampRef as direct deps, they are refs.

    useEffect(() => {
        if (onAttachmentsUpdate) { onAttachmentsUpdate(allAttachments); }
    }, [allAttachments, onAttachmentsUpdate]);

    useImperativeHandle(ref, () => ({
        startNewChat: async () => {
            console.log("Imperative handle: startNewChat called");
            if (isRecording) { // Use local state for check
                // Stop recording first
                await callRecordingApi('stop'); // callRecordingApi now handles status update
                // UI state (isRecording=false, etc.) will be updated by fetchStatus inside callRecordingApi
            }
            setMessages([]);
            setAttachedFiles([]);
            setAllAttachments([]);
            filesForNextMessageRef.current = [];
            lastMessageIdRef.current = null;
        },
        getMessagesCount: () => messages.length,
        scrollToTop: () => {
            messagesContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
            userHasScrolledRef.current = false;
            setShowScrollToBottom(false);
        },
    }), [isRecording, setMessages, messages.length, agentName, eventId, fetchStatus]); // Added deps that callRecordingApi depends on

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    };

    const checkScroll = useCallback(() => {
        const container = messagesContainerRef.current; if (!container) return;
        const { scrollTop, scrollHeight, clientHeight } = container;
        const isScrollable = scrollHeight > clientHeight;
        const isAtStrictBottom = scrollHeight - scrollTop - clientHeight < 2;

        if (scrollTop < prevScrollTopRef.current && !isAtStrictBottom && !userHasScrolledRef.current) {
            userHasScrolledRef.current = true;
        }
        else if (userHasScrolledRef.current && isAtStrictBottom) {
            userHasScrolledRef.current = false;
        }
        prevScrollTopRef.current = scrollTop;
        setShowScrollToBottom(isScrollable && !isAtStrictBottom);
    }, []);

    const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: behavior });
        }
        userHasScrolledRef.current = false;
        setShowScrollToBottom(false);
    }, []);

     useEffect(() => {
       if (!userHasScrolledRef.current) {
         const animationFrameId = requestAnimationFrame(() => {
            const timer = setTimeout(() => { scrollToBottom('smooth'); }, 100);
         });
         return () => { cancelAnimationFrame(animationFrameId); };
       }
       else if (isLoading === false && userHasScrolledRef.current) {
             checkScroll();
        }
     }, [messages, isLoading, scrollToBottom, checkScroll]);

     useEffect(() => {
        const container = messagesContainerRef.current;
        if (container) {
            container.addEventListener("scroll", checkScroll, { passive: true });
            return () => container.removeEventListener("scroll", checkScroll);
        }
    }, [checkScroll]);

    const hideRecordUI = useCallback(() => {
         setRecordUIVisible(false);
         setTimeout(() => { setShowRecordUI(false); setRecordUIVisible(true); }, 300);
     }, []);

    const startHideTimeout = useCallback(() => {
         if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
         if (!isRecording || isPaused) {
              hideTimeoutRef.current = setTimeout(() => { hideRecordUI(); }, 3000);
          }
     }, [isRecording, isPaused, hideRecordUI]);

    useEffect(() => {
        const handleGlobalClick = (event: MouseEvent) => {
            if ( showRecordUI && recordUIRef.current && !recordUIRef.current.contains(event.target as Node) && statusRecordingRef.current && !statusRecordingRef.current.contains(event.target as Node) ) {
                 if (!isRecording || isPaused) hideRecordUI();
             }
             if (showPlusMenu && plusMenuRef.current && !plusMenuRef.current.contains(event.target as Node)) {
                 setShowPlusMenu(false);
             }
        };
        document.addEventListener("mousedown", handleGlobalClick, true);
        return () => { document.removeEventListener("mousedown", handleGlobalClick, true); };
    }, [showRecordUI, showPlusMenu, hideRecordUI, isRecording, isPaused]);

     useEffect(() => {
       const statusElement = statusRecordingRef.current;
       if (!statusElement) return;
       const handleMouseEnter = () => {
         if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
         setRecordUIVisible(true); setShowRecordUI(true);
       };
       const handleMouseLeave = () => { startHideTimeout(); };
       statusElement.addEventListener("mouseenter", handleMouseEnter);
       statusElement.addEventListener("mouseleave", handleMouseLeave);
       return () => {
         statusElement.removeEventListener("mouseenter", handleMouseEnter);
         statusElement.removeEventListener("mouseleave", handleMouseLeave);
       };
     }, [startHideTimeout]);

    useEffect(() => { return () => { if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current); }; }, []);

    const callRecordingApi = useCallback(async (action: string, payload?: any): Promise<{ success: boolean }> => {
         const apiUrl = `/api/recording-proxy`;
         if (!isReady || !agentName ) {
             console.error(`Cannot call ${apiUrl} for action '${action}': Agent not ready or missing.`);
             append({ role: 'system', content: `Error: Cannot control recording. Agent missing.` });
             return { success: false };
         }
         let success = false;
         try {
             console.log(`Calling API: /api/recording-proxy with action: ${action}`);
             const response = await fetch(apiUrl, {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ action, payload })
             });
             const data = await response.json();
             if (!response.ok) {
                 throw new Error(data.message || `Failed to perform action '${action}'`);
             }
             console.log(`Backend action '${action}' response:`, data);
             success = true;
         } catch (error: any) {
             console.error(`Error during recording API call for action: '${action}'`, error);
             const errorMessage = error?.message || `Failed to perform recording action: ${action}`;
             append({ role: 'system', content: `Error: ${errorMessage}` });
             success = false;
         } finally {
             // Fetch status AFTER backend confirms the action OR if an error occurred to re-sync
             await fetchStatus(`after callRecordingApi(${action}) ${success ? 'success' : 'ERROR'}`);
         }
         return { success };
     }, [isReady, agentName, eventId, append, fetchStatus]);

    const showAndPrepareRecordingControls = useCallback(() => {
        console.log("showAndPrepareRecordingControls called");
        setShowPlusMenu(false);
        setShowRecordUI(true);
        setRecordUIVisible(true);
        if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
        fetchStatus("showAndPrepareRecordingControls");
        startHideTimeout();
    }, [fetchStatus, startHideTimeout]);

    const handlePlayPauseClick = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();
        let actionToPerform: string;
        let payloadForAction: any = undefined;

        // Determine action based on current state (before optimistic update)
        if (!isRecording) {
            actionToPerform = 'start';
            payloadForAction = { agent: agentName, event: eventId || '0000' };
            // Optimistic UI update for START
            setIsRecording(true);
            setIsPaused(false);
        } else if (isPaused) {
            actionToPerform = 'resume';
            // Optimistic UI update for RESUME
            setIsPaused(false);
        } else {
            actionToPerform = 'pause';
            // Optimistic UI update for PAUSE
            setIsPaused(true);
        }
        console.log(`handlePlayPauseClick: Optimistically set state for ${actionToPerform}. Calling API.`);
        await callRecordingApi(actionToPerform, payloadForAction);
        // Actual state will be confirmed/corrected by fetchStatus called within callRecordingApi
    }, [isRecording, isPaused, callRecordingApi, agentName, eventId]);

    const stopRecording = useCallback(async (e?: React.MouseEvent) => {
        e?.stopPropagation();
        console.log("stopRecording called");
        // Optimistic UI updates for STOP
        setIsRecording(false);
        setIsPaused(false);
        setDisplayTime(0); // Immediately reset timer display
        
        hideRecordUI(); // Hide controls immediately
        await callRecordingApi('stop');
        // Actual state will be confirmed/corrected by fetchStatus
    }, [callRecordingApi, hideRecordUI]);
    
    const saveChat = useCallback(() => {
        const chatContent = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n"); const blob = new Blob([chatContent], { type: "text/plain" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `chat-${agentName || 'agent'}-${eventId || 'event'}-${new Date().toISOString().slice(0, 10)}.txt`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); setShowPlusMenu(false);
    }, [messages, agentName, eventId]);

    const attachDocument = useCallback(() => {
        fileInputRef.current?.click(); setShowPlusMenu(false);
    }, []);

    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
             const newFiles = Array.from(e.target.files).map((file) => ({ id: Math.random().toString(36).substring(2, 9), name: file.name, size: file.size, type: file.type, url: URL.createObjectURL(file), }));
             setAttachedFiles((prev) => [...prev, ...newFiles]);
         }
         if (fileInputRef.current) fileInputRef.current.value = "";
    }, []);

    const removeFile = useCallback((id: string) => {
        setAttachedFiles((prev) => { const fileToRemove = prev.find((file) => file.id === id); if (fileToRemove?.url) URL.revokeObjectURL(fileToRemove.url); return prev.filter((file) => file.id !== id); });
    }, []);

    const handleRecordUIMouseMove = useCallback(() => { if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current); setRecordUIVisible(true); startHideTimeout(); }, [startHideTimeout]);
    const handlePlusMenuClick = useCallback((e: React.MouseEvent) => { e.stopPropagation(); if (showRecordUI && !isRecording) hideRecordUI(); setShowPlusMenu(prev => !prev); }, [showRecordUI, isRecording, hideRecordUI]);

    const handleMessageInteraction = useCallback((id: string) => { if (isMobile) setHoveredMessage(prev => prev === id ? null : id); }, [isMobile]);

    const copyToClipboard = useCallback((text: string, id: string) => {
      const notifySuccess = () => { setCopyState({ id, copied: true }); setTimeout(() => { setCopyState({ id: "", copied: false }); }, 2000); };
      const notifyFailure = (err?: any) => { console.error("Failed to copy text: ", err); setCopyState({ id, copied: false }); };
      if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(notifySuccess).catch(notifyFailure); }
      else {
        console.warn("Using fallback copy method (execCommand).");
        try {
          const textArea = document.createElement("textarea"); textArea.value = text; textArea.style.position = "fixed"; textArea.style.left = "-9999px"; textArea.style.top = "-9999px"; document.body.appendChild(textArea); textArea.focus(); textArea.select();
          const successful = document.execCommand('copy'); document.body.removeChild(textArea);
          if (successful) notifySuccess(); else throw new Error('execCommand failed');
        } catch (err) { notifyFailure(err); }
      }
    }, []);

    const editMessage = useCallback((id: string) => console.log("Edit message:", id), []);
    const readAloud = useCallback((text: string) => console.log("Reading aloud:", text), []);

    const onSubmit = useCallback((e: React.FormEvent<HTMLFormElement> | React.KeyboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (!isReady) { append({ role: 'system', content: "Error: Cannot send message. Agent/Event not set." }); return; }
        if (isLoading) { stop(); }
        else if (input.trim() || attachedFiles.length > 0) {
            if (attachedFiles.length > 0) { filesForNextMessageRef.current = [...attachedFiles]; setAttachedFiles([]); }
            else { filesForNextMessageRef.current = []; }
            userHasScrolledRef.current = false; setShowScrollToBottom(false);
            originalHandleSubmit(e as React.FormEvent<HTMLFormElement>);
        }
    }, [input, isLoading, isReady, stop, originalHandleSubmit, attachedFiles, append, setAttachedFiles]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Enter" && !e.shiftKey && !isLoading && (input.trim() || attachedFiles.length > 0)) { e.preventDefault(); onSubmit(e as any); }
            else if (e.key === "Enter" && !e.shiftKey && isLoading) { e.preventDefault(); }
        };
        const inputElement = inputRef.current;
        if (inputElement) inputElement.addEventListener("keydown", handleKeyDown as EventListener);
        return () => { if (inputElement) inputElement.removeEventListener("keydown", handleKeyDown as EventListener); }
    }, [input, isLoading, stop, attachedFiles.length, onSubmit]);

    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto messages-container" ref={messagesContainerRef}>
                {messages.length === 0 && !isReady && ( <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-10"> <p className="text-2xl md:text-3xl font-bold text-center opacity-50">Loading...</p> </div> )}
                {messages.length === 0 && isReady && ( <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-10"> <p className="text-2xl md:text-3xl font-bold text-center opacity-80">What is alive today?</p> </div> )}
                {messages.length > 0 && (
                    <div>
                        {messages.map((message: Message) => {
                            const isUser = message.role === "user";
                            const isSystem = message.role === "system";
                            const messageAttachments = allAttachments.filter((file) => file.messageId === message.id);
                            const hasAttachments = messageAttachments.length > 0;
                            return (
                                <motion.div key={message.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }}
                                    className={cn( "flex flex-col relative group mb-1", isUser ? "items-end" : isSystem ? "items-center" : "items-start", !isUser && !isSystem && "mb-4" )}
                                    onMouseEnter={() => !isMobile && !isSystem && setHoveredMessage(message.id)} onMouseLeave={() => !isMobile && setHoveredMessage(null)} onClick={() => !isSystem && handleMessageInteraction(message.id)} >
                                    {isUser && hasAttachments && ( <div className="mb-2 file-attachment-wrapper self-end mr-1"> <FileAttachmentMinimal files={messageAttachments} onRemove={() => {}} className="file-attachment-message" maxVisible={1} isSubmitted={true} messageId={message.id} /> </div> )}
                                    <div className={`rounded-2xl p-3 message-bubble ${ isUser ? `bg-input-gray text-black user-bubble ${hasAttachments ? "with-attachment" : ""}` : isSystem ? `bg-transparent text-muted-foreground text-sm italic text-center max-w-[90%]` : "bg-transparent text-white ai-bubble pl-0" }`}>
                                        <span dangerouslySetInnerHTML={{ __html: message.content.replace(/\n/g, '<br />') }} />
                                    </div>
                                    {!isSystem && (
                                        <div className={cn( "message-actions flex", isUser ? "justify-end mr-1 mt-1" : "justify-start ml-1 -mt-2" )}
                                            style={{ opacity: hoveredMessage === message.id || copyState.id === message.id ? 1 : 0, visibility: hoveredMessage === message.id || copyState.id === message.id ? "visible" : "hidden", transition: 'opacity 0.2s ease-in-out', }} >
                                            {isUser && ( <div className="flex"> <button onClick={(e) => { e.stopPropagation(); copyToClipboard(message.content, message.id); }} className="action-button" aria-label="Copy message"> {copyState.id === message.id && copyState.copied ? <Check className="h-4 w-4 copy-button-animation" /> : <Copy className="h-4 w-4" />} </button> <button onClick={() => editMessage(message.id)} className="action-button" aria-label="Edit message"> <Pencil className="h-4 w-4" /> </button> </div> )}
                                            {!isUser && ( <div className="flex"> <button onClick={(e) => { e.stopPropagation(); copyToClipboard(message.content, message.id); }} className="action-button" aria-label="Copy message"> {copyState.id === message.id && copyState.copied ? <Check className="h-4 w-4 copy-button-animation" /> : <Copy className="h-4 w-4" />} </button> {hoveredMessage === message.id && ( <button onClick={() => readAloud(message.content)} className="action-button" aria-label="Read message aloud"> <Volume2 className="h-4 w-4" /> </button> )} </div> )}
                                        </div>
                                    )}
                                </motion.div>
                            );
                        })}
                    </div>
                )}
                 {isLoading && messages[messages.length - 1]?.role === 'user' && ( <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="thinking-indicator flex self-start mb-1 mt-1 ml-1"> <span className="thinking-dot"></span> </motion.div> )}
                <div ref={messagesEndRef} />
            </div>
            {showScrollToBottom && ( <button onClick={() => scrollToBottom()} className="scroll-to-bottom-button" aria-label="Scroll to bottom"> <ChevronDown size={24} /> </button> )}
            <div className="p-2 input-area-container">
                {attachedFiles.length > 0 && ( <div className="flex justify-end mb-0.5 input-attachments-container"> <FileAttachmentMinimal files={attachedFiles} onRemove={removeFile} className="max-w-[50%] file-attachment-container" maxVisible={1} /> </div> )}
                <form onSubmit={onSubmit} className="relative">
                    <div className="bg-input-gray rounded-full p-2 flex items-center" ref={inputContainerRef}>
                        <div className="relative" ref={plusMenuRef}>
                            <button type="button" className="p-2 text-gray-600 hover:text-gray-800" onClick={handlePlusMenuClick} aria-label="More options"> <Plus size={20} /> </button>
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
                        <div className="relative" ref={recordUIRef}>
                             {showRecordUI && (
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                    animate={{ opacity: recordUIVisible ? 1 : 0, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.9, y: 10 }}
                                    transition={{ duration: 0.3 }}
                                    className="absolute bottom-full mb-3 bg-input-gray rounded-full py-2 px-3 shadow-lg z-10 flex items-center gap-2 record-ui"
                                    onMouseMove={handleRecordUIMouseMove}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <button type="button" className="p-1 record-ui-button" onClick={handlePlayPauseClick} aria-label={!isRecording ? "Start recording" : (isPaused ? "Resume recording" : "Pause recording")}>
                                        {isRecording && !isPaused ? <Pause size={20} className="text-red-500" /> : <Play size={20} className={cn(isPaused ? "text-yellow-500" : "", !isRecording && "text-gray-700 dark:text-gray-700")} />}
                                    </button>
                                    <button type="button" className="p-1 record-ui-button" onClick={stopRecording} disabled={!isRecording} aria-label="Stop recording">
                                        <StopCircle size={20} className={!isRecording ? "text-gray-400 dark:text-gray-400" : "text-gray-700 dark:text-gray-700"}/>
                                    </button>
                                    {isRecording && <span className="text-sm font-medium text-gray-700 dark:text-gray-700 ml-1">{formatTime(displayTime)}</span>}
                                </motion.div>
                             )}
                        </div>
                        <input ref={inputRef} value={input} onChange={handleInputChange} placeholder={!isReady ? "Waiting for Agent/Event..." : "Ask anything"} className="flex-1 px-3 py-1 bg-transparent border-none outline-none text-black dark:text-black" disabled={!isReady} aria-label="Chat input" />
                        <button type="submit"
                            className={cn( "p-2 transition-all duration-200", (!isReady || (!input.trim() && attachedFiles.length === 0 && !isLoading)) && (theme === 'light' ? "text-gray-400" : "text-gray-400"), isReady && (input.trim() || attachedFiles.length > 0) && !isLoading && (theme === 'light' ? "text-gray-800 hover:text-black" : "text-black hover:opacity-80"), isLoading && (theme === 'light' ? "text-gray-800" : "text-black") )}
                            disabled={!isReady || (!input.trim() && attachedFiles.length === 0 && !isLoading)} aria-label={isLoading ? "Stop generating" : "Send message"} >
                            {isLoading ? <Square size={20} className="fill-current h-5 w-5 opacity-70" /> : <ArrowUp size={24} /> }
                        </button>
                    </div>
                    <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} multiple accept=".txt,.md,.json,.pdf,.docx" />
                </form>
                <div className="text-center text-foreground/70 dark:text-foreground/70 text-xs pt-4 pb-2 font-light status-bar">
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