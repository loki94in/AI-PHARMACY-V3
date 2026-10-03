import React from 'react';
import { Clock } from 'lucide-react';
import { BaseModal } from '../../components/common';
import { formatDisplayDate } from '../../utils/date';

export interface LocalPriceHistoryRow {
  date?: string;
  invoice_date?: string;
  invoice_no?: string;
  distributor_name?: string;
  batch_no?: string | null;
  expiry_date?: string | null;
  rate: number;
  mrp: number;
  quantity?: number;
  free_qty?: number;
  cd_rs: number;
  cd_per?: number;
  net_rate: number;
}

interface CartPurchaseHistoryModalProps {
  target: {
    medicineId?: number;
    medicineName: string;
    loading: boolean;
    history: LocalPriceHistoryRow[];
  } | null;
  onClose: () => void;
}

export const CartPurchaseHistoryModal: React.FC<CartPurchaseHistoryModalProps> = ({
  target,
  onClose,
}) => {
  if (!target) return null;

  return (
    <BaseModal
      isOpen={Boolean(target)}
      onClose={onClose}
      title="PURCHASE INVOICE HISTORY"
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4 max-h-[70vh] flex flex-col">
        <p className="text-xs text-muted font-bold -mt-2">{target.medicineName}</p>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
          {target.loading ? (
            <div className="flex items-center justify-center py-16 text-muted gap-2 text-xs">
              <span className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              <span>Loading purchase history from database...</span>
            </div>
          ) : target.history.length === 0 ? (
            <div className="text-center py-16 space-y-2">
              <Clock size={36} className="text-muted/40 mx-auto" />
              <p className="text-sm font-bold text-text">No Purchase Invoices Found</p>
              <p className="text-xs text-muted">No historical purchase bills exist for this medicine in the database.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-muted flex items-center justify-between">
                <span>Found <strong className="text-text font-bold">{target.history.length}</strong> previous invoice records</span>
                <span className="text-[10px] text-muted font-bold">Sorted by most recent</span>
              </div>
              <div className="divide-y divide-glass-border/30 border border-glass-border rounded-xl overflow-hidden bg-bg/30">
                {target.history.map((h, i) => (
                  <div key={i} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs hover:bg-bg/60 transition-colors">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <strong className="text-text font-bold">{h.distributor_name}</strong>
                        {h.invoice_no && (
                          <span className="text-[10px] font-mono text-muted bg-bg px-1.5 py-0.2 rounded border border-glass-border">
                            Inv: {h.invoice_no}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted flex items-center gap-3 flex-wrap">
                        <span>Date: <strong className="text-text font-mono">{h.invoice_date ? formatDisplayDate(h.invoice_date) : 'Past'}</strong></span>
                        {h.batch_no && <span>Batch: <strong className="text-text font-mono">{h.batch_no}</strong></span>}
                        {h.expiry_date && <span>Exp: <strong className="text-text font-mono">{h.expiry_date}</strong></span>}
                        <span>Qty: <strong className="text-text font-mono">{h.quantity}</strong> {h.free_qty ? `(+${h.free_qty} Free)` : ''}</span>
                      </div>
                    </div>

                    <div className="text-right sm:text-right shrink-0">
                      <div className="text-[10px] text-muted">Net Rate / Unit</div>
                      <div className="text-sm font-black font-mono text-text">
                        ₹{h.net_rate?.toFixed(2) || h.rate?.toFixed(2)}
                      </div>
                      {h.mrp > 0 && <div className="text-[10px] text-muted font-mono">MRP: ₹{h.mrp.toFixed(2)}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="bg-bg3/60 px-2 py-3 border-t border-glass-border flex items-center justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-bold text-muted hover:text-text hover:bg-bg3 transition-all cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </BaseModal>
  );
};
