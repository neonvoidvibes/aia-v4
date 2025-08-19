"use client";

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import AgentList from './agent-list';
import CreateAgentWizard from './create-agent-wizard';

interface AgentDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  userRole: string | null;
}

const AgentDashboard: React.FC<AgentDashboardProps> = ({ isOpen, onClose, userRole }) => {
  const [view, setView] = useState<'list' | 'create' | 'edit'>('list');
  const [selectedAgent, setSelectedAgent] = useState<any | null>(null);

  const handleAgentCreated = () => {
    setView('list'); // Switch back to the list view after creation
  };

  const renderContent = () => {
    switch (view) {
      case 'create':
        return <CreateAgentWizard onBack={() => setView('list')} onAgentCreated={handleAgentCreated} />;
      case 'edit':
        // This will be implemented in Phase 3
        return <div>Editing Agent: {selectedAgent?.name} (Not Implemented) <Button onClick={() => setView('list')}>Back</Button></div>;
      case 'list':
      default:
        return (
          <AgentList
            onCreateNew={() => setView('create')}
            onEditAgent={(agent) => {
              setSelectedAgent(agent);
              // For now, this just console logs. In Phase 3 it will switch view.
              console.log("Edit clicked for:", agent.name);
              // setView('edit'); // Uncomment in Phase 3
            }}
          />
        );
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-3xl h-[85vh] flex flex-col"
        onPointerDownOutside={(e) => e.preventDefault()} // Prevents closing on outside click
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
          {renderContent()}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AgentDashboard;