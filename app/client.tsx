"use client"

import type React from "react"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner" // Import the Toaster
import { predefinedThemes } from "@/lib/themes" // Import predefined themes

const allThemeNames = ["light", "dark", "system", ...predefinedThemes.map(t => t.className)];

export default function ClientLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
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
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}