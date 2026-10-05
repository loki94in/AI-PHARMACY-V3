import { useEffect, useRef } from 'react';

// Global Keyboard Shortcut Bus and Event Manager

export interface KeyboardShortcutInfo {
  key: string;
  description: string;
  category: 'Global' | 'POS' | 'Learning' | 'CRM' | 'Purchases' | 'Settings';
}

export const SHORTCUT_DIRECTORY: KeyboardShortcutInfo[] = [
  { key: 'Ctrl + S', description: 'Save current active page form, profile, or open modal', category: 'Global' },
  { key: 'Esc', description: 'Close active open modal, popup, or overlay', category: 'Global' },
  { key: 'Ctrl + /  or  ?', description: 'Toggle Keyboard Shortcuts Cheat Sheet', category: 'Global' },
  { key: 'F11', description: 'Toggle Full-Screen / Windowed Mode', category: 'Global' },
  { key: '↑ / ↓ Arrow', description: 'Switch vertically between item rows in POS & Purchases tables', category: 'POS' },
  { key: '↑ / ↓ Arrow', description: 'Switch vertically between item rows in POS & Purchases tables', category: 'Purchases' },
  { key: 'F2', description: 'Focus medicine search input in POS', category: 'POS' },
  { key: 'F4 / Ctrl + Enter', description: 'Complete & Print Sales Invoice in POS', category: 'POS' },
  { key: 'F8', description: 'Hold current POS bill', category: 'POS' },
  { key: 'Alt + N', description: 'Add new item / row in Purchases or POS', category: 'Purchases' },
  { key: 'Alt + M', description: 'Merge duplicate distributor profiles in Learning page', category: 'Learning' },
];

export const shortcutEvent = {
  triggerSave: () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('app-trigger-save'));
    }
  },
  subscribeSave: (callback: () => void) => {
    if (typeof window === 'undefined') return () => {};
    const handler = () => callback();
    window.addEventListener('app-trigger-save', handler);
    return () => window.removeEventListener('app-trigger-save', handler);
  },
  triggerCloseModal: () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('app-trigger-close-modal'));
    }
  },
  subscribeCloseModal: (callback: () => void) => {
    if (typeof window === 'undefined') return () => {};
    const handler = () => callback();
    window.addEventListener('app-trigger-close-modal', handler);
    return () => window.removeEventListener('app-trigger-close-modal', handler);
  },
  triggerToggleHelp: () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('app-toggle-shortcut-help'));
    }
  },
  subscribeToggleHelp: (callback: () => void) => {
    if (typeof window === 'undefined') return () => {};
    const handler = () => callback();
    window.addEventListener('app-toggle-shortcut-help', handler);
    return () => window.removeEventListener('app-toggle-shortcut-help', handler);
  }
};

// Centralized Modal Stack Manager for Robust Escape Key Handling
export interface ModalStackEntry {
  id: string;
  onClose: () => void | boolean;
  priority?: number;
}

const modalStack: ModalStackEntry[] = [];


const OVERLAY_SELECTOR = '.z-global-modal, .z-modal, .z-drawer, [role="dialog"], [data-modal="true"], .fixed.inset-0';
const CLOSE_BUTTON_SELECTOR = 'button[aria-label*="close" i], button[title*="close" i], button[data-close], button.close-btn, button svg.lucide-x, button svg.lucide-x-circle';
const CLOSE_LABEL = /^(close|cancel|done|dismiss|got it|ok|×|✕|✖)$/i;

function overlayZ(el: HTMLElement): number {
  const z = parseInt(getComputedStyle(el).zIndex, 10);
  return Number.isFinite(z) ? z : 0;
}

/** Closes the top-most rendered popup: its own close/cancel button first, else a backdrop click. */
function dismissTopmostOverlay(): boolean {
  const all = Array.from(document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR)).filter(el => {
    if (el.getClientRects().length === 0) return false; // hidden (e.g. kept-alive page)
    const cs = getComputedStyle(el);
    return cs.pointerEvents !== 'none' && cs.visibility !== 'hidden';
  });
  // Outermost overlays only (a dialog card inside its scrim is part of the scrim)
  const outer = all.filter(el => !all.some(o => o !== el && o.contains(el)));
  // Real popups sit above page content; low-z fixed layout wrappers are not popups
  const popups = outer.filter(el => overlayZ(el) >= 40 || el.matches('.z-global-modal, .z-modal, .z-drawer, [role="dialog"], [data-modal="true"]'));
  popups.sort((a, b) => overlayZ(a) - overlayZ(b)); // stable: DOM order breaks ties
  const top = popups[popups.length - 1];
  if (!top) return false;

  let closeBtn = top.querySelector<HTMLElement>(CLOSE_BUTTON_SELECTOR)?.closest('button') as HTMLElement | null;
  if (!closeBtn) {
    closeBtn = Array.from(top.querySelectorAll<HTMLButtonElement>('button')).find(
      b => !b.disabled && CLOSE_LABEL.test((b.textContent || '').trim())
    ) || null;
  }
  if (closeBtn) {
    closeBtn.click();
    return true;
  }
  // No button: scrim-style popups dismiss on a click that lands on the backdrop itself
  top.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  top.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return true;
}

export const modalManager = {
  push: (id: string, onClose: () => void | boolean, priority = 0) => {
    const existingIndex = modalStack.findIndex(m => m.id === id);
    if (existingIndex !== -1) {
      modalStack.splice(existingIndex, 1);
    }
    modalStack.push({ id, onClose, priority });
  },

  remove: (id: string) => {
    const existingIndex = modalStack.findIndex(m => m.id === id);
    if (existingIndex !== -1) {
      modalStack.splice(existingIndex, 1);
    }
  },

  hasOpenModals: (): boolean => modalStack.length > 0,

  getStackCount: (): number => modalStack.length,

  handleEscape: (): boolean => {
    // 1. Stack-based dismissal (highest priority / top-of-stack first)
    // Entries stay on the stack until their owner unmounts (useModalEscape cleanup), so a
    // close that doesn't take effect on one press is retried on the next instead of orphaned.
    if (modalStack.length > 0) {
      const ordered = modalStack
        .map((entry, idx) => ({ entry, idx }))
        .sort((a, b) => ((b.entry.priority || 0) - (a.entry.priority || 0)) || (b.idx - a.idx));
      for (const { entry } of ordered) {
        try {
          if (entry.onClose() !== false) return true;
        } catch (err) {
          console.error('Error invoking modal close handler on Escape:', err);
          return true;
        }
      }
    }

    // 2. DOM fallback: dismiss the topmost visible popup that never registered with the stack
    if (typeof document !== 'undefined' && dismissTopmostOverlay()) return true;

    return false;
  }
};

/**
 * React hook to register a modal or popup with the global Escape key manager.
 * Automatically handles registration, stack ordering, and unmount cleanup.
 */
export function useModalEscape(isOpen: boolean, onClose: () => void, priority = 0) {
  const idRef = useRef<string>(`modal_${Math.random().toString(36).slice(2, 9)}_${Date.now()}`);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const id = idRef.current;
    modalManager.push(id, () => {
      onCloseRef.current();
    }, priority);

    return () => {
      modalManager.remove(id);
    };
  }, [isOpen, priority]);
}



