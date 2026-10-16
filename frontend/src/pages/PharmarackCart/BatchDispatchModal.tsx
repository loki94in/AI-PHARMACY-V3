import React from 'react';
import { Truck, Send, AlertTriangle } from 'lucide-react';
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
  selectedBatchStoreIds: Set<number>;
  setSelectedBatchStoreIds: React.Dispatch<React.SetStateAction<Set<number>>>;
  batchSummaryList: BatchSummaryItem[];
  finalBatchTotalQty?: number;
  finalBatchTotalAmount?: number;
  isSendingBatchWhatsApp: boolean;
  onConfirmSend: (selectedStoreIds: number[]) => void;
  includeMedicineList?: boolean;
  setIncludeMedicineList?: (val: boolean) => void;
  limitIssuesMap?: Record<number, string[]>;
}

export const BatchDispatchModal: React.FC<BatchDispatchModalProps> = ({
  isOpen,
  onClose,
  deliveryBoysList,
  bulkApplyDeliveryBoyId,
  setBulkApplyDeliveryBoyId,
  selectedBatchDeliveryBoys,
  setSelectedBatchDeliveryBoys,
  selectedBatchStoreIds,
  setSelectedBatchStoreIds,
  batchSummaryList,
  isSendingBatchWhatsApp,
  onConfirmSend,
  limitIssuesMap = {},
}) => {
  const allStoreIds = batchSummaryList.map(item => item.storeId);
  const allSelected = allStoreIds.length > 0 && allStoreIds.every(id => selectedBatchStoreIds.has(id));
  const someSelected = allStoreIds.some(id => selectedBatchStoreIds.has(id)) && !allSelected;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedBatchStoreIds(new Set());
    } else {
      setSelectedBatchStoreIds(new Set(allStoreIds));
    }
  };

  const toggleStore = (storeId: number) => {
    setSelectedBatchStoreIds(prev => {
      const next = new Set(prev);
      if (next.has(storeId)) {
        next.delete(storeId);
      } else {
        next.add(storeId);
      }
      return next;
    });
  };

  // Dynamically calculate totals strictly for checked distributors
  const selectedItems = batchSummaryList.filter(item => selectedBatchStoreIds.has(item.storeId));
  const dynamicTotalQty = selectedItems.reduce((acc, item) => acc + item.totalQty, 0);
  const dynamicTotalAmount = selectedItems.reduce((acc, item) => acc + item.totalAmount, 0);
  const selectedCount = selectedItems.length;

  // Shortfall / minimum order limit warning strictly evaluated for SELECTED distributors
  const hasSelectedLimitIssues = selectedItems.some(item => (limitIssuesMap[item.storeId]?.length || 0) > 0);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Place Official Orders & Dispatch"
      maxWidth="max-w-2xl"
    >
      <div className="space-y-3 max-h-[75vh] flex flex-col">
        <p className="text-[11px] text-muted -mt-2">
          Places official orders directly on retailers.pharmarack.com/cart for selected distributors, notifies delivery staff with clean pickup stores, and queues distributor dispatch reminders with genuine today's Order IDs.
        </p>

        {/* Warning Banner if any selected distributor fails minimum requirements */}
        {hasSelectedLimitIssues && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-2.5 flex items-start gap-2.5 text-xs text-rose-400 shrink-0">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Minimum Order Requirements Not Met:</span>
              <p className="text-[11px] text-rose-300/80 mt-0.5">
                One or more selected distributors have shortfall or order limit issues. Please fulfill these requirements or uncheck those distributors to proceed with the ready ones.
              </p>
            </div>
          </div>
        )}

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
                <option value="">-- Choose Delivery Staff --</option>
                <option value="0">👤 Admin / Store Owner (Store Contact)</option>
                {deliveryBoysList.map((b) => (
                  <option key={b.id} value={b.id}>
                    🚚 {b.name} {b.whatsapp_number ? `(${b.whatsapp_number.slice(-4)})` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={bulkApplyDeliveryBoyId === ''}
                onClick={() => {
                  if (bulkApplyDeliveryBoyId === '') return;
                  const boyId = Number(bulkApplyDeliveryBoyId);
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

        {/* Clean Staff Dispatch Information Badge */}
        <div className="bg-bg3/40 px-4 py-2 rounded-xl border border-glass-border flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-text">🚚 Delivery Staff Pickup List:</span>
            <span className="text-[11px] text-muted">Clean distributor list with contact numbers only (no medicine names or item counts).</span>
          </div>
          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-bold shrink-0">
            Clean Format
          </span>
        </div>

        {/* Modal Body: Distributor Table */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-3">
          <div className="border border-glass-border rounded-xl overflow-hidden bg-bg/40">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-glass-border bg-bg3/60 text-muted uppercase text-[10px] font-bold tracking-wider">
                  <th className="py-2.5 px-3 text-center w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={input => {
                        if (input) input.indeterminate = someSelected;
                      }}
                      onChange={toggleSelectAll}
                      className="rounded border-glass-border text-primary focus:ring-0 cursor-pointer w-3.5 h-3.5 accent-primary"
                      title={allSelected ? 'Deselect All' : 'Select All'}
                    />
                  </th>
                  <th className="py-2.5 px-3.5">
                    <div className="flex items-center gap-2">
                      <span>Distributor Name</span>
                      <span className="text-[9px] font-mono font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20 normal-case">
                        {selectedCount} of {batchSummaryList.length} Selected
                      </span>
                    </div>
                  </th>
                  <th className="py-2.5 px-3 text-center">Total Qty</th>
                  <th className="py-2.5 px-3.5 text-right">Cart Value</th>
                  <th className="py-2.5 px-3.5">Delivery Person</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-glass-border/30">
                {batchSummaryList.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted">
                      No order items currently ready to send.
                    </td>
                  </tr>
                ) : (
                  batchSummaryList.map((item) => {
                    const isSelected = selectedBatchStoreIds.has(item.storeId);
                    const issues = limitIssuesMap[item.storeId] || [];
                    const hasIssues = isSelected && issues.length > 0;
                    return (
                      <tr
                        key={item.storeId}
                        onClick={() => toggleStore(item.storeId)}
                        className={`transition-colors cursor-pointer select-none ${
                          !isSelected
                            ? 'opacity-40 bg-bg/10'
                            : hasIssues
                            ? 'bg-rose-500/5 hover:bg-rose-500/10'
                            : 'hover:bg-bg3/20'
                        }`}
                      >
                        <td className="py-3 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleStore(item.storeId)}
                            className="rounded border-glass-border text-primary focus:ring-0 cursor-pointer w-3.5 h-3.5 accent-primary"
                          />
                        </td>
                        <td className="py-3 px-3.5 font-bold text-text">
                          <div className="flex flex-col gap-1">
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
                            {issues.length > 0 && (
                              <div className={`flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded border w-fit ${
                                isSelected ? 'text-rose-400 bg-rose-500/10 border-rose-500/20' : 'text-muted bg-bg3/50 border-glass-border'
                              }`}>
                                <AlertTriangle size={10} className="shrink-0" />
                                <span>{issues[0]}</span>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-center font-mono font-extrabold text-text">
                          {item.totalQty}
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono font-black text-emerald-400">
                          ₹{item.totalAmount.toFixed(2)}
                        </td>
                        <td className="py-2 px-3.5 min-w-[190px]" onClick={(e) => e.stopPropagation()}>
                          <select
                            value={selectedBatchDeliveryBoys[item.storeId] !== null && selectedBatchDeliveryBoys[item.storeId] !== undefined ? String(selectedBatchDeliveryBoys[item.storeId]) : ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              const num = val === '' ? null : Number(val);
                              setSelectedBatchDeliveryBoys((prev) => ({
                                ...prev,
                                [item.storeId]: num,
                              }));
                            }}
                            className={`w-full text-xs px-2.5 py-1.5 rounded-xl border font-medium focus:outline-none transition-all cursor-pointer ${
                              selectedBatchDeliveryBoys[item.storeId] === null || selectedBatchDeliveryBoys[item.storeId] === undefined
                                ? 'bg-amber-500/10 border-amber-500/40 text-amber-400 font-bold focus:border-amber-500'
                                : 'bg-bg border-glass-border text-text focus:border-emerald-500'
                            }`}
                          >
                            <option value="">⚠️ Missing Delivery Staff</option>
                            <option value="0">👤 Admin / Store Owner (Store Contact)</option>
                            {deliveryBoysList.map((b) => (
                              <option key={b.id} value={b.id}>
                                🚚 {b.name} {b.whatsapp_number ? `(${b.whatsapp_number.slice(-4)})` : ''}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {batchSummaryList.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-glass-border bg-bg3/70 font-black">
                    <td className="py-3 px-3 text-center">
                      <span className="text-[10px] font-mono text-muted">{selectedCount}</span>
                    </td>
                    <td className="py-3 px-3.5 text-text uppercase text-[11px] tracking-wide">
                      Selected Total ({selectedCount} of {batchSummaryList.length} Distributors)
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-sm text-text">
                      {dynamicTotalQty}
                    </td>
                    <td className="py-3 px-3.5 text-right font-mono text-sm text-emerald-400">
                      ₹{dynamicTotalAmount.toFixed(2)}
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
            onClick={() => onConfirmSend(Array.from(selectedBatchStoreIds))}
            disabled={isSendingBatchWhatsApp || selectedCount === 0 || hasSelectedLimitIssues}
            className="px-5 py-2 rounded-xl text-xs font-black bg-emerald-500 hover:bg-emerald-600 text-white flex items-center gap-2 active:scale-95 transition-all shadow-[0_2px_10px_rgba(16,185,129,0.3)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            title={
              selectedCount === 0
                ? 'Please select at least one distributor'
                : hasSelectedLimitIssues
                ? 'Please fulfill minimum order requirements for selected distributors, or deselect them'
                : 'Place official orders on Pharmarack & notify staff'
            }
          >
            {isSendingBatchWhatsApp ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                <span>Placing Orders &amp; Notifying Staff…</span>
              </>
            ) : (
              <>
                <Send size={13} />
                <span>Place Official Orders &amp; Dispatch ({selectedCount} Distributor{selectedCount !== 1 ? 's' : ''})</span>
              </>
            )}
          </button>
        </div>
      </div>
    </BaseModal>
  );
};
