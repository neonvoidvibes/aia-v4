"use client"

import { useTheme } from "next-themes"
import { Moon, Sun, Settings2, Palette } from "lucide-react"
import { useEffect, useState } from "react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import { useMobile } from "@/hooks/use-mobile"
import { predefinedThemes } from "@/lib/themes" // Import predefined themes
import { useSearchParams } from "next/navigation" // For agent name (simplified)

export function ThemeToggle() {
  const { theme, setTheme, themes: availableThemes } = useTheme()
  const [mounted, setMounted] = useState(false)
  const isMobile = useMobile()
  const searchParams = useSearchParams();
  const agentName = searchParams.get('agent');


  useEffect(() => {
    setMounted(true)
  }, [])

  const getAgentSpecificThemeKey = () => {
    if (!agentName) return null;
    try {
      const userId = localStorage.getItem('currentUserId');
      return userId ? `agent-theme-${agentName}_${userId}` : `agent-theme-${agentName}`; // fallback to legacy
    } catch {
      return `agent-theme-${agentName}`;
    }
  };

  const getAgentCustomThemeKey = () => {
    if (!agentName) return null;
    try {
      const userId = localStorage.getItem('currentUserId');
      return userId ? `agent-custom-theme-${agentName}_${userId}` : `agent-custom-theme-${agentName}`;
    } catch {
      return `agent-custom-theme-${agentName}`;
    }
  };

  const handleThemeChange = (value: string) => {
    if (value) {
      const agentThemeKey = getAgentSpecificThemeKey();
      if (value === "custom") {
        // When "Custom" is clicked, try to load the agent's last known custom theme
        const customKey = getAgentCustomThemeKey();
        const legacyCustomKey = agentName ? `agent-custom-theme-${agentName}` : null;
        let lastCustomThemeForAgent = customKey ? localStorage.getItem(customKey) : null;
        if (!lastCustomThemeForAgent && legacyCustomKey) {
          lastCustomThemeForAgent = localStorage.getItem(legacyCustomKey);
        }
        if (!lastCustomThemeForAgent || !predefinedThemes.find(t => t.className === lastCustomThemeForAgent)) {
          // Default to first predefined custom theme if none stored or invalid
          lastCustomThemeForAgent = predefinedThemes[0]?.className || 'dark'; // Fallback to dark if no custom
        }
        setTheme(lastCustomThemeForAgent);
        if (agentThemeKey) {
          localStorage.setItem(agentThemeKey, lastCustomThemeForAgent);
        }
        if (customKey) {
          localStorage.setItem(customKey, lastCustomThemeForAgent);
        }
      } else {
        setTheme(value);
        if (agentThemeKey) {
          localStorage.setItem(agentThemeKey, value);
          // If user explicitly selects light/dark/system, clear the specific "custom" preference for this agent
          const customKey = getAgentCustomThemeKey();
          if (customKey) localStorage.removeItem(customKey);
        }
      }
    }
  }

  if (!mounted) {
    return <div style={{ width: '164px', height: '44px' }} />;
  }

  // Determine the value for the ToggleGroup
  // If current theme is one of the custom themes, set ToggleGroup value to "custom"
  const isCurrentThemeCustom = predefinedThemes.some(t => t.className === theme);
  const toggleGroupValue = isCurrentThemeCustom ? "custom" : theme;

  const commonItemClass = cn(
    "rounded-sm",
    "data-[state=off]:bg-transparent data-[state=off]:text-muted-foreground data-[state=off]:shadow-none hover:data-[state=off]:bg-muted/50",
    "data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
  );

  return (
    <ToggleGroup
      type="single"
      value={toggleGroupValue}
      onValueChange={handleThemeChange}
      className="rounded-md bg-muted p-1"
      aria-label="Theme toggle"
    >
      <ToggleGroupItem value="light" aria-label="Switch to light mode" size="sm" className={commonItemClass}>
        <Sun className="h-4 w-4" />
        {!isMobile && <span className="ml-2">Light</span>}
      </ToggleGroupItem>
      <ToggleGroupItem value="dark" aria-label="Switch to dark mode" size="sm" className={commonItemClass}>
        <Moon className="h-4 w-4" />
        {!isMobile && <span className="ml-2">Dark</span>}
      </ToggleGroupItem>
      <ToggleGroupItem value="system" aria-label="Switch to system theme" size="sm" className={commonItemClass}>
        <Settings2 className="h-4 w-4" />
        {!isMobile && <span className="ml-2">System</span>}
      </ToggleGroupItem>
      <ToggleGroupItem value="custom" aria-label="Switch to custom theme" size="sm" className={commonItemClass}>
        <Palette className="h-4 w-4" />
        {!isMobile && <span className="ml-2">Custom</span>}
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
