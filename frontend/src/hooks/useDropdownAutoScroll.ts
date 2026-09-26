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
/**
 * Resolves the actual scrollable element, ascending from activeEl up to rootContainer,
 * or searching for an inner scroll container if rootContainer is non-scrollable (e.g., has a pinned header).
 */
function resolveScrollContainer(activeEl: HTMLElement, rootContainer: HTMLElement): HTMLElement {
  // 1. Ascend parent chain between activeEl and rootContainer
  let curr = activeEl.parentElement;
  while (curr && curr !== rootContainer) {
    const style = window.getComputedStyle(curr);
    const overflowY = style.overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return curr;
    }
    curr = curr.parentElement;
  }

  // 2. Check if rootContainer itself is scrollable
  const rootStyle = window.getComputedStyle(rootContainer);
  if (rootStyle.overflowY === 'auto' || rootStyle.overflowY === 'scroll') {
    return rootContainer;
  }

  // 3. Fallback: inspect rootContainer for a scrollable child container containing activeEl
  const childScrollable = rootContainer.querySelector('.overflow-y-auto, [data-scrollable="true"]') as HTMLElement | null;
  if (childScrollable && childScrollable.contains(activeEl)) {
    return childScrollable;
  }

  return rootContainer;
}

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
      const rootContainer = containerRef.current;
      if (!rootContainer) return;

      const activeEl = rootContainer.querySelector(selector) as HTMLElement | null;
      if (!activeEl) return;

      const scrollContainer = resolveScrollContainer(activeEl, rootContainer);

      const now = performance.now();
      const timeDelta = now - lastScrollTimeRef.current;
      lastScrollTimeRef.current = now;

      // If user is rapidly holding down arrow key (< 130ms between changes),
      // switch to 'auto' (instant) so animations don't queue up or lag behind keystrokes.
      // Otherwise, use 'smooth' for fluid motion on single presses.
      const behavior: ScrollBehavior = timeDelta < 130 ? 'auto' : 'smooth';

      const containerRect = scrollContainer.getBoundingClientRect();
      const activeRect = activeEl.getBoundingClientRect();

      // Calculate position relative to container's scroll coordinate system
      const relativeTop = activeRect.top - containerRect.top + scrollContainer.scrollTop;
      const relativeBottom = relativeTop + activeRect.height;

      const containerTop = scrollContainer.scrollTop;
      const containerHeight = scrollContainer.clientHeight;
      const buffer = 16; // 16px breathing room buffer

      if (highlightIndex === 0) {
        scrollContainer.scrollTo({
          top: 0,
          behavior,
        });
      } else if (relativeTop < containerTop + buffer) {
        // Scrolled above visible area -> scroll up to frame item with cushion
        scrollContainer.scrollTo({
          top: Math.max(0, relativeTop - buffer),
          behavior,
        });
      } else if (relativeBottom > containerTop + containerHeight - buffer) {
        // Scrolled below visible area -> scroll down to frame item with cushion
        scrollContainer.scrollTo({
          top: relativeBottom - containerHeight + buffer,
          behavior,
        });
      }
    });

    return () => cancelAnimationFrame(frameId);
  }, [highlightIndex, isOpen, containerRef, selector]);
}

export default useDropdownAutoScroll;
