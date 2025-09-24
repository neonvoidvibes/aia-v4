"use client";

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { X, Edit2, Check, AlertCircle } from 'lucide-react';

interface Agent {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

interface AgentEditModalProps {
  agent: Agent | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (agent: Agent) => Promise<void>;
  userRole?: string | null;
}

const AgentEditModal: React.FC<AgentEditModalProps> = ({
  agent,
  isOpen,
  onClose,
  onSave,
  userRole
}) => {
  const [activeTab, setActiveTab] = useState("general");
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedDescription, setEditedDescription] = useState("");
  const [isSavingDescription, setIsSavingDescription] = useState(false);

  if (!agent) return null;

  // Check if user can edit (admin, super user, or agent owner)
  const canEdit = userRole === 'admin' || userRole === 'super_user' || true; // TODO: Add agent ownership check

  const handleStartEditDescription = () => {
    setEditedDescription(agent.description || "");
    setIsEditingDescription(true);
  };

  const handleCancelEditDescription = () => {
    setIsEditingDescription(false);
    setEditedDescription("");
  };

  const handleSaveDescription = async () => {
    if (!canEdit) return;

    setIsSavingDescription(true);
    try {
      const response = await fetch(`/api/agent/${agent.id}/update`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          description: editedDescription
        })
      });

      if (!response.ok) {
        throw new Error('Failed to update agent description');
      }

      // Update the local agent object
      agent.description = editedDescription;
      setIsEditingDescription(false);

    } catch (error) {
      console.error('Error updating agent description:', error);
      // TODO: Add proper error handling/toast notification
    } finally {
      setIsSavingDescription(false);
    }
  };

  const handleSave = async () => {
    // TODO: Implement save logic
    console.log('Save agent:', agent);
    await onSave(agent);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-6xl w-[95vw] h-[95vh] flex flex-col p-0">
        <DialogHeader className="p-6 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-xl font-bold">
                Edit Agent: {agent.name}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground mt-1">
                Configure agent settings, system prompt, memory, events, and advanced options
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
            <TabsList className="w-full justify-start border-b rounded-none bg-transparent p-0 h-auto mx-6 mt-4">
              <TabsTrigger
                value="general"
                className="px-6 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
              >
                General
              </TabsTrigger>
              <TabsTrigger
                value="instructions"
                className="px-6 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
              >
                Instructions
              </TabsTrigger>
              <TabsTrigger
                value="memory"
                className="px-6 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
              >
                Memory
              </TabsTrigger>
              <TabsTrigger
                value="transcripts"
                className="px-6 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
              >
                Transcripts
              </TabsTrigger>
              <TabsTrigger
                value="events"
                className="px-6 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
              >
                Events
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-y-auto px-6 pb-6">
              <TabsContent value="general" className="mt-6 space-y-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">General Settings</h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium mb-2">Agent Name</label>
                        <div className="p-3 border rounded-md bg-muted">
                          {agent.name}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2">Agent ID</label>
                        <div className="p-3 border rounded-md bg-muted font-mono text-sm">
                          {agent.id}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2">Created</label>
                        <div className="p-3 border rounded-md bg-muted">
                          {new Date(agent.created_at).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="block text-sm font-medium">Description</label>
                          {canEdit && !isEditingDescription && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={handleStartEditDescription}
                              className="h-auto p-1 text-muted-foreground hover:text-foreground"
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                        {isEditingDescription ? (
                          <div className="space-y-2">
                            <Textarea
                              value={editedDescription}
                              onChange={(e) => setEditedDescription(e.target.value)}
                              className="min-h-[120px] resize-none"
                              placeholder="Enter agent description..."
                            />
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                onClick={handleSaveDescription}
                                disabled={isSavingDescription}
                                className="h-8"
                              >
                                {isSavingDescription ? (
                                  <AlertCircle className="h-3 w-3 animate-spin mr-1" />
                                ) : (
                                  <Check className="h-3 w-3 mr-1" />
                                )}
                                Save
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleCancelEditDescription}
                                disabled={isSavingDescription}
                                className="h-8"
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="p-3 border rounded-md bg-muted min-h-[120px]">
                            {agent.description || 'No description provided'}
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2">Status</label>
                        <div className="p-3 border rounded-md bg-muted">
                          <span className="inline-flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            Active
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="instructions" className="mt-6 space-y-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">System Instructions</h3>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium">System Prompt</label>
                    <div className="border rounded-md bg-muted p-4 min-h-[400px] font-mono text-sm">
                      System prompt content will be loaded here...
                      (placeholder - system prompt editing not implemented yet)
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="memory" className="mt-6 space-y-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Memory Configuration</h3>
                  <div className="border rounded-md bg-muted p-8 text-center text-muted-foreground">
                    Memory configuration will be implemented here
                    <br />
                    <span className="text-sm">Vector storage, embeddings, and retrieval settings</span>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="transcripts" className="mt-6 space-y-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Transcripts</h3>
                  <div className="border rounded-md bg-muted p-8 text-center text-muted-foreground">
                    Transcript management will be implemented here
                    <br />
                    <span className="text-sm">View and manage agent conversation transcripts</span>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="events" className="mt-6 space-y-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Events</h3>
                  <div className="border rounded-md bg-muted p-8 text-center text-muted-foreground">
                    Event configuration will be implemented here
                    <br />
                    <span className="text-sm">Event handlers, triggers, and automation settings</span>
                  </div>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>

        <div className="flex justify-end gap-3 p-6 border-t flex-shrink-0">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AgentEditModal;