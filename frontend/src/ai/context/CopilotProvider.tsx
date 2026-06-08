import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { copilotChat } from '../../api/client';
import { buildContext } from './ContextBuilder';
import { getAgentConfig } from '../router/AgentRouter';
import {
  appendMessage,
  buildScopeKey,
  getMessages,
  setMessages,
} from '../memory/ScopedMemory';
import type {
  ChatMessage,
  CopilotResponse,
  PageContextInput,
  PageType,
} from '../types';

const COPILOT_ENABLED = import.meta.env.VITE_ENABLE_COPILOT !== 'false';

interface CopilotContextValue {
  enabled: boolean;
  isOpen: boolean;
  isLoading: boolean;
  pageContext: PageContextInput | null;
  messages: ChatMessage[];
  lastResponse: CopilotResponse | null;
  agentTitle: string;
  suggestedQuestions: string[];
  scopeKey: string;
  openCopilot: () => void;
  closeCopilot: () => void;
  toggleCopilot: () => void;
  registerPageContext: (ctx: PageContextInput) => void;
  sendMessage: (question: string) => Promise<void>;
  clearConversation: () => void;
}

const CopilotCtx = createContext<CopilotContextValue | undefined>(undefined);

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function CopilotProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pageContext, setPageContext] = useState<PageContextInput | null>(null);
  const [messages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [lastResponse, setLastResponse] = useState<CopilotResponse | null>(null);
  const prevScopeRef = useRef<string>('');

  const scopeKey = useMemo(() => {
    if (!pageContext) return 'default:default';
    return buildScopeKey(pageContext.pageType, pageContext.selectedEntity);
  }, [pageContext]);

  const agent = useMemo(
    () => getAgentConfig((pageContext?.pageType ?? 'executive') as PageType),
    [pageContext?.pageType]
  );

  useEffect(() => {
    if (prevScopeRef.current && prevScopeRef.current !== scopeKey) {
      setLocalMessages(getMessages(scopeKey));
      setLastResponse(null);
    } else if (!prevScopeRef.current) {
      setLocalMessages(getMessages(scopeKey));
    }
    prevScopeRef.current = scopeKey;
  }, [scopeKey]);

  const registerPageContext = useCallback((ctx: PageContextInput) => {
    setPageContext(ctx);
  }, []);

  const sendMessage = useCallback(
    async (question: string) => {
      if (!pageContext || !question.trim() || isLoading) return;

      const userMsg: ChatMessage = {
        id: newId(),
        role: 'user',
        content: question.trim(),
        timestamp: new Date().toISOString(),
      };

      const history = appendMessage(scopeKey, userMsg);
      setLocalMessages([...history]);
      setIsLoading(true);

      try {
        const context = buildContext(pageContext, question.trim());
        const apiMessages = history.slice(0, -1).map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const response = await copilotChat(context, apiMessages);

        const assistantMsg: ChatMessage = {
          id: newId(),
          role: 'assistant',
          content: response.summary,
          timestamp: response.timestamp ?? new Date().toISOString(),
          response,
        };

        const updated = appendMessage(scopeKey, assistantMsg);
        setLocalMessages([...updated]);
        setLastResponse(response);
      } catch (err) {
        const errorMsg: ChatMessage = {
          id: newId(),
          role: 'assistant',
          content: 'Unable to reach the copilot service. Please try again.',
          timestamp: new Date().toISOString(),
          response: {
            summary: 'Unable to reach the copilot service. Please try again.',
            findings: [],
            evidence: [],
            recommended_actions: [],
            confidence: '',
          },
        };
        const updated = appendMessage(scopeKey, errorMsg);
        setLocalMessages([...updated]);
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    },
    [pageContext, isLoading, scopeKey]
  );

  const clearConversation = useCallback(() => {
    setMessages(scopeKey, []);
    setLocalMessages([]);
    setLastResponse(null);
  }, [scopeKey]);

  const value: CopilotContextValue = {
    enabled: COPILOT_ENABLED,
    isOpen,
    isLoading,
    pageContext,
    messages,
    lastResponse,
    agentTitle: agent.title,
    suggestedQuestions: agent.suggestedQuestions,
    scopeKey,
    openCopilot: () => setIsOpen(true),
    closeCopilot: () => setIsOpen(false),
    toggleCopilot: () => setIsOpen((v) => !v),
    registerPageContext,
    sendMessage,
    clearConversation,
  };

  return <CopilotCtx.Provider value={value}>{children}</CopilotCtx.Provider>;
}

export function useCopilot() {
  const ctx = useContext(CopilotCtx);
  if (!ctx) throw new Error('useCopilot must be used within CopilotProvider');
  return ctx;
}

/** Register page context — call from each major page */
export function useRegisterCopilotContext(ctx: PageContextInput | null) {
  const { registerPageContext } = useCopilot();

  useEffect(() => {
    if (ctx) registerPageContext(ctx);
  }, [
    ctx?.pageType,
    ctx?.selectedEntity,
    registerPageContext,
    JSON.stringify(ctx?.entityData),
    JSON.stringify(ctx?.analysisResults),
    JSON.stringify(ctx?.investigationResults),
  ]);
}
