"use client";

import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef, useMemo } from 'react';
import { useChat, type Message } from "@ai-sdk/react";
import { ArrowUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { G_DEFAULT_WELCOME_MESSAGE } from '@/lib/themes';
import ThinkingIndicator from '@/components/ui/ThinkingIndicator';

const SYSTEM_VERSION_MESSAGE_ID = 'system-version-tracker';

// Simplified markdown formatter from the main chat interface
const formatAssistantMessage = (text: string): string => {
    if (!text) return "";
    let html = text.trim();
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    return html.replace(/\n/g, '<br />');
};

// Function to find and extract a system prompt proposal from AI's response.
const extractProposal = (content: string): { proposal: string | null; conversationalText: string } => {
    const response = { proposal: null, conversationalText: content };

    // Look for markdown code blocks (``` ... ```)
    const codeBlockMatch = content.match(/```\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
        const codeBlockContent = codeBlockMatch[1].trim();
        const codeBlock = codeBlockMatch[0];

        // Extract the content inside the code block as the system prompt
        if (codeBlockContent) {
            response.proposal = codeBlockContent;
            // The conversational text is everything *before* the code block.
            response.conversationalText = content.substring(0, content.indexOf(codeBlock)).trim();
        }
    }

    return response;
};


interface WizardChatInterfaceProps {
  wizardSessionId: string;
  agentName: string;
  initialContext: string;
  currentDraftContent: string;
  onNewPromptVersion: (prompt: string) => void;
  onUserSubmit: () => void;
}

const WizardChatInterface = forwardRef<any, WizardChatInterfaceProps>(({ wizardSessionId, agentName, initialContext, currentDraftContent, onNewPromptVersion, onUserSubmit }, ref) => {
  const [isGeneratingProposal, setIsGeneratingProposal] = useState(false);
  const [generatingProposalForMessageId, setGeneratingProposalForMessageId] = useState<string | null>(null);
  const [processedProposalIds, setProcessedProposalIds] = useState(new Set<string>());

  // Memoize the body to ensure useChat hook gets the latest draft content
  const chatApiBody = useMemo(() => ({
    agent: agentName,
    initialContext: initialContext,
    disableRetrieval: true,
    session_id: wizardSessionId,
    currentDraftContent: currentDraftContent,
  }), [agentName, initialContext, wizardSessionId, currentDraftContent]);

  const { messages, input, handleInputChange, handleSubmit, isLoading, setMessages } = useChat({
    // By passing a unique ID here, we ensure that useChat creates a new,
    // isolated conversation that doesn't reuse history from localStorage from previous wizard sessions.
    id: wizardSessionId,
    api: "/api/proxy-chat",
    body: chatApiBody,
    initialMessages: [{
        id: 'initial-wizard-prompt',
        role: 'assistant',
        content: 'I am the Agent Creator Assistant. I will help you draft a system prompt. Describe the new agent\'s purpose. What should it do? What personality should it have?'
    }],
    onFinish: (message) => {
        const { proposal } = extractProposal(message.content);
        if (proposal) {
            console.log("AI proposed a system prompt. Updating editor with new version.");
            onNewPromptVersion(proposal);
        }
    },
    onError: (error) => {
      console.error('[WizardChat] useChat onError:', error);
      let raw = error.message || 'An error occurred.';
      try {
        const parsed = JSON.parse(raw);
        raw = parsed.error || parsed.message || raw;
      } catch {}

      let msg = "I’m having trouble right now. Please try again shortly.";
      if (raw.includes('Unauthorized')) msg = 'Your session may have expired. Please refresh the page.';
      else if (raw.includes('Assistant is temporarily unavailable')) msg = 'The assistant is currently overloaded. Please try again in a minute.';
      else if (raw.includes('rate limit')) msg = "We’re experiencing high traffic. Please try again in a moment.";
      else if (raw.includes('Network error') || raw.includes('Failed to fetch') || raw.includes('Could not connect')) msg = 'Connection failed. Please check your network.';
      else if (raw.includes('Internal Server Error') || raw.includes('500')) msg = 'An internal server error occurred. Please try again later.';
      else if (raw.length < 200) msg = raw;

      toast.error(msg);
    }
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
    if (!lastMessage) return;

    const proposalTrigger = "```";

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
    // Auto-scroll to the bottom only when the user sends a message.
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.role === 'user') {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const onSubmit = (e?: React.FormEvent<HTMLFormElement>) => {
    if (e) e.preventDefault();
    if (input.trim()) {
      onUserSubmit();
      handleSubmit(e); // No longer need to pass data here, it's in the memoized body
    }
  };

  useImperativeHandle(ref, () => ({
    injectSystemMessage: (content: string) => {
      setMessages(prevMessages => {
        // Filter out the previous version-tracker message to move it to the bottom
        const filteredMessages = prevMessages.filter(m => m.id !== SYSTEM_VERSION_MESSAGE_ID);
        
        // Add the new/updated message to the end of the array
        filteredMessages.push({
          id: SYSTEM_VERSION_MESSAGE_ID,
          role: 'system',
          content: content,
          createdAt: new Date(), // Update timestamp
        });
        
        return filteredMessages;
      });
    },
    injectHiddenSystemMessage: (content: string) => {
      setMessages(prevMessages => [
        ...prevMessages,
        {
          id: `hidden-${crypto.randomUUID()}`,
          role: 'system',
          content,
          hidden: true, // <-- not rendered, but still sent to backend
        },
      ]);
    },
    scrollToBottom: () => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }));
  
  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message: Message) => {
          if ((message as any).hidden) return null;
          const isUser = message.role === "user";
          const isSystem = message.role === "system";
          
          const isGeneratingForThisMessage = isGeneratingProposal && generatingProposalForMessageId === message.id;

          let displayContent = message.content;
          
          if (isGeneratingForThisMessage) {
              const proposalIndex = displayContent.indexOf('```');
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
                  "text-base max-[640px]:text-[16px]", // Desktop: text-base (16px), Mobile: forced 16px
                  isUser && "bg-[hsl(var(--input-gray))] text-[hsl(var(--user-message-text-color))]",
                  message.role === 'assistant' && "bg-transparent text-[hsl(var(--assistant-message-text-color))]",
                  isSystem && "text-xs bg-accent/10 text-accent-foreground leading-normal"
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
            className="w-full bg-transparent border-none outline-none px-3 py-2 text-base max-[640px]:text-[16px] text-[hsl(var(--input-field-text-color))]"
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
});

WizardChatInterface.displayName = 'WizardChatInterface';

export default WizardChatInterface;
