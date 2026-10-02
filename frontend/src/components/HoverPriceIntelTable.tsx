import React from 'react';
import { api } from '../services/api';
import { useApiQuery } from '../hooks/useApiQuery';
import { Loader, AlertCircle } from 'lucide-react';

interface PriceRecord {
  date: string;
  distributor_name: string;
  batch_no: string;
  expiry_date: string;
  rate: number;
  mrp: number;
  cgst_per: number;
  sgst_per: number;
  cd_rs: number;
  qty?: number;
}

interface HoverPriceIntelTableProps {
  medicineName: string;
  medicineId?: number | null;
  /**
   * Pre-loaded history rows (from the Purchases one-shot medicine-batches cache).
   * When provided, NO network call is made — the table renders straight from
   * these records (null/undefined falls back to the /price-history query).
   */
  records?: PriceRecord[] | null;
  /** The caller's own load for `records` is in flight: show loading, don't fetch. */
  pending?: boolean;
}

export const HoverPriceIntelTable: React.FC<HoverPriceIntelTableProps> = ({ medicineName, medicineId, records, pending }) => {
  const canFetch = !!medicineName && medicineName.length >= 2 && !records && !pending;
  const { data: historyRes, isFetching, isSuccess, isError } = useApiQuery<{ data?: PriceRecord[] }>(
    ['medicine-price-history', medicineId || medicineName],
    () => api.getMedicinePriceHistory(medicineName, medicineId),
    { enabled: canFetch }
  );
  const sourceRecords: PriceRecord[] = (records && records.length > 0 ? records : null) || historyRes?.data || [];
  const loading = !records && (pending || isFetching);
  const loaded = !!records || isSuccess || isError;
  const error = isError ? 'Could not load price history.' : null;

  if (!medicineName || medicineName.length < 2) return null;

  if (!records && loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-muted text-xs p-3">
        <Loader size={12} className="animate-spin text-primary" />
        Loading price history...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-amber-400 p-3">
        <AlertCircle size={12} />
        {error}
      </div>
    );
  }

  if (loaded && sourceRecords.length === 0) {
    return (
      <div className="py-2 text-xs text-muted italic p-3">
        No previous purchases found for "{medicineName}".
      </div>
    );
  }

  // Deduplicate distributors and pick the latest/best record for each
  const distributorMap = new Map<string, PriceRecord>();
  sourceRecords.forEach(r => {
    const rawName = (r.distributor_name || '').trim();
    const key = rawName && rawName.toLowerCase() !== 'unknown' ? rawName : 'Opening Stock';
    const recordWithCleanName: PriceRecord = { ...r, distributor_name: key };
    if (!distributorMap.has(key)) {
      distributorMap.set(key, recordWithCleanName);
    } else {
      const existing = distributorMap.get(key)!;
      // We prefer the lowest rate for best comparison
      if (r.rate < existing.rate) {
        distributorMap.set(key, recordWithCleanName);
      }
    }
  });

  const uniqueRecords = Array.from(distributorMap.values());

  return (
    <div className="p-2 w-full max-h-[320px] overflow-y-auto dropdown-scroll">
      <table className="w-full text-[11px] text-left border-collapse">
        <thead>
          <tr className="border-b border-border/40 text-muted">
            <th className="pb-1 font-semibold">Distributor</th>
            <th className="pb-1 text-right font-semibold">Rate</th>
            <th className="pb-1 text-right font-semibold">MRP</th>
            <th className="pb-1 text-right font-semibold">Margin</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {uniqueRecords.slice(0, 15).map((r, i) => {
            const marginAmount = r.mrp - r.rate;
            const marginPercent = r.mrp > 0 ? ((marginAmount / r.mrp) * 100) : 0;
            
            return (
              <tr key={i} className="hover:bg-bg2/40 transition-colors">
                <td className="py-1.5 text-text pr-2 truncate max-w-[140px]" title={r.distributor_name}>
                  {r.distributor_name}
                </td>
                <td className="py-1.5 text-right text-text pl-2">₹{r.rate.toFixed(2)}</td>
                <td className="py-1.5 text-right text-muted pl-2 font-semibold">₹{r.mrp.toFixed(2)}</td>
                <td className="py-1.5 text-right text-primary pl-2 font-medium">{marginPercent.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
