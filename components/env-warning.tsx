"use client"

import { useEffect, useState } from "react"
import { AlertCircle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

export function EnvWarning() {
  const [showWarning, setShowWarning] = useState(false)

  useEffect(() => {
    // This is a client-side check to see if the user has been prompted
    // to set up their environment variables
    const hasBeenPrompted = localStorage.getItem("env-prompted")
    if (!hasBeenPrompted) {
      setShowWarning(true)
      localStorage.setItem("env-prompted", "true")
    }
  }, [])

  if (!showWarning) return null

  return (
    <Alert variant="destructive" className="mb-4">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Environment Setup Required</AlertTitle>
      <AlertDescription>
        Please make sure you've set up your API keys in the .env.local file before using the chat functionality.
        <button className="block underline mt-2" onClick={() => setShowWarning(false)}>
          Dismiss
        </button>
      </AlertDescription>
    </Alert>
  )
}
