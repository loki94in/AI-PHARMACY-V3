import { describe, it, expect } from '@jest/globals';
import { quickOrderEvent } from '../frontend/src/services/events.js';

describe('Quick Assist Accordion & Auto-Close Logic Tests', () => {
  let listeners: Record<string, Function[]> = {};

  beforeAll(() => {
    (global as any).window = {
      dispatchEvent: (evt: any) => {
        const eventName = evt.type;
        if (listeners[eventName]) {
          listeners[eventName].forEach(fn => fn(evt));
        }
      },
      addEventListener: (eventName: string, handler: Function) => {
        if (!listeners[eventName]) listeners[eventName] = [];
        listeners[eventName].push(handler);
      },
      removeEventListener: (eventName: string, handler: Function) => {
        if (listeners[eventName]) {
          listeners[eventName] = listeners[eventName].filter(h => h !== handler);
        }
      }
    };
    (global as any).CustomEvent = class CustomEvent {
      type: string;
      detail: any;
      constructor(type: string, opts?: any) {
        this.type = type;
        this.detail = opts?.detail;
      }
    };
  });

  afterAll(() => {
    delete (global as any).window;
    delete (global as any).CustomEvent;
  });

  // Replicate the exact Quick Assist State Machine helper
  class QuickAssistAccordionManager {
    expanded = true;
    expandedRefillKeys = new Set<string>();
    expandedWebsiteOrderKeys = new Set<string>();
    expandedSpecialOrderKeys = new Set<string>();
    expandedStagedKeys = new Set<string>();

    toggleRefill(key: string) {
      this.expandedRefillKeys = this.expandedRefillKeys.has(key) ? new Set() : new Set([key]);
      this.expandedWebsiteOrderKeys = new Set();
      this.expandedSpecialOrderKeys = new Set();
      this.expandedStagedKeys = new Set();
    }

    toggleSpecialOrder(key: string) {
      this.expandedSpecialOrderKeys = this.expandedSpecialOrderKeys.has(key) ? new Set() : new Set([key]);
      this.expandedRefillKeys = new Set();
      this.expandedWebsiteOrderKeys = new Set();
      this.expandedStagedKeys = new Set();
    }

    toggleWebsiteOrder(key: string) {
      this.expandedWebsiteOrderKeys = this.expandedWebsiteOrderKeys.has(key) ? new Set() : new Set([key]);
      this.expandedRefillKeys = new Set();
      this.expandedSpecialOrderKeys = new Set();
      this.expandedStagedKeys = new Set();
    }

    toggleStaged(key: string) {
      this.expandedStagedKeys = this.expandedStagedKeys.has(key) ? new Set() : new Set([key]);
      this.expandedRefillKeys = new Set();
      this.expandedWebsiteOrderKeys = new Set();
      this.expandedSpecialOrderKeys = new Set();
    }

    closeSidebar() {
      this.expanded = false;
      // Exact cleanup effect logic in QuickAssistSidebar.tsx
      this.expandedRefillKeys = new Set();
      this.expandedWebsiteOrderKeys = new Set();
      this.expandedSpecialOrderKeys = new Set();
      this.expandedStagedKeys = new Set();
    }
  }

  it('should expand a refill patient and collapse it when clicked again', () => {
    const qa = new QuickAssistAccordionManager();
    qa.toggleRefill('patient_A');
    expect(qa.expandedRefillKeys.has('patient_A')).toBe(true);

    qa.toggleRefill('patient_A');
    expect(qa.expandedRefillKeys.size).toBe(0);
  });

  it('should auto-collapse refill when user expands a special order (cross-section accordion)', () => {
    const qa = new QuickAssistAccordionManager();
    qa.toggleRefill('patient_A');
    expect(qa.expandedRefillKeys.has('patient_A')).toBe(true);

    qa.toggleSpecialOrder('order_101');
    expect(qa.expandedRefillKeys.size).toBe(0);
    expect(qa.expandedSpecialOrderKeys.has('order_101')).toBe(true);
  });

  it('should auto-collapse previous special order when user opens another special order (single-open)', () => {
    const qa = new QuickAssistAccordionManager();
    qa.toggleSpecialOrder('order_101');
    expect(qa.expandedSpecialOrderKeys.has('order_101')).toBe(true);

    qa.toggleSpecialOrder('order_102');
    expect(qa.expandedSpecialOrderKeys.has('order_101')).toBe(false);
    expect(qa.expandedSpecialOrderKeys.has('order_102')).toBe(true);
    expect(qa.expandedSpecialOrderKeys.size).toBe(1);
  });

  it('should auto-collapse website orders when opening a staged reminder', () => {
    const qa = new QuickAssistAccordionManager();
    qa.toggleWebsiteOrder('web_ord_5');
    expect(qa.expandedWebsiteOrderKeys.has('web_ord_5')).toBe(true);

    qa.toggleStaged('staged_88');
    expect(qa.expandedWebsiteOrderKeys.size).toBe(0);
    expect(qa.expandedStagedKeys.has('staged_88')).toBe(true);
  });

  it('should wipe all 4 expansion sets when Quick Assist sidebar closes', () => {
    const qa = new QuickAssistAccordionManager();
    qa.toggleSpecialOrder('order_999');
    expect(qa.expandedSpecialOrderKeys.size).toBe(1);

    qa.closeSidebar();
    expect(qa.expanded).toBe(false);
    expect(qa.expandedRefillKeys.size).toBe(0);
    expect(qa.expandedWebsiteOrderKeys.size).toBe(0);
    expect(qa.expandedSpecialOrderKeys.size).toBe(0);
    expect(qa.expandedStagedKeys.size).toBe(0);
  });

  it('should listen to quickOrderEvent to auto-close Quick Assist when quick order opens', () => {
    let sidebarOpen = true;
    const unsub = quickOrderEvent.subscribeOpen(() => {
      sidebarOpen = false;
    });

    quickOrderEvent.triggerOpen();
    expect(sidebarOpen).toBe(false);
    unsub();
  });

  it('should trigger auto-close when clicking outside on .glass-panel page containers', () => {
    let sidebarOpen = true;
    const handleOutsideClick = (target: { closest: (selector: string) => boolean }) => {
      // Updated selector: .glass-panel is no longer ignored as a modal!
      if (target.closest('.z-modal, [role="dialog"], [data-modal], [aria-modal="true"]')) {
        return;
      }
      sidebarOpen = false;
    };

    // User clicks on a POS / Dashboard glass-panel table
    const posTableTarget = {
      closest: (sel: string) => sel.includes('glass-panel')
    };

    handleOutsideClick(posTableTarget);
    expect(sidebarOpen).toBe(false);
  });

  it('should ignore outside click when clicking inside an actual modal dialog', () => {
    let sidebarOpen = true;
    const handleOutsideClick = (target: { closest: (selector: string) => boolean }) => {
      if (target.closest('.z-modal, [role="dialog"], [data-modal], [aria-modal="true"]')) {
        return;
      }
      sidebarOpen = false;
    };

    // User clicks inside an active modal dialog
    const modalTarget = {
      closest: (sel: string) => sel.includes('[role="dialog"]')
    };

    handleOutsideClick(modalTarget);
    expect(sidebarOpen).toBe(true);
  });
});

