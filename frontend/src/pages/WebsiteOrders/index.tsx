import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Globe,
  ShoppingBag,
  Clock,
  CheckCircle2,
  Truck,
  RotateCcw,
  Search,
  RefreshCw,
  Eye,
  FileText,
  MessageSquare,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  ShieldAlert,
  ArrowRight,
  Check,
  X,
  Store as StoreIcon,
  Calendar,
  User,
  Phone,
  MapPin,
  FileImage,
  Sparkles
} from 'lucide-react';
import { api, apiClient } from '../../services/api';
import { useStore } from '../../context/StoreContext';
import { toastEvent } from '../../services/events';

// Module-level state cache for instant SPA re-hydration
let cachedOrders: any[] = [];

export default function WebsiteOrders() {
  const navigate = useNavigate();
  const { activeStore, activeStoreId } = useStore();

  const [orders, setOrders] = useState<any[]>(() => cachedOrders);
  const [loading, setLoading] = useState(() => cachedOrders.length === 0);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'ready' | 'delivered' | 'returns'>('all');
  const [selectedPrescription, setSelectedPrescription] = useState<string | null>(null);
  const [overrideModalOrder, setOverrideModalOrder] = useState<any | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideUser, setOverrideUser] = useState('Pharmacist Admin');
  const [submittingOverride, setSubmittingOverride] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<number | null>(null);

  // Fetch website orders
  const fetchOrders = useCallback(async (silent = false) => {
    if (!silent && cachedOrders.length === 0) setLoading(true);
    try {
      const data: any[] = await apiClient.get('/orders', {
        params: { store_id: activeStoreId }
      }).then(res => res.data);

      // Filter for website orders or items with prescription/website origin
      const websiteOnly = (data || []).filter(
        o => o.customer_order_source === 'website' || o.source === 'website' || o.prescription_url
      );

      cachedOrders = websiteOnly;
      setOrders(websiteOnly);
    } catch (err) {
      console.warn('[WebsiteOrders] Failed to load orders:', err);
    } finally {
      setLoading(false);
    }
  }, [activeStoreId]);

  useEffect(() => {
    fetchOrders();
    const handleInvalidate = () => fetchOrders(true);
    window.addEventListener('cache-invalidate', handleInvalidate);
    return () => window.removeEventListener('cache-invalidate', handleInvalidate);
  }, [fetchOrders]);

  // Status Actions
  const handleMarkReady = async (orderId: number) => {
    try {
      setActionInProgress(orderId);
      await apiClient.put(`/orders/${orderId}/status`, { status: 'Ready' });
      toastEvent.trigger(`Order #${orderId} marked Ready for Delivery`, 'success');
      fetchOrders(true);
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || 'Failed to update status', 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleMarkDelivered = async (orderId: number) => {
    try {
      setActionInProgress(orderId);
      await api.markOrderDelivered(orderId);
      toastEvent.trigger(`Order #${orderId} marked Delivered. 14-day return window started!`, 'success');
      fetchOrders(true);
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || 'Failed to mark delivered', 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleOpenInPOS = (order: any) => {
    navigate('/pos', {
      state: {
        prefill: {
          customerName: order.requester || '',
          customerPhone: order.phone || '',
          notes: `Website Order #${order.id}`,
          items: [
            {
              medicine_name: order.medicine_name || order.product,
              quantity: order.qty || 1,
              rate: order.pharmarack_rate || order.advance_payment || 0
            }
          ]
        }
      }
    });
  };

  const handleApplyOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideModalOrder) return;
    if (!overrideReason.trim()) {
      toastEvent.trigger('Please provide an authorization reason', 'error');
      return;
    }
    try {
      setSubmittingOverride(true);
      await api.applyReturnOverride(overrideModalOrder.id, {
        override_by: overrideUser,
        reason: overrideReason.trim()
      });
      toastEvent.trigger(`Return override approved for Order #${overrideModalOrder.id}`, 'success');
      setOverrideModalOrder(null);
      setOverrideReason('');
      fetchOrders(true);
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || 'Override failed', 'error');
    } finally {
      setSubmittingOverride(false);
    }
  };

  // KPI Calculations
  const metrics = useMemo(() => {
    const total = orders.length;
    const pending = orders.filter(o => o.status === 'Pending' || o.delivery_status === 'pending').length;
    const ready = orders.filter(o => o.status === 'Ready' || o.delivery_status === 'dispatched').length;
    const delivered = orders.filter(o => o.delivery_status === 'delivered').length;
    const returns = orders.filter(o => o.return_status === 'requested' || o.return_status === 'eligible' || o.return_override_by).length;

    return { total, pending, ready, delivered, returns };
  }, [orders]);

  // Filtered list
  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      // Search matching
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch = !query ||
        String(order.id).includes(query) ||
        (order.requester && order.requester.toLowerCase().includes(query)) ||
        (order.phone && order.phone.includes(query)) ||
        (order.medicine_name && order.medicine_name.toLowerCase().includes(query)) ||
        (order.product && order.product.toLowerCase().includes(query));

      if (!matchesSearch) return false;

      // Status matching
      if (statusFilter === 'pending') return order.status === 'Pending' && order.delivery_status !== 'delivered';
      if (statusFilter === 'ready') return order.status === 'Ready' || order.delivery_status === 'dispatched';
      if (statusFilter === 'delivered') return order.delivery_status === 'delivered';
      if (statusFilter === 'returns') return order.return_status === 'requested' || order.return_status === 'expired' || order.return_override_by;

      return true;
    });
  }, [orders, searchQuery, statusFilter]);

  // Helper for 14-day countdown calculations
  const calculateReturnRemainingDays = (returnUntil: string | null) => {
    if (!returnUntil) return null;
    const diff = new Date(returnUntil).getTime() - Date.now();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days;
  };

  return (
    <div className="flex flex-col h-full text-text p-4 space-y-4 overflow-y-auto">
      {/* Top Header Card */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-bg border border-border rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-primary/10 text-primary border border-primary/20">
            <Globe size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black tracking-tight text-text">Online & Website Orders</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary border border-primary/20">
                Live Store Channel
              </span>
            </div>
            <p className="text-xs text-muted">
              Prescriptions, website customer orders, 14-day return windows, and fulfillment dispatch.
            </p>
          </div>
        </div>

        {/* Store Badge & Refresh */}
        <div className="flex items-center gap-2 self-start lg:self-auto">
          <div className="px-3 py-1.5 rounded-xl bg-bg2 border border-border flex items-center gap-2 text-xs font-semibold text-text">
            <StoreIcon size={14} className="text-primary" />
            <span>Active Store: <strong className="text-primary">{activeStore?.name || `Store #${activeStoreId}`}</strong></span>
          </div>
          <button
            onClick={() => fetchOrders(false)}
            disabled={loading}
            className="p-2 rounded-xl bg-bg2 hover:bg-bg3 border border-border text-muted hover:text-text transition-all cursor-pointer"
            title="Refresh Orders"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin text-primary' : ''} />
          </button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div
          onClick={() => setStatusFilter('all')}
          className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${statusFilter === 'all' ? 'bg-primary/10 border-primary/40 shadow-sm' : 'bg-bg border-border hover:bg-bg2'}`}
        >
          <div className="flex items-center justify-between text-muted">
            <span className="text-[10px] font-bold uppercase tracking-wider">All Website Orders</span>
            <ShoppingBag size={14} className="text-primary" />
          </div>
          <div className="text-xl font-black text-text mt-1">{metrics.total}</div>
        </div>

        <div
          onClick={() => setStatusFilter('pending')}
          className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${statusFilter === 'pending' ? 'bg-amber-500/10 border-amber-500/40 shadow-sm' : 'bg-bg border-border hover:bg-bg2'}`}
        >
          <div className="flex items-center justify-between text-amber-500">
            <span className="text-[10px] font-bold uppercase tracking-wider">New / Pending</span>
            <Clock size={14} />
          </div>
          <div className="text-xl font-black text-amber-500 mt-1">{metrics.pending}</div>
        </div>

        <div
          onClick={() => setStatusFilter('ready')}
          className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${statusFilter === 'ready' ? 'bg-blue-500/10 border-blue-500/40 shadow-sm' : 'bg-bg border-border hover:bg-bg2'}`}
        >
          <div className="flex items-center justify-between text-blue-500">
            <span className="text-[10px] font-bold uppercase tracking-wider">Ready / Dispatched</span>
            <Truck size={14} />
          </div>
          <div className="text-xl font-black text-blue-500 mt-1">{metrics.ready}</div>
        </div>

        <div
          onClick={() => setStatusFilter('delivered')}
          className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${statusFilter === 'delivered' ? 'bg-emerald-500/10 border-emerald-500/40 shadow-sm' : 'bg-bg border-border hover:bg-bg2'}`}
        >
          <div className="flex items-center justify-between text-emerald-500">
            <span className="text-[10px] font-bold uppercase tracking-wider">Delivered</span>
            <CheckCircle2 size={14} />
          </div>
          <div className="text-xl font-black text-emerald-500 mt-1">{metrics.delivered}</div>
        </div>

        <div
          onClick={() => setStatusFilter('returns')}
          className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${statusFilter === 'returns' ? 'bg-rose-500/10 border-rose-500/40 shadow-sm' : 'bg-bg border-border hover:bg-bg2'}`}
        >
          <div className="flex items-center justify-between text-rose-500">
            <span className="text-[10px] font-bold uppercase tracking-wider">14-Day Returns</span>
            <RotateCcw size={14} />
          </div>
          <div className="text-xl font-black text-rose-500 mt-1">{metrics.returns}</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-bg border border-border rounded-2xl p-3 shadow-sm">
        <div className="relative w-full sm:w-80">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search by customer, phone, medicine..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-bg2 border border-border rounded-xl text-text placeholder:text-muted/60 focus:outline-none focus:border-primary"
          />
        </div>

        {/* Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
          {(['all', 'pending', 'ready', 'delivered', 'returns'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1 text-xs font-bold rounded-xl transition-all capitalize whitespace-nowrap cursor-pointer ${
                statusFilter === tab
                  ? 'bg-primary text-white shadow-sm'
                  : 'bg-bg2 text-muted hover:text-text border border-border'
              }`}
            >
              {tab === 'returns' ? 'Returns / Overrides' : tab}
            </button>
          ))}
        </div>
      </div>

      {/* Orders List / Cards */}
      <div className="flex-1 bg-bg border border-border rounded-2xl p-4 shadow-sm overflow-y-auto">
        {filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
            <div className="p-3 rounded-full bg-bg3 text-muted">
              <ShoppingBag size={28} />
            </div>
            <div className="text-sm font-bold text-text">No Online Orders Found</div>
            <p className="text-xs text-muted max-w-sm">
              {searchQuery
                ? 'No website orders match your search query.'
                : 'Incoming customer orders from your website and digital prescription uploads will appear here automatically.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredOrders.map((order) => {
              const remainingDays = calculateReturnRemainingDays(order.return_window_until);
              const isEligibleForReturn = order.delivery_status === 'delivered' && (remainingDays !== null && remainingDays >= 0);
              const isReturnExpired = order.delivery_status === 'delivered' && (remainingDays !== null && remainingDays < 0);

              return (
                <div
                  key={order.id}
                  className="p-4 rounded-2xl bg-bg2 border border-border shadow-sm hover:border-primary/40 transition-all flex flex-col justify-between space-y-3"
                >
                  {/* Card Header: Order # & Status */}
                  <div className="flex items-start justify-between gap-2 border-b border-border/60 pb-2.5">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-black text-primary">#{order.id}</span>
                        <span className="px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase bg-primary/10 text-primary border border-primary/20">
                          Website
                        </span>
                        {order.prescription_url && (
                          <span className="px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 flex items-center gap-0.5">
                            <FileImage size={10} /> Rx Attached
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted flex items-center gap-1 mt-0.5">
                        <Calendar size={11} />
                        <span>{order.date ? new Date(order.date).toLocaleDateString() : 'Today'}</span>
                      </div>
                    </div>

                    {/* Status Pill */}
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        order.status === 'Fulfilled'
                          ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                          : order.status === 'Ready'
                          ? 'bg-blue-500/10 text-blue-500 border-blue-500/30'
                          : order.status === 'Cancelled'
                          ? 'bg-rose-500/10 text-rose-500 border-rose-500/30'
                          : 'bg-amber-500/10 text-amber-500 border-amber-500/30'
                      }`}>
                        {order.status || 'Pending'}
                      </span>
                      {order.delivery_status && (
                        <span className="text-[9px] font-mono text-muted capitalize">
                          Delivery: {order.delivery_status}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Customer Information */}
                  <div className="space-y-1.5 text-xs text-text">
                    <div className="flex items-center justify-between">
                      <span className="font-bold flex items-center gap-1.5 truncate">
                        <User size={13} className="text-muted shrink-0" />
                        <span className="truncate">{order.requester || 'Guest Customer'}</span>
                      </span>
                      {order.phone && (
                        <a
                          href={`https://wa.me/91${order.phone.replace(/\D/g, '').slice(-10)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-emerald-500 hover:text-emerald-400 font-bold flex items-center gap-1 hover:underline"
                        >
                          <Phone size={11} /> {order.phone}
                        </a>
                      )}
                    </div>

                    {order.notes && (
                      <p className="text-[11px] text-muted line-clamp-2 bg-bg3/40 p-2 rounded-xl border border-border/40">
                        {order.notes}
                      </p>
                    )}
                  </div>

                  {/* Medicine Item Details */}
                  <div className="p-2.5 rounded-xl bg-bg border border-border/60 space-y-1 text-xs">
                    <div className="font-bold text-text truncate">
                      {order.medicine_name || order.product || 'Prescription Fulfillment Request'}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted">
                      <span>Qty: <strong className="text-text">{order.qty || 1}</strong></span>
                      {order.advance_payment > 0 && (
                        <span className="text-emerald-500 font-bold">Advance: ₹{order.advance_payment}</span>
                      )}
                    </div>
                  </div>

                  {/* Prescription Preview Button */}
                  {order.prescription_url && (
                    <button
                      type="button"
                      onClick={() => setSelectedPrescription(order.prescription_url)}
                      className="w-full py-1.5 px-3 rounded-xl bg-bg3 hover:bg-bg3/80 border border-border text-xs font-bold text-text flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                    >
                      <Eye size={13} className="text-primary" />
                      <span>View Doctor's Prescription</span>
                    </button>
                  )}

                  {/* 14-Day Return Window Widget */}
                  {order.delivery_status === 'delivered' && (
                    <div className="p-2.5 rounded-xl bg-bg border border-border/80 space-y-1.5">
                      <div className="flex items-center justify-between text-[10px] font-bold">
                        <span className="flex items-center gap-1 text-muted">
                          <RotateCcw size={11} /> 14-Day Return Window:
                        </span>
                        {isEligibleForReturn && (
                          <span className="text-emerald-500 font-black">{remainingDays} days remaining</span>
                        )}
                        {isReturnExpired && !order.return_override_by && (
                          <span className="text-rose-500 font-black">Expired</span>
                        )}
                        {order.return_override_by && (
                          <span className="text-purple-500 font-black">Override Approved</span>
                        )}
                      </div>

                      {/* Progress meter */}
                      {isEligibleForReturn && remainingDays !== null && (
                        <div className="w-full h-1.5 bg-bg3 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 transition-all duration-500"
                            style={{ width: `${Math.max(5, (remainingDays / 14) * 100)}%` }}
                          />
                        </div>
                      )}

                      {/* Override Button if expired or requested */}
                      {(isReturnExpired || order.return_status === 'requested') && !order.return_override_by && (
                        <button
                          type="button"
                          onClick={() => setOverrideModalOrder(order)}
                          className="w-full mt-1 py-1 text-[10px] font-bold bg-amber-500/10 border border-amber-500/30 text-amber-500 rounded-lg hover:bg-amber-500/20 transition-all cursor-pointer"
                        >
                          Authorize Manager Return Override
                        </button>
                      )}

                      {order.return_override_by && (
                        <div className="text-[9px] text-purple-400">
                          Approved by {order.return_override_by}: "{order.return_override_reason}"
                        </div>
                      )}
                    </div>
                  )}

                  {/* Actions Row */}
                  <div className="pt-2 border-t border-border/60 flex items-center justify-between gap-1.5">
                    {order.status === 'Pending' && (
                      <button
                        type="button"
                        disabled={actionInProgress === order.id}
                        onClick={() => handleMarkReady(order.id)}
                        className="flex-1 py-1.5 px-2 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold rounded-xl shadow-sm transition-all flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <Check size={13} />
                        <span>Mark Ready</span>
                      </button>
                    )}

                    {order.status === 'Ready' && order.delivery_status !== 'delivered' && (
                      <button
                        type="button"
                        disabled={actionInProgress === order.id}
                        onClick={() => handleMarkDelivered(order.id)}
                        className="flex-1 py-1.5 px-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded-xl shadow-sm transition-all flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <Truck size={13} />
                        <span>Mark Delivered</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleOpenInPOS(order)}
                      className="py-1.5 px-3 bg-primary/15 hover:bg-primary/25 text-primary border border-primary/30 text-[11px] font-bold rounded-xl transition-all flex items-center gap-1 cursor-pointer"
                      title="Open in POS to bill and checkout"
                    >
                      <span>Fulfill in POS</span>
                      <ChevronRight size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Prescription Zoom Lightbox Modal */}
      {selectedPrescription && (
        <div className="fixed inset-0 z-global-modal flex items-center justify-center bg-bg3/80 backdrop-blur-md p-4">
          <div className="bg-bg border border-border w-full max-w-2xl rounded-3xl p-5 space-y-4 shadow-2xl relative">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <FileImage size={18} className="text-primary" />
                <h3 className="font-bold text-sm text-text">Customer Prescription Verification</h3>
              </div>
              <button
                onClick={() => setSelectedPrescription(null)}
                className="p-1 rounded-lg hover:bg-bg3 text-muted hover:text-text cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[70vh] overflow-auto flex items-center justify-center bg-bg/40 rounded-2xl p-2">
              <img
                src={selectedPrescription}
                alt="Doctor's Prescription"
                className="max-w-full max-h-[65vh] object-contain rounded-xl shadow-md"
              />
            </div>

            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <a
                href={selectedPrescription}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 bg-bg3 text-text hover:bg-bg3/80 text-xs font-bold rounded-xl flex items-center gap-1.5"
              >
                <ExternalLink size={13} /> Open Full Size
              </a>
              <button
                onClick={() => setSelectedPrescription(null)}
                className="px-5 py-2 bg-primary text-white text-xs font-bold rounded-xl shadow-md hover:bg-primary/90"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Return Override Authorization Modal */}
      {overrideModalOrder && (
        <div className="fixed inset-0 z-global-modal flex items-center justify-center bg-bg3/80 backdrop-blur-sm p-4">
          <div className="bg-bg border border-border w-full max-w-md rounded-3xl p-6 space-y-4 shadow-2xl text-left">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <ShieldAlert size={18} className="text-amber-500" />
                <h3 className="font-bold text-sm text-text">Authorize Return Override</h3>
              </div>
              <button
                onClick={() => setOverrideModalOrder(null)}
                className="p-1 rounded-lg hover:bg-bg3 text-muted hover:text-text cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-muted">
              Authorizing a customer return beyond the 14-day return window for Order #{overrideModalOrder.id}. An immutable audit log entry will be recorded.
            </p>

            <form onSubmit={handleApplyOverride} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-text">Authorized Pharmacist / Manager *</label>
                <input
                  type="text"
                  required
                  value={overrideUser}
                  onChange={(e) => setOverrideUser(e.target.value)}
                  className="w-full mt-1 px-3 py-2 text-xs bg-bg2 border border-border rounded-xl text-text focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-text">Reason for Exception *</label>
                <textarea
                  required
                  rows={3}
                  placeholder="e.g. Doctor changed dosage regimen / Adverse reaction reported / Unopened sealed pack"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  className="w-full mt-1 px-3 py-2 text-xs bg-bg2 border border-border rounded-xl text-text focus:outline-none focus:border-primary"
                />
              </div>

              <div className="pt-2 flex items-center justify-between border-t border-border">
                <button
                  type="button"
                  onClick={() => setOverrideModalOrder(null)}
                  className="px-4 py-2 rounded-xl bg-bg3 text-muted hover:text-text text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingOverride}
                  className="px-5 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold shadow-md hover:bg-amber-700 disabled:opacity-50"
                >
                  {submittingOverride ? 'Saving...' : 'Approve Override'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
