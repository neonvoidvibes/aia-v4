"use client";

"use client";

import React, { useState, useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react';
import { ArrowLeft, Loader2, Copy, ChevronLeft, ChevronRight, UserPlus, Trash2, Eye, EyeOff, RefreshCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  step: number;
  setStep: (step: number) => void;
}

export interface CreateAgentWizardHandle {
  handleCreateAgent: () => Promise<boolean>;
}

const CreateAgentWizard = forwardRef<CreateAgentWizardHandle, CreateAgentWizardProps>(({ onBack, step, setStep }, ref) => {
  const [agentName, setAgentName] = useState('');
  const [description, setDescription] = useState('');
  
  // State for files
  const [s3Docs, setS3Docs] = useState<AttachmentFile[]>([]);
  const [pineconeDocs, setPineconeDocs] = useState<AttachmentFile[]>([]);
  
  // State for system prompt versioning
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [currentPromptIndex, setCurrentPromptIndex] = useState(0);
  const [draftPrompt, setDraftPrompt] = useState(''); // New state for the editor
  const [isDirtySinceVersion, setIsDirtySinceVersion] = useState(false);

  // State for user access management (Step 4)
  const [allUsers, setAllUsers] = useState<{ id: string; email: string }[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [newUsers, setNewUsers] = useState<{ id: string; email: string; password: string }[]>([]);
  const [passwordVisibility, setPasswordVisibility] = useState<Record<string, boolean>>({});


  // Effect to sync editor when history/index changes
  useEffect(() => {
    setDraftPrompt(promptHistory[currentPromptIndex] ?? '');
    setIsDirtySinceVersion(false); // Reset dirty flag on version switch
  }, [currentPromptIndex, promptHistory]);

  useEffect(() => {
    const fetchUsers = async () => {
      // Fetch users if we are on step 4 and the list hasn't been populated yet.
      if (step === 4 && allUsers.length === 0) {
        setIsLoading(true); // Use a general loading state for feedback
        setError(null);
        try {
          const response = await fetch('/api/users/list');
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to fetch users.');
          }
          const data = await response.json();
          setAllUsers(data);
        } catch (err: any) {
          setError(`Could not load existing users: ${err.message}`);
          toast.error(`Could not load existing users: ${err.message}`);
        } finally {
          setIsLoading(false);
        }
      }
    };
    fetchUsers();
  }, [step, allUsers.length]);


  const wizardChatRef = useRef<any>(null); // Ref for chat interface methods
  const [lastInjectedVersionIndex, setLastInjectedVersionIndex] = useState<number | null>(null);

  const [docContextForChat, setDocContextForChat] = useState('');
  const [wizardSessionId] = useState(() => `wizard-session-${crypto.randomUUID()}`);


  // State for API Keys (Phase 2.3)
  const [apiKeys, setApiKeys] = useState({ openai: '', anthropic: '', google: '' });
  
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingName, setIsCheckingName] = useState(false);
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
    { number: 4, title: 'User Access' },
    { number: 5, title: 'API Keys (Optional)' },
  ];

  const currentStep = STEPS.find(s => s.number === step);

  const handleNext = async () => {
    if (step === 1) {
      if (!agentName.trim()) {
        setError("Agent name is required.");
        return;
      }
      
      setIsCheckingName(true);
      setError(null);

      try {
        const response = await fetch(`/api/agent/name-exists?name=${encodeURIComponent(agentName.trim())}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to verify agent name.');
        }

        if (data.exists) {
          setError(`Agent name "${agentName.trim()}" is already taken. Please choose another.`);
          setIsCheckingName(false);
          return;
        }
      } catch (err: any) {
        setError(err.message);
        setIsCheckingName(false);
        return;
      }
      setIsCheckingName(false);
    }

    setError(null);
    if (step < STEPS.length) {
      if (step === 3 && isDirtySinceVersion) {
        addNewPromptVersion(draftPrompt);
      }
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

  // --- User Access Management Functions ---
  const handleToggleUserSelection = (userId: string) => {
    setSelectedUserIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) {
        newSet.delete(userId);
      } else {
        newSet.add(userId);
      }
      return newSet;
    });
  };

  const generatePassword = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()';
    let password = '';
    for (let i = 0; i < 14; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  };

  const handleAddNewUser = () => {
    const newId = crypto.randomUUID();
    setNewUsers(prev => [...prev, { id: newId, email: '', password: generatePassword() }]);
    setPasswordVisibility(prev => ({...prev, [newId]: true})); // Show password for new user by default
  };

  const handleUpdateNewUser = (id: string, field: 'email' | 'password', value: string) => {
    setNewUsers(prev => prev.map(user => user.id === id ? { ...user, [field]: value } : user));
  };
  
  const handleRemoveNewUser = (id: string) => {
    setNewUsers(prev => prev.filter(user => user.id !== id));
  };

  const handleCopyPassword = (password: string) => {
    navigator.clipboard.writeText(password).then(() => {
      toast.success("Password copied to clipboard!");
    }).catch(err => {
      toast.error("Failed to copy password.");
    });
  };

  const handleTogglePasswordVisibility = (id: string) => {
    setPasswordVisibility(prev => ({...prev, [id]: !prev[id]}));
  };
  // --- End User Access Management Functions ---

  const handleCopyPrompt = () => {
    if (!draftPrompt) {
      toast.info("There is no prompt content to copy.");
      return;
    }
    navigator.clipboard.writeText(draftPrompt).then(() => {
      toast.success("System prompt copied to clipboard!");
    }).catch(err => {
      console.error("Failed to copy text: ", err);
      toast.error("Failed to copy prompt to clipboard.");
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
      setIsDirtySinceVersion(false);
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
      setIsDirtySinceVersion(false);
      if (newIndex !== lastInjectedVersionIndex) {
        const newVersionTitle = `version ${newIndex + 1}`;
        wizardChatRef.current?.injectSystemMessage(`Switched to ${newVersionTitle}: Conversation will proceed from here.`);
        setTimeout(() => wizardChatRef.current?.scrollToBottom(), 0);
        setLastInjectedVersionIndex(newIndex);
      }
    }
  };

  const handleNextVersion = () => {
    const newIndex = Math.min(promptHistory.length - 1, currentPromptIndex + 1);
    if (newIndex !== currentPromptIndex) {
      setCurrentPromptIndex(newIndex);
      setIsDirtySinceVersion(false);
      if (newIndex !== lastInjectedVersionIndex) {
        const newVersionTitle = `version ${newIndex + 1}`;
        wizardChatRef.current?.injectSystemMessage(
          `Switched to ${newVersionTitle}: Conversation will proceed from here.`
        );

        // Inject authoritative draft, hidden from UI but visible to LLM
        wizardChatRef.current?.injectHiddenSystemMessage(
          `<current_draft>\n${promptHistory[newIndex]}\n</current_draft>`
        );
        setTimeout(() => wizardChatRef.current?.scrollToBottom(), 0);
        setLastInjectedVersionIndex(newIndex);
      }
    }
  };

  const handleCreateAgent = async (): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append('agent_name', agentName);
    formData.append('description', description);
    formData.append('system_prompt_content', draftPrompt);
    formData.append('api_keys', JSON.stringify(apiKeys));
    formData.append('user_ids_to_grant_access', JSON.stringify(Array.from(selectedUserIds)));
    formData.append('new_users_to_create', JSON.stringify(newUsers.map(({ id, ...rest }) => rest))); // Don't send client-side temp id

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
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create agent.');
      }

      toast.success(`Agent "${agentName}" created successfully!`);
      cleanup();
      return true;
    } catch (err: any) {
      setError(err.message);
      toast.error(`Error: ${err.message}`);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  useImperativeHandle(ref, () => ({
    handleCreateAgent,
  }));

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

      <form onSubmit={(e) => e.preventDefault()} autoComplete="off">
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
                    currentDraftContent={draftPrompt}
                    onNewPromptVersion={addNewPromptVersion}
                    onUserSubmit={() => { if (isDirtySinceVersion) addNewPromptVersion(draftPrompt); }}
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
                    value={draftPrompt}
                    onChange={(e) => {
                      setDraftPrompt(e.target.value);
                      setIsDirtySinceVersion(true);
                    }}
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

          {/* Step 4: User Access */}
          {step === 4 && (
            <div className="space-y-8">
              {/* Grant access to existing users */}
              <div>
                <h3 className="text-lg font-semibold mb-2">Grant Access to Existing Users</h3>
                <p className="text-sm text-muted-foreground mb-4">Select existing users who should have access to this new agent.</p>
                <ScrollArea className="h-48 rounded-md border p-3">
                  <div className="space-y-3">
                    {allUsers.length > 0 ? (
                      allUsers.map(user => (
                        <div key={user.id} className="flex items-center space-x-3">
                          <Checkbox
                            id={`user-access-${user.id}`}
                            checked={selectedUserIds.has(user.id)}
                            onCheckedChange={() => handleToggleUserSelection(user.id)}
                          />
                          <Label htmlFor={`user-access-${user.id}`} className="font-normal cursor-pointer">
                            {user.email}
                          </Label>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        {isLoading ? 'Loading users...' : 'No existing users found.'}
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </div>

              {/* Create and grant access to new users */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold">Create & Grant Access to New Users</h3>
                    <p className="text-sm text-muted-foreground">Add new users to the platform and automatically grant them access to this agent.</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={handleAddNewUser}>
                    <UserPlus className="mr-2 h-4 w-4" /> Add User
                  </Button>
                </div>
                <div className="space-y-4">
                  {newUsers.map((user, index) => (
                    <div key={user.id} className="p-4 border rounded-md relative group">
                      <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-7 w-7 opacity-50 group-hover:opacity-100" onClick={() => handleRemoveNewUser(user.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor={`new-user-email-${user.id}`}>Email</Label>
                          <Input
                            id={`new-user-email-${user.id}`}
                            type="email"
                            placeholder="new.user@example.com"
                            value={user.email}
                            onChange={(e) => handleUpdateNewUser(user.id, 'email', e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`new-user-password-${user.id}`}>Password</Label>
                          <div className="flex items-center gap-2">
                            <Input
                              id={`new-user-password-${user.id}`}
                              type={passwordVisibility[user.id] ? "text" : "password"}
                              value={user.password}
                              onChange={(e) => handleUpdateNewUser(user.id, 'password', e.target.value)}
                            />
                            <Button type="button" variant="ghost" size="icon" className="h-9 w-9" onClick={() => handleTogglePasswordVisibility(user.id)}>
                               {passwordVisibility[user.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                            <Button type="button" variant="ghost" size="icon" className="h-9 w-9" onClick={() => handleUpdateNewUser(user.id, 'password', generatePassword())}>
                                <RefreshCcw className="h-4 w-4" />
                            </Button>
                            <Button type="button" variant="ghost" size="icon" className="h-9 w-9" onClick={() => handleCopyPassword(user.password)}>
                                <Copy className="h-4 w-4" />
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">Auto-generated. Please save this password securely before proceeding.</p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {newUsers.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">No new users added yet.</p>
                  )}
                </div>
              </div>
            </div>
          )}
          
          {/* Step 5: API Keys */}
          {step === 5 && (
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
          {step < STEPS.length && (
            <Button type="button" onClick={handleNext} disabled={isCheckingName || (step === 1 && !agentName.trim())}>
              {isCheckingName ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Checking...</> : 'Next'}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
});

CreateAgentWizard.displayName = 'CreateAgentWizard';
export default CreateAgentWizard;