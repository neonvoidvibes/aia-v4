"use client"

import React, { useEffect } from "react"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner" // Import the Toaster
import { predefinedThemes } from "@/lib/themes" // Import predefined themes

const allThemeNames = ["light", "dark", "system", ...predefinedThemes.map(t => t.className)];

export default function ClientLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then(registration => console.log('scope is: ', registration.scope))
    }
  }, [])

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={true} // Enable system theme
          themes={allThemeNames} // Provide all available theme names
        >
          {children}
          <Toaster position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  )
}
