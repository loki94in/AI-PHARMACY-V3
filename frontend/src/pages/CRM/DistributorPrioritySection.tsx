import React, { useState } from 'react';
import { GripVertical, Save, ListOrdered } from 'lucide-react';
import { api } from '../../services/api';
import { useApiQuery } from '../../hooks/useApiQuery';
import { toastEvent, refillEvent } from '../../services/events';
import { clearDistributorPriorityCache } from '../../utils/pharmarackLinkCandidates';
import { queryClient } from '../../lib/queryClient';

interface Row { storeName: string; ranked: boolean; linkedMedicines: number }

// Module cache: the tab paints instantly on revisit while the silent refresh runs.
let cachedRows: Row[] | undefined;

const move = (list: Row[], from: number, to: number): Row[] => {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

/**
 * One combined, ordered list of every mapped distributor. Live Cart add (refill → cart) tries a
 * medicine's linked distributors in this order and falls to the next one when out of stock.
 */
export const DistributorPrioritySection: React.FC = () => {
  const { data, isLoading } = useApiQuery(
    ['distributor-priority'],
    async () => {
      const res = await api.getDistributorPriority();
      cachedRows = res.distributors;
      return res.distributors;
    },
    { initialData: cachedRows, staleTime: 30_000 }
  );
  // Unsaved edits win over the server list; once saved the server list (incl. new distributors) shows again.
  const [edited, setEdited] = useState<Row[] | null>(null);
  const [saving, setSaving] = useState(false);
  const rows = edited ?? data ?? [];
  const dirty = edited !== null;
  const [dragName, setDragName] = useState<string | null>(null);

  const change = (next: Row[]) => setEdited(next);

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.saveDistributorPriority(rows.map(r => r.storeName));
      cachedRows = res.distributors;
      setEdited(null);
      clearDistributorPriorityCache();
      queryClient.invalidateQueries({ queryKey: ['distributor-priority'] });
      queryClient.invalidateQueries({ queryKey: ['refills'] });
      queryClient.invalidateQueries({ queryKey: ['crm-refills'] });
      refillEvent.triggerRefresh();
      toastEvent.trigger('Distributor priority saved', 'success');
    } catch (err: unknown) {
      toastEvent.trigger((err as { message?: string })?.message || 'Could not save distributor priority', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      <div className="flex items-center justify-between gap-3 bg-bg border border-border rounded-2xl p-4 shrink-0">
        <div className="flex items-center gap-2.5">
          <ListOrdered size={18} className="text-primary" />
          <div>
            <h2 className="text-sm font-bold text-text">Distributor Priority</h2>
            <p className="text-[11px] text-muted mt-0.5">
              Drag a distributor up or down. Top is tried first; if it is out of stock the next one is used. New distributors appear at the bottom.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-white text-xs font-bold disabled:opacity-40 cursor-pointer disabled:cursor-default"
        >
          <Save size={14} /> {saving ? 'Saving…' : 'Save priority'}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto dropdown-scroll bg-bg border border-border rounded-2xl p-3 space-y-2">
        {rows.length === 0 && (
          <p className="text-xs text-muted p-4">
            {isLoading ? 'Loading distributors…' : 'No mapped distributors yet. They appear here once a medicine is linked to one.'}
          </p>
        )}
        {rows.map((r, i) => (
          <div
            key={r.storeName}
            draggable
            onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragName(r.storeName); }}
            onDragOver={(e) => {
              e.preventDefault();
              // Live preview: the row moves (and every number updates) as you drag over the others.
              const from = rows.findIndex(x => x.storeName === dragName);
              if (from !== -1 && from !== i) change(move(rows, from, i));
            }}
            onDrop={(e) => e.preventDefault()}
            onDragEnd={() => setDragName(null)}
            className={`flex items-center gap-3 p-3 rounded-xl border bg-bg2 cursor-grab active:cursor-grabbing select-none ${
              dragName === r.storeName ? 'border-primary ring-2 ring-primary/40 bg-primary/10' : 'border-border'
            }`}
          >
            <GripVertical size={16} className="text-muted shrink-0" />
            <span className="w-7 text-center text-xs font-mono font-bold text-primary">{i + 1}</span>
            <div className="flex-1 min-w-0 text-xs font-bold text-text truncate">{r.storeName}</div>
            {!r.ranked && <span className="text-[11px] text-primary font-bold shrink-0">New — drag to place</span>}
          </div>
        ))}
      </div>
    </div>
  );
};
