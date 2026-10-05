import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Package, CheckSquare, Square, RefreshCw } from 'lucide-react';
import { api } from '../services/api';
import { toastEvent } from '../services/events';
import { useModalEscape } from '../services/keyboardShortcuts';

interface LowStockRow {
  medicine_id: number;
  medicine_name: string;
  manufacturer: string | null;
  strips: number;
  loose_units: number;
}

interface LowStockPickerModalProps {
  onClose: () => void;
  onAdd: (picked: LowStockRow[]) => void;
}

export const LowStockPickerModal: React.FC<LowStockPickerModalProps> = ({ onClose, onAdd }) => {
  useModalEscape(true, onClose);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState<number | null>(null);
  const [rows, setRows] = useState<LowStockRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let alive = true;
    api.getLowStock()
      .then(res => { if (alive) { setLimit(res.limit); setRows(res.items); } })
      .catch(() => { if (alive) toastEvent.trigger('Could not load low-stock medicines', 'error'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const q = filter.trim().toLowerCase();
  const visible = q ? rows.filter(r => r.medicine_name.toLowerCase().includes(q)) : rows;
  const allSelected = visible.length > 0 && visible.every(r => selected.has(r.medicine_id));
  const toggle = (id: number) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visible.map(r => r.medicine_id)));

  return createPortal(
    <div className="fixed inset-0 z-global-modal flex items-center justify-center bg-black/60 p-4">
      <div className="bg-bg border border-border w-[95vw] max-w-xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="p-4 border-b border-border/40 flex items-center justify-between bg-bg2 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500"><Package size={20} /></div>
            <div>
              <h2 className="text-base font-bold text-text">Order Low-Stock Medicines</h2>
              <p className="text-xs text-muted">
                {limit ? `Medicines with ${limit} strips or fewer on the shelf` : 'No low-stock limit set'}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 cursor-pointer" title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="p-3 border-b border-border/40 flex items-center gap-2">
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter by name"
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
          ) : limit === null ? (
            <p className="py-8 text-center text-xs text-muted">Set the Low Stock Limit in Settings → Orders &amp; Fulfilment Timing first.</p>
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted">No medicine is at or below the limit.</p>
          ) : visible.map(r => (
            <button
              key={r.medicine_id}
              type="button"
              onClick={() => toggle(r.medicine_id)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg border text-left cursor-pointer ${
                selected.has(r.medicine_id) ? 'border-primary/50 bg-primary/10' : 'border-border bg-bg2 hover:bg-bg3'
              }`}
            >
              {selected.has(r.medicine_id) ? <CheckSquare size={16} className="text-primary shrink-0" /> : <Square size={16} className="text-muted shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-text truncate">{r.medicine_name}</div>
                {r.manufacturer && <div className="text-[10px] text-muted truncate">{r.manufacturer}</div>}
              </div>
              <span className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded ${r.strips <= 0 ? 'bg-rose-500/15 text-rose-500' : 'bg-amber-500/15 text-amber-500'}`}>
                {r.strips} strips{r.loose_units > 0 ? ` +${r.loose_units}` : ''}
              </span>
            </button>
          ))}
        </div>

        <div className="p-3 border-t border-border/40 bg-bg2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted">Quantity, rate and batch stay blank — fill them from the real bill.</span>
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={() => onAdd(rows.filter(r => selected.has(r.medicine_id)))}
            className="px-4 py-1.5 rounded-xl bg-primary text-white text-xs font-bold cursor-pointer disabled:opacity-50"
          >
            Add {selected.size || ''} to bill
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
