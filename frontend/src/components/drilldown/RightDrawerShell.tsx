import { createPortal } from 'react-dom';
import { Children, cloneElement, isValidElement } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import ResizableDrawerPanel from './ResizableDrawerPanel';
import DrawerAIAssistant, { type DrawerAIAssistantProps } from './DrawerAIAssistant';
import { defaultDrawerAIProps } from './drawerAIHelpers';

/** Marker for reliably injecting AI into scrollable drawer bodies */
export const RIGHT_DRAWER_BODY_MARKER = Symbol('RightDrawerBody');

interface RightDrawerShellProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  panelClassName?: string;
  zIndexClass?: string;
  ariaLabel?: string;
  aiAssistant?: DrawerAIAssistantProps | null;
  disableAutoAI?: boolean;
}

function isRightDrawerBody(type: unknown): boolean {
  return (
    typeof type === 'function' &&
    (type as { [RIGHT_DRAWER_BODY_MARKER]?: boolean })[RIGHT_DRAWER_BODY_MARKER] === true
  );
}

function injectAIIntoBody(children: ReactNode, ai: DrawerAIAssistantProps): ReactNode {
  return Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    if (isRightDrawerBody(child.type)) {
      const props = child.props as { aiAssistant?: DrawerAIAssistantProps | null };
      return cloneElement(child, {
        aiAssistant: props.aiAssistant ?? ai,
      } as any);
    }
    return child;
  });
}

export default function RightDrawerShell({
  isOpen,
  onClose,
  children,
  className,
  panelClassName,
  zIndexClass = 'z-50',
  ariaLabel = 'Details drawer',
  aiAssistant,
  disableAutoAI = false,
}: RightDrawerShellProps) {
  if (!isOpen) return null;

  const resolvedAI =
    aiAssistant === null
      ? null
      : aiAssistant ??
        (!disableAutoAI && ariaLabel
          ? defaultDrawerAIProps({
              selectedEntity: ariaLabel.replace(/^Details drawer$/, 'this view').replace(/^Incident /, 'Incident '),
              pageType: ariaLabel.toLowerCase().includes('incident') ? 'incident' : 'service',
              entityData: { label: ariaLabel },
            })
          : null);

  return createPortal(
    <div
      className={cn('fixed inset-0 flex justify-end', zIndexClass, className)}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <ResizableDrawerPanel
        className={cn(
          'bg-card border-l border-border shadow-2xl overflow-hidden animate-in slide-in-from-right duration-300',
          panelClassName
        )}
      >
        {resolvedAI ? injectAIIntoBody(children, resolvedAI) : children}
      </ResizableDrawerPanel>
    </div>,
    document.body
  );
}

export function RightDrawerHeader({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border shrink-0 bg-card">
      <div className="min-w-0 flex-1">
        {children ?? (
          <>
            <h2 className="text-sm font-semibold text-text-primary leading-snug">{title}</h2>
            {subtitle && <p className="text-xs text-text-secondary mt-0.5">{subtitle}</p>}
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-card-hover transition-colors"
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function RightDrawerBody({
  children,
  className,
  aiAssistant,
}: {
  children: ReactNode;
  className?: string;
  aiAssistant?: DrawerAIAssistantProps | null;
}) {
  return (
    <div className={cn('flex-1 overflow-y-auto', className)}>
      {children}
      {aiAssistant && <DrawerAIAssistant {...aiAssistant} embedded />}
    </div>
  );
}
RightDrawerBody[RIGHT_DRAWER_BODY_MARKER] = true;
