"use client"

import React, { useState, useEffect, useRef } from 'react';
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
import { cn } from "@/lib/utils";

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

  const [isThemeOpen, setIsThemeOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isMobile) return;
    const el = contentRef.current;
    if (!el) return;
    if (isThemeOpen) {
      el.dataset.prevOverflow = el.style.overflowY || "";
      el.style.overflowY = "hidden";
      // prevent iOS momentum scroll
      const prevent = (e: TouchEvent) => e.preventDefault();
      el.addEventListener("touchmove", prevent, { passive: false });
      return () => {
        el.style.overflowY = el.dataset.prevOverflow || "";
        el.removeEventListener("touchmove", prevent);
      };
    }
  }, [isMobile, isThemeOpen]);

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

  const onThemeSelect = (value: string) => {
    handleThemeChange(value);
    if (isMobile) setIsThemeOpen(false);
  };

  const triggerButton = (
    <Button variant="ghost" className="h-auto p-0 text-sm font-medium text-foreground opacity-50 hover:opacity-100 focus:ring-0">
      {currentAgent}
    </Button>
  );

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
      <DropdownMenuContent
        ref={contentRef}
        align="center"
        className="max-h-80 overflow-y-auto"
      >
        <DropdownMenuSub
          open={isMobile ? isThemeOpen : undefined}
          onOpenChange={(open) => {
            if (isMobile) setIsThemeOpen(open);
          }}
        >
          <DropdownMenuSubTrigger
            onClick={(e) => {
              if (!isMobile) return;
              e.preventDefault();
              setIsThemeOpen((v) => !v);
            }}
          >
            <Palette className="mr-2 h-4 w-4" />
            <span>Change Theme</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={theme} onValueChange={onThemeSelect}>
                <DropdownMenuRadioItem value="light" onSelect={(e) => e.preventDefault()}>Light</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark" onSelect={(e) => e.preventDefault()}>Dark</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system" onSelect={(e) => e.preventDefault()}>System</DropdownMenuRadioItem>
                <DropdownMenuSeparator />
                {predefinedThemes.map((customTheme) => {
                  const themeGroupSeparators = new Set([
                    'theme-midnight-monochrome',
                    'theme-river',
                    'theme-forest-deep',
                  ]);
                  return (
                    <React.Fragment key={customTheme.className}>
                      {themeGroupSeparators.has(customTheme.className) && <DropdownMenuSeparator />}
                      <DropdownMenuRadioItem value={customTheme.className} onSelect={(e) => e.preventDefault()}>
                        {customTheme.name}
                      </DropdownMenuRadioItem>
                    </React.Fragment>
                  );
                })}
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
