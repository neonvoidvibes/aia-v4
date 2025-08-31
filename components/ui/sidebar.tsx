import React, { useState, useEffect } from 'react';
import { Button } from './button';
import { Separator } from './separator';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './sheet';
import { useIsMobile } from './use-mobile';
import { createClient } from '@/utils/supabase/client';
import { MODEL_DISPLAY_NAMES_MAP } from '@/lib/model-map';
import {
  MessageCircle,
  Settings,
  X,
  PlusSquare,
  Sidebar as SidebarIcon,
  Waves,
  LayoutGrid,
  Pencil,
  MessageSquare,
  SquarePen,
  AudioLines,
  ChevronRight,
  ChevronLeft,
  History,
  Clock,
  Loader2,
  Disc,
  LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { toast } from "sonner";
import { useLocalization } from '@/context/LocalizationContext';

type View = "chat" | "transcribe" | "record" | "canvas";

interface ChatHistoryItem {
  id: string;
  title:string;
  updatedAt: string;
  agentId: string;
  agentName: string;
  eventId?: string;
  hasSavedMessages?: boolean;
  isConversationSaved?: boolean;
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
  className?: string;
  setCurrentView: (view: View) => void;
  setShowSettings: (show: boolean) => void;
  agentName?: string;
  currentEventId?: string;
  selectedModel?: string;
  onNewChat?: () => void;
  onLoadChat?: (chatId: string) => Promise<void>;
  currentChatId?: string;
  chatHistory: ChatHistoryItem[];
  isLoadingHistory: boolean;
  onDeleteChat: (chatId: string) => void;
  transcriptListenMode: 'latest' | 'none' | 'some' | 'all';
  savedTranscriptMemoryMode: 'none' | 'some' | 'all';
  individualMemoryToggleStates?: Record<string, boolean>;
  individualRawTranscriptToggleStates?: Record<string, boolean>;
  onLogout?: () => void;
  // --- PHASE 3: Workspace UI configuration ---
  isAdminOverride?: boolean;
  activeUiConfig?: any;
}

const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  onOpen,
  className,
  setCurrentView,
  setShowSettings,
  agentName,
  currentEventId,
  selectedModel,
  onNewChat,
  onLoadChat,
  currentChatId,
  chatHistory,
  isLoadingHistory,
  onDeleteChat,
  transcriptListenMode,
  savedTranscriptMemoryMode,
  individualMemoryToggleStates,
  individualRawTranscriptToggleStates,
  onLogout,
  isAdminOverride = false,
  activeUiConfig = {},
}) => {
  const isMobile = useIsMobile();
  const { t, language } = useLocalization();
  const [flattenAll, setFlattenAll] = useState(false);
  const [expandedEvents, setExpandedEvents] = useState<Record<string, boolean>>({});
  const [visibleCountByEvent, setVisibleCountByEvent] = useState<Record<string, number>>({});

  const eventLabel = (e?: string) => {
    return (!e || e === '0000') ? 'Shared' : e;
  };

  // Initialize expanded state from localStorage and defaults
  useEffect(() => {
    const events = Array.from(new Set((chatHistory || []).map(c => c.eventId || '0000')));
    const next: Record<string, boolean> = {};
    const counts: Record<string, number> = {};
    events.forEach(ev => {
      const key = `${agentName || 'agent'}:${ev}:collapsed`;
      const stored = localStorage.getItem(key);
      const isCurrent = ev === (currentEventId || '0000');
      const collapsed = stored != null ? stored === 'true' : !isCurrent; // expand current by default, collapse others
      next[ev] = !collapsed; // store expanded flag
      counts[ev] = 20; // initial visible count
    });
    setExpandedEvents(next);
    setVisibleCountByEvent(counts);
  }, [agentName, currentEventId, chatHistory]);

  const setEventExpanded = (ev: string, expanded: boolean) => {
    setExpandedEvents(prev => ({ ...prev, [ev]: expanded }));
    try { localStorage.setItem(`${agentName || 'agent'}:${ev}:collapsed`, (!expanded).toString()); } catch {}
  };

  const handleLoadChat = async (chatId: string) => {
    if (onLoadChat) {
      // On mobile, close the sidebar immediately for a responsive feel.
      // The chat loading will happen in the background.
      if (isMobile) {
        onClose();
      }
      try {
        // Wait for chat to actually load before switching views
        await onLoadChat(chatId);
        // Only switch to chat view after chat is successfully loaded
        setCurrentView('chat');
        // The onClose call was moved to the top for mobile.
      } catch (error) {
        console.error('[Sidebar] Failed to load chat:', error);
        // Don't switch views or close sidebar if loading failed
        // The error handling is already done in the loadChatHistory function
      }
    }
  };

  // Helper functions for navigation items that auto-close sidebar on mobile
  const handleNavigationClick = (view: View) => {
    setCurrentView(view);
    // Auto-close sidebar on mobile for navigation items
    if (isMobile) {
      onClose();
    }
  };

  const handleNewChat = () => {
    if (onNewChat) {
      onNewChat();
    }
    // Auto-close sidebar on mobile for new chat
    if (isMobile) {
      onClose();
    }
  };

  const handleShowSettings = () => {
    setShowSettings(true);
    // Auto-close sidebar on mobile when opening settings
    if (isMobile) {
      onClose();
    }
  };

  const getSummaryModeText = () => {
    if (savedTranscriptMemoryMode === 'all') {
      return 'All';
    }
    if (savedTranscriptMemoryMode === 'some' && individualMemoryToggleStates && Object.values(individualMemoryToggleStates).some(v => v)) {
      return 'Some';
    }
    return 'None';
  };

  const getTranscriptListenModeText = () => {
    return transcriptListenMode.charAt(0).toUpperCase() + transcriptListenMode.slice(1);
  };

  const groupChatsByDate = (chats: ChatHistoryItem[]) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const thisWeekStart = new Date(today.getTime() - (today.getDay() * 24 * 60 * 60 * 1000));
    const lastWeekStart = new Date(thisWeekStart.getTime() - (7 * 24 * 60 * 60 * 1000));
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const groups: { [key: string]: ChatHistoryItem[] } = {};

    chats.forEach(chat => {
      const chatDate = new Date(chat.updatedAt);
      const chatDateOnly = new Date(chatDate.getFullYear(), chatDate.getMonth(), chatDate.getDate());

      if (chatDateOnly.getTime() === today.getTime()) {
        const label = t('sidebar.dateLabels.today');
        if (!groups[label]) groups[label] = [];
        groups[label].push(chat);
      } else if (chatDateOnly.getTime() === yesterday.getTime()) {
        const label = t('sidebar.dateLabels.yesterday');
        if (!groups[label]) groups[label] = [];
        groups[label].push(chat);
      } else if (chatDateOnly >= thisWeekStart) {
        const label = t('sidebar.dateLabels.thisWeek');
        if (!groups[label]) groups[label] = [];
        groups[label].push(chat);
      } else if (chatDateOnly >= lastWeekStart) {
        const label = t('sidebar.dateLabels.lastWeek');
        if (!groups[label]) groups[label] = [];
        groups[label].push(chat);
      } else if (chatDateOnly >= thisMonthStart) {
        const label = t('sidebar.dateLabels.thisMonth');
        if (!groups[label]) groups[label] = [];
        groups[label].push(chat);
      } else {
        const monthName = chatDate.toLocaleDateString(language === 'sv' ? 'sv-SE' : undefined, { month: 'long', year: 'numeric' });
        if (!groups[monthName]) groups[monthName] = [];
        groups[monthName].push(chat);
      }
    });

    return groups;
  };

  const groupByEvent = (chats: ChatHistoryItem[]) => {
    const groups: Record<string, ChatHistoryItem[]> = {};
    chats.forEach(c => {
      const ev = c.eventId || '0000';
      if (!groups[ev]) groups[ev] = [];
      groups[ev].push(c);
    });
    // Sort each group by updatedAt desc
    Object.keys(groups).forEach(ev => {
      groups[ev].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    });
    return groups;
  };

  const uniqueEvents = Array.from(new Set(chatHistory.map(c => c.eventId || '0000')));
  const hasOnlyShared = uniqueEvents.length <= 1 && uniqueEvents[0] === '0000';
  
  return (
    <div className={className}>
      {!isOpen && (
        <Button onClick={onOpen} variant="ghost" className="p-2 text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))] hover:bg-transparent transition-colors" aria-label="Open sidebar">
          {isMobile ? (
            <ChevronRight className="!h-7 !w-7" />
          ) : (
            <SidebarIcon className="!h-5 !w-5" />
          )}
        </Button>
      )}
      <Sheet modal={isMobile} open={isOpen} onOpenChange={(open) => {
        if (open) {
          onOpen();
        } else {
          if (isMobile) {
            onClose();
          }
        }
      }}>
        <SheetContent
          side="left"
          className={`p-4 sidebar-bg border-r-0 flex flex-col h-full ${isMobile ? 'w-[80vw]' : 'w-64'}`}
        >
          <div>
            <SheetHeader className="flex flex-row items-center justify-between -mt-2">
              <SheetTitle className="text-xl font-bold pl-2 mt-[10px]">River AI</SheetTitle>
              <Button onClick={onClose} variant="ghost" className="p-2 rounded-md text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))] hover:bg-transparent transition-colors">
                {isMobile ? (
                  <ChevronLeft className="!h-7 !w-7" />
                ) : (
                  <SidebarIcon className="!h-5 !w-5" />
                )}
              </Button>
            </SheetHeader>
            <div className="px-2 mt-2 mb-2">
              {/* Agent row - Hidden if workspace config specifies */}
              {(!activeUiConfig.hide_sidebar_info?.includes('agent') || isAdminOverride) && (
                <div className="text-xs text-muted-foreground">
                  Agent <span className="font-bold">{agentName || 'Loading...'}</span>
                </div>
              )}
              {/* Model row - Hidden if workspace config specifies */}
              {(!activeUiConfig.hide_sidebar_info?.includes('model') || isAdminOverride) && (
                <div className="text-xs text-muted-foreground">
                  Model <span className="font-bold">{(selectedModel && MODEL_DISPLAY_NAMES_MAP.get(selectedModel)) || selectedModel || 'Loading...'}</span>
                </div>
              )}
              {/* Transcript row - Hidden if workspace config specifies */}
              {(!activeUiConfig.hide_sidebar_info?.includes('transcript') || isAdminOverride) && (
                <div className="text-xs text-muted-foreground">
                  Transcript <span className="font-bold">{getTranscriptListenModeText()}</span>
                </div>
              )}
              {/* Summary row - Hidden if workspace config specifies */}
              {(!activeUiConfig.hide_sidebar_info?.includes('summary') || isAdminOverride) && (
                <div className="text-xs text-muted-foreground">
                  Summary <span className="font-bold">{getSummaryModeText()}</span>
                </div>
              )}
            </div>
            <div className="mt-10 flex flex-col space-y-1 -ml-2">
              <Button variant="ghost" className="justify-start rounded-xs" onClick={handleNewChat}>
                <SquarePen className="mr-3 h-5 w-5" />
                {t('sidebar.newChat')}
              </Button>
              {/* Top separator - Always visible after "New Chat" */}
              <Separator className="my-2 bg-border/50" />
              {/* === ALL UI VISIBILITY CONTROLLED BY SUPABASE WORKSPACE CONFIG === */}
              {/* NEVER hardcode UI logic - always check activeUiConfig from workspaces.ui_config */}
              {/* Chat link - Hidden if workspace config specifies */}
              {(!activeUiConfig.hide_sidebar_links?.includes('chat') || isAdminOverride) && (
                <Button variant="ghost" className="justify-start rounded-xs" onClick={() => handleNavigationClick('chat')}>
                  <MessageSquare className="mr-3 h-5 w-5" />
                  Chat
                </Button>
              )}
              {/* Record link - Hidden if workspace config specifies */}
              {(!activeUiConfig.hide_sidebar_links?.includes('record') || isAdminOverride) && (
                <Button variant="ghost" className="justify-start rounded-xs" onClick={() => handleNavigationClick('record')}>
                  <Disc className="mr-3 h-5 w-5" />
                  Record Note
                </Button>
              )}
              {/* Transcribe link - Hidden if workspace config specifies */}
              {(!activeUiConfig.hide_sidebar_links?.includes('transcribe') || isAdminOverride) && (
                <Button variant="ghost" className="justify-start rounded-xs" onClick={() => handleNavigationClick('transcribe')}>
                  <AudioLines className="mr-3 h-5 w-5" />
                  Transcribe
                </Button>
              )}
              {/* Bottom separator - Hidden if workspace config specifies */}
              {/* This separator only shows when at least one sidebar link is visible */}
              {(!activeUiConfig.hide_sidebar_separators || isAdminOverride) && (
                <Separator className="my-2 bg-border/50" />
              )}
              {/* Settings link - Hidden if workspace config specifies */}
              {(!activeUiConfig.hide_sidebar_links?.includes('settings') || isAdminOverride) && (
                <Button variant="ghost" className="justify-start rounded-xs" onClick={handleShowSettings}>
                  <Settings className="mr-3 h-5 w-5" />
                  Settings
                </Button>
              )}
            </div>
          </div>
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-2 pt-4 pb-4 text-sm opacity-50">
              {t('sidebar.chatHistory')}
            </div>
            {/* Toggle placed outside the scroll area so it persists while scrolling */}
            {(!hasOnlyShared && uniqueEvents.length > 1) && (
              <div className="px-2 pb-3 mb-1 flex items-center gap-3 text-xs">
                <button
                  className={cn(
                    flattenAll ? "text-foreground font-semibold" : "text-foreground/50 font-normal hover:text-foreground"
                  )}
                  onClick={() => setFlattenAll(true)}
                >
                  All chats
                </button>
                <span className="text-muted-foreground">|</span>
                <button
                  className={cn(
                    !flattenAll ? "text-foreground font-semibold" : "text-foreground/50 font-normal hover:text-foreground"
                  )}
                  onClick={() => setFlattenAll(false)}
                >
                  Grouped
                </button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto">
               {chatHistory.length > 0 ? (
                 <div className="space-y-2">

                   {/* Flat list mode */}
                   {((hasOnlyShared || flattenAll) && (
                     Object.entries(groupChatsByDate(chatHistory)).map(([section, chats]) => (
                         <div key={section}>
                           <div className="px-2 py-1 pb-2.5 text-xs text-muted-foreground opacity-50">{section}</div>
                           <div className="space-y-0.5">
                             {chats.map(chat => (
                             <div key={chat.id} className="group flex items-center justify-between w-full rounded-xs hover:bg-accent pr-2">
                               <Button variant="ghost" className="flex-grow justify-start text-left h-auto px-2 py-2 rounded-xs min-w-0 text-foreground group-hover:text-accent-foreground hover:!text-accent-foreground" onClick={() => handleLoadChat(chat.id)}>
                                 <div className="truncate">
                                   {chat.title}
                                 </div>
                               </Button>
                               <div className="flex-shrink-0 h-8 w-8 flex items-center justify-center relative">
                                 {(chat.isConversationSaved || chat.hasSavedMessages) && (
                                   <div className={cn("absolute h-2 w-2 rounded-full transition-opacity duration-200 group-hover:opacity-0", chat.isConversationSaved ? "bg-[hsl(var(--save-memory-color))]" : "border border-[hsl(var(--save-memory-color))]")}/>
                                 )}
                                 <Button variant="ghost" size="icon" className="absolute h-8 w-8 opacity-0 group-hover:opacity-100 text-foreground group-hover:text-accent-foreground hover:!text-accent-foreground" onClick={(e) => { e.stopPropagation(); onDeleteChat(chat.id); }}>
                                   <X className="h-4 w-4" />
                                 </Button>
                               </div>
                             </div>
                           ))}
                         </div>
                       </div>
                     ))
                   ))}

                   {/* Grouped by event */}
                   {(!hasOnlyShared && !flattenAll) && (
                     Object.entries(groupByEvent(chatHistory)).sort((a,b) => (a[0] === (currentEventId||'0000') ? -1 : b[0] === (currentEventId||'0000') ? 1 : a[0].localeCompare(b[0]))).map(([ev, chats]) => {
                       const expanded = expandedEvents[ev] ?? (ev === (currentEventId || '0000'));
                       const visibleCount = visibleCountByEvent[ev] ?? 20;
                       return (
                         <div key={ev} className={cn("mb-2") }>
                          <button
                            className={cn(
                              "group relative w-full flex items-center justify-between px-2 py-1.5 pr-12 text-sm rounded-xs",
                              expanded ? "bg-accent text-accent-foreground" : "bg-background hover:bg-accent/10"
                            )}
                             aria-expanded={expanded}
                             onClick={() => setEventExpanded(ev, !expanded)}
                           >
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              "font-medium truncate",
                              expanded ? "text-accent-foreground" : "text-muted-foreground"
                            )}>{eventLabel(ev)}</span>
                          </div>
                          <ChevronRight className={cn("absolute right-3 h-4 w-4 transition-transform", expanded && "rotate-90")} />
                           </button>
                           {expanded && (
                             <div className="space-y-0.5 px-0 pb-1">
                               {Object.entries(groupChatsByDate(chats)).map(([dateLabel, items]) => (
                                 <div key={dateLabel}>
                                   <div className="px-2 py-1 text-xs text-muted-foreground opacity-50">{dateLabel}</div>
                                   {items.slice(0, visibleCount).map(chat => (
                                     <div key={chat.id} className="group flex items-center justify-between w-full rounded-xs hover:bg-accent pr-2">
                                       <Button variant="ghost" className="flex-grow justify-start text-left h-auto px-2 py-2 rounded-xs min-w-0 text-foreground group-hover:text-accent-foreground hover:!text-accent-foreground" onClick={() => handleLoadChat(chat.id)}>
                                         <div className="truncate">{chat.title}</div>
                                       </Button>
                                       <div className="flex-shrink-0 h-8 w-8 flex items-center justify-center relative">
                                         {(chat.isConversationSaved || chat.hasSavedMessages) && (
                                           <div className={cn("absolute h-2 w-2 rounded-full transition-opacity duration-200 group-hover:opacity-0", chat.isConversationSaved ? "bg-[hsl(var(--save-memory-color))]" : "border border-[hsl(var(--save-memory-color))]")}/>
                                         )}
                                         <Button variant="ghost" size="icon" className="absolute h-8 w-8 opacity-0 group-hover:opacity-100 text-foreground group-hover:text-accent-foreground hover:!text-accent-foreground" onClick={(e) => { e.stopPropagation(); onDeleteChat(chat.id); }}>
                                           <X className="h-4 w-4" />
                                         </Button>
                                       </div>
                                     </div>
                                   ))}
                                 </div>
                               ))}
                               {chats.length > visibleCount && (
                                 <div className="px-1 pb-1">
                                   <Button variant="ghost" className="h-7 px-2 rounded-sm" onClick={() => setVisibleCountByEvent(prev => ({ ...prev, [ev]: prev[ev] + 20 }))}>Show more</Button>
                                 </div>
                               )}
                             </div>
                           )}
                         </div>
                       );
                     })
                   )}
                 </div>
               ) : null}
            </div>
          </div>
          <div className="mt-auto pt-4 border-t border-border/50 -mx-4 px-4">
            <Button variant="ghost" className="w-full justify-start rounded-xs" onClick={onLogout}>
              <LogOut className="mr-3 h-5 w-5" />
              {t('sidebar.logOut')}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default Sidebar;
