"use client"

import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle, useCallback, useMemo } from "react"
import { useChat, type Message } from "@ai-sdk/react"

// Error message type for UI-specific error handling
interface ErrorMessage {
  id: string;
  role: 'error';
  content: string;
  createdAt?: Date;
}

// Union type for all message types in the UI
type UIMessage = Message | ErrorMessage;
import {
  Plus,
  ArrowUp,
  ArrowDown,
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
  AlertTriangle, // Added for error messages
  Upload, // Added for save to memory
  Bookmark, // Added for save individual message
  Trash2, // Added for deleting messages
} from "lucide-react"
import FileAttachmentMinimal, { type AttachmentFile } from "./file-attachment-minimal"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { useMobile } from "@/hooks/use-mobile"
import { useTheme } from "next-themes"
import { motion } from "framer-motion"
import { useSearchParams } from 'next/navigation';
import { predefinedThemes, G_DEFAULT_WELCOME_MESSAGE, type WelcomeMessageConfig } from "@/lib/themes";
import { createClient } from '@/utils/supabase/client' 
import ThinkingIndicator from "@/components/ui/ThinkingIndicator"
import { cn } from "@/lib/utils"
import { toast } from "sonner" // Import toast
import { type VADAggressiveness } from "./VADSettings";

// Utility for development-only logging
const debugLog = (...args: any[]) => {
  if (process.env.NODE_ENV === 'development') {
    console.debug('[ChatUI DEBUG]', ...args);
  }
};

/**
 * A simple markdown to HTML converter.
 * WARNING: This is NOT a full-fledged, secure markdown parser. It assumes the
 * content is coming from a trusted source (the LLM) and does not contain
 * malicious HTML/script tags.
 * It handles: bold, italic, inline code, headers (h1, h2, h3), and lists (ul, ol).
 */
const formatAssistantMessage = (text: string): string => {
    if (!text) return "";

    let html = text.trim();

    // Tables must be processed before other markdown that might interfere.
    // This regex finds a markdown table (header, separator, and body).
    html = html.replace(
        /^\|(.+)\|\r?\n\|( *[-:]+[-| :]*)\|\r?\n((?:\|.*\|(?:\r?\n|\r|$))+)/gm,
        (match, header, separator, body) => {
            const headerCells = header.split('|').map((h: string) => h.trim());
            // A valid header row must have at least one cell.
            if (headerCells.length === 0 || headerCells.every((h: string) => h === '')) return match;

            // Parse alignment from separator line
            const alignments = separator.split('|').slice(1, -1).map((s: string) => {
                const trimmed = s.trim();
                if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
                if (trimmed.endsWith(':')) return 'right';
                return 'left';
            });

            const headerHtml = `<thead><tr>${headerCells.map((h: string, i: number) => `<th style="text-align: ${alignments[i] || 'left'}">${h}</th>`).join('')}</tr></thead>`;

            const rows = body.trim().split(/\r?\n/);
            const bodyHtml = `<tbody>${rows.map((row: string) => {
                const cells = row.split('|').slice(1, -1).map((c: string) => c.trim());
                // Only render rows that have the same number of cells as the header
                if (cells.length === headerCells.length) {
                    return `<tr>${cells.map((c: string, i: number) => `<td style="text-align: ${alignments[i] || 'left'}">${c}</td>`).join('')}</tr>`;
                }
                return ''; // Ignore malformed rows
            }).join('')}</tbody>`;

            return `<div class="table-wrapper"><table>${headerHtml}${bodyHtml}</table></div>`;
        }
    );

    // Block elements (processed first, line by line)
    // Headers
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    
    // Horizontal Rule
    html = html.replace(/^\s*---*\s*$/gm, '<hr />');

    // Blockquotes
    html = html.replace(/^\s*>\s(.*)/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/(<\/blockquote>\n*<blockquote>)/g, '<br>'); // Join adjacent blockquotes

    // Lists (unordered and ordered)
    // This regex handles multi-line list items by looking for subsequent lines that are indented.
    // It now correctly handles one or more spaces after the list marker.
    html = html.replace(/^\s*[\*-]\s+(.*(?:\n\s+.*)*)/gm, '<temp-ul-li>$1</temp-ul-li>');
    html = html.replace(/^\s*\d+\.\s+(.*(?:\n\s+.*)*)/gm, '<temp-ol-li>$1</temp-ol-li>');

    // Wrap consecutive list items of the same type in their respective list tags.
    html = html.replace(/((?:<temp-ul-li>[\s\S]*?<\/temp-ul-li>\s*)+)/g, '<ul>\n$1\n</ul>');
    html = html.replace(/((?:<temp-ol-li>[\s\S]*?<\/temp-ol-li>\s*)+)/g, '<ol>\n$1\n</ol>');

    // Now replace the temporary tags with real <li> tags
    html = html.replace(/<temp-ul-li>/g, '<li>').replace(/<\/temp-ul-li>/g, '</li>');
    html = html.replace(/<temp-ol-li>/g, '<li>').replace(/<\/temp-ol-li>/g, '</li>');

    // Clean up adjacent list wrappers of the same type
    html = html.replace(/<\/ul>\s*<ul>/g, '');
    html = html.replace(/<\/ol>\s*<ol>/g, '');

    // Code blocks with language identifier
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, codeContent) => {
        const langHtml = lang ? `<div class="code-language">${lang}</div>` : '';
        const trimmedContent = codeContent.replace(/^\n/, '').trimEnd();
        return `<pre>${langHtml}<code>${trimmedContent}</code></pre>`;
    });

    // Fallback for code blocks without language
    html = html.replace(/```([\s\S]*?)```/g, (match, codeContent) => {
        const trimmedContent = codeContent.replace(/^\n/, '').trimEnd();
        return `<pre><code>${trimmedContent}</code></pre>`;
    });

    // Block-style single-line code
    html = html.replace(/^\s*`([^`\n]+?)`\s*$/gm, '<div class="code-block-wrapper"><code>$1</code></div>');

    // Inline elements (run after block elements)
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    // Bold, Italic, Inline Code
    html = html
        .replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>') // Bold
        .replace(/\*([^\*]+)\*/g, '<em>$1</em>') // Italic (asterisk-only)
        .replace(/`([^`]+)`/g, '<code>$1</code>'); // Inline code

    // Newlines to <br>, but be careful not to add them inside list structures or other blocks
    const finalHtml = html.replace(/\n/g, '<br />')
        .replace(/(<br \/>\s*)*<((h[1-3]|ul|ol|li|div|pre|blockquote|hr|table))/g, '<$2') // remove all <br>s before block elements
        .replace(/(<\/(h[1-3]|ul|ol|li|div|pre|blockquote|hr|table)>)(\s*<br \/>)*/g, '$1'); // remove all <br>s after block elements
    
    debugLog(`[Markdown Format] Input: "${text.substring(0, 50)}..." | Output HTML: "${finalHtml.substring(0, 80)}..."`);
    return finalHtml;
}

interface SimpleChatInterfaceProps {
  onAttachmentsUpdate?: (attachments: AttachmentFile[]) => void;
  isFullscreen?: boolean;
  selectedModel: string;
  temperature: number;
  onRecordingStateChange?: (state: {
    isBrowserRecording: boolean;
    isBrowserPaused: boolean;
    clientRecordingTime: number;
    isReconnecting: boolean;
  }) => void;
  isDedicatedRecordingActive?: boolean;
  vadAggressiveness: VADAggressiveness;
  getCanvasContext?: () => { // New prop to fetch dynamic canvas context
    current_canvas_time_window_label?: string;
    active_canvas_insights?: string; // JSON string
    pinned_canvas_insights?: string; // JSON string
  };
  onChatIdChange?: (chatId: string | null) => void; // New prop to notify parent of chat ID changes
  onHistoryRefreshNeeded?: () => void;
  isConversationSaved?: boolean;
}

export interface ChatInterfaceHandle {
  startNewChat: () => void;
  getMessagesCount: () => number;
  scrollToTop: () => void;
  submitMessageWithCanvasContext: (
    messageContent: string, 
    canvasContext: {
      current_canvas_time_window_label?: string;
      active_canvas_insights?: string; // JSON string
      pinned_canvas_insights?: string; // JSON string
    }
  ) => void;
  setInput: (text: string) => void; // To prefill input from canvas
  loadChatHistory: (chatId: string) => void; // Load chat history from database
}

const formatTime = (seconds: number): string => {
    const safeSeconds = Math.max(0, seconds);
    const mins = Math.floor(safeSeconds / 60);
    const secs = Math.floor(safeSeconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

const formatThoughtDuration = (totalSeconds: number): string => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? 's' : ''} and ${seconds.toFixed(1)} seconds`;
  }
  return `${seconds.toFixed(1)} seconds`;
};

const formatTimestamp = (date: Date | undefined): string => {
  if (!date) return '';
  const d = new Date(date);
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${year}.${month}.${day} ${hours}:${minutes}`;
};

const SimpleChatInterface = forwardRef<ChatInterfaceHandle, SimpleChatInterfaceProps>(
  function SimpleChatInterface({ onAttachmentsUpdate, isFullscreen = false, selectedModel, temperature, onRecordingStateChange, isDedicatedRecordingActive = false, vadAggressiveness, getCanvasContext, onChatIdChange, onHistoryRefreshNeeded, isConversationSaved: initialIsConversationSaved }, ref: React.ForwardedRef<ChatInterfaceHandle>) {

    const searchParams = useSearchParams();
    const [agentName, setAgentName] = useState<string | null>(null);
    const [eventId, setEventId] = useState<string | null>(null);
    const [isPageReady, setIsPageReady] = useState(false); 
    const lastAppendedErrorRef = useRef<string | null>(null);
    const [errorMessages, setErrorMessages] = useState<ErrorMessage[]>([]);
    
    // State for reasoning models
    const [isThinking, setIsThinking] = useState(false);
    const [thinkingTime, setThinkingTime] = useState(0);
    const [thoughtDurations, setThoughtDurations] = useState<Record<string, number>>({});
    const thinkingTimerRef = useRef<NodeJS.Timeout | null>(null);
    const thinkingStartTimeRef = useRef<number | null>(null);
    const thinkingForMessageIdRef = useRef<string | null>(null);

    const [agentCapabilities, setAgentCapabilities] = useState({ pinecone_index_exists: false });

    // WebSocket and Recording State
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [sessionStartTimeUTC, setSessionStartTimeUTC] = useState<string | null>(null); 
    const [wsStatus, setWsStatus] = useState<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');
    const [isBrowserRecording, setIsBrowserRecording] = useState(false); 
    const [isBrowserPaused, setIsBrowserPaused] = useState(false);    
    const [clientRecordingTime, setClientRecordingTime] = useState(0); 
    const [isReconnecting, setIsReconnecting] = useState(false);
    // Industry-standard reconnection and heartbeat parameters
    const MAX_RECONNECT_ATTEMPTS = 10;
    const RECONNECT_DELAY_BASE_MS = 2500; // Start with a 2.5s base delay
    const HEARTBEAT_INTERVAL_MS = 25000; // Ping every 25 seconds
    const PONG_TIMEOUT_MS = 10000; // Wait 10 seconds for a pong response
    const MAX_HEARTBEAT_MISSES = 2; // Try ping/pong twice before considering connection dead

    const wsRef = useRef<WebSocket | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioStreamRef = useRef<MediaStream | null>(null);
    const localRecordingTimerRef = useRef<NodeJS.Timeout | null>(null);
    const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const pongTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const tryReconnectRef = React.useRef<() => void>(() => {});
    
    const isBrowserRecordingRef = useRef(isBrowserRecording);
    useEffect(() => { isBrowserRecordingRef.current = isBrowserRecording; }, [isBrowserRecording]);
    
    const isReconnectingRef = useRef(isReconnecting);
    useEffect(() => { isReconnectingRef.current = isReconnecting; }, [isReconnecting]);
    
    const sessionIdRef = useRef(sessionId);
    useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
    
    const reconnectAttemptsRef = useRef(0);
    const heartbeatMissesRef = useRef(0);
    const isStoppingRef = useRef(false);

    useEffect(() => {
        const agentParam = searchParams.get('agent');
        const eventParam = searchParams.get('event');
        debugLog(`[InitEffect] Params - Agent: ${agentParam}, Event: ${eventParam}`);
        
        const initializeAgent = async (agent: string) => {
            setAgentName(agent);
            setEventId(eventParam);
            
            // Fetch agent capabilities
            try {
                const permsResponse = await fetch('/api/user/permissions');
                if (permsResponse.ok) {
                    const data = await permsResponse.json();
                    const currentAgentData = data.allowedAgents.find((a: any) => a.name === agent);
                    if (currentAgentData) {
                        setAgentCapabilities(currentAgentData.capabilities);
                        console.info(`[Agent Init] Capabilities for ${agent}:`, currentAgentData.capabilities);
                    } else {
                        setAgentCapabilities({ pinecone_index_exists: false }); // Default if agent not in list
                    }
                } else {
                     console.warn(`[Agent Init] Failed to fetch agent capabilities.`);
                     setAgentCapabilities({ pinecone_index_exists: false });
                }
            } catch (error) {
                console.error(`[Agent Init] Error fetching capabilities:`, error);
                setAgentCapabilities({ pinecone_index_exists: false });
            }

            setIsPageReady(true);
            console.info(`[InitEffect] Page is NOW ready. Agent: ${agent}, Event: ${eventParam}`);
        };

        if (agentParam) {
            if (agentParam !== agentName) { // Only re-initialize if agent has changed
                initializeAgent(agentParam);
            }
        } else {
            console.warn("[InitEffect] Chat Interface Waiting: Agent parameter missing from URL.");
            setIsPageReady(false);
        }
    }, [searchParams, agentName]);

    // Helper function to add error messages
    const addErrorMessage = useCallback((content: string) => {
        const errorMessage: ErrorMessage = {
            id: `err-${Date.now()}`,
            role: 'error',
            content,
            createdAt: new Date(),
        };
        // Prevent duplicate consecutive errors
        if (content !== lastAppendedErrorRef.current) {
          setErrorMessages(prev => [...prev, errorMessage]);
          lastAppendedErrorRef.current = content;
        }
    }, []);

    // State for chat history auto-save
    const [currentChatId, setCurrentChatId] = useState<string | null>(null);
    const [chatTitle, setChatTitle] = useState<string | null>(null);

    // Notify parent when chat ID changes
    useEffect(() => {
        if (onChatIdChange) {
            onChatIdChange(currentChatId);
        }
    }, [currentChatId, onChatIdChange]);

    const {
      messages, input, handleInputChange, handleSubmit: originalHandleSubmit,
      isLoading, stop, setMessages, append,
    } = useChat({ 
      api: "/api/proxy-chat",
      body: { agent: agentName, event: eventId || '0000' }, 
      sendExtraMessageFields: true,
      onError: (error) => { 
        console.error("[ChatUI] useChat onError:", error);
        let rawErrorMessage = error.message || "An error occurred.";
        
        // Attempt to parse JSON error from the backend
        try {
            const parsedError = JSON.parse(rawErrorMessage);
            rawErrorMessage = parsedError.error || parsedError.message || rawErrorMessage;
        } catch (e) {
            // Not a JSON error, use as is
        }

        let displayMessage = "I'm having trouble connecting right now. Please try again in a moment.";
        if (rawErrorMessage.includes("Unauthorized")) {
          displayMessage = "Your session may have expired. Please refresh the page.";
        } else if (rawErrorMessage.includes("Assistant is temporarily unavailable")) {
          displayMessage = "The assistant is currently overloaded. Please wait a minute before trying again.";
        } else if (rawErrorMessage.includes("rate limit")) {
          displayMessage = "We're experiencing high traffic right now. Please wait a moment and try again.";
        } else if (rawErrorMessage.includes("Network error") || rawErrorMessage.includes("Failed to fetch") || rawErrorMessage.includes("Could not connect")) {
            displayMessage = "Connection to the chat service failed. Please check your network connection.";
        } else if (rawErrorMessage.includes("Internal Server Error") || rawErrorMessage.includes("500")) {
             displayMessage = "An internal server error occurred. Please try again later.";
        } else if (rawErrorMessage.includes('"data" parts expect an array value')) {
            displayMessage = "An unexpected response was received from the server. Please try again.";
        } else if (rawErrorMessage.length < 200) { // Show short, specific errors from backend
            displayMessage = rawErrorMessage;
        }
        
        addErrorMessage(displayMessage);
      },
      onFinish: async (message) => {
        // Auto-save chat after each assistant response
        if (agentName) {
          await saveChatHistory();
        }
      },
    });

    useEffect(() => {
        if (agentName && isPageReady) {
            console.info(`[ChatInterface] Ready for agent: ${agentName}, event: ${eventId || 'N/A'}`);
        }
    }, [agentName, eventId, isPageReady]);

    // Start thinking timer when loading begins for reasoning models
    useEffect(() => {
        if (selectedModel === 'gemini-2.5-pro' && isLoading && !isThinking) {
            console.log('[Thinking] Starting timer for gemini-2.5-pro');
            setIsThinking(true);
            
            // Store which message this thinking is for (the last user message)
            const lastUserMessage = messages.filter(m => m.role === 'user').pop();
            if (lastUserMessage) {
                thinkingForMessageIdRef.current = lastUserMessage.id;
                console.log('[Thinking] Set message ID for thinking:', lastUserMessage.id);
            }
            
            const startTime = Date.now();
            thinkingStartTimeRef.current = startTime;
            
            // Reset thinking time to 0 and start fresh
            setThinkingTime(0);
            thinkingTimerRef.current = setInterval(() => {
                const elapsed = (Date.now() - startTime) / 1000;
                setThinkingTime(elapsed);
            }, 100);
        }
    }, [isLoading, selectedModel, isThinking, messages]);

    // Stop thinking timer when loading finishes - separate effect without isThinking dependency
    useEffect(() => {
        if (selectedModel === 'gemini-2.5-pro' && !isLoading && thinkingTimerRef.current) {
            // Calculate final time immediately
            const now = Date.now();
            const finalThinkingTime = thinkingStartTimeRef.current 
                ? (now - thinkingStartTimeRef.current) / 1000 
                : 0;
            
            const messageId = thinkingForMessageIdRef.current;
            console.log('[Thinking] Stopping timer, final time:', finalThinkingTime, 'messageId:', messageId);
            
            if (thinkingTimerRef.current) {
                clearInterval(thinkingTimerRef.current);
                thinkingTimerRef.current = null;
            }
            
            // Store final time per message ID and stop thinking
            if (messageId) {
                console.log('[Thinking] Storing duration for message:', messageId, 'duration:', finalThinkingTime);
                setThoughtDurations(prev => {
                    const newDurations = { ...prev, [messageId]: finalThinkingTime };
                    console.log('[Thinking] Updated thoughtDurations:', newDurations);
                    return newDurations;
                });
            } else {
                console.warn('[Thinking] No message ID to store thinking duration for');
            }
            setIsThinking(false);
            thinkingStartTimeRef.current = null;
            thinkingForMessageIdRef.current = null;
        }
    }, [isLoading, selectedModel]);

    // Cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (thinkingTimerRef.current) {
                clearInterval(thinkingTimerRef.current);
                thinkingTimerRef.current = null;
            }
        };
    }, []);


    const supabase = createClient();

    // Auto-save chat history function - saves complete conversation
    const saveChatHistory = useCallback(async (messagesToSave?: Message[]) => {
        const currentMessages = messagesToSave || messages;
        if (!agentName || currentMessages.length === 0) return;

        console.info('[Auto-save] Saving chat with', currentMessages.length, 'messages');

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) {
                console.warn('[Auto-save] No session available for auto-save');
                return;
            }

            const response = await fetch('/api/chat/history/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    agent: agentName,
                    messages: currentMessages, // Always save the complete conversation
                    chatId: currentChatId,
                    title: chatTitle,
                }),
            });

            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    // Only update chat ID and title if we don't have them yet
                    if (!currentChatId) {
                        setCurrentChatId(result.chatId);
                        setChatTitle(result.title);
                        console.info('[Auto-save] New chat created:', result.chatId, result.title);
                    } else {
                        console.info('[Auto-save] Chat updated with all messages:', result.chatId, 'Total messages saved:', currentMessages.length);
                    }
                }
            } else {
                console.error('[Auto-save] Failed to save chat:', response.statusText);
            }
        } catch (error) {
            console.error('[Auto-save] Error saving chat:', error);
        }
    }, [agentName, messages, currentChatId, chatTitle, supabase.auth]);

    const messagesRef = useRef<Message[]>(messages);
    useEffect(() => { messagesRef.current = messages; }, [messages]);

    // Auto-save whenever messages change (with debouncing)
    useEffect(() => {
        if (messages.length > 0 && agentName) {
            const timeoutId = setTimeout(() => {
                saveChatHistory();
            }, 500); // Debounce to avoid too frequent saves
            
            return () => clearTimeout(timeoutId);
        }
    }, [messages, agentName, saveChatHistory]);
    
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
    const [selectedMessage, setSelectedMessage] = useState<string | null>(null);
    const [messageToDelete, setMessageToDelete] = useState<UIMessage | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [confirmationRequest, setConfirmationRequest] = useState<{ type: 'save-message' | 'save-conversation'; message?: Message } | null>(null);
    const isMobile = useMobile();
    const [copyState, setCopyState] = useState<{ id: string; copied: boolean }>({ id: "", copied: false });
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
    const { theme } = useTheme();
    const [savedMessageIds, setSavedMessageIds] = useState<Map<string, Date>>(new Map());
    const [conversationSaveMarkerMessageId, setConversationSaveMarkerMessageId] = useState<string | null>(null);
    const [pendingAction, setPendingAction] = useState<string | null>(null);
    useEffect(() => { pendingActionRef.current = pendingAction; }, [pendingAction]);

    const currentWelcomeMessageConfig = useMemo(() => {
      const activeThemeObject = predefinedThemes.find(t => t.className === theme);
      if (activeThemeObject?.welcomeMessage) {
        return {
          text: activeThemeObject.welcomeMessage.text || G_DEFAULT_WELCOME_MESSAGE.text,
          fontSize: activeThemeObject.welcomeMessage.fontSize || G_DEFAULT_WELCOME_MESSAGE.fontSize,
          fontWeight: activeThemeObject.welcomeMessage.fontWeight || G_DEFAULT_WELCOME_MESSAGE.fontWeight,
        };
      }
      return G_DEFAULT_WELCOME_MESSAGE;
    }, [theme]);
    
    useEffect(() => {
      if (filesForNextMessageRef.current.length > 0) {
        const lastMsg = messagesRef.current[messagesRef.current.length - 1];
        if (lastMsg?.role === 'user') {
          const filesWithId = filesForNextMessageRef.current.map(file => ({ ...file, messageId: lastMsg.id }));
          setAllAttachments(prev => [...prev, ...filesWithId]); filesForNextMessageRef.current = [];
        }
      }
    }, [messages]);

    const hideRecordUI = useCallback(() => {
         if (pendingActionRef.current) return; 
         setRecordUIVisible(false);
         setTimeout(() => { setShowRecordUI(false); setRecordUIVisible(true); }, 300);
     }, []); 

    const startHideTimeout = useCallback(() => {
         if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
         if (!pendingActionRef.current) { 
              hideTimeoutRef.current = setTimeout(hideRecordUI, 5000);
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

    // Notify parent component of recording state changes for fullscreen indicator
    useEffect(() => {
        if (onRecordingStateChange) {
            onRecordingStateChange({
                isBrowserRecording,
                isBrowserPaused,
                clientRecordingTime,
                isReconnecting
            });
        }
    }, [onRecordingStateChange, isBrowserRecording, isBrowserPaused, clientRecordingTime, isReconnecting]);

    const handleSubmitWithCanvasContext = useCallback((
      e: React.FormEvent<HTMLFormElement> | React.KeyboardEvent<HTMLInputElement> | Event,
      chatRequestOptions?: {
        data?: Record<string, string> & {
            current_canvas_time_window_label?: string;
            active_canvas_insights?: string;
            pinned_canvas_insights?: string;
        }
      }
    ) => {
        if (e && typeof (e as React.SyntheticEvent).preventDefault === 'function') {
            (e as React.SyntheticEvent).preventDefault();
        }
        
        if (!isPageReady) {
            addErrorMessage('Cannot send message: Agent/Event not set.');
            return;
        }
        if (isLoading) {
            stop();
        } else if (input.trim() || attachedFiles.length > 0 || (chatRequestOptions?.data && Object.keys(chatRequestOptions.data).length > 0) ) {
            // Don't clear thought duration here - let it be cleared when new thinking actually starts
            if (attachedFiles.length > 0) {
                filesForNextMessageRef.current = [...attachedFiles];
                setAttachedFiles([]);
            } else {
                filesForNextMessageRef.current = [];
            }
            userHasScrolledRef.current = false;
            setShowScrollToBottom(false);
            lastAppendedErrorRef.current = null;
            
            let canvasContextData = chatRequestOptions?.data || {};
            if (!chatRequestOptions?.data && getCanvasContext) { 
                const currentCanvasCtx = getCanvasContext();
                canvasContextData = {
                    current_canvas_time_window_label: currentCanvasCtx.current_canvas_time_window_label || "",
                    active_canvas_insights: currentCanvasCtx.active_canvas_insights || JSON.stringify({}),
                    pinned_canvas_insights: currentCanvasCtx.pinned_canvas_insights || JSON.stringify([])
                };
            }

                const augmentedBody = {
                agent: agentName,
                event: eventId || '0000',
                model: selectedModel,
                temperature: temperature,
                ...canvasContextData,
                transcriptListenMode: localStorage.getItem(`transcriptListenModeSetting_${agentName}`) || "latest",
                savedTranscriptMemoryMode: localStorage.getItem(`savedTranscriptMemoryModeSetting_${agentName}`) || "disabled",
                transcriptionLanguage: localStorage.getItem(`transcriptionLanguageSetting_${agentName}`) || "any",
            };
            
            debugLog("[handleSubmitWithCanvasContext] Final body for API:", augmentedBody);
            originalHandleSubmit(e as React.FormEvent<HTMLFormElement>, { data: augmentedBody });
            
            // Auto-save after user message is sent
            setTimeout(() => {
                saveChatHistory();
            }, 100);
        }
    }, [
        input, 
        isLoading, 
        isPageReady, 
        stop, 
        originalHandleSubmit, 
        attachedFiles, 
        agentName, 
        eventId, 
        append,
        getCanvasContext, 
        selectedModel,
        temperature,
        setAttachedFiles,
        addErrorMessage,
        saveChatHistory
    ]);

    const callHttpRecordingApi = useCallback(async (action: 'start' | 'stop', payload?: any): Promise<any> => {
        debugLog(`[HTTP API Call] Action: ${action}, Payload:`, payload);
        
        const apiUrl = `/api/recording-proxy/`; 
        if (!isPageReady || !agentName) {
            const errorMsg = "Agent/Event not set";
            addErrorMessage(`Error: Cannot ${action} recording. ${errorMsg}`);
            return { success: false, error: errorMsg };
        }

        const { data: { session: supabaseSession }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !supabaseSession) {
            const errorMsg = "Authentication required";
            addErrorMessage(`Error: Authentication required to ${action} recording.`);
            return { success: false, error: errorMsg };
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
            debugLog(`[HTTP API Call] Response for ${action}:`, responseData);
            if (!response.ok) throw new Error(responseData.message || responseData.error || `Failed action '${action}'`);
            
            console.info(`[HTTP API Call] '${action}' action successful.`);
            return { success: true, data: responseData };
        } catch (error: any) {
            console.error(`[HTTP API Call] Error (${action}):`, error);
            addErrorMessage(`Error: Failed to ${action} recording. ${error?.message}`);
            return { success: false, error: error?.message };
        }
    }, [isPageReady, agentName, supabase.auth, addErrorMessage]);

    const resetRecordingStates = useCallback(() => {
        console.info("[Resetting Recording States]");
        isStoppingRef.current = true;
        setIsBrowserRecording(false);
        setIsBrowserPaused(false);
        setClientRecordingTime(0);
        setWsStatus('idle');
        setSessionId(null);
        setSessionStartTimeUTC(null);
        setIsReconnecting(false);
        
        // Clear all timers and intervals
        if (heartbeatIntervalRef.current) {
            clearInterval(heartbeatIntervalRef.current);
            heartbeatIntervalRef.current = null;
        }
        if (pongTimeoutRef.current) {
            clearTimeout(pongTimeoutRef.current);
            pongTimeoutRef.current = null;
        }
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }
        
        // Reset counters
        reconnectAttemptsRef.current = 0;
        heartbeatMissesRef.current = 0;
        
        if (wsRef.current) {
            debugLog(`[Resetting Recording States] Cleaning up WebSocket (readyState: ${wsRef.current.readyState})`);
            wsRef.current.onopen = null;
            wsRef.current.onmessage = null;
            wsRef.current.onerror = null;
            wsRef.current.onclose = null;
            if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
                try { 
                    (wsRef.current as any).__intentionalClose = true;
                    wsRef.current.close(1000, "Client resetting states"); 
                } catch (e) { 
                    console.warn("[Resetting Recording States] Error closing wsRef in reset:", e); 
                }
                debugLog("[Resetting Recording States] WebSocket close() called.");
            }
            wsRef.current = null;
        }

        if (mediaRecorderRef.current) {
            debugLog(`[Resetting Recording States] Cleaning up MediaRecorder (state: ${mediaRecorderRef.current?.state})`);
            mediaRecorderRef.current.ondataavailable = null;
            mediaRecorderRef.current.onstop = null; 
            mediaRecorderRef.current.onerror = null;
            if (mediaRecorderRef.current.state !== "inactive") {
                 try { mediaRecorderRef.current.stop(); } catch (e) { console.warn("[Resetting Recording States] Error stopping MediaRecorder during reset:", e); }
            }
            mediaRecorderRef.current = null;
        }

        if (audioStreamRef.current) {
            debugLog("[Resetting Recording States] Stopping audio stream tracks.");
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
        
        isStoppingRef.current = false;
        debugLog("[Resetting Recording States] Finished.");
    }, []);

    const handleToggleBrowserPause = useCallback((isExternalPause = false) => {
        if (!mediaRecorderRef.current || !isBrowserRecordingRef.current || (pendingActionRef.current && !isExternalPause)) return;
        
        const newPausedState = isExternalPause ? true : !isBrowserPaused;
        debugLog(`[Browser Recording Pause Toggle] New pause state: ${newPausedState}, External: ${isExternalPause}`);

        if (newPausedState) {
            if (mediaRecorderRef.current.state === "recording") {
                mediaRecorderRef.current.pause();
                debugLog("[Browser Recording Pause Toggle] MediaRecorder: Paused.");
            }
        } else {
            if (mediaRecorderRef.current.state === "paused") {
                mediaRecorderRef.current.resume();
                debugLog("[Browser Recording Pause Toggle] MediaRecorder: Resumed.");
            }
        }
        setIsBrowserPaused(newPausedState);

        if (wsRef.current?.readyState === WebSocket.OPEN && !isExternalPause) {
            wsRef.current.send(JSON.stringify({ action: "set_processing_state", paused: newPausedState }));
        }
        startHideTimeout();
    }, [isBrowserPaused, startHideTimeout]);

    const handleStopRecording = useCallback(async (e?: React.MouseEvent, dueToError: boolean = false) => {
        e?.stopPropagation(); 
        const currentWsState = wsRef.current?.readyState;
        const currentMediaRecorderState = mediaRecorderRef.current?.state;
        console.info(`[Stop Recording] Initiated. Error: ${dueToError}. WS=${wsStatus}(${currentWsState}), MR=${currentMediaRecorderState}, Session=${sessionId}, Pending: ${pendingActionRef.current}`);
        
        if (pendingActionRef.current === 'stop' && !dueToError) {
            console.warn("[Stop Recording] Stop operation already in progress. Ignoring.");
            return;
        }
        debugLog("[Stop Recording] Setting pendingAction to 'stop'.");
        setPendingAction('stop'); 
        reconnectAttemptsRef.current = MAX_RECONNECT_ATTEMPTS + 1; // Prevent reconnects during stop
        setIsReconnecting(false);

        try {
            if (mediaRecorderRef.current) {
                mediaRecorderRef.current.ondataavailable = null;
                mediaRecorderRef.current.onerror = null; 
                const recorder = mediaRecorderRef.current; 
                
                const onStopHandler = () => {
                    debugLog("[Stop Recording] MediaRecorder.onstop executed.");
                    if (audioStreamRef.current) {
                        audioStreamRef.current.getTracks().forEach(track => track.stop());
                        audioStreamRef.current = null;
                        debugLog("[Stop Recording] Audio stream tracks stopped.");
                    }
                    setIsBrowserRecording(false);
                    setIsBrowserPaused(false);
                    if (mediaRecorderRef.current === recorder) { 
                        mediaRecorderRef.current = null;
                    }
                };
                recorder.onstop = onStopHandler;

                if (recorder.state !== "inactive") {
                    debugLog("[Stop Recording] Calling MediaRecorder.stop().");
                    try { recorder.stop(); } catch (mrError) { console.warn("[Stop Recording] Error calling MediaRecorder.stop():", mrError); onStopHandler(); }
                } else {
                    debugLog(`[Stop Recording] MediaRecorder already in state: ${recorder.state}. Calling onStop manually.`);
                    onStopHandler(); 
                }
            } else {
                debugLog("[Stop Recording] mediaRecorderRef.current is null.");
                 setIsBrowserRecording(false); setIsBrowserPaused(false); 
                if (audioStreamRef.current) { 
                    audioStreamRef.current.getTracks().forEach(track => track.stop());
                    audioStreamRef.current = null;
                }
            }
            
            if (wsRef.current) {
                const wsToClose = wsRef.current;
                 wsToClose.onopen = null; wsToClose.onmessage = null; wsToClose.onerror = null;
                (wsToClose as any).__intentionalClose = true;
                
                wsToClose.onclose = () => { 
                    console.info("[Stop Recording] Client WebSocket deliberately closed (onclose event fired).");
                    if (wsRef.current === wsToClose) wsRef.current = null; 
                    if (wsStatus !== 'error') setWsStatus('idle');  
                };

                if (wsToClose.readyState === WebSocket.OPEN) {
                    debugLog("[Stop Recording] WebSocket: Sending stop_stream message.");
                    wsToClose.send(JSON.stringify({ action: "stop_stream" }));
                }
                
                // Give a brief moment for the message to be sent before closing
                setTimeout(() => {
                    if (wsToClose.readyState !== WebSocket.CLOSED && wsToClose.readyState !== WebSocket.CLOSING) {
                        debugLog(`[Stop Recording] WebSocket: Closing client-side connection (current state: ${wsToClose.readyState}).`);
                        try { wsToClose.close(1000, "Client user stopped recording"); } catch(err){ console.warn("[Stop Recording] Error during ws.close():", err); if (wsStatus !== 'error') setWsStatus('idle'); wsRef.current = null;}
                    } else { 
                        if (wsRef.current === wsToClose) wsRef.current = null; 
                        if (wsStatus !== 'error') setWsStatus('idle');
                    }
                }, 100);
            } else {
                setWsStatus('idle'); 
            }
            
            const currentSessionIdToStop = sessionId; 
            if (currentSessionIdToStop) {
                console.info("[Stop Recording] Calling HTTP stop for session:", currentSessionIdToStop);
                const result = await callHttpRecordingApi('stop', { session_id: currentSessionIdToStop });
                if (result.success) {
                    debugLog("[Stop Recording] Recording session stopped via HTTP:", result.data);
                } else {
                    console.error("[Stop Recording] Failed to stop recording session via HTTP:", result.error);
                    if (!dueToError) {
                         addErrorMessage(`Error: Could not properly stop recording session (HTTP). ${result.error || ''}`);
                    }
                }
            } else {
                if (!dueToError) console.warn("[Stop Recording] No session ID available to send HTTP stop signal.");
            }
            
            debugLog("[Stop Recording] Resetting client states.");
            setClientRecordingTime(0);
            setShowRecordUI(false);
            setRecordUIVisible(true); 
            if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
            setSessionId(null); 
            setSessionStartTimeUTC(null);
            
            console.info("[Stop Recording] Finished cleanup logic. DueToError:", dueToError);
        } finally {
            debugLog("[Stop Recording] In finally block, setting pendingAction to null.");
            setPendingAction(null);
        }

    }, [sessionId, callHttpRecordingApi, wsStatus, addErrorMessage, setPendingAction, setIsBrowserRecording, setIsBrowserPaused, setClientRecordingTime, setShowRecordUI, setRecordUIVisible, setSessionId, setSessionStartTimeUTC]);

    const startBrowserMediaRecording = useCallback(async () => {
        debugLog(`[Browser Recording] Attempting. WS state: ${wsRef.current?.readyState}, MediaRecorder state: ${mediaRecorderRef.current?.state}`);
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            console.error("[Browser Recording] WebSocket not open. Cannot start recording.");
            addErrorMessage('Error: Could not start microphone. Stream not ready.');
            if (pendingActionRef.current === 'start') setPendingAction(null);
            return;
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
             console.warn("[Browser Recording] MediaRecorder already recording or paused.");
             if (pendingActionRef.current === 'start') setPendingAction(null);
             return;
        }

        try {
            debugLog("[Browser Recording] Requesting user media...");
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioStreamRef.current = stream;
            debugLog("[Browser Recording] User media obtained.");
            
            const options = { mimeType: 'audio/webm;codecs=opus' }; 
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                console.warn(`[Browser Recording] ${options.mimeType} not supported. Trying default.`);
                // @ts-ignore
                delete options.mimeType; 
            }

            mediaRecorderRef.current = new MediaRecorder(stream, options); 
            debugLog("[Browser Recording] MediaRecorder instance created.");

            mediaRecorderRef.current.ondataavailable = (event) => {
                if (event.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(event.data);
                } else if (event.data.size > 0 && wsRef.current?.readyState !== WebSocket.OPEN) {
                    console.warn(`[MediaRecorder ondataavailable] WebSocket not open (state: ${wsRef.current?.readyState}), cannot send audio data.`);
                }
            };

            mediaRecorderRef.current.onstop = () => { 
                debugLog("[MediaRecorder onstop] Global onstop for MediaRecorder triggered.");
                if (audioStreamRef.current) {
                    audioStreamRef.current.getTracks().forEach(track => track.stop());
                    audioStreamRef.current = null;
                }
                setIsBrowserRecording(false);
                setIsBrowserPaused(false);
            };
            
            mediaRecorderRef.current.onerror = (event) => {
                console.error("[MediaRecorder onerror] Error:", event);
                addErrorMessage('Error: Microphone recording error.');
                if (pendingActionRef.current === 'start') setPendingAction(null);
                handleStopRecording(undefined, true);
            };

            mediaRecorderRef.current.start(3000); 
            console.info("[Browser Recording] MediaRecorder started.");
            setIsBrowserRecording(true);
            setIsBrowserPaused(false);
            setClientRecordingTime(0); 
            setShowRecordUI(true); 
            setRecordUIVisible(true);
            startHideTimeout();
            if (pendingActionRef.current === 'start') setPendingAction(null); 

        } catch (err) {
            console.error("[Browser Recording] Error getting user media or starting recorder:", err);
            addErrorMessage('Error: Could not access microphone. Please check permissions.');
            if (audioStreamRef.current) {
                audioStreamRef.current.getTracks().forEach(track => track.stop());
                audioStreamRef.current = null;
            }
            setIsBrowserRecording(false);
            setIsBrowserPaused(false);
            if (wsStatus === 'connecting' || wsStatus === 'open') setWsStatus('error');
            if (pendingActionRef.current === 'start') setPendingAction(null); 
        }
    }, [startHideTimeout, handleStopRecording, wsStatus, addErrorMessage]);

    // Re-ordered connectWebSocket to be defined before tryReconnect
    const connectWebSocket = useCallback((currentSessionId: string) => {
        debugLog(`[WebSocket] Attempting connect for session: ${currentSessionId}.`);
        if (!currentSessionId) {
            console.error("[WebSocket] No session ID to connect.");
            setWsStatus('error'); if (pendingActionRef.current === 'start') setPendingAction(null); return;
        }
        if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
            console.warn(`[WebSocket] Already open or connecting. Aborting.`);
            if (pendingActionRef.current === 'start') setPendingAction(null); return;
        }

        supabase.auth.getSession().then(({ data: { session }, error: sessionError }) => {
            if (sessionError || !session?.access_token) {
                console.error("[WebSocket] Failed to get auth token for WebSocket.", sessionError);
                addErrorMessage('Error: WebSocket authentication failed.');
                setWsStatus('error'); if (pendingActionRef.current === 'start') setPendingAction(null); return;
            }
            const token = session.access_token;
            setWsStatus('connecting');
            
            // Unified WebSocket URL logic
            const wsBaseUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL || (process.env.NEXT_PUBLIC_BACKEND_API_URL || '').replace(/^http/, 'ws');
            if (!wsBaseUrl) {
                console.error("[WebSocket] WebSocket URL is not configured. Set NEXT_PUBLIC_WEBSOCKET_URL or NEXT_PUBLIC_BACKEND_API_URL.");
                addErrorMessage('Error: WebSocket URL is not configured.');
                setWsStatus('error');
                if (pendingActionRef.current === 'start') setPendingAction(null);
                return;
            }

            const wsUrl = `${wsBaseUrl}/ws/audio_stream/${currentSessionId}?token=${token}`;
            
            console.info("[WebSocket] Attempting to connect to URL:", wsUrl.replace(/token=.*$/, 'token=REDACTED'));
            const newWs = new WebSocket(wsUrl);
            wsRef.current = newWs;
            (wsRef.current as any).__intentionalClose = false;
    
            newWs.onopen = () => {
                if (wsRef.current !== newWs) {
                    console.warn(`[WebSocket] Stale onopen event for ${newWs.url}. Ignoring.`);
                    try { newWs.close(); } catch(e){ console.warn("[WebSocket] Error closing stale newWs onopen:", e);}
                    return;
                }
                console.info(`[WebSocket] Connection opened for session ${currentSessionId}. Reconnecting: ${isReconnectingRef.current}`);
                setWsStatus('open');
                
                if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
                if (pongTimeoutRef.current) clearTimeout(pongTimeoutRef.current);
                heartbeatMissesRef.current = 0; 
                
                heartbeatIntervalRef.current = setInterval(() => {
                    if (newWs.readyState === WebSocket.OPEN && !isStoppingRef.current) {
                        if (heartbeatMissesRef.current >= MAX_HEARTBEAT_MISSES) {
                            console.warn("[Heartbeat] Already at max misses, closing connection to trigger reconnect.");
                            newWs.close(1000, "Heartbeat timeout after multiple attempts");
                            return;
                        }
                        
                        debugLog(`[Heartbeat] Sending ping (miss count: ${heartbeatMissesRef.current})`);
                        newWs.send(JSON.stringify({action: 'ping'}));
                        
                        if (pongTimeoutRef.current) clearTimeout(pongTimeoutRef.current);
                        pongTimeoutRef.current = setTimeout(() => {
                            heartbeatMissesRef.current++;
                            console.warn(`[Heartbeat] Pong not received in time (miss ${heartbeatMissesRef.current}/${MAX_HEARTBEAT_MISSES})`);
                            
                            if (heartbeatMissesRef.current >= MAX_HEARTBEAT_MISSES) {
                                console.error("[Heartbeat] Max heartbeat misses reached. Closing connection to trigger reconnect.");
                                if (isBrowserRecordingRef.current && !isBrowserPaused) {
                                    handleToggleBrowserPause(true); 
                                }
                                newWs.close(1000, "Heartbeat timeout");
                            }
                        }, PONG_TIMEOUT_MS);

                    } else if (newWs.readyState !== WebSocket.OPEN && heartbeatIntervalRef.current) {
                        clearInterval(heartbeatIntervalRef.current);
                    }
                }, HEARTBEAT_INTERVAL_MS);
                
                if (isReconnectingRef.current) {
                    console.info("[WebSocket onopen] Re-opened during reconnect. Resuming recorder and waiting for pong to finalize state.");
                    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
                        mediaRecorderRef.current.resume();
                        setIsBrowserPaused(false);
                    } else {
                        console.error(`[WebSocket onopen] Reconnect logic error: MediaRecorder not paused. State: ${mediaRecorderRef.current?.state}`);
                        handleStopRecording(undefined, true);
                    }
                } else {
                    startBrowserMediaRecording();
                }
            };

            newWs.onmessage = (event) => {
                if (wsRef.current === newWs) {
                    try {
                        const messageData = JSON.parse(event.data);
                        if (messageData.type === 'pong') {
                            if (pongTimeoutRef.current) clearTimeout(pongTimeoutRef.current);
                            heartbeatMissesRef.current = 0; 
                            debugLog("[Heartbeat] Pong received.");

                            if (isReconnectingRef.current) {
                                console.info("[WebSocket onmessage] First pong after reconnect received. Finalizing reconnect state.");
                                setIsReconnecting(false); 
                                reconnectAttemptsRef.current = 0; 
                                addErrorMessage("Connection re-established and stable.");
                            }
                        } else {
                            debugLog(`[WebSocket] Message from server:`, event.data);
                        }
                    } catch (e) {
                         debugLog(`[WebSocket] Non-JSON message from server:`, event.data);
                    }
                }
            };
            newWs.onerror = (event) => {
                console.error(`[WebSocket] Error for session ${currentSessionId}:`, event);
                if (wsRef.current === newWs) {
                     addErrorMessage('Error: Recording stream connection failed.');
                     setWsStatus('error');
                     if (pendingActionRef.current === 'start') setPendingAction(null);
                }
            };
            newWs.onclose = (event) => {
                console.info(`[WebSocket] Connection closed for session ${currentSessionId}. Code: ${event.code}, Clean: ${event.wasClean}. Intentional: ${(wsRef.current as any)?.__intentionalClose}`);
                if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
                if (pongTimeoutRef.current) clearTimeout(pongTimeoutRef.current);

                if (wsRef.current === newWs) {
                    const intentionalClientClose = (wsRef.current as any)?.__intentionalClose || pendingActionRef.current === 'stop';
                    setWsStatus('closed');
                    wsRef.current = null;
                    if (!intentionalClientClose && isBrowserRecordingRef.current) {
                        console.warn(`[WebSocket] Unexpected close while recording was active.`);
                        handleToggleBrowserPause(true); 
                        
                        if (!isReconnectingRef.current) {
                            setIsReconnecting(true);
                            isReconnectingRef.current = true;
                            reconnectAttemptsRef.current = 0;
                            tryReconnectRef.current();
                        } else {
                            console.log("Reconnect attempt failed, scheduling next one via tryReconnect.");
                            tryReconnectRef.current();
                        }
                    } else {
                        if (pendingActionRef.current === 'start' && !event.wasClean) {
                            addErrorMessage('WebSocket connection closed before recording could fully start.');
                        }
                        if (pendingActionRef.current === 'start') setPendingAction(null);
                        setIsReconnecting(false);
                        reconnectAttemptsRef.current = 0;
                        if (!isBrowserRecordingRef.current && !pendingActionRef.current) {
                            resetRecordingStates();
                        }
                    }
                }
            };
        });
    }, [supabase.auth, startBrowserMediaRecording, resetRecordingStates, addErrorMessage, handleToggleBrowserPause, handleStopRecording]);

    const tryReconnect = useCallback(() => {
        if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
            addErrorMessage('Failed to reconnect recording after multiple attempts. Please stop and start manually.');
            resetRecordingStates();
            return;
        }
    
        reconnectAttemptsRef.current++;
        const nextAttempt = reconnectAttemptsRef.current;
        
        addErrorMessage(`Connection lost. Recording paused. Attempting to reconnect (${nextAttempt}/${MAX_RECONNECT_ATTEMPTS})...`);
        
        const backoff = Math.pow(2, nextAttempt - 1);
        const jitter = Math.random() * 1000; // Add up to 1s of random delay
        const delay = (RECONNECT_DELAY_BASE_MS * backoff) + jitter;
        
        console.log(`[Reconnect] Scheduling attempt ${nextAttempt} in ${delay.toFixed(0)}ms (base: ${RECONNECT_DELAY_BASE_MS}, backoff: ${backoff}x, jitter: ${jitter.toFixed(0)}ms)`);
    
        reconnectTimeoutRef.current = setTimeout(() => {
            if (!navigator.onLine) {
                console.log(`[Reconnect] Still offline. Waiting before next attempt.`);
                tryReconnectRef.current(); // Use ref for recursive call
                return;
            }
    
            const currentSessionToReconnect = sessionIdRef.current;
            if (currentSessionToReconnect) {
                console.log(`[Reconnect] Attempt ${nextAttempt}: Re-connecting to session ${currentSessionToReconnect}...`);
                connectWebSocket(currentSessionToReconnect);
            } else {
                console.error("[Reconnect] Cannot reconnect: session ID is null.");
                addErrorMessage('Cannot reconnect: session information was lost. Please stop and start recording again.');
                setIsReconnecting(false);
                resetRecordingStates();
            }
        }, delay);
    }, [addErrorMessage, resetRecordingStates, connectWebSocket]);

    useEffect(() => {
        tryReconnectRef.current = tryReconnect;
    }, [tryReconnect]);

    const handleStartRecordingSession = useCallback(async () => {
        console.info(`[Start Recording Session] Initiated. Pending: ${pendingActionRef.current}, BrowserRec: ${isBrowserRecordingRef.current}, PageReady: ${isPageReady}, Agent: ${agentName}`);
        if (pendingActionRef.current || isBrowserRecordingRef.current) {
            console.warn(`[Start Recording Session] Manual start: Pre-condition not met.`); return;
        }
        setPendingAction('start');
        resetRecordingStates(); // This is only for brand new sessions now
        debugLog("[Start Recording Session] Called resetRecordingStates for new session.");
        
        const currentAgent = searchParams.get('agent');
        const currentEvent = searchParams.get('event') || '0000';
        if (!currentAgent) {
            addErrorMessage('Agent information is missing. Cannot start recording.');
            setPendingAction(null); return;
        }
        setAgentName(currentAgent); setEventId(currentEvent);
        const currentTranscriptionLanguage = localStorage.getItem(`transcriptionLanguageSetting_${currentAgent}`) || "any";
        try {
            console.log(`[VAD TEST] Starting recording with aggressiveness: ${vadAggressiveness}`);
            const result = await callHttpRecordingApi('start', { 
              agent: currentAgent, 
              event: currentEvent, 
              transcriptionLanguage: currentTranscriptionLanguage,
              vad_aggressiveness: vadAggressiveness 
            });
            if (result.success && result.data?.session_id) {
                console.info("[Start Recording Session] HTTP start successful. New Session ID:", result.data.session_id);
                setSessionId(result.data.session_id); setSessionStartTimeUTC(result.data.session_start_time_utc);
                connectWebSocket(result.data.session_id);
            } else {
                console.error("[Start Recording Session] Failed to start recording session (HTTP):", result.error);
                setPendingAction(null);
            }
        } catch (error) {
            console.error("[Start Recording Session] Exception during HTTP start API call:", error);
            addErrorMessage('Error: Exception trying to start recording session.');
            setPendingAction(null);
        }
    }, [isPageReady, agentName, callHttpRecordingApi, resetRecordingStates, searchParams, addErrorMessage, connectWebSocket]);
    

    const showAndPrepareRecordingControls = useCallback(() => {
        debugLog(`[Recording Controls UI] Show/Prepare. Pending: ${pendingActionRef.current}, BrowserRec: ${isBrowserRecordingRef.current}`);
        if (pendingActionRef.current) return;
        setShowPlusMenu(false); 
        if (isBrowserRecordingRef.current) {
             setShowRecordUI(true);
             setRecordUIVisible(true);
             if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
             startHideTimeout();
        } else {
            handleStartRecordingSession();
        }
    }, [handleStartRecordingSession, startHideTimeout]);


     useImperativeHandle(ref, () => ({
        startNewChat: async () => {
             console.info("[New Chat] Imperative handle called.");
             if (isBrowserRecordingRef.current || sessionId) {
                console.info("[New Chat] Active recording detected, stopping it first.");
                await handleStopRecording(undefined, false); 
             }
             setMessages([]); 
             setAttachedFiles([]); 
             setAllAttachments([]); 
             filesForNextMessageRef.current = [];
             // Reset chat ID and title for new chat
             setCurrentChatId(null);
             setChatTitle(null);
             if (onHistoryRefreshNeeded) {
                onHistoryRefreshNeeded();
             }
             console.info("[New Chat] Client states (messages, attachments, chat ID) reset.");
          },
         getMessagesCount: () => messages.length,
         scrollToTop: () => { messagesContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); userHasScrolledRef.current = false; setShowScrollToBottom(false); },
         setInput: (text: string) => {
            handleInputChange({ target: { value: text } } as React.ChangeEvent<HTMLInputElement>);
         },
         submitMessageWithCanvasContext: (messageContent, canvasContext) => {
            handleInputChange({ target: { value: messageContent } } as React.ChangeEvent<HTMLInputElement>);
            debugLog("[submitMessageWithCanvasContext] Submitting with canvas context:", canvasContext);
            handleSubmitWithCanvasContext(
              { preventDefault: () => {}, stopPropagation: () => {} } as unknown as React.FormEvent<HTMLFormElement>,
              { data: canvasContext }
            );
         },
         loadChatHistory: async (chatId: string, isSaved?: boolean) => {
            console.info("[Load Chat History] Loading chat:", chatId, "isSaved:", isSaved);
            try {
              const { data: { session } } = await supabase.auth.getSession();
              if (!session?.access_token) {
                addErrorMessage('Authentication required to load chat history.');
                return;
              }

              const response = await fetch(`/api/chat/history/get?chatId=${encodeURIComponent(chatId)}`, {
                headers: {
                  'Authorization': `Bearer ${session.access_token}`,
                },
              });

              if (!response.ok) {
                throw new Error(`Failed to load chat: ${response.statusText}`);
              }

              const chatData = await response.json();
              
              if (isBrowserRecordingRef.current || sessionId) {
                await handleStopRecording(undefined, false);
              }

              // Clear all relevant states for the new chat
              setAttachedFiles([]);
              setAllAttachments([]);
              filesForNextMessageRef.current = [];
              setSavedMessageIds(new Map());
              setConversationSaveMarkerMessageId(null);

              setCurrentChatId(chatData.id);
              setChatTitle(chatData.title);

              if (chatData.messages && Array.isArray(chatData.messages)) {
                setMessages(chatData.messages);
                console.info("[Load Chat History] Loaded", chatData.messages.length, "messages for chat:", chatData.id);
              }

              // Populate saved states from the loaded data
              if (chatData.savedMessageIds && Object.keys(chatData.savedMessageIds).length > 0) {
                const newSavedMessages = new Map(Object.entries(chatData.savedMessageIds).map(([id, dateStr]) => [id, new Date(dateStr as string)]));
                setSavedMessageIds(newSavedMessages);
                console.info("[Load Chat History] Loaded", newSavedMessages.size, "saved messages.");
              }
              if (isSaved && chatData.last_message_id_at_save) {
                setConversationSaveMarkerMessageId(chatData.last_message_id_at_save);
                console.info("[Load Chat History] Loaded conversation save marker at message ID:", chatData.last_message_id_at_save);
              } else {
                setConversationSaveMarkerMessageId(null);
              }

            } catch (error) {
              console.error("[Load Chat History] Error:", error);
              addErrorMessage(`Failed to load chat history: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
         }
     }), [sessionId, setMessages, messages.length, handleStopRecording, handleInputChange, handleSubmitWithCanvasContext, supabase.auth, addErrorMessage]);


    const checkScroll = useCallback(() => {
      const c = messagesContainerRef.current;
      if (!c) return;
      const { scrollTop: st, scrollHeight: sh, clientHeight: ch } = c;
      const atBottomThresholdForLogic = 2;
      const atBottomThresholdForButtonVisibility = 180;
      const isScrollable = sh > ch;
      const isAtBottomForLogic = (sh - st - ch) < atBottomThresholdForLogic;
      if (st < prevScrollTopRef.current && !isAtBottomForLogic && !userHasScrolledRef.current) userHasScrolledRef.current = true;
      else if (userHasScrolledRef.current && isAtBottomForLogic) userHasScrolledRef.current = false;
      prevScrollTopRef.current = st;
      const isAtBottomForButton = (sh - st - ch) < atBottomThresholdForButtonVisibility;
      setShowScrollToBottom(isScrollable && !isAtBottomForButton);
    }, []);

    const scrollToBottom = useCallback((b: ScrollBehavior = "smooth") => { if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: b }); userHasScrolledRef.current = false; setShowScrollToBottom(false); }, []);
    useEffect(() => { if (!userHasScrolledRef.current) { const id = requestAnimationFrame(() => { setTimeout(() => { scrollToBottom('smooth'); }, 50); }); return () => cancelAnimationFrame(id); } else if (!isLoading && userHasScrolledRef.current) checkScroll(); }, [messages, isLoading, scrollToBottom, checkScroll]);
    useEffect(() => { const c = messagesContainerRef.current; if (c) { c.addEventListener("scroll", checkScroll, { passive: true }); return () => c.removeEventListener("scroll", checkScroll); } }, [checkScroll]);

    useEffect(() => { 
         const handleClick = (e: Event) => {
             const target = e.target as Node;
             
             // Handle record UI click outside
             if (showRecordUI && isBrowserRecordingRef.current && !pendingActionRef.current) {
                 const isOutsideControls = recordUIRef.current && !recordUIRef.current.contains(target);
                 // In fullscreen mode, statusRecordingRef.current is null, so we need to handle this case
                 const isOutsideTrigger = !statusRecordingRef.current || !statusRecordingRef.current.contains(target);
                 
                 if (isOutsideControls && isOutsideTrigger) {
                     hideRecordUI();
                 }
             }
             
             // Handle plus menu click outside
             if (showPlusMenu && plusMenuRef.current && !plusMenuRef.current.contains(target)) {
                 setShowPlusMenu(false);
             }
         };
         
         document.addEventListener("mousedown", handleClick, true);
         document.addEventListener("touchstart", handleClick, true); // Add touch support
         
         return () => {
             document.removeEventListener("mousedown", handleClick, true);
             document.removeEventListener("touchstart", handleClick, true);
         };
     }, [showRecordUI, showPlusMenu, hideRecordUI, isBrowserRecordingRef.current, pendingActionRef.current]);

    useEffect(() => { 
         const el = statusRecordingRef.current; if (!el) return;
         const enter = () => {
            if (isBrowserRecordingRef.current) {
                if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
                setRecordUIVisible(true); setShowRecordUI(true);
            }
         };
         const leave = () => {
            if (isBrowserRecordingRef.current) startHideTimeout();
         };
         el.addEventListener("mouseenter", enter); el.addEventListener("mouseleave", leave);
         return () => { el.removeEventListener("mouseenter", enter); el.removeEventListener("mouseleave", leave); };
     }, [startHideTimeout]);

    useEffect(() => { return () => { if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current); }; }, []); 

    const handlePlayPauseMicClick = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (pendingActionRef.current) return;
        if (!isBrowserRecordingRef.current) {
            await handleStartRecordingSession();
        } else {
            handleToggleBrowserPause();
        }
    }, [handleStartRecordingSession, handleToggleBrowserPause]);

    const saveChat = useCallback(() => { console.info("[Save Chat] Initiated."); const chatContent = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n"); const blob = new Blob([chatContent], { type: "text/plain" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `chat-${agentName || 'agent'}-${eventId || 'event'}-${new Date().toISOString().slice(0, 10)}.txt`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); setShowPlusMenu(false); }, [messages, agentName, eventId]);


    const executeSaveConversation = useCallback(async () => {
        debugLog("[Save Chat to Memory] Executing after confirmation.");
        const currentMessages = messagesRef.current;
        if (!agentName || currentMessages.length === 0 || !currentChatId) {
            addErrorMessage('Cannot save memory: Chat is empty or has not been initialized.');
            return;
        }

        const lastMessageId = currentMessages.length > 0 ? currentMessages[currentMessages.length - 1].id : null;
        const originalSaveMarker = conversationSaveMarkerMessageId;

        if (lastMessageId) {
            setConversationSaveMarkerMessageId(lastMessageId);
        }
        const toastId = `save-memory-${currentChatId}`;

        if (onHistoryRefreshNeeded) {
            onHistoryRefreshNeeded();
        }

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) throw new Error("Authentication error. Cannot save memory.");

            const response = await fetch('/api/chat/history/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
                body: JSON.stringify({
                    agent: agentName,
                    messages: currentMessages,
                    chatId: currentChatId,
                    title: chatTitle,
                    lastMessageId: lastMessageId,
                }),
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || "Failed to save chat history.");

            const memoryResponse = await fetch('/api/memory/save-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
                body: JSON.stringify({
                    agentName: agentName,
                    messages: currentMessages,
                    sessionId: currentChatId,
                    savedAt: new Date().toISOString()
                }),
            });
            if (!memoryResponse.ok) {
                const memResult = await memoryResponse.json().catch(() => ({}));
                throw new Error(memResult.error || "Failed to save to intelligent memory.");
            }
            toast.success("Chat saved to memory successfully.", { id: toastId });
        } catch (error: any) {
            console.error('[Save to Memory] Error:', error);
            toast.error(`Failed to save memory: ${error.message}. Reverting.`, { id: toastId });
            setConversationSaveMarkerMessageId(originalSaveMarker);
        } finally {
            setConfirmationRequest(null);
        }
    }, [agentName, currentChatId, chatTitle, addErrorMessage, supabase.auth, conversationSaveMarkerMessageId]);

    const executeSaveMessage = useCallback(async (message: Message) => {
        debugLog("[Save Message to Memory] Executing after confirmation for message:", message.id);
        if (!agentName || !agentCapabilities.pinecone_index_exists) {
            addErrorMessage('Cannot save message: Agent not configured or Pinecone index missing.');
            setConfirmationRequest(null);
            return;
        }

        const toastId = `save-message-${message.id}`;
        const newSaveDate = new Date();
        setSavedMessageIds(prev => new Map(prev).set(message.id, newSaveDate));

        if (onHistoryRefreshNeeded) {
            onHistoryRefreshNeeded();
        }

        try {
            const response = await fetch('/api/memory/save-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agentName: agentName,
                    messages: [message],
                    sessionId: `message_${message.id}_${Date.now()}`,
                    savedAt: newSaveDate.toISOString()
                }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Failed to save message.");
            toast.success("Message saved to memory.", { id: toastId });
        } catch (error: any) {
            console.error('[Save Message to Memory] Error:', error);
            toast.error(`Failed to save message: ${error.message}. Reverting.`, { id: toastId });
            setSavedMessageIds(prev => {
                const newMap = new Map(prev);
                newMap.delete(message.id);
                return newMap;
            });
        } finally {
            setConfirmationRequest(null);
        }
    }, [agentName, agentCapabilities.pinecone_index_exists, addErrorMessage]);

    const handleSaveChatToMemory = () => {
        setShowPlusMenu(false);
        setConfirmationRequest({ type: 'save-conversation' });
    };

    const handleSaveMessageToMemory = (message: Message) => {
        setConfirmationRequest({ type: 'save-message', message });
    };
    const attachDocument = useCallback(() => { debugLog("[Attach Document] Triggered."); fileInputRef.current?.click(); setShowPlusMenu(false); }, []);
    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files && e.target.files.length > 0) { const newFiles = Array.from(e.target.files).map((file) => ({ id: Math.random().toString(36).substring(2, 9), name: file.name, size: file.size, type: file.type, url: URL.createObjectURL(file), })); setAttachedFiles((prev) => [...prev, ...newFiles]); debugLog("[File Change] Files attached:", newFiles.map(f=>f.name)); } if (fileInputRef.current) fileInputRef.current.value = ""; }, []);
    const removeFile = useCallback((id: string) => { debugLog("[Remove File] Removing file ID:", id); setAttachedFiles((prev) => { const fileToRemove = prev.find((file) => file.id === id); if (fileToRemove?.url) URL.revokeObjectURL(fileToRemove.url); return prev.filter((file) => file.id !== id); }); }, []);
    const handleRecordUIMouseMove = useCallback(() => { if (isBrowserRecordingRef.current) { if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current); setRecordUIVisible(true); startHideTimeout(); }}, [startHideTimeout]);
    const handlePlusMenuClick = useCallback((e: React.MouseEvent) => { e.stopPropagation(); if (showRecordUI && !isBrowserRecordingRef.current) hideRecordUI(); setShowPlusMenu(prev => !prev); }, [showRecordUI, hideRecordUI]);
    const handleMessageInteraction = useCallback((id: string) => {
        if (isMobile) {
            setSelectedMessage(prev => prev === id ? null : id);
        }
    }, [isMobile]);
    
    const copyToClipboard = useCallback((text: string, id: string) => {
      const notifySuccess = () => { setCopyState({ id, copied: true }); setTimeout(() => { setCopyState({ id: "", copied: false }); }, 2000); }; 
      const notifyFailure = (err?: any) => { console.error("[Copy To Clipboard] Failed:", err); setCopyState({ id, copied: false }); };
      if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(notifySuccess).catch(notifyFailure); 
      } else { 
        console.warn("[Copy To Clipboard] Fallback copy (execCommand).");
        try { 
          const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.left = "-9999px"; ta.style.top = "-9999px"; document.body.appendChild(ta); ta.focus(); ta.select(); 
          const ok = document.execCommand('copy'); document.body.removeChild(ta); 
          if (ok) notifySuccess(); else throw new Error('execCommand fail'); 
        } catch (err) { 
          notifyFailure(err); 
        } 
      } 
    }, []);
    
    const editMessage = useCallback((id: string) => console.info("[Edit Message] Triggered for ID:", id), []);
    
    const readAloud = useCallback((text: string) => {
        console.info("[Read Aloud] Triggered.");
    }, []);

    const handleDeleteMessage = useCallback(async () => {
        if (!messageToDelete || !currentChatId || isDeleting) return;

        const originalMessages = [...messages];
        const originalErrorMessages = [...errorMessages];
        const messageIdToDelete = messageToDelete.id;

        // Optimistically remove the message from the UI
        setMessages(prev => prev.filter(m => m.id !== messageIdToDelete));
        setErrorMessages(prev => prev.filter(m => m.id !== messageIdToDelete));
        setMessageToDelete(null); // Close the dialog immediately

        const toastId = `delete-message-${messageIdToDelete}`;
        
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) {
                throw new Error("Authentication error. Cannot delete message.");
            }

            const response = await fetch('/api/chat/history/delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    chatId: currentChatId,
                    messageId: messageIdToDelete,
                }),
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.error || "Failed to delete message from backend.");
            }

            // Backend confirmed deletion, update save marker if necessary
            if (result.new_last_message_id_at_save) {
                setConversationSaveMarkerMessageId(result.new_last_message_id_at_save);
            } else if (conversationSaveMarkerMessageId === messageIdToDelete) {
                setConversationSaveMarkerMessageId(null);
            }
            
            toast.success("Message deleted.", { id: toastId });

        } catch (error: any) {
            console.error('[Delete Message] Error:', error);
            toast.error(`Failed to delete message: ${error.message}. Restoring.`, { id: toastId });
            
            // Rollback UI on failure
            setMessages(originalMessages);
            setErrorMessages(originalErrorMessages);
        }
    }, [messageToDelete, currentChatId, supabase.auth, setMessages, isDeleting, conversationSaveMarkerMessageId, messages, errorMessages]);

    const onSubmit = handleSubmitWithCanvasContext;
    
    useEffect(() => { 
      const lKeyDown = (e: KeyboardEvent) => { 
        if (e.key === "Enter" && !e.shiftKey && !isLoading && (input.trim() || attachedFiles.length > 0)) { 
          e.preventDefault(); 
          handleSubmitWithCanvasContext(e as any);
        } else if (e.key === "Enter" && !e.shiftKey && isLoading) {
          e.preventDefault(); 
        }
      }; 
      const el = inputRef.current; 
      if (el) {
        el.addEventListener("keydown", lKeyDown as EventListener); 
      }
      return () => { 
        if (el) {
          el.removeEventListener("keydown", lKeyDown as EventListener); 
        }
      } 
    }, [input, isLoading, stop, attachedFiles.length, handleSubmitWithCanvasContext]);

    useEffect(() => {
        if (!isBrowserRecording && !pendingAction && isPageReady && inputRef.current) {
            debugLog(`[FocusEffect] Conditions met: !isBrowserRecording (${!isBrowserRecording}), !pendingAction (${!pendingAction}), isPageReady (${isPageReady}).`);
            const timerId = setTimeout(() => {
                if (inputRef.current) {
                    const inputElement = inputRef.current;
                    debugLog(`[FocusEffect - setTimeout] Attempting focus. input.disabled attribute value: ${inputElement.getAttribute('disabled')}, input.disabled prop value: ${inputElement.disabled}, document.activeElement:`, document.activeElement);
                    
                    if (!inputElement.disabled) {
                        inputElement.focus({ preventScroll: true });
                        debugLog(`[FocusEffect - setTimeout] Called inputRef.current.focus(). New activeElement:`, document.activeElement);
                        if (document.activeElement !== inputElement) {
                           console.warn("[FocusEffect - setTimeout] Input focus attempt did NOT result in input being active element. Active element is:", document.activeElement);
                        } else {
                           debugLog("[FocusEffect - setTimeout] Input is NOW the active element.");
                        }
                    } else {
                        console.warn(`[FocusEffect - setTimeout] Input field is reported as disabled (prop: ${inputElement.disabled}) at the moment of focus attempt. State: pendingAction=${pendingAction}, isPageReady=${isPageReady}. Cannot focus.`);
                    }
                } else {
                    console.warn("[FocusEffect - setTimeout] inputRef.current is null, cannot focus.");
                }
            }, 100);
            return () => clearTimeout(timerId);
        }
    }, [isBrowserRecording, pendingAction, isPageReady]);


    const micButtonClass = cn(
        "p-2 plus-menu-item",
        isBrowserRecording && "recording", 
        isBrowserRecording && isBrowserPaused && "paused" 
    );
    const combinedMessages = useMemo(() => {
        const allMsgs: UIMessage[] = [...messages, ...errorMessages];
        return allMsgs.sort((a, b) => {
            const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return timeA - timeB;
        });
    }, [messages, errorMessages]);
    return (
        <div className="flex flex-col" style={{ height: 'calc(100vh - var(--header-height) - var(--input-area-height))' }}>
            <div className="messages-container" ref={messagesContainerRef} style={{ paddingLeft: '8px', paddingRight: '8px' }}>
                {combinedMessages.length === 0 && !isPageReady && ( <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-10"> <p className="text-2xl md:text-3xl font-bold text-center opacity-50">Loading...</p> </div> )}
                {combinedMessages.length === 0 && isPageReady &&( <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-10 px-8"> <p className="text-center opacity-80" style={{ fontSize: currentWelcomeMessageConfig.fontSize, fontWeight: currentWelcomeMessageConfig.fontWeight, lineHeight: '1.2' }}>{currentWelcomeMessageConfig.text}</p> </div> )}
                {combinedMessages.length > 0 && (
                  <div className="space-y-1 pt-8 pb-4">
                    {combinedMessages.map((message: UIMessage, index: number) => {
                      const isUser = message.role === "user";
                      const isSystem = message.role === "system";
                      const isError = message.role === "error";
                      const isMessageSaved = savedMessageIds.has(message.id);
                      const messageSaveTime = savedMessageIds.get(message.id);
                      const shouldShowSaveMarker = message.id === conversationSaveMarkerMessageId;
                      const messageAttachments = allAttachments.filter((file) => file.messageId === message.id);
                      const hasAttachments = messageAttachments.length > 0;
                      const isFromCanvas = isUser && message.content.startsWith("🎨 From Canvas:");
                      const displayContent = isFromCanvas ? message.content.substring("🎨 From Canvas:".length).trim() : message.content;
                      
                      // Find the last user message index
                      const lastUserMessageIndex = combinedMessages.map((msg, idx) => msg.role === 'user' ? idx : -1).filter(idx => idx !== -1).pop() ?? -1;
                      const isLastUserMessage = isUser && index === lastUserMessageIndex;
                      const messageThoughtDuration = isUser ? thoughtDurations[message.id] : undefined;
                      
                      return (
                        <React.Fragment key={message.id}>
                          <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.2, ease: "easeOut" }}
                            className={cn(
                              "flex flex-col relative group mb-1",
                              isUser ? "items-end" : isSystem ? "items-center" : "items-start",
                              !isUser && !isSystem && !isError && "assistant-message-container"
                            )}
                            onMouseEnter={() => !isMobile && !isSystem && !isError && setHoveredMessage(message.id)}
                            onMouseLeave={() => !isMobile && setHoveredMessage(null)}
                            onClick={() => !isSystem && !isError && handleMessageInteraction(message.id)}
                          >
                            {isError ? (
                              <div className="error-bubble flex items-center gap-2">
                                <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                                <span>{message.content}</span>
                              </div>
                            ) : (
                              <>
                                {isUser && hasAttachments && (
                                  <div className="mb-2 file-attachment-wrapper self-end mr-1">
                                    <FileAttachmentMinimal
                                      files={messageAttachments}
                                      onRemove={() => {}}
                                      className="file-attachment-message"
                                      maxVisible={1}
                                      isSubmitted={true}
                                      messageId={message.id}
                                    />
                                  </div>
                                )}
                                <div className={cn("rounded-2xl p-3 message-bubble", isUser ? `user-bubble ${hasAttachments ? "with-attachment" : ""} ${isFromCanvas ? "from-canvas" : ""}` : isSystem ? `bg-transparent text-[hsl(var(--text-muted))] text-sm italic text-center max-w-[90%]` : "bg-transparent ai-bubble pl-0" )}>
                                  {isFromCanvas && <span className="text-xs opacity-70 block mb-1">Sent from Canvas:</span>}
                                  {isUser || isSystem ? (
                                    <span
                                      dangerouslySetInnerHTML={{
                                        __html: displayContent.replace(/\n/g, "<br />"),
                                      }}
                                    />
                                  ) : (
                                    <span
                                      dangerouslySetInnerHTML={{
                                        __html: formatAssistantMessage(displayContent),
                                      }}
                                    />
                                  )}
                                </div>
                                {!isSystem && (
                                  <div className={cn( "message-actions flex items-center", isUser ? "justify-end mr-2 mt-1" : "justify-start ml-1 -mt-3" )} style={{ opacity: (!isMobile && hoveredMessage === message.id) || (isMobile && selectedMessage === message.id) || copyState.id === message.id || isMessageSaved ? 1 : 0, visibility: (!isMobile && hoveredMessage === message.id) || (isMobile && selectedMessage === message.id) || copyState.id === message.id || isMessageSaved ? "visible" : "hidden", transition: 'opacity 0.2s ease-in-out', }}>
                                    {isUser && (
                                      <div className="flex items-center">
                                        {isMessageSaved ? (
                                          <>
                                            <div className="opacity-0 group-hover:opacity-100 flex items-center transition-opacity">
                                              <span className="text-xs text-[hsl(var(--icon-secondary))] opacity-75 mr-2">{formatTimestamp(message.createdAt)}</span>
                                              <button onClick={(e) => { e.stopPropagation(); copyToClipboard(message.content, message.id); }} className="action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]" aria-label="Copy message">
                                                {copyState.id === message.id && copyState.copied ? <Check className="h-4 w-4 copy-button-animation" /> : <Copy className="h-4 w-4" />}
                                              </button>
                                              <button onClick={() => editMessage(message.id)} className="action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]" aria-label="Edit message">
                                                <Pencil className="h-4 w-4" />
                                              </button>
                                              <button onClick={(e) => { e.stopPropagation(); setMessageToDelete(message); }} className={cn("action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-destructive))]", isDeleting && "opacity-50 cursor-not-allowed")} aria-label="Delete message" disabled={isDeleting}>
                                                <Trash2 className="h-4 w-4" />
                                              </button>
                                            </div>
                                            <span className="text-xs text-[hsl(var(--save-memory-color))] opacity-75 ml-2">
                                              Message saved
                                            </span>
                                            <Bookmark className="h-4 w-4 stroke-[hsl(var(--save-memory-color))] ml-2" />
                                          </>
                                        ) : (
                                          <>
                                            <span className="text-xs text-[hsl(var(--icon-secondary))] opacity-75 mr-2">{formatTimestamp(message.createdAt)}</span>
                                            <button onClick={(e) => { e.stopPropagation(); copyToClipboard(message.content, message.id); }} className="action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]" aria-label="Copy message">
                                              {copyState.id === message.id && copyState.copied ? <Check className="h-4 w-4 copy-button-animation" /> : <Copy className="h-4 w-4" />}
                                            </button>
                                            <button onClick={() => editMessage(message.id)} className="action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]" aria-label="Edit message">
                                              <Pencil className="h-4 w-4" />
                                            </button>
                                            <button onClick={(e) => { e.stopPropagation(); handleSaveMessageToMemory(message as Message); }} className={cn("action-button text-[hsl(var(--icon-secondary))]", (!agentCapabilities.pinecone_index_exists || isDeleting) ? "opacity-50 cursor-not-allowed" : "hover:text-[hsl(var(--icon-primary))]")} aria-label="Save message to memory" disabled={!agentCapabilities.pinecone_index_exists || isDeleting}>
                                              <Bookmark className="h-4 w-4" />
                                            </button>
                                            <button onClick={(e) => { e.stopPropagation(); setMessageToDelete(message); }} className={cn("action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-destructive))]", isDeleting && "opacity-50 cursor-not-allowed")} aria-label="Delete message" disabled={isDeleting}>
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    )}
                                    {!isUser && (
                                      <div className="flex items-center">
                                        {isMessageSaved ? (
                                          <>
                                            <Bookmark className="h-4 w-4 stroke-[hsl(var(--save-memory-color))] mr-2" />
                                            <span className="text-xs text-[hsl(var(--save-memory-color))] opacity-75 mr-2">
                                              Message saved
                                            </span>
                                            <div className="opacity-0 group-hover:opacity-100 flex items-center transition-opacity">
                                              <button onClick={(e) => { e.stopPropagation(); copyToClipboard(message.content, message.id); }} className="action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]" aria-label="Copy message">
                                                {copyState.id === message.id && copyState.copied ? <Check className="h-4 w-4 copy-button-animation" /> : <Copy className="h-4 w-4" />}
                                              </button>
                                              <button onClick={() => readAloud(message.content)} className="action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]" aria-label="Read message aloud">
                                                <Volume2 className="h-4 w-4" />
                                              </button>
                                               <button onClick={(e) => { e.stopPropagation(); setMessageToDelete(message); }} className={cn("action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-destructive))]", isDeleting && "opacity-50 cursor-not-allowed")} aria-label="Delete message" disabled={isDeleting}>
                                                <Trash2 className="h-4 w-4" />
                                              </button>
                                              <span className="text-xs text-[hsl(var(--icon-secondary))] opacity-75 ml-2">{formatTimestamp(message.createdAt)}</span>
                                            </div>
                                          </>
                                        ) : (
                                          <>
                                            <button onClick={(e) => { e.stopPropagation(); copyToClipboard(message.content, message.id); }} className="action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]" aria-label="Copy message">
                                              {copyState.id === message.id && copyState.copied ? <Check className="h-4 w-4 copy-button-animation" /> : <Copy className="h-4 w-4" />}
                                            </button>
                                            <button onClick={(e) => { e.stopPropagation(); handleSaveMessageToMemory(message as Message); }} className={cn("action-button text-[hsl(var(--icon-secondary))]", (!agentCapabilities.pinecone_index_exists || isDeleting) ? "opacity-50 cursor-not-allowed" : "hover:text-[hsl(var(--icon-primary))]")} aria-label="Save message to memory" disabled={!agentCapabilities.pinecone_index_exists || isDeleting}>
                                              <Bookmark className="h-4 w-4" />
                                            </button>
                                            {((!isMobile && hoveredMessage === message.id) || (isMobile && selectedMessage === message.id)) && (
                                              <>
                                              <button onClick={() => readAloud(message.content)} className="action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]" aria-label="Read message aloud">
                                                <Volume2 className="h-4 w-4" />
                                              </button>
                                              <button onClick={(e) => { e.stopPropagation(); setMessageToDelete(message); }} className={cn("action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-destructive))]", isDeleting && "opacity-50 cursor-not-allowed")} aria-label="Delete message" disabled={isDeleting}>
                                                <Trash2 className="h-4 w-4" />
                                              </button>
                                              </>
                                            )}
                                            <span className="text-xs text-[hsl(var(--icon-secondary))] opacity-75 ml-2">{formatTimestamp(message.createdAt)}</span>
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </>
                            )}
                          </motion.div>
                          
                          {/* Show "Thought for" message for ANY user message that has thinking duration */}
                          {isUser && messageThoughtDuration !== undefined && (
                            <motion.div
                              initial={{ opacity: 0, y: 5 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.3 }}
                              className="flex self-start mb-1 mt-1 pl-2"
                            >
                              <p className="opacity-50">
                                Thought for {formatThoughtDuration(messageThoughtDuration)}.
                              </p>
                            </motion.div>
                          )}
                          
                          {/* Show live thinking indicator and loading states only for the last user message */}
                          {isLastUserMessage && (
                            <>
                              {isThinking && selectedModel === 'gemini-2.5-pro' && (
                                <ThinkingIndicator elapsedTime={thinkingTime} />
                              )}
                              {isLoading && (!isThinking || selectedModel !== 'gemini-2.5-pro') && messageThoughtDuration === undefined && (() => {
                                // Hide thinking dot immediately when assistant starts responding
                                const lastMessage = combinedMessages[combinedMessages.length - 1];
                                const assistantIsResponding = lastMessage?.role === 'assistant' && isLoading;
                                return !assistantIsResponding;
                              })() && (
                                <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="thinking-indicator flex self-start mb-1 mt-1 ml-1">
                                  <span className="thinking-dot"></span>
                                </motion.div>
                              )}
                            </>
                          )}
                          {shouldShowSaveMarker && (
                            <div className="relative py-4 my-8 text-center">
                              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                                <div className="w-full border-t border-[hsl(var(--save-memory-color))] opacity-50"></div>
                              </div>
                              <div className="relative flex justify-center">
                                <span className="bg-[hsl(var(--background))] px-2 text-xs text-[hsl(var(--save-memory-color))]">
                                  Memory saved
                                </span>
                              </div>
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {showScrollToBottom && (
              <button onClick={() => scrollToBottom()} className="scroll-to-bottom-button" aria-label="Scroll to bottom">
                <ArrowDown size={24} />
              </button>
            )}

            <div className="input-area-container flex-shrink-0" style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
                <AlertDialog open={!!messageToDelete} onOpenChange={(open) => !open && setMessageToDelete(null)}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This will permanently delete the message from this chat and any saved memories. This action cannot be undone.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => setMessageToDelete(null)}>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDeleteMessage}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                <AlertDialog open={!!confirmationRequest} onOpenChange={(open) => !open && setConfirmationRequest(null)}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Confirm Save</AlertDialogTitle>
                            <AlertDialogDescription>
                                {confirmationRequest?.type === 'save-message'
                                    ? "Do you want to save this message to your memory?"
                                    : "Do you want to save the entire conversation to your memory?"}
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => setConfirmationRequest(null)}>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => {
                                if (confirmationRequest?.type === 'save-message' && confirmationRequest.message) {
                                    executeSaveMessage(confirmationRequest.message);
                                } else if (confirmationRequest?.type === 'save-conversation') {
                                    executeSaveConversation();
                                }
                            }}>
                                Save
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                {attachedFiles.length > 0 && (
                  <div className="flex justify-end mb-0.5 input-attachments-container">
                    <FileAttachmentMinimal files={attachedFiles} onRemove={removeFile} className="max-w-[50%] file-attachment-container" maxVisible={1} />
                  </div>
                )}
                <form onSubmit={onSubmit} className="relative">
                    <div className="bg-input-gray rounded-full p-2 flex items-center" ref={inputContainerRef}>
                        <div className="relative" ref={plusMenuRef}>
                            <button type="button" className={cn("p-2 text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]", (pendingActionRef.current || !isPageReady || isReconnecting) && "opacity-50 cursor-not-allowed")} onClick={handlePlusMenuClick} aria-label="More options" disabled={!!pendingActionRef.current || !isPageReady || isReconnecting}>
                              <Plus size={20} />
                            </button>
                            {showPlusMenu && (
                              <motion.div initial={{ opacity: 0, scale: 0.9, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 10 }} transition={{ duration: 0.2 }} className="absolute left-0 bottom-full mb-2 bg-input-gray rounded-full py-2 shadow-lg z-10 flex flex-col items-center plus-menu">
                                <button type="button" className="p-2 plus-menu-item text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]" onClick={attachDocument} title="Attach file">
                                  <Paperclip size={20} />
                                </button>
                                <button
                                  type="button"
                                  className={cn(
                                    "p-2 plus-menu-item",
                                    conversationSaveMarkerMessageId
                                      ? "text-[hsl(var(--save-memory-color))]"
                                      : "text-[hsl(var(--icon-secondary))]",
                                    (!agentCapabilities.pinecone_index_exists || messages.length === 0 || isLoading)
                                      ? "opacity-50 cursor-not-allowed"
                                      : !conversationSaveMarkerMessageId ? "hover:text-[hsl(var(--icon-primary))]" : ""
                                  )}
                                  onClick={handleSaveChatToMemory}
                                  title="Save chat to memory"
                                  disabled={messages.length === 0 || !agentCapabilities.pinecone_index_exists || isLoading}
                                >
                                  <Bookmark
                                    size={20}
                                    className={cn(
                                      conversationSaveMarkerMessageId && "stroke-[hsl(var(--save-memory-color))]"
                                    )}
                                  />
                                </button>
                                <button type="button" className="p-2 plus-menu-item text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]" onClick={saveChat} title="Download chat">
                                  <Download size={20} />
                                </button>
                                <button type="button" className={cn(micButtonClass, "text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]", isBrowserRecording && !isBrowserPaused && "!text-[hsl(var(--icon-destructive))]", isBrowserRecording && isBrowserPaused && "!text-yellow-500 dark:!text-yellow-400")} onClick={showAndPrepareRecordingControls} title={isDedicatedRecordingActive ? "Dedicated recording in progress" : isBrowserRecording ? (isBrowserPaused ? "Recording Paused" : "Recording Live") : "Start recording"} disabled={isDedicatedRecordingActive}>
                                  <Mic size={20} />
                                </button>
                              </motion.div>
                            )}
                        </div>
                        <div className="relative" ref={recordUIRef}>
                             {showRecordUI && isBrowserRecording && ( 
                                <motion.div initial={{ opacity: 0, scale: 0.9, y: 10 }} animate={{ opacity: recordUIVisible ? 1 : 0, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 10 }} transition={{ duration: 0.3 }} className="absolute bottom-full mb-3 bg-input-gray rounded-full py-2 px-3 shadow-lg z-10 flex items-center gap-2 record-ui" onMouseMove={handleRecordUIMouseMove} onClick={(e) => e.stopPropagation()}>
                                    <button type="button" className={cn("p-1 record-ui-button", (pendingActionRef.current === 'start' || pendingActionRef.current === 'pause_stream' || pendingActionRef.current === 'resume_stream') && "opacity-50 cursor-wait")} onClick={handlePlayPauseMicClick} disabled={!!pendingActionRef.current} aria-label={isBrowserPaused ? "Resume recording" : "Pause recording"}>
                                        {(pendingActionRef.current === 'start' || pendingActionRef.current === 'pause_stream' || pendingActionRef.current === 'resume_stream')
                                          ? <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--icon-inactive))]" />
                                          : (isBrowserPaused
                                              ? <Play size={20} className="text-yellow-500 dark:text-yellow-400" />
                                              : <Pause size={20} className="text-[hsl(var(--icon-destructive))]" />
                                            )
                                        }
                                    </button>
                                    <button type="button" className={cn("p-1 record-ui-button", pendingActionRef.current === 'stop' && "opacity-50 cursor-wait")} onClick={handleStopRecording} disabled={!!pendingActionRef.current} aria-label="Stop recording">
                                         {pendingActionRef.current === 'stop'
                                           ? <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--icon-inactive))]" />
                                           : <StopCircle size={20} className="text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]"/>
                                         }
                                    </button>
                                    <span ref={recordControlsTimerDisplayRef} className="text-sm font-medium text-[hsl(var(--text-secondary))] ml-1">{formatTime(clientRecordingTime)}</span>
                                </motion.div>
                             )}
                        </div>
                        <input
                          ref={inputRef}
                          data-testid="chat-input-field"
                          value={input}
                          onChange={handleInputChange}
                          placeholder={!isPageReady ? "Waiting for Agent/Event..." : "Ask anything"}
                          className={cn(
                            "flex-1 px-3 py-1 bg-transparent border-none outline-none placeholder:text-[var(--placeholder-text-color)] dark:placeholder:text-zink-500"
                          )}
                          disabled={!isPageReady || !!pendingAction}
                          aria-label="Chat input"
                        />
                        <button type="submit"
                            className={cn(
                                "transition-all duration-200 rounded-full flex items-center justify-center",
                                "h-9 w-9 sm:h-10 sm:w-10",
                                isPageReady && (input.trim() || attachedFiles.length > 0) && !isLoading && 
                                  "bg-[hsl(var(--button-submit-bg-active))] text-[hsl(var(--button-submit-fg-active))] hover:opacity-90",
                                isPageReady && !(input.trim() || attachedFiles.length > 0) && !isLoading &&
                                  "bg-[hsl(var(--button-submit-bg-inactive))] text-[hsl(var(--button-submit-fg-inactive))] cursor-default",
                                (!isPageReady || !!pendingActionRef.current) && "opacity-50 cursor-not-allowed"
                              )}
                            style={isLoading ? {
                                backgroundColor: 'hsl(var(--button-submit-bg-stop))',
                                color: 'hsl(var(--button-submit-fg-stop))',
                            } : {}}
                            disabled={!isPageReady || (!input.trim() && attachedFiles.length === 0 && !isLoading) || !!pendingActionRef.current}
                            aria-label={isLoading ? "Stop generating" : "Send message"} >
                            {isLoading ? <Square size={18} className="fill-current" /> : <ArrowUp size={24} /> }
                        </button>
                    </div>
                    <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} multiple accept=".txt,.md,.json,.pdf,.docx" />
                </form>
                {/* Status Bar */}
                {!isFullscreen && (
                    <div className={cn("text-center text-[hsl(var(--status-bar-text-color))] text-xs pt-4 pb-2 font-light status-bar", pendingActionRef.current && "opacity-50")}>
                        <span>Agent: {agentName || '...'}</span> · <span>Event: {eventId || '...'}</span> ·{" "}
                        <span ref={statusRecordingRef} className="cursor-pointer hover:text-[hsl(var(--text-primary))]" onClick={showAndPrepareRecordingControls} title={isBrowserRecording ? "Recording Status" : "Start recording"} >
                             Listen:{" "}
                            {isReconnecting ? (
                                <>reconnecting ({reconnectAttemptsRef.current}/{MAX_RECONNECT_ATTEMPTS}) <span className="inline-block ml-1 h-2 w-2 rounded-full bg-orange-500 animate-pulse"></span></>
                            ) : isBrowserRecording ? (
                                isBrowserPaused ? ( <>paused <span className="inline-block ml-1 h-2 w-2 rounded-full bg-yellow-500"></span></> )
                                         : ( <>live <span className="inline-block ml-1 h-2 w-2 rounded-full bg-blue-500 animate-pulse"></span></> )
                            ) : isDedicatedRecordingActive ? (
                                <>recording <span className="inline-block ml-1 h-2 w-2 rounded-full bg-red-500 animate-pulse"></span></>
                            ) : ( "no" )}
                            {isBrowserRecording && !isReconnecting && <span ref={timerDisplayRef} className="ml-1">{formatTime(clientRecordingTime)}</span>}
                        </span>
                        {" "}· <span className={cn(wsStatus === 'open' && "text-green-500", wsStatus === 'error' && "text-red-500", wsStatus === 'closed' && "text-yellow-500")}>{wsStatus}</span>
                    </div>
                )}
                {isFullscreen && (
                    <div className="pb-4"></div>
                )}
            </div>
        </div>
    )
});

export default SimpleChatInterface;
