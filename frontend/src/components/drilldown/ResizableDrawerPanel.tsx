import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { DRAWER_PANEL_MOBILE_WIDTH_CLASS } from './drawerStyles';
import { useResizableDrawerWidth } from './useResizableDrawerWidth';

interface ResizableDrawerPanelProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export default function ResizableDrawerPanel({ children, className, style }: ResizableDrawerPanelProps) {
  const { panelStyle, isResizing, isMobile, onResizeStart } = useResizableDrawerWidth();

  return (
    <div
      className={cn(
        'relative h-full flex flex-col shrink-0',
        isMobile && DRAWER_PANEL_MOBILE_WIDTH_CLASS,
        isResizing && 'select-none',
        className
      )}
      style={{ ...panelStyle, ...style }}
    >
      {!isMobile && (
        <button
          type="button"
          aria-label="Resize drawer"
          onMouseDown={onResizeStart}
          className={cn(
            'absolute left-0 top-0 bottom-0 z-20 w-2 -translate-x-1/2 cursor-col-resize',
            'group touch-none'
          )}
        >
          <span
            className={cn(
              'absolute left-1/2 top-1/2 h-16 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full',
              'bg-border/80 transition-colors',
              'group-hover:bg-primary/70 group-active:bg-primary'
            )}
          />
        </button>
      )}
      {children}
    </div>
  );
}
