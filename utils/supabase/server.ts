import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Used in Server Components, Server Actions, Route Handlers
export async function createServerActionClient() { // Add async
  const cookieStore = await cookies() // Add await
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options })
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: '', ...options })
        },
      },
    }
  )
}

// Used only in Route Handlers
export async function createRouteHandlerClient() { // Add async
   const cookieStore = await cookies() // Add await
   return createServerClient(
     process.env.NEXT_PUBLIC_SUPABASE_URL!,
     process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
     {
       cookies: {
         get(name: string) {
           return cookieStore.get(name)?.value
         },
         // Setting/removing cookies in Route Handlers is done via the response object,
         // so these server-side functions are intentionally limited.
         // See: https://supabase.com/docs/guides/auth/server-side/nextjs#route-handlers-session-management
         set(name: string, value: string, options: CookieOptions) {
            // Cannot set cookies directly in Route Handler context like this
            console.warn("Attempted to set cookie in Route Handler context. Use response object instead.");
         },
         remove(name: string, options: CookieOptions) {
            // Cannot remove cookies directly in Route Handler context like this
            console.warn("Attempted to remove cookie in Route Handler context. Use response object instead.");
         },
       },
     }
   )
 }

// Used only in Server Components
export async function createServerComponentClient() { // Add async
   const cookieStore = await cookies() // Add await
   return createServerClient(
     process.env.NEXT_PUBLIC_SUPABASE_URL!,
     process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
     {
       cookies: {
         get(name: string) {
           return cookieStore.get(name)?.value
         },
         // Server Components cannot set cookies, so these are intentionally omitted/no-op
         set(name: string, value: string, options: CookieOptions) {},
         remove(name: string, options: CookieOptions) {},
       },
     }
   )
}