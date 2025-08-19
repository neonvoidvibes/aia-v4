"use client";

import React, { useEffect, useRef } from 'react';
import { useChat, type Message } from "@ai-sdk/react";
import { ArrowUp, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { G_DEFAULT_WELCOME_MESSAGE } from '@/lib/themes';

// Simplified markdown formatter from the main chat interface
const formatAssistantMessage = (text: string): string => {
    if (!text) return "";
    let html = text.trim();
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    return html.replace(/\n/g, '<br />');
};

interface WizardChatInterfaceProps {
  agentName: string;
  initialContext: string;
}

const WizardChatInterface: React.FC<WizardChatInterfaceProps> = ({ agentName, initialContext }) => {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: "/api/proxy-chat",
    body: {
      agent: agentName,
      initialContext: initialContext,
    },
    initialMessages: [{
        id: 'initial-wizard-prompt',
        role: 'assistant',
        content: 'I am the Agent Creator Assistant. I will help you draft a system prompt. Describe the new agent\'s purpose. What should it do? What personality should it have?'
    }]
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
                <span dangerouslySetInnerHTML={{ __html: formatAssistantMessage(message.content) }} />
              </div>
            </motion.div>
          );
        })}
        {isLoading && (
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
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
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