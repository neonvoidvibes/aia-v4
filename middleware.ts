import { createServerClient, type CookieOptions } from '@supabase/ssr' // Import createServerClient
import { NextResponse } from 'next/server'

import type { NextRequest } from 'next/server'
// import type { Database } from '@/types/supabase' // Keep commented out

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()

  // Create a Supabase client configured to use cookies accessible in middleware
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          // If the cookie is set, update the request cookies for the response.
          req.cookies.set({ name, value, ...options })
          // Also update the response cookies.
          res.cookies.set({ name, value, ...options })
        },
        remove(name: string, options: CookieOptions) {
          // If the cookie is removed, update the request cookies for the response.
          req.cookies.set({ name, value: '', ...options })
          // Also update the response cookies.
          res.cookies.set({ name, value: '', ...options })
        },
      },
    }
  )


  // Refresh session if expired - required for Server Components
  // https://supabase.com/docs/guides/auth/server-side/nextjs#managing-session-with-middleware-(app-router)
  const { data: { session } } = await supabase.auth.getSession()

  // Define public routes
  const publicRoutes = ['/login']; // Add any other public routes like /signup if needed

  // Protect routes: If no session and not on a public route, redirect to login
  if (!session && !publicRoutes.includes(req.nextUrl.pathname)) {
    const redirectUrl = req.nextUrl.clone()
    redirectUrl.pathname = '/login'
    redirectUrl.searchParams.set(`redirectedFrom`, req.nextUrl.pathname) // Optional: pass redirect info
    console.log("Middleware: No session, redirecting to /login from", req.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl)
  }

   // If there is a session and the user is on the login page, redirect to home
   if (session && req.nextUrl.pathname === '/login') {
     const redirectUrl = req.nextUrl.clone()
     redirectUrl.pathname = '/' // Redirect to home page or dashboard
     console.log("Middleware: Session exists, redirecting from /login to /");
     return NextResponse.redirect(redirectUrl)
   }

  return res
}

// Ensure the middleware is only called for relevant paths.
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|json)$).*)',
  ],
}
