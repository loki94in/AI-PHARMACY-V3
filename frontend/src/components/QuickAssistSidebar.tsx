import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ShoppingCart, Check, BellRing, X, Edit, Edit3, Package, Loader2, ChevronDown,
  MessageCircle, Zap, Globe, ChevronLeft as ChevronLeftIcon, ChevronRight as ChevronRightIcon,
  Activity as ActivityIcon, ShieldCheck as ShieldCheckIcon, Clock as ClockIcon,
  AlertTriangle as AlertIcon, MessageSquare as MessageSquareIcon, Send as SendIcon, Calendar, RotateCw
} from 'lucide-react';
import { toastEvent, refillEvent, whatsappQueueEvent, messageSendEvent, specialOrdersEvent } from '../services/events';
import { subscribeRefillCartJobs, getRefillCartJobs, isRefillJobRunning, startRefillCartJob } from '../services/refillCartJobs';
import { SpecialOrderArrivalModal } from './SpecialOrderArrivalModal';
import { QuickAssistOrderEditModal } from './QuickAssistOrderEditModal';
import type { QuickAssistEditGroup } from './QuickAssistOrderEditModal';
import { api, apiClient } from '../services/api';
import type { SpecialOrder, Refill, AutomationNotification } from '../services/api';
import { useOnClickOutside } from '../hooks/useOnClickOutside';
import { isOnlineOrder } from '../utils/onlineOrders';

interface LocalApiErrorShape {
  response?: { status?: number; data?: { error?: string } };
  message?: string;
}

export const QuickAssistSidebar = memo(({
  expanded,
  setExpanded,
  refills,
  notifications,
  specialOrders = [],
  onActionComplete,
  dailySummary,
  onOpenDailyModal,
  onRefreshDailyLog,
}: {
  expanded: boolean;
  setExpanded: (val: boolean) => void;
  refills: Refill[];
  notifications: AutomationNotification[];
  specialOrders?: SpecialOrder[];
  onActionComplete: () => void;
  dailySummary: {
    sentTodayCount: number;
    stagedCount: number;
    sentPhones: Array<{ recipient_phone: string; last_sent_at: string; recipient_name?: string }>;
  };
  onOpenDailyModal: () => void;
  onRefreshDailyLog: () => void;
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const sidebarRef = useRef<HTMLDivElement>(null);
  const cartJobs = React.useSyncExternalStore(subscribeRefillCartJobs, getRefillCartJobs);
  const [markingOrderedRefillIds, setMarkingOrderedRefillIds] = useState<Set<number>>(new Set());
  const [processingOrderIds, setProcessingOrderIds] = useState<Set<number>>(new Set());
  const [optimisticHiddenOrderIds, setOptimisticHiddenOrderIds] = useState<Set<number>>(new Set());
  const [arrivalModalGroup, setArrivalModalGroup] = useState<{
    requester: string;
    phone?: string;
    items: Array<{ id: number; product: string; qty: number }>;
  } | null>(null);
  const [editingGroup, setEditingGroup] = useState<QuickAssistEditGroup | null>(null);

  // Expand / collapse state for grouped patients (collapsed by default)
  const [expandedRefillKeys, setExpandedRefillKeys] = useState<Set<string>>(new Set());
  const [expandedWebsiteOrderKeys, setExpandedWebsiteOrderKeys] = useState<Set<string>>(new Set());
  const [expandedSpecialOrderKeys, setExpandedSpecialOrderKeys] = useState<Set<string>>(new Set());
  const [expandedStagedKeys, setExpandedStagedKeys] = useState<Set<string>>(new Set());
  const [snoozingKeys, setSnoozingKeys] = useState<Set<string>>(new Set());

  // Master auto-remind toggle state & optimistic overrides for patients & orders
  const [autoRemindMaster, setAutoRemindMaster] = useState<boolean>(true);
  const [optimisticAutoRemindPhones, setOptimisticAutoRemindPhones] = useState<Map<string, boolean>>(new Map());
  const [optimisticAutoRemindOrders, setOptimisticAutoRemindOrders] = useState<Map<number, boolean>>(new Map());

  // Load auto-remind settings on expand
  useEffect(() => {
    if (expanded) {
      api.getQuickAssistAutoRemindSettings()
        .then(res => {
          if (res && typeof res.enabled === 'boolean') {
            setAutoRemindMaster(res.enabled);
          }
        })
        .catch(() => {});
    }
  }, [expanded]);

  const handleToggleMasterAutoRemind = async () => {
    const nextVal = !autoRemindMaster;
    setAutoRemindMaster(nextVal);
    try {
      await api.toggleQuickAssistAutoRemindMaster(nextVal);
      toastEvent.trigger(`Auto-Reminders ${nextVal ? 'ENABLED' : 'PAUSED'} for Quick Assist`, nextVal ? 'success' : 'info');
    } catch (e) {
      setAutoRemindMaster(!nextVal);
      toastEvent.trigger('Failed to update Auto-Remind master setting', 'error');
    }
  };

  const handleTogglePatientAutoRemind = async (phone: string, currentVal: boolean) => {
    if (!phone) return;
    const nextVal = !currentVal;
    setOptimisticAutoRemindPhones(prev => new Map(prev).set(phone, nextVal));
    try {
      await api.togglePatientRefillAutoRemind(phone, nextVal);
      toastEvent.trigger(`Auto reminder ${nextVal ? 'Armed' : 'Disarmed'} for this patient`, 'info');
      refillEvent.triggerRefresh();
    } catch (e) {
      setOptimisticAutoRemindPhones(prev => {
        const next = new Map(prev);
        next.delete(phone);
        return next;
      });
      toastEvent.trigger('Failed to update auto-remind setting', 'error');
    }
  };

  const handleToggleOrderAutoRemind = async (items: Array<{ id: number }>, currentVal: boolean) => {
    if (!items || items.length === 0) return;
    const nextVal = !currentVal;
    setOptimisticAutoRemindOrders(prev => {
      const next = new Map(prev);
      items.forEach(i => next.set(i.id, nextVal));
      return next;
    });
    try {
      await Promise.all(items.map(i => api.toggleOrderAutoRemind(i.id, nextVal)));
      toastEvent.trigger(`Auto reminder ${nextVal ? 'Armed' : 'Disarmed'} for this order`, 'info');
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      specialOrdersEvent.triggerUpdated();
    } catch (e) {
      setOptimisticAutoRemindOrders(prev => {
        const next = new Map(prev);
        items.forEach(i => next.delete(i.id));
        return next;
      });
      toastEvent.trigger('Failed to update auto-remind setting', 'error');
    }
  };

  useEffect(() => {
    if (expanded) {
      onRefreshDailyLog();
    }
  }, [expanded, onRefreshDailyLog, notifications]);

  const toggleStagedKey = (key: string) => {
    setExpandedStagedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSnoozeStagedGroup = async (group: {
    key: string;
    recipient_name: string;
    messages: Array<{ id: number }>;
  }) => {
    if (snoozingKeys.has(group.key)) return;
    setSnoozingKeys(prev => new Set(prev).add(group.key));
    try {
      const ids = group.messages.map(m => m.id);
      await api.snoozeNotificationGroup(ids, 1);
      toastEvent.trigger(`Snoozed reminder for ${group.recipient_name} by 1 day`, 'info');
      refillEvent.triggerRefresh();
      onRefreshDailyLog();
      onActionComplete();
    } catch (err: unknown) {
      console.error('Failed to snooze staged group:', err);
      toastEvent.trigger('Failed to snooze reminder', 'error');
    } finally {
      setSnoozingKeys(prev => {
        const next = new Set(prev);
        next.delete(group.key);
        return next;
      });
    }
  };

  const getAlreadySentInfo = (phone?: string) => {
    if (!phone) return null;
    const cleanP = phone.replace(/\D/g, '').slice(-10);
    return dailySummary.sentPhones.find(p => (p.recipient_phone || '').replace(/\D/g, '').slice(-10) === cleanP);
  };
  const [imageReviewCount, setImageReviewCount] = useState<number>(0);

  useEffect(() => {
    api.getCatalogImageCounts()
      .then(res => {
        if (res?.success && res.counts) {
          setImageReviewCount(res.counts.pending_review || 0);
        }
      })
      .catch(() => {});
  }, [expanded]);

  const toggleRefillKey = (key: string) => {
    setExpandedRefillKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleWebsiteOrderKey = (key: string) => {
    setExpandedWebsiteOrderKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSpecialOrderKey = (key: string) => {
    setExpandedSpecialOrderKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  useOnClickOutside(sidebarRef, (event) => {
    // Do not collapse sidebar if an edit or arrival modal or daily modal is currently open
    if (arrivalModalGroup || editingGroup) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('.z-modal, [role="dialog"], .glass-panel, [data-modal]')) {
      return;
    }
    if (expanded) {
      setExpanded(false);
    }
  });

  // Clear modal states whenever the sidebar collapses
  useEffect(() => {
    if (!expanded) {
      setEditingGroup(null);
      setArrivalModalGroup(null);
    }
  }, [expanded]);

  const handleAcknowledgeAll = async (items: Array<{ id: number; hold_for_stock: number }>) => {
    try {
      const holdItems = items.filter(i => i.hold_for_stock === 1);
      await Promise.all(holdItems.map(i => api.acknowledgeRefill(i.id).catch(() => {})));
      refillEvent.triggerRefresh();
      onActionComplete();
    } catch (e) {
      console.error('Failed to acknowledge all refills:', e);
    }
  };

  const handleSendRefillGroup = async (group: { patient_name: string; patient_phone: string; medicines: Array<{ id: number; medicine_name: string; quantity_needed: number }> }) => {
    try {
      messageSendEvent.triggerSendProgress(group.patient_name || 'Patient', 'Dispatching WhatsApp refill reminder...', 10);
      if (group.patient_phone) {
        await api.sendGroupedRefill({
          patient_name: group.patient_name,
          patient_phone: group.patient_phone,
          medicines: group.medicines
        });
        toastEvent.trigger(`Consolidated refill reminder sent to ${group.patient_name}!`, 'success');
        whatsappQueueEvent.triggerUpdated();
      } else {
        await Promise.all(group.medicines.map(m => api.sendRefillNow(m.id).catch(() => {})));
        toastEvent.trigger(`Refill reminder sent to ${group.patient_name}!`, 'success');
        whatsappQueueEvent.triggerUpdated();
      }
      refillEvent.triggerRefresh();
      onActionComplete();
    } catch (e: unknown) {
      const apiErr = e as LocalApiErrorShape;
      console.error('Failed to send refill group reminder:', e);
      toastEvent.trigger(apiErr?.response?.data?.error || 'Failed to send refill reminder', 'error');
    }
  };

  const handleOrderRefillGroupToCart = (group: {
    patient_name: string;
    medicines: Array<{
      id: number;
      medicine_id: number;
      medicine_name: string;
      quantity_needed: number;
      cart_store_name?: string | null;
      status?: string;
    }>;
  }) => {
    const unadded = group.medicines.filter(m => !m.cart_store_name && m.status !== 'ordered');
    const itemsToOrder = unadded.length > 0 ? unadded : group.medicines;
    const cartInputs = itemsToOrder.map(m => ({
      refillId: m.id,
      medicineId: m.medicine_id,
      medicineName: m.medicine_name,
      qty: Math.max(1, Number(m.quantity_needed || 3))
    }));
    startRefillCartJob(group.patient_name, cartInputs);
    toastEvent.trigger(`Adding ${cartInputs.length} refill item(s) for ${group.patient_name} to Live Cart...`, 'info', '/pharmarack-cart');
  };

  const handleOrderSingleRefillMedToCart = (
    patientName: string,
    med: { id: number; medicine_id: number; medicine_name: string; quantity_needed: number }
  ) => {
    startRefillCartJob(patientName, [{
      refillId: med.id,
      medicineId: med.medicine_id,
      medicineName: med.medicine_name,
      qty: Math.max(1, Number(med.quantity_needed || 3))
    }]);
    toastEvent.trigger(`Adding "${med.medicine_name}" to Live Cart...`, 'info', '/pharmarack-cart');
  };

  const handleMarkRefillGroupOrdered = async (group: {
    patient_name: string;
    medicines: Array<{ id: number }>;
  }) => {
    const ids = group.medicines.map(m => m.id);
    setMarkingOrderedRefillIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      return next;
    });
    try {
      await Promise.all(ids.map(id => api.markRefillOrdered(id, { note: 'Manual / Phone Order' }).catch(() => {})));
      toastEvent.trigger(`Marked all refills for ${group.patient_name} as Ordered`, 'success');
      refillEvent.triggerRefresh();
      onActionComplete();
    } catch (e) {
      toastEvent.trigger('Failed to mark as ordered', 'error');
    } finally {
      setMarkingOrderedRefillIds(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
    }
  };

  const handleMarkSingleRefillMedOrdered = async (id: number, medicineName: string) => {
    setMarkingOrderedRefillIds(prev => new Set(prev).add(id));
    try {
      await api.markRefillOrdered(id, { note: 'Manual / Phone Order' });
      toastEvent.trigger(`Marked "${medicineName}" as Ordered`, 'success');
      refillEvent.triggerRefresh();
      onActionComplete();
    } catch (e) {
      toastEvent.trigger('Failed to mark as ordered', 'error');
    } finally {
      setMarkingOrderedRefillIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };


  const handleUpdateGroupStatus = async (
    group: { requester: string; phone?: string; items: Array<{ id: number; product: string; qty: number; notification_count?: number }> },
    newStatus: string,
    opts?: { navigateToPos?: boolean; resend?: boolean }
  ) => {
    // If marking ready on multiple items, open the arrival preview modal so user can review arrived vs delayed and send 1 consolidated WhatsApp
    if (newStatus === 'Ready' && group.items.length > 1) {
      setArrivalModalGroup(group);
      return;
    }

    const itemIds = group.items.map(i => i.id);

    setProcessingOrderIds(prev => {
      const next = new Set(prev);
      itemIds.forEach(id => next.add(id));
      return next;
    });

    if (newStatus === 'Completed' || newStatus === 'Cancelled') {
      setOptimisticHiddenOrderIds(prev => {
        const next = new Set(prev);
        itemIds.forEach(id => next.add(id));
        return next;
      });
    }

    try {
      const results = await Promise.all(group.items.map(i => apiClient.post(`/orders/${i.id}/status`, { status: newStatus, resend: opts?.resend })));
      const queuedCount = results.filter(r => r?.data?.whatsapp_queued).length;
      if (newStatus === 'Completed' || newStatus === 'Fulfilled') {
        toastEvent.trigger(`Marked ${group.items.length} request(s) for "${group.requester}" as Completed!`, 'success');
        if (opts?.navigateToPos) {
          const sourceOrders = (Array.isArray(specialOrders) ? specialOrders : []).filter((s) => itemIds.includes(s.id));
          const totalAdvance = sourceOrders.reduce((sum: number, s) => sum + (Number(s.advance_payment) || 0), 0);
          toastEvent.trigger(`Opening POS to bill "${group.requester}"...`, 'info', '/pos');
          navigate('/pos', {
            state: {
              prefill: {
                patientName: group.requester,
                patientPhone: group.phone || '',
                specialOrderId: group.items[0]?.id,
                advancePayment: totalAdvance,
                medicines: group.items.map(i => ({ medicineName: i.product, quantity_needed: i.qty }))
              }
            }
          });
        }
      } else if (newStatus === 'Ready') {
        if (queuedCount > 0) {
          messageSendEvent.triggerSendProgress(group.requester || group.phone || 'Customer', `Arrival alert for ${group.items[0]?.product || 'Order'}`, 10);
        }
        toastEvent.trigger(queuedCount > 0
          ? (opts?.resend
              ? `Arrival reminder WhatsApp re-queued for "${group.requester}"!`
              : `Marked ready & arrival WhatsApp queued for ${queuedCount} customer(s)!`)
          : `Marked all requests for "${group.requester}" as Ready!`, 'success');
      } else if (newStatus === 'Cancelled') {
        toastEvent.trigger(`Marked all requests for "${group.requester}" as Cancelled!`, 'success');
      } else {
        toastEvent.trigger(`Marked all requests for "${group.requester}" as ${newStatus}!`, 'success');
      }
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      specialOrdersEvent.triggerUpdated();
      window.dispatchEvent(new CustomEvent('refresh-special-orders'));
      onActionComplete();
    } catch (err: unknown) {
      console.error(`Failed to update group status to ${newStatus}:`, err);
      toastEvent.trigger('Failed to update request status', 'error');
      setOptimisticHiddenOrderIds(prev => {
        const next = new Set(prev);
        itemIds.forEach(id => next.delete(id));
        return next;
      });
    } finally {
      setProcessingOrderIds(prev => {
        const next = new Set(prev);
        itemIds.forEach(id => next.delete(id));
        return next;
      });
    }
  };

  const [sendingNotifKeys, setSendingNotifKeys] = useState<Set<string>>(new Set());

  const handleSendStagedNotificationGroup = async (group: {
    key: string;
    recipient_name: string;
    recipient_phone: string;
    consolidatedMessage: string;
    messages: Array<{ id: number; message: string; type?: string; reference_id?: string }>;
  }) => {
    if (sendingNotifKeys.has(group.key)) return;
    setSendingNotifKeys(prev => new Set(prev).add(group.key));

    try {
      const normalizeP = (p?: string | null) => (p || '').replace(/\D/g, '').slice(-10);
      const normGroupPhone = normalizeP(group.recipient_phone);
      const refillGroup = groupedActionableRefills.find(r => 
        (normGroupPhone && normalizeP(r.patient_phone) === normGroupPhone) ||
        (r.patient_name && r.patient_name.trim().toLowerCase() === group.recipient_name.trim().toLowerCase())
      );

      if (refillGroup && refillGroup.medicines.length > 0 && group.recipient_phone) {
        messageSendEvent.triggerSendProgress(group.recipient_name || 'Patient', 'Dispatching WhatsApp refill reminder...', 10);
        await api.sendGroupedRefill({
          patient_name: group.recipient_name,
          patient_phone: group.recipient_phone,
          medicines: refillGroup.medicines
        });
        whatsappQueueEvent.triggerUpdated();
      } else if (group.recipient_phone) {
        messageSendEvent.triggerSendProgress(group.recipient_name || 'Patient', 'Dispatching WhatsApp message...', 10);
        await api.enqueueSingleWhatsApp({
          number: group.recipient_phone,
          message: group.consolidatedMessage,
          type: 'refill_collection',
          targetName: group.recipient_name,
          skipDedupe: true
        });
        whatsappQueueEvent.triggerUpdated();
      }

      // Mark staged notifications as sent manually
      await Promise.all(
        group.messages.map(m =>
          api.manualNotification(m.id).catch(() => {})
        )
      );

      // Also update referenced patient_refills status
      for (const m of group.messages) {
        if (m.reference_id) {
          const ids = String(m.reference_id).split(',').map(s => Number(s.trim())).filter(Boolean);
          for (const refId of ids) {
            try {
              await apiClient.post(`/refills/${refId}/status`, { status: 'notified' });
            } catch (_) {}
          }
        }
      }

      toastEvent.trigger(`Consolidated WhatsApp message queued for ${group.recipient_name}!`, 'success');
      refillEvent.triggerRefresh();
      onRefreshDailyLog();
      onActionComplete();
    } catch (err: unknown) {
      console.error('Failed to send staged message group:', err);
      toastEvent.trigger('Failed to send WhatsApp message', 'error');
    } finally {
      setSendingNotifKeys(prev => {
        const next = new Set(prev);
        next.delete(group.key);
        return next;
      });
    }
  };

  const [optimisticDismissedIds, setOptimisticDismissedIds] = useState<Set<number>>(new Set());
  const [optimisticHiddenRefillIds, setOptimisticHiddenRefillIds] = useState<Set<number>>(new Set());

  const handleDismissStagedNotificationGroup = async (group: {
    key: string;
    messages: Array<{ id: number; reference_id?: string }>;
  }) => {
    const ids = group.messages.map(m => m.id);
    setOptimisticDismissedIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      return next;
    });

    try {
      await Promise.all(
        ids.map(id =>
          api.cancelNotification(id).catch(() => {})
        )
      );

      // Await referenced patient_refills status updates so background sync does not re-stage them
      const refIdPromises: Promise<unknown>[] = [];
      for (const m of group.messages) {
        if (m.reference_id) {
          const refIds = String(m.reference_id).split(',').map(s => Number(s.trim())).filter(Boolean);
          for (const refId of refIds) {
            refIdPromises.push(apiClient.post(`/refills/${refId}/status`, { status: 'notified' }).catch(() => {}));
          }
        }
      }
      if (refIdPromises.length > 0) {
        await Promise.all(refIdPromises);
      }

      toastEvent.trigger('Staged message dismissed', 'info');
      refillEvent.triggerRefresh();
      onRefreshDailyLog();
      onActionComplete();
    } catch (err) {
      console.error('Failed to dismiss staged notification:', err);
    }
  };

  const handleCompleteRefillGroup = async (group: { patient_name: string; patient_phone?: string; medicines: Array<{ id: number }> }) => {
    const ids = group.medicines.map(m => m.id);
    setOptimisticHiddenRefillIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      return next;
    });

    try {
      const phone = (group.patient_phone || '').trim();
      const res = await apiClient.post(`/refills/patient/${encodeURIComponent(phone || 'patient')}/fulfill-all`, {
        patient_phone: phone,
        refill_ids: ids,
        fulfilled_via: 'quick_assist'
      });

      if (res?.data?.success) {
        toastEvent.trigger(`Marked refills for ${group.patient_name} as Completed!`, 'success');
        queryClient.invalidateQueries({ queryKey: ['refills'] });
        refillEvent.triggerRefresh();
        onActionComplete();
      } else {
        throw new Error(res?.data?.error || 'Failed to complete refills');
      }
    } catch (err: unknown) {
      const apiErr = err as LocalApiErrorShape;
      console.error('Failed to complete refills:', err);
      const errMsg = apiErr?.response?.data?.error || apiErr?.message || 'Failed to complete refills';
      toastEvent.trigger(errMsg, 'error');
      setOptimisticHiddenRefillIds(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
    }
  };

  // Filter actionable refills: active, non-completed, and due within today + upcoming 7 calendar days (diffDays <= 7)
  const actionableRefills = useMemo(() => {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

    return (Array.isArray(refills) ? refills : []).filter(r => {
      if (
        r.is_active !== 1 ||
        !r.next_refill_date ||
        r.status === 'completed' ||
        r.status === 'fulfilled' ||
        r.status === 'canceled' ||
        optimisticHiddenRefillIds.has(r.id)
      ) {
        return false;
      }
      const d = new Date(r.next_refill_date);
      if (isNaN(d.getTime())) return false;
      const dueStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const diffDays = Math.round((dueStart - todayStart) / 86400000);
      return diffDays <= 7;
    });
  }, [refills, optimisticHiddenRefillIds]);

  const groupedActionableRefills = useMemo(() => {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

    const list: Array<{
      key: string;
      patient_name: string;
      patient_phone: string;
      next_refill_date: string;
      diffDays: number;
      timingCategory: 'Overdue' | 'Today' | 'Tomorrow' | 'Within 7 Days';
      hasHoldStock: boolean;
      isPatientConfirmed: boolean;
      reminder_status: 'NOT_SENT' | 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED';
      reminder_sent_at?: string | null;
      auto_remind?: number;
      collection_reminder_count?: number;
      last_collection_reminder_at?: string | null;
      medicines: Array<{
        id: number;
        medicine_id: number;
        medicine_name: string;
        quantity_needed: number;
        refill_interval_days: number;
        hold_for_stock: number;
        next_refill_date: string;
        diffDays: number;
        reminder_status: 'NOT_SENT' | 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED';
        reminder_sent_at?: string | null;
        patient_confirmed?: number;
        confirmed_at?: string | null;
        auto_remind?: number;
        collection_reminder_count?: number;
        last_collection_reminder_at?: string | null;
        cart_store_name?: string | null;
        cart_qty?: number | null;
        cart_product_code?: string | null;
        status?: string;
      }>;
    }> = [];

    const map = new Map<string, (typeof list)[0]>();

    for (const r of actionableRefills) {
      const key = (r.patient_phone || r.patient_name || String(r.id)).trim();
      const d = new Date(r.next_refill_date);
      const dueStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const diffDays = Math.round((dueStart - todayStart) / 86400000);

      let existing = map.get(key);
      if (!existing) {
        existing = {
          key,
          patient_name: r.patient_name || 'Patient',
          patient_phone: r.patient_phone || '',
          next_refill_date: r.next_refill_date,
          diffDays,
          timingCategory: diffDays < 0 ? 'Overdue' : diffDays === 0 ? 'Today' : diffDays === 1 ? 'Tomorrow' : 'Within 7 Days',
          hasHoldStock: false,
          isPatientConfirmed: false,
          reminder_status: 'NOT_SENT',
          reminder_sent_at: null,
          auto_remind: 0,
          collection_reminder_count: 0,
          last_collection_reminder_at: null,
          medicines: [],
        };
        map.set(key, existing);
        list.push(existing);
      }
      if (r.hold_for_stock === 1) existing.hasHoldStock = true;
      if ((r as any).patient_confirmed === 1) existing.isPatientConfirmed = true;
      if (r.next_refill_date && (!existing.next_refill_date || new Date(r.next_refill_date) < new Date(existing.next_refill_date))) {
        existing.next_refill_date = r.next_refill_date;
        existing.diffDays = diffDays;
        existing.timingCategory = diffDays < 0 ? 'Overdue' : diffDays === 0 ? 'Today' : diffDays === 1 ? 'Tomorrow' : 'Within 7 Days';
      }
      const medReminderStatus: 'NOT_SENT' | 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' = r.reminder_status || (r.status === 'notified' ? 'SENT' : 'NOT_SENT');
      existing.medicines.push({
        id: r.id,
        medicine_id: r.medicine_id,
        medicine_name: r.medicine_name || 'Medicine',
        quantity_needed: Number(r.quantity_needed || 3),
        refill_interval_days: r.refill_interval_days || 30,
        hold_for_stock: r.hold_for_stock || 0,
        next_refill_date: r.next_refill_date,
        diffDays,
        reminder_status: medReminderStatus,
        reminder_sent_at: r.reminder_sent_at || null,
        patient_confirmed: (r as any).patient_confirmed || 0,
        confirmed_at: (r as any).confirmed_at || null,
        auto_remind: (r as any).auto_remind ?? 0,
        collection_reminder_count: (r as any).collection_reminder_count ?? 0,
        last_collection_reminder_at: (r as any).last_collection_reminder_at || null,
        cart_store_name: r.cart_store_name || null,
        cart_qty: r.cart_qty || null,
        cart_product_code: r.cart_product_code || null,
        status: r.status,
      });
    }

    // Compute aggregate patient group reminder status & latest sent timestamp
    for (const group of list) {
      if (group.medicines.length > 0) {
        if (group.medicines.every(m => m.reminder_status === 'SENT')) {
          group.reminder_status = 'SENT';
          const sentDates = group.medicines.map(m => m.reminder_sent_at).filter(Boolean);
          group.reminder_sent_at = sentDates.length > 0 ? (sentDates as string[]).sort().reverse()[0] : null;
        } else if (group.medicines.some(m => m.reminder_status === 'SENDING')) {
          group.reminder_status = 'SENDING';
        } else if (group.medicines.some(m => m.reminder_status === 'QUEUED')) {
          group.reminder_status = 'QUEUED';
        } else if (group.medicines.some(m => m.reminder_status === 'FAILED')) {
          group.reminder_status = 'FAILED';
        } else {
          group.reminder_status = 'NOT_SENT';
        }

        group.auto_remind = group.medicines.some(m => m.auto_remind === 1) ? 1 : 0;
        group.collection_reminder_count = Math.max(0, ...group.medicines.map(m => m.collection_reminder_count || 0));
        const collDates = group.medicines.map(m => m.last_collection_reminder_at).filter(Boolean) as string[];
        group.last_collection_reminder_at = collDates.length > 0 ? collDates.sort().reverse()[0] : null;
      }
    }

    // Sort by diffDays ascending (most urgent first)
    list.sort((a, b) => a.diffDays - b.diffDays);
    return list;
  }, [actionableRefills]);

  const formatReminderSentAt = (sentAtStr?: string | null) => {
    if (!sentAtStr) return '';
    try {
      const d = new Date(sentAtStr);
      if (isNaN(d.getTime())) return sentAtStr;
      return d.toLocaleDateString([], { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      return sentAtStr;
    }
  };

  // Distinguish Online Orders (website + WhatsApp) from Local In-Store Special Requests
  const isWebsiteOrder = isOnlineOrder;

  // Group active special orders by requester
  const activeSpecialOrders = useMemo(() => {
    return Array.isArray(specialOrders)
      ? specialOrders.filter(s => s.status !== 'Completed' && s.status !== 'Fulfilled' && s.status !== 'Cancelled' && !optimisticHiddenOrderIds.has(s.id))
      : [];
  }, [specialOrders, optimisticHiddenOrderIds]);

  const activeWebsiteOrders = useMemo(() => {
    return activeSpecialOrders.filter(isWebsiteOrder);
  }, [activeSpecialOrders]);

  const activeLocalSpecialOrders = useMemo(() => {
    return activeSpecialOrders.filter(o => !isWebsiteOrder(o));
  }, [activeSpecialOrders]);

  const groupedWebsiteOrders = useMemo(() => {
    const list: Array<{
      key: string;
      requester: string;
      phone: string;
      overallStatus: string;
      deliveryMode: string;
      paymentMethod: string;
      address: string;
      items: Array<{
        id: number;
        product: string;
        qty: number;
        status: string;
        priority: string;
        notification_count?: number;
        notes?: string;
      }>;
    }> = [];

    const map = new Map<string, (typeof list)[0]>();

    for (const order of activeWebsiteOrders) {
      const key = (order.phone || order.requester || String(order.id)).trim();
      let existing = map.get(key);
      if (!existing) {
        const notes = order.notes || '';
        const isDeliv = (order as any).delivery_status === 'pending_dispatch' || notes.includes('Home Delivery');
        const isCOD = notes.includes('COD');
        const isUPI = notes.includes('UPI');
        const addrMatch = notes.match(/Delivery Address:\s*([^.]+)/i) || notes.match(/Address:\s*([^.]+)/i);
        existing = {
          key,
          requester: order.requester || ((order as any).customer_order_source === 'whatsapp' ? 'WhatsApp Customer' : 'Website Customer'),
          phone: order.phone || '',
          overallStatus: order.status || 'Pending',
          deliveryMode: isDeliv ? 'Home Delivery' : 'In-Store Pickup',
          paymentMethod: isCOD ? 'COD' : isUPI ? 'UPI' : 'Pay at Counter',
          address: addrMatch ? addrMatch[1].trim() : '',
          items: [],
        };
        map.set(key, existing);
        list.push(existing);
      }
      existing.items.push({
        id: order.id,
        product: order.product || 'Item',
        qty: Number(order.qty || 1),
        status: order.status || 'Pending',
        priority: order.priority || 'Normal',
        notification_count: Number((order as any).notification_count || 0),
        notes: order.notes,
      });
    }

    for (const g of list) {
      if (g.items.some(i => i.status === 'Pending')) g.overallStatus = 'Pending';
      else if (g.items.some(i => i.status === 'Ordered')) g.overallStatus = 'Ordered';
      else if (g.items.some(i => i.status === 'Ready')) g.overallStatus = 'Ready';
      else if (g.items.some(i => i.status === 'Confirmed')) g.overallStatus = 'Confirmed';
      else if (g.items.some(i => i.status === 'Waiting')) g.overallStatus = 'Waiting';
      else g.overallStatus = g.items[0]?.status || 'Other';
    }

    return list;
  }, [activeWebsiteOrders]);

  const groupedSpecialOrders = useMemo(() => {
    const list: Array<{
      key: string;
      requester: string;
      phone: string;
      overallStatus: string;
      auto_remind?: number;
      collection_reminder_count?: number;
      last_collection_reminder_at?: string | null;
      items: Array<{
        id: number;
        product: string;
        qty: number;
        status: string;
        priority: string;
        notification_count?: number;
        auto_remind?: number;
        collection_reminder_count?: number;
        last_collection_reminder_at?: string | null;
      }>;
    }> = [];

    const map = new Map<string, (typeof list)[0]>();

    for (const order of activeLocalSpecialOrders) {
      const key = (order.phone || order.requester || String(order.id)).trim();
      let existing = map.get(key);
      if (!existing) {
        existing = {
          key,
          requester: order.requester || 'Customer',
          phone: order.phone || '',
          overallStatus: order.status || 'Pending',
          auto_remind: 0,
          collection_reminder_count: 0,
          last_collection_reminder_at: null,
          items: [],
        };
        map.set(key, existing);
        list.push(existing);
      }
      existing.items.push({
        id: order.id,
        product: order.product || 'Item',
        qty: Number(order.qty || 1),
        status: order.status || 'Pending',
        priority: order.priority || 'Normal',
        notification_count: Number((order as any).notification_count || 0),
        auto_remind: Number(order.auto_remind || 0),
        collection_reminder_count: Number(order.collection_reminder_count || 0),
        last_collection_reminder_at: order.last_collection_reminder_at || null,
      });
    }

    for (const g of list) {
      if (g.items.some(i => i.status === 'Pending')) g.overallStatus = 'Pending';
      else if (g.items.some(i => i.status === 'Ordered')) g.overallStatus = 'Ordered';
      else if (g.items.some(i => i.status === 'Ready')) g.overallStatus = 'Ready';
      else g.overallStatus = 'Other';

      g.auto_remind = g.items.some(i => i.auto_remind === 1) ? 1 : 0;
      g.collection_reminder_count = Math.max(0, ...g.items.map(i => i.collection_reminder_count || 0));
      const collDates = g.items.map(i => i.last_collection_reminder_at).filter(Boolean) as string[];
      g.last_collection_reminder_at = collDates.length > 0 ? collDates.sort().reverse()[0] : null;
    }

    return list;
  }, [activeLocalSpecialOrders]);

  const groupedNotifications = useMemo(() => {
    if (!Array.isArray(notifications)) return [];
    const map = new Map<string, {
      key: string;
      recipient_name: string;
      recipient_phone: string;
      messages: Array<{ id: number; message: string; type?: string; reference_id?: string }>;
      consolidatedMessage: string;
    }>();

    const normalizePhone = (p?: string | null) => (p || '').replace(/\D/g, '').slice(-10);

    // 7-Day Rule: Collect normalized patient phones & lowercased names for actionable refills (due within 7 days) and active special requests
    const active7DayPhoneSet = new Set<string>();
    const active7DayNameSet = new Set<string>();

    for (const r of groupedActionableRefills) {
      const normP = normalizePhone(r.patient_phone);
      if (normP) active7DayPhoneSet.add(normP);
      if (r.patient_name) active7DayNameSet.add(r.patient_name.trim().toLowerCase());
    }
    for (const s of groupedSpecialOrders) {
      const normP = normalizePhone(s.phone);
      if (normP) active7DayPhoneSet.add(normP);
      if (s.requester) active7DayNameSet.add(s.requester.trim().toLowerCase());
    }

    for (const notif of notifications) {
      if (optimisticDismissedIds.has(notif.id)) continue;

      const notifPhoneNorm = normalizePhone(notif.recipient_phone);
      const notifNameNorm = (notif.recipient_name || '').trim().toLowerCase();

      // Enforce strict upcoming 7-day rule: ONLY display staged messages for patients with active 7-day refills or special requests
      const has7DayMatch = (notifPhoneNorm && active7DayPhoneSet.has(notifPhoneNorm)) || (notifNameNorm && active7DayNameSet.has(notifNameNorm));
      if (!has7DayMatch) {
        continue;
      }

      const key = (notif.recipient_phone || notif.recipient_name || String(notif.id)).trim();
      let existing = map.get(key);
      if (!existing) {
        existing = {
          key,
          recipient_name: notif.recipient_name || 'Customer',
          recipient_phone: notif.recipient_phone || '',
          messages: [],
          consolidatedMessage: notif.message || ''
        };
        map.set(key, existing);
      }
      existing.messages.push({
        id: notif.id,
        message: notif.message,
        type: notif.type,
        reference_id: notif.reference_id
      });
      if (notif.message && notif.message.length >= existing.consolidatedMessage.length) {
        existing.consolidatedMessage = notif.message;
      }
    }

    // Merge full multi-medicine lists for any refill patients whose stored message is only partial
    for (const group of map.values()) {
      const normP = normalizePhone(group.recipient_phone);
      const refillGroup = groupedActionableRefills.find(r => 
        (normP && normalizePhone(r.patient_phone) === normP) ||
        (r.patient_name && r.patient_name.trim().toLowerCase() === group.recipient_name.trim().toLowerCase())
      );
      if (refillGroup && refillGroup.medicines.length > 0) {
        const missingSomeMeds = refillGroup.medicines.some(m => !group.consolidatedMessage.toLowerCase().includes(m.medicine_name.toLowerCase()));
        if (missingSomeMeds || refillGroup.medicines.length > 1) {
          const medList = refillGroup.medicines.map(m => `• ${m.medicine_name} (Qty: ${m.quantity_needed})`).join('\n');
          group.consolidatedMessage = `🔔 *MEDICINE REFILL REMINDER*\n\nDear ${group.recipient_name},\nYour regular prescription is due for refill:\n\n${medList}\n\n👉 *Reply "REFILL" or "YES" to confirm.*`;
        }
      }
    }

    return Array.from(map.values());
  }, [notifications, optimisticDismissedIds, groupedActionableRefills, groupedSpecialOrders]);

  if (!expanded) {
    const activeRefillsCount = groupedActionableRefills.length;
    const activeWebsiteOrdersCount = groupedWebsiteOrders.length;
    const activeSpecialOrdersCount = groupedSpecialOrders.length;
    const stagedNotificationsCount = groupedNotifications.length;

    return (
      <div
        onClick={() => {
          setEditingGroup(null);
          setArrivalModalGroup(null);
          setExpanded(true);
        }}
        className="w-10 h-full min-h-0 overflow-hidden bg-bg2 border-l border-border flex flex-col items-center py-4 gap-4 hover:bg-bg3 hover:text-text transition-all duration-200 cursor-pointer shrink-0 z-20 select-none"
        title="Expand Quick Assist"
      >
        <ChevronLeftIcon size={16} className="text-muted mt-1" />

        {/* Distinct Category Count Badges at TOP */}
        <div className="flex flex-col gap-1.5 items-center mt-1">
          {/* 1. Refills Due Soon (Purple) */}
          {activeRefillsCount > 0 && (
            <div
              className="flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-purple-500/15 text-purple-300 text-[9px] font-black border border-purple-500/30 shadow-sm"
              title={`Refills Due Soon: ${activeRefillsCount} patient(s)`}
            >
              {activeRefillsCount}
            </div>
          )}

          {/* 2. Online Orders — website + WhatsApp (Cyan) */}
          {activeWebsiteOrdersCount > 0 && (
            <div
              className="flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-cyan-500/15 text-cyan-300 text-[9px] font-black border border-cyan-500/30 shadow-sm animate-pulse"
              title={`Online Orders: ${activeWebsiteOrdersCount} customer(s)`}
            >
              {activeWebsiteOrdersCount}
            </div>
          )}

          {/* 3. Quick Special Requests (Amber) */}
          {activeSpecialOrdersCount > 0 && (
            <div
              className="flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-amber-500/15 text-amber-300 text-[9px] font-black border border-amber-500/30 shadow-sm"
              title={`Quick Special Requests: ${activeSpecialOrdersCount} customer(s)`}
            >
              {activeSpecialOrdersCount}
            </div>
          )}

          {/* 4. Staged Messages / Notifications (Emerald) */}
          {stagedNotificationsCount > 0 && (
            <div
              className="flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-emerald-500/15 text-emerald-300 text-[9px] font-black border border-emerald-500/30 shadow-sm"
              title={`Staged Messages: ${stagedNotificationsCount}`}
            >
              {stagedNotificationsCount}
            </div>
          )}

          {/* 5. Images Needing Review (Sky Blue) */}
          {imageReviewCount > 0 && (
            <div
              className="flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-sky-500/15 text-sky-300 text-[9px] font-black border border-sky-500/30 shadow-sm"
              title={`Images Needing Review: ${imageReviewCount}`}
            >
              {imageReviewCount}
            </div>
          )}
        </div>

        <div
          style={{ writingMode: 'vertical-rl' }}
          className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-purple-300 my-auto"
        >
          <ActivityIcon size={12} className="rotate-90 shrink-0 text-purple-500" />
          <span>Quick Assist</span>
        </div>
      </div>
    );
  }

  return (
    <div ref={sidebarRef} className="w-80 max-w-[85vw] bg-bg border-l border-border flex flex-col h-full min-h-0 overflow-hidden shrink-0 z-20 transition-all duration-300">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between shrink-0 bg-bg2/80 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <ActivityIcon size={16} className="text-purple-500 shrink-0" />
          <span className="text-sm font-bold text-text uppercase tracking-wider truncate">Quick Assist</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleMasterAutoRemind}
            className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all border flex items-center gap-1 cursor-pointer shadow-xs ${
              autoRemindMaster
                ? 'bg-purple-500/20 text-purple-300 border-purple-500/40 hover:bg-purple-500/30'
                : 'bg-bg3 text-muted border-border hover:text-text'
            }`}
            title={
              autoRemindMaster
                ? 'Auto Remind Master: ON (Sending daily 10 AM - 6 PM). Click to pause globally.'
                : 'Auto Remind Master: PAUSED. Click to enable globally.'
            }
          >
            <Zap size={10} className={autoRemindMaster ? 'text-purple-400 fill-purple-400' : 'text-muted'} />
            <span>{autoRemindMaster ? 'Auto ON' : 'Auto OFF'}</span>
          </button>
          <button
            onClick={() => {
              setExpanded(false);
            }}
            className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-all cursor-pointer shrink-0"
            title="Collapse"
          >
            <ChevronRightIcon size={16} />
          </button>
        </div>
      </div>

      {/* Main content scroll */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-6 scrollbar-thin bg-bg">
        {/* Actionable Refills (Due within 7 Calendar Days) */}
        <div>
          <div className="flex items-center justify-between mb-2 text-xs font-bold uppercase tracking-wider text-purple-300">
            <div className="flex items-center gap-1.5">
              <BellRing size={13} className="text-purple-500" />
              <span>Refills Due Soon ({groupedActionableRefills.length})</span>
            </div>
            <button
              onClick={() => navigate('/crm?tab=refills')}
              className="text-[9px] font-black text-sky-300 hover:underline uppercase tracking-widest cursor-pointer"
            >
              Manage
            </button>
          </div>
          {groupedActionableRefills.length === 0 ? (
            <p className="text-xs text-muted/60 italic pl-2 py-1">No refills due within 7 days</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {groupedActionableRefills.map(group => {
                const isExpanded = expandedRefillKeys.has(group.key);
                const timingBadge = group.timingCategory === 'Overdue' ? (
                  <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/25 text-[9px] font-mono font-bold">
                    Overdue ({Math.abs(group.diffDays)}d)
                  </span>
                ) : group.timingCategory === 'Today' ? (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 text-[9px] font-mono font-bold">
                    Today
                  </span>
                ) : group.timingCategory === 'Tomorrow' ? (
                  <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/25 text-[9px] font-mono font-bold">
                    Tomorrow
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/25 text-[9px] font-mono font-bold">
                    In {group.diffDays}d
                  </span>
                );

                return (
                  <div key={group.key} className="p-3 rounded-xl bg-bg2 border border-border flex flex-col gap-2 shadow-xs min-w-0 overflow-hidden transition-all hover:border-purple-500/30">
                    {/* Patient Header (Click to toggle expansion / fold & unfold) */}
                    <div
                      onClick={() => toggleRefillKey(group.key)}
                      className="flex items-start justify-between gap-1.5 min-w-0 cursor-pointer select-none"
                    >
                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                          <span className="font-semibold text-xs text-text truncate">{group.patient_name}</span>
                          <span className="px-1.5 py-0.2 rounded-full bg-purple-500/15 text-purple-300 text-[9px] font-bold shrink-0 border border-purple-500/20">
                            {group.medicines.length} med{group.medicines.length > 1 ? 's' : ''}
                          </span>
                          {timingBadge}
                          {group.isPatientConfirmed && (
                            <span
                              className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[9px] font-bold shrink-0 flex items-center gap-0.5 animate-pulse"
                              title="Patient confirmed via WhatsApp!"
                            >
                              Confirmed via WhatsApp ✅
                            </span>
                          )}
                        </div>
                        {group.patient_phone && (
                          <span className="text-[10px] text-muted truncate font-mono">{group.patient_phone}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {group.hasHoldStock && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[8px] font-bold uppercase tracking-wider animate-pulse shrink-0">
                            Hold Stock
                          </span>
                        )}
                        <ChevronDown size={14} className={`text-muted transition-transform duration-200 ${isExpanded ? 'rotate-180 text-purple-500' : ''}`} />
                      </div>
                    </div>

                    {/* Unfolded Medicine Names: shows only medicine names with cart status / order buttons */}
                    {isExpanded && (
                      <div className="flex flex-col gap-1.5 pt-1 border-t border-border">
                        {group.medicines.map((med) => {
                          const isMedInCart = !!med.cart_store_name || med.status === 'ordered';
                          const isMarkingThisMed = markingOrderedRefillIds.has(med.id);
                          return (
                            <div
                              key={med.id}
                              className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-bg3/80 border border-border text-[11px] min-w-0"
                            >
                              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                <Package size={11} className="text-purple-500 shrink-0" />
                                <span className="font-medium text-text truncate">{med.medicine_name}</span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/20 text-[10px] font-mono font-bold">
                                  Qty: {med.quantity_needed}
                                </span>
                                <span className="text-[9px] text-muted">{med.refill_interval_days}d</span>
                                {isMedInCart ? (
                                  <span
                                    className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[9px] font-bold flex items-center gap-1"
                                    title={`In Cart / Ordered: ${med.cart_store_name || 'Ordered'}${med.cart_qty ? ` (Qty ${med.cart_qty})` : ''}`}
                                  >
                                    <Check size={9} className="text-emerald-500" />
                                    <span className="truncate max-w-[80px]">{med.cart_store_name || 'In Cart'}</span>
                                  </span>
                                ) : (
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleOrderSingleRefillMedToCart(group.patient_name, med);
                                      }}
                                      className="py-0.5 px-1.5 rounded bg-primary hover:bg-primary/90 text-white text-[9px] font-bold transition-all flex items-center gap-0.5 cursor-pointer shadow-xs active:scale-95"
                                      title={`Order "${med.medicine_name}" to Live Cart`}
                                    >
                                      <ShoppingCart size={9} />
                                      <span>+ Cart</span>
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isMarkingThisMed}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleMarkSingleRefillMedOrdered(med.id, med.medicine_name);
                                      }}
                                      className="py-0.5 px-1.5 rounded bg-bg2 hover:bg-emerald-600 hover:text-white text-muted border border-border text-[9px] font-bold transition-all flex items-center gap-0.5 cursor-pointer disabled:opacity-50"
                                      title={`Mark "${med.medicine_name}" as manually ordered outside Pharmarack`}
                                    >
                                      {isMarkingThisMed ? <Loader2 size={9} className="animate-spin" /> : <Check size={9} />}
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Patient Card Actions & Reminder Status Footer — 2-Tier Layout */}
                    <div className="flex flex-col gap-1.5 pt-1.5 border-t border-border min-w-0">
                      {/* Tier 1: Cart Ordering & Billing Actions */}
                      <div className="flex items-center gap-1.5 min-w-0">
                        {(() => {
                          const isPatientJobRunning = cartJobs.some(j => j.patientName === group.patient_name && isRefillJobRunning(j));
                          const unaddedMeds = group.medicines.filter(m => !m.cart_store_name && m.status !== 'ordered');
                          const allInCart = group.medicines.length > 0 && unaddedMeds.length === 0;
                          const isMarkingGroup = group.medicines.some(m => markingOrderedRefillIds.has(m.id));

                          if (isPatientJobRunning) {
                            return (
                              <div className="flex-1 py-1 px-2 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-400 text-[10px] font-bold flex items-center justify-center gap-1.5 animate-pulse truncate">
                                <Loader2 size={11} className="animate-spin shrink-0 text-sky-400" />
                                <span className="truncate">Adding to Cart...</span>
                              </div>
                            );
                          }

                          if (allInCart) {
                            const firstStore = group.medicines.find(m => m.cart_store_name)?.cart_store_name;
                            return (
                              <div
                                className="flex-1 py-1 px-2.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold flex items-center justify-center gap-1.5 truncate"
                                title={`All medicines are in cart / ordered (${firstStore || 'Ordered'})`}
                              >
                                <Check size={11} className="text-emerald-500 shrink-0" />
                                <span className="truncate">✓ In Cart{firstStore ? `: ${firstStore}` : ''}</span>
                              </div>
                            );
                          }

                          return (
                            <>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOrderRefillGroupToCart(group);
                                }}
                                className="flex-1 py-1 px-2.5 rounded-lg bg-primary hover:bg-primary/90 text-white text-[10px] font-bold transition-all flex items-center justify-center gap-1 shadow-xs cursor-pointer active:scale-95 truncate"
                                title="Add un-added medicines to Pharmarack Live Cart in the background"
                              >
                                <ShoppingCart size={11} className="shrink-0" />
                                <span className="truncate">Order to Cart{unaddedMeds.length < group.medicines.length ? ` (${unaddedMeds.length})` : ''}</span>
                              </button>
                              <button
                                type="button"
                                disabled={isMarkingGroup}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMarkRefillGroupOrdered(group);
                                }}
                                className="py-1 px-2 rounded-lg bg-bg3 hover:bg-emerald-600 hover:text-white text-muted border border-border text-[9px] font-bold uppercase transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50 shrink-0"
                                title="Mark as manually ordered via phone or outside Pharmarack (stops prompt without calling Pharmarack)"
                              >
                                {isMarkingGroup ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                                <span>Mark Ordered</span>
                              </button>
                            </>
                          );
                        })()}

                        {group.hasHoldStock && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAcknowledgeAll(group.medicines);
                            }}
                            className="py-1 px-2 rounded bg-amber-600 hover:bg-amber-700 text-white text-[9px] font-black tracking-wide uppercase transition-colors shadow-sm cursor-pointer shrink-0"
                            title="Mark all held items as checked / resolved"
                          >
                            Ack
                          </button>
                        )}
                        {group.isPatientConfirmed && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toastEvent.trigger(`Opening POS to bill refills for "${group.patient_name}"...`, 'info', '/pos');
                              navigate('/pos', {
                                state: {
                                  prefill: {
                                    patientName: group.patient_name,
                                    patientPhone: group.patient_phone,
                                    refillPatient: true,
                                    refillIds: group.medicines.map(m => m.id),
                                    medicines: group.medicines.map(m => ({
                                      id: m.id,
                                      medicine_id: m.medicine_id,
                                      medicineName: m.medicine_name,
                                      medicine_name: m.medicine_name,
                                      quantity_needed: m.quantity_needed
                                    }))
                                  }
                                }
                              });
                            }}
                            className="py-1 px-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-bold uppercase transition-colors flex items-center gap-1 shadow-sm cursor-pointer shrink-0"
                            title={`Load ${group.patient_name}'s confirmed refill items into POS for manual verification and billing`}
                          >
                            <ShoppingCart size={10} />
                            <span>Bill in POS</span>
                          </button>
                        )}
                      </div>

                      {/* Tier 2: Communications & Lifecycle Actions */}
                      <div className="flex items-center gap-2 justify-between min-w-0 pt-0.5">
                        <div className="flex items-center gap-1 text-[9px] text-muted font-medium truncate">
                          <ClockIcon size={10} className="shrink-0" />
                          <span className="truncate">
                            Due: {group.next_refill_date ? new Date(group.next_refill_date).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'N/A'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                          {/* 1-Click Manual ↔ Auto Collection Reminder Chip */}
                          {(() => {
                            const isAutoArmed = optimisticAutoRemindPhones.has(group.patient_phone)
                              ? optimisticAutoRemindPhones.get(group.patient_phone)
                              : (group as any).auto_remind === 1;
                            const collCount = (group as any).collection_reminder_count || 0;
                            return (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleTogglePatientAutoRemind(group.patient_phone, !isAutoArmed);
                                }}
                                className={`py-0.5 px-2 rounded-full text-[9px] font-bold uppercase tracking-wider transition-all flex items-center gap-1 cursor-pointer border shrink-0 ${
                                  isAutoArmed
                                    ? 'bg-purple-500/15 text-purple-300 border-purple-500/30 hover:bg-purple-500/25'
                                    : 'bg-bg3 text-muted hover:text-text border-border'
                                }`}
                                title={
                                  isAutoArmed
                                    ? `Auto collection reminder is ACTIVE (${collCount} sent). Daily follow-up 10 AM - 6 PM until sold in POS. Click to switch to Manual.`
                                    : 'Manual mode: automatic follow-ups disabled. Click to arm Auto Remind.'
                                }
                              >
                                <Zap size={9} className={isAutoArmed ? 'text-purple-400 fill-purple-400' : 'text-muted'} />
                                <span>{isAutoArmed ? `Auto ON${collCount > 0 ? ` (${collCount}x)` : ''}` : 'Manual'}</span>
                              </button>
                            );
                          })()}

                          {group.reminder_status === 'SENT' ? (
                            <div
                              className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[9px] font-bold shrink-0"
                              title={`Reminder sent on ${formatReminderSentAt(group.reminder_sent_at)}`}
                            >
                              <Check size={10} className="text-emerald-500" />
                              <span>Sent ✓</span>
                            </div>
                          ) : group.reminder_status === 'QUEUED' ? (
                            <div
                              className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[9px] font-bold shrink-0"
                              title="Reminder queued in WhatsApp dispatch queue"
                            >
                              <ClockIcon size={10} className="text-amber-500" />
                              <span>Queued ⏳</span>
                            </div>
                          ) : group.reminder_status === 'SENDING' ? (
                            <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-sky-300 text-[9px] font-bold shrink-0">
                              <Loader2 size={10} className="animate-spin text-sky-500" />
                              <span>Sending 📡</span>
                            </div>
                          ) : group.reminder_status === 'FAILED' ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSendRefillGroup(group);
                              }}
                              className="py-0.5 px-2 rounded bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 text-[9px] font-bold uppercase transition-colors flex items-center gap-1 shadow-sm cursor-pointer"
                              title="Reminder failed to send — click to retry"
                            >
                              <AlertIcon size={10} />
                              <span>Retry</span>
                            </button>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSendRefillGroup(group);
                              }}
                              className="py-0.5 px-2 rounded bg-purple-600 hover:bg-purple-700 text-white text-[9px] font-bold uppercase transition-colors flex items-center gap-1 shadow-sm cursor-pointer"
                              title={`Send WhatsApp reminder to ${group.patient_name}`}
                            >
                              <SendIcon size={10} />
                              <span>Send</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCompleteRefillGroup(group);
                            }}
                            className="py-0.5 px-2 rounded bg-bg3 hover:bg-emerald-600 hover:text-white text-muted border border-border text-[9px] font-bold uppercase transition-colors flex items-center gap-1 cursor-pointer"
                            title={`Mark all refills for ${group.patient_name} as Completed`}
                          >
                            <Check size={10} />
                            <span>Complete All</span>
                          </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingGroup({
                              type: 'refill',
                              title: 'Edit Refill Schedule',
                              customerName: group.patient_name,
                              customerPhone: group.patient_phone || '',
                              items: group.medicines.map(m => ({
                                id: m.id,
                                product: m.medicine_name,
                                qty: m.quantity_needed,
                                interval_days: m.refill_interval_days,
                                hold_for_stock: m.hold_for_stock,
                                next_refill_date: m.next_refill_date
                              }))
                            });
                          }}
                          className="py-0.5 px-2 rounded bg-bg3 hover:bg-sky-600 hover:text-white text-muted border border-border text-[9px] font-bold uppercase transition-colors flex items-center gap-1 cursor-pointer"
                          title={`Edit refill details for ${group.patient_name}`}
                        >
                          <Edit3 size={10} />
                          <span>Edit</span>
                        </button>
                      </div>
                    </div>
                  </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Online Orders — website + WhatsApp */}
        <div>
          <div className="flex items-center justify-between mb-2 text-xs font-bold uppercase tracking-wider text-cyan-300">
            <div className="flex items-center gap-1.5">
              <Globe size={14} className="text-cyan-400" />
              <span>Online Orders ({groupedWebsiteOrders.length})</span>
            </div>
            <button
              onClick={() => navigate('/website-orders')}
              className="text-[9px] font-black text-cyan-300 hover:underline uppercase tracking-widest cursor-pointer"
            >
              Online Orders
            </button>
          </div>
          {groupedWebsiteOrders.length === 0 ? (
            <p className="text-xs text-muted/60 italic pl-2 py-1">No pending online orders</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {groupedWebsiteOrders.map(group => {
                const isExpanded = expandedWebsiteOrderKeys.has(group.key);
                const isProcessing = group.items.some(i => processingOrderIds.has(i.id));

                return (
                  <div
                    key={group.key}
                    className={`p-3 rounded-xl border flex flex-col gap-2 transition-all min-w-0 overflow-hidden shadow-xs ${
                      group.overallStatus === 'Ready'
                        ? 'bg-sky-500/[0.06] border-sky-500/30'
                        : group.overallStatus === 'Confirmed'
                        ? 'bg-emerald-500/[0.06] border-emerald-500/30'
                        : group.overallStatus === 'Ordered'
                        ? 'bg-indigo-500/[0.06] border-indigo-500/30'
                        : 'bg-cyan-500/[0.06] border-cyan-500/30'
                    }`}
                  >
                    {/* Header (Click to toggle expansion / fold & unfold) */}
                    <div
                      onClick={() => toggleWebsiteOrderKey(group.key)}
                      className="flex items-start justify-between gap-1.5 min-w-0 cursor-pointer select-none"
                    >
                      <div className="flex flex-col min-w-0 flex-1">
                        {/* Medicine Name & Qty directly visible */}
                        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                          <span className="font-bold text-xs text-text truncate" title={group.items[0]?.product || 'Medicine'}>
                            {group.items[0]?.product || 'Medicine'}
                          </span>
                          {group.items.length > 1 ? (
                            <span className="px-1.5 py-0.2 rounded-full bg-cyan-500/15 text-cyan-300 text-[9px] font-bold shrink-0 border border-cyan-500/20">
                              +{group.items.length - 1} more
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.2 rounded-full bg-cyan-500/15 text-cyan-300 text-[9px] font-mono font-bold shrink-0 border border-cyan-500/20">
                              Qty: {group.items[0]?.qty || 1}
                            </span>
                          )}
                          <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold shrink-0 border ${
                            group.deliveryMode === 'Home Delivery'
                              ? 'bg-amber-500/15 text-amber-300 border-amber-500/25'
                              : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25'
                          }`}>
                            {group.deliveryMode}
                          </span>
                        </div>
                        {/* Customer, Phone, Payment & Address */}
                        <div className="flex items-center gap-1 text-[10px] text-muted truncate mt-0.5">
                          <span className="font-semibold text-text truncate">{group.requester}</span>
                          {group.phone && <span className="font-mono">• {group.phone}</span>}
                          <span>• {group.paymentMethod}</span>
                          {group.address && <span className="truncate" title={group.address}>• {group.address}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase ${
                            group.overallStatus === 'Ready'
                              ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                              : group.overallStatus === 'Confirmed'
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : group.overallStatus === 'Ordered'
                              ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
                              : 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                          }`}
                        >
                          {group.overallStatus}
                        </span>
                        <ChevronDown size={14} className={`text-muted transition-transform duration-200 ${isExpanded ? 'rotate-180 text-cyan-400' : ''}`} />
                      </div>
                    </div>

                    {/* Unfolded Medicine Names */}
                    {isExpanded && (
                      <div className="flex flex-col gap-1.5 pt-1 border-t border-border">
                        {group.items.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-bg2 border border-border text-[11px] min-w-0"
                          >
                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                              <Package size={11} className="text-cyan-400 shrink-0" />
                              <span className="font-medium text-text truncate">{item.product}</span>
                            </div>
                            <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/20 text-[10px] font-mono font-bold shrink-0">
                              Qty: {item.qty}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Action Buttons Footer */}
                    <div className="flex items-center flex-wrap gap-1.5 pt-1 border-t border-border min-w-0">
                      {group.overallStatus !== 'Ready' && (
                        <button
                          disabled={isProcessing}
                          onClick={() => handleUpdateGroupStatus(group, 'Ready')}
                          className="flex-1 py-1 px-2 rounded bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-[10px] font-bold tracking-wide uppercase transition-colors flex items-center justify-center gap-1 shadow-sm cursor-pointer whitespace-nowrap min-w-0"
                          title="Mark ready and queue WhatsApp alert to customer"
                        >
                          {isProcessing ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                          Mark Ready
                        </button>
                      )}
                      <button
                        disabled={isProcessing}
                        onClick={() => handleUpdateGroupStatus(group, 'Completed', { navigateToPos: true })}
                        className="flex-1 py-1 px-2 rounded bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-[10px] font-bold tracking-wide uppercase transition-colors flex items-center justify-center gap-1 shadow-sm cursor-pointer whitespace-nowrap min-w-0"
                        title="Complete order and open POS prefilled with customer & medicines"
                      >
                        {isProcessing ? <Loader2 size={11} className="animate-spin" /> : <ShoppingCart size={11} />}
                        Bill in POS
                      </button>
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingGroup({
                            type: 'website_order',
                            title: 'Edit Website Order',
                            customerName: group.requester,
                            customerPhone: group.phone || '',
                            items: group.items.map(i => ({
                              id: i.id,
                              product: i.product,
                              qty: i.qty,
                              status: i.status,
                              priority: i.priority,
                              notes: i.notes || ''
                            }))
                          });
                        }}
                        className="py-1 px-2 rounded bg-bg3 hover:bg-sky-600 hover:text-white text-muted border border-border disabled:opacity-50 text-[10px] font-bold tracking-wide uppercase transition-colors flex items-center justify-center gap-1 cursor-pointer shrink-0"
                        title="Edit website order details"
                      >
                        <Edit3 size={11} />
                        <span>Edit</span>
                      </button>
                      <button
                        disabled={isProcessing}
                        onClick={() => handleUpdateGroupStatus(group, 'Cancelled')}
                        className="py-1 px-2 rounded bg-bg3 hover:bg-red-600 hover:text-white text-muted border border-border disabled:opacity-50 text-[10px] font-bold tracking-wide uppercase transition-colors flex items-center justify-center gap-1 cursor-pointer shrink-0"
                        title="Cancel this website order"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick Special Requests */}
        <div>
          <div className="flex items-center justify-between mb-2 text-xs font-bold uppercase tracking-wider text-amber-300">
            <div className="flex items-center gap-1.5">
              <Package size={14} className="text-amber-500" />
              <span>Quick Special Requests ({groupedSpecialOrders.length})</span>
            </div>
            <button
              onClick={() => navigate('/crm?tab=special_orders')}
              className="text-[9px] font-black text-amber-300 hover:underline uppercase tracking-widest cursor-pointer"
            >
              View All
            </button>
          </div>
          {groupedSpecialOrders.length === 0 ? (
            <p className="text-xs text-muted/60 italic pl-2 py-1">No active special requests</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {groupedSpecialOrders.map(group => {
                const isExpanded = expandedSpecialOrderKeys.has(group.key);
                const isProcessing = group.items.some(i => processingOrderIds.has(i.id));

                return (
                  <div
                    key={group.key}
                    className={`p-3 rounded-xl border flex flex-col gap-2 transition-all min-w-0 overflow-hidden shadow-xs ${
                      group.overallStatus === 'Ready'
                        ? 'bg-sky-500/[0.06] border-sky-500/30'
                        : group.overallStatus === 'Ordered'
                        ? 'bg-emerald-500/[0.06] border-emerald-500/30'
                        : 'bg-amber-500/[0.06] border-amber-500/30'
                    }`}
                  >
                    {/* Header (Click to toggle expansion / fold & unfold) */}
                    <div
                      onClick={() => toggleSpecialOrderKey(group.key)}
                      className="flex items-start justify-between gap-1.5 min-w-0 cursor-pointer select-none"
                    >
                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-bold text-xs text-text truncate" title={group.items[0]?.product || 'Special Medicine'}>
                            {group.items[0]?.product || 'Special Medicine'}
                          </span>
                          {group.items.length > 1 ? (
                            <span className="px-1.5 py-0.2 rounded-full bg-amber-500/15 text-amber-300 text-[9px] font-bold shrink-0 border border-amber-500/20">
                              +{group.items.length - 1} more
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.2 rounded-full bg-amber-500/15 text-amber-300 text-[9px] font-mono font-bold shrink-0 border border-amber-500/20">
                              Qty: {group.items[0]?.qty || 1}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-muted truncate">
                          <span className="truncate">{group.requester}</span>
                          {group.phone && <span>• {group.phone}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {(() => {
                          const maxCount = Math.max(0, ...group.items.map(i => Number(i.notification_count || 0)));
                          return (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase ${
                                group.overallStatus === 'Ready'
                                  ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                                  : group.overallStatus === 'Ordered'
                                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                              }`}
                            >
                              {group.overallStatus === 'Ready' && maxCount > 0
                                ? `Ready (Sent ${maxCount}x)`
                                : group.overallStatus}
                            </span>
                          );
                        })()}
                        <ChevronDown size={14} className={`text-muted transition-transform duration-200 ${isExpanded ? 'rotate-180 text-amber-500' : ''}`} />
                      </div>
                    </div>

                    {/* Unfolded Medicine Names: shows only medicine names (1 if one, multiple if multiple) */}
                    {isExpanded && (
                      <div className="flex flex-col gap-1.5 pt-1 border-t border-border">
                        {group.items.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-bg2 border border-border text-[11px] min-w-0"
                          >
                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                              <Package size={11} className="text-amber-500 shrink-0" />
                              <span className="font-medium text-text truncate">{item.product}</span>
                            </div>
                            <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20 text-[10px] font-mono font-bold shrink-0">
                              Qty: {item.qty}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Action Buttons Footer — 2-Tier Clean Layout */}
                    <div className="flex flex-col gap-1.5 pt-1.5 border-t border-border min-w-0">
                      {/* Tier 1: Primary Action Buttons */}
                      <div className="flex items-center gap-1.5 min-w-0">
                        {group.overallStatus === 'Ready' ? (
                          <>
                            {(() => {
                              const maxCount = Math.max(0, ...group.items.map(i => Number(i.notification_count || 0)));
                              return (
                                <button
                                  disabled={isProcessing}
                                  onClick={() => handleUpdateGroupStatus(group, 'Ready', { resend: true })}
                                  className="flex-1 h-7 px-2 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-[10px] font-bold tracking-wide uppercase transition-colors flex items-center justify-center gap-1.5 shadow-xs cursor-pointer truncate"
                                  title="Re-send arrival reminder WhatsApp notification to customer"
                                >
                                  {isProcessing ? <Loader2 size={11} className="animate-spin shrink-0" /> : <MessageCircle size={11} className="shrink-0" />}
                                  <span className="truncate">Resend Ready{maxCount > 0 ? ` (${maxCount}x)` : ''}</span>
                                </button>
                              );
                            })()}
                            <button
                              disabled={isProcessing}
                              onClick={() => handleUpdateGroupStatus(group, 'Completed', { navigateToPos: true })}
                              className="flex-1 h-7 px-2 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-[10px] font-bold tracking-wide uppercase transition-colors flex items-center justify-center gap-1.5 shadow-xs cursor-pointer truncate"
                              title="Mark all requests as Completed, remove from Quick Assist and open POS pre-filled for this customer"
                            >
                              {isProcessing ? <Loader2 size={11} className="animate-spin shrink-0" /> : <Check size={11} className="shrink-0" />}
                              <span className="truncate">Complete</span>
                            </button>
                          </>
                        ) : group.overallStatus === 'Ordered' ? (
                          <>
                            <button
                              disabled={isProcessing}
                              onClick={() => handleUpdateGroupStatus(group, 'Ready')}
                              className="flex-1 h-7 px-2 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-[10px] font-bold tracking-wide uppercase transition-colors flex items-center justify-center gap-1.5 shadow-xs cursor-pointer truncate"
                              title="Mark all requests as Ready and queue the arrival WhatsApp to each customer"
                            >
                              {isProcessing ? <Loader2 size={11} className="animate-spin shrink-0" /> : <Check size={11} className="shrink-0" />}
                              <span className="truncate">Mark Ready</span>
                            </button>
                            <button
                              disabled={isProcessing}
                              onClick={() => handleUpdateGroupStatus(group, 'Completed', { navigateToPos: true })}
                              className="flex-1 h-7 px-2 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-[10px] font-bold tracking-wide uppercase transition-colors flex items-center justify-center gap-1.5 shadow-xs cursor-pointer truncate"
                              title="Mark all requests as Completed and open POS pre-filled for this customer"
                            >
                              {isProcessing ? <Loader2 size={11} className="animate-spin shrink-0" /> : <Check size={11} className="shrink-0" />}
                              <span className="truncate">Complete</span>
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              disabled={isProcessing}
                              onClick={() => handleUpdateGroupStatus(group, 'Ordered')}
                              className="flex-1 h-7 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[10px] font-bold tracking-wide uppercase transition-colors flex items-center justify-center gap-1.5 shadow-xs cursor-pointer truncate"
                              title="Mark all requests as Ordered"
                            >
                              {isProcessing ? <Loader2 size={11} className="animate-spin shrink-0" /> : <Check size={11} className="shrink-0" />}
                              <span className="truncate">Mark Ordered</span>
                            </button>
                            <button
                              disabled={isProcessing}
                              onClick={() => handleUpdateGroupStatus(group, 'Completed', { navigateToPos: true })}
                              className="flex-1 h-7 px-2 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-[10px] font-bold tracking-wide uppercase transition-colors flex items-center justify-center gap-1.5 shadow-xs cursor-pointer truncate"
                              title="Mark all requests as Completed and open POS pre-filled for this customer"
                            >
                              {isProcessing ? <Loader2 size={11} className="animate-spin shrink-0" /> : <Check size={11} className="shrink-0" />}
                              <span className="truncate">Complete</span>
                            </button>
                          </>
                        )}
                      </div>

                      {/* Tier 2: Secondary Controls (Auto/Manual toggle + Edit + Cancel) */}
                      <div className="flex items-center justify-between gap-1.5 min-w-0">
                        {group.overallStatus === 'Ready' ? (
                          (() => {
                            const isOrderAutoArmed = optimisticAutoRemindOrders.has(group.items[0]?.id)
                              ? optimisticAutoRemindOrders.get(group.items[0]?.id)
                              : (group as any).auto_remind === 1;
                            const collCount = (group as any).collection_reminder_count || 0;
                            return (
                              <button
                                type="button"
                                disabled={isProcessing}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleOrderAutoRemind(group.items, !isOrderAutoArmed);
                                }}
                                className={`h-6 px-2 rounded-full text-[9px] font-bold uppercase tracking-wider transition-all flex items-center gap-1 cursor-pointer border shrink-0 ${
                                  isOrderAutoArmed
                                    ? 'bg-purple-500/15 text-purple-300 border-purple-500/30 hover:bg-purple-500/25'
                                    : 'bg-bg3 text-muted hover:text-text border-border'
                                }`}
                                title={
                                  isOrderAutoArmed
                                    ? `Auto collection reminder is ACTIVE (${collCount} sent). Daily follow-up 10 AM - 6 PM until sold in POS. Click to switch to Manual.`
                                    : 'Manual mode: automatic follow-ups disabled. Click to arm Auto Remind.'
                                }
                              >
                                <Zap size={9} className={isOrderAutoArmed ? 'text-purple-400 fill-purple-400 shrink-0' : 'text-muted shrink-0'} />
                                <span className="truncate">{isOrderAutoArmed ? `Auto ON${collCount > 0 ? ` (${collCount}x)` : ''}` : 'Manual'}</span>
                              </button>
                            );
                          })()
                        ) : (
                          <span className="text-[10px] text-muted/60 uppercase font-mono px-1">
                            {group.overallStatus}
                          </span>
                        )}

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={isProcessing}
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingGroup({
                                type: 'special_request',
                                title: 'Edit Special Request',
                                customerName: group.requester,
                                customerPhone: group.phone || '',
                                items: group.items.map(i => ({
                                  id: i.id,
                                  product: i.product,
                                  qty: i.qty,
                                  status: i.status,
                                  priority: i.priority,
                                  notes: (i as any).notes || ''
                                }))
                              });
                            }}
                            className="h-6 px-2 rounded bg-bg3 hover:bg-sky-600 hover:text-white text-muted border border-border disabled:opacity-50 text-[10px] font-bold tracking-wide uppercase transition-colors flex items-center justify-center gap-1 cursor-pointer"
                            title="Edit special request details, quantities, or arrival/delay status"
                          >
                            <Edit3 size={11} className="shrink-0" />
                            <span>Edit</span>
                          </button>
                          <button
                            disabled={isProcessing}
                            onClick={() => handleUpdateGroupStatus(group, 'Cancelled')}
                            className="h-6 px-2 rounded bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500 text-[10px] font-bold uppercase transition-all flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                            title="Cancel all requests for this customer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Staged Messages */}
        <div>
          <div className="flex items-center justify-between mb-2 text-xs font-bold uppercase tracking-wider text-purple-300">
            <div className="flex items-center gap-1.5 min-w-0">
              <MessageSquareIcon size={14} className="text-purple-500 shrink-0" />
              <span className="truncate">Staged Messages ({groupedNotifications.length})</span>
              {dailySummary.sentTodayCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/15 text-emerald-400 text-[9px] font-mono font-bold shrink-0 border border-emerald-500/20">
                  {dailySummary.sentTodayCount} Sent
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => onOpenDailyModal()}
              className="text-[9px] font-black text-purple-300 hover:text-purple-200 hover:underline uppercase tracking-widest cursor-pointer flex items-center gap-1 shrink-0"
              title="Open Daily Communications & Sent History Log"
            >
              <span>Daily Log</span>
            </button>
          </div>
          {groupedNotifications.length === 0 ? (
            <div className="flex items-center justify-between pl-2 py-1">
              <p className="text-xs text-muted/60">No staged messages</p>
              {dailySummary.sentTodayCount > 0 && (
                <button
                  type="button"
                  onClick={() => onOpenDailyModal()}
                  className="text-[10px] font-bold text-emerald-400 hover:underline cursor-pointer"
                >
                  View {dailySummary.sentTodayCount} sent today
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {groupedNotifications.map(group => {
                const isSending = sendingNotifKeys.has(group.key);
                const isSnoozing = snoozingKeys.has(group.key);
                const isExpanded = expandedStagedKeys.has(group.key);
                const alreadySent = getAlreadySentInfo(group.recipient_phone);

                return (
                  <div
                    key={group.key}
                    className="p-3 rounded-xl border flex flex-col gap-2 transition-all min-w-0 overflow-hidden shadow-xs bg-purple-500/[0.05] border-purple-500/25"
                  >
                    {/* Header (Click to toggle expansion / fold & unfold preview) */}
                    <div
                      onClick={() => toggleStagedKey(group.key)}
                      className="flex items-start justify-between gap-1.5 min-w-0 cursor-pointer select-none"
                    >
                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                          <span className="font-bold text-xs text-text truncate" title={group.recipient_name}>
                            {group.recipient_name}
                          </span>
                          {(() => {
                            const normalizeP = (p?: string | null) => (p || '').replace(/\D/g, '').slice(-10);
                            const normGP = normalizeP(group.recipient_phone);
                            const matchedRefillGroup = groupedActionableRefills.find(r => 
                              (normGP && normalizeP(r.patient_phone) === normGP) ||
                              (r.patient_name && r.patient_name.trim().toLowerCase() === group.recipient_name.trim().toLowerCase())
                            );
                            const totalMedsCount = matchedRefillGroup ? matchedRefillGroup.medicines.length : group.messages.length;
                            return totalMedsCount > 1 ? (
                              <span className="px-1.5 py-0.2 rounded-full bg-purple-500/15 text-purple-300 text-[9px] font-bold shrink-0 border border-purple-500/20">
                                {totalMedsCount} meds
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.2 rounded-full bg-purple-500/15 text-purple-300 text-[9px] font-bold shrink-0 border border-purple-500/20">
                                Refill
                              </span>
                            );
                          })()}
                          {alreadySent && (
                            <span className="px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-300 text-[9px] font-bold shrink-0 border border-amber-500/25">
                              ⚠️ Sent Today
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-muted truncate mt-0.5 font-mono">
                          <span>{group.recipient_phone}</span>
                          {alreadySent && (
                            <span className="text-amber-400 font-sans truncate">
                              • Last: {(() => {
                                try {
                                  return new Date(alreadySent.last_sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                } catch (_) {
                                  return alreadySent.last_sent_at;
                                }
                              })()}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <ChevronDown size={14} className={`text-muted transition-transform duration-200 ${isExpanded ? 'rotate-180 text-purple-400' : ''}`} />
                      </div>
                    </div>

                    {/* Collapsible preview of message */}
                    {isExpanded ? (
                      <p className="text-[11px] text-text/85 leading-snug italic bg-bg2 p-2 rounded-lg border border-border break-words font-medium">
                        "{group.consolidatedMessage}"
                      </p>
                    ) : (
                      <p
                        onClick={() => toggleStagedKey(group.key)}
                        className="text-[10px] text-muted italic truncate cursor-pointer hover:text-text"
                        title={group.consolidatedMessage}
                      >
                        "{group.consolidatedMessage}"
                      </p>
                    )}

                    {/* Action Buttons Footer: Pause (+1d), Cancel, Send / Re-Send */}
                    <div className="flex items-center flex-wrap gap-1.5 pt-1 border-t border-border min-w-0">
                      <button
                        type="button"
                        disabled={isSnoozing || isSending}
                        onClick={() => handleSnoozeStagedGroup(group)}
                        className="flex-1 py-1 px-2 rounded bg-bg3 hover:bg-amber-600 hover:text-white text-muted border border-border disabled:opacity-50 text-[10px] font-bold tracking-wide uppercase transition-colors flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap min-w-0"
                        title="Pause / Snooze reminder to tomorrow (+1 day)"
                      >
                        {isSnoozing ? <Loader2 size={11} className="animate-spin" /> : <Calendar size={11} />}
                        Pause (+1d)
                      </button>

                      <button
                        type="button"
                        disabled={isSending || isSnoozing}
                        onClick={() => handleDismissStagedNotificationGroup(group)}
                        className="flex-1 py-1 px-2 rounded bg-bg3 hover:bg-red-600 hover:text-white text-muted border border-border disabled:opacity-50 text-[10px] font-bold tracking-wide uppercase transition-colors flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap min-w-0"
                        title="Cancel and dismiss staged message"
                      >
                        <X size={11} />
                        Cancel
                      </button>

                      <button
                        type="button"
                        disabled={isSending || isSnoozing}
                        onClick={() => handleSendStagedNotificationGroup(group)}
                        className="flex-1 py-1 px-2 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[10px] font-bold tracking-wide uppercase transition-colors flex items-center justify-center gap-1 shadow-xs cursor-pointer whitespace-nowrap min-w-0"
                        title={alreadySent ? "Re-send WhatsApp reminder to customer" : "Send consolidated WhatsApp message to customer"}
                      >
                        {isSending ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : alreadySent ? (
                          <RotateCw size={11} />
                        ) : (
                          <SendIcon size={11} />
                        )}
                        {alreadySent ? "Re-Send" : "Send"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>


        {/* 4. Catalogue Image Verification Queue */}
        {imageReviewCount > 0 && (
          <div className="p-3 rounded-xl bg-sky-500/[0.06] border border-sky-500/30 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-sky-400">
                  <ShieldCheckIcon size={14} />
                  <span>Image Review Queue</span>
                </div>
                <span className="px-1.5 py-0.2 rounded-md bg-sky-500/20 text-sky-300 text-[10px] font-black font-mono">
                  {imageReviewCount}
                </span>
              </div>
              <p className="text-[11px] text-muted leading-snug">
                {imageReviewCount} product images need pharmacist inspection.
              </p>
              <button
                type="button"
                onClick={() => {
                  navigate('/database?tab=images&filter=review');
                  setExpanded(false);
                }}
                className="w-full py-1.5 px-3 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm"
              >
                <span>Inspect & Verify</span>
                <ChevronRightIcon size={13} />
              </button>
            </div>
          )}
        </div>
        {arrivalModalGroup && (
          <SpecialOrderArrivalModal
            isOpen={!!arrivalModalGroup}
            onClose={() => setArrivalModalGroup(null)}
            customerName={arrivalModalGroup.requester}
            customerPhone={arrivalModalGroup.phone || ''}
            orders={arrivalModalGroup.items}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['orders'] });
              specialOrdersEvent.triggerUpdated();
              window.dispatchEvent(new CustomEvent('refresh-special-orders'));
              onActionComplete();
            }}
          />
        )}
        {editingGroup && (
          <QuickAssistOrderEditModal
            isOpen={!!editingGroup}
            onClose={() => setEditingGroup(null)}
            editGroup={editingGroup}
            onOpenArrivalModal={(arrGroup) => {
              setEditingGroup(null);
              setArrivalModalGroup(arrGroup);
            }}
            onSuccess={() => {
              setEditingGroup(null);
              queryClient.invalidateQueries({ queryKey: ['orders'] });
              queryClient.invalidateQueries({ queryKey: ['refills'] });
              specialOrdersEvent.triggerUpdated();
              refillEvent.triggerRefresh();
              window.dispatchEvent(new CustomEvent('refresh-special-orders'));
              window.dispatchEvent(new CustomEvent('refresh-refills'));
              onActionComplete();
            }}
          />
        )}
      </div>
    );
  });

export default QuickAssistSidebar;
