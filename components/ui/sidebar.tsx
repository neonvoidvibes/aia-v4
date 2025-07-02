import React from 'react';
import { Button } from './button';
import { Separator } from './separator';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './sheet';
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
} from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
  className?: string;
  setCurrentView: (view: "chat" | "transcribe") => void;
  setShowSettings: (show: boolean) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, onOpen, className, setCurrentView, setShowSettings }) => {
  return (
    <div className={className}>
      {!isOpen && (
        <Button onClick={onOpen} variant="ghost" className="p-2">
          <SidebarIcon className="h-6 w-6" />
        </Button>
      )}
      <Sheet open={isOpen} onOpenChange={(open) => (open ? onOpen() : onClose())}>
        <SheetContent side="left" className="w-64 p-4 sidebar-bg border-r-0">
          <SheetHeader className="flex flex-row items-center justify-between -mt-2">
            <SheetTitle className="text-lg font-semibold pl-3 mt-[5px]">AIA</SheetTitle>
            <Button onClick={onClose} variant="ghost" className="p-2 rounded-lg">
              <SidebarIcon className="h-6 w-6" />
            </Button>
          </SheetHeader>
          <div className="mt-4 flex flex-col space-y-1 -ml-2">
            <Button variant="ghost" className="justify-start rounded-lg">
              <SquarePen className="mr-3 h-5 w-5" />
              New Chat
            </Button>
            <Button variant="ghost" className="justify-start rounded-lg" onClick={() => { setShowSettings(true); }}>
              <Settings className="mr-3 h-5 w-5" />
              Settings
            </Button>
            <Separator className="my-2 bg-border/50" />
            <Button variant="ghost" className="justify-start rounded-lg" onClick={() => { setCurrentView('chat'); }}>
              <MessageSquare className="mr-3 h-5 w-5" />
              Chat
            </Button>
            <Button variant="ghost" className="justify-start rounded-lg" onClick={() => { setCurrentView('transcribe'); }}>
              <Waves className="mr-3 h-5 w-5" />
              Transcribe
            </Button>
            <Separator className="my-2 bg-border/50" />
            <div className="px-3 pt-4 text-sm font-medium text-muted-foreground/20">
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
