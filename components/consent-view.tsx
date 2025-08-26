"use client"

import React, { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

interface ConsentViewProps {
  workspaceId: string;
  workspaceName: string;
  onConsentGiven: () => void;
}

export default function ConsentView({ workspaceId, workspaceName, onConsentGiven }: ConsentViewProps) {
  const [hasAgreed, setHasAgreed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleConsent = async () => {
    if (!hasAgreed) {
      toast.error("Please agree to the terms before continuing.");
      return;
    }

    setIsSubmitting(true);
    
    try {
      const response = await fetch('/api/user/consent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workspaceId })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || 'Failed to record consent');
      }

      toast.success("Terms accepted successfully.");
      onConsentGiven();
      
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred while recording your consent.";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full flex items-center justify-center min-h-screen bg-background px-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-2xl">Terms and Conditions</CardTitle>
          <CardDescription>
            Please review and accept the terms for {workspaceName}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-muted/50 p-4 rounded-lg">
            <h3 className="font-semibold mb-2">Data Usage and Privacy</h3>
            <p className="text-sm text-muted-foreground mb-4">
              By using this workspace, you acknowledge and agree that:
            </p>
            <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
              <li>Your interactions and data may be processed and analyzed for improving the service</li>
              <li>Conversations may be stored and used for training and development purposes</li>
              <li>Data will be handled in accordance with applicable privacy regulations</li>
              <li>You are responsible for not sharing sensitive or confidential information</li>
            </ul>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox 
              id="consent-checkbox" 
              checked={hasAgreed}
              onCheckedChange={setHasAgreed}
              disabled={isSubmitting}
            />
            <Label 
              htmlFor="consent-checkbox" 
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              I agree to the terms and conditions above
            </Label>
          </div>

          <div className="flex justify-end space-x-2">
            <Button 
              onClick={handleConsent}
              disabled={!hasAgreed || isSubmitting}
              className="min-w-[120px]"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                "Continue"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}