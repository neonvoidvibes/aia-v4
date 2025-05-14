"use client"

import { useTheme } from "next-themes"
import { Moon, Sun, Settings2, Palette } from "lucide-react" // Added Settings2 and Palette
import { useEffect, useState } from "react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import { useMobile } from "@/hooks/use-mobile" // Import useMobile

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const isMobile = useMobile() // Use the hook

  // Ensure component is mounted to avoid hydration mismatch
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    // Adjusted placeholder size for four items
    return <div style={{ width: '164px', height: '44px' }} />; 
  }

  const handleThemeChange = (value: string) => {
    if (value) { // Ensure a value is selected
      // For "custom", we might not want to call setTheme yet if it's a placeholder
      // For now, we'll allow it to be set, next-themes will fallback if 'custom' is not a real theme.
      setTheme(value)
    }
  }

  const commonItemClass = cn(
    "rounded-sm",
    "data-[state=off]:bg-transparent data-[state=off]:text-muted-foreground data-[state=off]:shadow-none hover:data-[state=off]:bg-muted/50",
    "data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
  );

  return (
    <ToggleGroup
      type="single"
      value={theme}
      onValueChange={handleThemeChange}
      className="rounded-md bg-muted p-1"
      aria-label="Theme toggle"
    >
      <ToggleGroupItem
        value="light"
        aria-label="Switch to light mode"
        size="sm"
        className={commonItemClass}
      >
        <Sun className="h-4 w-4" />
        {!isMobile && <span className="ml-2">Light</span>}
      </ToggleGroupItem>
      <ToggleGroupItem
        value="dark"
        aria-label="Switch to dark mode"
        size="sm"
        className={commonItemClass}
      >
        <Moon className="h-4 w-4" />
        {!isMobile && <span className="ml-2">Dark</span>}
      </ToggleGroupItem>
      <ToggleGroupItem
        value="system"
        aria-label="Switch to system theme"
        size="sm"
        className={commonItemClass}
      >
        <Settings2 className="h-4 w-4" />
        {!isMobile && <span className="ml-2">System</span>}
      </ToggleGroupItem>
      <ToggleGroupItem
        value="custom" // Placeholder for future custom theme
        aria-label="Switch to custom theme"
        size="sm"
        className={commonItemClass}
        // Potentially disable if not implemented: disabled={true} 
      >
        <Palette className="h-4 w-4" />
        {!isMobile && <span className="ml-2">Custom</span>}
      </ToggleGroupItem>
    </ToggleGroup>
  )
}