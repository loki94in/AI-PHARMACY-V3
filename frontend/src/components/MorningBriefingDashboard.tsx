import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw,
  Clock,
  CheckCircle2,
  Phone,
  MessageCircle,
  AlertTriangle,
  ArrowRight,
  Package,
  ShoppingBag,
  RotateCcw,
  Check,
  X,
  Calendar,
  Building2,
  ChevronDown,
  ChevronUp,
  User,
  ExternalLink,
  Sparkles
} from 'lucide-react';
import { morningBriefingApi } from '../services/morningBriefingApi';
import type { MorningBriefingData, BriefingItem } from '../types/morningBriefing';
import { toastEvent } from '../services/events';
import { getLocalDateString, getTodayString } from '../utils/date';

interface Props {
  className?: string;
  onNavigateTab?: (tab: string) => void;
}

export const MorningBriefingDashboard: React.FC<Props> = ({ className = '', onNavigateTab }) => {
  const queryClient = useQueryClient();
  const [selectedCard, setSelectedCard] = useState<'refills' | 'special_orders' | 'online_orders' | 'call_tasks' | null>(null);
  const [editingContactItem, setEditingContactItem] = useState<BriefingItem | null>(null);
  const [newPhoneInput, setNewPhoneInput] = useState('');
  const [callNotesModalItem, setCallNotesModalItem] = useState<BriefingItem | null>(null);
  const [callOutcomeAction, setCallOutcomeAction] = useState<'no_answer' | 'further_action_needed' | 'customer_responded' | null>(null);
  const [callOutcomeNotes, setCallOutcomeNotes] = useState('');
  const [rescheduleDate, setRescheduleDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return getLocalDateString(d);
  });

  const { data, isLoading, refetch, isFetching } = useQuery<MorningBriefingData>({
    queryKey: ['morning-briefing'],
    queryFn: morningBriefingApi.getMorningBriefing,
    staleTime: 20000,
    refetchOnWindowFocus: false,
  });

  // Listen to SSE updates for morning briefing and related events
  useEffect(() => {
    const handleUpdate = () => {
      refetch();
    };

    window.addEventListener('morning_briefing_updated', handleUpdate);
    window.addEventListener('refill_updated', handleUpdate);
    window.addEventListener('call_tasks_updated', handleUpdate);
    window.addEventListener('refresh-special-orders', handleUpdate);

    return () => {
      window.removeEventListener('morning_briefing_updated', handleUpdate);
      window.removeEventListener('refill_updated', handleUpdate);
      window.removeEventListener('call_tasks_updated', handleUpdate);
      window.removeEventListener('refresh-special-orders', handleUpdate);
    };
  }, [refetch]);

  // Route to WhatsApp Mutation
  const routeWaMutation = useMutation({
    mutationFn: (item: BriefingItem) => morningBriefingApi.routeChannel('whatsapp', item),
    onSuccess: (res) => {
      toastEvent.trigger(res.message || 'Added to WhatsApp queue', 'success');
      queryClient.invalidateQueries({ queryKey: ['morning-briefing'] });
    },
    onError: (err: any) => {
      toastEvent.trigger(err.response?.data?.error || err.message || 'Failed to route to WhatsApp queue', 'error');
    }
  });

  // Route to Call Task Mutation
  const routeCallMutation = useMutation({
    mutationFn: (item: BriefingItem) => morningBriefingApi.routeChannel('call_task', item),
    onSuccess: (res) => {
      toastEvent.trigger(res.message || 'Added to Call Task queue', 'success');
      queryClient.invalidateQueries({ queryKey: ['morning-briefing'] });
      queryClient.invalidateQueries({ queryKey: ['call-tasks'] });
    },
    onError: (err: any) => {
      toastEvent.trigger(err.response?.data?.error || err.message || 'Failed to add to Call Task queue', 'error');
    }
  });

  // Update Contact Mutation
  const updateContactMutation = useMutation({
    mutationFn: (payload: { customer_name?: string; new_phone: string; reference_id?: string; source_type?: string }) =>
      morningBriefingApi.updateContact(payload),
    onSuccess: (res) => {
      toastEvent.trigger(res.message, 'success');
      setEditingContactItem(null);
      setNewPhoneInput('');
      queryClient.invalidateQueries({ queryKey: ['morning-briefing'] });
    },
    onError: (err: any) => {
      toastEvent.trigger(err.response?.data?.error || err.message || 'Failed to update phone number', 'error');
    }
  });

  // Advance Call Outcome Mutation
  const callOutcomeMutation = useMutation({
    mutationFn: (payload: { taskId: number; outcome: 'called' | 'customer_responded' | 'no_answer' | 'further_action_needed'; notes?: string; reschedule?: string }) =>
      morningBriefingApi.advanceCallOutcome(payload.taskId, payload.outcome, {
        outcome_notes: payload.notes,
        reschedule_date: payload.reschedule
      }),
    onSuccess: (res) => {
      toastEvent.trigger(res.message, 'success');
      setCallNotesModalItem(null);
      setCallOutcomeAction(null);
      setCallOutcomeNotes('');
      queryClient.invalidateQueries({ queryKey: ['morning-briefing'] });
      queryClient.invalidateQueries({ queryKey: ['call-tasks'] });
    },
    onError: (err: any) => {
      toastEvent.trigger(err.response?.data?.error || err.message || 'Failed to advance call outcome', 'error');
    }
  });

  const handleOpenContactEdit = (item: BriefingItem) => {
    setEditingContactItem(item);
    setNewPhoneInput(item.customer_phone || '');
  };

  const handleSaveContact = () => {
    if (!editingContactItem || !newPhoneInput.trim()) return;
    updateContactMutation.mutate({
      customer_name: editingContactItem.customer_name,
      new_phone: newPhoneInput.trim(),
      reference_id: editingContactItem.reference_id,
      source_type: editingContactItem.source_type
    });
  };

  const handleOpenCallActionModal = (item: BriefingItem, action: 'no_answer' | 'further_action_needed' | 'customer_responded') => {
    setCallNotesModalItem(item);
    setCallOutcomeAction(action);
    setCallOutcomeNotes('');
  };

  const handleConfirmCallOutcome = () => {
    if (!callNotesModalItem || !callOutcomeAction) return;
    callOutcomeMutation.mutate({
      taskId: Number(callNotesModalItem.id),
      outcome: callOutcomeAction,
      notes: callOutcomeNotes,
      reschedule: rescheduleDate
    });
  };

  const refills = data?.refills;
  const specialOrders = data?.special_orders;
  const onlineOrders = data?.online_orders;
  const callTasks = data?.call_tasks;
  const contactReview = data?.contact_review;

  const currentItems: BriefingItem[] = selectedCard ? (data ? (data[selectedCard]?.items || []) : []) : [];

  return (
    <div className={`space-y-6 ${className}`}>
      {/* 1. Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-bg2 border border-border shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-amber/10 border border-amber/20 text-amber">
            <Sparkles size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl sm:text-2xl font-black text-text tracking-tight">
                Morning Briefing & Reorder Hub
              </h2>
              {isFetching && <RefreshCw size={14} className="animate-spin text-muted" />}
            </div>
            <p className="text-xs sm:text-sm text-muted">
              All pending work in one place • Save time • Never miss a customer
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-bg3 hover:bg-bg border border-border text-xs font-bold text-text transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
            <span>Refresh Briefing</span>
          </button>
        </div>
      </div>

      {/* 2. Contact Review Alert Banner (if any records lack usable phone) */}
      {contactReview && contactReview.total > 0 && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-amber-500 font-bold text-sm">
            <AlertTriangle size={18} className="flex-shrink-0" />
            <span>
              <strong>{contactReview.total} record(s)</strong> have missing or invalid contact numbers and cannot receive WhatsApp or phone calls.
            </span>
          </div>
          <button
            onClick={() => setSelectedCard(null)}
            className="px-3 py-1 bg-amber-500 text-white rounded-lg text-xs font-bold shadow hover:bg-amber-600 transition-all self-start sm:self-auto cursor-pointer"
          >
            Review Contact Details ({contactReview.total})
          </button>
        </div>
      )}

      {/* 3. The 4 Morning Briefing Dashboard Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Pending Refills (Green) */}
        <div
          onClick={() => setSelectedCard(selectedCard === 'refills' ? null : 'refills')}
          className={`p-5 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group ${
            selectedCard === 'refills'
              ? 'bg-emerald-500/10 border-emerald-500 ring-2 ring-emerald-500/30'
              : 'bg-bg2 hover:bg-bg3/60 border-border'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
              <RotateCcw size={20} />
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-black bg-emerald-500 text-white shadow-sm min-w-7 text-center">
              {isLoading ? '...' : refills?.total ?? 0}
            </span>
          </div>

          <h3 className="text-base font-extrabold text-text mb-2">Pending Refills</h3>

          <ul className="space-y-1 text-xs text-muted mb-4">
            <li className="flex items-center justify-between">
              <span>• Non-compliant refills</span>
              <strong className="text-text">{refills?.pending ?? 0}</strong>
            </li>
            <li className="flex items-center justify-between">
              <span>• Partially fulfilled</span>
              <strong className="text-text">{refills?.partially_fulfilled ?? 0}</strong>
            </li>
            <li className="flex items-center justify-between">
              <span>• Awaiting approval (2-Mo)</span>
              <strong className={refills?.action_required ? 'text-amber-400 font-bold' : 'text-text'}>
                {refills?.action_required ?? 0}
              </strong>
            </li>
          </ul>

          <div className="flex items-center justify-between pt-2 border-t border-border/40 text-xs font-bold text-emerald-400">
            <span>{selectedCard === 'refills' ? 'Hide Items ▲' : 'View Details →'}</span>
            <Link
              to="/crm"
              onClick={(e) => e.stopPropagation()}
              className="p-1 hover:text-emerald-300"
              title="Open full CRM Refills tab"
            >
              <ExternalLink size={13} />
            </Link>
          </div>
        </div>

        {/* Card 2: Special Orders (Purple) */}
        <div
          onClick={() => setSelectedCard(selectedCard === 'special_orders' ? null : 'special_orders')}
          className={`p-5 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group ${
            selectedCard === 'special_orders'
              ? 'bg-purple-500/10 border-purple-500 ring-2 ring-purple-500/30'
              : 'bg-bg2 hover:bg-bg3/60 border-border'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="p-2.5 rounded-xl bg-purple-500/15 border border-purple-500/30 text-purple-400">
              <Package size={20} />
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-black bg-purple-600 text-white shadow-sm min-w-7 text-center">
              {isLoading ? '...' : specialOrders?.total ?? 0}
            </span>
          </div>

          <h3 className="text-base font-extrabold text-text mb-2">Special Orders</h3>

          <ul className="space-y-1 text-xs text-muted mb-4">
            <li className="flex items-center justify-between">
              <span>• Customer requests</span>
              <strong className="text-text">{specialOrders?.customer_requests ?? 0}</strong>
            </li>
            <li className="flex items-center justify-between">
              <span>• Procurement needed</span>
              <strong className="text-text">{specialOrders?.procurement_needed ?? 0}</strong>
            </li>
            <li className="flex items-center justify-between">
              <span>• Supplier follow-up</span>
              <strong className="text-text">{specialOrders?.supplier_follow_up ?? 0}</strong>
            </li>
          </ul>

          <div className="flex items-center justify-between pt-2 border-t border-border/40 text-xs font-bold text-purple-400">
            <span>{selectedCard === 'special_orders' ? 'Hide Items ▲' : 'View Details →'}</span>
            <Link
              to="/crm?tab=special_orders"
              onClick={(e) => e.stopPropagation()}
              className="p-1 hover:text-purple-300"
              title="Open CRM Special Orders"
            >
              <ExternalLink size={13} />
            </Link>
          </div>
        </div>

        {/* Card 3: Online Orders (Blue) */}
        <div
          onClick={() => setSelectedCard(selectedCard === 'online_orders' ? null : 'online_orders')}
          className={`p-5 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group ${
            selectedCard === 'online_orders'
              ? 'bg-sky-500/10 border-sky-500 ring-2 ring-sky-500/30'
              : 'bg-bg2 hover:bg-bg3/60 border-border'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="p-2.5 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-400">
              <ShoppingBag size={20} />
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-black bg-sky-600 text-white shadow-sm min-w-7 text-center">
              {isLoading ? '...' : onlineOrders?.total ?? 0}
            </span>
          </div>

          <h3 className="text-base font-extrabold text-text mb-2">Online Orders</h3>

          <ul className="space-y-1 text-xs text-muted mb-4">
            <li className="flex items-center justify-between">
              <span>• Pending / processing</span>
              <strong className="text-text">{onlineOrders?.pending ?? 0}</strong>
            </li>
            <li className="flex items-center justify-between">
              <span>• Awaiting stock</span>
              <strong className="text-text">{onlineOrders?.awaiting_stock ?? 0}</strong>
            </li>
            <li className="flex items-center justify-between">
              <span>• Not delivered</span>
              <strong className="text-text">{onlineOrders?.not_delivered ?? 0}</strong>
            </li>
          </ul>

          <div className="flex items-center justify-between pt-2 border-t border-border/40 text-xs font-bold text-sky-400">
            <span>{selectedCard === 'online_orders' ? 'Hide Items ▲' : 'View Details →'}</span>
            <Link
              to="/website-orders"
              onClick={(e) => e.stopPropagation()}
              className="p-1 hover:text-sky-300"
              title="Open Online Orders App"
            >
              <ExternalLink size={13} />
            </Link>
          </div>
        </div>

        {/* Card 4: Call Tasks (Orange/Amber) */}
        <div
          onClick={() => setSelectedCard(selectedCard === 'call_tasks' ? null : 'call_tasks')}
          className={`p-5 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group ${
            selectedCard === 'call_tasks'
              ? 'bg-amber-500/10 border-amber-500 ring-2 ring-amber-500/30'
              : 'bg-bg2 hover:bg-bg3/60 border-border'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
              <Phone size={20} />
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-black bg-amber-600 text-white shadow-sm min-w-7 text-center">
              {isLoading ? '...' : callTasks?.total ?? 0}
            </span>
          </div>

          <h3 className="text-base font-extrabold text-text mb-2">Call Tasks</h3>

          <ul className="space-y-1 text-xs text-muted mb-4">
            <li className="flex items-center justify-between">
              <span>• Pending call</span>
              <strong className="text-text">{callTasks?.pending_call ?? 0}</strong>
            </li>
            <li className="flex items-center justify-between">
              <span>• Called</span>
              <strong className="text-text">{callTasks?.called ?? 0}</strong>
            </li>
            <li className="flex items-center justify-between">
              <span>• Follow-up required</span>
              <strong className="text-text">{callTasks?.follow_up_required ?? 0}</strong>
            </li>
          </ul>

          <div className="flex items-center justify-between pt-2 border-t border-border/40 text-xs font-bold text-amber-400">
            <span>{selectedCard === 'call_tasks' ? 'Hide Items ▲' : 'View Details →'}</span>
            <Link
              to="/crm"
              onClick={(e) => e.stopPropagation()}
              className="p-1 hover:text-amber-300"
              title="Open Call Board"
            >
              <ExternalLink size={13} />
            </Link>
          </div>
        </div>
      </div>

      {/* 4. Active List Panel (Filtered by Selected Card or Contact Review) */}
      {selectedCard ? (
        <div className="p-5 rounded-2xl bg-bg2 border border-border shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-muted">
                Showing:
              </span>
              <span className="text-sm font-extrabold text-text capitalize">
                {selectedCard.replace('_', ' ')} ({currentItems.length})
              </span>
            </div>
            <button
              onClick={() => setSelectedCard(null)}
              className="text-xs font-semibold text-muted hover:text-text cursor-pointer"
            >
              Close List ✕
            </button>
          </div>

          {currentItems.length === 0 ? (
            <div className="py-8 text-center text-muted text-sm">
              <CheckCircle2 size={32} className="mx-auto mb-2 text-emerald-500/50" />
              No pending items in this category. All up to date!
            </div>
          ) : (
            <div className="space-y-3">
              {currentItems.map((item) => (
                <div
                  key={`${item.source_type}_${item.id}`}
                  className="p-4 rounded-xl bg-bg3/40 border border-border/60 hover:border-border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  {/* Left: Info */}
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-primary">
                        {item.reference_id}
                      </span>
                      <span className="text-xs font-semibold text-text truncate">
                        {item.customer_name}
                      </span>
                      {item.customer_phone ? (
                        <a
                          href={`tel:${item.customer_phone}`}
                          className="text-xs text-sky-400 hover:underline flex items-center gap-1"
                        >
                          <Phone size={10} /> {item.customer_phone}
                        </a>
                      ) : (
                        <span className="text-[10px] font-bold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                          No Phone
                        </span>
                      )}
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-bg border border-border text-muted">
                        {item.category_badge}
                      </span>
                    </div>

                    <p className="text-sm font-bold text-text truncate">{item.title}</p>
                    <p className="text-xs text-muted truncate">{item.subtitle}</p>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
                    {/* Routing Actions for Non-Call Items */}
                    {item.source_type !== 'call_task' && (
                      <>
                        {item.channel_status === 'whatsapp_available' && (
                          <button
                            onClick={() => routeWaMutation.mutate(item)}
                            disabled={routeWaMutation.isPending}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          >
                            <MessageCircle size={13} />
                            <span>Add to WhatsApp Queue</span>
                          </button>
                        )}

                        {item.channel_status === 'whatsapp_unavailable' && (
                          <button
                            onClick={() => routeCallMutation.mutate(item)}
                            disabled={routeCallMutation.isPending}
                            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          >
                            <Phone size={13} />
                            <span>Add to Call Queue</span>
                          </button>
                        )}

                        {item.channel_status === 'no_usable_phone' && (
                          <button
                            onClick={() => handleOpenContactEdit(item)}
                            className="px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                          >
                            <AlertTriangle size={13} />
                            <span>Review Contact Info</span>
                          </button>
                        )}
                      </>
                    )}

                    {/* Call Outcome State Machine Actions for Call Tasks */}
                    {item.source_type === 'call_task' && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {item.status === 'pending' && (
                          <button
                            onClick={() =>
                              callOutcomeMutation.mutate({ taskId: Number(item.id), outcome: 'called' })
                            }
                            disabled={callOutcomeMutation.isPending}
                            className="px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          >
                            <Phone size={12} />
                            <span>Mark Called</span>
                          </button>
                        )}

                        <button
                          onClick={() => handleOpenCallActionModal(item, 'customer_responded')}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                        >
                          <Check size={12} />
                          <span>Resolved</span>
                        </button>

                        <button
                          onClick={() => handleOpenCallActionModal(item, 'no_answer')}
                          className="px-2.5 py-1.5 rounded-lg bg-bg2 hover:bg-bg text-muted hover:text-text border border-border text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer"
                        >
                          <Clock size={12} />
                          <span>No Answer</span>
                        </button>

                        <button
                          onClick={() => handleOpenCallActionModal(item, 'further_action_needed')}
                          className="px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer"
                        >
                          <Calendar size={12} />
                          <span>Follow-up</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* 5. Contact Details Review Modal / Drawer */}
      {editingContactItem && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-base font-extrabold text-text flex items-center gap-2">
                <Phone size={18} className="text-amber-500" />
                <span>Correct Contact Information</span>
              </h3>
              <button
                onClick={() => setEditingContactItem(null)}
                className="text-muted hover:text-text cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-text">
              <p className="text-muted">
                Provide a usable 10-digit mobile number for <strong>{editingContactItem.customer_name}</strong> to automatically route them into WhatsApp or the Call Task Queue.
              </p>

              <div>
                <label className="block text-muted font-bold mb-1">Mobile Phone (10 digits)</label>
                <input
                  type="tel"
                  maxLength={10}
                  placeholder="9876543210"
                  value={newPhoneInput}
                  onChange={(e) => setNewPhoneInput(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text font-mono text-sm focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                onClick={() => setEditingContactItem(null)}
                className="px-3 py-1.5 rounded-xl bg-bg3 text-muted hover:text-text text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveContact}
                disabled={newPhoneInput.length !== 10 || updateContactMutation.isPending}
                className="px-4 py-1.5 rounded-xl bg-primary text-white text-xs font-bold shadow hover:opacity-90 disabled:opacity-50 cursor-pointer"
              >
                {updateContactMutation.isPending ? 'Saving...' : 'Save & Re-route'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Call Outcome Notes & Reschedule Modal */}
      {callNotesModalItem && callOutcomeAction && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-base font-extrabold text-text capitalize">
                {callOutcomeAction === 'customer_responded'
                  ? 'Resolve Call Task'
                  : callOutcomeAction === 'no_answer'
                  ? 'Record No Answer (Follow-up)'
                  : 'Schedule Follow-up Action'}
              </h3>
              <button
                onClick={() => setCallNotesModalItem(null)}
                className="text-muted hover:text-text cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-text">
              <div>
                <label className="block text-muted font-bold mb-1">Outcome Notes / Remarks</label>
                <textarea
                  rows={3}
                  placeholder="e.g. Promised to collect tomorrow / Left voice note / Requires medicine substitute..."
                  value={callOutcomeNotes}
                  onChange={(e) => setCallOutcomeNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:outline-none focus:border-primary"
                />
              </div>

              {(callOutcomeAction === 'no_answer' || callOutcomeAction === 'further_action_needed') && (
                <div>
                  <label className="block text-muted font-bold mb-1">Next Follow-up Date (Loops back to Pending Call)</label>
                  <input
                    type="date"
                    min={getTodayString()}
                    value={rescheduleDate}
                    onChange={(e) => setRescheduleDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:outline-none focus:border-primary font-mono"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                onClick={() => setCallNotesModalItem(null)}
                className="px-3 py-1.5 rounded-xl bg-bg3 text-muted hover:text-text text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmCallOutcome}
                disabled={callOutcomeMutation.isPending}
                className="px-4 py-1.5 rounded-xl bg-primary text-white text-xs font-bold shadow hover:opacity-90 disabled:opacity-50 cursor-pointer"
              >
                {callOutcomeMutation.isPending ? 'Saving...' : 'Confirm Outcome'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
