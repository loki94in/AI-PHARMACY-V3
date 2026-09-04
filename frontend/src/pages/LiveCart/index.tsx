import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ShoppingCart,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ArrowRightLeft,
  Minus,
  Plus,
  ChevronDown,
  ChevronUp,
  Clock,
  CreditCard,
  User,
  Phone,
  Package,
  AlertTriangle,
  CheckCheck,
  Layers,
  Search,
  ExternalLink,
  X
} from 'lucide-react';
import { apiClient } from '../../services/api';
import { useStore } from '../../context/StoreContext';
import { toastEvent } from '../../services/events';

// Module-level cache for instant re-hydration
let cachedLiveOrders: any[] = [];

// Item status type
type ItemStatus = 'PENDING' | 'CONFIRMED' | 'REPLACED' | 'UNAVAILABLE' | 'QTY_ADJUSTED';

export default function LiveCart() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { activeStoreId } = useStore();

  const [orders, setOrders] = useState<any[]>(() => cachedLiveOrders);
  const [loading, setLoading] = useState(() => cachedLiveOrders.length === 0);
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());
  const [updatingItem, setUpdatingItem] = useState<number | null>(null);
  const [finalizingOrder, setFinalizingOrder] = useState<number | null>(null);
  const [cancellingOrder, setCancellingOrder] = useState<number | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<number | null>(null);

  // Per-item editing state
  const [itemEdits, setItemEdits] = useState<Record<number, {
    selectedBatchId?: number;
    confirmedQty?: number;
    replaceMedicineQuery?: string;
    replaceMedicineResults?: any[];
    replaceMedicineId?: number;
    replaceMedicineName?: string;
    reason?: string;
    showBatchPicker?: boolean;
    showReplacePicker?: boolean;
  }>>({});

  const fetchOrders = useCallback(async (silent = false) => {
    if (!silent && cachedLiveOrders.length === 0) setLoading(true);
    try {
      const data = await apiClient.get('/website/live-cart', {
        params: { store_id: activeStoreId }
      }).then(r => r.data);
      cachedLiveOrders = data.orders || [];
      setOrders(cachedLiveOrders);

      // Auto-expand order from URL param
      const focusId = parseInt(searchParams.get('order') || '0', 10);
      if (focusId) setExpandedOrders(prev => new Set([...prev, focusId]));
    } catch {
      if (!silent) setLoading(false);
    } finally {
      setLoading(false);
    }
  }, [activeStoreId, searchParams]);

  useEffect(() => {
    fetchOrders();
    const onInvalidate = () => fetchOrders(true);
    window.addEventListener('cache-invalidate', onInvalidate);
    return () => window.removeEventListener('cache-invalidate', onInvalidate);
  }, [fetchOrders]);

  const toggleExpand = (orderId: number) => {
    setExpandedOrders(prev => {
      const next = new Set(prev);
      next.has(orderId) ? next.delete(orderId) : next.add(orderId);
      return next;
    });
  };

  const setItemEdit = (itemId: number, patch: Partial<typeof itemEdits[number]>) => {
    setItemEdits(prev => ({ ...prev, [itemId]: { ...(prev[itemId] || {}), ...patch } }));
  };

  // Search for replacement medicine
  const searchReplacementMedicine = async (itemId: number, query: string) => {
    setItemEdit(itemId, { replaceMedicineQuery: query });
    if (query.length < 2) { setItemEdit(itemId, { replaceMedicineResults: [] }); return; }
    try {
      const res = await apiClient.get('/website/medicines/search', {
        params: { query, store_id: activeStoreId, limit: 10 }
      });
      setItemEdit(itemId, { replaceMedicineResults: res.data.medicines || [] });
    } catch {
      setItemEdit(itemId, { replaceMedicineResults: [] });
    }
  };

  // Confirm/update a single item
  const updateItem = async (item: any, status: ItemStatus) => {
    const edit = itemEdits[item.id] || {};
    setUpdatingItem(item.id);
    try {
      const payload: any = { item_status: status, changed_by: 'Pharmacist' };
      if (edit.selectedBatchId) payload.actual_batch_id = edit.selectedBatchId;
      if (edit.replaceMedicineId) payload.actual_medicine_id = edit.replaceMedicineId;
      if (edit.confirmedQty !== undefined) payload.confirmed_qty = edit.confirmedQty;
      if (edit.reason) payload.replacement_reason = edit.reason;

      await apiClient.patch(`/website/live-cart/items/${item.id}`, payload);
      toastEvent.trigger(
        status === 'UNAVAILABLE' ? `Item marked unavailable` :
        status === 'REPLACED' ? `Product replaced successfully` :
        `Item confirmed`,
        'success'
      );
      fetchOrders(true);
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || 'Failed to update item', 'error');
    } finally {
      setUpdatingItem(null);
    }
  };

  // Finalize order → push to POS held bill
  const finalizeOrder = async (orderId: number) => {
    setFinalizingOrder(orderId);
    try {
      await apiClient.post(`/website/live-cart/orders/${orderId}/finalize`, { finalized_by: 'Pharmacist' });
      toastEvent.trigger(`Order #${orderId} finalized — held bill pushed to POS!`, 'success');
      fetchOrders(true);
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || 'Finalization failed', 'error');
    } finally {
      setFinalizingOrder(null);
    }
  };

  // Cancel order
  const cancelOrder = async (orderId: number) => {
    setCancellingOrder(orderId);
    setConfirmCancelId(null);
    try {
      const res = await apiClient.post(`/website/live-cart/orders/${orderId}/cancel`, { cancelled_by: 'Pharmacist' });
      const msg = res.data.refund_required
        ? `Order #${orderId} cancelled. REFUND REQUIRED.`
        : `Order #${orderId} cancelled.`;
      toastEvent.trigger(msg, res.data.refund_required ? 'info' : 'success');
      fetchOrders(true);
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || 'Cancel failed', 'error');
    } finally {
      setCancellingOrder(null);
    }
  };

  const openOrderInPOS = (order: any) => {
    navigate('/pos', {
      state: {
        prefill: {
          onlineOrderId: order.id,
          orderId: order.id,
          patientName: order.requester || '',
          patientPhone: order.phone || '',
          customerName: order.requester || '',
          customerPhone: order.phone || '',
          customerId: order.customer_id || undefined,
          notes: `Website Order #${order.id}`,
          medicines: (order.items || []).map((it: any) => ({
            medicine_id: it.medicine_id || it.actual_medicine_id,
            medicineName: it.actual_medicine_name || it.medicine_name || it.product_name,
            name: it.actual_medicine_name || it.medicine_name || it.product_name,
            quantity: it.confirmed_qty ?? it.requested_qty ?? 1,
            qty: it.confirmed_qty ?? it.requested_qty ?? 1,
            sell_price: it.confirmed_price ?? it.mrp ?? 0,
            mrp: it.confirmed_price ?? it.mrp ?? 0,
            batch_no: it.actual_batch_no || it.batch_no || '',
            inventory_id: it.inventory_id
          }))
        }
      }
    });
  };

  const getItemStatusColor = (status: string) => {
    if (status === 'CONFIRMED') return 'text-green-600 bg-green-50 border-green-200';
    if (status === 'REPLACED') return 'text-sky-600 bg-sky-50 border-sky-200';
    if (status === 'UNAVAILABLE') return 'text-red-500 bg-red-50 border-red-200';
    if (status === 'QTY_ADJUSTED') return 'text-amber-600 bg-amber-50 border-amber-200';
    return 'text-muted bg-bg2 border-border';
  };

  const allItemsResolved = (order: any) =>
    (order.items || []).every((i: any) => i.item_status !== 'PENDING');

  const confirmedCount = (order: any) =>
    (order.items || []).filter((i: any) => i.item_status !== 'PENDING' && i.item_status !== 'UNAVAILABLE').length;

  const pendingCount = (order: any) =>
    (order.items || []).filter((i: any) => i.item_status === 'PENDING').length;

  const formatDt = (dt: string | null) => {
    if (!dt) return '—';
    try {
      return new Date(dt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch { return dt; }
  };

  return (
    <div className="flex flex-col h-full text-text p-4 space-y-4 overflow-y-auto">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-bg border border-border rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-primary/10 text-primary border border-primary/20">
            <ShoppingCart size={22} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-text">Pharmacy Live Cart</h1>
            <p className="text-xs text-muted">Paid orders awaiting pharmacy verification</p>
          </div>
          {orders.length > 0 && (
            <span className="ml-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-primary text-white">
              {orders.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/website-orders')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border text-muted text-xs hover:bg-bg2 transition-colors"
          >
            <ExternalLink size={13} />
            All Orders
          </button>
          <button
            onClick={() => fetchOrders()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border text-muted text-xs hover:bg-bg2 transition-colors"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Empty State */}
      {!loading && orders.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <div className="p-4 rounded-full bg-green-50 border border-green-100">
            <CheckCheck size={32} className="text-green-500" />
          </div>
          <p className="text-text font-semibold">No orders awaiting verification</p>
          <p className="text-xs text-muted max-w-xs">
            Paid online orders will appear here for pharmacy physical verification before POS sale.
          </p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex flex-col gap-3">
          {[1, 2].map(i => (
            <div key={i} className="bg-bg border border-border rounded-2xl p-4 animate-pulse">
              <div className="h-4 bg-bg3 rounded w-1/3 mb-2" />
              <div className="h-3 bg-bg3 rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* Order Cards */}
      {!loading && orders.map(order => {
        const expanded = expandedOrders.has(order.id);
        const resolved = allItemsResolved(order);
        const pending = pendingCount(order);
        const confirmed = confirmedCount(order);

        return (
          <div key={order.id} className="bg-bg border border-border rounded-2xl shadow-sm overflow-hidden">

            {/* Order Header */}
            <button
              onClick={() => toggleExpand(order.id)}
              className="w-full flex items-center justify-between gap-3 p-4 hover:bg-bg2 transition-colors text-left"
            >
              <div className="flex items-center gap-3 flex-wrap">
                {/* Order ID */}
                <span className="text-xs font-mono font-bold text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-lg">
                  #{order.id}
                </span>

                {/* Customer */}
                <div className="flex items-center gap-1.5 text-sm font-semibold text-text">
                  <User size={14} className="text-muted" />
                  {order.requester || 'Unknown'}
                </div>
                {order.phone && (
                  <div className="flex items-center gap-1 text-xs text-muted">
                    <Phone size={11} />
                    {order.phone}
                  </div>
                )}

                {/* Payment confirmed badge */}
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                  <CreditCard size={10} />
                  Payment Confirmed
                </span>

                {/* Delivery ETA badge */}
                {(order.estimated_delivery_start || order.delivery_window_formatted) && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
                    <Clock size={10} />
                    <span>ETA: {order.delivery_window_formatted || (order.estimated_delivery_start ? new Date(order.estimated_delivery_start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }) : 'Scheduled')}</span>
                  </span>
                )}

                {/* Item resolution status */}
                {pending > 0 ? (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-amber-600 bg-amber-50 border border-amber-200">
                    <Clock size={10} />
                    {pending} pending
                  </span>
                ) : (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-green-600 bg-green-50 border border-green-200">
                    <CheckCircle2 size={10} />
                    All reviewed ({confirmed} confirmed)
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-muted hidden sm:block">
                  {formatDt(order.payment_confirmed_at)}
                </span>
                {expanded ? <ChevronUp size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
              </div>
            </button>

            {/* Expanded: Items */}
            {expanded && (
              <div className="border-t border-border">
                <div className="p-4 space-y-3">
                  {(order.items || []).map((item: any) => {
                    const edit = itemEdits[item.id] || {};
                    const statusColor = getItemStatusColor(item.item_status);
                    const isUpdating = updatingItem === item.id;

                    return (
                      <div key={item.id} className="bg-bg2 border border-border rounded-xl p-3 space-y-3">
                        {/* Item row */}
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Package size={13} className="text-muted shrink-0" />
                              <span className="text-sm font-semibold text-text truncate">
                                {item.medicine_name || item.product_name}
                              </span>
                              {item.actual_medicine_name && item.actual_medicine_name !== item.medicine_name && (
                                <span className="text-xs text-sky-600 bg-sky-50 px-2 py-0.5 rounded-full border border-sky-200">
                                  → {item.actual_medicine_name}
                                </span>
                              )}
                              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor}`}>
                                {item.item_status}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted">
                              <span>Requested: <strong>{item.requested_qty}</strong></span>
                              {item.confirmed_qty !== null && item.confirmed_qty !== undefined && (
                                <span>Confirmed: <strong>{item.confirmed_qty}</strong></span>
                              )}
                              {item.mrp > 0 && <span>MRP: ₹{item.mrp}</span>}
                              {item.actual_batch_no && <span>Batch: {item.actual_batch_no}</span>}
                              {item.actual_expiry && <span>Exp: {item.actual_expiry}</span>}
                            </div>
                          </div>
                        </div>

                        {/* Action panel — only show if PENDING */}
                        {item.item_status === 'PENDING' && (
                          <div className="space-y-2">
                            {/* Qty control */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-muted w-20 shrink-0">Confirm Qty:</span>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => setItemEdit(item.id, { confirmedQty: Math.max(1, (edit.confirmedQty ?? item.requested_qty) - 1) })}
                                  className="w-6 h-6 rounded-lg bg-bg border border-border flex items-center justify-center text-text hover:bg-bg3"
                                >
                                  <Minus size={11} />
                                </button>
                                <span className="text-sm font-bold text-text w-8 text-center">
                                  {edit.confirmedQty ?? item.requested_qty}
                                </span>
                                <button
                                  onClick={() => setItemEdit(item.id, { confirmedQty: (edit.confirmedQty ?? item.requested_qty) + 1 })}
                                  className="w-6 h-6 rounded-lg bg-bg border border-border flex items-center justify-center text-text hover:bg-bg3"
                                >
                                  <Plus size={11} />
                                </button>
                              </div>
                            </div>

                            {/* Batch picker */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-muted w-20 shrink-0">Select Batch:</span>
                              <button
                                onClick={() => setItemEdit(item.id, { showBatchPicker: !edit.showBatchPicker })}
                                className="text-xs px-2.5 py-1 rounded-lg border border-border bg-bg hover:bg-bg3 text-text flex items-center gap-1"
                              >
                                <Layers size={11} />
                                {edit.selectedBatchId
                                  ? (item.available_batches?.find((b: any) => b.id === edit.selectedBatchId)?.batch_no || 'Batch selected')
                                  : 'Choose batch'}
                              </button>
                            </div>

                            {edit.showBatchPicker && (item.available_batches || []).length > 0 && (
                              <div className="rounded-xl border border-border bg-bg overflow-hidden">
                                <div className="grid grid-cols-4 text-xs font-semibold text-muted bg-bg3 px-3 py-1.5 border-b border-border">
                                  <span>Batch</span><span>Expiry</span><span>MRP</span><span>Avail</span>
                                </div>
                                {item.available_batches.map((batch: any) => (
                                  <button
                                    key={batch.id}
                                    onClick={() => setItemEdit(item.id, { selectedBatchId: batch.id, showBatchPicker: false })}
                                    className={`w-full grid grid-cols-4 text-xs px-3 py-2 text-left hover:bg-bg2 transition-colors border-b border-border last:border-0 ${edit.selectedBatchId === batch.id ? 'bg-primary/5' : ''}`}
                                  >
                                    <span className="font-mono text-text">{batch.batch_no || '—'}</span>
                                    <span className="text-muted">{batch.expiry_date || '—'}</span>
                                    <span className="text-text">₹{batch.mrp || 0}</span>
                                    <span className={batch.available_qty > 0 ? 'text-green-600' : 'text-red-500'}>
                                      {batch.available_qty ?? 0}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}

                            {(item.available_batches || []).length === 0 && (
                              <p className="text-xs text-amber-600 flex items-center gap-1">
                                <AlertTriangle size={11} /> No stock found for this product
                              </p>
                            )}

                            {/* Replace product */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-muted w-20 shrink-0">Replace with:</span>
                              <button
                                onClick={() => setItemEdit(item.id, { showReplacePicker: !edit.showReplacePicker })}
                                className="text-xs px-2.5 py-1 rounded-lg border border-border bg-bg hover:bg-bg3 text-sky-600 flex items-center gap-1"
                              >
                                <ArrowRightLeft size={11} />
                                {edit.replaceMedicineName || 'Find alternative'}
                              </button>
                            </div>

                            {edit.showReplacePicker && (
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-1.5 bg-bg border border-border rounded-xl px-2.5 py-1.5">
                                  <Search size={12} className="text-muted shrink-0" />
                                  <input
                                    value={edit.replaceMedicineQuery || ''}
                                    onChange={e => searchReplacementMedicine(item.id, e.target.value)}
                                    placeholder="Search medicine…"
                                    className="flex-1 text-xs bg-transparent outline-none text-text placeholder:text-muted"
                                  />
                                </div>
                                {(edit.replaceMedicineResults || []).length > 0 && (
                                  <div className="rounded-xl border border-border bg-bg overflow-hidden max-h-40 overflow-y-auto">
                                    {(edit.replaceMedicineResults || []).map((med: any) => (
                                      <button
                                        key={med.id}
                                        onClick={() => setItemEdit(item.id, {
                                          replaceMedicineId: med.id,
                                          replaceMedicineName: med.name,
                                          showReplacePicker: false,
                                          replaceMedicineResults: []
                                        })}
                                        className="w-full flex flex-col px-3 py-2 text-left hover:bg-bg2 border-b border-border last:border-0 text-xs"
                                      >
                                        <span className="font-semibold text-text">{med.name}</span>
                                        <span className="text-muted">{med.manufacturer} · MRP ₹{med.mrp}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Reason field (shown when replacing) */}
                            {(edit.replaceMedicineId || edit.showReplacePicker) && (
                              <input
                                value={edit.reason || ''}
                                onChange={e => setItemEdit(item.id, { reason: e.target.value })}
                                placeholder="Reason for replacement (optional)"
                                className="w-full text-xs bg-bg border border-border rounded-lg px-2.5 py-1.5 text-text placeholder:text-muted outline-none focus:border-primary"
                              />
                            )}

                            {/* Action buttons */}
                            <div className="flex items-center gap-2 flex-wrap pt-1">
                              <button
                                onClick={() => updateItem(item, edit.replaceMedicineId ? 'REPLACED' : (edit.confirmedQty !== undefined && edit.confirmedQty !== item.requested_qty) ? 'QTY_ADJUSTED' : 'CONFIRMED')}
                                disabled={isUpdating || (!edit.selectedBatchId && (item.available_batches || []).length > 0)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
                              >
                                <CheckCircle2 size={12} />
                                {isUpdating ? 'Saving…' : edit.replaceMedicineId ? 'Confirm Replacement' : 'Confirm Item'}
                              </button>
                              <button
                                onClick={() => updateItem(item, 'UNAVAILABLE')}
                                disabled={isUpdating}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-200 text-red-600 text-xs font-semibold hover:bg-red-50 transition-colors disabled:opacity-50"
                              >
                                <XCircle size={12} />
                                Unavailable
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Resolved item — show summary */}
                        {item.item_status !== 'PENDING' && item.replacement_reason && (
                          <p className="text-xs text-muted italic">Reason: {item.replacement_reason}</p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Order Footer Actions */}
                <div className="flex items-center justify-between gap-3 px-4 py-3 bg-bg3 border-t border-border">
                  <div className="text-xs text-muted">
                    {pending > 0 ? (
                      <span className="flex items-center gap-1 text-amber-600">
                        <AlertTriangle size={11} />
                        {pending} item{pending > 1 ? 's' : ''} still need review
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-green-600">
                        <CheckCircle2 size={11} />
                        All items reviewed — ready to finalize
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {confirmCancelId === order.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => cancelOrder(order.id)}
                          disabled={cancellingOrder === order.id}
                          className="px-2.5 py-1.5 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-700 transition-colors disabled:opacity-50"
                        >
                          {cancellingOrder === order.id ? 'Cancelling…' : 'Yes, Cancel'}
                        </button>
                        <button
                          onClick={() => setConfirmCancelId(null)}
                          className="px-2 py-1.5 rounded-xl border border-border text-muted text-xs hover:bg-bg2 transition-colors"
                        >
                          Keep
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmCancelId(order.id)}
                        disabled={cancellingOrder === order.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-200 text-red-600 text-xs font-semibold hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        <X size={12} />
                        <span>Cancel Order</span>
                      </button>
                    )}
                    <button
                      onClick={() => openOrderInPOS(order)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-primary/30 text-primary text-xs font-semibold hover:bg-primary/5 transition-colors"
                      title="Load order items into POS for immediate billing"
                    >
                      <ShoppingCart size={12} />
                      <span>Bill in POS</span>
                    </button>
                    <button
                      onClick={() => finalizeOrder(order.id)}
                      disabled={!resolved || finalizingOrder === order.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      <CheckCheck size={12} />
                      {finalizingOrder === order.id ? 'Finalizing…' : 'Finalize → Send to POS'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
