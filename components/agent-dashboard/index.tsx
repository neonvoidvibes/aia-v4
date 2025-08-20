"use client";

import React, { useState, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import AgentList from './agent-list';
import CreateAgentWizard, { type CreateAgentWizardHandle } from './create-agent-wizard';
import { AlertDialogConfirm } from '@/components/ui/alert-dialog-confirm';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface AgentDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  userRole: string | null;
}

const AgentDashboard: React.FC<AgentDashboardProps> = ({ isOpen, onClose, userRole }) => {
  const [view, setView] = useState<'list' | 'create' | 'edit'>('list');
  const [selectedAgent, setSelectedAgent] = useState<any | null>(null);
  const [wizardKey, setWizardKey] = useState(Date.now());
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const refreshAgentListRef = useRef<() => void>();
  const wizardRef = useRef<CreateAgentWizardHandle>(null);
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);

  const handleFinalCreateAgent = async () => {
    if (!wizardRef.current) return;
    setIsCreatingAgent(true);
    const success = await wizardRef.current.handleCreateAgent();
    setIsCreatingAgent(false);

    if (success) {
      // Creation was successful, toast was shown in wizard. Now refresh list and switch view.
      if (refreshAgentListRef.current) {
        await refreshAgentListRef.current();
      }
      setView('list');
      setWizardKey(Date.now()); // Reset wizard for next time
    }
    // If not successful, the wizard will have shown an error toast. We just stay on the wizard page.
  };

  const handleCloseRequest = () => {
    if (view === 'create' || view === 'edit') {
      setShowCloseConfirm(true);
    } else {
      onClose();
    }
  };

  const handleConfirmClose = () => {
    setShowCloseConfirm(false);
    setWizardKey(Date.now()); // Changing the key will force remount and reset state
    setView('list'); // Go back to the list view
    onClose(); // Then close the dialog
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleCloseRequest()}>
        <DialogContent
          className="max-w-3xl h-[85vh] flex flex-col"
          onPointerDownOutside={(e) => {
            // Allow clicking inside other modals spawned by the wizard
            if ((e.target as HTMLElement)?.closest('[role="dialog"]')) {
              return;
            }
            e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              <span className="sr-only">Agent Dashboard</span>
            </DialogTitle>
            <DialogDescription>
               <span className="sr-only">Manage, create, and edit your AI agents.</span>
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            <div style={{ display: view === 'list' ? 'block' : 'none' }}>
              <AgentList
                onCreateNew={() => setView('create')}
                onEditAgent={(agent) => {
                  setSelectedAgent(agent);
                  console.log("Edit clicked for:", agent.name);
                }}
                onRefresh={refreshAgentListRef as any}
              />
            </div>
            <div style={{ display: view === 'create' ? 'block' : 'none' }}>
               <CreateAgentWizard ref={wizardRef} key={wizardKey} onBack={() => setView('list')} />
            </div>
             <div style={{ display: view === 'edit' ? 'block' : 'none' }}>
                <div>Editing Agent: {selectedAgent?.name} (Not Implemented) <Button onClick={() => setView('list')}>Back</Button></div>
             </div>
          </div>
          {view === 'create' && (
            <div className="flex justify-end p-4 border-t">
                 <Button
                    type="button"
                    onClick={handleFinalCreateAgent}
                    disabled={isCreatingAgent || wizardRef.current?.step !== 4}
                 >
                    {isCreatingAgent ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating...</> : 'Complete and Create Agent'}
                </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialogConfirm
        isOpen={showCloseConfirm}
        onClose={() => setShowCloseConfirm(false)}
        onConfirm={handleConfirmClose}
        title="Exit Agent Creation?"
        message="Are you sure you want to exit? All progress, including chat history and uploaded files for this new agent, will be lost."
        confirmText="Exit Wizard"
        cancelText="Cancel"
        confirmVariant="destructive"
      />
    </>
  );
};

export default AgentDashboard;