import React, { useState, useEffect, useCallback } from 'react';
import { Clock, AlertTriangle, PauseCircle, ChevronDown, ChevronUp, ShoppingCart, Send, RefreshCw, CheckCircle2, ShieldAlert } from 'lucide-react';
import { api } from '../services/api';
import { toastEvent } from '../services/events';

export interface IncompleteOrderMedicine {
  id?: number;
  name: string;
  qty: number;
  unit?: string;
}

export interface IncompleteCustomerOrder {
  phone: string;
  name: string;
  sourceType: 'special_order' | 'refill' | 'online_order';
  orderIds: number[];
  medicines: IncompleteOrderMedicine[];
  firstOrderDate: string;
  elapsedHours: number;
  classification: 'overdue' | 'market_paused';
  pauseReason?: string;
  resumedWorkingDate?: string;
  resumedDeliveryWindow?: string;
  status: string;
}

export interface IncompleteAuditData {
  overdue: IncompleteCustomerOrder[];
  marketPaused: IncompleteCustomerOrder[];
  stats: {
    totalOverdueCount: number;
    totalPausedCount: number;
    totalOverdueMedicines: number;
    totalPausedMedicines: number;
  };
}

interface IncompleteOrders24hCardProps {
  onOrderUpdated?: () => void;
  className?: string;
}

export const IncompleteOrders24hCard: React.FC<IncompleteOrders24hCardProps> = ({
  onOrderUpdated,
  className = ''
}) => {
  const [data, setData] = useState<IncompleteAuditData | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'overdue' | 'paused'>('all');
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set());
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [isNoticeModalOpen, setIsNoticeModalOpen] = useState(false);
  const [customNoticeTemplate, setCustomNoticeTemplate] = useState(
    'Dear {{name}}, your order from Pharmacy was temporarily held due to wholesale market holiday. It will be delivered on {{next_working_date}}. Thank you for your patience!'
  );

  const fetchAudit = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.getIncomplete24hAudit();
      if (res && res.audit) {
        setData(res.audit);
      }
    } catch (err: any) {
      console.warn('[IncompleteOrders24hCard] Failed to fetch audit:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAudit();
  }, [fetchAudit]);

  const toggleExpand = (key: string) => {
    setExpandedCustomers(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handlePushToCart = async (orderIds: number[]) => {
    try {
      setActionInProgress('cart');
      const res = await api.executeIncomplete24hAction({
        action: 'push_to_cart',
        orderIds
      });
      toastEvent.trigger(res?.message || 'Orders pushed to cart queue.', 'success');
      fetchAudit();
      if (onOrderUpdated) onOrderUpdated();
    } catch (err: any) {
      toastEvent.trigger(err?.message || 'Failed to push orders to cart.', 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleSnooze = async (orderIds: number[]) => {
    try {
      setActionInProgress('snooze');
      const res = await api.executeIncomplete24hAction({
        action: 'snooze_sla',
        orderIds,
        hours: 24
      });
      toastEvent.trigger(res?.message || 'Orders snoozed for 24 hours.', 'info');
      fetchAudit();
      if (onOrderUpdated) onOrderUpdated();
    } catch (err: any) {
      toastEvent.trigger(err?.message || 'Failed to snooze orders.', 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleSendDelayNotices = async () => {
    if (!data) return;
    try {
      setActionInProgress('notify');
      const phones = data.marketPaused.map(c => c.phone).filter(Boolean);
      const nextDate = data.marketPaused[0]?.resumedWorkingDate || 'tomorrow';
      const res = await api.executeIncomplete24hAction({
        action: 'send_delay_notices',
        customerPhones: phones,
        template: customNoticeTemplate,
        nextWorkingDate: nextDate
      });
      toastEvent.trigger(res?.message || 'Delay notices dispatched.', 'success');
      setIsNoticeModalOpen(false);
      fetchAudit();
    } catch (err: any) {
      toastEvent.trigger(err?.message || 'Failed to send delay notices.', 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  const overdueList = data?.overdue || [];
  const pausedList = data?.marketPaused || [];
  const totalItemsCount = overdueList.length + pausedList.length;

  if (!loading && totalItemsCount === 0) {
    return (
      <div className={`p-4 rounded-xl border border-border bg-bg2 text-text flex items-center justify-between text-sm ${className}`}>
        <div className="flex items-center gap-2 text-emerald-500">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span className="font-medium">All orders fulfilled within 24h SLA. No delayed or market-paused orders.</span>
        </div>
        <button
          onClick={fetchAudit}
          className="p-1.5 hover:bg-bg3 rounded-lg text-muted hover:text-text transition-colors"
          title="Refresh SLA audit"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
    );
  }

  const displayedList =
    activeTab === 'overdue' ? overdueList :
    activeTab === 'paused' ? pausedList :
    [...overdueList, ...pausedList];

  return (
    <div className={`rounded-xl border border-border bg-bg2 shadow-sm overflow-hidden ${className}`}>
      {/* Header */}
      <div className="p-4 border-b border-border flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-text text-base">24-Hour Fulfillment Watch</h3>
              {overdueList.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-500 border border-rose-500/30">
                  {overdueList.length} Overdue
                </span>
              )}
              {pausedList.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-500 border border-amber-500/30">
                  {pausedList.length} Market-Paused
                </span>
              )}
            </div>
            <p className="text-xs text-muted mt-0.5">
              Calendar-aware tracking distinguishing active store delays from market closures
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-bg rounded-lg p-0.5 border border-border text-xs">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-2.5 py-1 rounded-md transition-colors ${activeTab === 'all' ? 'bg-bg3 text-text font-medium' : 'text-muted hover:text-text'}`}
            >
              All ({totalItemsCount})
            </button>
            <button
              onClick={() => setActiveTab('overdue')}
              className={`px-2.5 py-1 rounded-md transition-colors ${activeTab === 'overdue' ? 'bg-bg3 text-rose-500 font-medium' : 'text-muted hover:text-text'}`}
            >
              Overdue ({overdueList.length})
            </button>
            <button
              onClick={() => setActiveTab('paused')}
              className={`px-2.5 py-1 rounded-md transition-colors ${activeTab === 'paused' ? 'bg-bg3 text-amber-500 font-medium' : 'text-muted hover:text-text'}`}
            >
              Paused ({pausedList.length})
            </button>
          </div>
          <button
            onClick={fetchAudit}
            disabled={loading}
            className="p-1.5 hover:bg-bg3 rounded-lg text-muted hover:text-text transition-colors"
            title="Refresh SLA audit"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Customer List */}
      <div className="divide-y divide-border max-h-[380px] overflow-y-auto">
        {displayedList.map(item => {
          const custKey = `${item.phone}_${item.name}`;
          const isExpanded = expandedCustomers.has(custKey);
          const isOverdue = item.classification === 'overdue';

          return (
            <div key={custKey} className="p-3.5 hover:bg-bg3/30 transition-colors">
              <div className="flex items-center justify-between gap-3 cursor-pointer" onClick={() => toggleExpand(custKey)}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`p-1.5 rounded-lg flex-shrink-0 ${isOverdue ? 'bg-rose-500/10 text-rose-500' : 'bg-amber-500/10 text-amber-500'}`}>
                    {isOverdue ? <AlertTriangle className="w-4 h-4" /> : <PauseCircle className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text text-sm truncate">{item.name}</span>
                      <span className="text-xs text-muted font-mono">{item.phone}</span>
                      <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${
                        isOverdue ? 'bg-rose-500/10 text-rose-500' : 'bg-amber-500/10 text-amber-500'
                      }`}>
                        {item.elapsedHours}h ago
                      </span>
                    </div>
                    <div className="text-xs text-muted mt-0.5 truncate">
                      {item.medicines.map(m => `${m.name} (×${m.qty})`).join(', ')}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                  {isOverdue ? (
                    <button
                      onClick={() => handlePushToCart(item.orderIds)}
                      disabled={actionInProgress === 'cart'}
                      className="px-2.5 py-1 text-xs font-medium rounded-lg bg-primary text-white hover:opacity-90 flex items-center gap-1.5 transition-opacity"
                    >
                      <ShoppingCart className="w-3.5 h-3.5" />
                      Push to Cart
                    </button>
                  ) : (
                    <span className="text-xs text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded">
                      Resumes: {item.resumedWorkingDate || 'Next Open Day'}
                    </span>
                  )}

                  <button
                    onClick={() => handleSnooze(item.orderIds)}
                    disabled={actionInProgress === 'snooze'}
                    className="px-2 py-1 text-xs text-muted hover:text-text rounded-lg hover:bg-bg transition-colors"
                  >
                    Snooze 24h
                  </button>

                  <button
                    onClick={() => toggleExpand(custKey)}
                    className="p-1 text-muted hover:text-text rounded"
                  >
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Accordion Expanded Detail */}
              {isExpanded && (
                <div className="mt-3 pt-3 border-t border-border/60 pl-9 space-y-2">
                  <div className="text-xs text-muted">
                    <span className="font-semibold text-text">Ordered Medicines:</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {item.medicines.map((med, idx) => (
                      <div key={idx} className="p-2 rounded bg-bg border border-border flex items-center justify-between">
                        <span className="font-medium text-text">{med.name}</span>
                        <span className="text-muted font-mono">Qty: {med.qty}</span>
                      </div>
                    ))}
                  </div>

                  {item.classification === 'market_paused' && (
                    <div className="p-2.5 rounded bg-amber-500/5 border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400">
                      ℹ️ <strong>Status:</strong> {item.pauseReason || 'Wholesale market closed'}.
                      {item.resumedWorkingDate && ` Next scheduled fulfillment date: ${item.resumedWorkingDate} (${item.resumedDeliveryWindow || 'Morning slot'}).`}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer Bulk Actions */}
      <div className="p-3 bg-bg3/50 border-t border-border flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-muted">
          Showing {displayedList.length} of {totalItemsCount} incomplete customer order(s)
        </span>
        <div className="flex items-center gap-2">
          {overdueList.length > 0 && (
            <button
              onClick={() => handlePushToCart(overdueList.flatMap(c => c.orderIds))}
              disabled={actionInProgress === 'cart'}
              className="px-3 py-1.5 rounded-lg bg-primary text-white font-medium hover:opacity-90 flex items-center gap-1.5 transition-opacity"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              Push All Overdue ({overdueList.length})
            </button>
          )}

          {pausedList.length > 0 && (
            <button
              onClick={() => setIsNoticeModalOpen(true)}
              className="px-3 py-1.5 rounded-lg border border-amber-500/40 text-amber-500 hover:bg-amber-500/10 font-medium flex items-center gap-1.5 transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              Notify Paused Patients ({pausedList.length})
            </button>
          )}

          <button
            onClick={() => handleSnooze([...overdueList, ...pausedList].flatMap(c => c.orderIds))}
            disabled={actionInProgress === 'snooze'}
            className="px-2.5 py-1.5 rounded-lg border border-border text-muted hover:text-text hover:bg-bg transition-colors"
          >
            Snooze All (24h)
          </button>
        </div>
      </div>

      {/* Human-in-the-Loop Delay Notice Modal */}
      {isNoticeModalOpen && (
        <div className="fixed inset-0 z-global-modal flex items-center justify-center p-4 bg-black/60">
          <div className="w-[95vw] max-w-lg rounded-2xl bg-bg border border-border shadow-[0_4px_24px_rgba(0,0,0,0.12)] overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2 text-amber-500 font-semibold text-base">
                <ShieldAlert className="w-5 h-5" />
                <span>Review & Approve WhatsApp Delay Notices</span>
              </div>
              <button
                onClick={() => setIsNoticeModalOpen(false)}
                className="text-muted hover:text-text text-sm p-1 rounded hover:bg-bg2"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-muted">
              Sends an anti-ban paced WhatsApp notice to {pausedList.length} affected customer(s) whose orders were paused due to market closure.
            </p>

            <div>
              <label className="text-xs font-semibold text-text block mb-1">
                WhatsApp Message Template:
              </label>
              <textarea
                value={customNoticeTemplate}
                onChange={e => setCustomNoticeTemplate(e.target.value)}
                rows={4}
                className="w-full p-2.5 text-xs rounded-lg border border-border bg-bg2 text-text focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <span className="text-[11px] text-muted">
                Available tags: <code className="bg-bg3 px-1 rounded">{'{{name}}'}</code>, <code className="bg-bg3 px-1 rounded">{'{{next_working_date}}'}</code>
              </span>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => setIsNoticeModalOpen(false)}
                className="px-3.5 py-1.5 text-xs rounded-lg border border-border text-text hover:bg-bg2"
              >
                Cancel
              </button>
              <button
                onClick={handleSendDelayNotices}
                disabled={actionInProgress === 'notify'}
                className="px-4 py-1.5 text-xs rounded-lg bg-primary text-white font-medium hover:opacity-90 flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                {actionInProgress === 'notify' ? 'Sending...' : `Approve & Send (${pausedList.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
