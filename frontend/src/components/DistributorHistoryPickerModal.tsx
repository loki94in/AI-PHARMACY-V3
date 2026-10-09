import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, BookOpen, CheckSquare, Square, RefreshCw, Star, Plus } from 'lucide-react';
import { api, type DistributorFrequentRow } from '../services/api';
import { toastEvent } from '../services/events';
import { useModalEscape } from '../services/keyboardShortcuts';

interface DistributorHistoryPickerModalProps {
  distributorId: number;
  distributorName: string;
  onClose: () => void;
  onAdd: (picked: DistributorFrequentRow[], keepOpen?: boolean) => void;
  minOrderWarning?: string | null;
  minItemsRequired?: number;
  currentValidCount?: number;
  existingMedicineIds?: Set<number>;
}

export const DistributorHistoryPickerModal: React.FC<DistributorHistoryPickerModalProps> = ({
  distributorId,
  distributorName,
  onClose,
  onAdd,
  minOrderWarning,
  minItemsRequired,
  currentValidCount = 0,
  existingMedicineIds,
}) => {
  useModalEscape(true, onClose);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DistributorFrequentRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [addedIds, setAddedIds] = useState<Set<number>>(() => new Set(existingMedicineIds || []));
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (existingMedicineIds) {
      setAddedIds(new Set(existingMedicineIds));
    }
  }, [existingMedicineIds]);

  useEffect(() => {
    let alive = true;
    // Query up to 365 days of purchase history for this distributor
    api.getDistributorFrequent(distributorId, { days: 365, limit: 150 })
      .then(res => {
        if (alive) {
          const list = Array.isArray(res?.data) ? res.data : [];
          // Ensure top commonly purchased medicines are ordered on top
          list.sort((a, b) => (Number(b.bill_count || 0) - Number(a.bill_count || 0)) || (Number(b.total_qty || 0) - Number(a.total_qty || 0)));
          setRows(list);
        }
      })
      .catch(() => { if (alive) toastEvent.trigger('Could not load distributor order history', 'error'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [distributorId]);

  const q = filter.trim().toLowerCase();
  const visible = q.length >= 2
    ? rows.filter(r => r.medicine_name.toLowerCase().includes(q))
    : rows;
  const allSelected = visible.length > 0 && visible.every(r => selected.has(r.medicine_id));
  const toggle = (id: number) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visible.map(r => r.medicine_id)));

  const totalEffectiveCount = currentValidCount + addedIds.size - (existingMedicineIds?.size || 0);
  const neededItems = minItemsRequired && minItemsRequired > totalEffectiveCount
    ? Math.max(0, minItemsRequired - totalEffectiveCount - selected.size)
    : 0;

  return createPortal(
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 p-4">
      <div className="bg-bg border border-border w-[95vw] max-w-xl rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] overflow-hidden flex flex-col max-h-[85vh]">
        <div className="p-4 border-b border-border flex items-center justify-between bg-bg2 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-500"><BookOpen size={20} /></div>
            <div>
              <h2 className="text-base font-bold text-text">Order from History</h2>
              <p className="text-xs text-muted">
                Frequently purchased from {distributorName} · Past orders sorted on top
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 cursor-pointer" title="Close">
            <X size={18} />
          </button>
        </div>

        {/* Distributor Minimum Order Shortfall Notice */}
        {minOrderWarning && (
          <div className="mx-3 mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between text-xs text-amber-400 shrink-0 shadow-sm">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-base shrink-0">⚠️</span>
              <div>
                <div className="font-bold text-text">Distributor Minimum Requirement:</div>
                <div className="text-[11px] text-amber-300 font-mono">{minOrderWarning}</div>
              </div>
            </div>
            {neededItems > 0 ? (
              <span className="font-bold px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 text-xs shrink-0 border border-amber-500/30">
                Pick {neededItems} more to reach minimum
              </span>
            ) : (
              <span className="font-bold px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 text-xs shrink-0 border border-emerald-500/30">
                ✓ Requirement fulfilled
              </span>
            )}
          </div>
        )}

        <div className="p-3 border-b border-border flex items-center gap-2">
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter by name (min 2 letters)"
            className="flex-1 bg-bg2 border border-border rounded-lg px-2.5 py-1.5 text-xs text-text focus:outline-none focus:border-primary"
          />
          <button type="button" onClick={toggleAll} className="flex items-center gap-1 text-xs font-bold text-text hover:text-primary cursor-pointer">
            {allSelected ? <CheckSquare size={15} className="text-primary" /> : <Square size={15} className="text-muted" />}
            Select all
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto dropdown-scroll p-2 space-y-1">
          {loading ? (
            <div className="py-10 flex justify-center text-muted"><RefreshCw size={20} className="animate-spin text-primary" /></div>
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted">
              {rows.length === 0
                ? `No past purchase history for ${distributorName}.`
                : 'No medicine matches this filter.'}
            </p>
          ) : visible.map((r, idx) => {
            const isTopMover = idx < 5 || (r.bill_count && r.bill_count >= 2);
            const isAlreadyAdded = addedIds.has(r.medicine_id);
            return (
              <div
                key={r.medicine_id}
                onClick={() => toggle(r.medicine_id)}
                className={`w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-xl border text-left cursor-pointer transition-all ${
                  selected.has(r.medicine_id) ? 'border-primary/50 bg-primary/10' : 'border-border bg-bg2 hover:bg-bg3'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  {selected.has(r.medicine_id) ? <CheckSquare size={16} className="text-primary shrink-0" /> : <Square size={16} className="text-muted shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-text truncate">{r.medicine_name}</span>
                      {isTopMover && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 shrink-0">
                          <Star size={9} className="fill-amber-400" /> Top Bought
                        </span>
                      )}
                      {isAlreadyAdded && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1 py-0.2 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 shrink-0">
                          ✓ On Bill
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted truncate">
                      {r.manufacturer ? `${r.manufacturer} · ` : ''}
                      {r.last_rate ? `Last PTR: ₹${Number(r.last_rate).toFixed(2)}` : ''}
                      {r.last_mrp ? ` / MRP: ₹${Number(r.last_mrp).toFixed(2)}` : ''}
                      {r.last_expiry ? ` · Exp: ${r.last_expiry}` : ''}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400 border border-sky-500/20">
                    ×{r.bill_count} bills
                  </span>
                  <button
                    type="button"
                    disabled={isAlreadyAdded}
                    onClick={(e) => {
                      e.stopPropagation();
                      setAddedIds(prev => new Set([...prev, r.medicine_id]));
                      onAdd([r], true);
                    }}
                    className={`h-7 px-2.5 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-all shadow-sm ${
                      isAlreadyAdded
                        ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 cursor-default'
                        : 'bg-primary hover:bg-primary/90 text-white cursor-pointer active:scale-95'
                    }`}
                    title={isAlreadyAdded ? 'Already added to bill' : `Add ${r.medicine_name} to bill`}
                  >
                    {isAlreadyAdded ? <>✓ Added</> : <><Plus size={12} className="stroke-[3]" /> Add</>}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-3 border-t border-border bg-bg2 flex items-center justify-between gap-2 shrink-0">
          <span className="text-[11px] text-muted">Quantity stays blank — enter quantity on the bill row.</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-xl border border-border text-text hover:bg-bg3 text-xs font-semibold cursor-pointer transition-colors"
            >
              Done
            </button>
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => onAdd(rows.filter(r => selected.has(r.medicine_id)), false)}
              className="px-4 py-2 rounded-xl bg-primary text-white text-xs font-bold cursor-pointer disabled:opacity-50 transition-all shadow-sm"
            >
              Add {selected.size || ''} to bill {selected.size > 0 && neededItems > 0 ? `(${neededItems} needed)` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

