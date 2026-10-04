import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, RefreshCw, CalendarCheck, Search } from 'lucide-react';
import { api, type TodaysReceiptRow } from '../services/api';
import { useApiQuery } from '../hooks/useApiQuery';

const units = (strips: number, loose: number) => `${strips} strips${loose ? ` + ${loose} loose` : ''}`;

interface Props {
  onClose: () => void;
  onFind: (medicineName: string) => void;
}

// Read-only reconciliation view: bills dated the chosen day, what each batch still has on the
// shelf, and what was already sold from it. Never writes stock.
export const TodaysReceiptsPanel: React.FC<Props> = ({ onClose, onFind }) => {
  const [day, setDay] = useState('');
  const [onlySoldOut, setOnlySoldOut] = useState(false);
  const { data, isLoading, isError, refetch } = useApiQuery<{ date: string; data: TodaysReceiptRow[] }>(
    ['inventory-todays-receipts', day],
    () => api.getTodaysReceipts(day || undefined),
    { staleTime: 30 * 1000 }
  );
  const rows = (data?.data ?? []).filter(r => !onlySoldOut || r.sold_out);
  const soldOutCount = (data?.data ?? []).filter(r => r.sold_out).length;

  return createPortal(
    <div className="fixed inset-0 z-modal bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-5xl max-h-[85vh] flex flex-col bg-glass-bg border border-glass-border rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-glass-border/50">
          <CalendarCheck size={16} className="text-primary" />
          <div className="font-black text-text">Bills Received · {data?.date ?? 'Today'}</div>
          <span className="text-xs text-muted">{data?.data.length ?? 0} lines</span>
          {soldOutCount > 0 && (
            <span className="text-[11px] font-bold text-amber bg-amber/10 border border-amber/30 rounded px-2">{soldOutCount} sold out</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <input
              type="date"
              value={day}
              onChange={e => setDay(e.target.value)}
              className="h-8 px-2 rounded-lg border bg-bg3 border-glass-border text-text text-[13px]"
              title="Bills dated (blank = today)"
            />
            <label className="flex items-center gap-1.5 text-[13px] text-muted cursor-pointer">
              <input type="checkbox" checked={onlySoldOut} onChange={e => setOnlySoldOut(e.target.checked)} />
              Sold out only
            </label>
            <button onClick={() => refetch()} className="p-1.5 rounded-lg hover:bg-bg3 text-muted hover:text-text" title="Refresh">
              <RefreshCw size={14} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg3 text-muted hover:text-text" title="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="overflow-auto dropdown-scroll">
          {isLoading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted"><RefreshCw size={13} className="animate-spin text-primary" /> Loading…</div>
          ) : isError ? (
            <div className="p-6 text-sm text-amber">Could not load today's bills.</div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-muted italic">{onlySoldOut ? 'Nothing is sold out from these bills.' : 'No purchase bills for this date.'}</div>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="text-muted text-left border-b border-glass-border">
                <tr>
                  <th className="px-3 py-2 font-semibold">Medicine</th>
                  <th className="px-2 py-2 font-semibold">Bill</th>
                  <th className="px-2 py-2 font-semibold">Batch</th>
                  <th className="px-2 py-2 font-semibold text-right">Purchased</th>
                  <th className="px-2 py-2 font-semibold text-right">Sold so far</th>
                  <th className="px-2 py-2 font-semibold text-right">On shelf now</th>
                  <th className="px-3 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.line_id} className={`border-b border-glass-border/40 ${r.sold_out ? 'bg-amber/5' : ''}`}>
                    <td className="px-3 py-2 text-text font-semibold max-w-[220px]">
                      <div className="truncate" title={r.medicine_name}>{r.medicine_name}</div>
                      {r.sold_out && <span className="text-[10px] font-bold text-amber bg-amber/10 border border-amber/30 rounded px-1.5">Sold out</span>}
                    </td>
                    <td className="px-2 py-2 text-muted whitespace-nowrap">
                      <div className="font-mono">{r.invoice_no || `#${r.purchase_id}`}</div>
                      <div className="truncate max-w-[130px]" title={r.distributor_name ?? ''}>{r.distributor_name || '—'}</div>
                    </td>
                    <td className="px-2 py-2 text-muted font-mono">{r.batch_no || '—'}</td>
                    <td className="px-2 py-2 text-right text-text">{units(r.quantity + r.free_qty, 0)}</td>
                    <td className="px-2 py-2 text-right text-muted">{units(r.sold_qty, r.sold_loose)}</td>
                    <td className="px-2 py-2 text-right text-text font-semibold">{units(r.shelf_qty, r.shelf_loose)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => onFind(r.medicine_name)}
                        className="inline-flex items-center gap-1 px-2 h-7 rounded-lg border bg-bg3 border-glass-border text-muted hover:text-text text-[12px] font-semibold"
                        title="Show this medicine in the stock list to sell or adjust it"
                      >
                        <Search size={12} /> Find in stock
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
