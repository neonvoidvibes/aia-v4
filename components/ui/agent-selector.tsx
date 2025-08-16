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
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useTheme } from "next-themes";
import { predefinedThemes } from "@/lib/themes";
import { Palette } from "lucide-react";

interface AgentSelectorMenuProps {
  allowedAgents: string[];
  currentAgent: string;
}

const AgentSelectorMenu: React.FC<AgentSelectorMenuProps> = ({ allowedAgents, currentAgent }) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useMobile();
  const [isOpen, setIsOpen] = useState(false);
  const { theme, setTheme } = useTheme();

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
  
  // New handler for theme changes that persists the choice for the current agent
  const handleThemeChange = (newTheme: string) => {
    setTheme(newTheme);
    if (currentAgent) {
        const agentThemeKey = `agent-theme-${currentAgent}`;
        localStorage.setItem(agentThemeKey, newTheme);
        if (predefinedThemes.some(t => t.className === newTheme)) {
            localStorage.setItem(`agent-custom-theme-${currentAgent}`, newTheme);
        } else {
            localStorage.removeItem(`agent-custom-theme-${currentAgent}`);
        }
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
      <DropdownMenuContent align="center" className="max-h-80 overflow-y-auto">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette className="mr-2 h-4 w-4" />
            <span>Change Theme</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={theme} onValueChange={handleThemeChange}>
                <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
                <DropdownMenuSeparator />
                {predefinedThemes.map((customTheme) => (
                    <DropdownMenuRadioItem key={customTheme.className} value={customTheme.className}>
                        {customTheme.name}
                    </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
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
