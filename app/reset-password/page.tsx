'use client'

import Link from 'next/link'
import { Suspense, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

type RecoveryStatus = 'checking' | 'ready' | 'error'

function PageLayout({ children }: { children: ReactNode }) {
  return (
    <div className="w-full flex items-center justify-center min-h-[calc(100dvh-var(--sys-banner-h))] bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Choose a new password</CardTitle>
          <CardDescription>
            Your new password must be at least 8 characters. Use something secure and easy for you to remember.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
      </Card>
    </div>
  )
}

function ResetPasswordPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])

  const code = searchParams.get('code')
  const accessToken = searchParams.get('access_token')
  const refreshToken = searchParams.get('refresh_token')
  const errorDescription = searchParams.get('error_description')

  const [status, setStatus] = useState<RecoveryStatus>('checking')
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    let isMounted = true

    const handleRecovery = async () => {
      if (errorDescription) {
        if (!isMounted) return
        setVerifyError(decodeURIComponent(errorDescription))
        setStatus('error')
        return
      }

      if (!code && (!accessToken || !refreshToken)) {
        if (!isMounted) return
        setVerifyError('This reset link is invalid or has expired. Please request a new one.')
        setStatus('error')
        return
      }

      try {
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) throw error
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
          if (error) throw error
        }

        if (!isMounted) {
          return
        }

        setStatus('ready')
      } catch (error) {
        console.error('Password recovery token exchange failed:', error)
        if (!isMounted) return
        setVerifyError('We couldn’t validate that reset link. Please request a new one.')
        setStatus('error')
      }
    }

    handleRecovery()

    return () => {
      isMounted = false
    }
  }, [accessToken, code, errorDescription, refreshToken, supabase])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!password || !confirmPassword) {
      setFormError('Please enter and confirm your new password.')
      return
    }

    if (password !== confirmPassword) {
      setFormError('Passwords do not match. Please try again.')
      return
    }

    setFormError(null)
    setIsSubmitting(true)

    try {
      const { error } = await supabase.auth.updateUser({ password })

      if (error) {
        throw error
      }

      toast.success('Your password has been updated. You can sign in with it now.')
      router.push('/login')
    } catch (error: any) {
      console.error('Failed to update password:', error)
      setFormError(error?.message ?? 'Could not update your password. Please try again.')
      setIsSubmitting(false)
    }
  }

  return (
    <PageLayout>
      {status === 'checking' && (
        <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Verifying your reset link…
        </div>
      )}

      {status === 'error' && (
        <div className="space-y-4">
          <p className="text-sm text-red-600 dark:text-red-500">{verifyError}</p>
          <div className="text-center text-sm text-muted-foreground">
            <Link href="/forgot-password" className="underline hover:text-primary">
              Request a new reset link
            </Link>
          </div>
        </div>
      )}

      {status === 'ready' && (
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isSubmitting}
              minLength={8}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirm-password">Confirm password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={isSubmitting}
              minLength={8}
            />
          </div>
          {formError && <p className="text-sm text-red-600 dark:text-red-500">{formError}</p>}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Updating password…' : 'Update password'}
          </Button>
        </form>
      )}

      <div className="text-center text-sm text-muted-foreground">
        Remembered your password?{' '}
        <Link href="/login" className="underline hover:text-primary">
          Back to login
        </Link>
      </div>
    </PageLayout>
  )
}

function ResetPasswordFallback() {
  return (
    <PageLayout>
      <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading reset form…
      </div>
    </PageLayout>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordFallback />}>
      <ResetPasswordPageInner />
    </Suspense>
  )
}
