import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, apiClient } from '../../services/api';
import { invalidateAfterStockWrite } from '../../utils/cacheInvalidation';
import { useApiQuery } from '../../hooks/useApiQuery';
import {
  Download,
  Eye,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Trash2,
  Edit,
  Calendar,
  Loader2,
  QrCode,
  Printer,
  Clock,
  X,
  Search,
  Filter,
  Receipt,
  IndianRupee,
  TrendingUp,
  Building2,
  Package,
  FileSpreadsheet,
  FileText
} from 'lucide-react';
import { usePersistedDateRange } from '../../hooks/usePersistedDateRange';
import { getTodayString, getNDaysAgoString, formatDisplayDate, toDateInputValue } from '../../utils/date';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import { useVirtualizer } from '../../hooks/useVirtualizer';
import { InfiniteTable } from '../../components/InfiniteTable';
import { VirtualRow } from '../../components/VirtualRow';
import { InfiniteScrollStatus } from '../../components/InfiniteScrollStatus';
import { exportToCSV, exportToPDF } from '../../utils/export';
import { toastEvent } from '../../services/events';
import { useModalEscape } from '../../services/keyboardShortcuts';

interface LocalPurchaseItem {
  medicine_id?: number | null;
  medicine_name?: string | null;
  name?: string | null;
  batch_no?: string | null;
  batch_number?: string | null;
  batch?: string | null;
  expiry_date?: string | null;
  quantity?: number | null;
  free_qty?: number | null;
  cost_price?: number | string | null;
  mrp?: number | string | null;
  cgst_per?: number | null;
  sgst_per?: number | null;
  cd_per?: number | null;
  cd_value?: number | null;
}

interface LocalMatchedPurchase {
  id: number;
  invoice_no: string;
  app_invoice_no: string;
  total_amount: number;
  date: string;
}

interface LocalReconRow {
  email_uid: number;
  from: string;
  subject: string;
  body_snippet: string;
  date: string;
  is_seen: boolean;
  is_saved: boolean;
  extracted_distributor: string;
  extracted_invoice_no: string;
  matched_purchase: LocalMatchedPurchase | null;
  status: 'Missing' | 'Bounced' | 'Matched';
  medicine_names: string[];
  attachments: { filename: string; size: number; content_type: string }[];
}

interface LocalViewedPurchase {
  purchase: {
    id: number;
    invoice_no: string;
    distributor_id?: number;
    distributor_name: string;
    date: string;
    total_amount: number;
    original_amount?: number;
    cn_amount: number;
    cn_number?: string;
    reconcile_expiry_return_id?: number | null;
  };
  items: LocalPurchaseItem[];
}

interface PurchaseTransaction {
  id: number;
  invoice_no: string;
  date: string;
  total_amount: number;
  distributor_name: string;
  status?: string;
  plan?: string;
  items?: LocalPurchaseItem[];
  total_qty?: number;
  cn_amount?: number;
  cn_number?: string;
  original_amount?: number;
}

// Guards against out-of-order bill-barcode responses when switching purchases quickly
let billBarcodeSeq = 0;
const nextBillBarcodeRequestId = (): number => ++billBarcodeSeq;

const PurchaseHistory: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [colFilterId, setColFilterId] = useState('');
  const [colFilterDistributor, setColFilterDistributor] = useState('');
  const [colFilterInvoiceNo, setColFilterInvoiceNo] = useState('');
  const [colFilterDate, setColFilterDate] = useState('');
  const [colFilterMinAmount, setColFilterMinAmount] = useState('');
  const [colFilterMaxAmount, setColFilterMaxAmount] = useState('');
  const [showColFilters, setShowColFilters] = useState(false);

  // Modals & active states
  const [activeTab, setActiveTab] = useState<'history' | 'reconciliation'>('history');
  const [selectedOrder, setSelectedOrder] = useState<LocalReconRow | null>(null);
  const [reissuingUid, setReissuingUid] = useState<number | null>(null);
  const [viewPurchase, setViewPurchase] = useState<LocalViewedPurchase | null>(null);
  const [deleteConfirmPurchase, setDeleteConfirmPurchase] = useState<PurchaseTransaction | null>(null);
  const [deletingPurchaseId, setDeletingPurchaseId] = useState<number | null>(null);

  // Barcodes
  const [generatingBarcodeId, setGeneratingBarcodeId] = useState<number | null>(null);
  const [generatingItemIndex, setGeneratingItemIndex] = useState<number | null>(null);
  const [billBarcode, setBillBarcode] = useState<{
    billNo: string;
    barcodeText: string;
    qrDataUrl: string;
    code128DataUrl: string;
    pdfUrl: string;
  } | null>(null);
  const [loadingBillBarcode, setLoadingBillBarcode] = useState(false);

  // Reset modal states on route change
  useEffect(() => {
    setSelectedOrder(null);
    setViewPurchase(null);
    setDeleteConfirmPurchase(null);
  }, [location.pathname]);

  // Universal Escape key dismissal for modals
  useModalEscape(!!selectedOrder, () => setSelectedOrder(null));
  useModalEscape(!!viewPurchase, () => setViewPurchase(null));
  useModalEscape(!!deleteConfirmPurchase, () => setDeleteConfirmPurchase(null));

  const dateRangeHelper = usePersistedDateRange({
    storageKey: 'purchase-history-date-range-v2',
    defaultFrom: '',
    defaultTo: '',
  });

  // Clear legacy date range storage on mount to ensure fresh initial view
  useEffect(() => {
    try {
      localStorage.removeItem('purchase-history-date-range');
    } catch {}
  }, []);

  // Client-side filtering logic
  const clientFilterFn = useCallback((t: PurchaseTransaction) => {
    if (colFilterId && !t.id.toString().includes(colFilterId)) {
      return false;
    }
    if (colFilterDistributor && !(t.distributor_name || '').toLowerCase().includes(colFilterDistributor.toLowerCase())) {
      return false;
    }
    if (colFilterInvoiceNo && !(t.invoice_no || '').toLowerCase().includes(colFilterInvoiceNo.toLowerCase())) {
      return false;
    }
    if (colFilterDate) {
      const pDate = t.date ? t.date.substring(0, 10) : '';
      if (pDate !== colFilterDate) return false;
    }
    const amountVal = t.total_amount || 0;
    const minVal = colFilterMinAmount ? Number(colFilterMinAmount) : 0;
    const maxVal = colFilterMaxAmount ? Number(colFilterMaxAmount) : 100000000;
    if (amountVal < minVal || amountVal > maxVal) {
      return false;
    }
    return true;
  }, [colFilterId, colFilterDistributor, colFilterInvoiceNo, colFilterDate, colFilterMinAmount, colFilterMaxAmount]);

  const hasColumnFilters = !!(
    colFilterId ||
    colFilterDistributor ||
    colFilterInvoiceNo ||
    colFilterDate ||
    colFilterMinAmount ||
    colFilterMaxAmount
  );

  const activeFilterCount = useMemo(() => {
    return [
      colFilterId,
      colFilterDistributor,
      colFilterInvoiceNo,
      colFilterDate,
      colFilterMinAmount || colFilterMaxAmount,
    ].filter(Boolean).length;
  }, [colFilterId, colFilterDistributor, colFilterInvoiceNo, colFilterDate, colFilterMinAmount, colFilterMaxAmount]);

  const handleClearColumnFilters = () => {
    setColFilterId('');
    setColFilterDistributor('');
    setColFilterInvoiceNo('');
    setColFilterDate('');
    setColFilterMinAmount('');
    setColFilterMaxAmount('');
  };

  const isDateFiltered = !!(dateRangeHelper.dateRange.from || dateRangeHelper.dateRange.to);

  // Infinite Scroll setup
  const {
    items,
    totalItems,
    meta,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    sentinelRef,
  } = useInfiniteScroll<PurchaseTransaction>({
    queryKey: 'purchase-history-list',
    cacheKey: 'purchase-history-cache',
    serverFilters: {
      search: searchQuery,
      start: dateRangeHelper.dateRange.from,
      end: dateRangeHelper.dateRange.to,
    },
    clientFilterFn,
    fetchPage: async (pageParam, filters) => {
      const isSearching = !!(filters.search && filters.search.trim().length >= 2);
      const response = await api.getPurchases({
        page: isDateFiltered && !isSearching ? undefined : pageParam,
        limit: isDateFiltered && !isSearching ? 10000 : 50,
        search: filters.search || undefined,
        start: isSearching ? undefined : (filters.start || undefined),
        end: isSearching ? undefined : (filters.end || undefined),
      });
      if (response && response.data) {
        return {
          data: response.data || [],
          totalItems: response.totalItems || 0,
          totalPages: response.totalPages || 1,
          meta: { totalAmount: response.totalAmount || 0 },
        };
      } else {
        const list = Array.isArray(response) ? response : [];
        const listAmount = list.reduce((sum: number, t: PurchaseTransaction) => sum + (t.total_amount || 0), 0);
        return {
          data: list,
          totalItems: list.length,
          totalPages: 1,
          meta: { totalAmount: listAmount },
        };
      }
    },
  });

  const parentRef = useRef<HTMLDivElement | null>(null);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 10,
  });

  // Reconciliation list via react-query
  const {
    data: reconciliationData,
    isFetching: loadingRecon,
    refetch: fetchReconciliation,
  } = useApiQuery<LocalReconRow[]>(
    ['purchase-reconciliation'],
    () => api.getReconciliationList(),
  );
  const reconciliationList = reconciliationData || [];

  useEffect(() => {
    const handleUpdate = () => {
      refetch();
      fetchReconciliation();
    };
    window.addEventListener('stock-write-completed', handleUpdate);
    window.addEventListener('app-purchases-updated', handleUpdate);
    return () => {
      window.removeEventListener('stock-write-completed', handleUpdate);
      window.removeEventListener('app-purchases-updated', handleUpdate);
    };
  }, [refetch, fetchReconciliation]);

  const handlePrintBillBarcodes = async (purchaseId: number, existingItems?: LocalPurchaseItem[]) => {
    setGeneratingBarcodeId(purchaseId);
    try {
      let billItems = existingItems;
      if (!billItems || billItems.length === 0) {
        const res = await api.getPurchase(purchaseId);
        billItems = res?.items || [];
      }

      const payload = (billItems || [])
        .filter((it: LocalPurchaseItem) => (it.name || it.medicine_name || '').trim().length > 0)
        .map((it: LocalPurchaseItem) => ({
          name: (it.name || it.medicine_name || 'Medicine').trim(),
          batch: (it.batch_no || it.batch_number || it.batch || 'N/A').trim(),
        }));

      if (payload.length === 0) {
        toastEvent.trigger('No valid items found in purchase bill for barcode generation', 'error');
        return;
      }

      const res = await api.generateMedicineBarcodes(payload);
      if (res && res.pdfUrl) {
        toastEvent.trigger(`Generated ${payload.length} product barcode label(s)`, 'success');
        window.open(res.pdfUrl, '_blank');
      } else {
        toastEvent.trigger('Failed to generate product barcode labels', 'error');
      }
    } catch (err) {
      console.error('Bill barcode generation error:', err);
      toastEvent.trigger('Failed to generate product barcode labels', 'error');
    } finally {
      setGeneratingBarcodeId(null);
    }
  };

  const handlePrintSingleProductBarcode = async (item: LocalPurchaseItem, itemIndex?: number) => {
    const name = (item.name || item.medicine_name || 'Medicine').trim();
    const batch = (item.batch_no || item.batch_number || item.batch || 'N/A').trim();
    if (!name) {
      toastEvent.trigger('Invalid product for barcode generation', 'error');
      return;
    }

    if (itemIndex !== undefined) setGeneratingItemIndex(itemIndex);
    try {
      const res = await api.generateMedicineBarcodes([{ name, batch }]);
      if (res && res.pdfUrl) {
        toastEvent.trigger(`Generated barcode label for ${name}`, 'success');
        window.open(res.pdfUrl, '_blank');
      } else {
        toastEvent.trigger('Failed to generate product barcode label', 'error');
      }
    } catch (err) {
      console.error('Product barcode generation error:', err);
      toastEvent.trigger('Failed to generate product barcode label', 'error');
    } finally {
      if (itemIndex !== undefined) setGeneratingItemIndex(null);
    }
  };

  const handleReissue = async (uid: number) => {
    try {
      setReissuingUid(uid);
      const previewData = await api.getReconciliationPreview(uid);
      if (selectedOrder?.email_uid === uid) {
        setSelectedOrder(null);
      }
      navigate('/purchases', {
        state: {
          prefilledPurchase: {
            distributorName: previewData.distributorName || '',
            invoiceNo: previewData.invoiceNo || '',
            date: previewData.date || '',
            totalAmount: previewData.totalAmount || 0,
            globalCdPer: previewData.globalCdPer || 0,
            items: previewData.items || []
          },
          emailSource: {
            email_uid: uid
          }
        }
      });
    } catch (err) {
      console.error('Reissue preview error:', err);
      navigate('/purchases');
    } finally {
      setReissuingUid(null);
    }
  };

  const openView = async (id: number) => {
    try {
      const data = await api.getPurchase(id);
      setBillBarcode(null);
      setLoadingBillBarcode(true);
      setViewPurchase(data);
      const reqId = nextBillBarcodeRequestId();
      api.getPurchaseBillBarcode(id)
        .then(barcode => {
          if (reqId === billBarcodeSeq) setBillBarcode(barcode);
        })
        .catch((err: unknown) => {
          console.error('Bill barcode load error:', err);
        })
        .finally(() => {
          if (reqId === billBarcodeSeq) setLoadingBillBarcode(false);
        });
    } catch (err) {
      console.error('Failed to load purchase details:', err);
      toastEvent.trigger('Failed to load purchase details', 'error');
    }
  };

  const closeView = () => {
    setViewPurchase(null);
    setBillBarcode(null);
    setLoadingBillBarcode(false);
  };

  const openEdit = async (id: number) => {
    try {
      const data = await api.getPurchase(id);
      navigate('/purchases', {
        state: {
          prefilledPurchase: {
            editPurchaseId: data.purchase.id,
            distributor_id: data.purchase.distributor_id,
            distributorName: data.purchase.distributor_name,
            invoiceNo: data.purchase.invoice_no,
            date: data.purchase.date,
            totalAmount: data.purchase.total_amount,
            globalCdPer: 0,
            cnAmount: data.purchase.cn_amount || 0,
            cnNumber: data.purchase.cn_number || '',
            reconcileExpiryReturnId: data.purchase.reconcile_expiry_return_id || null,
            items: data.items.map((item: LocalPurchaseItem) => ({
              medicine_id: item.medicine_id,
              medicine_name: item.medicine_name,
              batch_no: item.batch_no,
              expiry_date: item.expiry_date,
              qty: item.quantity,
              free_qty: item.free_qty || 0,
              rate: item.cost_price,
              mrp: item.mrp,
              cgst_per: item.cgst_per,
              sgst_per: item.sgst_per,
              cd_per: item.cd_per || 0,
              cd_rs: item.cd_value || 0
            }))
          }
        }
      });
    } catch (err) {
      console.error('Failed to load purchase details:', err);
      toastEvent.trigger('Failed to load purchase details', 'error');
    }
  };

  const handleDeletePurchase = async (tx: PurchaseTransaction) => {
    setDeletingPurchaseId(tx.id);
    try {
      await api.deletePurchase(tx.id);
      toastEvent.trigger('Purchase deleted and inventory stock reverted', 'success');
      refetch();
      invalidateAfterStockWrite(queryClient);
      setDeleteConfirmPurchase(null);
    } catch (err: unknown) {
      const errorMsg =
        (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error ||
        (err as Error)?.message ||
        'Unknown error';
      toastEvent.trigger('Failed to delete purchase: ' + errorMsg, 'error');
    } finally {
      setDeletingPurchaseId(null);
    }
  };

  const { data: persistentSummary } = useApiQuery<{ totalAmount: number; totalInvoices: number; totalGst: number }>(
    'purchase-summary-cache',
    async () => {
      const res = await apiClient.get('/purchases/summary');
      return res.data;
    },
    { staleTime: 300000, refetchOnWindowFocus: false }
  );

  // Purchase Analytics Summary
  const totalPurchases = hasColumnFilters ? items.length : (totalItems || persistentSummary?.totalInvoices || 0);
  const totalAmount = hasColumnFilters
    ? items.reduce((sum, t) => sum + (t.total_amount || 0), 0)
    : (meta.totalAmount || persistentSummary?.totalAmount || 0);
  const paidAmount = totalAmount; // Cash workflow, all are paid
  const avgInvoiceAmount = totalPurchases > 0 ? totalAmount / totalPurchases : 0;

  const handleExport = (type: 'csv' | 'pdf') => {
    const columns = [
      { key: 'id_formatted', label: 'Purchase ID' },
      { key: 'distributor_name', label: 'Distributor Name' },
      { key: 'invoice_no', label: 'Invoice No.' },
      { key: 'date_formatted', label: 'Date' },
      { key: 'total_qty', label: 'Qty' },
      { key: 'total_amount_formatted', label: 'Amount' },
    ];

    const formattedData = items.map(t => ({
      ...t,
      id_formatted: `#${t.id.toString().padStart(6, '0')}`,
      date_formatted: formatDisplayDate(t.date, true),
      total_amount_formatted: `₹${(t.total_amount || 0).toFixed(2)}`,
    }));

    if (type === 'csv') {
      exportToCSV(formattedData, columns, 'purchase_history.csv');
    } else {
      exportToPDF(formattedData, columns, 'purchase_history.pdf', 'Purchase History Report');
    }
  };

  const getUnreconciledCount = () => {
    return reconciliationList.filter(o => o.status === 'Missing' && !o.is_saved).length;
  };

  return (
    <div className="h-full flex-1 flex flex-col pt-1 px-4 gap-3 pb-3 animate-in fade-in duration-300 min-h-0 select-none">
      {/* ── Top Bar: Segmented Tabs & Status ── */}
      <div className="flex items-center justify-between border-b border-glass-border/40 pb-2 shrink-0">
        <div className="flex items-center gap-1.5 p-1 bg-bg2/80 border border-glass-border rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'history'
                ? 'bg-primary text-white shadow-xs font-bold'
                : 'text-muted hover:text-text hover:bg-glass-bg'
            }`}
          >
            <Receipt size={14} />
            <span>Purchase History</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('reconciliation')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'reconciliation'
                ? 'bg-primary text-white shadow-xs font-bold'
                : 'text-muted hover:text-text hover:bg-glass-bg'
            }`}
          >
            <RefreshCw size={13} className={loadingRecon ? 'animate-spin' : ''} />
            <span>Reconcile Email Orders</span>
            {getUnreconciledCount() > 0 && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                  activeTab === 'reconciliation'
                    ? 'bg-red text-white'
                    : 'bg-red/10 text-red border border-red/20'
                }`}
              >
                {getUnreconciledCount()} Missing
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted">
          {isFetching && (
            <div className="flex items-center gap-1.5 text-primary text-xs font-medium">
              <Loader2 size={13} className="animate-spin" />
              <span>Syncing...</span>
            </div>
          )}
        </div>
      </div>

      {activeTab === 'history' ? (
        <div className="flex-1 flex flex-col min-h-0 gap-3">
          {/* ── Top 4 Balanced KPI Summary Cards (Identical h-[76px]) ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 shrink-0 h-[76px]">
            {/* Card 1: Total Invoices */}
            <div className="h-[76px] p-3.5 rounded-2xl border border-glass-border/70 bg-bg2 flex items-center justify-between shadow-xs transition-all hover:border-glass-border">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted truncate">
                  Total Invoices
                </span>
                <span className="text-xl font-bold font-mono text-text">
                  {totalPurchases.toLocaleString('en-IN')}
                </span>
              </div>
              <div className="w-9 h-9 rounded-xl border border-primary/20 bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Receipt size={18} />
              </div>
            </div>

            {/* Card 2: Total Purchase Value */}
            <div className="h-[76px] p-3.5 rounded-2xl border border-glass-border/70 bg-bg2 flex items-center justify-between shadow-xs transition-all hover:border-glass-border">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted truncate">
                  Total Value
                </span>
                <span className="text-xl font-bold font-mono text-primary">
                  ₹{totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="w-9 h-9 rounded-xl border border-primary/20 bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <IndianRupee size={18} />
              </div>
            </div>

            {/* Card 3: Total Settled / Paid */}
            <div className="h-[76px] p-3.5 rounded-2xl border border-glass-border/70 bg-bg2 flex items-center justify-between shadow-xs transition-all hover:border-glass-border">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted truncate">
                  Settled Amount
                </span>
                <span className="text-xl font-bold font-mono text-green">
                  ₹{paidAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="w-9 h-9 rounded-xl border border-green/20 bg-green/10 text-green flex items-center justify-center shrink-0">
                <CheckCircle size={18} />
              </div>
            </div>

            {/* Card 4: Average Bill Value */}
            <div className="h-[76px] p-3.5 rounded-2xl border border-glass-border/70 bg-bg2 flex items-center justify-between shadow-xs transition-all hover:border-glass-border">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted truncate">
                  Average Bill
                </span>
                <span className="text-xl font-bold font-mono text-purple-400">
                  ₹{avgInvoiceAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="w-9 h-9 rounded-xl border border-purple-500/20 bg-purple-500/10 text-purple-400 flex items-center justify-center shrink-0">
                <TrendingUp size={18} />
              </div>
            </div>
          </div>

          {/* ── Main Panel Container ── */}
          <div className="glass-panel flex-1 flex flex-col overflow-hidden rounded-2xl border border-glass-border shadow-sm min-h-0">
            {/* Search bar & Filter Toolbar */}
            <div className="px-4 py-2.5 border-b border-glass-border/40 bg-bg2/50 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
              {/* Left: Search input */}
              <div className="flex items-center gap-2 flex-1 min-w-[280px]">
                <div className="relative flex-1 max-w-md">
                  <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search invoice, distributor, or product..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setSearchQuery('');
                      }
                    }}
                    className="w-full pl-9 pr-9 py-2 bg-bg3/70 border border-glass-border/70 rounded-xl text-xs text-text placeholder:text-muted/50 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted hover:text-text hover:bg-glass-bg transition-colors cursor-pointer"
                      title="Clear search (Esc)"
                      aria-label="Clear search"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {searchQuery.trim().length >= 2 && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-xs text-primary font-medium shrink-0">
                    <span>Filtering: &ldquo;{searchQuery}&rdquo;</span>
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="ml-0.5 hover:text-text transition-colors cursor-pointer"
                      title="Clear filter"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>

              {/* Right: Date filter, Column filter toggle, Exports */}
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                {/* Date Range Picker Pill */}
                <div className="flex items-center gap-1.5 bg-bg3/70 border border-glass-border/70 rounded-xl px-2.5 py-1.5 text-xs text-text">
                  <Calendar size={13} className="text-muted shrink-0" />
                  <span className="text-muted text-[10px] uppercase font-bold tracking-wider">From:</span>
                  <input
                    type="date"
                    value={toDateInputValue(dateRangeHelper.dateRange.from)}
                    onChange={(e) => dateRangeHelper.handleFromChange(e.target.value)}
                    className="bg-transparent text-xs text-text focus:outline-none cursor-pointer"
                  />
                  <span className="text-muted text-[10px] uppercase font-bold tracking-wider ml-1">To:</span>
                  <input
                    type="date"
                    value={toDateInputValue(dateRangeHelper.dateRange.to)}
                    onChange={(e) => dateRangeHelper.handleToChange(e.target.value)}
                    className="bg-transparent text-xs text-text focus:outline-none cursor-pointer"
                  />
                  {(dateRangeHelper.dateRange.from || dateRangeHelper.dateRange.to) && (
                    <button
                      type="button"
                      onClick={() => {
                        dateRangeHelper.handleFromChange('');
                        dateRangeHelper.handleToChange('');
                        dateRangeHelper.clearFilters();
                      }}
                      className="text-[11px] text-red font-semibold hover:underline ml-1 cursor-pointer"
                      title="Clear Date Range"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Column Filter Toggle */}
                <button
                  type="button"
                  onClick={() => setShowColFilters(prev => !prev)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                    showColFilters || hasColumnFilters
                      ? 'bg-primary/10 border-primary/30 text-primary'
                      : 'bg-bg3/70 border-glass-border/70 text-muted hover:text-text hover:bg-glass-bg'
                  }`}
                  title="Toggle column-specific search filters"
                >
                  <Filter size={13} />
                  <span>Filters</span>
                  {activeFilterCount > 0 && (
                    <span className="w-4 h-4 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">
                      {activeFilterCount}
                    </span>
                  )}
                </button>

                {/* Export to CSV */}
                <button
                  type="button"
                  onClick={() => handleExport('csv')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border bg-bg3/70 border-glass-border/70 text-muted hover:text-text hover:bg-glass-bg text-xs font-semibold transition-all cursor-pointer"
                  title="Export visible purchase invoices to CSV"
                >
                  <FileSpreadsheet size={13} />
                  <span>CSV</span>
                </button>

                {/* Export to PDF */}
                <button
                  type="button"
                  onClick={() => handleExport('pdf')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border bg-bg3/70 border-glass-border/70 text-muted hover:text-text hover:bg-glass-bg text-xs font-semibold transition-all cursor-pointer"
                  title="Export visible purchase invoices to PDF"
                >
                  <FileText size={13} />
                  <span>PDF</span>
                </button>
              </div>
            </div>

            {/* Table Container */}
            <div className="flex-1 flex flex-col min-h-0 relative overflow-hidden bg-bg">
              {isFetching && items.length === 0 ? (
                <div className="p-12 text-center text-muted font-semibold flex flex-col items-center justify-center flex-1">
                  <div className="flex items-center gap-2.5 text-primary text-sm">
                    <Loader2 size={22} className="animate-spin" />
                    <span>Loading purchase history...</span>
                  </div>
                </div>
              ) : items.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-muted p-12">
                  <div className="w-14 h-14 rounded-2xl bg-bg3 border border-glass-border flex items-center justify-center mb-3 text-muted/60">
                    <Receipt size={28} />
                  </div>
                  <p className="text-base font-bold text-text">No purchase transactions found</p>
                  <p className="text-xs text-muted mt-1 max-w-sm text-center">
                    {searchQuery || hasColumnFilters || isDateFiltered
                      ? 'No bills match your current filters. Try resetting the filters or clearing the date range.'
                      : 'No purchase bills recorded yet.'}
                  </p>
                  {(searchQuery || hasColumnFilters || isDateFiltered) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        handleClearColumnFilters();
                        dateRangeHelper.handleFromChange('');
                        dateRangeHelper.handleToChange('');
                        dateRangeHelper.clearFilters();
                        try {
                          localStorage.removeItem('purchase-history-date-range');
                          localStorage.removeItem('purchase-history-date-range-v2');
                        } catch {}
                      }}
                      className="mt-4 px-3.5 py-1.5 rounded-xl bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 text-xs font-semibold transition-all cursor-pointer"
                    >
                      Clear All Filters (Show All Purchases)
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                  <InfiniteTable
                    totalSize={rowVirtualizer.getTotalSize()}
                    containerRef={parentRef}
                    className="border-0 bg-transparent text-sm"
                    header={
                      <>
                        {/* Header Labels */}
                        <tr className="flex items-center min-w-[1040px] bg-bg2/95 border-b border-glass-border/50 text-xs font-bold text-muted uppercase tracking-wider select-none py-2.5">
                          <th className="w-32 shrink-0 px-6 py-1 text-left">Purchase ID</th>
                          <th className="flex-1 min-w-[200px] px-6 py-1 text-left">Distributor Name</th>
                          <th className="w-40 shrink-0 px-6 py-1 text-left">Invoice No.</th>
                          <th className="w-48 shrink-0 px-6 py-1 text-left">Date</th>
                          <th className="w-28 shrink-0 text-right px-6 py-1">Qty</th>
                          <th className="w-44 shrink-0 text-right px-6 py-1">Amount</th>
                          <th className="w-36 shrink-0 text-center px-6 py-1">
                            <div className="flex items-center justify-center gap-1.5">
                              <span>Action</span>
                              {hasColumnFilters && (
                                <button
                                  type="button"
                                  onClick={handleClearColumnFilters}
                                  className="text-[10px] text-red hover:underline font-semibold cursor-pointer lowercase"
                                  title="Clear column filters"
                                >
                                  (reset)
                                </button>
                              )}
                            </div>
                          </th>
                        </tr>

                        {/* Collapsible Column Filters Row */}
                        {(showColFilters || hasColumnFilters) && (
                          <tr className="flex items-center min-w-[1040px] pb-2.5 pt-1 px-0 border-b border-glass-border/30 bg-bg3/30 select-none">
                            <th className="w-32 shrink-0 px-6 py-0 font-normal">
                              <input
                                type="text"
                                placeholder="ID..."
                                value={colFilterId}
                                onChange={(e) => setColFilterId(e.target.value)}
                                className="w-full px-2 py-1 bg-bg2 border border-glass-border/70 rounded-lg text-xs text-text placeholder:text-muted/40 font-normal focus:outline-none focus:border-primary/50"
                              />
                            </th>
                            <th className="flex-1 min-w-[200px] px-6 py-0 font-normal">
                              <input
                                type="text"
                                placeholder="Distributor..."
                                value={colFilterDistributor}
                                onChange={(e) => setColFilterDistributor(e.target.value)}
                                className="w-full px-2 py-1 bg-bg2 border border-glass-border/70 rounded-lg text-xs text-text placeholder:text-muted/40 font-normal focus:outline-none focus:border-primary/50"
                              />
                            </th>
                            <th className="w-40 shrink-0 px-6 py-0 font-normal">
                              <input
                                type="text"
                                placeholder="Invoice..."
                                value={colFilterInvoiceNo}
                                onChange={(e) => setColFilterInvoiceNo(e.target.value)}
                                className="w-full px-2 py-1 bg-bg2 border border-glass-border/70 rounded-lg text-xs text-text placeholder:text-muted/40 font-normal focus:outline-none focus:border-primary/50"
                              />
                            </th>
                            <th className="w-48 shrink-0 px-6 py-0 font-normal">
                              <input
                                type="date"
                                value={toDateInputValue(colFilterDate)}
                                onChange={(e) => setColFilterDate(e.target.value)}
                                className="w-full px-2 py-1 bg-bg2 border border-glass-border/70 rounded-lg text-xs text-text font-normal focus:outline-none focus:border-primary/50 cursor-pointer"
                              />
                            </th>
                            <th className="w-28 shrink-0 text-right px-6 py-0 font-normal" />
                            <th className="w-44 shrink-0 text-right px-6 py-0 font-normal">
                              <div className="flex gap-1 justify-end">
                                <input
                                  type="number"
                                  placeholder="Min"
                                  value={colFilterMinAmount}
                                  onChange={(e) => setColFilterMinAmount(e.target.value)}
                                  className="w-16 px-1.5 py-1 bg-bg2 border border-glass-border/70 rounded-lg text-xs text-text placeholder:text-muted/40 font-normal focus:outline-none focus:border-primary/50 text-right"
                                />
                                <input
                                  type="number"
                                  placeholder="Max"
                                  value={colFilterMaxAmount}
                                  onChange={(e) => setColFilterMaxAmount(e.target.value)}
                                  className="w-16 px-1.5 py-1 bg-bg2 border border-glass-border/70 rounded-lg text-xs text-text placeholder:text-muted/40 font-normal focus:outline-none focus:border-primary/50 text-right"
                                />
                              </div>
                            </th>
                            <th className="w-36 shrink-0 text-center px-6 py-0 font-normal">
                              {hasColumnFilters ? (
                                <button
                                  type="button"
                                  onClick={handleClearColumnFilters}
                                  className="px-2 py-1 rounded bg-red/10 text-red hover:bg-red/20 text-[11px] font-semibold border border-red/20 transition-all cursor-pointer"
                                >
                                  Clear
                                </button>
                              ) : (
                                <span className="text-[11px] text-muted/40">-</span>
                              )}
                            </th>
                          </tr>
                        )}
                      </>
                    }
                    body={
                      rowVirtualizer.getVirtualItems().map((virtualRow) => {
                        const tx = items[virtualRow.index];
                        if (!tx) return null;
                        return (
                          <VirtualRow
                            key={virtualRow.key}
                            ref={rowVirtualizer.measureElement}
                            start={virtualRow.start}
                            size={virtualRow.size}
                            className="min-w-[1040px] h-[56px] border-b border-glass-border/30 hover:bg-glass-bg/60 transition-colors items-center flex group"
                          >
                            <td className="w-32 shrink-0 px-6 py-3 text-muted font-mono text-xs flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-primary/40 group-hover:bg-primary transition-colors shrink-0" />
                              <span>#{tx.id.toString().padStart(6, '0')}</span>
                            </td>

                            <td className="flex-1 min-w-[200px] px-6 py-3 text-text font-medium truncate text-sm flex items-center gap-2" title={tx.distributor_name}>
                              <Building2 size={14} className="text-muted/60 shrink-0" />
                              <span className="truncate">{tx.distributor_name || '-'}</span>
                            </td>

                            <td className="w-40 shrink-0 px-6 py-3 text-text/80 font-mono text-xs truncate" title={tx.invoice_no}>
                              <span className="px-2 py-0.5 rounded-md bg-bg3 border border-glass-border/50">
                                {tx.invoice_no || '-'}
                              </span>
                            </td>

                            <td className="w-48 shrink-0 px-6 py-3 text-muted whitespace-nowrap text-xs flex items-center gap-1.5">
                              <Calendar size={13} className="text-muted/50 shrink-0" />
                              <span>{formatDisplayDate(tx.date, true)}</span>
                            </td>

                            <td className="w-28 shrink-0 text-right px-6 py-3 text-text/90 font-medium font-mono text-xs">
                              {tx.total_qty || 0}
                            </td>

                            <td className="w-44 shrink-0 text-right px-6 py-3 whitespace-nowrap">
                              {tx.cn_amount && tx.cn_amount > 0 ? (
                                <div className="flex flex-col items-end gap-0.5">
                                  <div className="flex items-center gap-1.5 justify-end">
                                    <span className="text-[11px] text-muted/60 line-through font-mono">
                                      ₹{(tx.original_amount || (tx.total_amount + tx.cn_amount)).toFixed(2)}
                                    </span>
                                    <span className="text-text font-semibold font-mono text-sm">
                                      ₹{tx.total_amount?.toFixed(2) || '0.00'}
                                    </span>
                                  </div>
                                  <span className="text-[10px] text-primary font-semibold px-1.5 py-0.2 rounded bg-primary/10 border border-primary/20">
                                    CN: -₹{tx.cn_amount.toFixed(2)}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-text font-semibold font-mono text-sm">
                                  ₹{tx.total_amount?.toFixed(2) || '0.00'}
                                </span>
                              )}
                            </td>

                            <td className="w-36 shrink-0 text-center px-6 py-3">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => openView(tx.id)}
                                  className="w-7 h-7 rounded-lg text-muted hover:text-primary hover:bg-primary/10 flex items-center justify-center transition-all cursor-pointer"
                                  title="View Invoice Details"
                                >
                                  <Eye size={15} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handlePrintBillBarcodes(tx.id, tx.items)}
                                  disabled={generatingBarcodeId === tx.id}
                                  className="w-7 h-7 rounded-lg text-muted hover:text-purple-400 hover:bg-purple-500/10 flex items-center justify-center transition-all cursor-pointer disabled:opacity-50"
                                  title="Print Product Barcodes"
                                >
                                  {generatingBarcodeId === tx.id ? (
                                    <RefreshCw size={14} className="animate-spin text-purple-400" />
                                  ) : (
                                    <QrCode size={15} />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEdit(tx.id)}
                                  className="w-7 h-7 rounded-lg text-muted hover:text-primary hover:bg-primary/10 flex items-center justify-center transition-all cursor-pointer"
                                  title="Edit Purchase"
                                >
                                  <Edit size={15} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeleteConfirmPurchase(tx)}
                                  className="w-7 h-7 rounded-lg text-muted hover:text-red hover:bg-red/10 flex items-center justify-center transition-all cursor-pointer"
                                  title="Delete Purchase"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </td>
                          </VirtualRow>
                        );
                      })
                    }
                  />
                  {!isDateFiltered && (
                    <InfiniteScrollStatus
                      totalItems={totalItems}
                      loadedCount={items.length}
                      isFetching={isFetching}
                      isFetchingNextPage={isFetchingNextPage}
                      hasNextPage={hasNextPage}
                      onLoadMore={fetchNextPage}
                      sentinelRef={sentinelRef}
                      itemName="purchase invoices"
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* ── Reconciliation Tab ── */
        <div className="flex-1 flex flex-col min-h-0 gap-3">
          <div className="flex justify-between items-center bg-bg2 border border-glass-border p-4 rounded-2xl shadow-xs shrink-0">
            <div>
              <h3 className="text-text font-bold text-sm flex items-center gap-2">
                <span>Distributor Email Receipt Reconciliation</span>
              </h3>
              <p className="text-xs text-muted mt-0.5">
                Automatically scans incoming email invoices to confirm inventory check-in status and prevent stock leakage.
              </p>
            </div>
            <button
              type="button"
              onClick={() => fetchReconciliation()}
              className="px-3.5 py-1.5 rounded-xl bg-bg3 hover:bg-glass-bg border border-glass-border text-text text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
            >
              <RefreshCw size={13} className={loadingRecon ? 'animate-spin' : ''} />
              <span>Reload List</span>
            </button>
          </div>

          <div className="glass-panel rounded-2xl border border-glass-border flex-1 flex flex-col min-h-0 overflow-hidden shadow-xs bg-bg">
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-10 bg-bg2/95 border-b border-glass-border">
                  <tr className="text-xs font-bold text-muted uppercase tracking-wider select-none">
                    <th className="px-6 py-3.5 whitespace-nowrap">Received Date</th>
                    <th className="px-6 py-3.5 whitespace-nowrap">Distributor / Sender</th>
                    <th className="px-6 py-3.5 whitespace-nowrap">Subject Line</th>
                    <th className="px-6 py-3.5 whitespace-nowrap">Extracted Invoice No.</th>
                    <th className="px-6 py-3.5 whitespace-nowrap">Medicines</th>
                    <th className="px-6 py-3.5 whitespace-nowrap text-center">Status</th>
                    <th className="px-6 py-3.5 whitespace-nowrap text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-glass-border/30 text-xs">
                  {loadingRecon ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-muted">
                        <div className="flex justify-center items-center gap-2 text-primary">
                          <Loader2 size={20} className="animate-spin" />
                          <span>Analyzing email receipts...</span>
                        </div>
                      </td>
                    </tr>
                  ) : reconciliationList.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-16 text-center text-muted">
                        <div className="flex flex-col items-center justify-center">
                          <div className="w-12 h-12 rounded-2xl bg-green/10 text-green border border-green/20 flex items-center justify-center mb-3">
                            <CheckCircle size={28} />
                          </div>
                          <p className="text-base font-bold text-text">All Clear & Reconciled</p>
                          <p className="text-xs text-muted mt-1 max-w-sm text-center">
                            No unreconciled or missing distributor orders detected from scanned email receipts.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    reconciliationList.map((recon, idx) => (
                      <tr
                        key={recon.email_uid || idx}
                        className={`hover:bg-glass-bg/60 transition-colors ${recon.is_saved ? 'opacity-60' : ''}`}
                      >
                        <td className="px-6 py-4 text-muted whitespace-nowrap font-mono text-xs">
                          {new Date(recon.date).toLocaleString()}
                        </td>

                        <td className="px-6 py-4 text-text font-medium text-xs">
                          {recon.extracted_distributor &&
                          recon.extracted_distributor.trim() &&
                          recon.extracted_distributor !== 'Unknown Dist.' &&
                          recon.extracted_distributor !== 'Unknown Distributor' &&
                          recon.extracted_distributor !== 'Default Distributor' ? (
                            recon.extracted_distributor
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/30">
                              <AlertCircle size={10} /> Unresolved Distributor
                            </span>
                          )}
                          <div className="text-[11px] text-muted font-normal mt-0.5 truncate max-w-[200px]">
                            {recon.from}
                          </div>
                        </td>

                        <td className="px-6 py-4 text-text/80 max-w-xs truncate text-xs">
                          {recon.subject}
                        </td>

                        <td className="px-6 py-4 font-mono text-text text-xs">
                          <span className="px-2 py-0.5 rounded bg-bg3 border border-glass-border/50">
                            {recon.extracted_invoice_no || 'N/A'}
                          </span>
                        </td>

                        <td className="px-6 py-4">
                          {recon.medicine_names && recon.medicine_names.length > 0 ? (
                            <div className="text-text/80 max-w-xs truncate text-xs" title={recon.medicine_names.join(', ')}>
                              {recon.medicine_names.slice(0, 3).join(', ')}
                              {recon.medicine_names.length > 3 && ` +${recon.medicine_names.length - 3} more`}
                            </div>
                          ) : (
                            <span className="text-muted text-xs italic">No medicines detected</span>
                          )}
                        </td>

                        <td className="px-6 py-4 text-center">
                          {recon.is_saved ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border text-green bg-green/10 border-green/20">
                              <CheckCircle size={10} className="mr-1" /> Reconciled
                            </span>
                          ) : recon.status === 'Matched' || !recon.medicine_names || recon.medicine_names.length === 0 ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border text-green bg-green/10 border-green/20">
                              <CheckCircle size={10} className="mr-1" /> Matched
                            </span>
                          ) : recon.status === 'Bounced' && recon.medicine_names && recon.medicine_names.length > 0 ? (
                            <span
                              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border text-yellow-500 bg-yellow-500/10 border-yellow-500/20"
                              title={recon.medicine_names.join(', ')}
                            >
                              <AlertCircle size={10} className="mr-1" /> Bounced ({recon.medicine_names.length})
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border text-amber-500 bg-amber-500/10 border-amber-500/20"
                              title="Invoice awaiting check-in"
                            >
                              <Clock size={10} className="mr-1" /> Pending Check-in
                            </span>
                          )}
                        </td>

                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setSelectedOrder(recon)}
                              className="w-7 h-7 rounded-lg text-muted hover:text-text bg-bg3 hover:bg-glass-bg border border-glass-border flex items-center justify-center transition-all cursor-pointer"
                              title="Investigate Order Metadata & Match Details"
                            >
                              <Eye size={14} />
                            </button>
                            {!recon.is_saved && (
                              <>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      await api.resolveOrderManually(recon.email_uid);
                                      toastEvent.trigger('Marked as reconciled', 'success');
                                      fetchReconciliation();
                                    } catch (_e) {
                                      toastEvent.trigger('Failed to update status', 'error');
                                    }
                                  }}
                                  className="w-7 h-7 rounded-lg text-green bg-green/10 hover:bg-green/20 border border-green/20 flex items-center justify-center transition-all cursor-pointer"
                                  title="Mark as Reconciled"
                                >
                                  <CheckCircle size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleReissue(recon.email_uid)}
                                  disabled={reissuingUid !== null}
                                  className="w-7 h-7 rounded-lg text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 flex items-center justify-center transition-all cursor-pointer disabled:opacity-50"
                                  title="Reprocess & Open in Purchases page"
                                >
                                  <RefreshCw size={13} className={reissuingUid === recon.email_uid ? 'animate-spin' : ''} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal (Native modal, zero blocking alert/confirm) ── */}
      {deleteConfirmPurchase && createPortal(
        <div
          className="fixed inset-0 bg-black/60 z-modal flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeleteConfirmPurchase(null);
          }}
        >
          <div
            className="glass-panel w-full max-w-md p-6 rounded-2xl shadow-xl border border-glass-border bg-bg2 flex flex-col gap-4 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 text-red">
              <div className="w-10 h-10 rounded-xl bg-red/10 border border-red/20 flex items-center justify-center shrink-0">
                <AlertCircle size={22} className="text-red" />
              </div>
              <div>
                <h3 className="text-base font-bold text-text">Delete Purchase Record</h3>
                <p className="text-xs text-muted">
                  Invoice: {deleteConfirmPurchase.invoice_no || `#${deleteConfirmPurchase.id}`}
                </p>
              </div>
            </div>

            <p className="text-xs text-text/80 leading-relaxed">
              Are you sure you want to delete this purchase from{' '}
              <strong>{deleteConfirmPurchase.distributor_name}</strong>?
              This will deduct and revert the received stock items in inventory.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmPurchase(null)}
                disabled={deletingPurchaseId !== null}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-muted hover:text-text bg-bg3 hover:bg-glass-bg border border-glass-border transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDeletePurchase(deleteConfirmPurchase)}
                disabled={deletingPurchaseId !== null}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-red hover:bg-red/90 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
              >
                {deletingPurchaseId !== null ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={13} />
                    <span>Confirm Delete</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Investigation Modal ── */}
      {selectedOrder && createPortal(
        <div
          className="fixed inset-0 bg-black/60 z-modal flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedOrder(null);
          }}
        >
          <div
            className="glass-panel w-[95vw] max-w-2xl h-[80vh] min-h-[500px] max-h-[760px] flex flex-col overflow-hidden rounded-2xl shadow-xl border border-glass-border bg-bg2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-glass-border flex justify-between items-start bg-bg2 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                  <AlertCircle size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-text">
                    Distributor Order Investigation
                  </h3>
                  <p className="text-xs text-muted mt-0.5">
                    Email UID: #{selectedOrder.email_uid} &middot; Received {new Date(selectedOrder.date).toLocaleString()}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="text-muted hover:text-text bg-bg3 hover:bg-glass-bg p-1.5 rounded-xl border border-glass-border transition-all cursor-pointer"
                title="Close (Esc)"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 flex-1 min-h-0 overflow-y-auto space-y-4 text-xs">
              {/* Raw Body Snippet */}
              {selectedOrder.body_snippet && (
                <div className="space-y-1.5">
                  <h4 className="text-[11px] font-bold text-muted uppercase tracking-wider">Raw Email Body Snippet</h4>
                  <div className="bg-bg3/80 p-3.5 rounded-xl border border-glass-border text-muted font-mono text-xs leading-relaxed max-h-28 overflow-y-auto">
                    {selectedOrder.body_snippet}...
                  </div>
                </div>
              )}

              {/* Medicines List */}
              <div className="space-y-1.5">
                <h4 className="text-[11px] font-bold text-muted uppercase tracking-wider">
                  {selectedOrder.status === 'Bounced' ? 'Bounced / Unmatched Medicines' : 'Medicines Detected in Order'}
                </h4>
                {selectedOrder.medicine_names && selectedOrder.medicine_names.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {selectedOrder.medicine_names.map((name: string, i: number) => (
                      <div
                        key={i}
                        className="bg-bg3/70 border border-glass-border p-2.5 rounded-xl flex justify-between items-center"
                      >
                        <span className="font-medium text-xs text-text">{name}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted italic bg-bg3/50 p-3 rounded-xl border border-glass-border">
                    All items successfully matched or no missing medicines identified.
                  </p>
                )}
              </div>

              {/* Matched Purchase Info */}
              {selectedOrder.matched_purchase && (
                <div className="bg-bg3/70 p-4 rounded-xl border border-glass-border space-y-1">
                  <h4 className="text-[11px] font-bold text-muted uppercase tracking-wider">Matched DB Purchase Record</h4>
                  <p className="text-text font-semibold text-xs">
                    Invoice: #{selectedOrder.matched_purchase.invoice_no || selectedOrder.matched_purchase.app_invoice_no} &middot; Total: ₹{selectedOrder.matched_purchase.total_amount}
                  </p>
                  <p className="text-[11px] text-muted">
                    Booked on: {new Date(selectedOrder.matched_purchase.date).toLocaleDateString()}
                  </p>
                </div>
              )}

              {/* Distributor Details */}
              <div className="bg-bg3/70 p-4 rounded-xl border border-glass-border space-y-1">
                <h4 className="text-[11px] font-bold text-muted uppercase tracking-wider">Distributor Information</h4>
                {selectedOrder.extracted_distributor &&
                selectedOrder.extracted_distributor.trim() &&
                selectedOrder.extracted_distributor !== 'Unknown Dist.' &&
                selectedOrder.extracted_distributor !== 'Unknown Distributor' &&
                selectedOrder.extracted_distributor !== 'Default Distributor' ? (
                  <p className="text-text font-semibold text-xs">{selectedOrder.extracted_distributor}</p>
                ) : (
                  <div className="flex items-center gap-1.5 text-amber-500 font-bold text-xs">
                    <AlertCircle size={13} />
                    <span>Unresolved Distributor — Please assign legitimate distributor before booking.</span>
                  </div>
                )}
                <p className="text-[11px] text-muted">Sender: {selectedOrder.from}</p>
              </div>

              {/* Reconciliation Status */}
              <div className="bg-bg3/70 p-4 rounded-xl border border-glass-border">
                <h4 className="text-[11px] font-bold text-muted uppercase tracking-wider mb-2">Reconciliation Status</h4>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                      selectedOrder.is_saved ||
                      selectedOrder.status === 'Matched' ||
                      !selectedOrder.medicine_names ||
                      selectedOrder.medicine_names.length === 0
                        ? 'bg-green/10 text-green border border-green/20'
                        : selectedOrder.status === 'Bounced'
                        ? 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20'
                        : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                    }`}
                  >
                    <CheckCircle size={13} />
                    {selectedOrder.is_saved
                      ? 'Reconciled & Saved'
                      : selectedOrder.status === 'Matched' ||
                        !selectedOrder.medicine_names ||
                        selectedOrder.medicine_names.length === 0
                      ? 'Matched Purchase'
                      : selectedOrder.status === 'Bounced'
                      ? 'Bounced Items Detected'
                      : 'Pending Check-in / Missing Bill'}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-glass-border bg-bg2 flex flex-wrap gap-2.5 justify-end shrink-0">
              {!selectedOrder.is_saved && (
                <>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await api.resolveOrderManually(selectedOrder.email_uid);
                        toastEvent.trigger('Marked as reconciled', 'success');
                        setSelectedOrder(null);
                        fetchReconciliation();
                      } catch (_e) {
                        toastEvent.trigger('Failed to update status', 'error');
                      }
                    }}
                    className="px-4 py-2 text-xs font-semibold rounded-xl bg-green/10 hover:bg-green/20 text-green border border-green/20 transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <CheckCircle size={14} />
                    <span>Link & Mark Reconciled</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReissue(selectedOrder.email_uid)}
                    disabled={reissuingUid !== null}
                    className="px-4 py-2 text-xs font-bold rounded-xl bg-primary hover:bg-primary/90 text-white shadow-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {reissuingUid === selectedOrder.email_uid ? 'Opening Purchases...' : 'Reprocess & Open in Purchases'}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-bg3 hover:bg-glass-bg text-muted hover:text-text border border-glass-border transition-all cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── View Purchase Modal ── */}
      {viewPurchase && createPortal(
        <div
          className="fixed inset-0 bg-black/60 z-modal flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeView();
          }}
        >
          <div
            className="glass-panel w-[95vw] max-w-4xl h-[85vh] min-h-[560px] max-h-[840px] flex flex-col overflow-hidden rounded-2xl shadow-xl border border-glass-border bg-bg2"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-5 border-b border-glass-border flex justify-between items-center bg-bg2 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                  <Eye size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-text flex items-center gap-2">
                    <span>Purchase Invoice: {viewPurchase.purchase.invoice_no || 'N/A'}</span>
                  </h3>
                  <p className="text-xs text-muted mt-0.5">
                    Distributor: {viewPurchase.purchase.distributor_name} &middot; Date: {formatDisplayDate(viewPurchase.purchase.date)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeView}
                className="text-muted hover:text-text bg-bg3 hover:bg-glass-bg p-1.5 rounded-xl border border-glass-border transition-all cursor-pointer"
                title="Close Preview (Esc)"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 flex-1 min-h-0 overflow-y-auto space-y-5">
              {/* Quick Info Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-bg3/60 p-4 rounded-xl border border-glass-border">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted block mb-1">
                    Invoice No.
                  </span>
                  <strong className="text-text text-sm font-mono">{viewPurchase.purchase.invoice_no || 'N/A'}</strong>
                </div>
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted block mb-1">
                    Date
                  </span>
                  <strong className="text-text text-sm">{formatDisplayDate(viewPurchase.purchase.date)}</strong>
                </div>
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted block mb-1">
                    Distributor
                  </span>
                  <strong className="text-text text-sm truncate block">{viewPurchase.purchase.distributor_name}</strong>
                </div>
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted block mb-1">
                    Total Amount
                  </span>
                  <strong className="text-green text-sm font-bold font-mono">
                    ₹{viewPurchase.purchase.total_amount?.toFixed(2) || '0.00'}
                  </strong>
                </div>
              </div>

              {/* Credit Note Banner */}
              {viewPurchase.purchase.cn_amount > 0 && (
                <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center text-primary font-bold text-lg font-mono">
                      CN
                    </div>
                    <div>
                      <span className="text-xs text-primary font-semibold block">Credit Note Applied</span>
                      <span className="text-xs text-muted font-mono">
                        No: {viewPurchase.purchase.cn_number || 'N/A'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <span className="text-xs text-muted block">Original Total</span>
                      <span className="text-sm text-muted font-medium line-through font-mono">
                        ₹{(viewPurchase.purchase.original_amount || (viewPurchase.purchase.total_amount + viewPurchase.purchase.cn_amount)).toFixed(2)}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-primary block">CN Discount</span>
                      <span className="text-sm text-primary font-semibold font-mono">
                        -₹{viewPurchase.purchase.cn_amount.toFixed(2)}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-muted block">Net Paid</span>
                      <span className="text-sm text-green font-bold font-mono">
                        ₹{viewPurchase.purchase.total_amount.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Purchase Bill QR & Barcode Section */}
              <div className="bg-bg3/60 p-4 rounded-xl border border-glass-border flex flex-col sm:flex-row items-center justify-between gap-3">
                {billBarcode ? (
                  <>
                    <div className="flex items-center gap-4">
                      <img
                        src={billBarcode.qrDataUrl}
                        alt="Bill QR"
                        className="w-16 h-16 rounded-lg bg-bg p-1 shrink-0 shadow-xs"
                      />
                      <div>
                        <div className="text-xs font-bold text-muted uppercase tracking-wider mb-1 flex items-center gap-1.5">
                          <QrCode size={14} /> <span>Purchase Bill Barcode (Code128 + QR)</span>
                        </div>
                        <img
                          src={billBarcode.code128DataUrl}
                          alt="Bill Code128"
                          className="h-9 bg-bg p-1 rounded max-w-[220px]"
                        />
                        <div className="text-[11px] font-mono text-muted mt-1">{billBarcode.barcodeText}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => window.open(billBarcode.pdfUrl, '_blank')}
                      className="px-3.5 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border border-primary/30 shrink-0 cursor-pointer"
                      title="Print the scannable QR + barcode label for this purchase bill"
                    >
                      <Printer size={15} /> <span>Print Bill Label</span>
                    </button>
                  </>
                ) : loadingBillBarcode ? (
                  <span className="text-xs text-muted py-2 flex items-center gap-2">
                    <RefreshCw size={13} className="animate-spin text-primary" /> Loading bill barcode...
                  </span>
                ) : (
                  <span className="text-xs text-muted py-2">Bill barcode preview not available</span>
                )}
              </div>

              {/* Items Table */}
              <div>
                <h4 className="text-sm font-bold text-text mb-2.5 flex items-center gap-2">
                  <Package size={16} className="text-primary" />
                  <span>Invoice Items ({viewPurchase.items?.length || 0})</span>
                </h4>
                <div className="border border-glass-border rounded-xl overflow-hidden bg-bg">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-bg3 text-muted border-b border-glass-border uppercase font-semibold">
                      <tr>
                        <th className="px-4 py-2.5">Medicine</th>
                        <th className="px-4 py-2.5">Batch</th>
                        <th className="px-4 py-2.5">Expiry</th>
                        <th className="px-4 py-2.5 text-right">Qty</th>
                        <th className="px-4 py-2.5 text-right">Free</th>
                        <th className="px-4 py-2.5 text-right">Rate</th>
                        <th className="px-4 py-2.5 text-right">MRP</th>
                        <th className="px-4 py-2.5 text-center">Barcode</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-glass-border/30">
                      {viewPurchase.items && viewPurchase.items.map((item: LocalPurchaseItem, i: number) => (
                        <tr key={i} className="hover:bg-glass-bg/60 transition-colors">
                          <td className="px-4 py-3 text-text font-medium">{item.medicine_name}</td>
                          <td className="px-4 py-3 text-muted font-mono">{item.batch_no || '-'}</td>
                          <td className="px-4 py-3 text-muted">{item.expiry_date || '-'}</td>
                          <td className="px-4 py-3 text-right text-text font-mono">{item.quantity}</td>
                          <td className="px-4 py-3 text-right text-muted font-mono">{item.free_qty || 0}</td>
                          <td className="px-4 py-3 text-right text-text font-mono">₹{(Number(item.cost_price) || 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-right text-muted font-mono">₹{(Number(item.mrp) || 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-center">
                            <button
                              type="button"
                              onClick={() => handlePrintSingleProductBarcode(item, i)}
                              disabled={generatingItemIndex === i}
                              className="text-purple-400 hover:text-purple-300 p-1.5 transition-colors cursor-pointer disabled:opacity-50 hover:bg-purple-500/10 rounded-lg inline-flex items-center justify-center"
                              title="Print Barcode sticker for this specific product"
                            >
                              {generatingItemIndex === i ? (
                                <RefreshCw size={15} className="animate-spin" />
                              ) : (
                                <QrCode size={15} />
                              )}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-glass-border bg-bg2 flex justify-end gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => handlePrintBillBarcodes(viewPurchase.purchase.id, viewPurchase.items)}
                disabled={generatingBarcodeId === viewPurchase.purchase.id}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-purple-600/15 hover:bg-purple-600/25 text-purple-400 border border-purple-500/30 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                title="Generate and print barcodes for all products in this bill"
              >
                {generatingBarcodeId === viewPurchase.purchase.id ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <QrCode size={14} />
                )}
                <span>Print All Barcodes</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const idToEdit = viewPurchase.purchase.id;
                  closeView();
                  openEdit(idToEdit);
                }}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <Edit size={14} />
                <span>Edit Purchase</span>
              </button>
              <button
                type="button"
                onClick={closeView}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-bg3 hover:bg-glass-bg text-muted hover:text-text border border-glass-border transition-all cursor-pointer"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default PurchaseHistory;
