import React, { useState, useEffect } from 'react';
import { Button } from './button';
import { Separator } from './separator';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './sheet';
import { useIsMobile } from './use-mobile';
import { createClient } from '@/utils/supabase/client';
import { MODEL_DISPLAY_NAMES } from '@/lib/model-map';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from "sonner";

type View = "chat" | "transcribe" | "record" | "canvas";

interface ChatHistoryItem {
  id: string;
  title:string;
  updatedAt: string;
  agentId: string;
  agentName: string;
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
  selectedModel?: string;
  onNewChat?: () => void;
  onLoadChat?: (chatId: string) => void;
  currentChatId?: string;
  chatHistory: ChatHistoryItem[];
  isLoadingHistory: boolean;
  onDeleteChat: (chatId: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  onOpen,
  className,
  setCurrentView,
  setShowSettings,
  agentName,
  selectedModel,
  onNewChat,
  onLoadChat,
  currentChatId,
  chatHistory,
  isLoadingHistory,
  onDeleteChat
}) => {
  const isMobile = useIsMobile();

  const handleLoadChat = (chatId: string) => {
    if (onLoadChat) {
      onLoadChat(chatId);
      // Only close sidebar on mobile after selecting chat
      if (isMobile) {
        onClose();
      }
    }
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
        if (!groups['Today']) groups['Today'] = [];
        groups['Today'].push(chat);
      } else if (chatDateOnly.getTime() === yesterday.getTime()) {
        if (!groups['Yesterday']) groups['Yesterday'] = [];
        groups['Yesterday'].push(chat);
      } else if (chatDateOnly >= thisWeekStart) {
        if (!groups['This Week']) groups['This Week'] = [];
        groups['This Week'].push(chat);
      } else if (chatDateOnly >= lastWeekStart) {
        if (!groups['Last Week']) groups['Last Week'] = [];
        groups['Last Week'].push(chat);
      } else if (chatDateOnly >= thisMonthStart) {
        if (!groups['This Month']) groups['This Month'] = [];
        groups['This Month'].push(chat);
      } else {
        const monthName = chatDate.toLocaleDateString([], { month: 'long', year: 'numeric' });
        if (!groups[monthName]) groups[monthName] = [];
        groups[monthName].push(chat);
      }
    });

    return groups;
  };
  
  return (
    <div className={className}>
      {!isOpen && (
        <Button onClick={onOpen} variant="ghost" className="p-2 text-[hsl(var(--icon-secondary))] hover:text-[hsl(var(--icon-primary))] transition-colors">
          {isMobile ? (
            <ChevronRight className="!h-6 !w-6" />
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
              <Button onClick={onClose} variant="ghost" className="p-2 rounded-md">
                {isMobile ? (
                  <ChevronLeft className="!h-6 !w-6" />
                ) : (
                  <SidebarIcon className="!h-5 !w-5" />
                )}
              </Button>
            </SheetHeader>
            <div className="px-2 mt-2 mb-2">
              <div className="text-xs text-muted-foreground">
                Agent <span className="font-bold">{agentName || 'Loading...'}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                Model <span className="font-bold">{(selectedModel && MODEL_DISPLAY_NAMES[selectedModel]) || selectedModel || 'Loading...'}</span>
              </div>
            </div>
            <div className="mt-10 flex flex-col space-y-1 -ml-2">
              <Button variant="ghost" className="justify-start rounded-md" onClick={onNewChat}>
                <SquarePen className="mr-3 h-5 w-5" />
                New Chat
              </Button>
              <Separator className="my-2 bg-border/50" />
              <Button variant="ghost" className="justify-start rounded-md" onClick={() => { setCurrentView('chat'); }}>
                <MessageSquare className="mr-3 h-5 w-5" />
                Chat
              </Button>
              <Button variant="ghost" className="justify-start rounded-md" onClick={() => { setCurrentView('record'); }}>
                <Disc className="mr-3 h-5 w-5" />
                Record Note
              </Button>
              <Button variant="ghost" className="justify-start rounded-md" onClick={() => { setCurrentView('transcribe'); }}>
                <AudioLines className="mr-3 h-5 w-5" />
                Transcribe Document
              </Button>
              <Separator className="my-2 bg-border/50" />
              <Button variant="ghost" className="justify-start rounded-md" onClick={() => { setShowSettings(true); }}>
                <Settings className="mr-3 h-5 w-5" />
                Settings
              </Button>
            </div>
          </div>
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-2 pt-4 pb-4 text-sm opacity-50">
              Chat History
            </div>
            <div className="flex-1 overflow-y-auto">
              {chatHistory.length > 0 ? (
                <div className="space-y-2">
                  {Object.entries(groupChatsByDate(chatHistory)).map(([section, chats]) => (
                    <div key={section}>
                      <div className="px-2 py-1 pb-2.5 text-xs text-muted-foreground opacity-50">
                        {section}
                      </div>
                      <div className="space-y-0.5">
                        {chats.map((chat) => (
                          <div key={chat.id} className="group flex items-center justify-between w-full rounded-sm hover:bg-accent/50 pr-2">
                              <Button
                              variant="ghost"
                              className="flex-grow justify-start text-left h-auto px-2 py-2 rounded-sm min-w-0"
                              onClick={() => handleLoadChat(chat.id)}
                            >
                              <div className="truncate">
                                {chat.title}
                              </div>
                            </Button>
                            <div className="flex-shrink-0 h-8 w-8 flex items-center justify-center relative">
                              {(chat.isConversationSaved || chat.hasSavedMessages) && (
                                <div
                                  className={cn(
                                    "absolute h-2 w-2 rounded-full transition-opacity duration-200 group-hover:opacity-0",
                                    chat.isConversationSaved
                                      ? "bg-[hsl(var(--save-memory-color))]"
                                      : "border border-[hsl(var(--save-memory-color))]"
                                  )}
                                  style={{
                                    borderColor: chat.hasSavedMessages && !chat.isConversationSaved ? 'hsl(var(--save-memory-color))' : undefined,
                                  }}
                                />
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="absolute h-8 w-8 opacity-0 group-hover:opacity-100"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDeleteChat(chat.id);
                                }}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-2 text-sm text-muted-foreground">
                  No chat history yet
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default Sidebar;
