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
        .then(registration => console.log('scope is: ', registration.scope));
    }

    const lockOrientation = async () => {
      if (window.screen.orientation && window.screen.orientation.lock) {
        try {
          await window.screen.orientation.lock('portrait-primary');
        } catch (error) {
          console.error('Failed to lock screen orientation:', error);
        }
      }
    };

    lockOrientation();
  }, []);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={true} // Enable system theme
          themes={allThemeNames} // Provide all available theme names
        >
          <div id="app-content">{children}</div>
          <div id="orientation-lock-overlay">
            <p>Please rotate your device to portrait mode.</p>
          </div>
          <Toaster position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  )
}
