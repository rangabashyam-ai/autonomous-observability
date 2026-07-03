import { useCallback, useEffect, useRef, useState } from 'react';

export const DRAWER_WIDTH_STORAGE_KEY = 'ops-right-drawer-width';
export const DRAWER_MIN_WIDTH_PX = 320;
export const DRAWER_MAX_WIDTH_RATIO = 0.92;
export const DRAWER_DEFAULT_WIDTH_RATIO = 0.5;
const MOBILE_BREAKPOINT_PX = 768;

const widthListeners = new Set<() => void>();
let sharedWidth = readStoredWidth();

function notifyWidthListeners() {
  widthListeners.forEach((listener) => listener());
}

function clampWidth(width: number, viewportWidth = window.innerWidth): number {
  const max = Math.round(viewportWidth * DRAWER_MAX_WIDTH_RATIO);
  return Math.min(max, Math.max(DRAWER_MIN_WIDTH_PX, Math.round(width)));
}

function readStoredWidth(): number {
  if (typeof window === 'undefined') return DRAWER_MIN_WIDTH_PX;
  const stored = localStorage.getItem(DRAWER_WIDTH_STORAGE_KEY);
  if (!stored) return clampWidth(window.innerWidth * DRAWER_DEFAULT_WIDTH_RATIO);
  const parsed = Number.parseInt(stored, 10);
  if (Number.isNaN(parsed)) return clampWidth(window.innerWidth * DRAWER_DEFAULT_WIDTH_RATIO);
  return clampWidth(parsed);
}

function setSharedWidth(width: number) {
  sharedWidth = clampWidth(width);
  localStorage.setItem(DRAWER_WIDTH_STORAGE_KEY, String(sharedWidth));
  notifyWidthListeners();
}

export function useResizableDrawerWidth() {
  const [, bump] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_BREAKPOINT_PX);
  const widthRef = useRef(sharedWidth);

  useEffect(() => {
    const listener = () => {
      widthRef.current = sharedWidth;
      bump((n) => n + 1);
    };
    widthListeners.add(listener);
    return () => {
      widthListeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT_PX;
      setIsMobile(mobile);
      if (!mobile) {
        setSharedWidth(sharedWidth);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onResizeStart = useCallback((event: any) => {
    if (isMobile) return;
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = sharedWidth;
    setIsResizing(true);

    const onMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const next = clampWidth(startWidth + delta);
      widthRef.current = next;
      sharedWidth = next;
      notifyWidthListeners();
    };

    const onUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem(DRAWER_WIDTH_STORAGE_KEY, String(sharedWidth));
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [isMobile]);

  return {
    width: sharedWidth,
    isResizing,
    isMobile,
    onResizeStart,
    panelStyle: isMobile ? undefined : ({ width: `${sharedWidth}px` } as const),
  };
}
