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
import AgentEditModal from './agent-edit-modal';
import { AlertDialogConfirm } from '@/components/ui/alert-dialog-confirm';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft } from 'lucide-react';
import { useLocalization } from '@/context/LocalizationContext';

interface AgentDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  userRole: string | null;
}

const AgentDashboard: React.FC<AgentDashboardProps> = ({ isOpen, onClose, userRole }) => {
  const { t } = useLocalization();
  const [view, setView] = useState<'list' | 'create' | 'edit'>('list');
  const [selectedAgent, setSelectedAgent] = useState<any | null>(null);
  const [wizardKey, setWizardKey] = useState(Date.now());
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const refreshAgentListRef = useRef<() => void>(undefined);
  const wizardRef = useRef<CreateAgentWizardHandle>(null);
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [showEditModal, setShowEditModal] = useState(false);

  const handleBack = () => {
    if (view === 'create') {
      if (wizardStep > 1) {
        setWizardStep(wizardStep - 1);
      } else {
        setView('list');
      }
    } else if (view === 'edit') {
      setView('list');
    }
  };

  const handleNext = () => {
    wizardRef.current?.handleNext();
  };

  const handleFinalCreateAgent = async () => {
    if (!wizardRef.current) return;
    setIsCreatingAgent(true);
    const success = await wizardRef.current.handleCreateAgent();
    setIsCreatingAgent(false);

    if (success) {
      if (refreshAgentListRef.current) {
        await refreshAgentListRef.current();
      }
      setView('list');
      setWizardKey(Date.now());
    }
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
    setWizardKey(Date.now());
    setView('list');
    onClose();
  };

  const handleSaveAgent = async (agent: any) => {
    // TODO: Implement agent save API call
    console.log('Saving agent:', agent);
    // Refresh the agent list
    if (refreshAgentListRef.current) {
      await refreshAgentListRef.current();
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleCloseRequest()}>
        <DialogContent
          className="max-w-5xl w-[90vw] h-[90vh] flex flex-col p-0"
          onPointerDownOutside={(e) => {
            if ((e.target as HTMLElement)?.closest('[role="dialog"]')) {
              return;
            }
            e.preventDefault();
          }}
        >
          <DialogHeader className="p-4 border-b flex-shrink-0">
             <div className="flex items-center justify-between h-8">
               <div className="w-24 flex justify-start">
                  {view !== 'list' && (
                    <Button variant="ghost" onClick={handleBack} className="p-0 h-auto hover:bg-transparent text-sm">
                      <ArrowLeft className="mr-2 h-4 w-4" /> Back
                    </Button>
                  )}
               </div>
               <DialogTitle className="text-center text-lg font-bold">
                  {view === 'list' && 'Agent Dashboard'}
                  {view === 'create' && 'Create New Agent'}
                  {view === 'edit' && `Edit Agent: ${selectedAgent?.name}`}
               </DialogTitle>
               <div className="w-24 flex justify-end">
                  <Button variant="ghost" onClick={handleCloseRequest} className="p-0 h-auto hover:bg-transparent text-sm text-muted-foreground hover:text-foreground">
                    Exit
                  </Button>
               </div>
             </div>
            <DialogDescription className="sr-only">
               Manage, create, and edit your AI agents.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 pt-2 pb-6">
            <div style={{ display: view === 'list' ? 'block' : 'none' }} className="h-full">
              <AgentList
                onCreateNew={() => {
                  setView('create');
                  setWizardStep(1);
                }}
                onEditAgent={(agent) => {
                  setSelectedAgent(agent);
                  setShowEditModal(true);
                }}
                onRefresh={refreshAgentListRef as any}
              />
            </div>
            <div style={{ display: view === 'create' ? 'block' : 'none' }}>
               <CreateAgentWizard 
                 ref={wizardRef} 
                 key={wizardKey} 
                 onBack={() => { /* Handled by header button now */ }}
                 step={wizardStep}
                 setStep={setWizardStep}
               />
            </div>
             <div style={{ display: view === 'edit' ? 'block' : 'none' }}>
                <div>Editing Agent: {selectedAgent?.name} (Not Implemented) <Button onClick={() => setView('list')}>Back</Button></div>
             </div>
          </div>
          {view === 'create' && (
            <div className="flex justify-end items-center gap-4 p-4 border-t flex-shrink-0">
                {wizardStep < 5 ? (
                  <Button type="button" onClick={handleNext}>Next</Button>
                ) : (
                  <Button type="button"
                     onClick={handleFinalCreateAgent}
                     disabled={isCreatingAgent}
                  >
                    {isCreatingAgent ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating...</> : 'Create Agent'}
                  </Button>
                )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialogConfirm
        isOpen={showCloseConfirm}
        onClose={() => setShowCloseConfirm(false)}
        onConfirm={handleConfirmClose}
        title={t('confirmations.exitAgentWizard.title')}
        message={t('confirmations.exitAgentWizard.message')}
        confirmText={t('confirmations.exitAgentWizard.confirm')}
        cancelText={t('confirmations.exitAgentWizard.cancel')}
        confirmVariant="destructive"
      />
      <AgentEditModal
        agent={selectedAgent}
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        onSave={handleSaveAgent}
        userRole={userRole}
      />
    </>
  );
};

export default AgentDashboard;