import type { ChatMessage } from '../types';

const store = new Map<string, ChatMessage[]>();

export function buildScopeKey(pageType: string, selectedEntity: string): string {
  return `${pageType}:${selectedEntity || 'default'}`;
}

export function getMessages(scopeKey: string): ChatMessage[] {
  return store.get(scopeKey) ?? [];
}

export function setMessages(scopeKey: string, messages: ChatMessage[]): void {
  store.set(scopeKey, messages);
}

export function appendMessage(scopeKey: string, message: ChatMessage): ChatMessage[] {
  const current = getMessages(scopeKey);
  const updated = [...current, message];
  setMessages(scopeKey, updated);
  return updated;
}

export function clearScope(scopeKey: string): void {
  store.delete(scopeKey);
}

export function clearAll(): void {
  store.clear();
}
