"use client"

import { useTheme } from "next-themes"
import { Moon, Sun } from "lucide-react"
import { useEffect, useState } from "react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // Ensure component is mounted to avoid hydration mismatch
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    // Return a placeholder or null to avoid rendering on the server
    // or during the initial client render before theme is known.
    // This helps prevent layout shifts or incorrect initial theme display.
    // A div with fixed dimensions can be used as a placeholder.
    return <div style={{ width: '88px', height: '36px' }} />; // Approx size of the sm toggle group with two items
  }

  const handleThemeChange = (value: string) => {
    if (value) { // Ensure a value is selected
      setTheme(value)
    }
  }

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
        size="sm" // Makes it h-9 px-2.5
        className={cn(
          "rounded-sm", // Ensures consistent rounding with TabsTrigger
          // Override default toggleVariants for on/off states to match TabsTrigger
          "data-[state=off]:bg-transparent data-[state=off]:text-muted-foreground data-[state=off]:shadow-none hover:data-[state=off]:bg-muted/50",
          "data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
        )}
      >
        <Sun className="h-4 w-4" />
        <span className="ml-2">Light</span>
      </ToggleGroupItem>
      <ToggleGroupItem
        value="dark"
        aria-label="Switch to dark mode"
        size="sm" // Makes it h-9 px-2.5
        className={cn(
          "rounded-sm", // Ensures consistent rounding with TabsTrigger
          // Override default toggleVariants for on/off states to match TabsTrigger
          "data-[state=off]:bg-transparent data-[state=off]:text-muted-foreground data-[state=off]:shadow-none hover:data-[state=off]:bg-muted/50",
          "data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
        )}
      >
        <Moon className="h-4 w-4" />
        <span className="ml-2">Dark</span>
      </ToggleGroupItem>
    </ToggleGroup>
  )
}