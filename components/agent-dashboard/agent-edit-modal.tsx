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
import { X } from 'lucide-react';

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
}

const AgentEditModal: React.FC<AgentEditModalProps> = ({
  agent,
  isOpen,
  onClose,
  onSave
}) => {
  const [activeTab, setActiveTab] = useState("general");

  if (!agent) return null;

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
                value="system-prompt"
                className="px-6 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
              >
                System Prompt
              </TabsTrigger>
              <TabsTrigger
                value="memory"
                className="px-6 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
              >
                Memory
              </TabsTrigger>
              <TabsTrigger
                value="events"
                className="px-6 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
              >
                Events
              </TabsTrigger>
              <TabsTrigger
                value="advanced"
                className="px-6 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
              >
                Advanced
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-y-auto px-6 pb-6">
              <TabsContent value="general" className="mt-6 space-y-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">General Settings</h3>
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">Agent Name</label>
                      <div className="p-3 border rounded-md bg-muted">
                        {agent.name} (placeholder - editing not implemented)
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Description</label>
                      <div className="p-3 border rounded-md bg-muted min-h-[100px]">
                        {agent.description || 'No description'} (placeholder - editing not implemented)
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Model Selection</label>
                      <div className="p-3 border rounded-md bg-muted">
                        GPT-4 (placeholder - model selection not implemented)
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="system-prompt" className="mt-6 space-y-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">System Prompt</h3>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium">System Instructions</label>
                    <div className="border rounded-md bg-muted p-4 min-h-[400px] font-mono text-sm">
                      System prompt content will go here...
                      (placeholder - system prompt editing not implemented)
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="memory" className="mt-6 space-y-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Memory Configuration</h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <h4 className="font-medium">S3 Configuration</h4>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium mb-2">Bucket Name</label>
                          <div className="p-3 border rounded-md bg-muted">
                            agent-memory-bucket (placeholder)
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2">Access Key</label>
                          <div className="p-3 border rounded-md bg-muted">
                            ••••••••••••••••••••• (placeholder)
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <h4 className="font-medium">Pinecone Configuration</h4>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium mb-2">Index Name</label>
                          <div className="p-3 border rounded-md bg-muted">
                            agent-vectors (placeholder)
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2">API Key</label>
                          <div className="p-3 border rounded-md bg-muted">
                            ••••••••••••••••••••• (placeholder)
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="events" className="mt-6 space-y-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Event Configuration</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">Event Labels</label>
                      <div className="border rounded-md bg-muted p-4 min-h-[200px]">
                        Event labels configuration will go here...
                        (placeholder - event configuration not implemented)
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Event Handlers</label>
                      <div className="border rounded-md bg-muted p-4 min-h-[200px]">
                        Event handlers configuration will go here...
                        (placeholder - event handlers not implemented)
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="advanced" className="mt-6 space-y-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Advanced Settings</h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium mb-2">Temperature</label>
                        <div className="p-3 border rounded-md bg-muted">
                          0.7 (placeholder - temperature control not implemented)
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2">Max Tokens</label>
                        <div className="p-3 border rounded-md bg-muted">
                          2048 (placeholder - max tokens control not implemented)
                        </div>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium mb-2">Timeout (seconds)</label>
                        <div className="p-3 border rounded-md bg-muted">
                          30 (placeholder - timeout control not implemented)
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2">Rate Limit</label>
                        <div className="p-3 border rounded-md bg-muted">
                          100 requests/min (placeholder - rate limit not implemented)
                        </div>
                      </div>
                    </div>
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