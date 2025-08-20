"use client";

import React, { useEffect, useRef, useState } from 'react';
import { useChat, type Message } from "@ai-sdk/react";
import { ArrowUp, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { G_DEFAULT_WELCOME_MESSAGE } from '@/lib/themes';
import ThinkingIndicator from '@/components/ui/ThinkingIndicator';

// Simplified markdown formatter from the main chat interface
const formatAssistantMessage = (text: string): string => {
    if (!text) return "";
    let html = text.trim();
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    return html.replace(/\n/g, '<br />');
};

// Function to find, parse, and extract a system prompt proposal from AI's response.
const extractProposal = (content: string): { proposal: string | null; conversationalText: string } => {
    const response = { proposal: null, conversationalText: content };
    try {
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```|({[\s\S]*})/);
        if (jsonMatch) {
            const jsonString = jsonMatch[1] || jsonMatch[2];
            const jsonBlock = jsonMatch[0];
            const parsed = JSON.parse(jsonString);
            if (parsed && typeof parsed.system_prompt === 'string') {
                response.proposal = parsed.system_prompt;
                // The conversational text is everything *before* the JSON block.
                response.conversationalText = content.substring(0, content.indexOf(jsonBlock)).trim();
            }
        }
    } catch (e) {
        console.error("Could not parse AI prompt proposal:", e);
    }
    return response;
};


interface WizardChatInterfaceProps {
  wizardSessionId: string;
  agentName: string;
  initialContext: string;
  currentDraftContent: string;
  onPromptProposal: (prompt: string) => void;
}

const WizardChatInterface: React.FC<WizardChatInterfaceProps> = ({ wizardSessionId, agentName, initialContext, currentDraftContent, onPromptProposal }) => {
  const [isGeneratingProposal, setIsGeneratingProposal] = useState(false);
  const [generatingProposalForMessageId, setGeneratingProposalForMessageId] = useState<string | null>(null);
  const [processedProposalIds, setProcessedProposalIds] = useState(new Set<string>());

  const { messages, input, handleInputChange, handleSubmit, isLoading, setMessages } = useChat({
    // By passing a unique ID here, we ensure that useChat creates a new,
    // isolated conversation that doesn't reuse history from localStorage from previous wizard sessions.
    id: wizardSessionId,
    api: "/api/proxy-chat",
    body: {
      agent: agentName,
      initialContext: initialContext,
      currentDraftContent: currentDraftContent,
      disableRetrieval: true, // Explicitly disable RAG for this process
      // Pass the unique session ID in the body as well, so the backend can differentiate sessions.
      session_id: wizardSessionId
    },
    initialMessages: [{
        id: 'initial-wizard-prompt',
        role: 'assistant',
        content: 'I am the Agent Creator Assistant. I will help you draft a system prompt. Describe the new agent\'s purpose. What should it do? What personality should it have?'
    }],
    onFinish: (message) => {
        const { proposal } = extractProposal(message.content);
        if (proposal) {
            console.log("AI proposed a system prompt. Updating editor.");
            onPromptProposal(proposal);
        }
    }
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
    if (!lastMessage) return;

    const proposalTrigger = "```json";

    // Phase 1: Detect proposal start during the stream to show the "working" indicator.
    if (isLoading && lastMessage.role === 'assistant' && !isGeneratingProposal) {
        if (lastMessage.content.includes(proposalTrigger)) {
            console.log("[Doc Update] Proposal detected during stream for message:", lastMessage.id);
            setIsGeneratingProposal(true);
            setGeneratingProposalForMessageId(lastMessage.id);
        }
    }

    // Phase 2: Process the completed proposal after the stream finishes.
    if (!isLoading && lastMessage.role === 'assistant' && !processedProposalIds.has(lastMessage.id)) {
        const { proposal, conversationalText } = extractProposal(lastMessage.content);
        
        if (proposal) {
            // End the "generating proposal" UI state
            setIsGeneratingProposal(false);
            setGeneratingProposalForMessageId(null);
            
            // Permanently clean the message in the UI state
            setMessages(prevMessages => {
                const newMessages = [...prevMessages];
                const targetMessage = newMessages.find(m => m.id === lastMessage.id);
                if (targetMessage) {
                    targetMessage.content = conversationalText || "I've drafted a new version of the prompt in the editor on the right.";
                }
                return newMessages;
            });

            // Mark as processed
            setProcessedProposalIds(prev => new Set(prev).add(lastMessage.id));
        }
    }
  }, [messages, isLoading, isGeneratingProposal, processedProposalIds, setMessages]);


  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const onSubmit = (e?: React.FormEvent<HTMLFormElement>) => {
    if (e) e.preventDefault();
    if (input.trim()) {
      handleSubmit(e);
    }
  };
  
  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message: Message) => {
          const isUser = message.role === "user";
          
          const isGeneratingForThisMessage = isGeneratingProposal && generatingProposalForMessageId === message.id;

          let displayContent = message.content;
          
          if (isGeneratingForThisMessage) {
              const proposalIndex = displayContent.indexOf('```json');
              if (proposalIndex !== -1) {
                  displayContent = displayContent.substring(0, proposalIndex).trim();
              }
          }

          return (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={cn("flex", isUser ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "message-bubble max-w-[85%] px-4 py-2 rounded-2xl",
                  isUser
                    ? "bg-[hsl(var(--input-gray))] text-[hsl(var(--user-message-text-color))]"
                    : "bg-transparent text-[hsl(var(--assistant-message-text-color))]"
                )}
              >
                <span dangerouslySetInnerHTML={{ __html: formatAssistantMessage(displayContent) }} />
              </div>
            </motion.div>
          );
        })}
        {isGeneratingProposal && (
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="flex justify-start"
            >
                <ThinkingIndicator text="Working..." showTime={false} />
            </motion.div>
        )}
        {isLoading && !isGeneratingProposal && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="flex justify-start"
          >
            <div className="message-bubble px-4 py-2 rounded-2xl flex items-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </motion.div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="p-2 border-t">
        <div className="relative flex items-center">
          <input
            type="text"
            name={`wizard-chat-${wizardSessionId}`}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); } }}
            placeholder="Describe the agent..."
            className="w-full bg-transparent border-none outline-none px-3 py-2 text-sm text-[hsl(var(--input-field-text-color))]"
            disabled={isLoading}
          />
          <button
            type="button"
            onClick={() => onSubmit()}
            disabled={isLoading || !input.trim()}
            className="p-2 rounded-full disabled:opacity-50 transition-colors"
          >
            <ArrowUp className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default WizardChatInterface;