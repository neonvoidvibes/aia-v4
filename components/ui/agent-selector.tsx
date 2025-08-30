"use client"

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMobile } from '@/hooks/use-mobile';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuItem,
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
import { manager } from "@/lib/recordingManager";
import { isRecordingPersistenceEnabled } from "@/lib/featureFlags";
import { AlertDialogConfirm } from "@/components/ui/alert-dialog-confirm";
import { useLocalization } from '@/context/LocalizationContext';

interface AgentSelectorMenuProps {
  allowedAgents: string[];
  currentAgent: string;
  userRole?: string | null;
  onDashboardClick?: () => void;
}

const AgentSelectorMenu: React.FC<AgentSelectorMenuProps> = ({ allowedAgents, currentAgent, userRole, onDashboardClick }) => {
  const { t } = useLocalization();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useMobile();
  const [isOpen, setIsOpen] = useState(false);
  const [pendingAgent, setPendingAgent] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
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

  const proceedToAgent = (newAgent: string) => {
    // Force close menu first to prevent state issues
    setIsOpen(false);
    // Use setTimeout to ensure state update completes before navigation
    setTimeout(() => {
      const currentParams = new URLSearchParams(searchParams.toString());
      currentParams.set('agent', newAgent);
      router.push(`/?${currentParams.toString()}`);
    }, 0);
  };

  const handleAgentChange = (newAgent: string) => {
    if (!newAgent || newAgent === currentAgent) return;
    if (isRecordingPersistenceEnabled()) {
      const st = manager.getState();
      const active = st.sessionId && (st.phase === 'starting' || st.phase === 'active' || st.phase === 'suspended');
      if (active) {
        setPendingAgent(newAgent);
        setShowConfirm(true);
        return;
      }
    }
    proceedToAgent(newAgent);
  };
  
  const handleThemeChange = (newTheme: string) => {
    setTheme(newTheme);
    if (currentAgent) {
      try {
        const userId = localStorage.getItem('currentUserId');
        const agentThemeKey = userId ? `agent-theme-${currentAgent}_${userId}` : `agent-theme-${currentAgent}`;
        const customKey = userId ? `agent-custom-theme-${currentAgent}_${userId}` : `agent-custom-theme-${currentAgent}`;
        localStorage.setItem(agentThemeKey, newTheme);
        if (predefinedThemes.some(t => t.className === newTheme)) {
          localStorage.setItem(customKey, newTheme);
        } else {
          localStorage.removeItem(customKey);
        }
      } catch {}
    }
  };

  const onThemeSelect = (value: string) => {
    handleThemeChange(value);
    if (isMobile) setIsThemeOpen(false);
  };

  const triggerButton = (
    <Button variant="ghost" className="h-auto p-0 text-sm font-medium text-foreground opacity-50 hover:opacity-100 focus:ring-0 hover:bg-transparent">
      {currentAgent}
    </Button>
  );

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
      <DropdownMenuContent
        ref={contentRef}
        align="center"
        className="max-h-64 overflow-y-auto"
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
        {(userRole === 'admin' || userRole === 'super user') && (
            <>
              <DropdownMenuItem onSelect={onDashboardClick} className="cursor-pointer font-semibold bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] focus:bg-[hsl(var(--accent))] focus:text-[hsl(var(--accent-foreground))]">
                Agent Dashboard
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
        )}
        <DropdownMenuRadioGroup value={currentAgent} onValueChange={handleAgentChange}>
          {allowedAgents.sort().map((agent) => (
            <DropdownMenuRadioItem key={agent} value={agent} className="pr-8">
              {agent}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
      <AlertDialogConfirm
        isOpen={showConfirm}
        onClose={() => { setShowConfirm(false); setPendingAgent(null); }}
        onConfirm={async () => {
          setShowConfirm(false);
          const st = manager.getState();
          if (st.sessionId) {
            try { await manager.stop(); } catch {}
          }
          if (pendingAgent) proceedToAgent(pendingAgent);
          setPendingAgent(null);
        }}
        title={t('confirmations.switchAgentWhileRecording.title')}
        message={t('confirmations.switchAgentWhileRecording.message')}
        confirmText={t('confirmations.switchAgentWhileRecording.confirm')}
        cancelText={t('confirmations.switchAgentWhileRecording.cancel')}
        confirmVariant="destructive"
      />
    </DropdownMenu>
  );
};

export default AgentSelectorMenu;
