"use client";

"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import DocumentUpload from '@/components/document-upload';
import FileEditor from '@/components/file-editor';
import SimpleChatInterface, { type ChatInterfaceHandle } from '@/components/simple-chat-interface';
import type { AttachmentFile } from '@/components/file-attachment-minimal';
import { toast } from 'sonner';

interface CreateAgentWizardProps {
  onBack: () => void;
  onAgentCreated: () => void;
}

const CreateAgentWizard: React.FC<CreateAgentWizardProps> = ({ onBack, onAgentCreated }) => {
  const [step, setStep] = useState(1);
  const [agentName, setAgentName] = useState('');
  const [description, setDescription] = useState('');
  
  // State for files
  const [s3Docs, setS3Docs] = useState<AttachmentFile[]>([]);
  const [pineconeDocs, setPineconeDocs] = useState<AttachmentFile[]>([]);
  
  // State for system prompt
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const chatInterfaceRef = useRef<ChatInterfaceHandle>(null);
  const [docContextForChat, setDocContextForChat] = useState('');

  // State for API Keys (Phase 2.3)
  const [apiKeys, setApiKeys] = useState({ openai: '', anthropic: '', google: '' });
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Effect to clean up any stale local storage from previous sessions ON MOUNT
  useEffect(() => {
    console.log("CreateAgentWizard has mounted. Cleaning up any stale local storage.");
    // This runs only once when the component is first created.
    // It clears any potential leftover data regardless of the agentName.
    // The keys are based on the initial empty agentName.
    localStorage.removeItem(`wizard-s3-docs-`);
    localStorage.removeItem(`wizard-pinecone-docs-`);
  }, []); // Empty dependency array ensures this runs only once on mount

  const STEPS = [
    { number: 1, title: 'Agent Identity' },
    { number: 2, title: 'Core Knowledge' },
    { number: 3, title: 'System Prompt' },
    { number: 4, title: 'API Keys (Optional)' },
  ];

  const currentStep = STEPS.find(s => s.number === step);

  const handleNext = () => {
    if (step === 1 && !agentName.trim()) {
      setError("Agent name is required.");
      return;
    }
    setError(null);
    if (step < STEPS.length) {
      // When moving to step 3, prepare the document context for the chat
      if (step === 2) {
        prepareDocumentContext();
      }
      setStep(step + 1);
    }
  };

  const cleanup = () => {
    // Clear localStorage for the current wizard draft
    localStorage.removeItem(`wizard-s3-docs-${agentName}`);
    localStorage.removeItem(`wizard-pinecone-docs-${agentName}`);
    // Also clear the generic key for empty agent name
    localStorage.removeItem(`wizard-s3-docs-`);
    localStorage.removeItem(`wizard-pinecone-docs-`);
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    } else {
      cleanup();
      onBack();
    }
  };

  const prepareDocumentContext = async () => {
    const allFiles = [...s3Docs, ...pineconeDocs];
    if (allFiles.length === 0) {
        setDocContextForChat('');
        return;
    }

    let combinedContent = "## DOCUMENT CONTEXT\n\n";
    for (const file of allFiles) {
        if (!file.content) {
            // If content is not loaded, read it now.
            if (file.url) {
                try {
                    const response = await fetch(file.url);
                    file.content = await response.text();
                } catch (e) {
                    console.error("Could not read file content:", e);
                    file.content = `Error reading ${file.name}`;
                }
            }
        }
        combinedContent += `--- START Doc: ${file.name} ---\n${file.content}\n--- END Doc: ${file.name} ---\n\n`;
    }
    setDocContextForChat(combinedContent);
  };

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append('agent_name', agentName);
    formData.append('description', description);
    formData.append('system_prompt_content', systemPrompt);
    formData.append('api_keys', JSON.stringify(apiKeys));

    s3Docs.forEach(file => {
      if (file.content) {
        formData.append('s3_docs', new Blob([file.content], { type: file.type }), file.name);
      }
    });
    pineconeDocs.forEach(file => {
      if (file.content) {
        formData.append('pinecone_docs', new Blob([file.content], { type: file.type }), file.name);
      }
    });

    try {
      const response = await fetch('/api/agent/create', {
        method: 'POST',
        body: formData, // No Content-Type header needed, browser sets it for FormData
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create agent.');
      }

      toast.success(`Agent "${agentName}" created successfully!`);
      cleanup();
      onAgentCreated();
    } catch (err: any) {
      setError(err.message);
      toast.error(`Error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };
  
  const stepContent = () => {
    switch (step) {
      case 1:
        return (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="agent-name">Agent Name</Label>
              <Input
                id="agent-name"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="e.g., customer-support-bot"
                required
              />
              <p className="text-xs text-muted-foreground">Unique name, lowercase letters, numbers, and hyphens only. Cannot be changed.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-description">Description</Label>
              <Textarea
                id="agent-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A brief description of the agent's purpose."
                rows={3}
              />
            </div>
          </div>
        );
      case 2:
        return (
          <div className="space-y-6">
            <DocumentUpload
                title="Core Knowledge (S3)"
                description="Upload documents (.md, .txt) that form the agent's core, static knowledge base. These are stored in S3."
                type="memory"
                idSuffix="s3"
                onFilesAdded={setS3Docs}
                allowRemove={true}
                persistKey={`wizard-s3-docs-${agentName}`}
            />
            <DocumentUpload
                title="Vector Memory (Pinecone)"
                description="Upload documents to be chunked, embedded, and stored in Pinecone for semantic search."
                type="memory"
                idSuffix="pinecone"
                onFilesAdded={setPineconeDocs}
                allowRemove={true}
                persistKey={`wizard-pinecone-docs-${agentName}`}
            />
          </div>
        );
      case 3:
        return (
          <div className="flex h-[60vh] gap-4">
            <div className="w-1/2 flex flex-col">
              <Label className="mb-2">AI Assistant</Label>
              <div className="flex-1 border rounded-lg overflow-hidden">
                <SimpleChatInterface
                    ref={chatInterfaceRef}
                    // @ts-ignore
                    agentName="_aicreator"
                    initialContext={docContextForChat}
                    // Provide defaults for props not used in this context to prevent crashes
                    isFullscreen={true}
                    selectedModel="claude-sonnet-4-20250514"
                    temperature={0.5}
                    globalRecordingStatus={{ isRecording: false, type: null }}
                    setGlobalRecordingStatus={() => {}}
                    transcriptListenMode="none"
                    vadAggressiveness={1}
                />
              </div>
            </div>
            <div className="w-1/2 flex flex-col">
                <Label className="mb-2">System Prompt Draft</Label>
                <div className="flex-1 border rounded-lg p-2">
                    <Textarea
                        value={systemPrompt}
                        onChange={(e) => setSystemPrompt(e.target.value)}
                        className="w-full h-full resize-none border-0 focus-visible:ring-0"
                        placeholder="Draft your system prompt here. You can copy-paste from the AI assistant."
                    />
                </div>
            </div>
          </div>
        );
       case 4:
        return (
          <div className="space-y-6">
             <div className="space-y-2">
                <Label htmlFor="openai-key">OpenAI API Key</Label>
                <Input id="openai-key" type="password" value={apiKeys.openai} onChange={(e) => setApiKeys(p => ({...p, openai: e.target.value}))} />
             </div>
             <div className="space-y-2">
                <Label htmlFor="anthropic-key">Anthropic API Key</Label>
                <Input id="anthropic-key" type="password" value={apiKeys.anthropic} onChange={(e) => setApiKeys(p => ({...p, anthropic: e.target.value}))} />
             </div>
             <div className="space-y-2">
                <Label htmlFor="google-key">Google API Key</Label>
                <Input id="google-key" type="password" value={apiKeys.google} onChange={(e) => setApiKeys(p => ({...p, google: e.target.value}))} />
             </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div>
      <Button variant="ghost" onClick={handleBack} className="mb-4">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back
      </Button>

      <div className="flex justify-between items-center mb-6">
        <div>
            <h2 className="text-2xl font-bold">Create New Agent</h2>
            <p className="text-muted-foreground">Step {step}: {currentStep?.title}</p>
        </div>
      </div>

      <form onSubmit={handleCreateAgent}>
        <div className="min-h-[300px]">
          {stepContent()}
        </div>
        
        {error && (
            <Alert variant="destructive" className="mt-6">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
            </Alert>
        )}

        <div className="flex justify-end gap-4 mt-8">
          {step < STEPS.length ? (
            <Button type="button" onClick={handleNext} disabled={step === 1 && !agentName.trim()}>
              Next
            </Button>
          ) : (
            <Button type="submit" disabled={isLoading || !agentName.trim()}>
              {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating...</> : 'Complete and Create Agent'}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
};

export default CreateAgentWizard;