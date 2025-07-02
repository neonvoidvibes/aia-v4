import React, { useState, useEffect } from 'react';
import { Button } from './button';
import { Separator } from './separator';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './sheet';
import { useIsMobile } from './use-mobile';
import { createClient } from '@/utils/supabase/client';
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
} from 'lucide-react';

interface ChatHistoryItem {
  id: string;
  title: string;
  updatedAt: string;
  agentId: string;
  agentName: string;
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
  className?: string;
  setCurrentView: (view: "chat" | "transcribe") => void;
  setShowSettings: (show: boolean) => void;
  agentName?: string;
  selectedModel?: string;
  onNewChat?: () => void;
  onLoadChat?: (chatId: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, onOpen, className, setCurrentView, setShowSettings, agentName, selectedModel, onNewChat, onLoadChat }) => {
  const isMobile = useIsMobile();
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const supabase = createClient();

  const fetchChatHistory = async () => {
    if (!agentName) return;
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const response = await fetch(`/api/chat/history/list?agent=${encodeURIComponent(agentName)}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        const history = await response.json();
        setChatHistory(history);
      }
    } catch (error) {
      console.error('Failed to fetch chat history:', error);
    }
  };

  useEffect(() => {
    if (isOpen && agentName) {
      fetchChatHistory();
    }
  }, [isOpen, agentName]);

  const handleLoadChat = (chatId: string) => {
    if (onLoadChat) {
      onLoadChat(chatId);
      onClose(); // Close sidebar on mobile after selecting chat
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
        <Button onClick={onOpen} variant="ghost" className="p-2">
          {isMobile ? (
            <ChevronRight className="!h-6 !w-6" />
          ) : (
            <SidebarIcon className="!h-5 !w-5" />
          )}
        </Button>
      )}
      <Sheet open={isOpen} onOpenChange={(open) => (open ? onOpen() : onClose())}>
        <SheetContent 
          side="left" 
          className={`p-4 sidebar-bg border-r-0 ${isMobile ? 'w-[80vw]' : 'w-64'}`}
        >
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
              Model <span className="font-bold">{selectedModel || 'Loading...'}</span>
            </div>
          </div>
          <div className="mt-10 flex flex-col space-y-1 -ml-2">
            <Button variant="ghost" className="justify-start rounded-md font-medium" onClick={onNewChat}>
              <SquarePen className="mr-3 h-5 w-5" />
              New Chat
            </Button>
            <Button variant="ghost" className="justify-start rounded-md font-medium" onClick={() => { setShowSettings(true); }}>
              <Settings className="mr-3 h-5 w-5" />
              Settings
            </Button>
            <Separator className="my-2 bg-border/50" />
            <Button variant="ghost" className="justify-start rounded-md font-medium" onClick={() => { setCurrentView('chat'); }}>
              <MessageSquare className="mr-3 h-5 w-5" />
              Chat
            </Button>
            <Button variant="ghost" className="justify-start rounded-md font-medium" onClick={() => { setCurrentView('transcribe'); }}>
              <AudioLines className="mr-3 h-5 w-5" />
              Transcribe
            </Button>
            <Separator className="my-2 bg-border/50" />
            <div className="px-4 pt-4 text-sm font-medium opacity-50">
              Chat History
            </div>
            <div className="flex-1 overflow-y-auto max-h-[300px]">
              {chatHistory.length > 0 ? (
                <div className="space-y-2">
                  {Object.entries(groupChatsByDate(chatHistory)).map(([section, chats]) => (
                    <div key={section}>
                      <div className="px-4 py-1 text-xs font-medium text-muted-foreground">
                        {section}
                      </div>
                      <div className="space-y-0.5">
                        {chats.map((chat) => (
                          <Button
                            key={chat.id}
                            variant="ghost"
                            className="w-full justify-start text-left h-auto px-4 py-2 rounded-sm hover:bg-accent/50"
                            onClick={() => handleLoadChat(chat.id)}
                          >
                            <div className="text-sm font-medium truncate w-full">
                              {chat.title}
                            </div>
                          </Button>
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
