"use client"

import { useEffect } from "react"
import { useTheme } from "next-themes"
import { predefinedThemes } from "@/lib/themes"

/**
 * DynamicStatusBar component
 *
 * Dynamically updates the apple-mobile-web-app-status-bar-style meta tag
 * based on the current theme's isDark property.
 *
 * - For dark themes (isDark: true): Uses "black" (white text/icons)
 * - For light themes (isDark: false): Uses "default" (black text/icons)
 * - For system/dark/light themes: Uses appropriate style based on theme name
 */
export function DynamicStatusBar() {
  const { theme, resolvedTheme } = useTheme()

  useEffect(() => {
    // Find the meta tag
    let metaTag = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')

    if (!metaTag) {
      // Create it if it doesn't exist
      metaTag = document.createElement('meta')
      metaTag.setAttribute('name', 'apple-mobile-web-app-status-bar-style')
      document.head.appendChild(metaTag)
    }

    // Determine the status bar style based on current theme
    let statusBarStyle = "black-translucent" // default fallback

    // Check if current theme is a custom theme
    const currentTheme = predefinedThemes.find(t => t.className === theme)

    if (currentTheme) {
      // Use isDark property from the theme definition
      statusBarStyle = currentTheme.isDark ? "black" : "default"
    } else {
      // Handle built-in themes (light, dark, system)
      if (theme === "light") {
        statusBarStyle = "default"
      } else if (theme === "dark") {
        statusBarStyle = "black"
      } else if (theme === "system") {
        // For system theme, use resolvedTheme to determine actual appearance
        statusBarStyle = resolvedTheme === "dark" ? "black" : "default"
      }
    }

    metaTag.setAttribute('content', statusBarStyle)
  }, [theme, resolvedTheme])

  return null // This component doesn't render anything
}
