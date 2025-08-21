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
  onRefresh?: () => void;
}

const AgentList: React.FC<AgentListProps> = ({ onEditAgent, onCreateNew, onRefresh }) => {
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

  useEffect(() => {
    if (onRefresh) {
      // Expose the fetch function to the parent
      const handler = () => fetchAgents();
      // This is a bit of a workaround to pass the function up.
      // A more robust solution might use a ref, but this works for this context.
      (onRefresh as any).current = handler;
    }
  }, [onRefresh, fetchAgents]);

  return (
    <div className="h-full flex flex-col">
      <Card className="border-none shadow-none bg-transparent flex-1 flex flex-col min-h-0">
        <CardHeader className="p-0 mb-4 flex-shrink-0">
          <div className="grid grid-cols-[1fr_auto] items-center gap-2">
            <CardTitle className="text-xl md:text-2xl font-bold truncate">Manage Agents</CardTitle>
            <Button onClick={onCreateNew} className="hidden sm:inline-flex shrink-0 whitespace-nowrap">
              <PlusCircle className="mr-2 h-4 w-4" /> Create New Agent
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 flex-1 min-h-0">
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
            <ScrollArea className="h-full">
              <div className="pr-4 pb-24 md:pb-4 touch-pan-y">
                {agents.map((agent) => (
                  <div key={agent.id} className="flex items-center justify-between py-3 border-b">
                    <div className="flex-1 min-w-0 pr-4">
                      <p className="text-base font-semibold truncate">{agent.name}</p>
                      <p className="text-xs text-muted-foreground leading-tight truncate">
                        {agent.description || 'No description provided.'}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={() => onEditAgent(agent)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
      <div className="md:hidden flex-shrink-0 pt-4">
        <Button onClick={onCreateNew} className="w-full">
          <PlusCircle className="mr-2 h-4 w-4" /> Create New Agent
        </Button>
      </div>
    </div>
  );
};

export default AgentList;