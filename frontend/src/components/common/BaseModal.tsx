import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useModalEscape } from '../../services/keyboardShortcuts';

export interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  maxWidth?: string;
  maxHeight?: string;
  headerRight?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  contentClassName?: string;
}

export const BaseModal: React.FC<BaseModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  maxWidth = 'max-w-2xl',
  maxHeight = 'max-h-[85vh]',
  headerRight,
  footer,
  children,
  contentClassName = 'p-5',
}) => {
  useModalEscape(isOpen, onClose);

  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-global-modal bg-black/70 flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-100"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`bg-bg2 border border-border rounded-2xl w-full ${maxWidth} ${maxHeight} shadow-2xl overflow-hidden flex flex-col text-text animate-in fade-in zoom-in-95 duration-150`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="bg-bg3/90 px-5 py-3.5 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && (
              <div className="w-8 h-8 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary shrink-0">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-text truncate">{title}</h3>
              {subtitle && <p className="text-xs text-muted truncate">{subtitle}</p>}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {headerRight}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors"
              title="Close (Esc)"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className={`flex-1 overflow-y-auto dropdown-scroll ${contentClassName}`}>
          {children}
        </div>

        {/* Modal Footer */}
        {footer && (
          <div className="bg-bg3/60 px-5 py-3 border-t border-border flex items-center justify-end gap-3 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
