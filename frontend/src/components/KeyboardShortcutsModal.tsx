import React, { useState } from 'react';
import { Keyboard } from 'lucide-react';
import { BaseModal } from './common';
import { getShortcutDirectory } from '../services/keyboardShortcuts';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [filterCategory, setFilterCategory] = useState<string>('All');
  if (!isOpen) return null;

  const categories = ['All', 'Global', 'POS', 'Learning', 'CRM', 'Purchases', 'Settings'];
  const filtered = filterCategory === 'All'
    ? getShortcutDirectory()
    : getShortcutDirectory().filter(s => s.category === filterCategory);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Keyboard Shortcuts Cheat Sheet"
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4 max-h-[70vh] flex flex-col text-left">
        <p className="text-[11px] text-muted -mt-2">Essential shortcuts for fast on-premise navigation & control</p>

        {/* Category Tabs */}
        <div className="flex gap-1.5 border-b border-glass-border/30 pb-2 flex-wrap shrink-0">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                filterCategory === cat
                  ? 'bg-sky-500/20 text-sky border border-sky-500/30'
                  : 'text-muted hover:text-text hover:bg-bg3/60'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Shortcuts Directory Grid */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
          {filtered.map((item, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between p-3 rounded-xl bg-bg2/40 border border-glass-border/30 hover:bg-bg2/60 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded bg-sky-500/10 text-sky border border-sky-500/20">
                  {item.category}
                </span>
                <span className="text-xs font-semibold text-text">{item.description}</span>
              </div>
              <kbd className="px-2.5 py-1 rounded-lg bg-bg border border-glass-border font-mono text-[11px] font-bold text-sky drop-shadow-sm">
                {item.key}
              </kbd>
            </div>
          ))}
        </div>

        <div className="flex justify-between items-center pt-2 border-t border-glass-border/30 shrink-0">
          <span className="text-[10px] text-muted">Press <kbd className="px-1.5 py-0.5 rounded bg-bg border border-glass-border font-mono">Esc</kbd> anytime to close</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-sky hover:bg-sky-400 text-slate-900 text-xs font-bold transition-all active:scale-95 cursor-pointer"
          >
            Got it
          </button>
        </div>
      </div>
    </BaseModal>
  );
};
