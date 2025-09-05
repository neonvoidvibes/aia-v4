"use client"

import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle, useCallback, useMemo, ChangeEvent } from "react"
import { useChat, type Message } from "@ai-sdk/react"
import { type FetchedFile } from "@/components/FetchedFileListItem"
import {
  HEARTBEAT_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  MAX_HEARTBEAT_MISSES,
  adjusted,
  nextReconnectDelay,
} from "@/lib/wsPolicy"

// Error message type for UI-specific error handling
interface ErrorMessage {
  id: string;
  role: 'error';
  content: string;
  createdAt?: Date;
  canRetry?: boolean;
}

// Union type for all message types in the UI
type UIMessage = Message | ErrorMessage;
import {
  ArrowUp,
  ArrowDown,
  Square,
  Download,
  Paperclip,
  Play,
  Pause,
  StopCircle,
  Copy,
  Pencil,
  Volume2,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Minus,
  Loader2,
  AlertTriangle, // Added for error messages
  Upload, // Added for save to memory
  Bookmark, // Added for save individual message
  Trash2, // Added for deleting messages
  RotateCcw, // Added for retry functionality
  Waves,
  History,
  Plus,
} from "lucide-react"
import FileAttachmentMinimal, { type AttachmentFile } from "./file-attachment-minimal"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { useMobile } from "@/hooks/use-mobile"
import { useTheme } from "next-themes"
import { motion } from "framer-motion"
import { useSearchParams } from 'next/navigation';
import { ChatCache } from "@/lib/chat-cache";
import { predefinedThemes, G_DEFAULT_WELCOME_MESSAGE, type WelcomeMessageConfig } from "@/lib/themes";
import { createClient } from '@/utils/supabase/client'
import ThinkingIndicator from "@/components/ui/ThinkingIndicator"
import PressToTalkUI from "@/components/ui/press-to-talk-ui";
import TTSPlaybackUI from "@/components/ui/tts-playback-ui";
import WaveformIcon from "@/components/ui/waveform-icon";
import { cn } from "@/lib/utils"
import { toast } from "sonner" // Import toast
import { type VADAggressiveness } from "./VADSettings";
import { MODEL_GROUPS, MODEL_DISPLAY_NAMES_MAP } from "@/lib/model-map";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocalization } from "@/context/LocalizationContext";
import { ActionTooltip } from "@/components/ui/action-tooltip";
import { isRecordingPersistenceEnabled } from "@/lib/featureFlags";
import { manager as recordingManager } from "@/lib/recordingManager";

// Voice ID for ElevenLabs TTS.
const ELEVENLABS_VOICE_ID = "aSLKtNoVBZlxQEMsnGL2"; // "Sanna Hartfield"

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

    // Code blocks (line-by-line parsing to handle nesting). This must run first.
    const linesForCodeProcessing = html.split('\n');
    let inCodeBlock = false;
    let codeBlockContent = '';
    let codeBlockLang = '';
    let processedHtmlWithCodeBlocks = '';

    for (const line of linesForCodeProcessing) {
        if (line.trim().startsWith('```')) {
            if (inCodeBlock) {
                // End of code block
                inCodeBlock = false;
                const langHtml = codeBlockLang ? `<div class="code-language">${codeBlockLang}</div>` : '';
                processedHtmlWithCodeBlocks += `<pre>${langHtml}<code>${codeBlockContent.trimEnd()}</code></pre>`;
                codeBlockContent = '';
                codeBlockLang = '';
            } else {
                // Start of code block
                inCodeBlock = true;
                codeBlockLang = line.trim().substring(3);
            }
        } else if (inCodeBlock) {
            codeBlockContent += line + '\n';
        } else {
            processedHtmlWithCodeBlocks += line + '\n';
        }
    }
    // Handle unclosed code block at end of message
    if (inCodeBlock) {
        const langHtml = codeBlockLang ? `<div class="code-language">${codeBlockLang}</div>` : '';
        processedHtmlWithCodeBlocks += `<pre>${langHtml}<code>${codeBlockContent.trimEnd()}</code></pre>`;
    }
    html = processedHtmlWithCodeBlocks.trimEnd();
    
    // Block elements (processed after code blocks)
    // Headers
    html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    // Custom rule: Treat a line that is only bold as a paragraph for block-level display.
    html = html.replace(/^\s*\*\*(.*?)\*\*\s*$/gm, '<p><strong>$1</strong></p>');
    
    // Horizontal Rule
    html = html.replace(/^\s*---*\s*$/gm, '<hr />');

    // Blockquotes
    html = html.replace(/^\s*>\s(.*)/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/(<\/blockquote>\n*<a>)/g, '<br>'); // Join adjacent blockquotes

    // Checklists (must be processed before regular lists)
    // Handle checked and unchecked checkboxes
    html = html.replace(/^\s*[-*]\s*\[x\]\s+(.*(?:\n\s+.*)*)/gmi, (match, rawContent) => {
        const encoded = rawContent.replace(/"/g, '"');
        return `<temp-checklist-checked data-raw-content="${encoded}">${rawContent}</temp-checklist-checked>`;
    });
    html = html.replace(/^\s*[-*]\s*\[\s*\]\s+(.*(?:\n\s+.*)*)/gmi, (match, rawContent) => {
        const encoded = rawContent.replace(/"/g, '"');
        return `<temp-checklist-unchecked data-raw-content="${encoded}">${rawContent}</temp-checklist-unchecked>`;
    });

    // Lists (unordered and ordered)
    // This regex handles multi-line list items by looking for subsequent lines that are indented.
    // It now correctly handles one or more spaces after the list marker.
    html = html.replace(/^\s*[\*-]\s+(.*(?:\n\s+.*)*)/gm, '<temp-ul-li>$1</temp-ul-li>');
    html = html.replace(/^\s*\d+\.\s+(.*(?:\n\s+.*)*)/gm, '<temp-ol-li>$1</temp-ol-li>');

    // Wrap list items in <ul> and <ol> tags using line-by-line processing
    // to avoid greedy regex issues.
    const lines = html.split('\n');
    let processedLines = [];
    let inUl = false;
    let inOl = false;
    let inChecklist = false;

    for (const line of lines) {
        const isUl = line.includes('<temp-ul-li>');
        const isOl = line.includes('<temp-ol-li>');
        const isChecklistChecked = line.includes('<temp-checklist-checked>');
        const isChecklistUnchecked = line.includes('<temp-checklist-unchecked>');
        const isChecklist = isChecklistChecked || isChecklistUnchecked;

        // Handle Checklists
        if (isChecklist && !inChecklist) {
            if (inUl) { // Close UL if it's open
                processedLines.push('</ul>');
                inUl = false;
            }
            if (inOl) { // Close OL if it's open
                processedLines.push('</ol>');
                inOl = false;
            }
            processedLines.push('<ul class="checklist">');
            inChecklist = true;
        } else if (!isChecklist && inChecklist) {
            processedLines.push('</ul>');
            inChecklist = false;
        }

        // Handle Unordered Lists
        if (isUl && !inUl && !inChecklist) {
            if (inOl) { // Close OL if it's open
                processedLines.push('</ol>');
                inOl = false;
            }
            processedLines.push('<ul>');
            inUl = true;
        } else if (!isUl && inUl && !inChecklist) {
            processedLines.push('</ul>');
            inUl = false;
        }

        // Handle Ordered Lists
        if (isOl && !inOl && !inChecklist) {
            if (inUl) { // Close UL if it's open
                processedLines.push('</ul>');
                inUl = false;
            }
            if (inChecklist) { // Close checklist if it's open
                processedLines.push('</ul>');
                inChecklist = false;
            }
            processedLines.push('<ol>');
            inOl = true;
        } else if (!isOl && inOl && !inChecklist) {
            processedLines.push('</ol>');
            inOl = false;
        }
        
        processedLines.push(line);
    }

    // Close any remaining open lists at the end
    if (inUl) processedLines.push('</ul>');
    if (inOl) processedLines.push('</ol>');
    if (inChecklist) processedLines.push('</ul>');

    html = processedLines.join('\n');

    // Now replace the temporary tags with real <li> tags
    html = html.replace(/<temp-ul-li>/g, '<li>').replace(/<\/temp-ul-li>/g, '</li>');
    html = html.replace(/<temp-ol-li>/g, '<li>').replace(/<\/temp-ol-li>/g, '</li>');
    
    // Replace checklist temporary tags with proper checkbox HTML
    html = html.replace(/<temp-checklist-checked data-raw-content="([^"]*)">/g, '<li class="checklist-item" data-raw-content="$1"><input type="checkbox" checked class="checklist-checkbox"><span class="checklist-content">').replace(/<\/temp-checklist-checked>/g, '</span></li>');
    html = html.replace(/<temp-checklist-unchecked data-raw-content="([^"]*)">/g, '<li class="checklist-item" data-raw-content="$1"><input type="checkbox" class="checklist-checkbox"><span class="checklist-content">').replace(/<\/temp-checklist-unchecked>/g, '</span></li>');

    // Clean up adjacent list wrappers of the same type
    html = html.replace(/<\/ul>\s*<ul>/g, '');
    html = html.replace(/<\/ol>\s*<ol>/g, '');
    html = html.replace(/<\/ul>\s*<ul class="checklist">/g, '');

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

    // --- FOOTNOTES: extract trailing defs and wire refs ---
    type FootnoteId = string;
    const footnotes = new Map<FootnoteId, string>();
    
    // 1) Extract trailing footnote block, e.g.:
    // [1] Some source
    // [^2]: Another source
    {
      const lines = html.split(/\r?\n/);
      let i = lines.length - 1;
      let started = false;
      const defLines: string[] = [];
    
      while (i >= 0) {
        const raw = lines[i];
        const line = raw.trim();
    
        // Footnote def: "[1] text" or "[^1]: text"
        const isDef = /^\[\^?([^\]\s]+)\]\s*:?\s+.+$/.test(line);
        if (isDef) { defLines.unshift(line); started = true; i--; continue; }
    
        // Keep blank lines only after we started collecting the block
        if (started && line === "") { defLines.unshift(line); i--; continue; }
    
        break; // stop at the first non-blank, non-def line after collection started
      }
    
      if (defLines.length) {
        for (const l of defLines) {
          const m = l.match(/^\[\^?([^\]\s]+)\]\s*:?\s+(.+)$/);
          if (m) {
            const id = m[1].replace(/[^\w-]+/g, "");
            if (!footnotes.has(id)) footnotes.set(id, m[2]);
          }
        }
        // Drop the entire trailing block from the message
        html = lines.slice(0, i + 1).join("\n");
      }
    }
    
    // 2) Mask code so we don’t touch [1] inside <pre>/<code>
    const prePlaceholders: string[] = [];
    html = html.replace(/<pre[\s\S]*?<\/pre>/g, (m) => `__PRE_${prePlaceholders.push(m) - 1}__`);
    const codePlaceholders: string[] = [];
    html = html.replace(/<code>[\s\S]*?<\/code>/g, (m) => `__CODE_${codePlaceholders.push(m) - 1}__`);
    
    // 3) Replace inline refs like [1] or [^note] (but not links "[x](url)")
    html = html.replace(/\[\^?([^\]\s]+)\](?!\()/g, (_match, rawId) => {
      const id = String(rawId).replace(/[^\w-]+/g, "");
      const label = /^\d+$/.test(id) ? id : rawId; // show numbers as 1, non-numerics as their label
      const title = footnotes.get(id) ? ` title="${footnotes.get(id)!.replace(/"/g, "&quot;")}"` : "";
      return `<sup class="footnote-ref"><a href="#fn-${id}" id="fnref-${id}"${title}>${label}</a></sup>`;
    });
    
    // 4) Unmask code again
    html = html.replace(/__CODE_(\d+)__/g, (_m, n) => codePlaceholders[Number(n)]);
    html = html.replace(/__PRE_(\d+)__/g, (_m, n) => prePlaceholders[Number(n)]);

    // Newlines to <br>, but be careful not to add them inside list structures or other blocks
    const finalHtml = html.replace(/\n/g, '<br />')
        .replace(/(<br \/>\s*)*<((h[1-4]|p|ul|ol|li|div|pre|blockquote|hr|table))/g, '<$2') // remove all <br>s before block elements
        .replace(/(<\/(h[1-4]|p|ul|ol|li|div|pre|blockquote|hr|table)>)(\s*<br \/>)*/g, '$1'); // remove all <br>s after block elements
    
    // Build footnotes block (if any). Allow links and inline `code` inside footnotes.
    let footnotesHtml = "";
    if (footnotes.size) {
      const renderInline = (s:string) =>
        s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
         .replace(/`([^`]+)`/g, '<code>$1</code>');
    
      footnotesHtml =
        `<section class="footnotes"><ol>` +
        Array.from(footnotes.entries()).map(([id, content]) =>
          `<li id="fn-${id}">${renderInline(content)}</li>`
        ).join("") +
        `</ol></section>`;
    }
    
    debugLog(`[Markdown Format] Input: "${text.substring(0, 50)}..." | Output HTML: "${(finalHtml + footnotesHtml).substring(0, 80)}..."`);
    return finalHtml + footnotesHtml;
}

type RecordingType = 'long-form-note' | 'long-form-chat' | 'press-to-talk' | null;

type GlobalRecordingStatus = {
  isRecording: boolean;
  type: RecordingType;
};

interface SimpleChatInterfaceProps {
  onAttachmentsUpdate?: (attachments: AttachmentFile[]) => void;
  isFullscreen?: boolean;
  selectedModel: string;
  temperature: number;
  onModelChange?: (model: string) => void;
  onRecordingStateChange?: (state: {
    isBrowserRecording: boolean;
    isBrowserPaused: boolean;
    clientRecordingTime: number;
    isReconnecting: boolean;
  }, type: RecordingType) => void;
  isDedicatedRecordingActive?: boolean;
  vadAggressiveness: VADAggressiveness;
  globalRecordingStatus: GlobalRecordingStatus;
  setGlobalRecordingStatus: React.Dispatch<React.SetStateAction<GlobalRecordingStatus>>;
  transcriptListenMode: "none" | "some" | "latest" | "all";
  initialContext?: string; // For _aicreator agent
  getCanvasContext?: () => { // New prop to fetch dynamic canvas context
    current_canvas_time_window_label?: string;
    active_canvas_insights?: string; // JSON string
    pinned_canvas_insights?: string; // JSON string
  };
  onChatIdChange?: (chatId: string | null) => void; // New prop to notify parent of chat ID changes
  onHistoryRefreshNeeded?: () => void;
  isConversationSaved?: boolean;
  savedTranscriptMemoryMode?: "none" | "some" | "all";
  individualMemoryToggleStates?: Record<string, boolean>;
  savedTranscriptSummaries?: FetchedFile[];
  individualRawTranscriptToggleStates?: Record<string, boolean>;
  rawTranscriptFiles?: FetchedFile[];
  isModalOpen?: boolean; // New prop to indicate if a modal is open
  // --- PHASE 3: Workspace UI configuration ---
  isAdminOverride?: boolean;
  activeUiConfig?: any; // Supabase workspace config - controls all UI behavior
  tooltips?: Record<string, string>;
  onOpenSettings?: () => void;
}

export interface ChatInterfaceHandle {
  startNewChat: (options?: { suppressRefresh?: boolean }) => void;
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
  loadChatHistory: (chatId: string) => Promise<void>; // Load chat history from database
}

const formatTime = (seconds: number): string => {
    const safeSeconds = Math.max(0, seconds);
    const mins = Math.floor(safeSeconds / 60);
    const secs = Math.floor(safeSeconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

// Format mm:ss under 1 hour; hh:mm:ss at 1h+
const formatTimeHMS = (seconds: number): string => {
  const s = Math.max(0, seconds);
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = Math.floor(s % 60);
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
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
  function SimpleChatInterface({ onAttachmentsUpdate, isFullscreen = false, selectedModel, temperature, onModelChange, onRecordingStateChange, isDedicatedRecordingActive = false, vadAggressiveness, globalRecordingStatus, setGlobalRecordingStatus, transcriptListenMode, initialContext, getCanvasContext, onChatIdChange, onHistoryRefreshNeeded, isConversationSaved: initialIsConversationSaved, savedTranscriptMemoryMode, individualMemoryToggleStates, savedTranscriptSummaries, individualRawTranscriptToggleStates, rawTranscriptFiles, isModalOpen = false, isAdminOverride = false, activeUiConfig = {}, tooltips = {}, onOpenSettings }, ref: React.ForwardedRef<ChatInterfaceHandle>) {

    const { t } = useLocalization();

    let searchParams;
    try {
      searchParams = useSearchParams();
    } catch (error) {
      console.warn('useSearchParams failed, falling back to null', error);
      searchParams = null;
    }
    const [agentName, setAgentName] = useState<string | null>(null);
    const [eventId, setEventId] = useState<string | null>(null);
  const [isPageReady, setIsPageReady] = useState(false); 
  const lastAppendedErrorRef = useRef<string | null>(null);
  const [errorMessages, setErrorMessages] = useState<ErrorMessage[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [processedProposalIds, setProcessedProposalIds] = useState(new Set<string>());
    const [isGeneratingProposal, setIsGeneratingProposal] = useState(false);
    const [generatingProposalForMessageId, setGeneratingProposalForMessageId] = useState<string | null>(null);
    // Chat cache instance
    const chatCacheRef = useRef<ChatCache | null>(null);
    
    // State for reasoning models
    const [isThinking, setIsThinking] = useState(false);
    const [thinkingTime, setThinkingTime] = useState(0);
    const [thoughtDurations, setThoughtDurations] = useState<Record<string, number>>({});
    const thinkingTimerRef = useRef<NodeJS.Timeout | null>(null);
    const thinkingStartTimeRef = useRef<number | null>(null);
    const thinkingForMessageIdRef = useRef<string | null>(null);
    
    // State to track when user has scrolled after assistant response is complete
    const [assistantResponseComplete, setAssistantResponseComplete] = useState(false);
    const [assistantJustFinished, setAssistantJustFinished] = useState(false);

    const [agentCapabilities, setAgentCapabilities] = useState({ pinecone_index_exists: false });

    // WebSocket and Recording State
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [sessionStartTimeUTC, setSessionStartTimeUTC] = useState<string | null>(null); 
    const [wsStatus, setWsStatus] = useState<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');
    const [isBrowserRecording, setIsBrowserRecording] = useState(false); 
    const [isBrowserPaused, setIsBrowserPaused] = useState(false);    
    const [clientRecordingTime, setClientRecordingTime] = useState(0); 
    const [managerPhase, setManagerPhase] = useState<'idle'|'starting'|'active'|'suspended'|'stopping'|'error'>('idle');
    const [isReconnecting, setIsReconnecting] = useState(false);
    // Industry-standard reconnection parameters
    const MAX_RECONNECT_ATTEMPTS = 10;

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
    const prevDelayRef = useRef<number | null>(null);
    const stablePongsResetTimerRef = useRef<number | null>(null);
    const heartbeatMissesRef = useRef(0);
    const isStoppingRef = useRef(false);

    useEffect(() => {
        const agentParam = searchParams?.get('agent');
        const eventParam = searchParams?.get('event');
        debugLog(`[InitEffect] Params - Agent: ${agentParam}, Event: ${eventParam}`);
        
        const initializeAgent = async (agent: string) => {
            setAgentName(agent);
            setEventId(eventParam || null);
            
            // Fetch agent capabilities
            try {
                const permsResponse = await fetch('/api/user/permissions');
                if (permsResponse.ok) {
                    const data = await permsResponse.json();
                    const currentAgentData = data.allowedAgents.find((a: any) => a.name === agent);
                    if (currentAgentData) {
                        setAgentCapabilities(currentAgentData.capabilities);
                        debugLog(`[Agent Init] Capabilities for ${agent}:`, currentAgentData.capabilities);
                    } else {
                        setAgentCapabilities({ pinecone_index_exists: false }); // Default if agent not in list
                    }
                } else {
                     debugLog(`[Agent Init] Failed to fetch agent capabilities.`);
                     setAgentCapabilities({ pinecone_index_exists: false });
                }
            } catch (error) {
                console.error(`[Agent Init] Error fetching capabilities:`, error);
                setAgentCapabilities({ pinecone_index_exists: false });
            }

            setIsPageReady(true);
            debugLog(`[InitEffect] Page is NOW ready. Agent: ${agent}, Event: ${eventParam}`);
        };

        if (agentParam) {
            if (agentParam !== agentName) { // Only re-initialize if agent has changed
                initializeAgent(agentParam);
            }
        } else {
            debugLog("[InitEffect] Chat Interface Waiting: Agent parameter missing from URL.");
            setIsPageReady(false);
        }
    }, [searchParams, agentName]);

    // Helper function to add error messages
    const addErrorMessage = useCallback((content: string, canRetry: boolean = false) => {
        const errorMessage: ErrorMessage = {
            id: `err-${Date.now()}`,
            role: 'error',
            content,
            createdAt: new Date(),
            canRetry,
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

    const isSavingRef = useRef(false); // Add a ref to act as a lock

    // Notify parent when chat ID changes
    useEffect(() => {
        if (onChatIdChange) {
            onChatIdChange(currentChatId);
        }
        if (isRecordingPersistenceEnabled() && currentChatId) {
          try { recordingManager.setCurrentChat(currentChatId); } catch {}
        }
    }, [currentChatId, onChatIdChange]);

  const chatApiBody = useMemo(() => ({
        agent: agentName,
        event: eventId || '0000',
        // Optional tuning of cross-event signal strength via URL (?signalBias=low|medium|high)
        signalBias: (typeof window !== 'undefined' ? (new URLSearchParams(window.location.search).get('signalBias') || 'medium') : 'medium'),
        transcriptListenMode: transcriptListenMode,
        savedTranscriptMemoryMode: savedTranscriptMemoryMode,
        individualMemoryToggleStates: individualMemoryToggleStates,
        savedTranscriptSummaries: savedTranscriptSummaries,
        individualRawTranscriptToggleStates: individualRawTranscriptToggleStates,
        rawTranscriptFiles: rawTranscriptFiles,
        initialContext: initialContext,
      }), [agentName, eventId, transcriptListenMode, savedTranscriptMemoryMode, individualMemoryToggleStates, savedTranscriptSummaries, individualRawTranscriptToggleStates, rawTranscriptFiles, initialContext]);

  const {
    messages, input, handleInputChange, handleSubmit: originalHandleSubmit,
    isLoading, stop, setMessages, append, reload,
  } = useChat({ 
      api: "/api/proxy-chat",
      body: chatApiBody, 
      sendExtraMessageFields: true,
      onFinish: async (message) => {
        // Auto-save chat after each assistant response
        if (agentName) {
          console.log('[Auto-save] TRIGGER: Assistant response finished, calling saveChatHistory(with final message)');
          // Ensure the just-finished assistant message is included even if state lags
          const current = messages;
          const hasFinal = current.some(m => m.id === message.id);
          const merged = hasFinal ? current : [...current, message];
          await saveChatHistory(merged as any);
        }
        // Persist latest messages to cache after assistant finishes
        try {
          if (currentChatId) {
            if (!chatCacheRef.current) chatCacheRef.current = new ChatCache();
            await chatCacheRef.current.init(currentChatId);
            const filtered = messages.filter((m) => m.role !== 'system');
            await chatCacheRef.current.upsertMessages(currentChatId, filtered as any, { source: 'local' });
          }
        } catch (e) {
          console.warn('[Cache] upsert after onFinish failed', e);
        }
      },
      onError: (error) => { 
        console.error("[ChatUI] useChat onError:", error);
        let rawErrorMessage = error.message || "An error occurred.";
        
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
        
        const lastUserMessage = messages.filter(m => m.role === 'user').pop();
        const canRetry = !!lastUserMessage;
        
        addErrorMessage(displayMessage, canRetry);
      },
    });

    // This effect is responsible for detecting and handling document update proposals from the agent.
    useEffect(() => {
        const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
        if (!lastMessage) return;
    
        const proposalPrefix = "[DOC_UPDATE_PROPOSAL]";
    
        // Phase 1: Detect proposal start during the stream to show the "working" indicator.
        if (isLoading && lastMessage.role === 'assistant' && !isGeneratingProposal) {
            if (lastMessage.content.includes(proposalPrefix)) {
                debugLog("[Doc Update] Proposal detected during stream for message:", lastMessage.id);
                setIsGeneratingProposal(true);
                setGeneratingProposalForMessageId(lastMessage.id);
                // The render logic will now handle hiding the raw payload in real-time.
            }
        }
    
        // Phase 2: Process the completed proposal after the stream finishes.
        if (!isLoading && lastMessage.role === 'assistant' && !processedProposalIds.has(lastMessage.id)) {
            const content = lastMessage.content;
            const proposalIndex = content.indexOf(proposalPrefix);
    
            if (proposalIndex !== -1) {
                // End the "generating proposal" UI state
                setIsGeneratingProposal(false);
                setGeneratingProposalForMessageId(null);
    
                try {
                    const conversationalText = content.substring(0, proposalIndex).trim();
                    const jsonString = content.substring(proposalIndex + proposalPrefix.length);
                    const proposal = JSON.parse(jsonString);
    
                    if (proposal.doc_name && typeof proposal.content === 'string') {
                        debugLog("[Doc Update] Post-stream: Valid proposal detected, cleaning UI and showing modal:", proposal);
    
                        // Permanently clean the message in the UI state now that the stream is complete
                        setMessages(prevMessages => {
                            const newMessages = [...prevMessages];
                            const targetMessage = newMessages.find(m => m.id === lastMessage.id);
                            if (targetMessage) {
                                targetMessage.content = conversationalText;
                            }
                            return newMessages;
                        });
    
                        // Mark as processed and trigger the modal
                        setProcessedProposalIds(prev => new Set(prev).add(lastMessage.id));
                        setDocUpdateRequest({
                            doc_name: proposal.doc_name,
                            content: proposal.content,
                            justification: proposal.justification || "The agent has proposed an update to its memory.",
                        });
                    }
                } catch (e) {
                    console.error("Failed to parse document update proposal post-stream:", e);
                    addErrorMessage("The agent proposed a memory update, but the format was invalid.");
                    setProcessedProposalIds(prev => new Set(prev).add(lastMessage.id));
                }
            }
        }
    }, [messages, isLoading, processedProposalIds, isGeneratingProposal, setMessages, addErrorMessage]);

    useEffect(() => {
        if (agentName && isPageReady) {
            console.info(`[ChatInterface] Ready for agent: ${agentName}, event: ${eventId || 'N/A'}`);
        }
    }, [agentName, eventId, isPageReady]);

    // Initialize chat cache once on mount; keep currently opened chat hot
    useEffect(() => {
        if (!chatCacheRef.current) chatCacheRef.current = new ChatCache();
        chatCacheRef.current.init(currentChatId || undefined).catch(() => {});
        // no deps: run once
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Start thinking timer when loading begins for reasoning models
    useEffect(() => {
        if ((selectedModel === 'gemini-2.5-pro' || selectedModel === 'gpt-5' || selectedModel === 'gpt-5-mini') && isLoading && !isThinking) {
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
        if ((selectedModel === 'gemini-2.5-pro' || selectedModel === 'gpt-5' || selectedModel === 'gpt-5-mini') && !isLoading && thinkingTimerRef.current) {
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

    // Track when assistant response just finished (but don't immediately reduce padding)
    useEffect(() => {
        const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
        const isAssistantResponseFinished = !isLoading && !isThinking && lastMessage?.role === 'assistant';
        
        if (isAssistantResponseFinished && !assistantJustFinished) {
            // Assistant response just completed, set flag to track this state
            setAssistantJustFinished(true);
        } else if ((isLoading || isThinking) && assistantJustFinished) {
            // New assistant activity started, reset all flags
            setAssistantJustFinished(false);
            setAssistantResponseComplete(false);
        }
    }, [isLoading, isThinking, messages, assistantJustFinished]);


    const supabase = createClient();

    // Auto-save chat history function - saves complete conversation
    const saveChatHistory = useCallback(async (messagesToSave?: Message[]) => {
        const startTime = Date.now();
        
        if (isSavingRef.current) {
            console.warn('[Auto-save] Save already in progress. Skipping.');
            return;
        }
        // Prefer the longest known set to avoid saving partial lists
        let currentMessages = messagesToSave && messagesToSave.length >= (messagesRef.current?.length || 0)
          ? messagesToSave
          : messagesRef.current;
        if (!agentName || currentMessages.length === 0) {
            console.log('[Auto-save] Skipping save - no agent or messages');
            return;
        }

        // Capture the current chat ID at the start of the save operation to prevent race conditions
        const chatIdAtStartOfSave = currentChatId;

        const isCreating = !chatIdAtStartOfSave;
        if (isCreating) {
            if (creatingRef.current) {
                console.warn('[Auto-save] Create already in progress. Skipping.');
                return;
            }
            if (!clientSessionIdRef.current) {
                clientSessionIdRef.current = crypto.randomUUID();
            }
            creatingRef.current = true;
        }
        
        isSavingRef.current = true;

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) {
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
                    messages: currentMessages,
                    chatId: chatIdAtStartOfSave,
                    title: chatTitle,
                    event: eventId || '0000',
                    clientSessionId: clientSessionIdRef.current,
                }),
            });

            if (response.ok) {
                const result = await response.json();
                
                if (result.success) {
                    // CRITICAL FIX: Always update state if we created a new chat, regardless of timing
                    // This prevents race conditions where the second save starts before state updates
                    if (!chatIdAtStartOfSave && result.chatId) {
                        setCurrentChatId(result.chatId);
                        setChatTitle(result.title);
                        // Also persist current messages to cache under the new chatId
                        try {
                            if (!chatCacheRef.current) chatCacheRef.current = new ChatCache();
                            await chatCacheRef.current.init(result.chatId);
                            const filtered = currentMessages.filter((m) => m.role !== 'system');
                            await chatCacheRef.current.upsertMessages(result.chatId, filtered as any, { source: 'local' });
                        } catch (e) {
                            console.warn('[Cache] upsert after creating chatId failed', e);
                        }
                    }
                    // After any successful save, trigger a refresh of the history list
                    if (onHistoryRefreshNeeded) {
                        onHistoryRefreshNeeded();
                    }
                }
            }
        } catch (error) {
            console.error('[Auto-save] Save operation failed:', error);
        } finally {
            if (typeof isCreating !== 'undefined' && isCreating) creatingRef.current = false;
            isSavingRef.current = false;
        }
    }, [agentName, currentChatId, chatTitle, supabase.auth, onHistoryRefreshNeeded]);

    const messagesRef = useRef<Message[]>(messages);
    useEffect(() => { messagesRef.current = messages; }, [messages]);

    // Debounced cache persistence for local changes (edits, deletes, sends)
    const cacheDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (!currentChatId) return;
        // Avoid excessive writes during streaming; debounce lightly
        if (cacheDebounceRef.current) clearTimeout(cacheDebounceRef.current);
        cacheDebounceRef.current = setTimeout(async () => {
            try {
                if (!chatCacheRef.current) chatCacheRef.current = new ChatCache();
                await chatCacheRef.current.init(currentChatId);
                const filtered = messagesRef.current.filter((m) => m.role !== 'system');
                await chatCacheRef.current.upsertMessages(currentChatId, filtered as any, { source: 'local' });
            } catch (e) {
                console.warn('[Cache] debounced upsert failed', e);
            }
        }, isLoading ? 300 : 120);

        return () => {
            if (cacheDebounceRef.current) {
                clearTimeout(cacheDebounceRef.current);
                cacheDebounceRef.current = null;
            }
        };
    }, [messages, currentChatId, isLoading]);

    
    const recordUIRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const statusRecordingRef = useRef<HTMLSpanElement>(null); 
    const inputContainerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const userHasScrolledRef = useRef(false);
    const lastUserMessageCountRef = useRef(0);
    
    // Initialize the user message count
    useEffect(() => {
        lastUserMessageCountRef.current = messages.filter(m => m.role === 'user').length;
    }, []); // Only run once on mount
    const prevScrollTopRef = useRef<number>(0);
    const filesForNextMessageRef = useRef<AttachmentFile[]>([]);
    const timerDisplayRef = useRef<HTMLSpanElement>(null); 
    const recordControlsTimerDisplayRef = useRef<HTMLSpanElement>(null); 
    // Pause accounting for persistence-driven recording timer
    const pausedAccumMsRef = useRef(0);
    const pausedStartRef = useRef<number | null>(null);
    const prevPausedRef = useRef(false);
    const pendingActionRef = useRef<string | null>(null); 
    const clientSessionIdRef = useRef<string | null>(null);
    // Guard concurrent chat loads to prevent race conditions/merges
    const loadRequestIdRef = useRef<string | null>(null);
    const creatingRef = useRef(false);

    // NOTE: The 'Simple' view is the standard/default view for the application.
    // All primary UI elements, including the recording timer, are handled in the parent `page.tsx` component.
    // This component manages the chat and recording state logic.
    const [showRecordUI, setShowRecordUI] = useState(false); 
    const [recordUIVisible, setRecordUIVisible] = useState(true); 
    const [attachedFiles, setAttachedFiles] = useState<AttachmentFile[]>([]);
    const [allAttachments, setAllAttachments] = useState<AttachmentFile[]>([]);
    const [hoveredMessage, setHoveredMessage] = useState<string | null>(null);
    const [selectedMessage, setSelectedMessage] = useState<string | null>(null);
    const [messageToDelete, setMessageToDelete] = useState<UIMessage | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [collapsedMessages, setCollapsedMessages] = useState<Set<string>>(new Set());
  const [confirmationRequest, setConfirmationRequest] = useState<{ type: 'save-message' | 'save-conversation' | 'forget-message' | 'forget-conversation' | 'overwrite-conversation'; message?: Message; memoryId?: string; } | null>(null);
  const [docUpdateRequest, setDocUpdateRequest] = useState<{ doc_name: string; content: string; justification?: string; } | null>(null);
    const [isUpdatingDoc, setIsUpdatingDoc] = useState(false);
    const isMobile = useMobile();
    const [copyState, setCopyState] = useState<{ id: string; copied: boolean }>({ id: "", copied: false });
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
    const { theme } = useTheme();
    const [savedMessageIds, setSavedMessageIds] = useState<Map<string, { savedAt: Date; memoryId: string; }>>(new Map());
    const [conversationSaveMarkerMessageId, setConversationSaveMarkerMessageId] = useState<string | null>(null);
    const [conversationMemoryId, setConversationMemoryId] = useState<string | null>(null);
    const [pendingAction, setPendingAction] = useState<string | null>(null);
    useEffect(() => { pendingActionRef.current = pendingAction; }, [pendingAction]);

    const isMemoryActive = useMemo(() => {
      if (savedTranscriptMemoryMode === 'all') return true;
      if (savedTranscriptMemoryMode === 'some' && individualMemoryToggleStates && Object.values(individualMemoryToggleStates).some(v => v)) return true;
      
      if (transcriptListenMode === 'all' || transcriptListenMode === 'latest') return true;
      if (transcriptListenMode === 'some' && individualRawTranscriptToggleStates && Object.values(individualRawTranscriptToggleStates).some(v => v)) return true;
  
      return false;
    }, [savedTranscriptMemoryMode, individualMemoryToggleStates, transcriptListenMode, individualRawTranscriptToggleStates]);

    // Derive listening mode and optional +N based on Settings > Memory selections
    const listeningInfo = useMemo(() => {
      // Counts derived from settings
      let rawCount = 0;
      let memCount = 0;

      // Raw transcripts
      if (transcriptListenMode === 'latest') {
        rawCount = 1;
      } else if (transcriptListenMode === 'some') {
        if (individualRawTranscriptToggleStates) {
          try { rawCount = Object.values(individualRawTranscriptToggleStates).filter(Boolean).length; } catch {}
        }
      } else if (transcriptListenMode === 'all') {
        rawCount = Math.max(0, (rawTranscriptFiles?.length || 0));
      }

      // Memorized transcripts (summarized)
      if (savedTranscriptMemoryMode === 'some') {
        if (individualMemoryToggleStates) {
          try { memCount = Object.values(individualMemoryToggleStates).filter(Boolean).length; } catch {}
        }
      } else if (savedTranscriptMemoryMode === 'all') {
        memCount = Math.max(0, (savedTranscriptSummaries?.length || 0));
      }

      const total = rawCount + memCount;
      const mode = total === 0 ? 'none' : total === 1 ? 'single' : 'many';
      // additional only meaningful during active listening (i.e., total - current live)
      const additional = total > 0 ? Math.max(0, total - 1) : 0;
      
      return { mode: mode as 'none'|'single'|'many', total, additional, rawCount, memCount };
    }, [transcriptListenMode, individualRawTranscriptToggleStates, rawTranscriptFiles, savedTranscriptMemoryMode, individualMemoryToggleStates, savedTranscriptSummaries]);

    const [ttsPlayback, setTtsPlayback] = useState<{
      isPlaying: boolean;
      messageId: string | null;
      audio: HTMLAudioElement | null;
      audioUrl: string | null;
    }>({ isPlaying: false, messageId: null, audio: null, audioUrl: null });
    const [ttsPlaybackTime, setTtsPlaybackTime] = useState(0);
    const ttsTimerRef = useRef<NodeJS.Timeout | null>(null);
    const [isTtsLoading, setIsTtsLoading] = useState(false);

    useEffect(() => {
      if (ttsPlayback.isPlaying && ttsPlayback.audio) {
        setTtsPlaybackTime(0);
        ttsTimerRef.current = setInterval(() => {
          setTtsPlaybackTime(prevTime => prevTime + 1);
        }, 1000);
      } else {
        if (ttsTimerRef.current) {
          clearInterval(ttsTimerRef.current);
          ttsTimerRef.current = null;
        }
      }
      return () => {
        if (ttsTimerRef.current) {
          clearInterval(ttsTimerRef.current);
        }
      };
    }, [ttsPlayback.isPlaying, ttsPlayback.audio]);

    // New state for the "Press to Talk" feature
    const [pressToTalkState, setPressToTalkState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
    const [pressToTalkTime, setPressToTalkTime] = useState(0);
    const audioChunksRef = useRef<Blob[]>([]);
    const pressToTalkMediaRecorderRef = useRef<MediaRecorder | null>(null);
    const pressToTalkTimerRef = useRef<NodeJS.Timeout | null>(null);
    const pressToTalkStreamRef = useRef<MediaStream | null>(null);
    const transcriptionRequestIdRef = useRef<string | null>(null);

    const _transcribeAndSend = async (audioBlob: Blob) => {
      // Generate unique request ID to prevent duplicate processing
      const requestId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9);
      transcriptionRequestIdRef.current = requestId;

      const formData = new FormData();
      formData.append('audio_file', audioBlob, 'voice_message.webm');
      if (agentName) {
        formData.append('agent_name', agentName);
      }

      try {
        const response = await fetch('/api/transcribe-audio', {
          method: 'POST',
          body: formData,
        });

        // Check if this request is still the current one (prevents race conditions)
        if (transcriptionRequestIdRef.current !== requestId) {
          console.log('Ignoring outdated transcription request');
          return;
        }

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Transcription failed');
        }

        const result = await response.json();
        let transcribedText = result.transcript;

        if (transcribedText) {
          const parts = transcribedText.split('\n\n');
          let content = parts.length > 1 ? parts.slice(1).join('\n\n') : transcribedText;
          
          // Remove the prepended mic emoji if it exists and trim whitespace.
          content = content.replace(/^🎙️\s*/, '').trim();

          try {
            const canvasContextData = getCanvasContext ? getCanvasContext() : {};
            const augmentedBody = {
                agent: agentName,
                event: eventId || '0000',
                model: selectedModel,
                temperature: temperature,
                ...canvasContextData,
                transcriptListenMode: transcriptListenMode,
                savedTranscriptMemoryMode: localStorage.getItem(`savedTranscriptMemoryModeSetting_${agentName}`) || "disabled",
                transcriptionLanguage: localStorage.getItem(`transcriptionLanguageSetting_${agentName}`) || "any",
                ...(initialContext && { initialContext }),
            };

            append({
              role: 'user',
              content: content,
            }, { data: augmentedBody });
          } catch (appendError) {
            console.error("Error sending transcribed message:", appendError);
            toast.error("Failed to send message");
          }
        } else {
          // Only show error if transcription actually failed (empty result)
          toast.error("No speech detected in the recording");
        }
      } catch (error) {
        // Only show error if this is still the current request
        if (transcriptionRequestIdRef.current === requestId) {
          console.error("Transcription error:", error);
          toast.error((error as Error).message);
        }
      } finally {
        // Only update state if this is still the current request
        if (transcriptionRequestIdRef.current === requestId) {
          setPressToTalkState('idle');
          setGlobalRecordingStatus({ isRecording: false, type: null });
          transcriptionRequestIdRef.current = null;
        }
      }
    };

    const handleStartPressToTalk = async () => {
      if (globalRecordingStatus.isRecording) {
        toast.error("Another recording is already in progress.");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        pressToTalkStreamRef.current = stream;
        setGlobalRecordingStatus({ isRecording: true, type: 'press-to-talk' });
        setPressToTalkState('recording');

        const mediaRecorder = new MediaRecorder(stream);
        pressToTalkMediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = () => {
          setPressToTalkState('transcribing');
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          _transcribeAndSend(audioBlob);
          
          // Clean up stream and recorder instance (check if stream still exists)
          if (pressToTalkStreamRef.current) {
            pressToTalkStreamRef.current.getTracks().forEach((track: MediaStreamTrack) => {
              if (track.readyState !== 'ended') {
                track.stop();
              }
            });
            pressToTalkStreamRef.current = null;
          }
          pressToTalkMediaRecorderRef.current = null;
        };

        mediaRecorder.start();
        pressToTalkTimerRef.current = setInterval(() => {
          setPressToTalkTime(prev => prev + 1);
        }, 1000);

      } catch (error) {
        console.error("Microphone access error:", error);
        toast.error("Could not access microphone. Please check permissions.");
      }
    };

    const handleSubmitPressToTalk = () => {
      // Prevent duplicate submissions
      if (pressToTalkState === 'transcribing') {
        return;
      }

      // Reset timer immediately when submit is pressed
      if (pressToTalkTimerRef.current) {
        clearInterval(pressToTalkTimerRef.current);
        pressToTalkTimerRef.current = null;
      }
      setPressToTalkTime(0);
      
      // IMMEDIATELY stop audio stream tracks to prevent background recording
      if (pressToTalkStreamRef.current) {
        pressToTalkStreamRef.current.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      }
      
      if (pressToTalkMediaRecorderRef.current && pressToTalkMediaRecorderRef.current.state === 'recording') {
        pressToTalkMediaRecorderRef.current.stop(); // This will trigger the onstop handler for cleanup
      }
    };

    const handleCancelPressToTalk = () => {
      // Cancel any pending transcription request
      transcriptionRequestIdRef.current = null;
      
      if (pressToTalkMediaRecorderRef.current && pressToTalkMediaRecorderRef.current.state === 'recording') {
        pressToTalkMediaRecorderRef.current.onstop = null; // Detach onstop to prevent transcription
        pressToTalkMediaRecorderRef.current.stop();
        
        // Explicitly clean up resources on cancel
        pressToTalkStreamRef.current?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        pressToTalkStreamRef.current = null;
        pressToTalkMediaRecorderRef.current = null;
      }
      if (pressToTalkTimerRef.current) {
        clearInterval(pressToTalkTimerRef.current);
      }
      setPressToTalkTime(0);
      setPressToTalkState('idle');
      setGlobalRecordingStatus({ isRecording: false, type: null });
    };

    const executeDocUpdate = useCallback(async () => {
        if (!docUpdateRequest || !agentName) return;
    
        debugLog("[Doc Update] Executing update for:", docUpdateRequest.doc_name);
        setIsUpdatingDoc(true);
        setDocUpdateRequest(null);
    
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) throw new Error("Authentication required.");
    
            const response = await fetch('/api/agent/docs/update', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    agent: agentName,
                    doc_name: docUpdateRequest.doc_name,
                    content: docUpdateRequest.content,
                }),
            });
    
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || "Failed to update document.");
            }
            
            debugLog("[Doc Update] API call successful. Adding final confirmation message to UI.");
            // Directly add the agent's final confirmation message to the messages state
            const confirmationMessage = {
                id: `asst-${Date.now()}`,
                role: 'assistant' as const,
                content: `Done. Memory updated in \`${docUpdateRequest.doc_name}\`.`,
                createdAt: new Date(),
            };
            
            // Add the confirmation message directly to the messages state
            setMessages(prev => [...prev, confirmationMessage]);
            
            // Trigger auto-save manually for the updated messages
            setTimeout(() => {
                saveChatHistory();
            }, 100);
    
        } catch (error: any) {
            debugLog("[Doc Update] Error during execution:", error);
            addErrorMessage(`Failed to update document: ${error.message}`);
        } finally {
            debugLog("[Doc Update] Finalizing update process.");
            setIsUpdatingDoc(false);
        }
    }, [docUpdateRequest, agentName, supabase.auth, append, addErrorMessage]);

    const currentWelcomeMessageConfig = useMemo(() => {
      const activeThemeObject = predefinedThemes.find(t => t.className === theme);
      if (activeThemeObject?.welcomeMessage) {
        // Return the theme's config, falling back to default for any missing properties
        return {
          ...G_DEFAULT_WELCOME_MESSAGE, // Start with default
          ...activeThemeObject.welcomeMessage, // Override with theme specifics
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
        if (isRecordingPersistenceEnabled()) {
            // Manager-driven timer handles updates when persistence is enabled
            if (localRecordingTimerRef.current) clearInterval(localRecordingTimerRef.current);
            return () => { if (localRecordingTimerRef.current) clearInterval(localRecordingTimerRef.current); };
        }
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
            }, 'long-form-chat');
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
            // Flag that we just submitted a user message - the count will be updated by the useEffect
            userHasScrolledRef.current = false;
            setShowScrollToBottom(false);
            lastAppendedErrorRef.current = null;
            // Reset all assistant response tracking flags when new message is submitted
            setAssistantResponseComplete(false);
            setAssistantJustFinished(false);
            
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
                transcriptListenMode: transcriptListenMode,
                savedTranscriptMemoryMode: savedTranscriptMemoryMode || "disabled",
                transcriptionLanguage: localStorage.getItem(`transcriptionLanguageSetting_${agentName}`) || "any",
                ...(initialContext && { initialContext }),
            };
            
            debugLog("[handleSubmitWithCanvasContext] Final body for API:", augmentedBody);
            
            // Clear system messages immediately upon new user submit
            setMessages(prevMessages => prevMessages.filter(msg => msg.role !== "system"));
            
            originalHandleSubmit(e as React.FormEvent<HTMLFormElement>, { data: augmentedBody });
            
            // Reset textarea height after submission
            if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
                textareaRef.current.style.overflowY = 'hidden';
            }

            // Auto-save after user message is sent - increased delay to reduce race conditions
            setTimeout(() => {
                console.log('[Auto-save] TRIGGER: User message timeout (250ms), calling saveChatHistory()');
                saveChatHistory();
            }, 250);
        }
    }, [
        input, 
        messages, // Add messages to dependency array
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
        saveChatHistory,
        transcriptListenMode
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
        if (isRecordingPersistenceEnabled()) {
            try { await recordingManager.stop(); } catch {}
            return;
        }
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
            (newWs as any).__intentionalClose = false;
      
            newWs.onopen = () => {
              // Assign to the global ref ONLY when the connection is officially open.
              // This prevents race conditions where other parts of the app might try to use
              // the ref while the socket is still in the "CONNECTING" state, and it ensures
              // the old socket (if any) remains the "current" one until this new one is ready.
              wsRef.current = newWs;
      
              if (wsRef.current !== newWs) {
                    console.warn(`[WebSocket] Stale onopen event for ${newWs.url}. Ignoring.`);
                    try { newWs.close(); } catch(e){ console.warn("[WebSocket] Error closing stale newWs onopen:", e);}
                    return;
                }
                console.info(`[WebSocket] Connection opened for session ${currentSessionId}. Reconnecting: ${isReconnectingRef.current}`);
                setWsStatus('open');
                
                // reset backoff on a clean open
                reconnectAttemptsRef.current = 0;
                prevDelayRef.current = null;
                // reset "stable pongs" timer
                if (stablePongsResetTimerRef.current) {
                  clearTimeout(stablePongsResetTimerRef.current);
                  stablePongsResetTimerRef.current = null;
                }
                
                if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
                if (pongTimeoutRef.current) clearTimeout(pongTimeoutRef.current);
                heartbeatMissesRef.current = 0; 
                
                heartbeatIntervalRef.current = setInterval(() => {
                    if (newWs.readyState === WebSocket.OPEN && !isStoppingRef.current) {
                        // Do NOT client-close while recording; let the server own the cutoff.
                        if (!isBrowserRecordingRef.current && heartbeatMissesRef.current >= MAX_HEARTBEAT_MISSES) {
                            console.warn("[Heartbeat] Already at max misses (not recording), closing connection to trigger reconnect.");
                            newWs.close(1000, "Heartbeat timeout after multiple attempts");
                            return;
                        }
                        
                        debugLog(`[Heartbeat] Sending ping (miss count: ${heartbeatMissesRef.current})`);
                        newWs.send(JSON.stringify({action: 'ping'}));
                        
                        if (pongTimeoutRef.current) clearTimeout(pongTimeoutRef.current);
                        pongTimeoutRef.current = setTimeout(() => {
                            heartbeatMissesRef.current++;
                            console.warn(`[Heartbeat] Pong not received in time (miss ${heartbeatMissesRef.current}/${MAX_HEARTBEAT_MISSES})`);
                            
                            // Do NOT client-close while recording; let the server own the cutoff.
                            if (!isBrowserRecordingRef.current && heartbeatMissesRef.current >= MAX_HEARTBEAT_MISSES) {
                                console.error("[Heartbeat] Max heartbeat misses reached (not recording). Closing connection to trigger reconnect.");
                                newWs.close(1000, "Heartbeat timeout");
                            }
                        }, adjusted(PONG_TIMEOUT_MS));

                    } else if (newWs.readyState !== WebSocket.OPEN && heartbeatIntervalRef.current) {
                        clearInterval(heartbeatIntervalRef.current);
                    }
                }, adjusted(HEARTBEAT_INTERVAL_MS));
                
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
                            
                            // after 30s of stable pongs, zero the backoff attempts
                            if (!stablePongsResetTimerRef.current) {
                              const t = window.setTimeout(() => {
                                reconnectAttemptsRef.current = 0;
                                prevDelayRef.current = null;
                                stablePongsResetTimerRef.current = null;
                              }, 30000);
                              stablePongsResetTimerRef.current = t;
                            }

                            if (isReconnectingRef.current) {
                                console.info("[WebSocket onmessage] First pong after reconnect received. Finalizing reconnect state.");
                                setIsReconnecting(false); 
                                reconnectAttemptsRef.current = 0; 
                                // Use toast only, no chat system message
                                toast.success("Connection re-established and stable.");
                            }
                        } else if (messageData.type === 'ping') {
                            // reply to server keepalive
                            newWs.send(JSON.stringify({ type: 'pong' }));
                            return;
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
                // If the server intentionally rejected the connection because one already exists,
                // do not attempt to reconnect. This breaks the reconnection storm loop.
                // 1008 = policy violation (duplicate connection) → do not reconnect
                if (event.code === 1008) {
                    console.warn(`[WebSocket] Close received with code 1008 (Policy Violation - likely duplicate connection). Aborting reconnect.`);
                    toast.warning("Another recording tab for this session may be active.");
                    setWsStatus('closed');
                    if (wsRef.current === newWs) {
                      wsRef.current = null;
                    }
                    setIsReconnecting(false);
                    reconnectAttemptsRef.current = 0;
                    prevDelayRef.current = null;
                    if (pendingActionRef.current === 'start') setPendingAction(null);
                    return;
                }
                // 1005/1006 = abnormal/no close; treat as transient, avoid long waits
                if (event.code === 1005 || event.code === 1006) {
                  prevDelayRef.current = 1000; // bias nextReconnectDelay to ~1s
                }

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
            toast.error('Failed to reconnect recording after multiple attempts. Please stop and start manually.');
            resetRecordingStates();
            return;
        }
    
        reconnectAttemptsRef.current++;
        const nextAttempt = reconnectAttemptsRef.current;
        
        // Use toast only, no chat system message
        toast.warning(`Connection lost. Recording paused. Attempting to reconnect (${nextAttempt}/${MAX_RECONNECT_ATTEMPTS})...`);
        
        const prevDelay = prevDelayRef.current;
        const delay = nextReconnectDelay(
          prevDelay,
          { isRecording: isBrowserRecordingRef.current === true }
        );
        prevDelayRef.current = delay;
        
        console.log(
          `[Reconnect] Scheduling attempt ${nextAttempt} in ${Math.round(delay)}ms` +
          (prevDelay ? ` (prev: ${Math.round(prevDelay)}ms)` : "") +
          `, recording: ${isBrowserRecordingRef.current === true}`
        );
    
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
                toast.error('Cannot reconnect: session information was lost. Please stop and start recording again.');
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
        if (pendingActionRef.current || globalRecordingStatus.isRecording) {
            if (globalRecordingStatus.isRecording) {
                toast.error("Another recording is already in progress.");
            }
            console.warn(`[Start Recording Session] Manual start: Pre-condition not met.`);
            return;
        }
        setPendingAction('start');
        resetRecordingStates(); // This is only for brand new sessions now
        debugLog("[Start Recording Session] Called resetRecordingStates for new session.");
        
        const currentAgent = searchParams?.get('agent');
        const currentEvent = searchParams?.get('event') || '0000';
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
                setSessionId(result.data.session_id);
                setSessionStartTimeUTC(result.data.session_start_time_utc);
                setGlobalRecordingStatus({ type: 'long-form-chat', isRecording: true });
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
        debugLog(`[Recording Controls UI] Show/Prepare. Pending: ${pendingActionRef.current}, GlobalRec: ${globalRecordingStatus.isRecording}`);
        if (pendingActionRef.current) return;
        if (isRecordingPersistenceEnabled()) {
          const st = recordingManager.getState();
          const active = st.sessionId && (st.phase === 'starting' || st.phase === 'active' || st.phase === 'suspended');
          if (!active) {
            if (!agentName) { addErrorMessage('Agent information is missing. Cannot start recording.'); return; }
            try {
              recordingManager.start({ type: 'chat', chatId: currentChatId || undefined, agentName: agentName || undefined, eventId });
            } catch (e:any) {
              addErrorMessage(`Error: ${e?.message || 'Failed to start recording'}`);
            }
          }
          return; // No extra UI per spec
        }
        if (globalRecordingStatus.isRecording && globalRecordingStatus.type === 'long-form-chat') {
             setShowRecordUI(true);
             setRecordUIVisible(true);
             if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
             startHideTimeout();
        } else {
            handleStartRecordingSession();
        }
    }, [handleStartRecordingSession, startHideTimeout, globalRecordingStatus]);


     useImperativeHandle(ref, () => ({
        startNewChat: async (options) => {
             console.info("[New Chat] Imperative handle called.");
             if (!isRecordingPersistenceEnabled() && (isBrowserRecordingRef.current || sessionId)) {
                console.info("[New Chat] Active recording detected, stopping it first.");
                await handleStopRecording(undefined, false); 
             }
             
             // Wait for any pending save operations to complete before resetting state
             console.info("[New Chat] Waiting for any pending save operations to complete...");
             while (isSavingRef.current) {
                await new Promise(resolve => setTimeout(resolve, 50));
             }
             console.info("[New Chat] All save operations completed. Proceeding with reset.");
             
             console.log("[New Chat] BEFORE STATE RESET:", {
                messagesCount: messages.length,
                errorMessagesCount: errorMessages.length,
                attachedFilesCount: attachedFiles.length,
                currentChatId: currentChatId,
                chatTitle: chatTitle,
                timestamp: new Date().toISOString()
             });
             
             setMessages([]);
             setErrorMessages([]); // Clear error messages
             lastAppendedErrorRef.current = null; // Reset last error ref
             setAttachedFiles([]); 
             setAllAttachments([]); 
             filesForNextMessageRef.current = [];
             
             // Reset chat ID and title for new chat - CRITICAL STATE RESET
             console.log("[New Chat] RESETTING CHAT STATE: currentChatId from", currentChatId, "to null");
             setCurrentChatId(null);
             setChatTitle(null);
             clientSessionIdRef.current = null;
             setConversationSaveMarkerMessageId(null);
             setConversationMemoryId(null);
             setProcessedProposalIds(new Set()); // Reset processed proposals
             
             if (onHistoryRefreshNeeded && agentName && !options?.suppressRefresh) { // Only refresh if an agent is active
                console.log("[New Chat] Calling onHistoryRefreshNeeded()");
                onHistoryRefreshNeeded();
             }
             console.info("[New Chat] COMPLETED STATE RESET - All client states (messages, errors, attachments, chat ID, memory) have been reset.");
             console.log("[New Chat] AFTER STATE RESET:", {
                messagesCount: 0, // Should be 0
                currentChatId: null, // Should be null
                chatTitle: null, // Should be null
                timestamp: new Date().toISOString()
             });
          },
         getMessagesCount: () => messages.length,
         scrollToTop: () => { 
           messagesContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); 
           userHasScrolledRef.current = true; 
           setShowScrollToBottom(false); 
           setAssistantResponseComplete(true); 
         },
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
         loadChatHistory: async (chatId: string) => {
            console.info("[Load Chat History] STARTING load for chat:", chatId);
            console.log("[Load Chat History] BEFORE LOAD STATE:", {
                currentChatId: currentChatId,
                currentChatTitle: chatTitle,
                currentMessageCount: messages.length,
                timestamp: new Date().toISOString()
            });
            try {
              // Ensure cache exists and mark this chat as current/hot
              if (!chatCacheRef.current) chatCacheRef.current = new ChatCache();
              await chatCacheRef.current.init(chatId);

              // Set target chat ID immediately to avoid cross-saves to previous chat
              setCurrentChatId(chatId);

              // Begin a guarded load to prevent interleaving states when switching fast
              const thisLoadId = crypto.randomUUID();
              loadRequestIdRef.current = thisLoadId;

              // Clear per-chat state early to avoid merging visuals from previous chat
              setAttachedFiles([]);
              setAllAttachments([]);
              filesForNextMessageRef.current = [];
              setSavedMessageIds(new Map());
              setConversationSaveMarkerMessageId(null);
              setConversationMemoryId(null);
              setProcessedProposalIds(new Set());

              const { data: { session } } = await supabase.auth.getSession();
              if (!session?.access_token) {
                addErrorMessage('Authentication required to load chat history.');
                return;
              }

              // Render immediately from cache (mem → disk → UI)
              let cachedCount = 0;
              try {
                const { messages: cached } = await chatCacheRef.current.getPage(chatId, 'latest');
                cachedCount = cached?.length || 0;
                if (cachedCount) {
                  const filtered = cached.filter((m: Message) => m.role !== 'system');
                  setMessages(filtered);
                  // Mirror network-load behavior: minimal padding + scroll to bottom
                  setAssistantResponseComplete(true);
                  setAssistantJustFinished(false);
                  userHasScrolledRef.current = true;
                  setTimeout(() => {
                    const container = messagesContainerRef.current;
                    if (container) {
                      container.scrollTop = container.scrollHeight;
                    }
                  }, 50);
                }
              } catch {}

              // Conditional fetch with ETag for SWR
              const performFetch = async (forceFull: boolean = false) => {
                const headers: Record<string, string> = { 'Authorization': `Bearer ${session.access_token}` };
                try {
                  if (!forceFull) {
                    const etag = await chatCacheRef.current!.loadEtag(chatId);
                    if (etag) headers['If-None-Match'] = etag;
                  }
                } catch {}

                const response = await fetch(`/api/chat/history/get?chatId=${encodeURIComponent(chatId)}`, { headers });
                if (response.status !== 304 && !response.ok) {
                  throw new Error(`Failed to load chat: ${response.statusText}`);
                }
                return response;
              };

              // If we have cached messages, fire-and-forget SWR; else await network for cold start
              let response: Response | null = null;
              if (cachedCount > 0) {
                // Render cached immediately; then await a full fetch to hydrate metadata
                try {
                  const resp = await performFetch(true);
                  const active = loadRequestIdRef.current === thisLoadId; if (!active) return;
                  const data = await resp.json();
                  if (data?.messages && Array.isArray(data.messages)) {
                    const filtered = (data.messages as any[]).filter((m) => m.role !== 'system');
                    setMessages(filtered as any);
                    try {
                      const etag = resp.headers.get('ETag') || (data as any)?.etag;
                      await chatCacheRef.current!.upsertMessages(chatId, data.messages as any, { source: 'net', etag: etag || undefined });
                    } catch {}
                  }
                  // Update saved metadata
                  if (data?.savedMessageIds && Object.keys(data.savedMessageIds).length > 0) {
                    const newSavedMessages = new Map(
                      Object.entries(data.savedMessageIds).map(([id, info]: any) => [id, { savedAt: new Date(info.savedAt), memoryId: info.memoryId }])
                    );
                    setSavedMessageIds(newSavedMessages);
                  }
                  if (data?.last_message_id_at_save) {
                    setConversationSaveMarkerMessageId(data.last_message_id_at_save);
                  }
                  if (data?.conversationMemoryId) {
                    setConversationMemoryId(data.conversationMemoryId);
                  }
                  if (data?.title) setChatTitle(data.title);
                } catch (e) {
                  console.warn('[Load Chat History] refresh failed', e);
                }
              } else {
                response = await performFetch();
              }

              const chatData = response && response.status !== 304 ? await response.json() : null;
              
              if (!isRecordingPersistenceEnabled() && (isBrowserRecordingRef.current || sessionId)) {
                await handleStopRecording(undefined, false);
              }

              // (moved) state cleared earlier; do not clear here to avoid wiping hydrated metadata

              console.log("[Load Chat History] SETTING CHAT STATE:", {
                oldChatId: currentChatId,
                newChatId: chatData?.id ?? chatId,
                oldTitle: chatTitle,
                newTitle: chatData?.title,
                timestamp: new Date().toISOString()
              });
              
              // currentChatId already set to chatId above; update to backend canonical id if provided
              if (chatData?.id && chatData.id !== chatId) setCurrentChatId(chatData.id);
              if (chatData?.title) setChatTitle(chatData.title);

              if (chatData?.messages && Array.isArray(chatData.messages)) {
                // Clear system messages immediately when loading chat history
                const filteredMessages = chatData.messages.filter((msg: Message) => msg.role !== "system");
                setMessages(filteredMessages);
                // Persist to cache
                if (response) {
                  try {
                    const etag = response.headers.get('ETag') || (chatData as any)?.etag;
                    await chatCacheRef.current.upsertMessages(chatId, chatData.messages as any, { source: 'net', etag: etag || undefined });
                  } catch (e) { console.warn('[Load Chat History] cache upsert failed', e); }
                }
                console.info("[Load Chat History] LOADED", filteredMessages.length, "messages for chat:", chatData.id ?? chatId, "(system messages cleared)");
                console.log("[Load Chat History] COMPLETED LOAD STATE:", {
                    finalChatId: chatData?.id ?? chatId,
                    finalTitle: chatData?.title ?? chatTitle,
                    messageCount: filteredMessages.length,
                    timestamp: new Date().toISOString()
                });
                
                // Set minimal padding when loading chat history (padding removed)
                setAssistantResponseComplete(true);
                setAssistantJustFinished(false);
                userHasScrolledRef.current = true;
                
                // Auto-scroll to the end of the conversation after loading messages
                if (filteredMessages.length > 0) {
                  // Use setTimeout to ensure the messages are rendered before scrolling
                  setTimeout(() => {
                    const container = messagesContainerRef.current;
                    if (container) {
                      // Instantly jump to bottom without any animation
                      container.scrollTop = container.scrollHeight;
                    }
                  }, 100);
                }
              }

              // Populate saved states from the loaded data
              if (chatData?.savedMessageIds && Object.keys(chatData.savedMessageIds).length > 0) {
                const newSavedMessages = new Map(Object.entries(chatData.savedMessageIds).map(([id, info]) => [id, { savedAt: new Date((info as any).savedAt), memoryId: (info as any).memoryId }]));
                setSavedMessageIds(newSavedMessages);
                console.info("[Load Chat History] Loaded", newSavedMessages.size, "saved messages.");
              }
              
              // Correctly handle the conversation saved state, removing the dependency on `isSaved`
              if (chatData?.last_message_id_at_save) {
                setConversationSaveMarkerMessageId(chatData.last_message_id_at_save);
                console.info("[Load Chat History] Loaded conversation save marker at message ID:", chatData.last_message_id_at_save);
                if (chatData.conversationMemoryId) {
                  setConversationMemoryId(chatData.conversationMemoryId);
                }
              }

            } catch (error) {
              console.error("[Load Chat History] Error:", error);
              addErrorMessage(`Failed to load chat history: ${error instanceof Error ? error.message : 'Unknown error'}`);
              throw error; // Re-throw so the caller knows it failed
            }
         }
     }), [sessionId, setMessages, messages.length, handleStopRecording, handleInputChange, handleSubmitWithCanvasContext, supabase.auth, addErrorMessage]);


    const checkScroll = useCallback(() => {
      const c = messagesContainerRef.current;
      if (!c) return;
      const { scrollTop: st, scrollHeight: sh, clientHeight: ch } = c;
      
      // Find the last actual message element to determine real content height
      const messageElements = c.querySelectorAll('[data-role]');
      const lastMessageElement = messageElements[messageElements.length - 1] as HTMLElement;
      
      let effectiveScrollHeight = sh;
      if (lastMessageElement) {
        // Calculate content height based on the last message position + its height
        const lastMessageBottom = lastMessageElement.offsetTop + lastMessageElement.offsetHeight;
        const paddingTop = 32; // pt-8 = 32px
        effectiveScrollHeight = lastMessageBottom + paddingTop + 50; // Add some buffer
      }
      
      // Much more generous threshold for iOS Safari to prevent false detection
      const isSafariMobile = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const atBottomThresholdForLogic = isSafariMobile ? 30 : 2;
      const atBottomThresholdForButtonVisibility = 180;
      const isScrollable = effectiveScrollHeight > ch;
      const isAtBottomForLogic = (effectiveScrollHeight - st - ch) < atBottomThresholdForLogic;
      
      // Require much larger scroll movements on iOS Safari to avoid false positives
      const scrollUpDistance = prevScrollTopRef.current - st;
      const significantScrollUp = scrollUpDistance > (isSafariMobile ? 40 : 10);
      
      if (significantScrollUp && !isAtBottomForLogic && !userHasScrolledRef.current && !isLoading && !isThinking) {
        userHasScrolledRef.current = true;
        // Remove padding when user scrolls up (set to true for minimal padding)
        setAssistantResponseComplete(true);
      } else if (userHasScrolledRef.current && isAtBottomForLogic) {
        userHasScrolledRef.current = false;
        // Keep minimal padding when scrolling back to bottom
        // setAssistantResponseComplete remains true to maintain minimal padding
      }
      
      prevScrollTopRef.current = st;
      const isAtBottomForButton = (effectiveScrollHeight - st - ch) < atBottomThresholdForButtonVisibility;
      setShowScrollToBottom(isScrollable && !isAtBottomForButton);
    }, [assistantResponseComplete]);

    const scrollToBottom = useCallback((b: ScrollBehavior = "smooth") => { 
        // Simple scroll to bottom of container - no complex positioning needed with minimal padding system
        const container = messagesContainerRef.current;
        if (container) {
            container.scrollTo({ 
                top: container.scrollHeight, 
                behavior: b 
            });
        }
        userHasScrolledRef.current = false; 
        setShowScrollToBottom(false); 
    }, []);
    
    // ChatGPT o3 solution refined by Gemini: Mobile scroll fix with anchor zone detection
    const mobileScrollFix = useCallback((container: HTMLElement, target: number) => {
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

        // Use standard smooth scroll for desktop.
        if (!isMobile) {
            container.scrollTo({ top: target, behavior: 'smooth' });
            return;
        }

        // --- "Invisible Reset & Persistent Correction" ---

        // 1. Invisible Reset: A flicker-free jump to break the browser's scroll anchor.
        // This happens in two steps before the next screen paint, appearing as a single movement.
        const neutralPosition = Math.max(100, target * 0.9);
        container.scrollTo({ top: neutralPosition, behavior: 'auto' });
        requestAnimationFrame(() => {
            container.scrollTo({ top: target, behavior: 'auto' });
        });

        // 2. Persistent Correction: Timed retries to ensure the final position sticks.
        const landAtTarget = () => container.scrollTo({ top: target, behavior: 'auto' });
        setTimeout(landAtTarget, 50);
        setTimeout(landAtTarget, 100);
        setTimeout(landAtTarget, 150);

    }, []);

    const scrollToShowUserMessageAtTop = useCallback(() => {
        // console.log('[Scroll Debug] scrollToShowUserMessageAtTop called');
        // Find the last user message element
        const userMessages = document.querySelectorAll('[data-role="user"]');
        // console.log('[Scroll Debug] Found user messages:', userMessages.length);
        const lastUserMessage = userMessages[userMessages.length - 1] as HTMLElement;
        
        if (lastUserMessage && messagesContainerRef.current) {
            // console.log('[Scroll Debug] Last user message found, scrolling to position at top');
            // Scroll to position the user message at the top of the view
            const container = messagesContainerRef.current;
            // Use offsetTop for more reliable positioning
            const messageOffsetTop = lastUserMessage.offsetTop;
            // Adjust scroll position based on screen height
            const vh = window.innerHeight;
            // Calculate how much to scroll to put message at top of viewport
            const containerHeight = container.clientHeight;
            
            // Mobile vs Desktop positioning
            const isMobileDevice = /iPad|iPhone|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            const isSafariMobile = /iPad|iPhone|iPod/.test(navigator.userAgent);
            let topPadding;
            
            if (isMobileDevice) {
                // All mobile devices get minimal padding for top positioning
                topPadding = 0;
            } else {
                // Desktop only - use piecewise function
                if (containerHeight >= 500) {
                    const base1 = 15;
                    const scale1 = 1000;
                    const power1 = 0.7;
                    topPadding = base1 + (scale1 / Math.pow(containerHeight, power1));
                } else if (containerHeight >= 300) {
                    const base2 = 20;
                    const scale2 = 1000;
                    const power2 = 0.8;
                    topPadding = base2 + (scale2 / Math.pow(containerHeight, power2));
                } else {
                    const base3 = 15;
                    const scale3 = 1000;
                    const power3 = 0.9;
                    topPadding = base3 + (scale3 / Math.pow(containerHeight, power3));
                }
                topPadding = Math.max(12, topPadding);
            }
            
            // Calculate target scroll position without constraints
            const idealScrollTop = messageOffsetTop - topPadding;
            const targetScrollTop = Math.max(0, idealScrollTop);
            
            console.log('iOS Safari Debug - Screen height:', vh, 'Container height:', containerHeight, 'Message offsetTop:', messageOffsetTop, 'Target scroll:', targetScrollTop, 'ScrollHeight:', container.scrollHeight, 'Current scrollTop:', container.scrollTop, 'TopPadding:', topPadding, 'isSafariMobile:', isSafariMobile);
            
            // console.log('[Scroll Debug] Message offsetTop:', messageOffsetTop, 'Target scrollTop:', targetScrollTop, 'Current scrollTop:', container.scrollTop);
            // Don't scroll during assistant responses
            if (isLoading || isThinking) {
                return;
            }
            
            // ChatGPT O3 solution: Use mobileScrollFix for all platforms
            mobileScrollFix(container, targetScrollTop);
            userHasScrolledRef.current = false;
            setShowScrollToBottom(false);
        } else {
            // console.log('[Scroll Debug] Could not find user message or container');
        }
    }, []);
    useEffect(() => {
        // Check if we just submitted a user message by comparing message counts
        const currentUserMessageCount = messages.filter(m => m.role === 'user').length;
        const lastMessage = messages[messages.length - 1];
        const isNewUserMessage = currentUserMessageCount > lastUserMessageCountRef.current && lastMessage?.role === 'user';
        
        // console.log('[Scroll Debug] Messages:', messages.length, 'User count:', currentUserMessageCount, 'Last count:', lastUserMessageCountRef.current, 'isNewUserMessage:', isNewUserMessage, 'isLoading:', isLoading, 'isThinking:', isThinking, 'lastMessage role:', lastMessage?.role);
        
        if (isNewUserMessage) {
            // console.log('[Scroll Debug] Triggering user message scroll to top');
            // Update the count immediately
            lastUserMessageCountRef.current = currentUserMessageCount;
            // Scroll to show user message at top
            const id = requestAnimationFrame(() => {
                const isMobile = /iPad|iPhone|iPod|Android/i.test(navigator.userAgent);
                const delay = isMobile ? 500 : 200; // Longer delay for mobile devices
                setTimeout(() => {
                    scrollToShowUserMessageAtTop();
                }, delay);
            });
            return () => cancelAnimationFrame(id);
        }
        
        // Update count for any user message changes
        if (currentUserMessageCount !== lastUserMessageCountRef.current) {
            lastUserMessageCountRef.current = currentUserMessageCount;
        }
        
        // Don't auto-scroll during ANY part of assistant response cycle (loading, thinking, or streaming)
        if (isLoading || isThinking) {
            // console.log('[Scroll Debug] Skipping auto-scroll because isLoading=', isLoading, 'isThinking=', isThinking);
            return;
        }
        
        // Only auto-scroll to bottom when assistant response is completely finished
        // and only if user hasn't manually scrolled
        // Disabled auto-scroll to bottom for assistant messages
        // if (!userHasScrolledRef.current && !isNewUserMessage && !isLoading && !isThinking) {
        //     const isAssistantMessage = lastMessage?.role === 'assistant';
        //     if (isAssistantMessage) {
        //         console.log('[Scroll Debug] Auto-scrolling to bottom for completed assistant message');
        //         const id = requestAnimationFrame(() => {
        //             setTimeout(() => { scrollToBottom('smooth'); }, 50);
        //         });
        //         return () => cancelAnimationFrame(id);
        //     }
        // }
        // Always allow checkScroll to run to maintain scroll-to-bottom button functionality
        // Only limit when userHasScrolled is true during assistant responses to prevent auto-scroll
        // BUT don't run checkScroll immediately after assistant finishes to prevent jumping
        if (!isLoading && !isThinking && userHasScrolledRef.current && !assistantJustFinished) {
            checkScroll();
        } else if ((isLoading || isThinking) && userHasScrolledRef.current) {
            // During assistant responses, still update scroll button visibility
            checkScroll();
        } else if ((isLoading || isThinking) && !userHasScrolledRef.current) {
            // Also run checkScroll during assistant responses when user hasn't scrolled to maintain button visibility
            checkScroll();
        }
    }, [messages, isLoading, isThinking, scrollToBottom, scrollToShowUserMessageAtTop, checkScroll]);
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
             
         };
         
         document.addEventListener("mousedown", handleClick, true);
         document.addEventListener("touchstart", handleClick, true); // Add touch support
         
         return () => {
             document.removeEventListener("mousedown", handleClick, true);
             document.removeEventListener("touchstart", handleClick, true);
         };
     }, [showRecordUI, hideRecordUI, isBrowserRecordingRef.current, pendingActionRef.current]);

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

    // Listen for cross-component stop requests (e.g., agent/event switch)
    useEffect(() => {
        // Only needed in non-persistence mode; persistence has its own manager wiring
        if (isRecordingPersistenceEnabled()) return;
        let bc: BroadcastChannel | null = null;
        try {
            bc = new BroadcastChannel('recording');
            bc.onmessage = (ev) => {
                const msg = ev?.data;
                if (msg && msg.kind === 'stop:request' && isBrowserRecordingRef.current) {
                    // stop gracefully
                    handleStopRecording(undefined, false);
                }
            };
        } catch {}
        return () => { try { bc?.close(); } catch {} };
    }, [handleStopRecording]);

    const handlePlayPauseMicClick = useCallback(async (e?: React.MouseEvent) => {
        // Allow invocation from menu items where we don't have a real MouseEvent
        e?.stopPropagation?.();
        if (pendingActionRef.current) return;
        if (isRecordingPersistenceEnabled()) {
            const st = recordingManager.getState();
            const active = !!(st.sessionId && (st.phase === 'starting' || st.phase === 'active' || st.phase === 'suspended'));
            if (!active) {
                // Not active yet: start via manager
                if (!agentName) { addErrorMessage('Agent information is missing. Cannot start recording.'); return; }
                try {
                    recordingManager.start({ type: 'chat', chatId: currentChatId || undefined, agentName: agentName || undefined, eventId });
                } catch (err: any) {
                    addErrorMessage(`Error: ${err?.message || 'Failed to start recording'}`);
                }
                return;
            }
            // Active: toggle pause/resume via manager
            const paused = !!st.paused;
            try {
                if (paused) recordingManager.resume(); else recordingManager.pause();
            } catch {}
            return;
        }
        if (!isBrowserRecordingRef.current) {
            await handleStartRecordingSession();
        } else {
            handleToggleBrowserPause();
        }
    }, [handleStartRecordingSession, handleToggleBrowserPause, showAndPrepareRecordingControls, agentName, currentChatId, eventId, addErrorMessage]);

    const saveChat = useCallback(() => { console.info("[Save Chat] Initiated."); const chatContent = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n"); const blob = new Blob([chatContent], { type: "text/plain" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `chat-${agentName || 'agent'}-${eventId || 'event'}-${new Date().toISOString().slice(0, 10)}.txt`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); }, [messages, agentName, eventId]);

    // When persistence is enabled, mirror manager state into existing UI controls
    useEffect(() => {
        if (!isRecordingPersistenceEnabled()) return;
        let timer: any = null;
        let baseMs = Date.now();
        const setPhase = (p: 'idle'|'starting'|'active'|'suspended'|'stopping'|'error') => {
            try { setManagerPhase(p); } catch {}
        };
        const startTick = (startedAt?: number) => {
            if (timer) clearInterval(timer);
            baseMs = startedAt || Date.now();
            // initialize immediately
            const initialPausedMs = pausedAccumMsRef.current + (pausedStartRef.current ? (Date.now() - pausedStartRef.current) : 0);
            setClientRecordingTime(Math.max(0, Math.floor((Date.now() - baseMs - initialPausedMs) / 1000)));
            timer = setInterval(() => {
                const st = recordingManager.getState();
                // While paused, freeze the display (no increments)
                if (st.paused) return;
                const pausedSoFar = pausedAccumMsRef.current + (pausedStartRef.current ? (Date.now() - pausedStartRef.current) : 0);
                const t0 = st.startedAt || baseMs;
                setClientRecordingTime(Math.max(0, Math.floor((Date.now() - t0 - pausedSoFar) / 1000)));
           }, 1000);
        };
        const stopTick = () => { if (timer) { clearInterval(timer); timer = null; } setClientRecordingTime(0); };

        const unsub = recordingManager.subscribe((s) => {
            const active = !!(s.sessionId && (s.phase === 'starting' || s.phase === 'active' || s.phase === 'suspended'));
            setPhase(s.phase as any);
            setIsBrowserRecording(active);
            setIsBrowserPaused(!!s.paused);
            // Track pause/resume transitions to accumulate paused duration
            if (s.paused && !prevPausedRef.current) {
                pausedStartRef.current = Date.now();
            } else if (!s.paused && prevPausedRef.current) {
                if (pausedStartRef.current) {
                    pausedAccumMsRef.current += Date.now() - pausedStartRef.current;
                    pausedStartRef.current = null;
                }
            }
            prevPausedRef.current = !!s.paused;

            if (active) startTick(s.startedAt);
            else {
                // Reset pause accounting when session ends
                pausedAccumMsRef.current = 0;
                pausedStartRef.current = null;
                prevPausedRef.current = false;
                stopTick();
            }
        });
        return () => { if (timer) clearInterval(timer); unsub(); };
    }, []);


    const executeSaveConversation = useCallback(async () => {
        debugLog("[Save Chat to Memory] Executing after confirmation.");
        const currentMessages = messagesRef.current;
        if (!agentName || currentMessages.length === 0 || !currentChatId) {
            addErrorMessage('Cannot save memory: Chat is empty or has not been initialized.');
            return;
        }

        const lastMessageId = currentMessages.length > 0 ? currentMessages[currentMessages.length - 1].id : null;
        const originalSaveMarker = conversationSaveMarkerMessageId;
        const originalMemoryId = conversationMemoryId;

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
                    event: eventId || '0000',
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
                    eventId: eventId || '0000',
                    savedAt: new Date().toISOString()
                }),
            });
            
            const memResult = await memoryResponse.json();
            if (!memoryResponse.ok) {
                throw new Error(memResult.error || "Failed to save to intelligent memory.");
            }
            
            if (memResult.log_id) {
                setConversationMemoryId(memResult.log_id);
            }

            toast.success("Chat saved to memory successfully.", { id: toastId });
        } catch (error: any) {
            console.error('[Save to Memory] Error:', error);
            toast.error(`Failed to save memory: ${error.message}. Reverting.`, { id: toastId });
            setConversationSaveMarkerMessageId(originalSaveMarker);
            setConversationMemoryId(originalMemoryId);
        } finally {
            setConfirmationRequest(null);
        }
    }, [agentName, addErrorMessage, onHistoryRefreshNeeded, currentChatId, chatTitle, conversationSaveMarkerMessageId, conversationMemoryId, supabase.auth]);

    const executeSaveMessage = useCallback(async (message: Message) => {
        debugLog("[Save Message to Memory] Executing after confirmation for message:", message.id);
        if (!agentName) {
            addErrorMessage('Cannot save message: Agent not configured.');
            setConfirmationRequest(null);
            return;
        }

        const toastId = `save-message-${message.id}`;
        const newSaveDate = new Date();
        
        // Optimistic update placeholder
        const placeholderInfo = { savedAt: newSaveDate, memoryId: 'pending' };
        setSavedMessageIds(prev => new Map(prev).set(message.id, placeholderInfo));

        if (onHistoryRefreshNeeded) {
            onHistoryRefreshNeeded();
        }

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
                    eventId: eventId || '0000',
                    savedAt: newSaveDate.toISOString()
                }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Failed to save message.");

            if (result.log_id) {
                // Final update with the real memoryId
                setSavedMessageIds(prev => new Map(prev).set(message.id, { savedAt: newSaveDate, memoryId: result.log_id }));
            } else {
                // If no log_id, something is wrong, revert.
                throw new Error("Backend did not return a memoryId.");
            }

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
    }, [agentName, addErrorMessage, onHistoryRefreshNeeded]);

    const executeForgetMemory = useCallback(async (memoryId: string, type: 'message' | 'conversation', messageId?: string) => {
        debugLog(`[Forget Memory] Executing for memoryId: ${memoryId}`);
        if (!agentName) {
            addErrorMessage('Cannot forget memory: Agent not configured.');
            return;
        }

        const toastId = `forget-memory-${memoryId}`;
        
        // Optimistic UI update
        let originalState: any;
        if (type === 'message' && messageId) {
            originalState = new Map(savedMessageIds);
            setSavedMessageIds(prev => {
                const newMap = new Map(prev);
                newMap.delete(messageId);
                return newMap;
            });
        } else if (type === 'conversation') {
            originalState = {
                marker: conversationSaveMarkerMessageId,
                memoryId: conversationMemoryId
            };
            setConversationSaveMarkerMessageId(null);
            setConversationMemoryId(null);
        }

        if (onHistoryRefreshNeeded) {
            onHistoryRefreshNeeded();
        }

        try {
            const response = await fetch('/api/memory/forget', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentName, memoryId }),
            });

            if (!response.ok) {
                const result = await response.json().catch(() => ({}));
                throw new Error(result.error || "Failed to forget memory.");
            }
            
            toast.success("Memory forgotten.", { id: toastId });

        } catch (error: any) {
            console.error('[Forget Memory] Error:', error);
            toast.error(`Failed to forget memory: ${error.message}. Reverting.`, { id: toastId });
            
            // Revert UI on failure
            if (type === 'message') {
                setSavedMessageIds(originalState as Map<string, { savedAt: Date; memoryId: string; }>);
            } else if (type === 'conversation') {
                setConversationSaveMarkerMessageId(originalState.marker);
                setConversationMemoryId(originalState.memoryId);
            }
        } finally {
            setConfirmationRequest(null);
        }
    }, [agentName, addErrorMessage, onHistoryRefreshNeeded, savedMessageIds, conversationSaveMarkerMessageId, conversationMemoryId, supabase.auth]);

    const executeOverwriteConversation = useCallback(async () => {
        debugLog("[Overwrite Chat Memory] Executing after confirmation.");
        const currentMessages = messagesRef.current;
        if (!agentName || currentMessages.length === 0 || !currentChatId) {
            addErrorMessage('Cannot save memory: Chat is empty or has not been initialized.');
            setConfirmationRequest(null);
            return;
        }

        const lastMessageId = currentMessages.length > 0 ? currentMessages[currentMessages.length - 1].id : null;
        const originalSaveMarker = conversationSaveMarkerMessageId;
        const originalMemoryId = conversationMemoryId;

        // Optimistic UI update
        if (lastMessageId) {
            setConversationSaveMarkerMessageId(lastMessageId);
        }

        const toastId = `overwrite-memory-${currentChatId}`;
        toast.loading("Saving...", { id: toastId });

        if (onHistoryRefreshNeeded) {
            onHistoryRefreshNeeded();
        }

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) throw new Error("Authentication error. Cannot save memory.");

            // First, save/update the chat history in Supabase. This is idempotent.
            const historyResponse = await fetch('/api/chat/history/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
                body: JSON.stringify({
                    agent: agentName,
                    messages: currentMessages,
                    chatId: currentChatId,
                    title: chatTitle,
                    lastMessageId: lastMessageId,
                    event: eventId || '0000',
                }),
            });
            const historyResult = await historyResponse.json();
            if (!historyResponse.ok || !historyResult.success) throw new Error(historyResult.error || "Failed to update chat history before overwrite.");

            // Now, call save-chat which handles the overwrite logic (delete->upsert)
            const memoryResponse = await fetch('/api/memory/save-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
                body: JSON.stringify({
                    agentName: agentName,
                    messages: currentMessages,
                    sessionId: currentChatId, // sessionId on backend is the chatId
                    eventId: eventId || '0000',
                    savedAt: new Date().toISOString()
                }),
            });
            
            const memResult = await memoryResponse.json();
            if (!memoryResponse.ok) {
                throw new Error(memResult.error || "Failed to overwrite intelligent memory.");
            }
            
            if (memResult.log_id) {
                setConversationMemoryId(memResult.log_id);
            }

            toast.success("Saved chat overwritten.", { id: toastId });
        } catch (error: any) {
            console.error('[Overwrite Memory] Error:', error);
            toast.error("Couldn’t overwrite the saved chat. Try again.", { id: toastId });
            // Revert UI optimistically
            setConversationSaveMarkerMessageId(originalSaveMarker);
            setConversationMemoryId(originalMemoryId);
        } finally {
            setConfirmationRequest(null);
        }
    }, [agentName, addErrorMessage, onHistoryRefreshNeeded, currentChatId, chatTitle, conversationSaveMarkerMessageId, conversationMemoryId, supabase.auth]);

    const handleSaveChatToMemory = () => {
        if (conversationMemoryId) {
            setConfirmationRequest({ type: 'overwrite-conversation', memoryId: conversationMemoryId });
        } else {
            setConfirmationRequest({ type: 'save-conversation' });
        }
    };

    // When clicking the in-chat saved marker/bookmark line, prefer the forget flow if already saved
    const handleToggleConversationMemoryFromMarker = () => {
        if (conversationMemoryId) {
            setConfirmationRequest({ type: 'forget-conversation', memoryId: conversationMemoryId });
        } else {
            setConfirmationRequest({ type: 'save-conversation' });
        }
    };

    const handleSaveMessageToMemory = (message: Message) => {
        const savedInfo = savedMessageIds.get(message.id);
        if (savedInfo && savedInfo.memoryId !== 'pending') {
            setConfirmationRequest({ type: 'forget-message', message, memoryId: savedInfo.memoryId });
        } else {
            setConfirmationRequest({ type: 'save-message', message });
        }
    };
    const attachDocument = useCallback(() => { debugLog("[Attach Document] Triggered."); fileInputRef.current?.click(); }, []);
    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files && e.target.files.length > 0) { const newFiles = Array.from(e.target.files).map((file) => ({ id: Math.random().toString(36).substring(2, 9), name: file.name, size: file.size, type: file.type, url: URL.createObjectURL(file), })); setAttachedFiles((prev) => [...prev, ...newFiles]); debugLog("[File Change] Files attached:", newFiles.map(f=>f.name)); } if (fileInputRef.current) fileInputRef.current.value = ""; }, []);
    const removeFile = useCallback((id: string) => { debugLog("[Remove File] Removing file ID:", id); setAttachedFiles((prev) => { const fileToRemove = prev.find((file) => file.id === id); if (fileToRemove?.url) URL.revokeObjectURL(fileToRemove.url); return prev.filter((file) => file.id !== id); }); }, []);
    const handleRecordUIMouseMove = useCallback(() => { if (isBrowserRecordingRef.current) { if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current); setRecordUIVisible(true); startHideTimeout(); }}, [startHideTimeout]);
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
    
    const readAloud = useCallback(async (message: Message) => {
      // 1. Stop any currently playing audio and clean up listeners
      if (ttsPlayback.audio) {
        ttsPlayback.audio.pause();
        ttsPlayback.audio.onplaying = null;
        ttsPlayback.audio.onended = null;
        ttsPlayback.audio.onerror = null;
      }

      // 2. If the user clicks the same message again, treat it as a stop action
      if (ttsPlayback.isPlaying && ttsPlayback.messageId === message.id) {
        setTtsPlayback({ isPlaying: false, messageId: null, audio: null, audioUrl: null });
        setIsTtsLoading(false);
        return;
      }

      const toastId = `tts-${message.id}`;
      
      // 3. Set UI to loading state immediately
      setIsTtsLoading(true);
      setTtsPlayback({ isPlaying: true, messageId: message.id, audio: null, audioUrl: null });

      try {
        const audioUrl = `/api/tts-proxy?text=${encodeURIComponent(message.content)}&voiceId=${ELEVENLABS_VOICE_ID}`;
        const audio = new Audio();
        
        // 4. Set up event handlers
        audio.onplaying = () => {
          debugLog("[TTS] Audio playback has started (onplaying event).");
          // This is the key: set loading to false only when playback *actually* starts.
          setIsTtsLoading(false); 
          setTtsPlayback(prev => ({ ...prev, audio, audioUrl, isPlaying: true }));
        };

        audio.onended = () => {
          debugLog("[TTS] Audio playback ended.");
          setTtsPlayback({ isPlaying: false, messageId: null, audio: null, audioUrl: null });
          setIsTtsLoading(false);
        };
        
        audio.onerror = (e) => {
          console.error("[TTS] Audio element error:", e);
          toast.error("Error playing audio.", { id: toastId });
          setTtsPlayback({ isPlaying: false, messageId: null, audio: null, audioUrl: null });
          setIsTtsLoading(false);
        };

        // 5. Set the source and trigger playback
        audio.src = audioUrl;
        audio.load(); // Explicitly call load() for better cross-browser compatibility
        audio.play().catch(e => {
            console.error("[TTS] audio.play() was rejected:", e);
            toast.error("Could not start audio playback.", { id: toastId });
            setIsTtsLoading(false);
            setTtsPlayback({ isPlaying: false, messageId: null, audio: null, audioUrl: null });
        });

      } catch (error) {
        console.error("TTS Setup Error:", error);
        toast.error((error as Error).message, { id: toastId });
        setIsTtsLoading(false);
        setTtsPlayback({ isPlaying: false, messageId: null, audio: null, audioUrl: null });
      }
    }, [ttsPlayback]);

    const handleStopTts = () => {
      if (ttsPlayback.audio) {
        ttsPlayback.audio.pause();
        setTtsPlayback({ isPlaying: false, messageId: null, audio: null, audioUrl: null });
      }
    };

    const handleRetryMessage = useCallback(async (errorMessage: ErrorMessage) => {
        if (!errorMessage.canRetry) return;
        
        // Remove the error message from the UI
        setErrorMessages(prev => prev.filter(m => m.id !== errorMessage.id));
        
        // Use the built-in reload function to regenerate the last assistant message
        reload();

    }, [reload, setErrorMessages]);

    const handleDeleteMessage = useCallback(async () => {
        if (!messageToDelete) return; // Add this check
        const isError = messageToDelete.role === 'error';
        
        // If it's just a UI-side error message, just remove it from local state.
        if (isError) {
            setErrorMessages(prev => prev.filter(m => m.id !== messageToDelete.id));
            setMessageToDelete(null);
            return;
        }
        
        // If it's a real message from the DB...
        if (!currentChatId || isDeleting) return;



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
            if (onHistoryRefreshNeeded) {
                onHistoryRefreshNeeded();
            }

        } catch (error: any) {
            console.error('[Delete Message] Error:', error);
            toast.error(`Failed to delete message: ${error.message}. Restoring.`, { id: toastId });
            
            // Rollback UI on failure
            setMessages(originalMessages);
            setErrorMessages(originalErrorMessages);
        }
    }, [messageToDelete, currentChatId, isDeleting, conversationSaveMarkerMessageId, messages, errorMessages, supabase.auth, onHistoryRefreshNeeded]);

  const onSubmit = handleSubmitWithCanvasContext;

  const updateInputAreaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    
    const inputAreaContainer = textarea.closest('.input-area-container') as HTMLElement;
    if (!inputAreaContainer) return;
    
    requestAnimationFrame(() => {
      const inputAreaHeight = inputAreaContainer.offsetHeight;
      // Update CSS variable so button position adjusts dynamically
      document.documentElement.style.setProperty('--input-area-height', `${inputAreaHeight}px`);
      
      console.log(`[DEBUG] Updated --input-area-height to: ${inputAreaHeight}px`);
    });
  }, []);

  // iOS Safari keyboard handling
  useEffect(() => {
    if (typeof window !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
      const handleKeyboardShow = () => {
        // Force remove any bottom spacing that iOS Safari might add
        document.body.style.paddingBottom = '0px';
        document.body.style.marginBottom = '0px';
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
          (mainContent as HTMLElement).style.paddingBottom = '0px';
          (mainContent as HTMLElement).style.marginBottom = '0px';
        }
        const inputContainer = document.querySelector('.input-area-container');
        if (inputContainer) {
          (inputContainer as HTMLElement).style.paddingBottom = '0px';
          (inputContainer as HTMLElement).style.marginBottom = '0px';
        }
      };

      const handleKeyboardHide = () => {
        // Keep the same zero spacing when keyboard hides
        document.body.style.paddingBottom = '0px';
        document.body.style.marginBottom = '0px';
      };

      // Listen for focus events on input fields
      const inputs = document.querySelectorAll('textarea, input');
      inputs.forEach(input => {
        input.addEventListener('focus', handleKeyboardShow);
        input.addEventListener('blur', handleKeyboardHide);
      });

      // Also listen for visual viewport changes
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleKeyboardShow);
      }

      // Aggressive approach: Watch for any style changes to body/main elements
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
            const target = mutation.target as HTMLElement;
            if (target === document.body || target.classList.contains('main-content') || target.classList.contains('input-area-container')) {
              // Force remove any bottom spacing immediately
              if (target.style.paddingBottom !== '0px') target.style.paddingBottom = '0px';
              if (target.style.marginBottom !== '0px') target.style.marginBottom = '0px';
            }
          }
        });
      });

      // Observe body and any main content areas
      observer.observe(document.body, { attributes: true, attributeFilter: ['style'] });
      const mainContent = document.querySelector('.main-content');
      if (mainContent) observer.observe(mainContent, { attributes: true, attributeFilter: ['style'] });
      const inputContainer = document.querySelector('.input-area-container');
      if (inputContainer) observer.observe(inputContainer, { attributes: true, attributeFilter: ['style'] });

      return () => {
        inputs.forEach(input => {
          input.removeEventListener('focus', handleKeyboardShow);
          input.removeEventListener('blur', handleKeyboardHide);
        });
        if (window.visualViewport) {
          window.visualViewport.removeEventListener('resize', handleKeyboardShow);
        }
        observer.disconnect();
      };
    }
  }, []);

  const handleTextAreaInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    handleInputChange(e);
    const textarea = e.target;
    
    // Reset height to auto to calculate the new scrollHeight
    textarea.style.height = 'auto';
    // The +2 is a small buffer to prevent scrollbar flicker
    const scrollHeight = textarea.scrollHeight + 2;

    // Max height for approx 7 lines.
    const maxHeight = 200; 
    
    // Set the new height, respecting the min-height set in the style attribute
    const finalHeight = Math.min(scrollHeight, maxHeight);
    textarea.style.height = `${finalHeight}px`;
    
    // Enable scrolling if we've hit the max height
    textarea.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
    
    // Update CSS variable for dynamic height-dependent elements (like scroll button)
    updateInputAreaHeight();
  };

  // Update height when input is cleared or on initial render
  useEffect(() => {
    updateInputAreaHeight();
  }, [input, updateInputAreaHeight]);

  const toggleMessageCollapse = (messageId: string) => {
    setCollapsedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  };
  
  useEffect(() => { 
      const lKeyDown = (e: KeyboardEvent) => { 
        // On mobile, Enter creates new line (like Shift+Enter on desktop)
        if (isMobile && e.key === "Enter" && !e.shiftKey) {
          return; // Allow default behavior (new line)
        }
        
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
        const allMsgs: UIMessage[] = [...messages, ...errorMessages]
            .filter(msg => {
                // Only filter out messages that contain actual proposals, not confirmation messages
                if (processedProposalIds.has(msg.id)) {
                    const content = msg.content || '';
                    return !content.includes('[DOC_UPDATE_PROPOSAL]');
                }
                return true;
            });
        
        return allMsgs.sort((a, b) => {
            const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return timeA - timeB;
        });
    }, [messages, errorMessages, processedProposalIds]);
    return (
            <div className="flex flex-col" style={{ height: '100%', minHeight: 0 }}>
              <div className="messages-container flex-1 relative" ref={messagesContainerRef} style={{
              overflow: 'auto',
                WebkitOverflowScrolling: 'touch',
                transform: 'translateZ(0)',
                willChange: 'scroll-position'
            }}>
                {combinedMessages.length === 0 && !isPageReady && ( <div className={cn(isMobile ? "fixed" : "absolute", "inset-0 flex items-center justify-center pointer-events-none z-10")}> <p className="text-2xl md:text-3xl font-bold text-center opacity-50">Loading...</p> </div> )}
                {combinedMessages.length === 0 && isPageReady && (
                  <div className={cn(isMobile ? "fixed" : "absolute", "inset-0 flex items-center justify-center pointer-events-none z-10 px-8")}>
                    {currentWelcomeMessageConfig.imageUrl ? (
                      <img
                        src={currentWelcomeMessageConfig.imageUrl}
                        alt={currentWelcomeMessageConfig.imageAlt || 'Welcome Image'}
                        className="h-auto max-w-xs md:max-w-sm opacity-80"
                      />
                    ) : (
                      <p className="text-center opacity-80" style={{ fontSize: currentWelcomeMessageConfig.fontSize, fontWeight: currentWelcomeMessageConfig.fontWeight, lineHeight: '1.2' }}>
                        {currentWelcomeMessageConfig.text}
                      </p>
                    )}
                  </div>
                )}
                {combinedMessages.length > 0 && (
                  <div className="space-y-1" style={{ 
                    paddingTop: window.innerHeight <= 600 ? '24px' : '32px',
                    paddingBottom: 'calc(var(--input-area-height) + 20px)' }}>
                    {combinedMessages.map((message: UIMessage, index: number) => {
                      const isUser = message.role === "user";
                      const isSystem = message.role === "system";
                      const isError = message.role === "error";
                      const messageSaveInfo = savedMessageIds.get(message.id);
                      const isMessageSaved = !!messageSaveInfo;
                      const messageSaveTime = messageSaveInfo?.savedAt;
                      const shouldShowSaveMarker = message.id === conversationSaveMarkerMessageId;
                      const messageAttachments = allAttachments.filter((file) => file.messageId === message.id);
                      const hasAttachments = messageAttachments.length > 0;
                      const isFromCanvas = isUser && message.content.startsWith("🎨 From Canvas:");
                      
                      // Check if a proposal is being generated for this message
                      const isGeneratingForThisMessage = isGeneratingProposal && generatingProposalForMessageId === message.id;
                      
                      // Clean the content for display if a proposal is being generated
                      let displayContent = isFromCanvas ? message.content.substring("🎨 From Canvas:".length).trim() : message.content;
                      if (isGeneratingForThisMessage) {
                          const proposalIndex = message.content.indexOf('[DOC_UPDATE_PROPOSAL]');
                          if (proposalIndex !== -1) {
                              displayContent = message.content.substring(0, proposalIndex).trim();
                          }
                      }
                      
                      // Find the last user message index
                      const lastUserMessageIndex = combinedMessages.map((msg, idx) => msg.role === 'user' ? idx : -1).filter(idx => idx !== -1).pop() ?? -1;
                      const isLastUserMessage = isUser && index === lastUserMessageIndex;
                      const messageThoughtDuration = isUser ? thoughtDurations[message.id] : undefined;
                      const isCollapsed = collapsedMessages.has(message.id);
                      
                      // @ts-ignore - Check for our custom hidden property
                      if (message.ui === 'hidden') {
                        return null;
                      }

                      return (
                        <React.Fragment key={message.id}>
                          <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.2, ease: "easeOut" }}
                            className={cn(
                              "flex flex-col relative group", // Removed mb-1 from here
                              isUser ? "items-end user-message-container" : // Apply new class for user
                              isSystem ? "items-center mb-1" : // Keep mb-1 for system
                              isError ? "items-start mb-1" : // Keep mb-1 for error
                              "items-start assistant-message-container" // Assistant class remains
                            )}
                            data-role={isUser ? "user" : isSystem ? "system" : isError ? "error" : "assistant"}
                            onMouseEnter={() => !isMobile && !isSystem && !isError && setHoveredMessage(message.id)}
                            onMouseLeave={() => !isMobile && setHoveredMessage(null)}
                            onClick={() => !isSystem && !isError && handleMessageInteraction(message.id)}
                          >
                            {isError ? (
                              <div className="error-bubble flex items-center gap-2">
                                <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                                <span>{message.content}</span>
                                {(message as ErrorMessage).canRetry && (
                                  <button
                                    onClick={() => handleRetryMessage(message as ErrorMessage)}
                                    className="ml-4 px-3 py-1.5 text-sm font-semibold bg-background border border-primary/20 text-primary rounded-lg hover:bg-primary/10 transition-colors flex items-center gap-2 shadow-sm"
                                    aria-label="Retry message"
                                  >
                                    <RotateCcw className="h-4 w-4" />
                                    Retry
                                  </button>
                                )}
                              </div>
                            ) : (
                              <>
                                {isCollapsed ? (
                                  // Collapsed state - show a clickable ellipsis
                                  <div
                                    className={cn(
                                      "w-full cursor-pointer opacity-25 hover:opacity-50 transition-opacity py-2 flex",
                                      isUser ? "justify-end pr-2 pl-1.5" : "justify-start pl-1.5 pr-1.5"
                                    )}
                                    onClick={() => toggleMessageCollapse(message.id)}
                                  >
                                    <Minus className="h-5 w-5 rotate-45" />
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
                                    <div className={cn("p-3 message-bubble rounded-[1.8rem] md:rounded-[1.4rem]", isUser ? `user-bubble ${hasAttachments ? "with-attachment" : ""} ${isFromCanvas ? "from-canvas" : ""}` : isSystem ? `bg-transparent text-[hsl(var(--text-muted))] text-sm text-center max-w-[90%] opacity-50 pb-6` : "bg-transparent ai-bubble pl-0" )} data-role={isSystem ? "system" : undefined}>
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
                                          onClick={(e) => {
                                            // Handle checkbox clicks for checklists
                                            const target = e.target as HTMLElement;
                                            if (target.tagName === 'INPUT' && target.classList.contains('checklist-checkbox')) {
                                              e.stopPropagation();
                                              const checkbox = target as HTMLInputElement;
                                              const listItem = checkbox.closest<HTMLElement>('.checklist-item');
                                              const rawContent = listItem?.dataset.rawContent;
                                              
                                              if (listItem && rawContent) {
                                                const itemText = rawContent;
                                                const isChecked = checkbox.checked;
                                                
                                                // Find the index of this specific checklist item
                                                const allChecklistItems = Array.from(listItem.parentElement?.querySelectorAll('.checklist-item') || []);
                                                const itemIndex = allChecklistItems.indexOf(listItem);
                                                
                                                // Update the message content
                                                setMessages(prevMessages => {
                                                  const newMessages = [...prevMessages];
                                                  const targetMessage = newMessages.find(m => m.id === message.id);
                                                  if (targetMessage) {
                                                    // Split content into lines and find checklist items
                                                    const lines = targetMessage.content.split('\n');
                                                    let checklistItemCount = 0;
                                                    let targetLineIndex = -1;
                                                    
                                                    // Find the specific line for this checklist item
                                                    for (let i = 0; i < lines.length; i++) {
                                                      const line = lines[i];
                                                      const checklistMatch = line.match(/^\s*[-*]\s*\[(x|\s*)\]\s+(.+)/i);
                                                      if (checklistMatch) {
                                                        if (checklistItemCount === itemIndex) {
                                                          targetLineIndex = i;
                                                          break;
                                                        }
                                                        checklistItemCount++;
                                                      }
                                                    }
                                                    
                                                    if (targetLineIndex !== -1) {
                                                      const line = lines[targetLineIndex];
                                                      const checklistMatch = line.match(/^(\s*[-*]\s*)\[(x|\s*)\](\s+.+)/i);
                                                      if (checklistMatch) {
                                                        const [, prefix, currentState, suffix] = checklistMatch;
                                                        const newState = isChecked ? 'x' : ' ';
                                                        lines[targetLineIndex] = `${prefix}[${newState}]${suffix}`;
                                                        targetMessage.content = lines.join('\n');
                                                      } else {
                                                        console.warn("Checklist update failed: could not parse line format.", {
                                                          line,
                                                          targetLineIndex
                                                        });
                                                        checkbox.checked = !isChecked;
                                                      }
                                                    } else {
                                                      console.warn("Checklist update failed: could not find target line.", {
                                                        itemIndex,
                                                        checklistItemCount,
                                                        itemText
                                                      });
                                                      checkbox.checked = !isChecked;
                                                    }
                                                  }
                                                  return newMessages;
                                                });
                                              }
                                            }
                                          }}
                                        />
                                      )}
                                    </div>
                                  </>
                                )}
                                {!isSystem && !isCollapsed && (
                                  <div className={cn( "message-actions flex items-center", isUser ? "justify-end mr-2 mt-1" : "justify-start ml-1 -mt-3" )} style={{ opacity: (!isMobile && hoveredMessage === message.id) || (isMobile && selectedMessage === message.id) || copyState.id === message.id || isMessageSaved ? 1 : 0, visibility: (!isMobile && hoveredMessage === message.id) || (isMobile && selectedMessage === message.id) || copyState.id === message.id || isMessageSaved ? "visible" : "hidden", transition: 'opacity 0.2s ease-in-out', }}>
                                    {isUser && (
                                      <div className="flex items-center">
                                        {isMessageSaved ? (
                                          <>
                                            <div className="opacity-0 group-hover:opacity-100 flex items-center transition-opacity">
                                              <span className="text-xs text-[hsl(var(--icon-secondary))] opacity-75 mr-2">{formatTimestamp(message.createdAt)}</span>
                                              <ActionTooltip label={copyState.id === message.id && copyState.copied ? t('tooltips.copied') : t('tooltips.copy')} align="end">
                                                <button onClick={(e) => { e.stopPropagation(); copyToClipboard(message.content, message.id); }} className="action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]" aria-label={tooltips.copy_message || "Copy message"}>
                                                  {copyState.id === message.id && copyState.copied ? <Check className="h-[18px] w-[18px] copy-button-animation" /> : <Copy className="h-[18px] w-[18px]" />}
                                                </button>
                                              </ActionTooltip>
                                              {/* Message editing - Centralized in hide_message_actions config */}
                                              {(!activeUiConfig.hide_message_actions?.includes('edit') || isAdminOverride) && (
                                                <ActionTooltip labelKey="tooltips.edit" align="end">
                                                  <button onClick={() => editMessage(message.id)} className="action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]" aria-label={tooltips.edit_message || "Edit message"}>
                                                    <Pencil className="h-[18px] w-[18px]" />
                                                  </button>
                                                </ActionTooltip>
                                              )}
                                              {/* Delete button - Hidden if workspace config specifies */}
                                              {(!activeUiConfig.hide_message_actions?.includes('delete') || isAdminOverride) && (
                                                <ActionTooltip labelKey="tooltips.delete" align="end">
                                                  <button onClick={(e) => { e.stopPropagation(); setMessageToDelete(message); }} className={cn("action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-destructive))]", isDeleting && "opacity-50 cursor-not-allowed")} aria-label={tooltips.delete_message || "Delete message"} disabled={isDeleting}>
                                                    <Trash2 className="h-[18px] w-[18px]" />
                                                  </button>
                                                </ActionTooltip>
                                              )}
                                              {/* Collapse button - Hidden if workspace config specifies */}
                                              {(!activeUiConfig.hide_message_actions?.includes('collapse') || isAdminOverride) && (
                                                <ActionTooltip labelKey="tooltips.hide" align="end">
                                                  <button onClick={(e) => { e.stopPropagation(); toggleMessageCollapse(message.id); }} className="action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]" aria-label="Hide message">
                                                    <ChevronUp className="h-[18px] w-[18px]" />
                                                  </button>
                                                </ActionTooltip>
                                              )}
                                            </div>
                                            <span className="text-xs text-[hsl(var(--save-memory-color))] opacity-75 ml-2">
                                              Message saved
                                            </span>
                                            <ActionTooltip labelKey="tooltips.forgetMemory" align="end">
                                              <button onClick={(e) => { e.stopPropagation(); handleSaveMessageToMemory(message as Message); }} className="action-button" aria-label="Forget message memory">
                                                  <Bookmark className="h-[18px] w-[18px] stroke-[hsl(var(--save-memory-color))] ml-2" />
                                              </button>
                                            </ActionTooltip>
                                          </>
                                        ) : (
                                          <>
                                            <span className="text-xs text-[hsl(var(--icon-secondary))] opacity-75 mr-2">{formatTimestamp(message.createdAt)}</span>
                                            <ActionTooltip label={copyState.id === message.id && copyState.copied ? t('tooltips.copied') : t('tooltips.copy')} align="end">
                                              <button onClick={(e) => { e.stopPropagation(); copyToClipboard(message.content, message.id); }} className="action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]" aria-label={tooltips.copy_message || "Copy message"}>
                                                {copyState.id === message.id && copyState.copied ? <Check className="h-[18px] w-[18px] copy-button-animation" /> : <Copy className="h-[18px] w-[18px]" />}
                                              </button>
                                            </ActionTooltip>
                                            {/* Message editing - Centralized in hide_message_actions config */}
                                            {(!activeUiConfig.hide_message_actions?.includes('edit') || isAdminOverride) && (
                                              <ActionTooltip labelKey="tooltips.edit" align="end">
                                              <button onClick={() => editMessage(message.id)} className="action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]" aria-label={tooltips.edit_message || "Edit message"}>
                                                <Pencil className="h-[18px] w-[18px]" />
                                              </button>
                                            </ActionTooltip>
                                            )}
                                            <ActionTooltip labelKey="tooltips.saveMemory" align="end">
                                              <button onClick={(e) => { e.stopPropagation(); handleSaveMessageToMemory(message as Message); }} className={cn("action-button text-[hsl(var(--icon-secondary))]", (isDeleting) ? "opacity-50 cursor-not-allowed" : "hover:text-[hsl(var(--icon-primary))]")} aria-label={tooltips.save_message || "Save message to memory"} disabled={isDeleting}>
                                                <Bookmark className="h-[18px] w-[18px]" />
                                              </button>
                                            </ActionTooltip>
                                            {/* Delete button - Hidden if workspace config specifies */}
                                            {(!activeUiConfig.hide_message_actions?.includes('delete') || isAdminOverride) && (
                                              <ActionTooltip labelKey="tooltips.delete" align="end">
                                                <button onClick={(e) => { e.stopPropagation(); setMessageToDelete(message); }} className={cn("action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-destructive))]", isDeleting && "opacity-50 cursor-not-allowed")} aria-label={tooltips.delete_message || "Delete message"} disabled={isDeleting}>
                                                    <Trash2 className="h-[18px] w-[18px]" />
                                                </button>
                                              </ActionTooltip>
                                            )}
                                            {/* Collapse button - Hidden if workspace config specifies */}
                                            {(!activeUiConfig.hide_message_actions?.includes('collapse') || isAdminOverride) && (
                                              <ActionTooltip labelKey="tooltips.hide" align="end">
                                                <button onClick={(e) => { e.stopPropagation(); toggleMessageCollapse(message.id); }} className="action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]" aria-label="Hide message">
                                                  <ChevronUp className="h-[18px] w-[18px]" />
                                                </button>
                                              </ActionTooltip>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    )}
                                    {!isUser && (
                                      <div className="flex items-center">
                                        {isMessageSaved ? (
                                          <>
                                            <ActionTooltip labelKey="tooltips.forgetMemory" align="start">
                                              <button onClick={(e) => { e.stopPropagation(); handleSaveMessageToMemory(message as Message); }} className="action-button" aria-label="Forget message memory">
                                                  <Bookmark className="h-[18px] w-[18px] stroke-[hsl(var(--save-memory-color))] mr-2" />
                                              </button>
                                            </ActionTooltip>
                                            <span className="text-xs text-[hsl(var(--save-memory-color))] opacity-75 mr-2">
                                              Message saved
                                            </span>
                                            <div className="opacity-0 group-hover:opacity-100 flex items-center transition-opacity">
                                              <ActionTooltip label={copyState.id === message.id && copyState.copied ? t('tooltips.copied') : t('tooltips.copy')} align="start">
                                                <button onClick={(e) => { e.stopPropagation(); copyToClipboard(message.content, message.id); }} className="action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]" aria-label={tooltips.copy_message || "Copy message"}>
                                                  {copyState.id === message.id && copyState.copied ? <Check className="h-[18px] w-[18px] copy-button-animation" /> : <Copy className="h-[18px] w-[18px]" />}
                                                </button>
                                              </ActionTooltip>
                                              {/* TTS - Centralized in hide_message_actions config */}
                                              {(!activeUiConfig.hide_message_actions?.includes('tts') || isAdminOverride) && (
                                                <ActionTooltip labelKey="tooltips.readAloud" align="start">
                                                  <button
                                                    onClick={() => readAloud(message as Message)}
                                                    className={cn(
                                                        "action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]",
                                                        ttsPlayback.isPlaying && ttsPlayback.messageId === message.id && "text-[hsl(var(--primary))]"
                                                    )}
                                                    aria-label={tooltips.read_aloud || "Read message aloud"}
                                                  >
                                                    <Volume2 className="h-[18px] w-[18px]" />
                                                  </button>
                                                </ActionTooltip>
                                              )}
                                            {/* Delete button - Hidden if workspace config specifies */}
                                            {(!activeUiConfig.hide_message_actions?.includes('delete') || isAdminOverride) && (
                                               <ActionTooltip labelKey="tooltips.delete" align="start">
                                                 <button onClick={(e) => { e.stopPropagation(); setMessageToDelete(message); }} className={cn("action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-destructive))]", isDeleting && "opacity-50 cursor-not-allowed")} aria-label={tooltips.delete_message || "Delete message"} disabled={isDeleting}>
                                                  <Trash2 className="h-[18px] w-[18px]" />
                                                 </button>
                                               </ActionTooltip>
                                            )}
                                              {/* Collapse button - Hidden if workspace config specifies */}
                                              {(!activeUiConfig.hide_message_actions?.includes('collapse') || isAdminOverride) && (
                                                <ActionTooltip labelKey="tooltips.hide" align="start">
                                                  <button onClick={(e) => { e.stopPropagation(); toggleMessageCollapse(message.id); }} className="action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]" aria-label="Hide message">
                                                    <ChevronUp className="h-[18px] w-[18px]" />
                                                  </button>
                                                </ActionTooltip>
                                              )}
                                              <span className="text-xs text-[hsl(var(--icon-secondary))] opacity-75 ml-2">{formatTimestamp(message.createdAt)}</span>
                                            </div>
                                          </>
                                        ) : (
                                          <>
                                            <ActionTooltip label={copyState.id === message.id && copyState.copied ? t('tooltips.copied') : t('tooltips.copy')} align="start">
                                              <button onClick={(e) => { e.stopPropagation(); copyToClipboard(message.content, message.id); }} className="action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]" aria-label={tooltips.copy_message || "Copy message"}>
                                                {copyState.id === message.id && copyState.copied ? <Check className="h-[18px] w-[18px] copy-button-animation" /> : <Copy className="h-[18px] w-[18px]" />}
                                              </button>
                                            </ActionTooltip>
                                            {/* TTS - Centralized in hide_message_actions config */}
                                            {(!activeUiConfig.hide_message_actions?.includes('tts') || isAdminOverride) && (
                                              <ActionTooltip labelKey="tooltips.readAloud" align="start">
                                                <button
                                                  onClick={() => readAloud(message as Message)}
                                                  className={cn(
                                                      "action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]",
                                                      ttsPlayback.isPlaying && ttsPlayback.messageId === message.id && "text-[hsl(var(--primary))]"
                                                  )}
                                                  aria-label={tooltips.read_aloud || "Read message aloud"}
                                                >
                                                  <Volume2 className="h-[18px] w-[18px]" />
                                                </button>
                                              </ActionTooltip>
                                            )}
                                            {/* Show Bookmark and Delete buttons on hover - but render them in the same flow as Copy/ReadAloud */}
                                            {((!isMobile && hoveredMessage === message.id) || (isMobile && selectedMessage === message.id)) && (
                                              <>
                                                <ActionTooltip labelKey="tooltips.saveMemory" align="start">
                                                  <button onClick={(e) => { e.stopPropagation(); handleSaveMessageToMemory(message as Message); }} className={cn("action-button text-[hsl(var(--icon-secondary))]", (isDeleting) ? "opacity-50 cursor-not-allowed" : "hover:text-[hsl(var(--icon-primary))]")} aria-label={tooltips.save_message || "Save message to memory"} disabled={isDeleting}>
                                                    <Bookmark className="h-[18px] w-[18px]" />
                                                  </button>
                                                </ActionTooltip>
                                                {/* Delete button - Hidden if workspace config specifies */}
                                                {(!activeUiConfig.hide_message_actions?.includes('delete') || isAdminOverride) && (
                                                  <ActionTooltip labelKey="tooltips.delete" align="start">
                                                    <button onClick={(e) => { e.stopPropagation(); setMessageToDelete(message); }} className={cn("action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-destructive))]", isDeleting && "opacity-50 cursor-not-allowed")} aria-label={tooltips.delete_message || "Delete message"} disabled={isDeleting}>
                                                      <Trash2 className="h-[18px] w-[18px]" />
                                                    </button>
                                                  </ActionTooltip>
                                                )}
                                                {/* Collapse button - Hidden if workspace config specifies */}
                                                {(!activeUiConfig.hide_message_actions?.includes('collapse') || isAdminOverride) && (
                                                  <ActionTooltip labelKey="tooltips.hide" align="start">
                                                    <button onClick={(e) => { e.stopPropagation(); toggleMessageCollapse(message.id); }} className="action-button text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))]" aria-label="Hide message">
                                                      <ChevronUp className="h-[18px] w-[18px]" />
                                                    </button>
                                                  </ActionTooltip>
                                                )}
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
                          
                          {isGeneratingForThisMessage && (
                            <motion.div
                              initial={{ opacity: 0, y: 5 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.3 }}
                              className="flex self-start mb-4 mt-1"
                            >
                              <ThinkingIndicator text="Working..." showTime={false} />
                            </motion.div>
                          )}
                          
                          {/* Show "Thought for" message for ANY user message that has thinking duration */}
                          {isUser && messageThoughtDuration !== undefined && (
                            <motion.div
                              initial={{ opacity: 0, y: 5 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.3 }}
                              className="flex self-start mb-4 mt-1 pl-2"
                            >
                              <p className="opacity-50">
                                Thought for {formatThoughtDuration(messageThoughtDuration)}.
                              </p>
                            </motion.div>
                          )}
                          
                          {/* Show live thinking indicator and loading states only for the last user message */}
                          {isLastUserMessage && (
                            <>
                              {/* 'isUpdatingDoc' indicator has been moved to the end of the message list for correct positioning */}
                              {isThinking && (selectedModel === 'gemini-2.5-pro' || selectedModel === 'gpt-5' || selectedModel === 'gpt-5-mini') && (
                                <ThinkingIndicator elapsedTime={thinkingTime} />
                              )}
                              {isLoading && !isUpdatingDoc && !isGeneratingProposal && (!isThinking || selectedModel !== 'gemini-2.5-pro') && selectedModel !== 'gpt-5' && selectedModel !== 'gpt-5-mini' && messageThoughtDuration === undefined && (() => {
                                // Hide thinking dot immediately when assistant starts responding
                                const lastMessage = combinedMessages[combinedMessages.length - 1];
                                const assistantIsResponding = lastMessage?.role === 'assistant' && isLoading;
                                return !assistantIsResponding;
                              })() && (
                                <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="thinking-indicator flex self-start mb-4 mt-1 ml-1">
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
                                                          <div className="relative flex justify-center items-center">
                                                            <button
                                                              onClick={handleToggleConversationMemoryFromMarker}
                                                              className="flex items-center bg-[hsl(var(--background))] px-2 text-xs text-[hsl(var(--save-memory-color))] hover:opacity-80 transition-opacity"
                                                              aria-label={conversationMemoryId ? "Forget conversation memory" : "Save conversation to memory"}
                                                            >
                                                              <Bookmark className="h-3 w-3 mr-2" />
                                                              <span>{t('chat.memorySaved')}</span>
                                                            </button>
                                                          </div>
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })}
                    
                    {/* Indicator for document updates, shown at the end of the chat flow */}
                    {isUpdatingDoc && (
                        <div className="flex self-start mb-1 mt-1">
                            <ThinkingIndicator text="Working" showTime={false} />
                        </div>
                    )}
                  </div>
                )}
                <div ref={messagesEndRef} />
            </div>

             {showScrollToBottom && !isModalOpen && (
               <button onClick={() => {
                 // Don't automatically activate minimal padding when clicking scroll-to-bottom
                 scrollToBottom();
               }} className="scroll-to-bottom-button" aria-label="Scroll to bottom">
                 <ArrowDown />
               </button>
             )}

            <div className="input-area-container flex-shrink-0">
                <AlertDialog open={!!messageToDelete} onOpenChange={(open) => !open && setMessageToDelete(null)}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>{t('confirmations.deleteMessage.title')}</AlertDialogTitle>
                            <AlertDialogDescription>
                                {t('confirmations.deleteMessage.message')}
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => setMessageToDelete(null)}>{t('confirmations.deleteMessage.cancel')}</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDeleteMessage}>{t('confirmations.deleteMessage.confirm')}</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                <AlertDialog open={!!docUpdateRequest} onOpenChange={(open) => !open && setDocUpdateRequest(null)}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>{t('confirmations.confirmMemoryUpdate.title')}</AlertDialogTitle>
                            <AlertDialogDescription>
                                {docUpdateRequest?.justification}
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <div className="mt-4">
                            <p className="text-sm font-semibold mb-2">Proposed change for <code className="font-bold bg-muted px-1 py-0.5 rounded">{docUpdateRequest?.doc_name}</code>:</p>
                            <div className="max-h-60 overflow-y-auto rounded-md border bg-muted p-4">
                                <pre className="text-sm whitespace-pre-wrap">{docUpdateRequest?.content}</pre>
                            </div>
                        </div>
                        <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => setDocUpdateRequest(null)}>{t('confirmations.confirmMemoryUpdate.cancel')}</AlertDialogCancel>
                            <AlertDialogAction onClick={executeDocUpdate}>{t('confirmations.confirmMemoryUpdate.confirm')}</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                <AlertDialog open={!!confirmationRequest} onOpenChange={(open) => !open && setConfirmationRequest(null)}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>
                                {confirmationRequest?.type === 'overwrite-conversation' ? t('confirmations.memoryActions.overwriteTitle') :
                                 confirmationRequest?.type.startsWith('forget') ? t('confirmations.memoryActions.forgetTitle') : t('confirmations.memoryActions.saveMessageTitle')}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                {confirmationRequest?.type === 'save-message' && t('confirmations.memoryActions.saveMessage')}
                                {confirmationRequest?.type === 'save-conversation' && t('confirmations.memoryActions.saveConversation')}
                                {confirmationRequest?.type === 'overwrite-conversation' && t('confirmations.memoryActions.overwriteConversation')}
                                {confirmationRequest?.type === 'forget-message' && t('confirmations.memoryActions.forgetMessage')}
                                {confirmationRequest?.type === 'forget-conversation' && t('confirmations.memoryActions.forgetConversation')}
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => setConfirmationRequest(null)}>{t('confirmations.memoryActions.cancel')}</AlertDialogCancel>
                            <AlertDialogAction
                                className={confirmationRequest?.type.startsWith('forget') ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
                                onClick={() => {
                                    if (confirmationRequest?.type === 'save-message' && confirmationRequest.message) {
                                        executeSaveMessage(confirmationRequest.message);
                                    } else if (confirmationRequest?.type === 'save-conversation') {
                                        executeSaveConversation();
                                    } else if (confirmationRequest?.type === 'overwrite-conversation') {
                                        executeOverwriteConversation();
                                    } else if (confirmationRequest?.type === 'forget-message' && confirmationRequest.memoryId && confirmationRequest.message) {
                                        executeForgetMemory(confirmationRequest.memoryId, 'message', confirmationRequest.message.id);
                                    } else if (confirmationRequest?.type === 'forget-conversation' && confirmationRequest.memoryId) {
                                        executeForgetMemory(confirmationRequest.memoryId, 'conversation');
                                    }
                                }}
                            >
                                {confirmationRequest?.type.startsWith('forget') ? t('confirmations.memoryActions.confirmForget') : t('confirmations.memoryActions.confirmSave')}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                {attachedFiles.length > 0 && (
                  <div className="flex justify-end mb-0.5 input-attachments-container">
                    <FileAttachmentMinimal files={attachedFiles} onRemove={removeFile} className="max-w-[50%] file-attachment-container" maxVisible={1} />
                  </div>
                )}
                {ttsPlayback.isPlaying ? (
                  <TTSPlaybackUI onStop={handleStopTts} playbackTime={ttsPlaybackTime} isLoading={isTtsLoading} />
                ) : (
                  <form onSubmit={onSubmit} className="relative">
                    {pressToTalkState === 'recording' && !ttsPlayback.isPlaying ? (
                      <PressToTalkUI
                      onCancel={handleCancelPressToTalk}
                      onSubmit={handleSubmitPressToTalk}
                      recordingTime={pressToTalkTime}
                    />
                  ) : ( // Regular input view
                    <div className={cn("chat-input-layout bg-input-gray rounded-[1.8rem] md:rounded-[1.4rem] py-3 px-3 flex flex-col")}>
                      <div className="w-full flex items-center" style={{ minHeight: '48px' }}>
                        <textarea
                          ref={textareaRef}
                          value={input}
                          onChange={handleTextAreaInput}
                          onKeyDown={(e) => {
                            // On mobile, Enter creates new line (like Shift+Enter on desktop)
                            if (isMobile && e.key === "Enter" && !e.shiftKey) {
                              return; // Allow default behavior (new line)
                            }
                            
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              if (input.trim() || attachedFiles.length > 0) {
                                  onSubmit(e as any);
                              }
                            }
                          }}
                          placeholder={pressToTalkState === 'transcribing' ? "Transcribing..." : (!isPageReady ? "Waiting for Agent/Event..." : (activeUiConfig.chat_input_placeholder || t('chatInput.placeholder')))}
                          className="chat-textarea w-full bg-transparent px-2 outline-none resize-none placeholder:text-[hsl(var(--placeholder-text-color))] dark:placeholder:text-zink-500"
                          disabled={!isPageReady || !!pendingAction || pressToTalkState !== 'idle'}
                          aria-label="Chat input"
                          rows={1}
                          style={{ height: 'auto', overflowY: 'hidden' }}
                        />
                      </div>
                      <div className="flex items-center justify-between w-full mt-1">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button 
                              type="button" 
                              className={cn(
                                "p-2 text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))] mobile-plus-button",
                                (pendingActionRef.current || !isPageReady || isReconnecting || pressToTalkState !== 'idle') && "opacity-50 cursor-not-allowed"
                              )} 
                              aria-label="More options" 
                              disabled={!!pendingActionRef.current || !isPageReady || isReconnecting || pressToTalkState !== 'idle'}
                            >
                              <Plus size={24} strokeWidth={1.55} className="mobile-icon chat-sliders-icon" />
                            </button>
                          </DropdownMenuTrigger>
                          {/* Inline listening indicator + optional count + timer (active only) */}
                          {(() => {
                            const active = (globalRecordingStatus.type === 'long-form-chat' && globalRecordingStatus.isRecording) || isBrowserRecording;

                            // Hide only if both transcript and memorized listening are disabled
                            if (!active && transcriptListenMode === 'none' && savedTranscriptMemoryMode === 'none') return null;
                            const parts: string[] = [];
                            const total = Math.max(0, listeningInfo.total);
                            const more = Math.max(0, total - 1);
                            const latestKey = rawTranscriptFiles && rawTranscriptFiles.length > 0 ? rawTranscriptFiles[0].s3Key : undefined;
                            const includesLatestFromSome = (
                              transcriptListenMode === 'some' && !!latestKey && !!individualRawTranscriptToggleStates && !!(individualRawTranscriptToggleStates as any)[latestKey]
                            );
                            if (active) {
                              // Active recording
                              // Rule: If LATEST transcript is included, show "live", otherwise show "previous"
                              const includesLatest = transcriptListenMode === 'latest' || transcriptListenMode === 'all' || includesLatestFromSome;
                              const hasAnySelection = transcriptListenMode !== 'none' || savedTranscriptMemoryMode !== 'none';
                              const platform = isMobile ? 'mobile' : 'desktop';
                              
                              if (transcriptListenMode === 'none' && savedTranscriptMemoryMode === 'none') {
                                parts.push('Not listening');
                              } else if (includesLatest) {
                                const statusText = more > 0 
                                  ? t(`statusText.${platform}.listeningLiveMore`).replace('{count}', more.toString())
                                  : t(`statusText.${platform}.listeningLive`);
                                parts.push(statusText);
                              } else if (hasAnySelection) {
                                const statusText = more > 0 
                                  ? t(`statusText.${platform}.listeningToPreviousMore`).replace('{count}', more.toString())
                                  : t(`statusText.${platform}.listeningToPrevious`);
                                parts.push(statusText);
                              }
                              parts.push('|');
                              parts.push(formatTimeHMS(clientRecordingTime));
                            } else {
                              // Not actively recording
                              // Rule: If LATEST transcript is included, show "latest", otherwise show "previous"
                              const includesLatest = transcriptListenMode === 'latest' || transcriptListenMode === 'all' || includesLatestFromSome;
                              const hasAnySelection = transcriptListenMode !== 'none' || savedTranscriptMemoryMode !== 'none';
                              const platform = isMobile ? 'mobile' : 'desktop';
                              
                              if (includesLatest) {
                                const statusText = more > 0 
                                  ? t(`statusText.${platform}.listeningToLatestMore`).replace('{count}', more.toString())
                                  : t(`statusText.${platform}.listeningToLatest`);
                                parts.push(statusText);
                              } else if (hasAnySelection) {
                                const statusText = more > 0 
                                  ? t(`statusText.${platform}.listeningToPreviousMore`).replace('{count}', more.toString())
                                  : t(`statusText.${platform}.listeningToPrevious`);
                                parts.push(statusText);
                              }
                              // If nothing is selected, show nothing
                            }
                            return (
                              <span className="ml-2 inline-flex items-center gap-1 text-[hsl(var(--icon-secondary))] opacity-50 text-left select-none font-mono text-[11px] whitespace-nowrap">
                                {parts.map((p, i) => {
                                  // Skip pipe separator and time
                                  if (p === '|' || p.match(/^\d{2}:\d{2}(:\d{2})?$/)) {
                                    return <span key={i}>{p}</span>;
                                  }
                                  
                                  const platform = isMobile ? 'mobile' : 'desktop';
                                  const liveText = t(`statusText.${platform}.listeningLive`);
                                  const latestText = t(`statusText.${platform}.listeningToLatest`);
                                  
                                  // Check if this contains "live" status - highlight the key word
                                  if (p.includes(liveText)) {
                                    // For live status, always highlight "Live" (it's the same in both languages)
                                    const keyWord = 'Live';
                                    const parts = p.split(keyWord);
                                    return (
                                      <span key={i}>
                                        {parts[0]}<span className="text-[hsl(var(--accent))]">{keyWord}</span>{parts.slice(1).join(keyWord)}
                                      </span>
                                    );
                                  } 
                                  // Check if this contains "latest" status - highlight the key word  
                                  else if (p.includes(latestText)) {
                                    // Determine the key word based on the actual text content
                                    let keyWord = 'latest';
                                    if (p.includes('Senaste')) {
                                      keyWord = 'Senaste';
                                    } else if (p.includes('Latest')) {
                                      keyWord = 'Latest';
                                    } else if (p.includes('senaste')) {
                                      keyWord = 'senaste';
                                    }
                                    
                                    const parts = p.split(keyWord);
                                    return (
                                      <span key={i}>
                                        {parts[0]}<span className="text-[hsl(var(--accent))]">{keyWord}</span>{parts.slice(1).join(keyWord)}
                                      </span>
                                    );
                                  }
                                  
                                  return <span key={i}>{p}</span>;
                                })}
                              </span>
                            );
                          })()}
                          <DropdownMenuContent align="start" side="top" className="w-[200px]">
                             {/* File attachment - Hidden if workspace config specifies */}
                             {(!activeUiConfig.hide_plus_menu_items?.includes('add_files') || isAdminOverride) && (
                               <DropdownMenuItem
                                 onSelect={(e) => {
                                   e.preventDefault();
                                   attachDocument();
                                 }}
                                 className="flex items-center gap-3 px-2 py-2"
                               >
                                 <Paperclip size={17} className="flex-shrink-0" />
                                 <span className="text-sm whitespace-nowrap">{t('controlsMenu.addFiles')}</span>
                               </DropdownMenuItem>
                             )}
                             
                             {/* Separator line */}
                             {(!activeUiConfig.hide_plus_menu_items?.includes('add_files') || isAdminOverride) && (
                               <DropdownMenuSeparator />
                             )}
                            
                            <DropdownMenuItem
                              onSelect={(e) => {
                                e.preventDefault();
                                handleSaveChatToMemory();
                              }}
                              disabled={messages.length === 0 || isLoading}
                              className={cn(
                                "flex items-center gap-3 px-2 py-2",
                                (messages.length === 0 || isLoading) && "opacity-50 cursor-not-allowed"
                              )}
                            >
                              <Bookmark
                                size={17}
                                className={cn(
                                  "flex-shrink-0"
                                )}
                              />
                             <span className="text-sm whitespace-nowrap">{t('controlsMenu.saveToMemory')}</span>
                            </DropdownMenuItem>
                            
                            {/* Download chat - Hidden if workspace config specifies */}
                            {(!activeUiConfig.hide_plus_menu_items?.includes('download_chat') || isAdminOverride) && (
                              <DropdownMenuItem
                                onSelect={(e) => {
                                  e.preventDefault();
                                  saveChat();
                                }}
                                className="flex items-center gap-3 px-2 py-2"
                              >
                                <Download size={17} className="flex-shrink-0" />
                                <span className="text-sm whitespace-nowrap">{t('controlsMenu.downloadChat')}</span>
                              </DropdownMenuItem>
                            )}
                            
                            {/* Separator line */}
                            <DropdownMenuSeparator />
                            
                            {/* Simplified recording controls (no submenu) */}
                            {(() => {
                              // Determine dynamic states for persistence vs. non-persistence
                              const persistence = isRecordingPersistenceEnabled();
                              const starting = persistence ? (managerPhase === 'starting') : (pendingActionRef.current === 'start');
                              const stopping = persistence ? (managerPhase === 'stopping') : (pendingActionRef.current === 'stop');
                              const recActive = !!isBrowserRecording; // mirrored for both modes
                              const paused = !!isBrowserPaused;

                              // Main control item: Record meeting / Pause / Resume
                              const mainDisabled = starting || (!!pendingActionRef.current && !stopping) || (globalRecordingStatus.isRecording && globalRecordingStatus.type !== 'long-form-chat') || stopping || isMobile;
                              const mainClass = cn(
                                "flex items-center gap-3 px-2 py-2",
                                starting && "opacity-50 cursor-wait",
                                stopping && "opacity-50 cursor-not-allowed",
                                isMobile && "opacity-50 cursor-not-allowed",
                                recActive && (paused ? "text-yellow-600 dark:text-yellow-400" : "text-yellow-600 dark:text-yellow-400")
                              );

                              const onMainSelect = (e: any) => {
                                e.preventDefault();
                                if (stopping) return; // frozen while saving
                                if (isMobile) return; // Disable recording on mobile
                                if (persistence) {
                                  handlePlayPauseMicClick();
                                } else {
                                  if (!recActive) handleStartRecordingSession();
                                  else handleToggleBrowserPause();
                                }
                              };

                              const MainIcon = starting ? Loader2 : (!recActive ? Play : (paused ? Play : Pause));
                              const mainLabel = !recActive
                                ? (starting ? t('controlsMenu.startingRecording') : t('controlsMenu.recordMeeting'))
                                : (paused ? t('controlsMenu.resumeRecording') : t('controlsMenu.pauseRecording'));

                              return (
                                <>
                                  <DropdownMenuItem
                                    onSelect={onMainSelect}
                                    disabled={mainDisabled}
                                    className={mainClass}
                                  >
                                    <MainIcon className={cn("flex-shrink-0", starting && "h-4 w-4 animate-spin")}/>
                                    <span className="text-sm whitespace-nowrap">{mainLabel}</span>
                                  </DropdownMenuItem>

                                  {(recActive || stopping) && (
                                    <DropdownMenuItem
                                      onSelect={(e) => { e.preventDefault(); if (!stopping) handleStopRecording(); }}
                                      disabled={stopping}
                                      className={cn(
                                        "flex items-center gap-3 px-2 py-2",
                                        stopping && "opacity-50 cursor-wait",
                                        !stopping && "text-red-600 dark:text-red-400"
                                      )}
                                    >
                                      {stopping ? (
                                        <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                                      ) : (
                                        <StopCircle size={17} className="flex-shrink-0" />
                                      )}
                                      <span className="text-sm whitespace-nowrap">{stopping ? t('controlsMenu.savingRecording') : t('controlsMenu.stopRecording')}</span>
                                    </DropdownMenuItem>
                                  )}
                                </>
                              );
                            })()}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <div className="relative" ref={recordUIRef}>
                          {showRecordUI && isBrowserRecording && (
                            <motion.div initial={{ opacity: 0, scale: 0.9, y: 10 }} animate={{ opacity: recordUIVisible ? 1 : 0, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 10 }} transition={{ duration: 0.3 }} className="absolute bottom-full mb-3 bg-input-gray rounded-full py-2 px-3 shadow-lg z-10 flex items-center gap-2 record-ui" onMouseMove={handleRecordUIMouseMove} onClick={(e) => e.stopPropagation()}>
                              <button type="button" className={cn("p-1 record-ui-button mobile-record-button", (pendingActionRef.current === 'start' || pendingActionRef.current === 'pause_stream' || pendingActionRef.current === 'resume_stream') && "opacity-50 cursor-wait")} onClick={handlePlayPauseMicClick} disabled={!!pendingActionRef.current} aria-label={isBrowserPaused ? "Resume recording" : "Pause recording"}>
                                {(pendingActionRef.current === 'start' || pendingActionRef.current === 'pause_stream' || pendingActionRef.current === 'resume_stream')
                                  ? <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--icon-inactive))] mobile-spinner" />
                                  : (isBrowserPaused
                                    ? <Play size={20} className="text-yellow-500 dark:text-yellow-400 mobile-icon" />
                                    : <Pause size={20} className="text-[hsl(var(--icon-destructive))] mobile-icon" />
                                  )
                                }
                              </button>
                              <button type="button" className={cn("p-1 record-ui-button mobile-record-button", pendingActionRef.current === 'stop' && "opacity-50 cursor-wait")} onClick={handleStopRecording} disabled={!!pendingActionRef.current} aria-label="Stop recording">
                                {pendingActionRef.current === 'stop'
                                  ? <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--icon-inactive))] mobile-spinner" />
                                  : <StopCircle size={20} className="text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))] mobile-icon"/>
                                }
                              </button>
                              <span ref={recordControlsTimerDisplayRef} className="text-sm font-medium text-[hsl(var(--text-secondary))] ml-1">{formatTime(clientRecordingTime)}</span>
                            </motion.div>
                          )}
                        </div>
                        <div className="relative w-full h-8 flex items-center">
                          {/* Model Picker - UI controlled entirely by Supabase workspace config */}
                          {/* IMPORTANT: Never hardcode UI visibility logic - always use activeUiConfig from Supabase */}
                          {(!activeUiConfig.hide_model_selector || isAdminOverride) && (
                            <div className="absolute model-picker-container" style={{ right: '50px' }}>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    type="button"
                                    className="text-sm opacity-50 hover:opacity-75 transition-opacity px-1 py-1 rounded-md focus:outline-none focus:ring-0"
                                    disabled={!isPageReady || !!pendingAction}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      flexDirection: 'row',
                                      whiteSpace: 'nowrap',
                                      justifyContent: 'flex-end'
                                    }}
                                  >
                                    <span 
                                      style={{
                                        marginRight: '4px'
                                      }}
                                    >
                                      {MODEL_DISPLAY_NAMES_MAP.get(selectedModel) || selectedModel}
                                    </span>
                                    <ChevronDown className="h-3 w-3 flex-shrink-0 mobile-chevron" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48">
                                  <DropdownMenuRadioGroup value={selectedModel} onValueChange={(value) => onModelChange?.(value)}>
                                    {MODEL_GROUPS.map((group, index) => (
                                      <React.Fragment key={group.label}>
                                        {index > 0 && <DropdownMenuSeparator />}
                                        <DropdownMenuLabel className="text-muted-foreground font-normal pl-8 pr-2 py-1.5 text-xs uppercase opacity-75">
                                          {group.label}
                                        </DropdownMenuLabel>
                                        {group.models.map((model) => (
                                          <DropdownMenuRadioItem key={model.id} value={model.id}>
                                            {model.name}
                                          </DropdownMenuRadioItem>
                                        ))}
                                      </React.Fragment>
                                    ))}
                                  </DropdownMenuRadioGroup>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          )}

                          {/* Submit Button - absolutely positioned at right edge */}
                          <div className="absolute right-0">
                            {isLoading ? (
                              <div 
                                onClick={stop}
                                className={cn(
                                  "h-8 w-8 rounded-full flex items-center justify-center mobile-submit-button cursor-pointer transition-all duration-200",
                                  "bg-[hsl(var(--button-submit-bg-stop))] text-[hsl(var(--button-submit-fg-stop))] hover:opacity-90"
                                )}
                                role="button"
                                aria-label="Stop generating"
                              >
                                <Square className="mobile-stop-icon" />
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  if (input.trim() || attachedFiles.length > 0) {
                                    onSubmit(e as any);
                                  } else {
                                    handleStartPressToTalk();
                                  }
                                }}
                                className={cn(
                                  "transition-all duration-200 rounded-full flex items-center justify-center mobile-submit-button",
                                  "h-8 w-8",
                                  isPageReady && (input.trim() || attachedFiles.length > 0) &&
                                    "bg-[hsl(var(--button-submit-bg-active))] text-[hsl(var(--button-submit-fg-active))] hover:opacity-90",
                                  isPageReady && !(input.trim() || attachedFiles.length > 0) &&
                                    "bg-transparent text-[hsl(var(--primary))] cursor-pointer",
                                  ((globalRecordingStatus.isRecording || pressToTalkState === 'transcribing') && !(input.trim() || attachedFiles.length > 0)) && "cursor-not-allowed opacity-50",
                                  (!isPageReady || !!pendingActionRef.current) && "opacity-50 cursor-not-allowed"
                                )}
                                disabled={
                                  !isPageReady || 
                                  !!pendingActionRef.current || 
                                  pressToTalkState === 'transcribing' ||
                                  (globalRecordingStatus.isRecording && !(input.trim() || attachedFiles.length > 0))
                                }
                                aria-label={input.trim() || attachedFiles.length > 0 ? "Send message" : "Press to send a voice message"}
                              >
                                {pressToTalkState === 'transcribing' ? (
                                  <div className="h-8 w-8 rounded-full flex items-center justify-center bg-primary/20 text-primary mobile-submit-button">
                                    <Loader2 className="h-5 w-5 animate-spin mobile-spinner" />
                                  </div>
                                ) : input.trim() || attachedFiles.length > 0 ? (
                                  <div className="h-8 w-8 rounded-full flex items-center justify-center bg-[hsl(var(--button-submit-bg-active))] text-[hsl(var(--button-submit-fg-active))] mobile-submit-button">
                                    <ArrowUp size={20} className="mobile-icon" />
                                  </div>
                                ) : (
                                  <div className="h-8 w-8 rounded-full flex items-center justify-center bg-[hsl(var(--button-submit-bg-active))] text-[hsl(var(--button-submit-fg-active))] mobile-submit-button">
                                    <WaveformIcon size={20} className="mobile-waveform" />
                                  </div>
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    )}
                    <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} multiple accept=".txt,.md,.json,.pdf,.docx" />
                  </form>
                )}
                {/* Status Bar */}
                {!isFullscreen && (
                    <div className={cn("text-center text-[hsl(var(--status-bar-text-color))] text-xs pt-4 pb-2 font-light status-bar", pendingActionRef.current && "opacity-50")}>
                        <span>Agent: {agentName || '...'}</span> · <span>Event: {eventId || '...'}</span> ·{" "}
                        <span
                          ref={statusRecordingRef}
                          className={cn(
                            "cursor-pointer hover:text-[hsl(var(--text-primary))]",
                            globalRecordingStatus.isRecording && globalRecordingStatus.type !== 'long-form-chat' && "cursor-not-allowed opacity-50"
                          )}
                          onClick={showAndPrepareRecordingControls}
                          title={
                            globalRecordingStatus.isRecording && globalRecordingStatus.type !== 'long-form-chat'
                              ? "Another recording is active"
                              : isBrowserRecording
                              ? "Recording Status"
                              : "Start recording"
                          }
                        >
                          Listen:{" "}
                          {isReconnecting ? (
                            <>reconnecting ({reconnectAttemptsRef.current}/{MAX_RECONNECT_ATTEMPTS}) <span className="inline-block ml-1 h-2 w-2 rounded-full bg-orange-500 animate-pulse"></span></>
                          ) : isBrowserRecording ? (
                            isBrowserPaused ? (
                              <>paused <span className="inline-block ml-1 h-2 w-2 rounded-full bg-yellow-500"></span></>
                            ) : (
                              <>live <span className="inline-block ml-1 h-2 w-2 rounded-full bg-blue-500 animate-pulse"></span></>
                            )
                          ) : globalRecordingStatus.isRecording ? (
                            <>busy <span className="inline-block ml-1 h-2 w-2 rounded-full bg-red-500"></span></>
                          ) : (
                            "no"
                          )}
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
