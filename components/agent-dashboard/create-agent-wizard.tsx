"use client";

import React, { useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';

interface CreateAgentWizardProps {
  onBack: () => void;
  onAgentCreated: () => void; // Callback to refresh the agent list
}

const CreateAgentWizard: React.FC<CreateAgentWizardProps> = ({ onBack, onAgentCreated }) => {
  const [step, setStep] = useState(1);
  const [agentName, setAgentName] = useState('');
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    if (!agentName.trim()) {
        setError("Agent name is required.");
        setIsLoading(false);
        return;
    }

    try {
      const response = await fetch('/api/agent/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_name: agentName,
          description: description,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create agent.');
      }

      toast.success(`Agent "${agentName}" created successfully!`);
      onAgentCreated(); // Signal parent to refresh the list and switch view
    } catch (err: any) {
      setError(err.message);
      toast.error(`Error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <Button variant="ghost" onClick={onBack} className="mb-4">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to Agent List
      </Button>

      <h2 className="text-2xl font-bold mb-2">Create New Agent</h2>
      <p className="text-muted-foreground mb-6">Step {step}: Agent Identity</p>

      <form onSubmit={handleCreateAgent} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="agent-name">Agent Name</Label>
          <Input
            id="agent-name"
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            placeholder="e.g., customer-support-bot"
            required
            disabled={isLoading}
          />
          <p className="text-xs text-muted-foreground">A unique name for the agent. Cannot be changed later.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="agent-description">Description</Label>
          <Textarea
            id="agent-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A brief description of the agent's purpose."
            disabled={isLoading}
            rows={3}
          />
        </div>

        {error && (
            <Alert variant="destructive">
                <AlertTitle>Creation Failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
            </Alert>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={isLoading || !agentName.trim()}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Agent'
            )}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default CreateAgentWizard;