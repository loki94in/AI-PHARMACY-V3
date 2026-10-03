import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Search, X, Calendar, Loader2, FileText, Edit, Trash2, Wand2, AlertTriangle, History,
} from 'lucide-react';
import { api } from '../../services/api';
import { toastEvent } from '../../services/events';
import { useInfiniteScroll, clearInfiniteScrollCache } from '../../hooks/useInfiniteScroll';
import { InfiniteScrollStatus } from '../../components/InfiniteScrollStatus';
import { usePersistedDateRange } from '../../hooks/usePersistedDateRange';
import { getTodayString, getNDaysAgoString, toDateInputValue, getLocalDateString } from '../../utils/date';
import { invalidateAfterStockWrite } from '../../utils/cacheInvalidation';
import { BaseModal } from '../../components/common/BaseModal';

export interface LocalReturnHistoryRow {
  id: number;
  return_no?: string | null;
  date?: string | null;
  type?: string | null;
  total_amount?: number | null;
  original_invoice_id?: number | string | null;
  distributor_id?: number | null;
  distributor_name?: string | null;
  purchase_invoice_no?: string | null;
  return_invoice_id?: string | null;
  return_sub_type?: string | null;
  reason?: string | null;
}

export interface LocalHistoryReturnDetail {
  id: string;
  medicine_id: number | null;
  medicine_name: string;
  batch_no: string;
  expiry_date: string;
  quantity: number | string | null;
  cost_price: number | string | null;
  mrp: number | string | null;
  invoice_no?: string;
  purchase_date?: string;
  distributor_name?: string;
  distributor_id?: number;
}

export type LocalEditableReturnItem = LocalHistoryReturnDetail & {
  _resolved_fields?: string[];
};

interface LocalReturnItemRow {
  id: number;
  medicine_id: number | null;
  medicine_name?: string | null;
  batch_no?: string | null;
  expiry_date?: string | null;
  quantity?: number | string | null;
  cost_price?: number | null;
  mrp?: number | null;
  invoice_no?: string | null;
  purchase_date?: string | null;
  distributor_name?: string | null;
  distributor_id?: number | null;
  ret_invoice_no?: string | null;
  ret_purchase_date?: string | null;
  ret_distributor_name?: string | null;
  ret_distributor_id?: number | null;
  _resolved_fields?: string[];
}

const sanitizeMonth = (mStr: string): string => {
  let m = parseInt(mStr, 10);
  if (isNaN(m) || m < 1) m = 1;
  if (m > 12) m = 12;
  return m < 10 ? `0${m}` : `${m}`;
};

const formatExpiryToMMYY = (val: string): string => {
  if (!val) return '';
  const cleaned = val.trim().replace(/\s+/g, '');
  if (cleaned === '00000000' || cleaned === '00/00' || cleaned === '*' || cleaned === '***' || cleaned === '//*' || cleaned === '-') return '';

  const isoMatch = cleaned.match(/^(\d{4})[\/\-](\d{1,2})(?:[\/\-](\d{1,2}))?/);
  if (isoMatch) {
    const mm = sanitizeMonth(isoMatch[2]);
    const yy = isoMatch[1].substring(2, 4);
    return `${mm}/${yy}`;
  }

  const monthMap: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const monthNameMatch = cleaned.match(/(?:(\d{1,2})[\/\-\s]+)?([a-z]{3,9})[\/\-\s]+(\d{2,4})/i);
  if (monthNameMatch) {
    const mStr = monthNameMatch[2].substring(0, 3).toLowerCase();
    const mm = monthMap[mStr];
    let yy = monthNameMatch[3];
    if (mm) {
      if (yy.length === 4) yy = yy.substring(2, 4);
      return `${mm}/${yy}`;
    }
  }

  const threeParts = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (threeParts) {
    const p1 = parseInt(threeParts[1], 10);
    const p2 = parseInt(threeParts[2], 10);
    let yy = threeParts[3];
    if (yy.length === 4) yy = yy.substring(2, 4);

    let mm = '';
    if (p1 > 12 && p2 >= 1 && p2 <= 12) {
      mm = sanitizeMonth(threeParts[2]);
    } else if (p2 > 12 && p1 >= 1 && p1 <= 12) {
      mm = sanitizeMonth(threeParts[1]);
    } else if (p2 >= 1 && p2 <= 12) {
      mm = sanitizeMonth(threeParts[2]);
    } else if (p1 >= 1 && p1 <= 12) {
      mm = sanitizeMonth(threeParts[1]);
    }
    if (mm && yy) return `${mm}/${yy}`;
  }

  const mmYyyy = cleaned.match(/^(\d{1,2})[\/\-](\d{4})$/);
  if (mmYyyy) {
    const mm = sanitizeMonth(mmYyyy[1]);
    const yy = mmYyyy[2].substring(2, 4);
    return `${mm}/${yy}`;
  }

  return cleaned;
};

export interface SupplierReturnHistoryProps {
  onTotalCountChange?: (count: number) => void;
}

export const SupplierReturnHistory: React.FC<SupplierReturnHistoryProps> = ({
  onTotalCountChange,
}) => {
  const queryClient = useQueryClient();
  const [searchFilterText, setSearchFilterText] = useState('');
  const todayStr = getTodayString();
  const thirtyDaysAgoStr = getNDaysAgoString(30);

  const dateRangeHelper = usePersistedDateRange({
    storageKey: 'supplier-returns',
    defaultFrom: thirtyDaysAgoStr,
    defaultTo: todayStr,
  });

  const {
    items: returnHistory,
    totalItems: returnHistoryTotal,
    isFetching: loadingHistory,
    isFetchingNextPage: loadingMoreHistory,
    hasNextPage: hasMoreHistory,
    fetchNextPage: fetchMoreHistory,
    sentinelRef: historySentinelRef,
    refetch: refetchHistory,
  } = useInfiniteScroll<LocalReturnHistoryRow>({
    queryKey: 'supplier-return-history-list',
    cacheKey: 'supplier-return-history-cache',
    serverFilters: {
      search: searchFilterText.trim(),
      date_from: dateRangeHelper.dateRange.from,
      date_to: dateRangeHelper.dateRange.to,
    },
    fetchPage: async (pageParam, filters) => {
      const response = await api.getReturns({
        page: pageParam,
        limit: 30,
        search: filters.search || undefined,
        date_from: filters.date_from || undefined,
        date_to: filters.date_to || undefined,
      });
      if (response && response.data) {
        return {
          data: response.data || [],
          totalItems: response.totalItems || 0,
          totalPages: response.totalPages || 1,
        };
      } else {
        const list = Array.isArray(response) ? response : [];
        return {
          data: list,
          totalItems: list.length,
          totalPages: 1,
        };
      }
    },
  });

  useEffect(() => {
    if (onTotalCountChange) {
      onTotalCountChange(returnHistoryTotal || returnHistory.length);
    }
  }, [returnHistoryTotal, returnHistory.length, onTotalCountChange]);

  useEffect(() => {
    const handleStockWrite = () => {
      refetchHistory().catch(() => {});
    };
    window.addEventListener('stock-write-completed', handleStockWrite);
    window.addEventListener('sse-return-created', handleStockWrite);
    return () => {
      window.removeEventListener('stock-write-completed', handleStockWrite);
      window.removeEventListener('sse-return-created', handleStockWrite);
    };
  }, [refetchHistory]);

  const [selectedHistoryReturn, setSelectedHistoryReturn] = useState<LocalReturnHistoryRow | null>(null);
  const [historyReturnItems, setHistoryReturnItems] = useState<LocalHistoryReturnDetail[]>([]);
  const [loadingHistoryItems, setLoadingHistoryItems] = useState(false);
  const [isEditingHistory, setIsEditingHistory] = useState(false);
  const [editingItems, setEditingItems] = useState<LocalEditableReturnItem[]>([]);
  const [isResolving, setIsResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmReturn, setDeleteConfirmReturn] = useState<LocalReturnHistoryRow | null>(null);

  const hasMissingData = historyReturnItems.some(
    (i) => !i.batch_no || !i.expiry_date || !i.cost_price
  );

  const handleSelectHistoryReturn = async (ret: LocalReturnHistoryRow) => {
    setSelectedHistoryReturn(ret);
    setLoadingHistoryItems(true);
    setIsEditingHistory(false);
    try {
      const response = await api.getReturnItems(ret.id);
      const mapped = ((response || []) as LocalReturnItemRow[]).map(
        (item): LocalHistoryReturnDetail => ({
          id: String(item.id),
          medicine_id: item.medicine_id,
          medicine_name: item.medicine_name || 'Unknown Medicine',
          batch_no: item.batch_no || '',
          expiry_date: item.expiry_date ? formatExpiryToMMYY(item.expiry_date) : '',
          quantity: item.quantity ?? null,
          cost_price: item.cost_price ?? null,
          mrp: item.mrp || 0,
          invoice_no: item.invoice_no || ret.purchase_invoice_no || ret.return_invoice_id || 'N/A',
          purchase_date: item.purchase_date || '',
          distributor_name: item.distributor_name || ret.distributor_name || 'Unknown Distributor',
          distributor_id: item.distributor_id || ret.distributor_id || undefined,
        })
      );
      setHistoryReturnItems(mapped);
      setEditingItems(
        mapped.map((i) => ({
          ...i,
          quantity: i.quantity ?? '',
          cost_price: i.cost_price ?? '',
          mrp: i.mrp ?? 0,
        }))
      );
    } catch (error) {
      console.error('Error fetching return items:', error);
    } finally {
      setLoadingHistoryItems(false);
    }
  };

  const handleClearHistorySelection = () => {
    setSelectedHistoryReturn(null);
    setHistoryReturnItems([]);
  };

  const handleConfirmDeleteReturn = async () => {
    if (!deleteConfirmReturn) return;
    try {
      await api.deleteReturn(deleteConfirmReturn.id);
      if (selectedHistoryReturn?.id === deleteConfirmReturn.id) handleClearHistorySelection();
      invalidateAfterStockWrite(queryClient);
      clearInfiniteScrollCache('supplier-return-history-cache');
      refetchHistory().catch(() => {});
      api.getCompactInventory().catch(() => {});
      toastEvent.trigger(`Return ${deleteConfirmReturn.return_no} deleted.`, 'success', '/returns');
    } catch (err) {
      console.error('Failed to delete return:', err);
      toastEvent.trigger('Failed to delete return.', 'error', '/returns');
    } finally {
      setDeleteConfirmReturn(null);
    }
  };

  const handleSaveHistoryEdit = async () => {
    if (!selectedHistoryReturn) return;
    setSaving(true);
    try {
      const validItems = editingItems.filter(
        (i) => i.medicine_id && (parseFloat(String(i.quantity)) || 0) > 0
      );
      const total = validItems.reduce(
        (s, i) => s + (Number(i.cost_price) || 0) * (Number(i.quantity) || 0),
        0
      );
      await api.updateReturn(selectedHistoryReturn.id, {
        items: validItems as unknown as Array<Record<string, unknown>>,
        total_amount: total,
      });
      setIsEditingHistory(false);
      await handleSelectHistoryReturn(selectedHistoryReturn);
      invalidateAfterStockWrite(queryClient);
      clearInfiniteScrollCache('supplier-return-history-cache');
      refetchHistory().catch(() => {});
      api.getCompactInventory().catch(() => {});
      toastEvent.trigger('Return claim updated successfully.', 'success', '/returns');
    } catch (err) {
      console.error('Failed to save return:', err);
      toastEvent.trigger('Failed to save changes.', 'error', '/returns');
    } finally {
      setSaving(false);
    }
  };

  const handleResolveMissing = async () => {
    if (!selectedHistoryReturn) return;
    setIsResolving(true);
    try {
      const response = await api.resolveReturnMissing(selectedHistoryReturn.id);
      const mapped = ((response || []) as LocalReturnItemRow[]).map(
        (item): LocalEditableReturnItem => ({
          id: String(item.id),
          medicine_id: item.medicine_id,
          medicine_name: item.medicine_name || 'Unknown Medicine',
          batch_no: item.batch_no || '',
          expiry_date: item.expiry_date ? formatExpiryToMMYY(item.expiry_date) : '',
          quantity: item.quantity ?? '',
          cost_price: item.cost_price ?? '',
          mrp: item.mrp || 0,
          invoice_no: item.invoice_no || item.ret_invoice_no || 'N/A',
          purchase_date: item.purchase_date || item.ret_purchase_date || '',
          distributor_name: item.distributor_name || item.ret_distributor_name || 'Unknown Distributor',
          distributor_id: item.distributor_id || item.ret_distributor_id || undefined,
          _resolved_fields: item._resolved_fields || [],
        })
      );
      setEditingItems(mapped);
      setIsEditingHistory(true);
      toastEvent.trigger('Missing fields resolved from purchase history.', 'success', '/returns');
    } catch (err) {
      console.error('Failed to resolve missing data:', err);
      toastEvent.trigger('Failed to auto-fill missing data.', 'error', '/returns');
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <div className="flex-1 flex gap-4 min-h-0 overflow-hidden text-text relative">
      {/* Left Column: Supplier Return History List & Filters */}
      <div className="w-96 flex-shrink-0 flex flex-col gap-3 min-h-0 overflow-hidden bg-bg2 border border-border rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between border-b border-border pb-2.5 flex-shrink-0">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-black uppercase tracking-wider text-text">Finalized Supplier Returns</h3>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-bg3 text-primary border border-border font-mono">
              {returnHistoryTotal || returnHistory.length}
            </span>
          </div>
        </div>

        {/* Quick Search */}
        <div className="relative flex-shrink-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search return no, supplier..."
            value={searchFilterText}
            onChange={(e) => setSearchFilterText(e.target.value)}
            className="w-full pl-8 pr-7 py-2 bg-bg3 border border-border rounded-xl text-xs text-text placeholder:text-muted focus:outline-none focus:border-primary font-medium transition-all"
          />
          {searchFilterText && (
            <button
              onClick={() => setSearchFilterText('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text p-0.5 rounded-full cursor-pointer"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Date Filter Bar */}
        <div className="p-2.5 bg-bg3 rounded-xl border border-border space-y-2 text-[10px] flex-shrink-0">
          {/* Preset Pills */}
          <div className="flex items-center gap-1 bg-bg2 p-1 rounded-lg border border-border">
            {[
              {
                label: '30 Days',
                key: '30d',
                action: () => dateRangeHelper.setPreset(30),
                active:
                  dateRangeHelper.dateRange.from === thirtyDaysAgoStr &&
                  dateRangeHelper.dateRange.to === todayStr,
              },
              {
                label: 'Today',
                key: 'today',
                action: () => dateRangeHelper.setDateRange({ from: todayStr, to: todayStr }),
                active:
                  dateRangeHelper.dateRange.from === todayStr &&
                  dateRangeHelper.dateRange.to === todayStr,
              },
              {
                label: 'This Month',
                key: 'month',
                action: () => {
                  const n = new Date();
                  const f = getLocalDateString(new Date(n.getFullYear(), n.getMonth(), 1));
                  dateRangeHelper.setDateRange({ from: f, to: todayStr });
                },
                active:
                  dateRangeHelper.dateRange.from ===
                    getLocalDateString(new Date(new Date().getFullYear(), new Date().getMonth(), 1)) &&
                  dateRangeHelper.dateRange.to === todayStr,
              },
              {
                label: 'All Time',
                key: 'all',
                action: () => dateRangeHelper.setDateRange({ from: '', to: '' }),
                active: !dateRangeHelper.dateRange.from && !dateRangeHelper.dateRange.to,
              },
            ].map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={p.action}
                className={`flex-1 py-1 px-1 rounded-md text-[10px] font-bold transition-all text-center cursor-pointer ${
                  p.active
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-muted hover:text-text hover:bg-bg3'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom From/To Date Inputs */}
          <div className="flex items-center gap-1.5 bg-bg border border-border rounded-lg px-2 py-1">
            <Calendar size={12} className="text-primary shrink-0" />
            <span className="text-muted font-bold text-[10px] uppercase">From</span>
            <input
              type="date"
              value={toDateInputValue(dateRangeHelper.dateRange.from)}
              max={todayStr}
              onChange={(e) => dateRangeHelper.handleFromChange(e.target.value)}
              className="flex-1 bg-transparent text-[10px] text-text font-mono focus:outline-none cursor-pointer w-0 min-w-0"
            />
            <span className="text-muted font-bold text-[10px] uppercase ml-1">To</span>
            <input
              type="date"
              value={toDateInputValue(dateRangeHelper.dateRange.to)}
              max={todayStr}
              onChange={(e) => dateRangeHelper.handleToChange(e.target.value)}
              className="flex-1 bg-transparent text-[10px] text-text font-mono focus:outline-none cursor-pointer w-0 min-w-0"
            />
          </div>
        </div>

        {/* Finalized Returns List */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar min-h-0">
          {loadingHistory && returnHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted">
              <Loader2 size={20} className="animate-spin text-primary" />
              <span className="text-xs">Loading returns...</span>
            </div>
          ) : returnHistory.length === 0 ? (
            <div className="text-center py-8 text-muted text-xs italic">No supplier return records found.</div>
          ) : (
            <>
              {returnHistory.map((ret) => {
                const isSelected = selectedHistoryReturn?.id === ret.id;
                return (
                  <div
                    key={ret.id}
                    onClick={() => handleSelectHistoryReturn(ret)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-1.5 select-none ${
                      isSelected
                        ? 'bg-primary/10 border-primary text-text font-bold ring-1 ring-primary/30'
                        : 'bg-bg3 border-border text-muted hover:text-text hover:bg-bg3/80'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-xs font-bold text-text">
                          {ret.return_no || `RET-${ret.id}`}
                        </span>
                        {ret.return_sub_type === 'good' ? (
                          <span className="text-[9px] font-extrabold px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-mono">
                            Goods Return
                          </span>
                        ) : (
                          <span className="text-[9px] font-extrabold px-1.5 py-0.2 rounded bg-red-500/10 text-red-500 border border-red-500/20 font-mono">
                            Expiry
                          </span>
                        )}
                      </div>
                      <span className="text-emerald-500 font-extrabold text-xs font-mono">
                        ₹{Number(ret.total_amount || 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="truncate font-semibold text-text">
                        {ret.distributor_name || 'Direct Supplier'}
                      </span>
                      <span className="font-mono text-muted">
                        {ret.date ? ret.date.substring(0, 10) : '—'}
                      </span>
                    </div>
                    {ret.reason && (
                      <div className="text-[10px] text-muted truncate font-medium flex items-center gap-1">
                        <span className="text-[9px] uppercase font-bold text-text/70">Reason:</span>
                        <span>{ret.reason}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[11px] pt-1 border-t border-border mt-0.5">
                      <span
                        className="font-mono text-[11px] text-blue-500 font-bold"
                        title="Their Purchase Bill Invoice Number"
                      >
                        Bill: {ret.purchase_invoice_no || ret.return_invoice_id || '—'}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirmReturn(ret);
                        }}
                        className="text-muted hover:text-red p-1 rounded hover:bg-red/10 transition-colors cursor-pointer"
                        title="Delete return"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
              <InfiniteScrollStatus
                totalItems={returnHistoryTotal}
                loadedCount={returnHistory.length}
                isFetching={loadingHistory}
                isFetchingNextPage={loadingMoreHistory}
                hasNextPage={hasMoreHistory}
                onLoadMore={fetchMoreHistory}
                sentinelRef={historySentinelRef}
                itemName="returns"
              />
            </>
          )}
        </div>
      </div>

      {/* Right Column: Return Items Details */}
      <div className="flex-1 flex flex-col min-h-0 bg-bg2 border border-border rounded-2xl p-4 shadow-sm overflow-hidden">
        {selectedHistoryReturn ? (
          <div className="flex-1 flex flex-col min-h-0 gap-3">
            <div className="flex items-center justify-between border-b border-border pb-3 flex-shrink-0">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-black text-text">Return Claim #{selectedHistoryReturn.return_no}</h3>
                  {selectedHistoryReturn.return_sub_type === 'good' ? (
                    <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                      🟢 Goods Return
                    </span>
                  ) : (
                    <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 border border-red-500/20">
                      🔴 Expiry Return
                    </span>
                  )}
                  {(selectedHistoryReturn.purchase_invoice_no || selectedHistoryReturn.return_invoice_id) && (
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 border border-blue-500/20 font-bold">
                      Purchase Bill: {selectedHistoryReturn.purchase_invoice_no || selectedHistoryReturn.return_invoice_id}
                    </span>
                  )}
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                    Finalized
                  </span>
                </div>
                <p className="text-xs text-muted mt-0.5">
                  Supplier: <strong>{selectedHistoryReturn.distributor_name || 'Direct Supplier'}</strong>
                  {(selectedHistoryReturn.purchase_invoice_no || selectedHistoryReturn.return_invoice_id) && (
                    <> • Purchase Bill: <strong className="text-blue-500 font-mono">{selectedHistoryReturn.purchase_invoice_no || selectedHistoryReturn.return_invoice_id}</strong></>
                  )}
                  {' '}• Date: {selectedHistoryReturn.date?.substring(0, 10)}
                  {selectedHistoryReturn.reason && (
                    <> • Reason: <strong className="text-text">{selectedHistoryReturn.reason}</strong></>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {isEditingHistory ? (
                  <>
                    <button
                      onClick={handleSaveHistoryEdit}
                      disabled={saving}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all disabled:opacity-50 shadow-sm cursor-pointer"
                    >
                      {saving ? 'Saving…' : 'Save Changes'}
                    </button>
                    <button
                      onClick={() => setIsEditingHistory(false)}
                      className="bg-bg3 border border-border hover:bg-bg3/80 text-text font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    {hasMissingData && (
                      <button
                        onClick={handleResolveMissing}
                        disabled={isResolving}
                        className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/30 font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all disabled:opacity-60 cursor-pointer"
                        title="Auto-fill missing batch, expiry, cost from purchase history"
                      >
                        {isResolving ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                        <span>Auto-fill Missing</span>
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        try {
                          const blob = await api.exportReturnsPDF(
                            historyReturnItems as unknown as ReadonlyArray<Record<string, unknown>>
                          );
                          const url = window.URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `return-${selectedHistoryReturn.return_no}-${Date.now()}.pdf`;
                          document.body.appendChild(a);
                          a.click();
                          window.URL.revokeObjectURL(url);
                          document.body.removeChild(a);
                        } catch (error) {
                          console.error('Error exporting PDF:', error);
                          toastEvent.trigger('Failed to export PDF.', 'error', '/returns');
                        }
                      }}
                      className="bg-purple-600 hover:bg-purple-500 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
                    >
                      <FileText size={13} /> Export PDF
                    </button>
                    <button
                      onClick={() => setIsEditingHistory(true)}
                      className="bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      <Edit size={13} /> Edit
                    </button>
                    <button
                      onClick={handleClearHistorySelection}
                      className="bg-bg3 border border-border hover:bg-bg3/80 text-text font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      Back
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Table View */}
            <div className="flex-1 overflow-auto bg-bg rounded-2xl border border-border">
              {loadingHistoryItems ? (
                <div className="flex flex-col items-center justify-center h-full py-12 gap-3 text-muted">
                  <Loader2 className="animate-spin text-primary" size={32} />
                  <span className="text-xs font-bold">Loading finalized items...</span>
                </div>
              ) : (
                <table className="w-full text-left border-collapse min-w-[650px]">
                  <thead className="sticky top-0 z-20 bg-bg2 border-b border-border shadow-sm text-muted text-xs font-bold">
                    <tr>
                      <th className="p-3 w-10">#</th>
                      <th className="p-3 min-w-[220px]">Medicine Name</th>
                      <th className="p-3 w-28">Batch</th>
                      <th className="p-3 w-28">Expiry</th>
                      <th className="p-3 w-20 text-center">Qty</th>
                      <th className="p-3 w-24 text-right">Cost Price</th>
                      <th className="p-3 w-24 text-right">Total</th>
                      <th className="p-3 w-32 text-center" title="Distributor's Purchase Bill Invoice Number">Purchase Bill Inv #</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(isEditingHistory ? editingItems : historyReturnItems).map((item, index) => (
                      <tr key={item.id} className="border-b border-border hover:bg-bg3/30 transition-colors text-xs">
                        <td className="p-3 text-muted font-mono">{index + 1}</td>
                        <td className="p-3 font-bold text-text">{item.medicine_name}</td>
                        <td className="p-2 font-mono text-muted">{item.batch_no || '—'}</td>
                        <td className="p-2 font-mono text-muted">{item.expiry_date || '—'}</td>
                        <td className="p-2 text-center font-mono font-bold text-text">{item.quantity ?? '—'}</td>
                        <td className="p-2 text-right font-mono text-muted">
                          {item.cost_price != null ? `₹${Number(item.cost_price).toFixed(2)}` : '—'}
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-text">
                          {item.cost_price != null && item.quantity != null
                            ? `₹${(Number(item.cost_price) * Number(item.quantity)).toFixed(2)}`
                            : '—'}
                        </td>
                        <td className="p-2 text-center">
                          <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-500 border border-blue-500/20 font-mono text-[10px]">
                            {item.invoice_no || 'N/A'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-muted gap-3">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <History size={28} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text">Select a Return Claim</h3>
              <p className="text-xs text-muted mt-1 max-w-sm">
                Choose any finalized supplier return from the left list to review returned medicines, batches, quantities, reprint debit notes, or edit.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Delete Return Confirmation Modal */}
      <BaseModal
        isOpen={!!deleteConfirmReturn}
        onClose={() => setDeleteConfirmReturn(null)}
        title="Delete Return Record?"
        subtitle={deleteConfirmReturn ? `Claim #${deleteConfirmReturn.return_no}` : undefined}
        icon={<AlertTriangle size={20} />}
        maxWidth="max-w-sm"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button
              onClick={() => setDeleteConfirmReturn(null)}
              className="px-4 py-2 rounded-xl bg-bg3 border border-border text-text font-bold text-xs hover:bg-bg3/80 cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmDeleteReturn}
              className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs cursor-pointer shadow-sm"
            >
              Delete Return
            </button>
          </div>
        }
      >
        <p className="text-xs text-muted">
          Are you sure you want to delete this finalized return? This action cannot be undone.
        </p>
      </BaseModal>
    </div>
  );
};
