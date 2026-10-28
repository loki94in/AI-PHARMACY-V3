import { useEffect, useRef, type RefObject } from 'react';

export interface UseOnClickOutsideOptions {
  enabled?: boolean;
  closeOnEscape?: boolean;
}

/**
 * Hook to handle clicks outside of a specified element (or list of elements),
 * with built-in Escape key support and stabilized handler reference to avoid
 * re-binding global listeners on every render.
 */
export function useOnClickOutside<T extends HTMLElement = HTMLElement>(
  ref: RefObject<T | null> | Array<RefObject<HTMLElement | null>>,
  handler: (event: MouseEvent | TouchEvent | KeyboardEvent) => void,
  options?: UseOnClickOutsideOptions
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const enabled = options?.enabled ?? true;
  const closeOnEscape = options?.closeOnEscape ?? true;

  useEffect(() => {
    if (!enabled) return;

    const listener = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (!target) return;

      const refs = Array.isArray(ref) ? ref : [ref];
      const clickedInside = refs.some(r => r.current && r.current.contains(target));
      if (clickedInside) {
        return;
      }
      handlerRef.current(event);
    };

    const keyListener = (event: KeyboardEvent) => {
      if (closeOnEscape && event.key === 'Escape') {
        handlerRef.current(event);
      }
    };

    document.addEventListener('mousedown', listener);
    document.addEventListener('touchstart', listener);
    if (closeOnEscape) {
      document.addEventListener('keydown', keyListener);
    }

    return () => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
      if (closeOnEscape) {
        document.removeEventListener('keydown', keyListener);
      }
    };
  }, [ref, enabled, closeOnEscape]);
}
