'use client'

import Link from 'next/link'
import { FormEvent, useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

const resetRedirectBase = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')

export default function ForgotPasswordPage() {
  const supabase = useMemo(() => createClient(), [])
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'submitting' | 'sent'>('idle')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!email) {
      setError('Please enter the email associated with your account.')
      return
    }

    setStatus('submitting')
    setError(null)

    const redirectTo = resetRedirectBase ? `${resetRedirectBase}/reset-password` : undefined

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      redirectTo ? { redirectTo } : undefined
    )

    if (resetError) {
      console.error('Password reset request failed:', resetError)
      setStatus('idle')
      setError(resetError.message ?? 'Something went wrong. Please try again.')
      return
    }

    setStatus('sent')
    toast.success('Check your email for a password reset link.')
  }

  return (
    <div className="w-full flex items-center justify-center min-h-[calc(100dvh-var(--sys-banner-h))] bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Reset your password</CardTitle>
          <CardDescription>
            Enter the email you use to sign in. We&rsquo;ll send a secure link to create a new password.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status !== 'sent' ? (
            <form onSubmit={handleSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={status === 'submitting'}
                />
              </div>
              {error && <p className="text-sm text-red-600 dark:text-red-500">{error}</p>}
              <Button type="submit" className="w-full" disabled={status === 'submitting'}>
                {status === 'submitting' ? 'Sending reset link…' : 'Email me a reset link'}
              </Button>
            </form>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                If there&rsquo;s a matching account, you&rsquo;ll receive an email within a minute. The link expires
                shortly, so please use it right away.
              </p>
              <p className="text-sm text-muted-foreground">
                Didn&rsquo;t get an email? Check your spam folder or{' '}
                <button
                  type="button"
                  className="font-medium text-primary underline underline-offset-2"
                  onClick={() => {
                    setStatus('idle')
                    setEmail('')
                  }}
                >
                  try again
                </button>
                .
              </p>
            </div>
          )}
          <div className="text-center text-sm text-muted-foreground">
            Remember your password?{' '}
            <Link href="/login" className="underline hover:text-primary">
              Back to login
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
