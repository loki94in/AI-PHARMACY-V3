import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link2, X, Check, Loader2, ArrowRightLeft, Trash2 } from 'lucide-react';
import {
  api,
  type BillPoComparisonResult,
  type BillPoComparisonRow,
  type PoOrderItemCandidate
} from '../services/api';
import { MedicineLinkModal } from './MedicineLinkModal';
import { toastEvent } from '../services/events';
import { useModalEscape } from '../services/keyboardShortcuts';

type LocalApiError = { response?: { data?: { error?: string } }; message?: string };

interface BillPoComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
  purchaseId?: number | null;
  poOrderId?: number | null;
  onLinkedChange?: () => void;
}

const poKeyOf = (p: PoOrderItemCandidate) => `${p.storeId}|${p.productCode || p.productName}`;

export const BillPoComparisonModal: React.FC<BillPoComparisonModalProps> = ({
  isOpen,
  onClose,
  purchaseId,
  poOrderId,
  onLinkedChange
}) => {
  useModalEscape(isOpen, onClose);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<BillPoComparisonResult | null>(null);
  const [pickedPoKeyByMed, setPickedPoKeyByMed] = useState<Record<number, string>>({});
  const [savingMedId, setSavingMedId] = useState<number | null>(null);
  const [manualTarget, setManualTarget] = useState<{ id: number; name: string } | null>(null);

  useEffect(() => {
    if (!isOpen || (!purchaseId && !poOrderId)) {
      setData(null);
      return;
    }
    let alive = true;
    setLoading(true);
    const req = purchaseId
      ? api.getBillPoComparison(purchaseId, 3)
      : api.getPoOrderComparison(Number(poOrderId));

    req
      .then(res => {
        if (!alive) return;
        setData(res);
        const initial: Record<number, string> = {};
        for (const r of res.rows || []) {
          if (r.suggestedPoItem) initial[r.medicineId] = poKeyOf(r.suggestedPoItem);
        }
        setPickedPoKeyByMed(initial);
      })
      .catch((err: unknown) => {
        if (alive) {
          toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Could not load PO comparison', 'error');
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => { alive = false; };
  }, [isOpen, purchaseId, poOrderId]);

  const updateRowLinks = (medicineId: number, links: BillPoComparisonRow['links']) => {
    setData(prev => prev ? {
      ...prev,
      rows: prev.rows.map(r => r.medicineId === medicineId ? { ...r, links } : r)
    } : prev);
    onLinkedChange?.();
  };

  const handleSavePair = async (row: BillPoComparisonRow) => {
    const chosenKey = pickedPoKeyByMed[row.medicineId];
    const poItem = data?.poItems.find(p => poKeyOf(p) === chosenKey) || row.suggestedPoItem;
    if (!poItem || !poItem.storeId || !poItem.productCode) {
      toastEvent.trigger('This PO item has no product code. Use Manual Link to search Pharmarack.', 'error');
      return;
    }
    setSavingMedId(row.medicineId);
    try {
      const res = await api.appendMedicineLink(row.medicineId, {
        storeId: poItem.storeId,
        storeName: poItem.storeName,
        productCode: poItem.productCode,
        productId: poItem.productId,
        productName: poItem.productName,
        packaging: poItem.packaging,
        company: poItem.company,
        mapped: true,
        mrp: poItem.mrp,
        rate: poItem.rate
      });
      updateRowLinks(row.medicineId, res.links);
      toastEvent.trigger(`Linked ${row.medicineName} → ${poItem.productName}`, 'success');
    } catch (err: unknown) {
      toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to save link', 'error');
    } finally {
      setSavingMedId(null);
    }
  };

  const handleUnlink = async (medicineId: number, storeId: number, productCode: string) => {
    setSavingMedId(medicineId);
    try {
      const res = await api.removeMedicineLink(medicineId, storeId, productCode);
      updateRowLinks(medicineId, res.links);
      toastEvent.trigger('Distributor link removed', 'success');
    } catch (err: unknown) {
      toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to remove link', 'error');
    } finally {
      setSavingMedId(null);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-global-modal flex items-center justify-center p-4 fade-in">
        <div className="absolute inset-0 bg-bg/80" onClick={onClose} />
        <div className="relative bg-bg border border-glass-border rounded-3xl w-[95vw] max-w-5xl max-h-[88vh] flex flex-col shadow-[0_4px_24px_rgba(0,0,0,0.12)] overflow-hidden">
          {/* Header */}
          <div className="p-5 border-b border-glass-border bg-bg3 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2.5 rounded-xl bg-primary/15 text-primary border border-primary/25 shrink-0">
                <ArrowRightLeft className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-bold text-text truncate">
                  Compare & Link with Sent PO History
                </h2>
                <p className="text-xs text-muted truncate">
                  Distributor: <span className="font-semibold text-text">{data?.distributorName || 'Loading...'}</span>
                  {' · '}Left: Saved Medicine · Right: Pharmarack PO Item
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-muted hover:text-text hover:bg-glass-bg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                Loading Sent PO History for this distributor...
              </div>
            )}

            {!loading && data && data.rows.length === 0 && (
              <div className="text-center py-12 text-sm text-muted">
                No medicines found to compare on this bill/order.
              </div>
            )}

            {!loading && data && data.rows.length > 0 && (
              <div className="space-y-2.5">
                {data.rows.map(row => {
                  const chosenKey = pickedPoKeyByMed[row.medicineId] || '';
                  const selectedPo = data.poItems.find(p => poKeyOf(p) === chosenKey) || null;
                  const canDirectSave = !!(selectedPo && selectedPo.storeId > 0 && selectedPo.productCode);

                  return (
                    <div
                      key={row.medicineId}
                      className="grid grid-cols-1 md:grid-cols-12 gap-3 p-3.5 rounded-2xl bg-bg2 border border-glass-border items-center"
                    >
                      {/* Left: Saved Medicine Name + Existing Links */}
                      <div className="md:col-span-5 min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-text break-words">{row.medicineName}</span>
                          {row.billMrp > 0 && (
                            <span className="text-[11px] px-2 py-0.5 rounded-lg bg-bg3 text-muted border border-glass-border">
                              MRP ₹{row.billMrp}
                            </span>
                          )}
                        </div>
                        {row.links.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {row.links.map(lk => (
                              <span
                                key={`${lk.storeId}-${lk.productCode}`}
                                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                                title={`${lk.storeName}: ${lk.productName || lk.productCode}`}
                              >
                                <Check className="w-3 h-3 shrink-0" />
                                <span className="break-words">{lk.storeName}</span>
                                <button
                                  type="button"
                                  disabled={savingMedId === row.medicineId}
                                  onClick={() => handleUnlink(row.medicineId, lk.storeId, lk.productCode)}
                                  className="ml-0.5 hover:text-red-400 transition-colors"
                                  title="Unlink this distributor"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="inline-block text-[11px] text-amber-500">Not linked yet</span>
                        )}
                      </div>

                      {/* Right: Sent PO Item Picker */}
                      <div className="md:col-span-4 min-w-0">
                        {data.poItems.length > 0 ? (
                          <select
                            value={chosenKey}
                            onChange={e => setPickedPoKeyByMed(prev => ({ ...prev, [row.medicineId]: e.target.value }))}
                            className="w-full px-3 py-2 text-xs rounded-xl bg-bg border border-glass-border text-text focus:outline-none focus:border-primary"
                          >
                            <option value="">-- Select PO item --</option>
                            {data.poItems.map(p => (
                              <option key={poKeyOf(p)} value={poKeyOf(p)}>
                                {p.productName} {p.packaging ? `(${p.packaging})` : ''} · Qty {p.qty}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs text-muted">No recent Sent PO items for this distributor</span>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="md:col-span-3 flex items-center justify-end gap-2">
                        {canDirectSave && (
                          <button
                            type="button"
                            disabled={savingMedId === row.medicineId}
                            onClick={() => handleSavePair(row)}
                            className="px-3 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                          >
                            {savingMedId === row.medicineId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            Save Link
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setManualTarget({ id: row.medicineId, name: row.medicineName })}
                          className="px-3 py-1.5 rounded-xl bg-bg3 hover:bg-glass-bg border border-glass-border text-text text-xs font-medium flex items-center gap-1.5 transition-colors"
                        >
                          <Link2 className="w-3.5 h-3.5 text-primary" />
                          Manual
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-glass-border bg-bg3 flex items-center justify-end shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-bg2 hover:bg-glass-bg border border-glass-border text-text text-xs font-semibold transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>

      {manualTarget && (
        <MedicineLinkModal
          medicineId={manualTarget.id}
          medicineName={manualTarget.name}
          onSaved={async () => {
            try {
              const r = await api.getMedicineLinks(manualTarget.id);
              updateRowLinks(manualTarget.id, r.links || []);
            } catch (_) {}
          }}
          onClose={() => setManualTarget(null)}
        />
      )}
    </>,
    document.body
  );
};
