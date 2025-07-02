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
      <Button onClick={onOpen} variant="ghost" className="p-2">
        <SidebarIcon className="h-6 w-6" />
      </Button>
      <Sheet open={isOpen} onOpenChange={(open) => (open ? onOpen() : onClose())}>
        <SheetContent side="left" className="w-64 bg-background/95 p-4">
          <SheetHeader className="flex flex-row items-center justify-between">
            <SheetTitle className="text-lg font-semibold">AIA</SheetTitle>
            <Button onClick={onClose} variant="ghost" className="p-2">
              <X className="h-5 w-5 text-muted-foreground" />
            </Button>
          </SheetHeader>
          <div className="mt-8 flex flex-col space-y-4">
            <Button variant="ghost" className="justify-start">
              <PlusSquare className="mr-3 h-5 w-5" />
              New Chat
            </Button>
            <Button variant="ghost" className="justify-start" onClick={() => { setShowSettings(true); onClose(); }}>
              <Settings className="mr-3 h-5 w-5" />
              Settings
            </Button>
            <Separator className="my-2" />
            <Button variant="ghost" className="justify-start" onClick={() => { setCurrentView('chat'); onClose(); }}>
              <MessageCircle className="mr-3 h-5 w-5" />
              Chat
            </Button>
            <Button variant="ghost" className="justify-start" onClick={() => { setCurrentView('transcribe'); onClose(); }}>
              <Waves className="mr-3 h-5 w-5" />
              Transcribe
            </Button>
            <Separator className="my-2" />
            <div className="px-3 text-sm font-medium text-muted-foreground">
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
