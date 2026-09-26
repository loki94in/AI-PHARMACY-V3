import { useEffect, useRef, type RefObject } from 'react';

/**
 * High-performance, zero-reflow dropdown auto-scroller.
 * 
 * Isolates scroll calculations strictly to the container (`container.scrollTo`),
 * completely preventing layout thrashing or window reflows.
 * Uses adaptive physics: smooth animation on individual keypresses, and instantaneous
 * snapping on rapid arrow-key holding to prevent animation queue lag.
 *
 * @param containerRef Reference to the scrollable container element (with overflow-y-auto)
 * @param highlightIndex Current active/selected index in the list
 * @param isOpen Whether the dropdown is currently visible
 * @param selector Optional custom query selector for the highlighted element (default: '[data-highlighted="true"]')
 */
export function useDropdownAutoScroll(
  containerRef: RefObject<HTMLElement | null>,
  highlightIndex: number,
  isOpen: boolean = true,
  selector: string = '[data-highlighted="true"]'
) {
  const lastScrollTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!isOpen || highlightIndex < 0 || !containerRef.current) return;

    const frameId = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;

      const activeEl = container.querySelector(selector) as HTMLElement | null;
      if (!activeEl) return;

      const now = performance.now();
      const timeDelta = now - lastScrollTimeRef.current;
      lastScrollTimeRef.current = now;

      // If user is rapidly holding down arrow key (< 130ms between changes),
      // switch to 'auto' (instant) so animations don't queue up or lag behind keystrokes.
      // Otherwise, use 'smooth' for fluid motion on single presses.
      const behavior: ScrollBehavior = timeDelta < 130 ? 'auto' : 'smooth';

      const containerRect = container.getBoundingClientRect();
      const activeRect = activeEl.getBoundingClientRect();

      // Calculate position relative to container's scroll coordinate system
      const relativeTop = activeRect.top - containerRect.top + container.scrollTop;
      const relativeBottom = relativeTop + activeRect.height;

      const containerTop = container.scrollTop;
      const containerHeight = container.clientHeight;
      const buffer = 16; // 16px breathing room buffer

      if (relativeTop < containerTop + buffer) {
        // Scrolled above visible area -> scroll up to frame item with cushion
        container.scrollTo({
          top: Math.max(0, relativeTop - buffer),
          behavior,
        });
      } else if (relativeBottom > containerTop + containerHeight - buffer) {
        // Scrolled below visible area -> scroll down to frame item with cushion
        container.scrollTo({
          top: relativeBottom - containerHeight + buffer,
          behavior,
        });
      }
    });

    return () => cancelAnimationFrame(frameId);
  }, [highlightIndex, isOpen, containerRef, selector]);
}

export default useDropdownAutoScroll;
