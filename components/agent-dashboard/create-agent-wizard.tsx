"use client";

"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ArrowLeft, Loader2, Copy, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import DocumentUpload from '@/components/document-upload';
import WizardChatInterface from './wizard-chat-interface'; // New component
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
  
  // State for system prompt versioning
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [currentPromptIndex, setCurrentPromptIndex] = useState(0);
  const systemPrompt = promptHistory[currentPromptIndex] ?? ''; // Use ?? for safety

  const wizardChatRef = useRef<any>(null); // Ref for chat interface methods
  const [lastInjectedVersionIndex, setLastInjectedVersionIndex] = useState<number | null>(null);

  const [docContextForChat, setDocContextForChat] = useState('');
  const [wizardSessionId] = useState(() => `wizard-session-${crypto.randomUUID()}`);


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
      // We no longer clean up here to preserve state when returning to the list view.
      // Cleanup is now handled by the unmount effect triggered by the parent's key change.
      onBack();
    }
  };

  const prepareDocumentContext = async () => {
    const allFiles = [...s3Docs, ...pineconeDocs];
    
    let combinedContent = "## AGENT DEFINITION\n";
    combinedContent += `Name: ${agentName || 'Not yet defined'}\n`;
    combinedContent += `Description: ${description || 'Not yet defined'}\n\n`;

    if (allFiles.length > 0) {
        combinedContent += "## DOCUMENT CONTEXT\n\n";
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
    }
    setDocContextForChat(combinedContent);
  };

  useEffect(() => {
    // This effect runs when the component mounts. The returned function is the cleanup
    // that runs when the component unmounts (e.g., when the parent dialog is closed and the key changes).
    return () => {
      cleanup();
    };
  }, []); // The empty dependency array ensures this effect runs only once on mount and unmount.

  const handleCopyPrompt = () => {
    if (!systemPrompt) {
      toast.info("There is no prompt content to copy.");
      return;
    }
    navigator.clipboard.writeText(systemPrompt).then(() => {
      toast.success("System prompt copied to clipboard!");
    }).catch(err => {
      console.error("Failed to copy text: ", err);
      toast.error("Failed to copy prompt to clipboard.");
    });
  };

  const updateCurrentPrompt = (newContent: string) => {
    setPromptHistory(currentHistory => {
      const newHistory = [...currentHistory];
      // If history is empty, this is the first edit. Initialize it.
      if (newHistory.length === 0) {
        return [newContent];
      }
      newHistory[currentPromptIndex] = newContent;
      return newHistory;
    });
  };

  const addNewPromptVersion = (newContent: string) => {
    setPromptHistory(currentHistory => {
      // Don't add if it's the same as the last version
      if (currentHistory.length > 0 && currentHistory[currentHistory.length - 1] === newContent) {
        return currentHistory;
      }
      // Don't add empty strings as the first version
      if (currentHistory.length === 0 && newContent.trim() === '') {
        return [];
      }
      return [...currentHistory, newContent];
    });
  };

  // Effect to jump to the newest version only when a version is added
  const prevHistoryLength = useRef(promptHistory.length);
  useEffect(() => {
    if (promptHistory.length > prevHistoryLength.current) {
      setCurrentPromptIndex(promptHistory.length - 1);
    }
    prevHistoryLength.current = promptHistory.length;
  }, [promptHistory]);


  const handlePrevVersion = () => {
    const newIndex = Math.max(0, currentPromptIndex - 1);
    if (newIndex !== currentPromptIndex) {
      setCurrentPromptIndex(newIndex);
      if (newIndex !== lastInjectedVersionIndex) {
        const newVersionTitle = `version ${newIndex + 1}`;
        wizardChatRef.current?.injectSystemMessage(`Switched to ${newVersionTitle}: Conversation will proceed from here.`);
        wizardChatRef.current?.scrollToBottom();
        setLastInjectedVersionIndex(newIndex);
      }
    }
  };

  const handleNextVersion = () => {
    const newIndex = Math.min(promptHistory.length - 1, currentPromptIndex + 1);
    if (newIndex !== currentPromptIndex) {
      setCurrentPromptIndex(newIndex);
      if (newIndex !== lastInjectedVersionIndex) {
        const newVersionTitle = `version ${newIndex + 1}`;
        wizardChatRef.current?.injectSystemMessage(`Switched to ${newVersionTitle}: Conversation will proceed from here.`);
        wizardChatRef.current?.scrollToBottom();
        setLastInjectedVersionIndex(newIndex);
      }
    }
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

      <form onSubmit={handleCreateAgent} autoComplete="off">
        <div className="min-h-[300px]">
          {/* Step 1: Agent Identity */}
          {step === 1 && (
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
          )}

          {/* Step 2: Core Knowledge */}
          {step === 2 && (
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
          )}

          {/* Step 3: System Prompt */}
          {step === 3 && (
            <div className="flex h-[60vh] gap-4">
              <div className="w-1/2 flex flex-col">
                <Label className="mb-2 text-center text-lg font-medium">AI Assistant</Label>
                <div className="flex-1 border rounded-lg overflow-hidden h-full">
                  <WizardChatInterface
                    ref={wizardChatRef}
                    wizardSessionId={wizardSessionId}
                    agentName="_aicreator"
                    initialContext={docContextForChat}
                    currentDraftContent={systemPrompt}
                    onNewPromptVersion={addNewPromptVersion}
                    onUserSubmit={() => addNewPromptVersion(systemPrompt)}
                  />
                </div>
              </div>
              <div className="w-1/2 flex flex-col">
                <Label className="mb-1 text-center text-lg font-medium">System Prompt Draft</Label>
                <div className="flex-1 border rounded-lg relative">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute top-3 right-3 h-7 w-7 z-10 text-muted-foreground hover:text-foreground"
                    onClick={handleCopyPrompt}
                    title="Copy prompt"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Textarea
                    value={systemPrompt}
                    onChange={(e) => updateCurrentPrompt(e.target.value)}
                    className="w-full h-full resize-none border-0 p-3 pr-12"
                    placeholder="Draft your system prompt here. You can copy-paste from the AI assistant."
                  />
                </div>
                {promptHistory.length > 1 && (
                  <div className="flex items-center justify-center gap-2 mt-2 text-sm text-muted-foreground">
                    <Button type="button" variant="ghost" size="icon" onClick={handlePrevVersion} disabled={currentPromptIndex === 0} className="h-6 w-6">
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span>Version {currentPromptIndex + 1} of {promptHistory.length}</span>
                    <Button type="button" variant="ghost" size="icon" onClick={handleNextVersion} disabled={currentPromptIndex === promptHistory.length - 1} className="h-6 w-6">
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* Step 4: API Keys */}
          {step === 4 && (
            <div className="space-y-6">
               <div className="space-y-2">
                  <Label htmlFor="openai-key">OpenAI API Key</Label>
                  <Input id="openai-key" name="openai-key" type="password" value={apiKeys.openai} onChange={(e) => setApiKeys(p => ({...p, openai: e.target.value}))} autoComplete="new-password" />
               </div>
               <div className="space-y-2">
                  <Label htmlFor="anthropic-key">Anthropic API Key</Label>
                  <Input id="anthropic-key" name="anthropic-key" type="password" value={apiKeys.anthropic} onChange={(e) => setApiKeys(p => ({...p, anthropic: e.target.value}))} autoComplete="new-password" />
               </div>
               <div className="space-y-2">
                  <Label htmlFor="google-key">Google API Key</Label>
                  <Input id="google-key" name="google-key" type="password" value={apiKeys.google} onChange={(e) => setApiKeys(p => ({...p, google: e.target.value}))} autoComplete="new-password" />
               </div>
            </div>
          )}
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