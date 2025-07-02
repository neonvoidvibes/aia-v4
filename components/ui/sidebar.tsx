import React from 'react';
import { Button } from './button';
import { Separator } from './separator';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './sheet';
import { useIsMobile } from './use-mobile';
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
} from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
  className?: string;
  setCurrentView: (view: "chat" | "transcribe") => void;
  setShowSettings: (show: boolean) => void;
  agentName?: string;
  selectedModel?: string;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, onOpen, className, setCurrentView, setShowSettings, agentName, selectedModel }) => {
  const isMobile = useIsMobile();
  
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
            <Button variant="ghost" className="justify-start rounded-md font-medium">
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
              Saved Chats
            </div>
            {/* Placeholder for saved chats */}
            <div className="flex-grow" />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default Sidebar;
