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
import { createClient } from '@/utils/supabase/client' 
import { cn } from "@/lib/utils"

interface SimpleChatInterfaceProps {
  onAttachmentsUpdate?: (attachments: AttachmentFile[]) => void
}

export interface ChatInterfaceHandle {
  startNewChat: () => void;
  getMessagesCount: () => number;
  scrollToTop: () => void;
}

const formatTime = (seconds: number): string => {
    const safeSeconds = Math.max(0, seconds);
    const mins = Math.floor(safeSeconds / 60);
    const secs = Math.floor(safeSeconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

const SimpleChatInterface = forwardRef<ChatInterfaceHandle, SimpleChatInterfaceProps>(
  function SimpleChatInterface({ onAttachmentsUpdate }, ref: React.ForwardedRef<ChatInterfaceHandle>) {

    const searchParams = useSearchParams();
    const [agentName, setAgentName] = useState<string | null>(null);
    const [eventId, setEventId] = useState<string | null>(null);
    const [isPageReady, setIsPageReady] = useState(false); 
    const [uiError, setUiError] = useState<string | null>(null);


    // WebSocket and Recording State
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [sessionStartTimeUTC, setSessionStartTimeUTC] = useState<string | null>(null); 
    const [wsStatus, setWsStatus] = useState<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');
    const [isBrowserRecording, setIsBrowserRecording] = useState(false); 
    const [isBrowserPaused, setIsBrowserPaused] = useState(false);    
    const [clientRecordingTime, setClientRecordingTime] = useState(0); 

    const wsRef = useRef<WebSocket | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioStreamRef = useRef<MediaStream | null>(null);
    const localRecordingTimerRef = useRef<NodeJS.Timeout | null>(null);


    useEffect(() => {
        const agentParam = searchParams.get('agent');
        const eventParam = searchParams.get('event');
        console.log(`[InitEffect] Agent: ${agentParam}, Event: ${eventParam}`);
        if (agentParam) {
            setAgentName(agentParam);
            setEventId(eventParam); 
            setIsPageReady(true);
            console.log(`[InitEffect] Page is NOW ready. Agent: ${agentParam}, Event: ${eventParam}`);
        } else {
            console.warn("[InitEffect] Chat Interface Waiting: Agent parameter missing from URL.");
            setIsPageReady(false);
            setUiError("Agent parameter missing from URL.");
        }
    }, [searchParams]);

    const {
      messages, input, handleInputChange, handleSubmit: originalHandleSubmit,
      isLoading, stop, setMessages, 
    } = useChat({ 
      api: "/api/proxy-chat",
      body: { agent: agentName, event: eventId || '0000' }, 
      sendExtraMessageFields: true,
      onError: (error) => { 
        console.error("[useChat onError]", error);
        const errorMessage = error.message || "Chat API error occurred.";
        const finalMessage = errorMessage.includes("NetworkError") || errorMessage.includes("Failed to fetch") 
          ? "Connection to chat backend failed. Please check server." 
          : `Chat Error: ${errorMessage}`;
        setUiError(finalMessage); 
      },
    });

    const appendToChat = useCallback((message: Message) => {
        setMessages(prevMessages => [...prevMessages, message]);
    }, [setMessages]);


    useEffect(() => {
        if (uiError) {
            console.log("UI Error Set:", uiError);
            appendToChat({id: `err-${Date.now()}`, role: 'system', content: uiError, createdAt: new Date()});
            const timer = setTimeout(() => setUiError(null), 7000); 
            return () => clearTimeout(timer);
        }
    }, [uiError, appendToChat]); 

    useEffect(() => {
        if (agentName && isPageReady) {
            console.log(`[ChatUIReadyEffect] Chat interface ready for agent: ${agentName}, event: ${eventId || 'N/A'}`);
        }
    }, [agentName, eventId, isPageReady]);


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

    const plusMenuRef = useRef<HTMLDivElement>(null);
    const recordUIRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const statusRecordingRef = useRef<HTMLSpanElement>(null); 
    const inputContainerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const userHasScrolledRef = useRef(false);
    const prevScrollTopRef = useRef<number>(0);
    const filesForNextMessageRef = useRef<AttachmentFile[]>([]);
    const timerDisplayRef = useRef<HTMLSpanElement>(null); 
    const recordControlsTimerDisplayRef = useRef<HTMLSpanElement>(null); 
    const pendingActionRef = useRef<string | null>(null); 

    const [showPlusMenu, setShowPlusMenu] = useState(false);
    const [showRecordUI, setShowRecordUI] = useState(false); 
    const [recordUIVisible, setRecordUIVisible] = useState(true); 
    const [attachedFiles, setAttachedFiles] = useState<AttachmentFile[]>([]);
    const [allAttachments, setAllAttachments] = useState<AttachmentFile[]>([]);
    const [hoveredMessage, setHoveredMessage] = useState<string | null>(null);
    const isMobile = useMobile();
    const [copyState, setCopyState] = useState<{ id: string; copied: boolean }>({ id: "", copied: false });
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
    const { theme } = useTheme();
    const [pendingAction, setPendingAction] = useState<string | null>(null);
    useEffect(() => { pendingActionRef.current = pendingAction; }, [pendingAction]);

    const hideRecordUI = useCallback(() => {
         if (pendingActionRef.current) return; 
         setRecordUIVisible(false);
         setTimeout(() => { setShowRecordUI(false); setRecordUIVisible(true); }, 300);
     }, []); 

    const startHideTimeout = useCallback(() => {
         if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
         if (!pendingActionRef.current) { 
              hideTimeoutRef.current = setTimeout(hideRecordUI, 3000);
          }
     }, [hideRecordUI]); 


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

    useEffect(() => { if (onAttachmentsUpdate) onAttachmentsUpdate(allAttachments); }, [allAttachments, onAttachmentsUpdate]);

    const callHttpRecordingApi = useCallback(async (action: 'start' | 'stop', payload?: any): Promise<any> => {
        console.log(`[callHttpRecordingApi] Action: ${action}, Payload:`, payload);
        if (!pendingActionRef.current && (action === 'start' || action === 'stop')) { 
            setPendingAction(action);
        }
        
        const apiUrl = `/api/recording-proxy/`; 
        if (!isPageReady || !agentName) {
            setUiError(`Error: Cannot ${action} recording. Agent/Event not set.`);
            if (pendingAction === action) setPendingAction(null); 
            return { success: false, error: "Agent/Event not set" };
        }

        const { data: { session: supabaseSession }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !supabaseSession) {
            setUiError(`Error: Authentication required to ${action} recording.`);
            if (pendingAction === action) setPendingAction(null); 
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
            console.log(`[callHttpRecordingApi] Response for ${action}:`, responseData);
            if (!response.ok) throw new Error(responseData.message || responseData.error || `Failed action '${action}'`);
            
            if (action === 'stop') {
                 setPendingAction(null);
            }
            return { success: true, data: responseData };
        } catch (error: any) {
            console.error(`[callHttpRecordingApi] API Error (${action}):`, error);
            setUiError(`Error: Failed to ${action} recording. ${error?.message}`);
            setPendingAction(null); 
            return { success: false, error: error?.message };
        }
    }, [isPageReady, agentName, supabase.auth, pendingAction]); 

    const resetRecordingStates = useCallback(() => {
        console.log("[resetRecordingStates] Resetting all recording-related states.");
        setIsBrowserRecording(false);
        setIsBrowserPaused(false);
        setClientRecordingTime(0);
        setWsStatus('idle');
        setSessionId(null);
        setSessionStartTimeUTC(null);
        
        if (wsRef.current) {
            console.log(`[resetRecordingStates] Cleaning up WebSocket (readyState: ${wsRef.current.readyState})`);
            wsRef.current.onopen = null;
            wsRef.current.onmessage = null;
            wsRef.current.onerror = null;
            wsRef.current.onclose = null;
            if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
                try { wsRef.current.close(1000, "Client resetting states"); } catch (e) { console.warn("[resetRecordingStates] Error closing wsRef in reset:", e); }
                console.log("[resetRecordingStates] WebSocket close() called.");
            }
            wsRef.current = null;
        }

        if (mediaRecorderRef.current) {
            console.log(`[resetRecordingStates] Cleaning up MediaRecorder (state: ${mediaRecorderRef.current.state})`);
            mediaRecorderRef.current.ondataavailable = null;
            mediaRecorderRef.current.onstop = null; 
            mediaRecorderRef.current.onerror = null;
            if (mediaRecorderRef.current.state !== "inactive") {
                 try { mediaRecorderRef.current.stop(); } catch (e) { console.warn("[resetRecordingStates] Error stopping MediaRecorder during reset:", e); }
            }
            mediaRecorderRef.current = null;
        }

        if (audioStreamRef.current) {
            console.log("[resetRecordingStates] Stopping audio stream tracks.");
            audioStreamRef.current.getTracks().forEach(track => track.stop());
            audioStreamRef.current = null;
        }
        
        if (localRecordingTimerRef.current) {
            clearInterval(localRecordingTimerRef.current);
            localRecordingTimerRef.current = null;
        }
        
        setShowRecordUI(false);
        setRecordUIVisible(true); 
        if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
        
        if (pendingActionRef.current === 'start') {
            setPendingAction(null);
        }
        console.log("[resetRecordingStates] Finished.");
    }, []); 


    const handleStopRecording = useCallback(async (e?: React.MouseEvent, dueToError: boolean = false) => {
        e?.stopPropagation(); 
        const currentWsState = wsRef.current?.readyState;
        const currentMediaRecorderState = mediaRecorderRef.current?.state;
        console.log(`[handleStopRecording] Initiated. Error: ${dueToError}. WS=${wsStatus}(${currentWsState}), MR=${currentMediaRecorderState}, Session=${sessionId}, Pending: ${pendingActionRef.current}`);
        
        if (pendingActionRef.current === 'stop' && !dueToError) {
            console.warn("[handleStopRecording] Stop operation already in progress. Ignoring.");
            return;
        }
        setPendingAction('stop'); 

        if (mediaRecorderRef.current) {
            mediaRecorderRef.current.ondataavailable = null;
            mediaRecorderRef.current.onerror = null; 
            const recorder = mediaRecorderRef.current; 
            
            const onStopHandler = () => {
                console.log("[handleStopRecording] MediaRecorder.onstop executed.");
                if (audioStreamRef.current) {
                    audioStreamRef.current.getTracks().forEach(track => track.stop());
                    audioStreamRef.current = null;
                    console.log("[handleStopRecording] Audio stream tracks stopped.");
                }
                setIsBrowserRecording(false);
                setIsBrowserPaused(false);
                if (mediaRecorderRef.current === recorder) { 
                    mediaRecorderRef.current = null;
                }
            };
            recorder.onstop = onStopHandler;

            if (recorder.state !== "inactive") {
                console.log("[handleStopRecording] Calling MediaRecorder.stop().");
                try { recorder.stop(); } catch (mrError) { console.warn("[handleStopRecording] Error calling MediaRecorder.stop():", mrError); onStopHandler(); }
            } else {
                console.log(`[handleStopRecording] MediaRecorder already in state: ${recorder.state}. Calling onStop manually.`);
                onStopHandler(); 
            }
        } else {
            console.log("[handleStopRecording] mediaRecorderRef.current is null.");
             setIsBrowserRecording(false); setIsBrowserPaused(false); 
            if (audioStreamRef.current) { 
                audioStreamRef.current.getTracks().forEach(track => track.stop());
                audioStreamRef.current = null;
            }
        }
        
        if (wsRef.current) {
            const wsToClose = wsRef.current;
             wsToClose.onopen = null; wsToClose.onmessage = null; wsToClose.onerror = null;
            
            wsToClose.onclose = () => { 
                console.log("[handleStopRecording] Client WebSocket deliberately closed (onclose event fired).");
                if (wsRef.current === wsToClose) wsRef.current = null; 
                if (wsStatus !== 'error') setWsStatus('idle');  
            };

            if (wsToClose.readyState === WebSocket.OPEN) {
                console.log("[handleStopRecording] WebSocket: Sending stop_stream message.");
                wsToClose.send(JSON.stringify({ action: "stop_stream" }));
            }
            
            if (wsToClose.readyState !== WebSocket.CLOSED && wsToClose.readyState !== WebSocket.CLOSING) {
                 console.log(`[handleStopRecording] WebSocket: Closing client-side connection (current state: ${wsToClose.readyState}).`);
                 try { wsToClose.close(1000, "Client initiated stop recording"); } catch(err){ console.warn("Error during ws.close():", err); if (wsStatus !== 'error') setWsStatus('idle'); wsRef.current = null;}
            } else { 
                 if (wsRef.current === wsToClose) wsRef.current = null; 
                 if (wsStatus !== 'error') setWsStatus('idle');
            }
        } else {
            setWsStatus('idle'); 
        }
        
        const currentSessionIdToStop = sessionId; 
        if (currentSessionIdToStop) {
            console.log("[handleStopRecording] Calling HTTP stop for session:", currentSessionIdToStop);
            // HTTP stop call is async, but we don't necessarily wait for it to complete client state reset
            // Let callHttpRecordingApi handle clearing pendingAction for 'stop'
            callHttpRecordingApi('stop', { session_id: currentSessionIdToStop })
                .then(result => {
                    if (result.success) {
                        console.log("[handleStopRecording] Recording session stopped via HTTP:", result.data);
                    } else {
                        console.error("[handleStopRecording] Failed to stop recording session via HTTP:", result.error);
                        if (!dueToError) {
                             setUiError(`Error: Could not properly stop recording session (HTTP). ${result.error || ''}`);
                        }
                    }
                })
                // .finally(() => { // Pending action is cleared inside callHttpRecordingApi for stop
                // });
        } else {
            if (!dueToError) console.warn("[handleStopRecording] No session ID available to send HTTP stop signal.");
            setPendingAction(null); // Clear pending if no HTTP call and not error path that already cleared it
        }
        
        console.log("[handleStopRecording] Resetting client states (excluding pendingAction which is handled by callHttp or above).");
        setClientRecordingTime(0);
        setShowRecordUI(false);
        setRecordUIVisible(true); 
        if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
        setSessionId(null); 
        setSessionStartTimeUTC(null);
        
        console.log("[handleStopRecording] Finished cleanup logic. DueToError:", dueToError);
        
        // If not due to error, or if the error was during the stop action itself, ensure pendingAction is cleared
        if ((!dueToError && pendingActionRef.current === 'stop') || (dueToError && pendingActionRef.current === 'stop')) {
            setPendingAction(null);
        }

        // The useEffect hook dependent on isBrowserRecording and pendingAction will handle re-focusing the input.
        // Explicit focus call removed from here to avoid conflicts and ensure correct timing.

    }, [sessionId, callHttpRecordingApi, wsStatus, appendToChat]); 


    const startBrowserMediaRecording = useCallback(async () => {
        console.log(`[startBrowserMediaRecording] Attempting. WS state: ${wsRef.current?.readyState}, MediaRecorder state: ${mediaRecorderRef.current?.state}`);
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            console.error("[startBrowserMediaRecording] WebSocket not open. Cannot start recording.");
            setUiError('Error: Could not start microphone. Stream not ready.');
            if (pendingActionRef.current === 'start') setPendingAction(null);
            return;
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
             console.warn("[startBrowserMediaRecording] MediaRecorder already recording or paused.");
             if (pendingActionRef.current === 'start') setPendingAction(null);
             return;
        }

        try {
            console.log("[startBrowserMediaRecording] Requesting user media...");
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioStreamRef.current = stream;
            console.log("[startBrowserMediaRecording] User media obtained.");
            
            const options = { mimeType: 'audio/webm;codecs=opus' }; 
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                console.warn(`[startBrowserMediaRecording] ${options.mimeType} not supported. Trying default.`);
                // @ts-ignore
                delete options.mimeType; 
            }

            mediaRecorderRef.current = new MediaRecorder(stream, options); 
            console.log("[startBrowserMediaRecording] MediaRecorder instance created.");

            mediaRecorderRef.current.ondataavailable = (event) => {
                if (event.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(event.data);
                } else if (event.data.size > 0 && wsRef.current?.readyState !== WebSocket.OPEN) {
                    console.warn(`[MediaRecorder ondataavailable] WebSocket not open (state: ${wsRef.current?.readyState}), cannot send audio data.`);
                }
            };

            mediaRecorderRef.current.onstop = () => { 
                console.log("[MediaRecorder onstop] Global onstop for MediaRecorder triggered.");
                if (audioStreamRef.current) {
                    audioStreamRef.current.getTracks().forEach(track => track.stop());
                    audioStreamRef.current = null;
                }
                setIsBrowserRecording(false);
                setIsBrowserPaused(false);
            };
            
            mediaRecorderRef.current.onerror = (event) => {
                console.error("[MediaRecorder onerror] Error:", event);
                setUiError(`Error: Microphone recording error.`);
                if (pendingActionRef.current === 'start') setPendingAction(null);
                handleStopRecording(undefined, true);
            };

            mediaRecorderRef.current.start(3000); 
            console.log("[startBrowserMediaRecording] MediaRecorder started with timeslice 3000ms.");
            setIsBrowserRecording(true);
            setIsBrowserPaused(false);
            setClientRecordingTime(0); 
            setShowRecordUI(true); 
            setRecordUIVisible(true);
            startHideTimeout();
            if (pendingActionRef.current === 'start') setPendingAction(null); 

        } catch (err) {
            console.error("[startBrowserMediaRecording] Error getting user media or starting recorder:", err);
            setUiError('Error: Could not access microphone. Please check permissions.');
            if (audioStreamRef.current) {
                audioStreamRef.current.getTracks().forEach(track => track.stop());
                audioStreamRef.current = null;
            }
            setIsBrowserRecording(false);
            setIsBrowserPaused(false);
            if (wsStatus === 'connecting' || wsStatus === 'open') setWsStatus('error');
            if (pendingActionRef.current === 'start') setPendingAction(null); 
        }
    }, [startHideTimeout, handleStopRecording, wsStatus]); 

    const connectWebSocket = useCallback(async (currentSessionId: string) => {
        console.log(`[connectWebSocket] Attempting for session ID: ${currentSessionId}. Current wsRef state: ${wsRef.current?.readyState}, wsStatus: ${wsStatus}`);
        if (!currentSessionId) {
            console.error("[connectWebSocket] No session ID to connect.");
            setWsStatus('error');
            if (pendingActionRef.current === 'start') setPendingAction(null);
            return;
        }
        if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
            console.warn(`[connectWebSocket] WebSocket already open or connecting. Aborting.`);
            if (pendingActionRef.current === 'start') setPendingAction(null);
            return;
        }

        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session?.access_token) {
            console.error("[connectWebSocket] Failed to get auth token for WebSocket.", sessionError);
            setUiError('Error: WebSocket authentication failed.');
            setWsStatus('error');
            if (pendingActionRef.current === 'start') setPendingAction(null);
            return;
        }
        const token = session.access_token;

        setWsStatus('connecting');
        const backendHost = process.env.NEXT_PUBLIC_WEBSOCKET_URL || 
                             (window.location.protocol === "https:" ? "wss://" : "ws://") + window.location.host.replace(/:\d+$/, '') + (process.env.NODE_ENV === 'development' ? ":5001" : "");
        const wsUrl = `${backendHost}/ws/audio_stream/${currentSessionId}?token=${token}`;
        
        console.log("[connectWebSocket] Attempting to connect to", wsUrl);
        const newWs = new WebSocket(wsUrl);
        wsRef.current = newWs; 

        newWs.onopen = () => {
            if (wsRef.current === newWs) { 
                console.log(`[WebSocket onopen] Connection opened for session ${currentSessionId}.`);
                setWsStatus('open');
                startBrowserMediaRecording(); 
            } else {
                 console.warn(`[WebSocket onopen] Stale onopen event. Ignoring.`);
                 try { newWs.close(); } catch(e){ console.warn("Error closing stale newWs onopen:", e);}
            }
        };
        newWs.onmessage = (event) => { 
            if (wsRef.current === newWs) {
                console.log(`[WebSocket onmessage] Message from server for session ${currentSessionId}:`, event.data);
            }
        };
        newWs.onerror = (event) => { 
            console.error(`[WebSocket onerror] Error for session ${currentSessionId} on WS instance for ${newWs.url}:`, event);
            if (wsRef.current === newWs) { 
                 setUiError('Error: Recording stream connection failed.');
                 setWsStatus('error'); 
                 if (pendingActionRef.current === 'start') setPendingAction(null);
                 handleStopRecording(undefined, true);
            } else {
                 console.warn(`[WebSocket onerror] Stale onerror event. Ignoring.`);
            }
        };
        newWs.onclose = (event) => {
            console.log(`[WebSocket onclose] Connection closed for session ${currentSessionId} on WS instance for ${newWs.url}. Code: ${event.code}, Reason: '${event.reason}', WasClean: ${event.wasClean}.`);
            if (wsRef.current === newWs) { 
                setWsStatus('closed');
                if (pendingActionRef.current === 'start') { 
                    setPendingAction(null);
                    setUiError("WebSocket connection closed before recording could fully start.");
                }
                if (isBrowserRecording && !event.wasClean && !(pendingActionRef.current === 'stop')) { 
                     console.warn(`[WebSocket onclose] Closed unexpectedly during recording for session ${currentSessionId}.`);
                     setUiError('Warning: Recording stream disconnected unexpectedly.');
                     handleStopRecording(undefined, true);
                }
                wsRef.current = null; 
            } else {
                 console.warn(`[WebSocket onclose] Stale onclose event. Ignoring.`);
            }
        };
    }, [supabase.auth, startBrowserMediaRecording, handleStopRecording, wsStatus, isBrowserRecording]);


    const handleStartRecordingSession = useCallback(async () => {
        console.log(`[handleStartRecordingSession] Initiated. PendingAction: ${pendingActionRef.current}, IsBrowserRecording: ${isBrowserRecording}, IsPageReady: ${isPageReady}, AgentName: ${agentName}`);
        if (pendingActionRef.current || isBrowserRecording || !isPageReady || !agentName) {
            console.warn(`[handleStartRecordingSession] Pre-condition not met. Aborting. Pending: ${pendingActionRef.current}, Rec: ${isBrowserRecording}, Ready: ${isPageReady}, Agent: ${agentName}`)
            return;
        }
        setPendingAction('start'); 
        
        resetRecordingStates(); 
        console.log("[handleStartRecordingSession] Called resetRecordingStates.");

        const currentAgent = searchParams.get('agent'); 
        const currentEvent = searchParams.get('event') || '0000';
        if (!currentAgent) {
            setUiError("Agent information is missing. Cannot start recording.");
            setPendingAction(null);
            return;
        }
        setAgentName(currentAgent); 
        setEventId(currentEvent);   
        console.log(`[handleStartRecordingSession] Agent/Event set to: ${currentAgent}/${currentEvent}`);

        console.log("[handleStartRecordingSession] Calling HTTP start API...");
        const result = await callHttpRecordingApi('start', { agent: currentAgent, event: currentEvent });

        if (result.success && result.data?.session_id) {
            console.log("[handleStartRecordingSession] HTTP start successful. New Session ID:", result.data.session_id);
            setSessionId(result.data.session_id);
            setSessionStartTimeUTC(result.data.session_start_time_utc);
            setTimeout(() => connectWebSocket(result.data.session_id), 100);
        } else {
            console.error("[handleStartRecordingSession] Failed to start recording session (HTTP):", result.error);
            setUiError(`Error: Could not start recording session. ${result.error || 'Unknown error'}`);
            setPendingAction(null); 
        }
    }, [isBrowserRecording, isPageReady, agentName, eventId, callHttpRecordingApi, connectWebSocket, resetRecordingStates, searchParams]);

    const handleToggleBrowserPause = useCallback(() => {
        if (!mediaRecorderRef.current || !isBrowserRecording || pendingActionRef.current) return;
        console.log(`[handleToggleBrowserPause] Current pause state: ${isBrowserPaused}`);

        const newPausedState = !isBrowserPaused;
        if (newPausedState) {
            mediaRecorderRef.current.pause();
            console.log("[handleToggleBrowserPause] MediaRecorder: Paused.");
        } else {
            mediaRecorderRef.current.resume();
            console.log("[handleToggleBrowserPause] MediaRecorder: Resumed.");
        }
        setIsBrowserPaused(newPausedState);

        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ action: "set_processing_state", paused: newPausedState }));
        }
        startHideTimeout();
    }, [isBrowserRecording, isBrowserPaused, startHideTimeout]); 

    const showAndPrepareRecordingControls = useCallback(() => {
        console.log(`[showAndPrepareRecordingControls] PendingAction: ${pendingActionRef.current}, IsBrowserRecording: ${isBrowserRecording}`);
        if (pendingActionRef.current) return;
        setShowPlusMenu(false); 

        if (isBrowserRecording) {
             setShowRecordUI(true);
             setRecordUIVisible(true);
             if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
             startHideTimeout();
        } else {
            handleStartRecordingSession();
        }
    }, [isBrowserRecording, handleStartRecordingSession, startHideTimeout]); 


     useImperativeHandle(ref, () => ({
        startNewChat: async () => {
             console.log("[startNewChat] Imperative handle called.");
             if (isBrowserRecording || sessionId) { 
                console.log("[startNewChat] Active recording detected, stopping it first.");
                await handleStopRecording(undefined, false); 
             }
             setMessages([]); 
             setAttachedFiles([]); 
             setAllAttachments([]); 
             filesForNextMessageRef.current = [];
             console.log("[startNewChat] Client states (messages, attachments) reset for new chat.");
          },
         getMessagesCount: () => messages.length,
         scrollToTop: () => { messagesContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); userHasScrolledRef.current = false; setShowScrollToBottom(false); },
     }), [isBrowserRecording, sessionId, setMessages, messages.length, handleStopRecording]);


    const checkScroll = useCallback(() => { const c = messagesContainerRef.current; if (!c) return; const { scrollTop: st, scrollHeight: sh, clientHeight: ch } = c; const isScrollable = sh > ch; const isBottom = sh - st - ch < 2; if (st < prevScrollTopRef.current && !isBottom && !userHasScrolledRef.current) userHasScrolledRef.current = true; else if (userHasScrolledRef.current && isBottom) userHasScrolledRef.current = false; prevScrollTopRef.current = st; setShowScrollToBottom(isScrollable && !isBottom); }, []);
    const scrollToBottom = useCallback((b: ScrollBehavior = "smooth") => { if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: b }); userHasScrolledRef.current = false; setShowScrollToBottom(false); }, []);
    useEffect(() => { if (!userHasScrolledRef.current) { const id = requestAnimationFrame(() => { setTimeout(() => { scrollToBottom('smooth'); }, 50); }); return () => cancelAnimationFrame(id); } else if (!isLoading && userHasScrolledRef.current) checkScroll(); }, [messages, isLoading, scrollToBottom, checkScroll]);
    useEffect(() => { const c = messagesContainerRef.current; if (c) { c.addEventListener("scroll", checkScroll, { passive: true }); return () => c.removeEventListener("scroll", checkScroll); } }, [checkScroll]);

    useEffect(() => { 
         const handleClick = (e: MouseEvent) => {
             const isOutsideControls = showRecordUI && recordUIRef.current && !recordUIRef.current.contains(e.target as Node);
             const isOutsideTrigger = statusRecordingRef.current && !statusRecordingRef.current.contains(e.target as Node);
             if (isOutsideControls && isOutsideTrigger && !pendingActionRef.current && isBrowserRecording) hideRecordUI(); 
             if (showPlusMenu && plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) setShowPlusMenu(false);
         };
         document.addEventListener("mousedown", handleClick, true);
         return () => document.removeEventListener("mousedown", handleClick, true);
     }, [showRecordUI, showPlusMenu, hideRecordUI, isBrowserRecording]); 

    useEffect(() => { 
         const el = statusRecordingRef.current; if (!el) return;
         const enter = () => {
            if (isBrowserRecording) { 
                if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
                setRecordUIVisible(true); setShowRecordUI(true);
            }
         };
         const leave = () => {
            if (isBrowserRecording) startHideTimeout();
         };
         el.addEventListener("mouseenter", enter); el.addEventListener("mouseleave", leave);
         return () => { el.removeEventListener("mouseenter", enter); el.removeEventListener("mouseleave", leave); };
     }, [isBrowserRecording, startHideTimeout]);

    useEffect(() => { return () => { if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current); }; }, []); 

    const handlePlayPauseMicClick = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (pendingActionRef.current) return;

        if (!isBrowserRecording) {
            await handleStartRecordingSession();
        } else {
            handleToggleBrowserPause();
        }
    }, [isBrowserRecording, handleStartRecordingSession, handleToggleBrowserPause]); 

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
    const onSubmit = useCallback((e: React.FormEvent<HTMLFormElement> | React.KeyboardEvent<HTMLInputElement>) => { e.preventDefault(); if (!isPageReady) { setUiError("Error: Agent/Event not set."); return; } if (isLoading) stop(); else if (input.trim() || attachedFiles.length > 0) { if (attachedFiles.length > 0) { filesForNextMessageRef.current = [...attachedFiles]; setAttachedFiles([]); } else filesForNextMessageRef.current = []; userHasScrolledRef.current = false; setShowScrollToBottom(false); originalHandleSubmit(e as React.FormEvent<HTMLFormElement>); } }, [input, isLoading, isPageReady, stop, originalHandleSubmit, attachedFiles, setAttachedFiles]);
    useEffect(() => { const lKeyDown = (e: KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey && !isLoading && (input.trim() || attachedFiles.length > 0)) { e.preventDefault(); onSubmit(e as any); } else if (e.key === "Enter" && !e.shiftKey && isLoading) e.preventDefault(); }; const el = inputRef.current; if (el) el.addEventListener("keydown", lKeyDown as EventListener); return () => { if (el) el.removeEventListener("keydown", lKeyDown as EventListener); } }, [input, isLoading, stop, attachedFiles.length, onSubmit]);

    useEffect(() => {
        if (!isBrowserRecording && !pendingAction && inputRef.current && document.activeElement !== inputRef.current) {
            console.log("[FocusEffect] Recording stopped and no pending action, focusing input.");
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    }, [isBrowserRecording, pendingAction]);


    const micButtonClass = cn(
        "p-2 plus-menu-item",
        isBrowserRecording && "recording", 
        isBrowserRecording && isBrowserPaused && "paused" 
    );

    return (
        <div className="flex flex-col h-full">
            {/* UI Error Display */}
            {uiError && (
                <div className="p-2 bg-red-100 border border-red-400 text-red-700 rounded-md m-2 text-sm text-center">
                    {uiError}
                </div>
            )}

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto messages-container" ref={messagesContainerRef}>
                {messages.length === 0 && !isPageReady && !uiError && ( <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-10"> <p className="text-2xl md:text-3xl font-bold text-center opacity-50">Loading...</p> </div> )}
                {messages.length === 0 && isPageReady && !uiError &&( <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-10"> <p className="text-2xl md:text-3xl font-bold text-center opacity-80">What is alive today?</p> </div> )}
                {messages.length > 0 && ( <div> {messages.map((message: Message) => { const isUser = message.role === "user"; const isSystem = message.role === "system"; const messageAttachments = allAttachments.filter((file) => file.messageId === message.id); const hasAttachments = messageAttachments.length > 0; return ( <motion.div key={message.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }} className={cn( "flex flex-col relative group mb-1", isUser ? "items-end" : isSystem ? "items-center" : "items-start", !isUser && !isSystem && "mb-4" )} onMouseEnter={() => !isMobile && !isSystem && setHoveredMessage(message.id)} onMouseLeave={() => !isMobile && setHoveredMessage(null)} onClick={() => !isSystem && handleMessageInteraction(message.id)} > {isUser && hasAttachments && ( <div className="mb-2 file-attachment-wrapper self-end mr-1"> <FileAttachmentMinimal files={messageAttachments} onRemove={() => {}} className="file-attachment-message" maxVisible={1} isSubmitted={true} messageId={message.id} /> </div> )} <div className={`rounded-2xl p-3 message-bubble ${ isUser ? `bg-input-gray text-black user-bubble ${hasAttachments ? "with-attachment" : ""}` : isSystem ? `bg-transparent text-muted-foreground text-sm italic text-center max-w-[90%]` : "bg-transparent text-white ai-bubble pl-0" }`}> <span dangerouslySetInnerHTML={{ __html: message.content.replace(/\n/g, '<br />') }} /> </div> {!isSystem && ( <div className={cn( "message-actions flex", isUser ? "justify-end mr-1 mt-1" : "justify-start ml-1 -mt-2" )} style={{ opacity: hoveredMessage === message.id || copyState.id === message.id ? 1 : 0, visibility: hoveredMessage === message.id || copyState.id === message.id ? "visible" : "hidden", transition: 'opacity 0.2s ease-in-out', }} > {isUser && ( <div className="flex"> <button onClick={(e) => { e.stopPropagation(); copyToClipboard(message.content, message.id); }} className="action-button" aria-label="Copy message"> {copyState.id === message.id && copyState.copied ? <Check className="h-4 w-4 copy-button-animation" /> : <Copy className="h-4 w-4" />} </button> <button onClick={() => editMessage(message.id)} className="action-button" aria-label="Edit message"> <Pencil className="h-4 w-4" /> </button> </div> )} {!isUser && ( <div className="flex"> <button onClick={(e) => { e.stopPropagation(); copyToClipboard(message.content, message.id); }} className="action-button" aria-label="Copy message"> {copyState.id === message.id && copyState.copied ? <Check className="h-4 w-4 copy-button-animation" /> : <Copy className="h-4 w-4" />} </button> {hoveredMessage === message.id && ( <button onClick={() => readAloud(message.content)} className="action-button" aria-label="Read message aloud"> <Volume2 className="h-4 w-4" /> </button> )} </div> )} </div> )} </motion.div> ); })} </div> )}
                {isLoading && messages[messages.length - 1]?.role === 'user' && ( <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="thinking-indicator flex self-start mb-1 mt-1 ml-1"> <span className="thinking-dot"></span> </motion.div> )}
                <div ref={messagesEndRef} />
            </div>

            {showScrollToBottom && ( <button onClick={() => scrollToBottom()} className="scroll-to-bottom-button" aria-label="Scroll to bottom"> <ChevronDown size={24} /> </button> )}

            <div className="p-2 input-area-container">
                {attachedFiles.length > 0 && ( <div className="flex justify-end mb-0.5 input-attachments-container"> <FileAttachmentMinimal files={attachedFiles} onRemove={removeFile} className="max-w-[50%] file-attachment-container" maxVisible={1} /> </div> )}
                <form onSubmit={onSubmit} className="relative">
                    <div className="bg-input-gray rounded-full p-2 flex items-center" ref={inputContainerRef}>
                        <div className="relative" ref={plusMenuRef}>
                            <button type="button" className={cn("p-2 text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200", (pendingActionRef.current || !isPageReady) && "opacity-50 cursor-not-allowed")} onClick={handlePlusMenuClick} aria-label="More options" disabled={!!pendingActionRef.current || !isPageReady}> <Plus size={20} /> </button>
                            {showPlusMenu && ( <motion.div initial={{ opacity: 0, scale: 0.9, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 10 }} transition={{ duration: 0.2 }} className="absolute left-0 bottom-full mb-2 bg-input-gray rounded-full py-2 shadow-lg z-10 flex flex-col items-center plus-menu" > <button type="button" className="p-2 plus-menu-item" onClick={attachDocument} title="Attach file"><Paperclip size={20} /></button> <button type="button" className="p-2 plus-menu-item" onClick={saveChat} title="Save chat"><Download size={20} /></button> <button type="button" className={micButtonClass} onClick={showAndPrepareRecordingControls} title={isBrowserRecording ? (isBrowserPaused ? "Recording Paused" : "Recording Live") : "Start recording"} > <Mic size={20} /> </button> </motion.div> )}
                        </div>
                        <div className="relative" ref={recordUIRef}>
                             {showRecordUI && isBrowserRecording && ( 
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
                    <span>Agent: {agentName || '...'}</span> | <span>Event: {eventId || '...'}</span> |{" "}
                    <span ref={statusRecordingRef} className="cursor-pointer" onClick={showAndPrepareRecordingControls} title={isBrowserRecording ? "Recording Status" : "Start recording"} >
                         Listen:{" "}
                        {isBrowserRecording ? (
                            isBrowserPaused ? ( <>paused <span className="inline-block ml-1 h-2 w-2 rounded-full bg-yellow-500"></span></> )
                                     : ( <>live <span className="inline-block ml-1 h-2 w-2 rounded-full bg-red-500 animate-pulse"></span></> )
                        ) : ( "no" )}
                        {isBrowserRecording && <span ref={timerDisplayRef} className="ml-1">{formatTime(clientRecordingTime)}</span>}
                    </span>
                    {" "}| Connection: <span className={cn(wsStatus === 'open' && "text-green-500", wsStatus === 'error' && "text-red-500", wsStatus === 'closed' && "text-yellow-500")}>{wsStatus}</span>
                </div>
            </div>
        </div>
    )
});

export default SimpleChatInterface;