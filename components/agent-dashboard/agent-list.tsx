"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, AlertTriangle, Pencil, PlusCircle } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Agent {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

interface AgentListProps {
  onEditAgent: (agent: Agent) => void;
  onCreateNew: () => void;
}

const AgentList: React.FC<AgentListProps> = ({ onEditAgent, onCreateNew }) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/agent/list-managed');
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch agents');
      }
      const data = await response.json();
      setAgents(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Agent Management</h2>
        <Button onClick={onCreateNew}>
          <PlusCircle className="mr-2 h-4 w-4" /> Create New Agent
        </Button>
      </div>
      
      {isLoading ? (
        <div className="flex justify-center items-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center text-destructive py-10">
          <AlertTriangle className="h-8 w-8 mb-2" />
          <p>Error loading agents:</p>
          <p className="text-sm">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchAgents} className="mt-4">
            Retry
          </Button>
        </div>
      ) : (
        <ScrollArea className="h-[60vh] pr-4">
          <div className="space-y-3">
            {agents.map((agent) => (
              <Card key={agent.id}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-base font-medium">{agent.name}</CardTitle>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEditAgent(agent)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {agent.description || 'No description provided.'}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};

export default AgentList;