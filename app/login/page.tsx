'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation' // Use next/navigation for App Router
import { createClient } from '@/utils/supabase/client' // Import the browser client
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient() // Create Supabase client instance

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setLoading(true)

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setLoading(false)

    if (signInError) {
      console.error('Login error:', signInError.message)
      setError(signInError.message) // Display error to user
    } else {
      // Login successful
      console.log('Login successful, redirecting...')
      // Refresh the page to let middleware handle redirection
      // Or redirect manually if needed, but middleware should catch it
      router.refresh() // This re-fetches server components and runs middleware
      // router.push('/') // Alternative manual redirect
    }
  }

  return (
    <div className="w-full flex items-center justify-center min-h-screen bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Login</CardTitle>
          <CardDescription>Enter your email below to login to your account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="m@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            {error && (
              <p className="text-sm text-red-600 dark:text-red-500">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Logging in...' : 'Login'}
            </Button>
          </form>
          {/* Optional: Add links for password reset or sign up if enabled */}
          {/* <div className="mt-4 text-center text-sm">
            Don't have an account?{' '}
            <a href="#" className="underline">
              Sign up
            </a>
          </div> */}
        </CardContent>
      </Card>
    </div>
  )
}