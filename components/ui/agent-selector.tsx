"use client"

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMobile } from '@/hooks/use-mobile';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

interface AgentSelectorMenuProps {
  allowedAgents: string[];
  currentAgent: string;
}

const AgentSelectorMenu: React.FC<AgentSelectorMenuProps> = ({ allowedAgents, currentAgent }) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useMobile();
  const [isOpen, setIsOpen] = useState(false);

  // Force re-render when mobile state changes to prevent stale UI
  useEffect(() => {
    if (isOpen) {
      setIsOpen(false);
    }
  }, [isMobile]);

  const handleAgentChange = (newAgent: string) => {
    if (newAgent && newAgent !== currentAgent) {
      // Force close menu first to prevent state issues
      setIsOpen(false);
      
      // Use setTimeout to ensure state update completes before navigation
      setTimeout(() => {
        const currentParams = new URLSearchParams(searchParams.toString());
        currentParams.set('agent', newAgent);
        router.push(`/?${currentParams.toString()}`);
      }, 0);
    }
  };

  const triggerButton = (
    <Button variant="ghost" className="h-auto p-0 text-sm font-medium text-foreground opacity-50 hover:opacity-100 focus:ring-0">
      {currentAgent}
    </Button>
  );

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="max-h-60 overflow-y-auto">
        <DropdownMenuRadioGroup value={currentAgent} onValueChange={handleAgentChange}>
          {allowedAgents.sort().map((agent) => (
            <DropdownMenuRadioItem key={agent} value={agent} className="pr-8">
              {agent}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default AgentSelectorMenu;
