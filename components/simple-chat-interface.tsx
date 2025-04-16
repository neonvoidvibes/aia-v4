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
// Removed ConfirmationModal import - managed by parent
import { motion } from "framer-motion"
import { useSearchParams } from 'next/navigation';
import { cn } from "@/lib/utils" // Import cn utility

interface SimpleChatInterfaceProps {
  onAttachmentsUpdate?: (attachments: AttachmentFile[]) => void
}

// Interface type for the exposed methods
export interface ChatInterfaceHandle { // Export interface if needed by parent directly
  startNewChat: () => void;
  getMessagesCount: () => number;
  scrollToTop: () => void; // Add method signature
}

const SimpleChatInterface = forwardRef<ChatInterfaceHandle, SimpleChatInterfaceProps>(
  function SimpleChatInterface({ onAttachmentsUpdate }, ref: React.ForwardedRef<ChatInterfaceHandle>) {

    // --- Get Agent/Event from URL ---
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
    // --- End Agent/Event retrieval ---

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
      api: "/api/proxy-chat", // Uses the Next.js API route which proxies to the backend
      body: {
          agent: agentName, // Pass agent and event to the proxy route
          event: eventId || '0000',
      },
      sendExtraMessageFields: true, // Allow sending extra fields if needed later
       onError: (error) => { // Handle errors from the useChat hook/proxy
         console.error("Chat Hook Error:", error);
         // Append error message to the chat UI for visibility
         append({ role: 'system', content: `Error: ${error.message}` });
       },
    });

    // --- State Variables ---
    const [showPlusMenu, setShowPlusMenu] = useState(false)
    const [showRecordUI, setShowRecordUI] = useState(false)
    const [isRecording, setIsRecording] = useState(false); // Local state reflecting backend status
    const [isPaused, setIsPaused] = useState(false); // Local state reflecting backend status
    const [recordingTime, setRecordingTime] = useState(0); // Elapsed time from backend status
    const [recordUIVisible, setRecordUIVisible] = useState(true) // For fade animation
    // Removed recordUIPosition state
    const [attachedFiles, setAttachedFiles] = useState<AttachmentFile[]>([]) // Files staged for upload
    const [allAttachments, setAllAttachments] = useState<AttachmentFile[]>([]) // History of all attachments (for display)
    const [hoveredMessage, setHoveredMessage] = useState<string | null>(null) // For message actions UI
    const [pendingAttachments, setPendingAttachments] = useState<AttachmentFile[]>([]) // Files waiting for message association (needs rework)
    const isMobile = useMobile() // Mobile detection hook
    const [copyState, setCopyState] = useState<{ id: string; copied: boolean }>({ id: "", copied: false }) // Copy button state
    const [showScrollToBottom, setShowScrollToBottom] = useState(false) // Scroll button visibility
    const { theme } = useTheme() // Theme state

    // --- Refs ---
    const plusMenuRef = useRef<HTMLDivElement>(null)
    const recordUIRef = useRef<HTMLDivElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null) // For auto-hiding record UI
    const statusRecordingRef = useRef<HTMLSpanElement>(null) // Ref to status bar text
    const inputContainerRef = useRef<HTMLDivElement>(null) // Ref to input container div
    const inputRef = useRef<HTMLInputElement>(null) // Ref to the text input element
    const messagesEndRef = useRef<HTMLDivElement>(null) // For auto-scrolling
    const messagesContainerRef = useRef<HTMLDivElement>(null) // For scroll detection
    const prevMessagesLengthRef = useRef(messages.length) // Track message changes for scroll
    const userHasScrolledRef = useRef(false) // Track if user scrolled up manually
    const prevScrollTopRef = useRef<number>(0); // Store previous scroll position
    // Removed isProgrammaticScrollRef and programmaticScrollTimeoutRef
    const lastMessageIdRef = useRef<string | null>(null) // Track last message for attachment logic

    // --- Backend Recording State Polling ---
    useEffect(() => {
        let intervalId: NodeJS.Timeout | null = null;
        if (isReady) { // Only start polling if agent/event are known
            const fetchStatus = async () => {
                try {
                    // Use the NEXT_PUBLIC_ prefixed environment variable
                    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_API_URL || 'http://127.0.0.1:5001';
                    const response = await fetch(`${backendUrl}/api/recording/status`); // <-- Hit backend URL
                    if (!response.ok) {
                        // Log specific error for 404 vs other errors
                        if (response.status === 404) {
                             console.error("Error fetching recording status: Backend endpoint /api/recording/status not found (404).");
                        } else {
                             // Throw error for other statuses to be caught below
                             throw new Error(`Status fetch failed: ${response.status} ${response.statusText}`);
                        }
                        // Stop polling if endpoint not found
                         if (intervalId) clearInterval(intervalId);
                         return; // Exit fetchStatus function
                    }
                    const data = await response.json();
                    // Update local state based on backend status
                    setIsRecording(data.is_recording || false);
                    setIsPaused(data.is_paused || false);
                    setRecordingTime(data.elapsed_time || 0);

                } catch (error) {
                    console.error("Error fetching recording status:", error);
                    // Stop polling on fetch error (e.g., network issue, backend down)
                    if (intervalId) clearInterval(intervalId);
                }
            };

            fetchStatus(); // Initial fetch
            intervalId = setInterval(fetchStatus, 1000); // Poll every 1 second
        }

        // Cleanup function to clear interval when component unmounts or isReady changes
        return () => {
            if (intervalId) clearInterval(intervalId);
        };
    }, [isReady]); // Re-run effect if isReady changes


    // --- Attachment Handling Logic (Placeholder) ---
    useEffect(() => {
        // Notify parent component about attachment changes (if prop is provided)
        if (onAttachmentsUpdate) { onAttachmentsUpdate(allAttachments); }
    }, [allAttachments, onAttachmentsUpdate]);

    useEffect(() => {
      // TODO: Refactor this upload/association logic.
        if (pendingAttachments.length > 0 && messages.length > 0) {
            console.log("Checking for new messages to associate files with (Frontend state)...");
            const userMessages = messages.filter((m) => m.role === "user");
            if (userMessages.length === 0) return;
            const lastUserMessage = userMessages[userMessages.length - 1];
            // Check if the last message is the one just submitted and doesn't have attachments already associated
            // A robust solution might need message IDs generated *before* sending or a way to link pending files to the response.
            if (lastUserMessage.id !== lastMessageIdRef.current && !allAttachments.some(att => att.messageId === lastUserMessage.id)) {
                console.log("Found new user message to associate attachments with:", lastUserMessage.id);
                lastMessageIdRef.current = lastUserMessage.id; // Track the last message we attached files to
                const filesWithMessageId = pendingAttachments.map((file) => ({ ...file, messageId: lastUserMessage.id }));
                console.log("Associating files with message:", filesWithMessageId.length);
                setAllAttachments((prev) => [...prev, ...filesWithMessageId]); // Add to history display
                setPendingAttachments([]); // Clear pending
            }
        }
    }, [messages, pendingAttachments, allAttachments]); // Add allAttachments to deps

    // +++ DEBUGGING: Log messages state when it changes +++
    useEffect(() => {
      console.log("--- useChat Messages Updated ---");
      try {
          console.log(JSON.stringify(messages, null, 2));
      } catch (e) {
           console.log("Could not stringify messages:", messages);
           console.error(e);
       }
      console.log("-------------------------------");
    }, [messages]); // Run whenever the messages array changes

    // --- Imperative Handle (Exposing Methods to Parent) ---
    useImperativeHandle(ref, () => ({
        startNewChat: () => {
            console.log("Imperative handle: startNewChat called");
            if (isRecording) {
                 // Use the NEXT_PUBLIC_ prefixed environment variable
                 const backendUrl = process.env.NEXT_PUBLIC_BACKEND_API_URL || 'http://127.0.0.1:5001';
                fetch(`${backendUrl}/api/recording/stop`, { method: 'POST' }) // <-- Hit backend URL
                    .then(res => { if (!res.ok) console.error("Failed to stop recording on new chat"); })
                    .catch(err => console.error("Error calling stop recording:", err))
                    .finally(() => { setIsRecording(false); setIsPaused(false); setRecordingTime(0); });
            }
            setMessages([]);
            setAttachedFiles([]);
            setAllAttachments([]);
            setPendingAttachments([]);
            lastMessageIdRef.current = null;
        },
        getMessagesCount: () => {
            return messages.length;
        },
        scrollToTop: () => {
            messagesContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
            userHasScrolledRef.current = false; // Reset scroll lock
            setShowScrollToBottom(false); // Hide scroll down button
        },
    }), [isRecording, setMessages, messages.length]); // Dependencies - messagesContainerRef is stable

    // --- Time Formatting ---
    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    };

    // --- Scrolling Logic ---
    const checkScroll = useCallback(() => {
        const container = messagesContainerRef.current; if (!container) return;
        const { scrollTop, scrollHeight, clientHeight } = container;
        const isScrollable = scrollHeight > clientHeight;
        const isAtStrictBottom = scrollHeight - scrollTop - clientHeight < 2; // Strict check for bottom

        // LOCK if user scrolls UPWARD and is NOT already near the bottom
        if (scrollTop > prevScrollTopRef.current && !isAtStrictBottom && !userHasScrolledRef.current) {
            console.log("Detected user scrolled UP away from bottom, locking auto-scroll.");
            userHasScrolledRef.current = true;
        }
        // UNLOCK if user manually scrolls back to the very bottom
        else if (userHasScrolledRef.current && isAtStrictBottom) {
            console.log("User manually scrolled to strict bottom, unlocking auto-scroll.");
            userHasScrolledRef.current = false;
        }

        // Update previous scroll position
        prevScrollTopRef.current = scrollTop;

        // Show scroll-to-bottom button if scrollable and not at the bottom
        setShowScrollToBottom(isScrollable && !isAtStrictBottom);

    }, []); // Dependencies remain minimal

    const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: behavior });
        }
        // Explicitly unlock user scroll lock when initiating auto-scroll or clicking button
        console.log("scrollToBottom called, unlocking auto-scroll.");
        userHasScrolledRef.current = false;
        setShowScrollToBottom(false); // Hide button immediately
    }, []); // Dependencies remain minimal

     // Auto-scroll on new messages or when loading stops
     useEffect(() => {
       // Check if we should scroll (user hasn't manually scrolled up)
       if (!userHasScrolledRef.current) {
         // Using requestAnimationFrame ensures scroll happens after the browser has painted the latest updates
         const animationFrameId = requestAnimationFrame(() => {
            // Add another slight delay with setTimeout, as rAF might still be too fast sometimes
            const timer = setTimeout(() => {
                scrollToBottom('smooth');
            }, 100); // Increased delay slightly
             // We need a way to clean up the timeout if the component unmounts between rAF and setTimeout
             // This is tricky, maybe store timer ID in a ref? For now, let's accept potential minor edge case.
         });
         // Cleanup function for the effect
         return () => {
           cancelAnimationFrame(animationFrameId);
           // If we had stored the setTimeout timerId, we would clear it here too
         };
       }
        // If user scrolled up, but loading finishes, DON'T auto-scroll, but DO check scroll position
        else if (isLoading === false && userHasScrolledRef.current) {
             checkScroll(); // Update button visibility based on final position
        }
       // Trigger this effect whenever the messages array *changes* (length or content)
       // OR when loading state transitions from true to false.
     }, [messages, isLoading, scrollToBottom, checkScroll]); // Keep dependency on the whole messages array for robust detection


    // Attach scroll listener
     useEffect(() => {
        const container = messagesContainerRef.current;
        if (container) {
            container.addEventListener("scroll", checkScroll, { passive: true });
            return () => container.removeEventListener("scroll", checkScroll);
        }
    }, [checkScroll]); // checkScroll itself doesn't change often

    // REMOVED direct interaction listeners for locking scroll

    // --- UI Interaction Handlers ---
    const hideRecordUI = useCallback(() => {
         setRecordUIVisible(false);
         setTimeout(() => { setShowRecordUI(false); setRecordUIVisible(true); }, 300);
     }, []);

    const startHideTimeout = useCallback(() => {
         if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
         // Only set a new timeout if NOT currently recording
         if (!isRecording) {
              hideTimeoutRef.current = setTimeout(() => {
                  hideRecordUI();
              }, 3000); // 3 seconds inactivity
          }
     }, [isRecording, hideRecordUI]);

    // Effect for global click listener to hide menus/UI
    useEffect(() => {
        const handleGlobalClick = (event: MouseEvent) => {
            // Hide Record UI if clicking outside its area OR the status bar trigger
            if ( showRecordUI && recordUIRef.current && !recordUIRef.current.contains(event.target as Node) && statusRecordingRef.current && !statusRecordingRef.current.contains(event.target as Node) ) {
                 hideRecordUI(); // Hide regardless of recording state on outside click
             }
             // Hide Plus menu if click is outside
             if (showPlusMenu && plusMenuRef.current && !plusMenuRef.current.contains(event.target as Node)) {
                 setShowPlusMenu(false);
             }
        };
        document.addEventListener("mousedown", handleGlobalClick, true);
        return () => { document.removeEventListener("mousedown", handleGlobalClick, true); };
    }, [showRecordUI, showPlusMenu, hideRecordUI]); // Removed isRecording from deps

    // Effect for status bar hover interactions
     useEffect(() => {
       const statusElement = statusRecordingRef.current;
       if (!statusElement) return;

       const handleMouseEnter = () => {
         // Always clear timeout when mouse enters the trigger area
         if (hideTimeoutRef.current) { clearTimeout(hideTimeoutRef.current); }
         // Show the UI controls when hovering the status text
         setRecordUIVisible(true);
         setShowRecordUI(true);
       };

       const handleMouseLeave = () => {
         // Start the hide timeout when mouse leaves the status text
         startHideTimeout();
       };

       statusElement.addEventListener("mouseenter", handleMouseEnter);
       statusElement.addEventListener("mouseleave", handleMouseLeave);

       return () => { // Cleanup listeners
         statusElement.removeEventListener("mouseenter", handleMouseEnter);
         statusElement.removeEventListener("mouseleave", handleMouseLeave);
       };
     }, [startHideTimeout]); // Re-run if startHideTimeout function instance changes

    // Effect for cleaning up hide timer on unmount
    useEffect(() => {
        return () => {
            if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
        };
    }, []);

    // --- Action Handlers ---

    // --- Recording Control API Calls (Defined before usage) ---
    const callRecordingApi = useCallback(async (endpoint: string) => {
         // Use the NEXT_PUBLIC_ prefixed environment variable
         const backendUrl = process.env.NEXT_PUBLIC_BACKEND_API_URL || 'http://127.0.0.1:5001';
         if (!isReady || !agentName ) { // Removed eventId check as it's optional for some calls
             console.error(`Cannot ${endpoint}: Agent not ready or missing.`);
             append({ role: 'system', content: `Error: Cannot control recording. Agent missing.` });
             return;
         }
         try {
             console.log(`Calling backend: ${backendUrl}/api/recording/${endpoint}`);
             const response = await fetch(`${backendUrl}/api/recording/${endpoint}`, {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: endpoint === 'start' ? JSON.stringify({ agent: agentName, event: eventId || '0000' }) : undefined // Include eventId for start
             });
             const data = await response.json();
             if (!response.ok) {
                 throw new Error(data.message || `Failed to ${endpoint}`);
             }
             console.log(`Backend ${endpoint} response:`, data);
         } catch (error: any) {
             console.error(`Error calling ${backendUrl}/api/recording/${endpoint}:`, error);
             append({ role: 'system', content: `Error: ${error.message}` });
         }
     }, [isReady, agentName, eventId, append]); // Keep dependencies

    // --- Action Handlers using callRecordingApi ---
    const startRecording = useCallback(() => {
        setShowPlusMenu(false);
        setShowRecordUI(true);
        setRecordUIVisible(true);
        if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
        // Only call API if not already recording, but always show UI
        if (!isRecording) {
            callRecordingApi('start');
        } else {
           console.log("Recording already in progress, showing controls.");
           // Optionally restart hide timer if just showing controls
           startHideTimeout();
        }
    }, [callRecordingApi, isRecording, startHideTimeout]); // Add dependencies

    const stopRecording = useCallback((e?: React.MouseEvent) => {
        e?.stopPropagation();
        callRecordingApi('stop');
        hideRecordUI();
    }, [callRecordingApi, hideRecordUI]); // Add dependencies

    const pauseRecording = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        callRecordingApi('pause');
        startHideTimeout();
    }, [callRecordingApi, startHideTimeout]); // Add dependencies

    const resumeRecording = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        callRecordingApi('resume');
        startHideTimeout();
    }, [callRecordingApi, startHideTimeout]); // Add dependencies

    // --- Other Action Handlers ---
    const saveChat = useCallback(() => {
        const chatContent = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n"); const blob = new Blob([chatContent], { type: "text/plain" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `chat-${agentName || 'agent'}-${eventId || 'event'}-${new Date().toISOString().slice(0, 10)}.txt`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); setShowPlusMenu(false);
    }, [messages, agentName, eventId]);

    const attachDocument = useCallback(() => {
        fileInputRef.current?.click(); setShowPlusMenu(false);
    }, []);

    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) { const newFiles = Array.from(e.target.files).map((file) => ({ id: Math.random().toString(36).substring(2, 9), name: file.name, size: file.size, type: file.type, url: URL.createObjectURL(file), })); setAttachedFiles((prev) => [...prev, ...newFiles]); console.log("Files staged:", newFiles); } if (fileInputRef.current) fileInputRef.current.value = ""; // Clear input
    }, []);


    const removeFile = useCallback((id: string) => {
        setAttachedFiles((prev) => { const fileToRemove = prev.find((file) => file.id === id); if (fileToRemove?.url) URL.revokeObjectURL(fileToRemove.url); return prev.filter((file) => file.id !== id); });
    }, []);

    const handleRecordUIMouseMove = useCallback(() => { if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current); setRecordUIVisible(true); startHideTimeout(); }, [startHideTimeout]);
    const handlePlusMenuClick = useCallback((e: React.MouseEvent) => { e.stopPropagation(); if (showRecordUI && !isRecording) hideRecordUI(); setShowPlusMenu(prev => !prev); }, [showRecordUI, isRecording, hideRecordUI]); // Ensure hideRecordUI is dependency

    // --- Message Interaction Handlers ---
    const handleMessageInteraction = useCallback((id: string) => { if (isMobile) setHoveredMessage(prev => prev === id ? null : id); }, [isMobile]);

    // Updated copyToClipboard with fallback
    const copyToClipboard = useCallback((text: string, id: string) => {
      const notifySuccess = () => {
        setCopyState({ id, copied: true });
        setTimeout(() => { setCopyState({ id: "", copied: false }); }, 2000);
      };
      const notifyFailure = (err?: any) => {
        console.error("Failed to copy text: ", err);
        setCopyState({ id, copied: false }); // Indicate failure maybe?
        // Optionally show a toast message here using a toast hook if available
      }; // <-- This closing brace belongs here

      // Removed stray brace from below

      if (navigator.clipboard && window.isSecureContext) {
        // Use modern Clipboard API if available and in secure context
        navigator.clipboard.writeText(text).then(notifySuccess).catch(notifyFailure);
      } else {
        // Fallback using document.execCommand
        console.warn("Using fallback copy method (execCommand).");
        try {
          const textArea = document.createElement("textarea");
          textArea.value = text;
          // Make the textarea out of viewport
          textArea.style.position = "fixed";
          textArea.style.left = "-9999px";
          textArea.style.top = "-9999px";
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          const successful = document.execCommand('copy');
          document.body.removeChild(textArea);

          if (successful) {
            notifySuccess();
          } else {
            throw new Error('execCommand failed');
          }
        } catch (err) {
          notifyFailure(err);
        }
      }
    }, []); // Keep dependencies minimal

    const editMessage = useCallback((id: string) => console.log("Edit message:", id), []);
    const readAloud = useCallback((text: string) => console.log("Reading aloud:", text), []);


    // --- Submit Handler ---
    const onSubmit = useCallback((e: React.FormEvent<HTMLFormElement> | React.KeyboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (!isReady) {
            console.warn("Cannot submit: Agent/Event not loaded yet.");
            append({ role: 'system', content: "Error: Cannot send message. Agent/Event not set." });
            return;
        }
        if (isLoading) {
            stop();
        } else if (input.trim() || attachedFiles.length > 0) {
            console.log("Submitting message. Input:", input, "Files:", attachedFiles.length);
            // TODO: Implement actual file upload logic here before submitting
            // For now, associate staged files with the *next* message
            const filesToSubmit = [...attachedFiles]; // Copy current staged files
            if (filesToSubmit.length > 0) {
                console.log("Attaching files to next message (pending):", filesToSubmit.length);
                setPendingAttachments(prev => [...prev, ...filesToSubmit]); // Add to pending list
                setAttachedFiles([]); // Clear staging area
            }
            // Reset scroll lock *before* submitting, ensuring next response auto-scrolls
            userHasScrolledRef.current = false;
            setShowScrollToBottom(false); // Hide button immediately on submit

            originalHandleSubmit(e as React.FormEvent<HTMLFormElement>);
            // No need to manually scroll here, the useEffect triggered by the new message will handle it
            // setTimeout(() => scrollToBottom('auto'), 50); // Removed manual scroll on submit

        }
    }, [input, isLoading, isReady, stop, originalHandleSubmit, attachedFiles, append, setPendingAttachments, setAttachedFiles, scrollToBottom]); // scrollToBottom still needed in deps for the effect hook


    // --- Keyboard Handling Effect ---
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Submit on Enter ONLY if NOT loading and input has content or files
            if (e.key === "Enter" && !e.shiftKey && !isLoading && (input.trim() || attachedFiles.length > 0)) {
                e.preventDefault();
                onSubmit(e as any); // Trigger form submission logic
            }
            // Prevent Enter from doing anything (like stopping) while loading
            else if (e.key === "Enter" && !e.shiftKey && isLoading) {
                 e.preventDefault();
                 // Removed stop() call - rely on button click
            }
        };
        const inputElement = inputRef.current;
        if (inputElement) inputElement.addEventListener("keydown", handleKeyDown as EventListener);
        return () => { if (inputElement) inputElement.removeEventListener("keydown", handleKeyDown as EventListener); }
    }, [input, isLoading, stop, attachedFiles.length, onSubmit]); // Keep onSubmit dependency here


    // --- Render ---
    return (
        // Ensure this root div fills height and uses flex column
        <div className="flex flex-col h-full">
            {/* Messages area - ensure it uses flex-1 to grow/shrink */}
            <div className="flex-1 overflow-y-auto messages-container" ref={messagesContainerRef}>
                {/* Conditional Rendering: Loading / Welcome / Messages */}
                {messages.length === 0 && !isReady && (
                    <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-10">
                        <p className="text-2xl md:text-3xl font-bold text-center opacity-50">Loading...</p>
                    </div>
                )}
                {messages.length === 0 && isReady && (
                    <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-10">
                        <p className="text-2xl md:text-3xl font-bold text-center opacity-80">What is alive today?</p>
                    </div>
                )}
                {messages.length > 0 && (
                    <div> {/* Removed space-y-0 class */}
                        {messages.map((message: Message) => { // Explicitly type message
                            const isUser = message.role === "user";
                            const isSystem = message.role === "system";
                            // Find attachments associated with this message ID
                            const messageAttachments = allAttachments.filter((file) => file.messageId === message.id);
                            const hasAttachments = messageAttachments.length > 0;

                            return (
                                <motion.div
                                    key={message.id}
                                    initial={{ opacity: 0, y: 10 }} // Slightly reduced y offset
                                    animate={{ opacity: 1, y: 0 }} // Animation end state
                                    transition={{ duration: 0.2, ease: "easeOut" }} // Faster transition
                                    // Simplified structure: motion.div is the main row container
                                    // Default mb-1, add mb-4 only for assistant messages
                                    className={cn(
                                        "flex flex-col relative group mb-1", // Default spacing
                                        isUser ? "items-end" : isSystem ? "items-center" : "items-start",
                                        !isUser && !isSystem && "mb-4" // Add extra margin below assistant messages
                                    )}
                                    onMouseEnter={() => !isMobile && !isSystem && setHoveredMessage(message.id)}
                                    onMouseLeave={() => !isMobile && setHoveredMessage(null)}
                                    onClick={() => !isSystem && handleMessageInteraction(message.id)}
                                >
                                    {/* Display attachments above user message */}
                                    {isUser && hasAttachments && (
                                        <div className="mb-2 file-attachment-wrapper self-end mr-1"> {/* Align attachment block right */}
                                            <FileAttachmentMinimal
                                                files={messageAttachments}
                                                onRemove={() => {}} // Read-only view
                                                className="file-attachment-message"
                                                maxVisible={1}
                                                isSubmitted={true}
                                                messageId={message.id}
                                            />
                                        </div>
                                    )}
                                    {/* Message Bubble (Direct child of motion.div) */}
                                    <div className={`rounded-2xl p-3 message-bubble ${
                                        isUser ? `bg-input-gray text-black user-bubble ${hasAttachments ? "with-attachment" : ""}` // User style
                                        : isSystem ? `bg-transparent text-muted-foreground text-sm italic text-center max-w-[90%]` // System style
                                        : "bg-transparent text-white ai-bubble pl-0" // Assistant style
                                    }`}>
                                        {/* Render message content */}
                                        <span dangerouslySetInnerHTML={{ __html: message.content.replace(/\n/g, '<br />') }} />
                                    </div>
                                    {/* Message Actions (Direct child of motion.div, after bubble) */}
                                    {!isSystem && (
                                        <div
                                            // Apply conditional margins directly here for spacing
                                            className={cn(
                                                "message-actions flex",
                                                isUser ? "justify-end mr-1 mt-1" : "justify-start ml-1 -mt-2" // Reverted assistant margin back to -mt-2 for closer vertical padding
                                            )}
                                            style={{
                                                opacity: hoveredMessage === message.id || copyState.id === message.id ? 1 : 0,
                                                visibility: hoveredMessage === message.id || copyState.id === message.id ? "visible" : "hidden",
                                                transition: 'opacity 0.2s ease-in-out',
                                            }}
                                        >
                                            {/* User Actions */}
                                            {isUser && (
                                                <div className="flex">
                                                    <button onClick={(e) => { e.stopPropagation(); copyToClipboard(message.content, message.id); }} className="action-button" aria-label="Copy message">
                                                        {copyState.id === message.id && copyState.copied ? <Check className="h-4 w-4 copy-button-animation" /> : <Copy className="h-4 w-4" />}
                                                    </button>
                                                    <button onClick={() => editMessage(message.id)} className="action-button" aria-label="Edit message">
                                                        <Pencil className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            )}
                                            {/* Assistant Actions */}
                                            {!isUser && (
                                                <div className="flex">
                                                    <button onClick={(e) => { e.stopPropagation(); copyToClipboard(message.content, message.id); }} className="action-button" aria-label="Copy message">
                                                        {copyState.id === message.id && copyState.copied ? <Check className="h-4 w-4 copy-button-animation" /> : <Copy className="h-4 w-4" />}
                                                    </button>
                                                    {hoveredMessage === message.id && (
                                                        <button onClick={() => readAloud(message.content)} className="action-button" aria-label="Read message aloud">
                                                            <Volume2 className="h-4 w-4" />
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </motion.div>
                            );
                        })}
                    </div>
                )}
                 {/* Thinking Indicator */}
                 {isLoading && messages[messages.length - 1]?.role === 'user' && (
                     <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                        // Use thinking-indicator class for styling from CSS
                        // Ensure it's placed correctly within the flow (align left)
                        className="thinking-indicator flex self-start mb-1 mt-1 ml-1"> {/* Align left, add margin */}
                        <span className="thinking-dot"></span> {/* Render only one dot */}
                     </motion.div>
                 )}
                {/* Empty div to ensure scrolling to the absolute bottom */}
                <div ref={messagesEndRef} />
            </div>

            {/* Scroll to bottom button (conditionally rendered) */}
            {showScrollToBottom && (
                <button onClick={() => scrollToBottom()} className="scroll-to-bottom-button" aria-label="Scroll to bottom">
                    <ChevronDown size={24} />
                </button>
            )}

            {/* Input area */}
            <div className="p-2 input-area-container">
                {/* Display staged attachments */}
                {attachedFiles.length > 0 && (
                    <div className="flex justify-end mb-0.5 input-attachments-container">
                        <FileAttachmentMinimal
                            files={attachedFiles}
                            onRemove={removeFile} // Allow removal from staging area
                            className="max-w-[50%] file-attachment-container"
                            maxVisible={1} // Keep it compact
                        />
                    </div>
                )}
                {/* Chat Input Form */}
                <form onSubmit={onSubmit} className="relative">
                    <div className="bg-input-gray rounded-full p-2 flex items-center" ref={inputContainerRef}>
                        {/* Plus Button & Menus */}
                        <div className="relative" ref={plusMenuRef}>
                            <button type="button" className="p-2 text-gray-600 hover:text-gray-800" onClick={handlePlusMenuClick} aria-label="More options">
                                <Plus size={20} />
                            </button>
                            {/* Plus Menu Popup */}
                            {showPlusMenu && (
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.9, y: 10 }}
                                    transition={{ duration: 0.2 }}
                                    className="absolute left-0 bottom-full mb-2 bg-input-gray rounded-full py-2 shadow-lg z-10 flex flex-col items-center plus-menu" // Added plus-menu class
                                >
                                    {/* Removed opacity classes */}
                                    <button type="button" className="p-2 plus-menu-item" onClick={attachDocument} title="Attach file"><Paperclip size={20} /></button>
                                    {/* Removed opacity classes */}
                                    <button type="button" className="p-2 plus-menu-item" onClick={saveChat} title="Save chat"><Download size={20} /></button>
                                    <button
                                        type="button"
                                        // Removed opacity classes
                                        className={`p-2 plus-menu-item ${isRecording ? 'recording' : ''} ${isPaused ? 'paused' : ''}`}
                                        onClick={startRecording}
                                        title={isRecording ? (isPaused ? "Recording Paused" : "Recording Live") : "Start recording"}
                                    >
                                        <Mic size={20} /> {/* Color is handled by CSS now */}
                                    </button>
                                </motion.div>
                            )}
                            {/* Recording UI Popup */}
                            {showRecordUI && (
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                    animate={{ opacity: recordUIVisible ? 1 : 0, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.9, y: 10 }}
                                    transition={{ duration: 0.3 }}
                                    className="absolute bottom-full mb-3 bg-input-gray rounded-full py-2 px-3 shadow-lg z-10 flex items-center gap-2 record-ui" // Added record-ui class
                                    ref={recordUIRef}
                                    onMouseMove={handleRecordUIMouseMove}
                                    onClick={(e) => e.stopPropagation()} // Prevent closing menu
                                    // Removed inline style for position
                                >
                                    <button type="button" className="p-1 record-ui-button" onClick={isRecording && !isPaused ? pauseRecording : resumeRecording} aria-label={isRecording && !isPaused ? "Pause recording" : "Resume recording"}>
                                        {/* Keep red/yellow, remove default gray */}
                                        {isRecording && !isPaused ? <Pause size={20} className="text-red-500" /> : <Play size={20} className={isPaused ? "text-yellow-500" : ""} />}
                                    </button>
                                    <button type="button" className="p-1 record-ui-button" onClick={stopRecording} disabled={!isRecording} aria-label="Stop recording">
                                        {/* Remove conditional grays */}
                                        <StopCircle size={20} className={""}/>
                                    </button>
                                    {/* Keep span styling as is, it seems okay */}
                                    {isRecording && <span className="text-sm font-medium text-gray-700 dark:text-gray-700 ml-1">{formatTime(recordingTime)}</span>}
                                </motion.div>
                            )}
                        </div>
                        {/* Text Input Field */}
                        <input
                            ref={inputRef}
                            value={input}
                            onChange={handleInputChange}
                            placeholder={!isReady ? "Waiting for Agent/Event..." : "Ask anything"}
                            className="flex-1 px-3 py-1 bg-transparent border-none outline-none text-black dark:text-black" // Ensure text color contrast
                            disabled={!isReady} // Disable only if not ready, allow typing while loading
                            aria-label="Chat input"
                        />
                        {/* Submit/Stop Button */}
                        <button
                            type="submit"
                            className={cn(
                                "p-2 transition-all duration-200", // Base classes
                                // Inactive/Disabled state classes based on theme
                                (!isReady || (!input.trim() && attachedFiles.length === 0 && !isLoading)) && (theme === 'light' ? "text-gray-400" : "text-gray-400"), // Use text-gray-400 for slightly lighter inactive color
                                // Active state classes based on theme
                                isReady && (input.trim() || attachedFiles.length > 0) && !isLoading && (theme === 'light' ? "text-gray-800 hover:text-black" : "text-black hover:opacity-80"), // Removed bg-white for dark active
                                // Loading state (uses active colors but shows Square)
                                isLoading && (theme === 'light' ? "text-gray-800" : "text-black") // Removed bg-white for dark loading
                            )}
                            disabled={!isReady || (!input.trim() && attachedFiles.length === 0 && !isLoading)}
                            aria-label={isLoading ? "Stop generating" : "Send message"}
                        >
                            {/* Apply size/opacity conditionally to Square icon */}
                            {isLoading
                              ? <Square size={20} className="fill-current h-4 w-4 opacity-70" />
                              : <ArrowUp size={20} />
                            }
                        </button>
                    </div>
                    {/* Hidden file input for attach button */}
                    <input
                         type="file"
                         ref={fileInputRef}
                         className="hidden"
                         onChange={handleFileChange}
                         multiple
                         accept=".txt,.md,.json,.pdf,.docx" // Specify accepted file types
                     />
                </form>
                {/* Status Bar */}
                <div className="text-center text-foreground/70 dark:text-foreground/70 text-xs pt-4 pb-2 font-light status-bar">
                    <span className="lowercase">{agentName || '...'}</span> / <span className="lowercase">{eventId || '...'}</span> |{" "}
                    {/* Clickable status text to start recording */}
                    <span
                        ref={statusRecordingRef}
                        className="cursor-pointer"
                        onClick={isRecording ? undefined : startRecording} // Only allow click to start if not already recording
                        title={isRecording ? "Recording Status" : "Click to Start Recording"}
                    >
                         listen:{" "}
                        {isRecording ? (
                            isPaused ? ( <>paused <span className="inline-block ml-1 h-2 w-2 rounded-full bg-yellow-500"></span></> )
                                     : ( <>live <span className="inline-block ml-1 h-2 w-2 rounded-full bg-red-500 animate-pulse"></span></> )
                        ) : ( "no" )}
                        {/* Show timer only when recording */}
                        {isRecording && <span className="ml-1">{formatTime(recordingTime)}</span>}
                    </span>
                </div>
            </div>

            {/* Confirmation Modal is rendered in the parent (page.tsx) */}
        </div>
    )
});

export default SimpleChatInterface;