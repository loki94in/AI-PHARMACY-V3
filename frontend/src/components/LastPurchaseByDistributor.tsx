import React from 'react';
import { Truck, RefreshCw } from 'lucide-react';
import { api, type LastPurchaseByDistributorRow } from '../services/api';
import { useApiQuery } from '../hooks/useApiQuery';

const money = (v: number | null) => (v == null ? '—' : `₹${Number(v).toFixed(2)}`);

export const LastPurchaseByDistributor: React.FC<{ medicineId: number }> = ({ medicineId }) => {
  const { data, isLoading, isError } = useApiQuery<{ data: LastPurchaseByDistributorRow[] }>(
    ['medicine-last-by-distributor', medicineId],
    () => api.getLastPurchaseByDistributor(medicineId),
    { staleTime: 5 * 60 * 1000 }
  );
  const rows = data?.data ?? [];
  const priced = rows.filter(r => r.rate != null && r.rate > 0);
  const bestRate = priced.length > 0 ? Math.min(...priced.map(r => r.rate as number)) : null;

  return (
    <div className="px-4 pb-4 space-y-2">
      <div className="flex items-center gap-2 border-t border-glass-border/50 pt-4">
        <Truck size={14} className="text-muted" />
        <span className="text-xs font-black uppercase tracking-widest text-muted">Last Purchase · Per Distributor</span>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-3 text-sm text-muted">
          <RefreshCw size={13} className="animate-spin text-primary" /> Loading purchase history…
        </div>
      ) : isError ? (
        <div className="py-3 text-sm text-amber">Could not load purchase history.</div>
      ) : rows.length === 0 ? (
        <div className="py-3 text-sm text-muted italic">No purchase history for this medicine.</div>
      ) : (
        <div className="bg-bg2/60 border border-glass-border rounded-xl overflow-hidden">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-muted border-b border-glass-border text-left">
                <th className="px-3 py-2 font-semibold">Distributor</th>
                <th className="px-2 py-2 font-semibold">Last Date</th>
                <th className="px-2 py-2 font-semibold text-right">Rate</th>
                <th className="px-2 py-2 font-semibold text-right">MRP</th>
                <th className="px-3 py-2 font-semibold text-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const margin = r.rate != null && r.mrp ? ((r.mrp - r.rate) / r.mrp) * 100 : null;
                const isBest = bestRate != null && r.rate === bestRate;
                return (
                  <tr key={r.distributor_id} className="border-b border-glass-border/40 last:border-none">
                    <td className="px-3 py-2 text-text max-w-[150px]">
                      <div className="truncate font-semibold" title={r.distributor_name}>{r.distributor_name}</div>
                      {isBest && (
                        <span className="text-[10px] font-bold text-green bg-green/10 border border-green/20 rounded px-1.5">Best rate</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-muted font-mono whitespace-nowrap" title={r.invoice_no ? `Invoice ${r.invoice_no}` : undefined}>
                      {r.date ? r.date.slice(0, 10) : '—'}
                    </td>
                    <td className="px-2 py-2 text-right text-text font-semibold">{money(r.rate)}</td>
                    <td className="px-2 py-2 text-right text-muted">{money(r.mrp)}</td>
                    <td className="px-3 py-2 text-right text-primary font-semibold">{margin == null ? '—' : `${margin.toFixed(1)}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
