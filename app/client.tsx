"use client"

import React, { useEffect } from "react"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner" // Import the Toaster
import { predefinedThemes } from "@/lib/themes" // Import predefined themes
import { LocalizationProvider } from "@/context/LocalizationContext"
import { TooltipProvider } from "@/components/ui/tooltip"

const allThemeNames = ["light", "dark", "system", ...predefinedThemes.map(t => t.className)];

export default function ClientLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  useEffect(() => {
    // --- SERVICE WORKER REGISTRATION GATE ---
    // PWA functionality is temporarily disabled via an environment variable
    // to resolve a critical caching issue with a previous faulty service worker.
    // The deployed sw.js is a "kill-switch" that will unregister itself.
    // To re-enable PWA features:
    // 1. Create a new, correctly implemented service worker.
    // 2. Set NEXT_PUBLIC_ENABLE_SW=true in your environment variables.
    if (process.env.NEXT_PUBLIC_ENABLE_SW === 'true' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then(registration => console.log('SW registered: ', registration.scope))
        .catch(error => console.log('SW registration failed: ', error));
    } else {
      console.log('Service Worker registration is intentionally disabled.');
    }

    // const lockOrientation = async () => {
    //   if (window.screen.orientation && window.screen.orientation.lock) {
    //     try {
    //       await window.screen.orientation.lock('portrait-primary');
    //     } catch (error) {
    //       console.error('Failed to lock screen orientation:', error);
    //     }
    //   }
    // };

    // lockOrientation();
  }, []);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body>
        <LocalizationProvider>
          <TooltipProvider delayDuration={100}>
            <ThemeProvider
              attribute="class"
              defaultTheme="dark"
              enableSystem={true} // Enable system theme
              themes={allThemeNames} // Provide all available theme names
            >
              <div id="app-content">{children}</div>
              <Toaster position="top-right" />
            </ThemeProvider>
          </TooltipProvider>
        </LocalizationProvider>
      </body>
    </html>
  )
}
