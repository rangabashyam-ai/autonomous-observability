import { Bot, X } from 'lucide-react';
import { useCopilot } from '../../ai/context/CopilotProvider';
import ChatWindow from './ChatWindow';
import { cn } from '../../lib/cn';

export default function CopilotPanel() {
  const { enabled, isOpen, toggleCopilot, closeCopilot, pageContext, agentTitle } = useCopilot();

  if (!enabled) return null;

  return (
    <>
      <button
        onClick={toggleCopilot}
        className={cn(
          'fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-200',
          isOpen
            ? 'bg-card border border-border text-text-secondary scale-90'
            : 'bg-primary text-white hover:bg-primary/90 hover:scale-105'
        )}
        aria-label="Toggle AI Copilot"
      >
        {isOpen ? <X className="h-5 w-5" /> : <Bot className="h-6 w-6" />}
      </button>

      <div
        className={cn(
          'fixed top-0 right-0 z-30 h-full w-[400px] max-w-[90vw] bg-card border-l border-border shadow-2xl flex flex-col transition-transform duration-300',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text-primary">AI Copilot</h2>
              <p className="text-[10px] text-text-secondary">
                {agentTitle}
                {pageContext?.selectedEntity && (
                  <> · <span className="text-primary">{pageContext.selectedEntity}</span></>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={closeCopilot}
            className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-card-hover text-text-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 py-2 bg-primary/5 border-b border-border shrink-0">
          <p className="text-[10px] text-text-secondary">
            <span className="font-semibold text-primary">Strict context</span>
            {' — '}Answers only from active investigation. No cross-entity data.
          </p>
        </div>

        <div className="flex-1 min-h-0">
          <ChatWindow />
        </div>
      </div>

      {isOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/20 backdrop-blur-[1px] lg:hidden"
          onClick={closeCopilot}
        />
      )}
    </>
  );
}
