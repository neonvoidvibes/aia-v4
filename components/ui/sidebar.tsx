import React, { useState, useEffect } from 'react';
import { Button } from './button';
import { Separator } from './separator';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './sheet';
import { useIsMobile } from './use-mobile';
import { createClient } from '@/utils/supabase/client';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  onLoadChat?: (chatId: string, isSaved?: boolean) => void;
  currentChatId?: string;
  historyNeedsRefresh?: boolean;
  onHistoryRefreshed?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, onOpen, className, setCurrentView, setShowSettings, agentName, selectedModel, onNewChat, onLoadChat, currentChatId, historyNeedsRefresh, onHistoryRefreshed }) => {
  const isMobile = useIsMobile();
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [chatIdToDelete, setChatIdToDelete] = useState<string | null>(null);
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

  const handleDeleteInitiated = (chatId: string) => {
    setChatIdToDelete(chatId);
    setShowDeleteConfirmation(true);
  };

  const handleDeleteConfirm = async () => {
    if (!chatIdToDelete) return;

    const originalChatHistory = [...chatHistory];
    const chatToDelete = chatHistory.find(chat => chat.id === chatIdToDelete);
    const isDeletingCurrentChat = chatIdToDelete === currentChatId;

    // Optimistically remove the chat from the UI
    setChatHistory(prev => prev.filter(chat => chat.id !== chatIdToDelete));
    
    // If the deleted chat is the currently active chat, start a new chat instantly
    if (isDeletingCurrentChat && onNewChat) {
        onNewChat();
    }
    setShowDeleteConfirmation(false);

    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
            throw new Error("Authentication error. Cannot delete chat.");
        }

        const response = await fetch(`/api/chat/history/delete`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ chatId: chatIdToDelete }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: "Failed to delete chat history" }));
            throw new Error(errorData.error);
        }

        toast.success("Conversation deleted.");

    } catch (error: any) {
        console.error('Failed to delete chat history:', error);
        toast.error(`Failed to delete conversation: ${error.message}. Restoring.`);
        // Rollback UI on failure
        setChatHistory(originalChatHistory);
        // If deletion of the current chat fails, reload it.
        if (isDeletingCurrentChat && onLoadChat && chatToDelete) {
          onLoadChat(chatToDelete.id, chatToDelete.isConversationSaved);
        }
    } finally {
        setChatIdToDelete(null);
    }
  };

  useEffect(() => {
    if (isOpen && agentName) {
      fetchChatHistory();
    }
  }, [isOpen, agentName]);

  useEffect(() => {
    if (historyNeedsRefresh && agentName) {
      fetchChatHistory().then(() => {
        if (onHistoryRefreshed) {
          onHistoryRefreshed();
        }
      });
    }
  }, [historyNeedsRefresh, agentName, onHistoryRefreshed]);

  const handleLoadChat = (chatId: string, isSaved?: boolean) => {
    if (onLoadChat) {
      onLoadChat(chatId, isSaved);
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
        <Button onClick={onOpen} variant="ghost" className="p-2">
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
            <Separator className="my-2 bg-border/50" />
            <Button variant="ghost" className="justify-start rounded-md font-medium" onClick={() => { setCurrentView('chat'); }}>
              <MessageSquare className="mr-3 h-5 w-5" />
              Chat
            </Button>
            <Button variant="ghost" className="justify-start rounded-md font-medium" onClick={() => { setCurrentView('record'); }}>
              <Disc className="mr-3 h-5 w-5" />
              Record Note
            </Button>
            <Button variant="ghost" className="justify-start rounded-md font-medium" onClick={() => { setCurrentView('transcribe'); }}>
              <AudioLines className="mr-3 h-5 w-5" />
              Transcribe Document
            </Button>
            <Separator className="my-2 bg-border/50" />
            <Button variant="ghost" className="justify-start rounded-md font-medium" onClick={() => { setShowSettings(true); }}>
              <Settings className="mr-3 h-5 w-5" />
              Settings
            </Button>
            <Separator className="my-2 bg-border/50" />
            <div className="px-4 pt-4 pb-4 text-sm font-medium opacity-50">
              Chat History
            </div>
            <div className="flex-1 overflow-y-auto max-h-[300px]">
              {chatHistory.length > 0 ? (
                <div className="space-y-2">
                  {Object.entries(groupChatsByDate(chatHistory)).map(([section, chats]) => (
                    <div key={section}>
                      <div className="px-4 py-1 pb-2.5 text-xs font-medium text-muted-foreground opacity-50">
                        {section}
                      </div>
                      <div className="space-y-0.5">
                        {chats.map((chat) => (
                          <div key={chat.id} className="group flex items-center justify-between w-full rounded-sm hover:bg-accent/50 pr-2">
                            <Button
                              variant="ghost"
                              className="flex-grow justify-start text-left h-auto px-4 py-2 rounded-sm min-w-0"
                              onClick={() => handleLoadChat(chat.id, chat.isConversationSaved)}
                            >
                              <div className="text-sm font-medium truncate">
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
                                  handleDeleteInitiated(chat.id);
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
          <AlertDialog open={showDeleteConfirmation} onOpenChange={setShowDeleteConfirmation}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete the chat history. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteConfirm}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default Sidebar;
