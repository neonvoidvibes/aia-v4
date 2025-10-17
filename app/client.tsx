"use client"

import React, { useEffect } from "react"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner" // Import the Toaster
import { predefinedThemes } from "@/lib/themes" // Import predefined themes
import { LocalizationProvider } from "@/context/LocalizationContext"
import { TooltipProvider } from "@/components/ui/tooltip"
import ServiceBanner from "@/components/system/ServiceBanner"
import { DynamicStatusBar } from "@/components/DynamicStatusBar"

const allThemeNames = ["light", "dark", "system", ...predefinedThemes.map(t => t.className)];

export default function ClientLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  useEffect(() => {
    // Service banner height CSS variable (initial from env + optional ?banner= override)
    let active = process.env.NEXT_PUBLIC_SERVICE_BANNER === 'true'
    try {
      const params = new URLSearchParams(window.location.search)
      const ov = params.get('banner')?.toLowerCase()
      if (ov === '1' || ov === 'true') active = true
      if (ov === '0' || ov === 'false') active = false
    } catch {}
    try { document.documentElement.style.setProperty('--sys-banner-h', active ? '60px' : '0px') } catch {}

    // Poll runtime config to detect deployment/banner flips; reload when either changes.
    // Use event-driven checks (focus/visibility/online) and a long fallback interval.
    const state = { banner: active as boolean, buildId: '__init__' as string, timer: 0 as number }

    const schedule = (ms: number) => {
      if (state.timer) window.clearTimeout(state.timer)
      state.timer = window.setTimeout(check, Math.max(15000, ms)) // enforce sensible minimum
    }

    async function check() {
      try {
        const res = await fetch(`/api/runtime?t=${Date.now()}`, { cache: 'no-store' })
        const data = await res.json().catch(() => null)
        if (!data) { schedule(600000); return }

        const nextBanner = !!data.banner
        const nextBuild = String(data.buildId || '')
        // Align height immediately so layout is correct even before reload
        try { document.documentElement.style.setProperty('--sys-banner-h', nextBanner ? '60px' : '0px') } catch {}

        const buildChanged = state.buildId !== '__init__' && state.buildId !== nextBuild
        const bannerChanged = state.banner !== nextBanner
        state.banner = nextBanner
        state.buildId = nextBuild

        if (buildChanged) {
          try {
            if ('serviceWorker' in navigator) {
              const reg = await navigator.serviceWorker.getRegistration()
              await reg?.update()
              reg?.waiting?.postMessage?.({ type: 'SKIP_WAITING' })
            }
          } catch {}
          window.location.reload()
          return
        }

        // If only banner changed (no new build), do not reload; CSS var already applied.

        // Dynamic interval: if server provides, use it; otherwise use 10m when banner off, 15s when on
        const pollMs = (typeof data.pollMs === 'number' && Number.isFinite(data.pollMs))
          ? data.pollMs
          : (nextBanner ? 15000 : 600000)
        schedule(pollMs)
      } catch {
        // Backoff to a reasonable retry
        schedule(60000)
      }
    }

    // Event-driven triggers
    const trigger = () => { if (document.visibilityState === 'visible') { if (state.timer) window.clearTimeout(state.timer); check(); } }
    document.addEventListener('visibilitychange', trigger)
    window.addEventListener('focus', trigger)
    window.addEventListener('online', trigger)

    // Initial check and schedule next
    check()

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
    return () => {
      if (state.timer) window.clearTimeout(state.timer);
      document.removeEventListener('visibilitychange', trigger);
      window.removeEventListener('focus', trigger);
      window.removeEventListener('online', trigger);
    }
  }, []);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body>
        <ServiceBanner />
        <LocalizationProvider>
          <TooltipProvider delayDuration={100}>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem={true} // Enable system theme
              themes={allThemeNames} // Provide all available theme names
            >
              <DynamicStatusBar />
              <div id="app-content">{children}</div>
              <Toaster position="top-right" />
            </ThemeProvider>
          </TooltipProvider>
        </LocalizationProvider>
      </body>
    </html>
  )
}
