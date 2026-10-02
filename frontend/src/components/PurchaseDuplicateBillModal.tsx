import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ExternalLink, X, FileText, ArrowRight, ShieldAlert } from 'lucide-react';
import { useModalEscape } from '../services/keyboardShortcuts';

export interface ExistingDuplicateBill {
  id: number;
  invoice_no: string;
  app_invoice_no?: string;
  date: string;
  total_amount: number;
  distributor_name: string;
  item_count: number;
}

interface Props {
  fy: string;
  existing: ExistingDuplicateBill;
  onOpenExisting: (purchaseId: number) => void;
  onClose: () => void;
}

export const PurchaseDuplicateBillModal: React.FC<Props> = ({
  fy,
  existing,
  onOpenExisting,
  onClose,
}) => {
  useModalEscape(true, onClose);

  const formattedDate = existing.date ? existing.date.slice(0, 10) : '—';
  const formattedAmount = Number(existing.total_amount || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return createPortal(
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4 fade-in">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal Dialog */}
      <div className="relative bg-bg border border-border rounded-2xl w-[95vw] max-w-lg overflow-hidden shadow-2xl slide-up text-text flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-border bg-bg2 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <ShieldAlert size={22} />
            </div>
            <div>
              <h3 className="text-lg font-bold leading-tight text-text">Duplicate Bill Notice</h3>
              <p className="text-xs text-muted mt-0.5">Financial Year {fy || 'Current'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-bg3 text-muted hover:text-text transition-colors"
            title="Close (Esc)"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-300 dark:text-amber-200/90 leading-relaxed">
              Invoice <strong className="text-text font-mono">#{existing.invoice_no}</strong> from{' '}
              <strong className="text-text">{existing.distributor_name}</strong> is already saved in your system for this Financial Year ({fy}). Duplicate bills cannot be created.
            </div>
          </div>

          {/* Conflict Summary Card */}
          <div className="bg-bg2 border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-border/60">
              <span className="text-xs font-semibold text-muted uppercase tracking-wider">Existing Saved Bill</span>
              <span className="text-[11px] font-mono px-2 py-0.5 bg-primary/20 text-primary border border-primary/30 rounded-md font-bold">
                ID #{existing.id}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-muted block text-[10px] uppercase tracking-wider mb-0.5">Distributor</span>
                <span className="font-bold text-text truncate block">{existing.distributor_name}</span>
              </div>
              <div>
                <span className="text-muted block text-[10px] uppercase tracking-wider mb-0.5">Invoice Number</span>
                <span className="font-bold font-mono text-text block">#{existing.invoice_no}</span>
              </div>
              <div>
                <span className="text-muted block text-[10px] uppercase tracking-wider mb-0.5">Invoice Date</span>
                <span className="font-semibold text-text block">{formattedDate}</span>
              </div>
              <div>
                <span className="text-muted block text-[10px] uppercase tracking-wider mb-0.5">Items In Bill</span>
                <span className="font-semibold text-text block">{existing.item_count || '—'} items</span>
              </div>
            </div>

            <div className="pt-2 border-t border-border/60 flex items-center justify-between">
              <span className="text-xs text-muted font-medium">Bill Grand Total:</span>
              <span className="text-base font-extrabold font-mono text-green-400">₹{formattedAmount}</span>
            </div>
          </div>

          <p className="text-[11px] text-muted italic leading-normal">
            To prevent double-counting inventory stock and accounts payable, purchase bills for the same distributor within the same financial year must have unique invoice numbers.
          </p>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-border bg-bg2 flex items-center justify-end gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-muted hover:text-text hover:bg-bg3 border border-border transition-colors"
          >
            Change Invoice No
          </button>
          <button
            type="button"
            onClick={() => onOpenExisting(existing.id)}
            className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-primary hover:brightness-110 shadow-md flex items-center gap-1.5 transition-all"
          >
            <FileText size={14} />
            Open / Edit Existing Bill
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
