import React from 'react';
import { MessageSquare, Truck, Send } from 'lucide-react';
import { BaseModal } from '../../components/common';

export interface BatchSummaryItem {
  storeId: number;
  storeName: string;
  isMapped: boolean;
  totalQty: number;
  totalAmount: number;
}

export interface DeliveryBoyItem {
  id?: number;
  name: string;
  whatsapp_number?: string;
  is_active?: number;
}

interface BatchDispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  deliveryBoysList: DeliveryBoyItem[];
  bulkApplyDeliveryBoyId: string;
  setBulkApplyDeliveryBoyId: (val: string) => void;
  selectedBatchDeliveryBoys: Record<number, number | null>;
  setSelectedBatchDeliveryBoys: React.Dispatch<React.SetStateAction<Record<number, number | null>>>;
  batchSummaryList: BatchSummaryItem[];
  finalBatchTotalQty: number;
  finalBatchTotalAmount: number;
  isSendingBatchWhatsApp: boolean;
  onConfirmSend: () => void;
}

export const BatchDispatchModal: React.FC<BatchDispatchModalProps> = ({
  isOpen,
  onClose,
  deliveryBoysList,
  bulkApplyDeliveryBoyId,
  setBulkApplyDeliveryBoyId,
  selectedBatchDeliveryBoys,
  setSelectedBatchDeliveryBoys,
  batchSummaryList,
  finalBatchTotalQty,
  finalBatchTotalAmount,
  isSendingBatchWhatsApp,
  onConfirmSend,
}) => {
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Confirm WhatsApp Order Dispatch"
      maxWidth="max-w-2xl"
    >
      <div className="space-y-3 max-h-[75vh] flex flex-col">
        <p className="text-[11px] text-muted -mt-2">Review today's orders & values before sending</p>

        {/* Quick Bulk Staff Assignment Header */}
        {deliveryBoysList.length > 0 && (
          <div className="bg-bg3/60 px-4 py-2.5 rounded-xl border border-glass-border flex flex-wrap items-center justify-between gap-2.5 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-muted flex items-center gap-1">
                <Truck size={13} className="text-primary" /> Assign all to:
              </span>
              <select
                value={bulkApplyDeliveryBoyId}
                onChange={(e) => setBulkApplyDeliveryBoyId(e.target.value)}
                className="text-xs px-2.5 py-1.5 rounded-xl bg-bg border border-glass-border text-text font-medium focus:outline-none focus:border-primary transition-all cursor-pointer"
              >
                <option value="">-- Choose Delivery Person --</option>
                {deliveryBoysList.map((b) => (
                  <option key={b.id} value={b.id}>
                    👤 {b.name} {b.whatsapp_number ? `(${b.whatsapp_number.slice(-4)})` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!bulkApplyDeliveryBoyId}
                onClick={() => {
                  const boyId = Number(bulkApplyDeliveryBoyId);
                  if (!boyId) return;
                  setSelectedBatchDeliveryBoys((prev) => {
                    const next = { ...prev };
                    batchSummaryList.forEach((item) => {
                      next[item.storeId] = boyId;
                    });
                    return next;
                  });
                }}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-primary text-white hover:opacity-90 transition-all disabled:opacity-40 active:scale-95 cursor-pointer shadow-sm"
              >
                Apply to All
              </button>
            </div>
            <span className="text-[10px] font-mono text-muted bg-bg px-2 py-1 rounded-lg border border-glass-border/40">
              {deliveryBoysList.length} staff registered
            </span>
          </div>
        )}

        {/* Modal Body: Distributor Table */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-3">
          <div className="border border-glass-border rounded-xl overflow-hidden bg-bg/40">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-glass-border bg-bg3/60 text-muted uppercase text-[10px] font-bold tracking-wider">
                  <th className="py-2.5 px-3.5">Distributor Name</th>
                  <th className="py-2.5 px-3 text-center">Total Qty</th>
                  <th className="py-2.5 px-3.5 text-right">Cart Value</th>
                  <th className="py-2.5 px-3.5">Delivery Person</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-glass-border/30">
                {batchSummaryList.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-muted">
                      No order items currently ready to send.
                    </td>
                  </tr>
                ) : (
                  batchSummaryList.map((item) => (
                    <tr key={item.storeId} className="hover:bg-bg3/20 transition-colors">
                      <td className="py-3 px-3.5 font-bold text-text">
                        <div className="flex items-center gap-2">
                          <span>{item.storeName}</span>
                          {item.isMapped ? (
                            <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              Mapped
                            </span>
                          ) : (
                            <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              No phone
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center font-mono font-extrabold text-text">
                        {item.totalQty}
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono font-black text-emerald-400">
                        ₹{item.totalAmount.toFixed(2)}
                      </td>
                      <td className="py-2 px-3.5 min-w-[190px]">
                        <select
                          value={selectedBatchDeliveryBoys[item.storeId] ?? ''}
                          onChange={(e) => {
                            const val = e.target.value ? Number(e.target.value) : null;
                            setSelectedBatchDeliveryBoys((prev) => ({
                              ...prev,
                              [item.storeId]: val,
                            }));
                          }}
                          className="w-full text-xs px-2.5 py-1.5 rounded-xl bg-bg border border-glass-border text-text font-medium focus:outline-none focus:border-emerald-500 transition-all cursor-pointer"
                        >
                          <option value="">👤 Unassigned / Admin Fallback</option>
                          {deliveryBoysList.map((b) => (
                            <option key={b.id} value={b.id}>
                              👤 {b.name} {b.whatsapp_number ? `(${b.whatsapp_number.slice(-4)})` : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {batchSummaryList.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-glass-border bg-bg3/70 font-black">
                    <td className="py-3 px-3.5 text-text uppercase text-[11px] tracking-wide">
                      Final Total ({batchSummaryList.length} Distributors)
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-sm text-text">
                      {finalBatchTotalQty}
                    </td>
                    <td className="py-3 px-3.5 text-right font-mono text-sm text-emerald-400">
                      ₹{finalBatchTotalAmount.toFixed(2)}
                    </td>
                    <td className="py-3 px-3.5 text-right text-[11px] text-muted font-normal">
                      {deliveryBoysList.length > 0 ? `${deliveryBoysList.length} staff available` : '—'}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Modal Footer: Cancel vs Confirm & Send */}
        <div className="bg-bg3/60 px-2 py-3 border-t border-glass-border flex items-center justify-end gap-2.5 shrink-0">
          <button
            type="button"
            disabled={isSendingBatchWhatsApp}
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold text-muted hover:text-text hover:bg-bg3 border border-glass-border transition-all cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirmSend}
            disabled={isSendingBatchWhatsApp || batchSummaryList.length === 0}
            className="px-5 py-2 rounded-xl text-xs font-black bg-emerald-500 hover:bg-emerald-600 text-white flex items-center gap-2 active:scale-95 transition-all shadow-[0_2px_10px_rgba(16,185,129,0.3)] disabled:opacity-50 cursor-pointer"
          >
            {isSendingBatchWhatsApp ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                <span>Sending orders…</span>
              </>
            ) : (
              <>
                <Send size={13} />
                <span>Confirm & Send</span>
              </>
            )}
          </button>
        </div>
      </div>
    </BaseModal>
  );
};
