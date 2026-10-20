import { useRef, useState, useCallback, type UIEvent, type RefObject } from 'react';

export interface VirtualWindow {
  /** Attach to the scrollable container. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Index of the first row to render. */
  start: number;
  /** Index one past the last row to render. */
  end: number;
  /** Pixel height of the spacer before rendered rows. */
  topPad: number;
  /** Pixel height of the spacer after rendered rows. */
  bottomPad: number;
  onScroll: (e: UIEvent<HTMLDivElement>) => void;
}

/**
 * Minimal fixed-row-height list virtualization for large tables.
 * Renders only the viewport slice plus overscan; spacer rows preserve
 * total scroll height. O(1) memory per row, no dependencies.
 */
export function useVirtualRows(
  count: number,
  rowHeight = 36,
  viewportHeight = 560,
  overscan = 10,
): VirtualWindow {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visible = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const end = Math.min(count, start + visible);
  const topPad = start * rowHeight;
  const bottomPad = Math.max(0, (count - end) * rowHeight);

  const onScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    setScrollTop((e.target as HTMLDivElement).scrollTop);
  }, []);

  return { containerRef, start, end, topPad, bottomPad, onScroll };
}
