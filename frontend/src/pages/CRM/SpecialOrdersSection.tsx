import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw, Send, Users, Phone,
  Calendar, CheckCircle2, Clock, Search,
  Repeat2, MessageCircle, Check, Copy,
  X, Plus, Trash2, ChevronDown,
  ChevronUp, ClipboardList, ShoppingCart, AlertTriangle,
  Pencil, Edit3, RotateCcw, QrCode, Package, MoreVertical
} from 'lucide-react';
import { apiClient, api } from '../../services/api';
import { toastEvent, specialOrdersEvent, messageSendEvent, whatsappQueueEvent, liveCartAddEvent } from '../../services/events';
import { getFirstTwoAlphanumericTokens } from '../../utils/searchTokens';
import { useOnClickOutside } from '../../hooks/useOnClickOutside';
import { useDropdownAutoScroll } from '../../hooks/useDropdownAutoScroll';
import { useModalEscape } from '../../services/keyboardShortcuts';
import { usePageActive } from '../../lib/keepAlive/PageActiveContext';
import { useWaPhoneStatus } from '../../hooks/useWaPhoneStatus';
import { getTodayString, getNDaysAgoString, toDateInputValue } from '../../utils/date';
import { PhoneInputWithBadge } from '../../components/PhoneInputWithBadge';
import { matchUniversalTokens } from '../../utils/searchUtils';
import { SalutationNameInput, combineSalutationAndName, parseSalutationAndName } from '../../components/SalutationNameInput';
import { SpecialOrderArrivalModal } from '../../components/SpecialOrderArrivalModal';
import { DelayNoticeModal } from '../../components/DelayNoticeModal';
import { OrderModifyModal } from '../../components/OrderModifyModal';
import { SpecialOrderAddModal } from '../../components/SpecialOrderAddModal';
import { withSilentRetry, formatDate, type LocalApiError, type PharmarackSearchResult } from './crmTypes';
import { sanitizePhoneInput, isValid10DigitPhone } from '../../utils/phone';

export interface SpecialOrderItem {
  id: number;
  customer_id?: number | null;
  product: string;
  requester: string;
  phone: string;
  qty: number;
  priority: string;
  status: string;
  date: string;
  notified: number;
  pharmarack_distributor?: string | null;
  pharmarack_rate?: number | null;
  pharmarack_mrp?: number | null;
  pharmarack_scheme?: string | null;
  pharmarack_mapped?: number | null;
  pharmarack_product_id?: number | null;
  pharmarack_product_code?: string | null;
  pharmarack_store_id?: number | null;
  pharmarack_product_name?: string | null;
  advance_payment?: number | null;
  payment_status?: string | null;
  payment_qr_id?: string | number | null;
  language?: string;
  notification_count?: number;
}

let cachedSpecialOrders: SpecialOrderItem[] = [];

export const SpecialOrdersSection: React.FC = () => {
  const navigate = useNavigate();
  const pageActive = usePageActive();
  const pageActiveRef = useRef(pageActive);
  useEffect(() => {
    pageActiveRef.current = pageActive;
  }, [pageActive]);

  const [orders, setOrders] = useState<SpecialOrderItem[]>(cachedSpecialOrders);
  const [loading, setLoading] = useState(cachedSpecialOrders.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'running' | 'ready' | 'completed'>('running');
  const [openMenuOrderId, setOpenMenuOrderId] = useState<number | null>(null);
  const [arrivalModalData, setArrivalModalData] = useState<{
    customerName: string;
    customerPhone: string;
    orders: Array<{ id: number; product: string; qty: number; status?: string }>;
  } | null>(null);

  // Date Filters
  const [dateFrom, setDateFrom] = useState(getNDaysAgoString(15));
  const [dateTo, setDateTo] = useState(getTodayString());
  const [manualToDate, setManualToDate] = useState(false);


  const [resendingId, setResendingId] = useState<number | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [addingCartId, setAddingCartId] = useState<number | null>(null);
  const [convertingId, setConvertingId] = useState<number | null>(null);
  const [reorderItem, setReorderItem] = useState<SpecialOrderItem | null>(null);
  const [loadingPaymentQrId, setLoadingPaymentQrId] = useState<number | null>(null);
  const [sendingPaymentQrId, setSendingPaymentQrId] = useState<number | null>(null);
  const [paymentQrModalData, setPaymentQrModalData] = useState<{
    order_id: number;
    so_code: string;
    customer_name: string;
    customer_phone: string;
    medicine_name: string;
    amount: number;
    upi_id: string;
    payee_name: string;
    upi_uri: string;
    payment_status: string;
  } | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [modifyingOrder, setModifyingOrder] = useState<any | null>(null);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [expandedMultiOrders, setExpandedMultiOrders] = useState<Record<string, boolean>>({});

  const toggleMultiOrder = (groupKey: string) => {
    setExpandedMultiOrders(prev => ({
      ...prev,
      [groupKey]: !prev[groupKey]
    }));
  };

  interface CartAdjustmentNotice {
    productName: string;
    action: 'removed' | 'adjusted';
    previousQty?: number;
    deductedQty?: number;
    remainingQty?: number;
    storeName?: string;
  }
  const [cartAdjustmentNotice, setCartAdjustmentNotice] = useState<CartAdjustmentNotice | null>(null);

  // Proactive early readiness: pre-warm WhatsApp client when Special Orders workflow is entered
  useEffect(() => {
    api.prewarmWhatsApp().catch(() => {});
  }, []);

  useEffect(() => {
    if (showAddModal || showEditModal || arrivalModalData) {
      api.prewarmWhatsApp().catch(() => {});
    }
  }, [showAddModal, showEditModal, arrivalModalData]);

  useEffect(() => {
    if (!cartAdjustmentNotice) return;
    const timer = setTimeout(() => {
      setCartAdjustmentNotice(null);
    }, 6500);
    return () => clearTimeout(timer);
  }, [cartAdjustmentNotice]);

  const handleCartAdjustmentFeedback = (adjustment: any, fallbackName: string) => {
    if (!adjustment || adjustment.action === 'none') return;
    const prodName = adjustment.productName || fallbackName;
    if (adjustment.action === 'adjusted') {
      setCartAdjustmentNotice({
        productName: prodName,
        action: 'adjusted',
        previousQty: adjustment.previousQty,
        deductedQty: adjustment.deductedQty,
        remainingQty: adjustment.remainingQty,
        storeName: adjustment.storeName
      });
      toastEvent.trigger(
        `Live cart adjusted: "${prodName}" qty reduced to ${adjustment.remainingQty} (shelf stock preserved)`,
        'info',
        '/crm'
      );
      window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'));
    } else if (adjustment.action === 'removed') {
      setCartAdjustmentNotice({
        productName: prodName,
        action: 'removed',
        previousQty: adjustment.previousQty,
        deductedQty: adjustment.deductedQty,
        remainingQty: 0,
        storeName: adjustment.storeName
      });
      toastEvent.trigger(
        `Removed "${prodName}" from Pharmarack live cart`,
        'success',
        '/crm'
      );
      window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'));
    }
  };

  // Modals
  const [showDelayModal, setShowDelayModal] = useState(false);

  // Edit Request Form State
  const [editingOrder, setEditingOrder] = useState<SpecialOrderItem | null>(null);
  const [editCustomerId, setEditCustomerId] = useState<number | null>(null);
  const [editProduct, setEditProduct] = useState('');
  const [editSalutation, setEditSalutation] = useState('Mr.');
  const [editCustomSalutation, setEditCustomSalutation] = useState('');
  const [editRequester, setEditRequester] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const { isNotOnWa: editNotOnWa } = useWaPhoneStatus(editPhone.replace(/\D/g, '').slice(-10));
  const [shakePhone, setShakePhone] = useState(false);
  const [, setShakeEditPhone] = useState(false);
  const [editQty, setEditQty] = useState<number | ''>(1);
  const [editAdvancePayment, setEditAdvancePayment] = useState<number | ''>('');
  const [editPriority, setEditPriority] = useState('Normal');
  const [editStatus, setEditStatus] = useState('Pending');
  const [editDistributor, setEditDistributor] = useState('');
  const [editRate, setEditRate] = useState<number | ''>('');
  const [editMrp, setEditMrp] = useState<number | ''>('');
  const [editScheme, setEditScheme] = useState('');
  const [editLanguage, setEditLanguage] = useState('en');
  const [editFormSubmitting, setEditFormSubmitting] = useState(false);



  // Universal Escape key dismissal for Special Order modals
  useModalEscape(showAddModal, () => setShowAddModal(false));
  useModalEscape(showEditModal, () => {
    setShowEditModal(false);
    setEditingOrder(null);
  });
  useModalEscape(!!paymentQrModalData, () => setPaymentQrModalData(null));

  useEffect(() => {
    if (!manualToDate) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets date filter on clear
      setDateTo(getTodayString());
    }
  }, [manualToDate]);

  const loadOrders = useCallback(async () => {
    if (cachedSpecialOrders.length === 0) {
      setLoading(true);
    }
    try {
      const data = await withSilentRetry(() => api.getOrders());
      const list = Array.isArray(data) ? data : [];
      cachedSpecialOrders = list;
      setOrders(list);
    } catch {
      toastEvent.trigger('Failed to load special requests', 'error', '/crm');
    } finally {
      setLoading(false);
    }
  }, []);

  const wasActiveRef = useRef(pageActive);
  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = pageActive;
    if (!pageActive || wasActive) return;
    loadOrders();
  }, [pageActive, loadOrders]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- module-cache hydration loader, event-refresh
    loadOrders();
    const handleRefresh = () => {
      if (!pageActiveRef.current) return;
      loadOrders();
    };
    const handleOrderDelta = (e: any) => {
      const delta = e?.detail;
      if (!delta || !delta.orderId) return;
      setOrders(prev => {
        if (delta.action === 'delete') {
          return prev.filter(o => o.id !== delta.orderId);
        }
        return prev.map(o => o.id === delta.orderId ? { ...o, ...(delta.patch || {}) } : o);
      });
      cachedSpecialOrders = delta.action === 'delete'
        ? cachedSpecialOrders.filter(o => o.id !== delta.orderId)
        : cachedSpecialOrders.map(o => o.id === delta.orderId ? { ...o, ...(delta.patch || {}) } : o);
    };

    window.addEventListener('refresh-special-orders', handleRefresh);
    window.addEventListener('app-order-delta', handleOrderDelta);
    return () => {
      window.removeEventListener('refresh-special-orders', handleRefresh);
      window.removeEventListener('app-order-delta', handleOrderDelta);
    };
  }, [loadOrders]);

  const handleNotifyArrival = async (order: SpecialOrderItem) => {
    // If customer has multiple active requests, group them together.
    // Regardless of single or multiple items, ALWAYS open the Arrival Preview Modal
    // so the pharmacist gets human-in-the-loop preview, live WA check, language selection, and "Mark Ready in Store" fallback!
    const cleanPhone = (order.phone || '').trim();
    const cleanName = (order.requester || '').trim();
    const relatedActive = orders.filter(o => {
      if (o.status === 'Fulfilled' || o.status === 'Cancelled') return false;
      const oPhone = (o.phone || '').trim();
      const oName = (o.requester || '').trim();
      return (cleanPhone && oPhone === cleanPhone) || (cleanName && oName === cleanName);
    });

    const targetOrders = relatedActive.length > 0 ? relatedActive : [order];

    setArrivalModalData({
      customerName: order.requester || 'Customer',
      customerPhone: order.phone || '',
      orders: targetOrders.map(o => ({
        id: o.id,
        product: o.product,
        qty: o.qty,
        status: o.status
      }))
    });
  };

  const handleUpdateStatus = async (id: number, newStatus: string) => {
    if (updatingId === id) return;
    setUpdatingId(id);

    // Sub-10ms Optimistic UI update (<2ms)
    const prevOrders = [...orders];
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status: newStatus } : o));
    cachedSpecialOrders = cachedSpecialOrders.map(o => o.id === id ? { ...o, status: newStatus } : o);

    try {
      const res = await api.updateOrder(id, { status: newStatus });
      if (newStatus === 'Cancelled') {
        const ord = prevOrders.find(o => o.id === id);
        handleCartAdjustmentFeedback(res?.cartAdjustment, ord?.product || 'Medicine');
      }
      toastEvent.trigger(
        res?.whatsapp_queued
          ? `Status updated to ${newStatus} & arrival WhatsApp queued!`
          : `Status updated to ${newStatus}`,
        'success',
        '/crm'
      );
      if (res?.whatsapp_queued) whatsappQueueEvent.triggerUpdated();
      specialOrdersEvent.triggerUpdated();
    } catch {
      // Rollback on failure
      setOrders(prevOrders);
      cachedSpecialOrders = prevOrders;
      toastEvent.trigger('Failed to update order status', 'error', '/crm');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleBatchStatusUpdate = async (orderIds: number[], newStatus: string) => {
    if (!orderIds || orderIds.length === 0) return;
    const prevOrders = [...orders];
    setOrders(prev => prev.map(o => orderIds.includes(o.id) ? { ...o, status: newStatus } : o));
    cachedSpecialOrders = cachedSpecialOrders.map(o => orderIds.includes(o.id) ? { ...o, status: newStatus } : o);

    try {
      await api.updateOrdersBatchStatus(orderIds, newStatus);
      toastEvent.trigger(`Updated ${orderIds.length} item(s) to ${newStatus}`, 'success', '/crm');
      specialOrdersEvent.triggerUpdated();
    } catch {
      setOrders(prevOrders);
      cachedSpecialOrders = prevOrders;
      toastEvent.trigger('Failed to update orders', 'error', '/crm');
    }
  };

  const handleSellSpecialOrder = (order: SpecialOrderItem) => {
    const prefill = {
      patientName: order.requester,
      patientPhone: order.phone,
      specialOrderId: order.id,
      advancePayment: order.advance_payment ? Number(order.advance_payment) : 0,
      medicines: [{ medicineName: order.product, quantity_needed: order.qty }]
    };
    api.notifyCounterSession({
      phone: order.phone || '',
      specialOrderId: order.id
    });
    toastEvent.trigger(`Transferring "${order.product}" (Qty: ${order.qty}) to POS for ${order.requester}...`, 'info', '/pos');
    navigate('/pos', { state: { prefill } });
  };

  const handleAddToCart = (order: SpecialOrderItem) => {
    // Open the Quick Special Order pop-up prefilled with this order's patient & medicine details,
    // allowing re-ordering for the same patient or assigning to a new patient with live distributor stock.
    setReorderItem(order);
    setShowAddModal(true);
  };

  const handleSellAllSpecialOrders = (ordersList: SpecialOrderItem[]) => {
    if (!ordersList || ordersList.length === 0) return;
    const first = ordersList[0];
    const totalAdv = ordersList.reduce((sum, o) => sum + (o.advance_payment ? Number(o.advance_payment) : 0), 0);
    const prefill = {
      patientName: first.requester,
      patientPhone: first.phone,
      specialOrderId: first.id,
      specialOrderIds: ordersList.map(o => o.id),
      advancePayment: totalAdv,
      medicines: ordersList.map(o => ({ medicineName: o.product, quantity_needed: o.qty }))
    };
    api.notifyCounterSession({
      phone: first.phone || '',
      specialOrderId: first.id,
      specialOrderIds: ordersList.map(o => o.id)
    });
    toastEvent.trigger(`Transferring ${ordersList.length} special request items to POS for ${first.requester}...`, 'info', '/pos');
    navigate('/pos', { state: { prefill } });
  };

  const handleAddAllSpecialOrdersToCart = async (ordersList: SpecialOrderItem[]) => {
    if (!ordersList || ordersList.length === 0) return;
    const unadded = ordersList.filter(o => o.status !== 'Ordered' && o.status !== 'Ready' && o.status !== 'Arrived');
    const itemsToAdd = unadded.length > 0 ? unadded : ordersList;

    setAddingCartId(itemsToAdd[0].id);
    try {
      const payload = itemsToAdd.map(order => ({
        productId: order.pharmarack_product_id || 0,
        productCode: order.pharmarack_product_code || undefined,
        storeId: order.pharmarack_store_id || 0,
        qty: order.qty || 1,
        productName: order.pharmarack_product_name || order.product,
        storeName: order.pharmarack_distributor || undefined,
        rate: order.pharmarack_rate || undefined,
        mrp: order.pharmarack_mrp || undefined,
        scheme: order.pharmarack_scheme || undefined,
        mapped: order.pharmarack_mapped === 1
      }));
      const res = await api.addPharmarackCart(payload);
      if (res && res.success && !res.offline) {
        toastEvent.trigger(`Added ${itemsToAdd.length} item(s) to Pharmarack cart!`, 'success', '/crm');
        for (const o of itemsToAdd) {
          await api.updateOrder(o.id, { status: 'Ordered' }).catch(() => {});
        }
        await loadOrders();
        window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'));
        specialOrdersEvent.triggerUpdated();
        window.dispatchEvent(new CustomEvent('refresh-special-orders'));
      } else if (res?.offline || res?.reason === 'NO_TOKEN') {
        toastEvent.trigger('Pharmarack session offline — items NOT added to live cart', 'error', '/crm');
      } else {
        toastEvent.trigger(res?.error || 'Failed to add items to cart', 'error', '/crm');
      }
    } catch (err) {
      const e = err as LocalApiError;
      const resData = e.response?.data as any;
      const isOffline = resData?.offline || resData?.reason === 'NO_TOKEN';
      if (isOffline) {
        toastEvent.trigger('Pharmarack session offline — items NOT added to live cart', 'error', '/crm');
      } else {
        toastEvent.trigger(resData?.error || 'Failed to add items to cart', 'error', '/crm');
      }
    } finally {
      setAddingCartId(null);
    }
  };

  const handleDeleteOrder = async (id: number, product: string) => {
    setDeletingId(id);

    // Sub-10ms Optimistic UI update (<2ms)
    const prevOrders = [...orders];
    setOrders(prev => prev.filter(o => o.id !== id));
    cachedSpecialOrders = cachedSpecialOrders.filter(o => o.id !== id);
    toastEvent.trigger(`Special order for "${product}" cancelled & deleted`, 'success', '/crm');

    try {
      const res = await api.deleteOrder(id);
      handleCartAdjustmentFeedback(res?.cartAdjustment, product);
      specialOrdersEvent.triggerUpdated();
    } catch {
      // Rollback on failure
      setOrders(prevOrders);
      cachedSpecialOrders = prevOrders;
      toastEvent.trigger('Failed to delete order request', 'error', '/crm');
    } finally {
      setDeletingId(null);
    }
  };

  const handleRestoreOrder = async (orderId: number) => {
    if (restoringId === orderId) return;
    setRestoringId(orderId);

    // Sub-10ms Optimistic UI update (<2ms)
    const prevOrders = [...orders];
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'Pending' } : o));
    cachedSpecialOrders = cachedSpecialOrders.map(o => o.id === orderId ? { ...o, status: 'Pending' } : o);
    toastEvent.trigger('Special request restored to Pending status successfully!', 'success', '/crm');

    try {
      const res = await api.restoreOrder(orderId, { notes: 'Restored from cancelled status by staff' });
      if (res?.success) {
        specialOrdersEvent.triggerUpdated();
      } else {
        // Rollback on failure
        setOrders(prevOrders);
        cachedSpecialOrders = prevOrders;
        toastEvent.trigger(res?.error || res?.message || 'Failed to restore order', 'error', '/crm');
      }
    } catch (err: any) {
      setOrders(prevOrders);
      cachedSpecialOrders = prevOrders;
      toastEvent.trigger(err?.response?.data?.error || err?.message || 'Failed to restore order', 'error', '/crm');
    } finally {
      setRestoringId(null);
    }
  };

  const handleConvertToRefill = async (order: SpecialOrderItem) => {
    const daysStr = prompt(`Enter refill frequency in days for "${order.product}" (e.g. 30):`, '30');
    if (daysStr === null) return;
    
    const intervalDays = parseInt(daysStr, 10);
    if (isNaN(intervalDays) || intervalDays <= 0) {
      toastEvent.trigger('Please enter a valid number of days.', 'error', '/crm');
      return;
    }

    setConvertingId(order.id);
    try {
      const response = await api.convertToRefill(order.id, intervalDays);
      if (response.success) {
        toastEvent.trigger(response.message || 'Successfully converted to recurring refill!', 'success', '/crm');
        await loadOrders();
      } else {
        toastEvent.trigger(response.error || 'Failed to convert to recurring refill.', 'error', '/crm');
      }
    } catch (err) {
      console.error('Error converting order to refill:', err);
      toastEvent.trigger('Failed to convert order to recurring refill.', 'error', '/crm');
    } finally {
      setConvertingId(null);
    }
  };

  const handleOpenPaymentQr = async (order: SpecialOrderItem) => {
    setLoadingPaymentQrId(order.id);
    try {
      const res = await api.getSpecialOrderPaymentQr(order.id);
      if (res && res.success) {
        setPaymentQrModalData(res);
      } else {
        toastEvent.trigger('Failed to fetch payment QR details', 'error', '/crm');
      }
    } catch (err: any) {
      toastEvent.trigger(err?.response?.data?.error || err?.message || 'Failed to fetch payment QR', 'error', '/crm');
    } finally {
      setLoadingPaymentQrId(null);
    }
  };

  const handleSendPaymentQrWa = async (orderId: number) => {
    setSendingPaymentQrId(orderId);
    try {
      const res = await api.sendSpecialOrderPaymentQr(orderId);
      if (res && res.success) {
        toastEvent.trigger(res.message || '₹50 Payment QR sent to customer on WhatsApp!', 'success', '/crm');
        whatsappQueueEvent.triggerUpdated();
        await loadOrders();
        if (paymentQrModalData && paymentQrModalData.order_id === orderId) {
          setPaymentQrModalData(prev => prev ? { ...prev, payment_status: 'AWAITING_PAYMENT' } : null);
        }
      } else {
        toastEvent.trigger(res?.message || 'Failed to send payment QR', 'error', '/crm');
      }
    } catch (err: any) {
      toastEvent.trigger(err?.response?.data?.error || err?.message || 'Failed to send payment QR', 'error', '/crm');
    } finally {
      setSendingPaymentQrId(null);
    }
  };

  const handleMarkPaymentQrPaid = async (orderId: number) => {
    try {
      const res = await api.markSpecialOrderAdvancePaid(orderId);
      if (res && res.success) {
        toastEvent.trigger('Advance payment marked as CONFIRMED!', 'success', '/crm');
        await loadOrders();
        if (paymentQrModalData && paymentQrModalData.order_id === orderId) {
          setPaymentQrModalData(prev => prev ? { ...prev, payment_status: 'PAYMENT_CONFIRMED' } : null);
        }
      } else {
        toastEvent.trigger(res?.message || 'Failed to update payment status', 'error', '/crm');
      }
    } catch (err: any) {
      toastEvent.trigger(err?.response?.data?.error || err?.message || 'Failed to update payment status', 'error', '/crm');
    }
  };

  const handleScanUncollected = async () => {
    setRefreshing(true);
    try {
      const list = await api.getUncollectedAlerts();
      const count = (list || []).length;
      
      if (count > 0) {
        toastEvent.trigger(`Found ${count} uncollected order(s) pending pickup. You can click 'Send Arrival WA' to notify customer.`, 'info', '/crm');
      } else {
        toastEvent.trigger('No uncollected orders found pending collection.', 'info', '/crm');
      }
      await loadOrders();
    } catch (err) {
      console.error('Error scanning uncollected orders:', err);
      toastEvent.trigger('Failed to check uncollected orders.', 'error', '/crm');
    } finally {
      setRefreshing(false);
    }
  };

  const handleOpenEditModal = (order: SpecialOrderItem) => {
    setEditingOrder(order);
    setEditCustomerId(order.customer_id || null);
    setEditProduct(order.product || '');
    const parsed = parseSalutationAndName(order.requester || '');
    setEditSalutation(parsed.salutation);
    setEditCustomSalutation(parsed.customSalutation);
    setEditRequester(parsed.name);
    setEditPhone(order.phone || '');
    setEditQty(order.qty || 1);
    setEditAdvancePayment(order.advance_payment !== undefined && order.advance_payment !== null ? Number(order.advance_payment) : '');
    setEditPriority(order.priority || 'Normal');
    setEditStatus(order.status || 'Pending');
    setEditDistributor(order.pharmarack_distributor || '');
    setEditRate(order.pharmarack_rate !== undefined && order.pharmarack_rate !== null ? Number(order.pharmarack_rate) : '');
    setEditMrp(order.pharmarack_mrp !== undefined && order.pharmarack_mrp !== null ? Number(order.pharmarack_mrp) : '');
    setEditScheme(order.pharmarack_scheme || '');
    setEditLanguage(order.language || 'en');
    setShowEditModal(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder) return;

    const customerName = combineSalutationAndName(editSalutation, editCustomSalutation, editRequester);
    const customerPhone = editPhone.replace(/\D/g, '');

    if (!editProduct.trim()) {
      toastEvent.trigger('Product name is required.', 'error', '/crm');
      return;
    }
    if (!customerName) {
      toastEvent.trigger('Customer Name is required.', 'error', '/crm');
      return;
    }
    const cleanPh = sanitizePhoneInput(customerPhone);
    if (!cleanPh || !isValid10DigitPhone(cleanPh)) {
      setShakeEditPhone(true);
      setTimeout(() => setShakeEditPhone(false), 400);
      toastEvent.trigger('Customer phone must be a valid 10-digit Indian mobile number (starts with 6–9).', 'error', '/crm');
      return;
    }
    if (!editQty || Number(editQty) < 1) {
      toastEvent.trigger('Quantity must be at least 1.', 'error', '/crm');
      return;
    }

    setEditFormSubmitting(true);
    try {
      const targetCustId = editCustomerId || editingOrder.customer_id;
      if (targetCustId) {
        try {
          await api.updatePatient(targetCustId, { name: customerName, phone: cleanPh });
        } catch (_) {}
      }

      const res = await api.updateOrder(editingOrder.id, {
        product: editProduct.trim(),
        requester: customerName,
        phone: customerPhone,
        qty: Number(editQty) || 1,
        priority: editPriority,
        status: editStatus,
        language: editLanguage,
        pharmarack_distributor: editDistributor || undefined,
        pharmarack_rate: editRate !== '' ? Number(editRate) : undefined,
        pharmarack_mrp: editMrp !== '' ? Number(editMrp) : undefined,
        pharmarack_scheme: editScheme || undefined,
        pharmarack_product_id: editingOrder.pharmarack_distributor === editDistributor ? (editingOrder.pharmarack_product_id ?? undefined) : undefined,
        pharmarack_product_code: editingOrder.pharmarack_distributor === editDistributor ? (editingOrder.pharmarack_product_code ?? undefined) : undefined,
        pharmarack_store_id: editingOrder.pharmarack_distributor === editDistributor ? (editingOrder.pharmarack_store_id ?? undefined) : undefined,
        pharmarack_product_name: editingOrder.pharmarack_distributor === editDistributor ? (editingOrder.pharmarack_product_name ?? undefined) : undefined,
        advance_payment: editAdvancePayment !== '' ? Number(editAdvancePayment) : 0,
        skipWhatsApp: editNotOnWa
      });

      // Truthful toast contract: only claim the arrival WhatsApp was queued when the
      // backend reports it (same rule as Quick Assist Mark Ready).
      if (editStatus === 'Ready') {
        if (res?.whatsapp_queued) {
          messageSendEvent.triggerSendProgress(customerName || customerPhone || 'Customer', `Arrival alert for ${editProduct.trim()}`, 10);
        }
        toastEvent.trigger(
          editNotOnWa
            ? `Order marked Ready in store (WhatsApp skipped — customer not on WhatsApp).`
            : res?.whatsapp_queued
            ? `Request updated & arrival WhatsApp queued for ${customerName}!`
            : `Request updated — no arrival WhatsApp queued (no phone stored or already sent).`,
          'success',
          '/crm'
        );
      } else {
        if (res?.payment_qr_sent) {
          toastEvent.trigger(`Special request updated & ₹50 payment QR sent to ${customerName} on WhatsApp!`, 'success', '/crm');
          whatsappQueueEvent.triggerUpdated();
        } else {
          toastEvent.trigger(`Special request for "${editProduct.trim()}" updated successfully!`, 'success', '/crm');
        }
      }
      if (editStatus === 'Cancelled') {
        handleCartAdjustmentFeedback(res?.cartAdjustment, editProduct.trim());
      }
      setShowEditModal(false);
      setEditingOrder(null);
      setEditCustomerId(null);
      await loadOrders();
      specialOrdersEvent.triggerUpdated();
      whatsappQueueEvent.triggerUpdated();
    } catch (err) {
      console.error('Failed to update special order request:', err);
      toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to update special order request', 'error', '/crm');
    } finally {
      setEditFormSubmitting(false);
    }
  };

  const [expandedCustomers, setExpandedCustomers] = useState<Record<string, boolean>>({});
  const [expandAll, setExpandAll] = useState(false);

  const toggleCustomer = (key: string) => {
    setExpandedCustomers(prev => ({
      ...prev,
      [key]: prev[key] === undefined ? false : !prev[key]
    }));
  };

  const isSearching = searchQuery.trim().length >= 2;

  // Counts for the 3 primary sections
  const tabCounts = useMemo(() => {
    let running = 0;
    let ready = 0;
    let completed = 0;
    orders.forEach(o => {
      const st = o.status;
      if (st === 'Ready' || st === 'Arrived') {
        ready++;
      } else if (st === 'Fulfilled' || st === 'Completed' || st === 'Cancelled') {
        completed++;
      } else {
        running++;
      }
    });
    return { running, ready, completed };
  }, [orders]);

  // Filtered orders for active section (or search matches)
  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim();
    return orders.filter(o => {
      const matchesSearch = !q ||
        matchUniversalTokens([o.product, o.requester, o.phone, o.pharmarack_distributor], q);
      
      if (!matchesSearch) return false;

      // When actively searching, show all matching orders across sections
      if (!isSearching) {
        const st = o.status;
        if (activeTab === 'ready') {
          if (st !== 'Ready' && st !== 'Arrived') return false;
        } else if (activeTab === 'completed') {
          if (st !== 'Fulfilled' && st !== 'Completed' && st !== 'Cancelled') return false;
          if (dateFrom || dateTo) {
            if (!o.date) return false;
            const itemDate = o.date.substring(0, 10);
            const start = dateFrom || '0000-00-00';
            const end = dateTo || '9999-99-99';
            if (itemDate < start || itemDate > end) return false;
          }
        } else {
          // 'running' (Pending, Ordered, Waiting, Inquiry)
          if (st === 'Ready' || st === 'Arrived' || st === 'Fulfilled' || st === 'Completed' || st === 'Cancelled') return false;
        }
      }

      return true;
    });
  }, [orders, searchQuery, isSearching, activeTab, dateFrom, dateTo]);

  // Group filtered orders by customer phone / requester
  const customerGroups = useMemo(() => {
    const groupsMap = new Map<string, {
      key: string;
      requester: string;
      phone: string;
      orders: SpecialOrderItem[];
      totalAdvance: number;
    }>();

    filteredOrders.forEach(order => {
      const cleanPhone = (order.phone || '').trim();
      const cleanName = (order.requester || 'Walk-in Customer').trim();
      const groupKey = cleanPhone || cleanName;

      if (!groupsMap.has(groupKey)) {
        groupsMap.set(groupKey, {
          key: groupKey,
          requester: cleanName,
          phone: cleanPhone,
          orders: [],
          totalAdvance: 0
        });
      }

      const group = groupsMap.get(groupKey)!;
      group.orders.push(order);
      if (order.advance_payment && Number(order.advance_payment) > 0) {
        group.totalAdvance += Number(order.advance_payment);
      }
    });

    return Array.from(groupsMap.values());
  }, [filteredOrders]);

  // Render individual medicine item with context-aware clean action buttons
  const renderOrderItem = (order: SpecialOrderItem) => {
    const isArrived = order.status === 'Ready' || order.status === 'Arrived';
    const isOrdered = order.status === 'Ordered';
    const isPast = order.status === 'Fulfilled' || order.status === 'Cancelled';
    const hasAdvance = order.advance_payment && Number(order.advance_payment) > 0;
    const isMenuOpen = openMenuOrderId === order.id;

    return (
      <div
        key={order.id}
        className={`p-3 rounded-xl border transition-all ${
          isArrived
            ? 'bg-emerald-500/5 border-emerald-500/30'
            : isOrdered
            ? 'bg-indigo-500/5 border-indigo-500/30'
            : order.status === 'Waiting'
            ? 'bg-amber-500/5 border-amber-500/30'
            : isPast
            ? 'bg-bg/40 border-border/40 opacity-80'
            : 'bg-bg2 border-border'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left Column: Product Details */}
          <div className="space-y-1 flex-1 min-w-[240px]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-text flex items-center gap-1.5">
                💊 {order.product}
              </span>
              <span className="px-2 py-0.5 rounded-md bg-bg3 border border-border text-[11px] font-bold text-primary">
                Qty: {order.qty}
              </span>
              {hasAdvance && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-extrabold flex items-center gap-1">
                  ✨ Advance: ₹{Number(order.advance_payment).toFixed(2)}
                </span>
              )}
              {order.payment_status === 'PAYMENT_CONFIRMED' ? (
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-extrabold">
                  ✅ Advance Paid
                </span>
              ) : order.payment_status === 'AWAITING_PAYMENT' ? (
                <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-extrabold">
                  ⏳ Awaiting ₹50
                </span>
              ) : null}
              {order.priority && order.priority !== 'Normal' && (
                <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold ${
                  order.priority === 'High' ? 'bg-red-500/15 text-red-400 border border-red-500/30' : 'bg-bg3 text-muted border border-border'
                }`}>
                  {order.priority}
                </span>
              )}
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                isArrived
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : isOrdered
                  ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40'
                  : order.status === 'Waiting'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                  : isPast
                  ? 'bg-zinc-500/20 text-muted border border-border'
                  : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
              }`}>
                {order.status}
              </span>
              {order.notified === 1 && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold flex items-center gap-1">
                  <CheckCircle2 size={11} /> {order.notification_count && order.notification_count > 1 ? `Sent ${order.notification_count}x` : 'WA Sent'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 text-xs text-muted flex-wrap">
              {order.pharmarack_distributor && (
                <span className="px-2 py-0.5 rounded-md bg-bg3/80 text-[10px] text-muted border border-border font-medium">
                  Distributor: <strong className="text-text">{order.pharmarack_distributor}</strong>
                </span>
              )}
              {order.pharmarack_rate ? (
                <span className="text-emerald-400 font-mono text-[11px] font-semibold">
                  Rate: ₹{order.pharmarack_rate}
                </span>
              ) : null}
              <span className="text-[10px]">
                Logged: {formatDate(order.date)}
              </span>
            </div>
          </div>

          {/* Right Column: Context-Aware Streamlined Action Bar */}
          <div className="flex items-center gap-2 relative">
            {/* 1. RUNNING SECTION ACTIONS */}
            {!isArrived && !isPast && (
              <>
                {order.status === 'Inquiry' && (
                  <button
                    onClick={() => handleUpdateStatus(order.id, 'Pending')}
                    disabled={updatingId === order.id}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
                    title="Approve customer inquiry"
                  >
                    <CheckCircle2 size={13} className={updatingId === order.id ? 'animate-spin' : ''} />
                    <span>Approve</span>
                  </button>
                )}
                {/* Primary Action: Mark Ready / Arrived */}
                <button
                  onClick={() => handleUpdateStatus(order.id, 'Ready')}
                  disabled={updatingId === order.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs shadow-emerald-500/20 transition-all cursor-pointer"
                  title="Mark arrived and ready for customer pickup"
                >
                  <CheckCircle2 size={13} className={updatingId === order.id ? 'animate-spin' : ''} />
                  <span>✓ Mark Ready</span>
                </button>
                {/* Quick Add to Live Cart (if not ordered yet) */}
                {!isOrdered && (
                  <button
                    onClick={() => handleAddToCart(order)}
                    disabled={addingCartId === order.id}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-400 text-xs font-bold transition-all cursor-pointer"
                    title="Add to Live Cart"
                  >
                    <ShoppingCart size={12} className={addingCartId === order.id ? 'animate-spin' : ''} />
                    <span>+ Cart</span>
                  </button>
                )}
              </>
            )}

            {/* 2. READY SECTION ACTIONS */}
            {isArrived && (
              <>
                <button
                  onClick={() => handleSellSpecialOrder(order)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black shadow-md shadow-emerald-500/20 transition-all cursor-pointer active:scale-95"
                  title="Sell now in POS billing with advance credit"
                >
                  <ShoppingCart size={13} />
                  <span>⚡ Sell in POS</span>
                </button>
                <button
                  onClick={() => handleNotifyArrival(order)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-xs transition-all cursor-pointer"
                  title="Notify customer on WhatsApp"
                >
                  <MessageCircle size={12} />
                  <span>{order.notified === 1 ? 'Resend WA' : '📱 Notify WA'}</span>
                </button>
              </>
            )}

            {/* 3. COMPLETED SECTION ACTIONS */}
            {isPast && (
              <>
                {order.status === 'Cancelled' ? (
                  <button
                    onClick={() => handleRestoreOrder(order.id)}
                    disabled={restoringId === order.id}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all cursor-pointer"
                    title="Restore cancelled request"
                  >
                    <RotateCcw size={12} className={restoringId === order.id ? 'animate-spin' : ''} />
                    <span>Restore</span>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setReorderItem(order);
                      setShowAddModal(true);
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-primary/15 hover:bg-primary/25 border border-primary/30 text-primary text-xs font-bold transition-all cursor-pointer"
                    title="Create new request for this medicine"
                  >
                    <Repeat2 size={12} />
                    <span>Re-order</span>
                  </button>
                )}
              </>
            )}

            {/* 4. CLEAN '···' ACTION MENU FOR SECONDARY OPTIONS */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenMenuOrderId(isMenuOpen ? null : order.id)}
                className="p-1.5 rounded-lg bg-bg3 hover:bg-bg border border-border text-muted hover:text-text transition-all cursor-pointer"
                title="More options"
              >
                <MoreVertical size={14} />
              </button>

              {isMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-1.5 w-48 bg-bg2 border border-border rounded-xl shadow-xl z-20 py-1 text-xs animate-in fade-in"
                  onMouseLeave={() => setOpenMenuOrderId(null)}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenuOrderId(null);
                      handleOpenPaymentQr(order);
                    }}
                    className="w-full px-3 py-1.5 text-left text-text hover:bg-bg3 flex items-center gap-2 cursor-pointer"
                  >
                    <QrCode size={13} className="text-purple-400" />
                    <span>₹50 Advance QR</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenuOrderId(null);
                      handleOpenEditModal(order);
                    }}
                    className="w-full px-3 py-1.5 text-left text-text hover:bg-bg3 flex items-center gap-2 cursor-pointer"
                  >
                    <Pencil size={13} className="text-blue-400" />
                    <span>Edit Details</span>
                  </button>

                  {!isPast && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenuOrderId(null);
                        setModifyingOrder(order);
                      }}
                      className="w-full px-3 py-1.5 text-left text-text hover:bg-bg3 flex items-center gap-2 cursor-pointer"
                    >
                      <Edit3 size={13} className="text-primary" />
                      <span>Modify Medicine</span>
                    </button>
                  )}

                  {!isPast && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenuOrderId(null);
                        handleConvertToRefill(order);
                      }}
                      className="w-full px-3 py-1.5 text-left text-text hover:bg-bg3 flex items-center gap-2 cursor-pointer"
                    >
                      <Repeat2 size={13} className="text-purple-400" />
                      <span>Convert to Refill</span>
                    </button>
                  )}

                  {isArrived && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenuOrderId(null);
                        handleUpdateStatus(order.id, 'Pending');
                      }}
                      className="w-full px-3 py-1.5 text-left text-text hover:bg-bg3 flex items-center gap-2 cursor-pointer"
                    >
                      <RotateCcw size={13} className="text-amber-400" />
                      <span>Move to Running</span>
                    </button>
                  )}

                  {!isPast && (
                    <div className="h-px bg-border/60 my-1" />
                  )}

                  {!isPast && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenuOrderId(null);
                        handleDeleteOrder(order.id, order.product);
                      }}
                      className="w-full px-3 py-1.5 text-left text-red-400 hover:bg-red-500/10 flex items-center gap-2 cursor-pointer"
                    >
                      <Trash2 size={13} />
                      <span>Cancel Order</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full gap-3 overflow-hidden">
      {/* Top Controls & Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-bg border border-border rounded-xl shrink-0">
        {/* Left: Search & 3 Section Segment Tabs */}
        <div className="flex items-center gap-2 flex-1 min-w-[280px]">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Search medicine, customer, phone, distributor..."
              value={searchQuery}
              onChange={e => {
                const val = e.target.value;
                setSearchQuery(val.includes('|') ? val.split('|')[0].trim() : val);
              }}
              className="w-full pl-9 pr-8 py-1.5 bg-bg border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary font-medium"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text cursor-pointer p-0.5 rounded-full hover:bg-bg3"
                title="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* 3 Section Segment Tabs */}
          <div className="flex items-center gap-1 bg-bg3/70 p-1 rounded-xl border border-border">
            <button
              type="button"
              onClick={() => { setActiveTab('running'); if (searchQuery.trim()) setSearchQuery(''); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'running'
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-muted hover:text-text hover:bg-bg'
              }`}
            >
              <Clock size={13} />
              <span>Running Orders</span>
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                activeTab === 'running' ? 'bg-bg/30 text-inherit' : 'bg-bg text-muted border border-border'
              }`}>
                {tabCounts.running}
              </span>
            </button>

            <button
              type="button"
              onClick={() => { setActiveTab('ready'); if (searchQuery.trim()) setSearchQuery(''); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'ready'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-muted hover:text-text hover:bg-bg'
              }`}
            >
              <CheckCircle2 size={13} />
              <span>Ready for Pickup</span>
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                activeTab === 'ready' ? 'bg-bg/30 text-inherit' : 'bg-bg text-muted border border-border'
              }`}>
                {tabCounts.ready}
              </span>
            </button>

            <button
              type="button"
              onClick={() => { setActiveTab('completed'); if (searchQuery.trim()) setSearchQuery(''); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'completed'
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-muted hover:text-text hover:bg-bg'
              }`}
            >
              <Package size={13} />
              <span>Completed</span>
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                activeTab === 'completed' ? 'bg-bg/30 text-inherit' : 'bg-bg text-muted border border-border'
              }`}>
                {tabCounts.completed}
              </span>
            </button>
          </div>
        </div>

        {/* Right: Date Range, Fold Toggle, Remind Uncollected, Refresh, New Request */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Date Picker Controls (prominent in completed tab, or manual) */}
          <div className="flex items-center gap-1.5 bg-bg border border-border px-2.5 py-1 rounded-xl text-xs">
            <Calendar size={13} className="text-muted" />
            <input
              type="date"
              value={toDateInputValue(dateFrom)}
              onChange={e => setDateFrom(e.target.value)}
              className="bg-transparent text-text font-medium focus:outline-none text-[11px]"
            />
            <span className="text-muted text-[10px]">to</span>
            <input
              type="date"
              value={toDateInputValue(dateTo)}
              onChange={e => {
                setManualToDate(true);
                setDateTo(e.target.value);
              }}
              className="bg-transparent text-text font-medium focus:outline-none text-[11px]"
            />
          </div>

          {/* Quick Date Presets */}
          <div className="flex items-center bg-bg3/60 p-0.5 rounded-lg border border-border">
            <button
              onClick={() => { setDateFrom(getNDaysAgoString(15)); setDateTo(getTodayString()); setManualToDate(false); }}
              className="px-2 py-0.5 text-[10px] font-semibold text-muted hover:text-text rounded cursor-pointer"
            >
              15d
            </button>
            <button
              onClick={() => { setDateFrom(getNDaysAgoString(30)); setDateTo(getTodayString()); setManualToDate(false); }}
              className="px-2 py-0.5 text-[10px] font-semibold text-muted hover:text-text rounded cursor-pointer"
            >
              30d
            </button>
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); }}
              className="px-2 py-0.5 text-[10px] font-semibold text-muted hover:text-text rounded cursor-pointer"
            >
              All
            </button>
          </div>

          {/* Fold / Unfold All Button */}
          <button
            onClick={() => {
              const next = !expandAll;
              setExpandAll(next);
              const map: Record<string, boolean> = {};
              customerGroups.forEach(g => { map[g.key] = next; });
              setExpandedCustomers(map);
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-bg3 hover:bg-bg border border-border text-muted hover:text-text text-xs font-semibold transition-all cursor-pointer"
            title="Toggle folding for all customer groups"
          >
            {expandAll ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            <span>{expandAll ? 'Fold All' : 'Unfold All'}</span>
          </button>

          {/* Check Uncollected Orders Button */}
          <button
            onClick={handleScanUncollected}
            disabled={refreshing || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
            title="Check orders ready for 2+ days pending pickup"
          >
            <AlertTriangle size={13} className={refreshing ? 'animate-spin' : ''} />
            <span>Check Uncollected</span>
          </button>

          <button
            onClick={loadOrders}
            className="p-2 rounded-xl bg-bg3 hover:bg-bg border border-border text-muted hover:text-text transition-all cursor-pointer"
            title="Refresh special orders"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>

          <button
            type="button"
            onClick={() => setShowDelayModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 text-xs font-bold transition-all cursor-pointer shadow-sm"
            title="Send delay notice to scheduled special orders & refills"
          >
            <Clock size={13} />
            <span>Delay Notice</span>
          </button>

          <button
            onClick={() => {
              setReorderItem(null);
              setShowAddModal(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-md shadow-primary/20 transition-all cursor-pointer"
          >
            <Plus size={14} />
            <span>New Special Request</span>
          </button>
        </div>
      </div>

      {/* Orders List Container */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-3">
        {loading && orders.length === 0 ? (
          <div className="p-12 text-center text-xs text-muted">Loading special requests...</div>
        ) : customerGroups.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center gap-2 text-xs text-muted bg-bg2/40 rounded-2xl border border-border/50">
            <span className="font-semibold text-text text-sm">
              {activeTab === 'running'
                ? 'No running special orders right now.'
                : activeTab === 'ready'
                ? 'No orders waiting for customer pickup.'
                : 'No completed orders found in selected range.'}
            </span>
            {searchQuery.trim().length >= 2 && (
              <div className="flex flex-col items-center gap-2 mt-1">
                <span className="text-amber-400 font-medium text-[12px]">
                  🔍 No match found for "{searchQuery}".
                </span>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="px-3 py-1 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-lg text-[12px] font-bold transition-all cursor-pointer"
                >
                  Clear Search Query
                </button>
              </div>
            )}
          </div>
        ) : (
          customerGroups.map(group => {
            const isExpanded = isSearching || (expandedCustomers[group.key] ?? true);

            return (
              <div
                key={group.key}
                className="bg-bg2/80 rounded-2xl border border-border shadow-sm overflow-hidden transition-all"
              >
                {/* Customer Group Header */}
                <div
                  onClick={() => toggleCustomer(group.key)}
                  className="p-3 bg-bg3/40 hover:bg-bg3/70 border-b border-border/60 flex items-center justify-between gap-3 cursor-pointer transition-colors select-none"
                >
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <div className="w-8 h-8 rounded-xl bg-primary/15 text-primary flex items-center justify-center font-bold text-xs">
                      <Users size={15} />
                    </div>
                    <span className="font-bold text-sm text-text">{group.requester}</span>
                    {group.phone && (
                      <span className="flex items-center gap-1 font-mono text-xs text-muted bg-bg px-2 py-0.5 rounded-md border border-border">
                        <Phone size={11} className="text-muted" />
                        {group.phone}
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded-full bg-primary/10 border border-primary/25 text-primary text-[11px] font-bold">
                      {group.orders.length} {group.orders.length === 1 ? 'Medicine' : 'Medicines'}
                    </span>
                    {group.totalAdvance > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[11px] font-bold">
                        ✨ Advance: ₹{group.totalAdvance.toFixed(2)}
                      </span>
                    )}
                  </div>

                  {/* Section-specific Consolidated Header Actions */}
                  <div className="flex items-center gap-2">
                    {activeTab === 'running' && (
                      <>
                        {group.orders.some(o => o.status !== 'Ordered') && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAddAllSpecialOrdersToCart(group.orders);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-400 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                            title="Add un-ordered medicines to active cart"
                          >
                            <ShoppingCart size={12} />
                            <span>+ Cart</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleBatchStatusUpdate(group.orders.map(o => o.id), 'Ready');
                          }}
                          className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all flex items-center gap-1 cursor-pointer shadow-xs"
                          title="Mark all items as arrived & ready"
                        >
                          <CheckCircle2 size={13} />
                          <span>✓ Mark All Ready</span>
                        </button>
                      </>
                    )}

                    {activeTab === 'ready' && (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSellAllSpecialOrders(group.orders);
                          }}
                          className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black transition-all flex items-center gap-1 cursor-pointer shadow-xs active:scale-95"
                          title="Transfer all ready medicines and advance credit to POS"
                        >
                          <ShoppingCart size={13} />
                          <span>⚡ Sell All in POS</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setArrivalModalData({
                              customerName: group.requester,
                              customerPhone: group.phone,
                              orders: group.orders.map(o => ({
                                id: o.id,
                                product: o.product,
                                qty: o.qty,
                                status: o.status
                              }))
                            });
                          }}
                          className="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition-all flex items-center gap-1 cursor-pointer shadow-xs"
                          title="Send arrival notification on WhatsApp"
                        >
                          <MessageCircle size={12} />
                          <span>Notify Arrival</span>
                        </button>
                      </>
                    )}

                    <span className="p-1 rounded-lg text-muted hover:text-text">
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </span>
                  </div>
                </div>

                {/* Medicines List Body */}
                {isExpanded && (
                  <div className="p-3 space-y-2">
                    {group.orders.map(order => renderOrderItem(order))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Add / Re-order Special Request Modal inside CRM */}
      <SpecialOrderAddModal
        isOpen={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          setReorderItem(null);
        }}
        onOrderCreated={async () => {
          await loadOrders();
          specialOrdersEvent.triggerUpdated();
          window.dispatchEvent(new CustomEvent('refresh-special-orders'));
        }}
        existingOrders={orders}
        initialOrder={reorderItem}
      />

      {/* Edit Special Request Modal */}
      {showEditModal && editingOrder && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 p-4 animate-fade-in">
          <div className="glass-panel w-[95vw] max-w-4xl h-[85vh] min-h-[560px] max-h-[820px] flex flex-col bg-bg2 rounded-2xl border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.12)] overflow-hidden">
            <div className="p-4 border-b border-border flex justify-between items-center bg-bg3/50 shrink-0">
              <h3 className="font-bold text-sm text-text flex items-center gap-2">
                <Pencil size={16} className="text-primary" />
                Edit Special Order Request #{editingOrder.id}
              </h3>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setEditingOrder(null);
                }}
                className="p-1 rounded-lg hover:bg-bg3 text-muted hover:text-text"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-4 space-y-3.5 text-xs flex-1 min-h-0 overflow-y-auto">
              {/* Product Name */}
              <div className="space-y-1.5">
                <label className="block font-semibold text-text">Requested Medicine Name *</label>
                <input
                  type="text"
                  required
                  placeholder="Medicine name..."
                  value={editProduct}
                  onChange={e => setEditProduct(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-bg border border-border rounded-xl font-medium focus:outline-none focus:border-primary text-xs"
                />
              </div>

              {/* Customer Name & Phone */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <SalutationNameInput
                    label="Customer Name"
                    required={true}
                    salutation={editSalutation}
                    customSalutation={editCustomSalutation}
                    name={editRequester}
                    onSalutationChange={(sal, custom) => {
                      setEditSalutation(sal);
                      if (custom !== undefined) setEditCustomSalutation(custom);
                    }}
                    onNameChange={(val) => setEditRequester(val)}
                    enablePatientAutocomplete={true}
                    onSelectPatient={(patient) => {
                      setEditCustomerId(patient.id);
                      if (patient.phone) setEditPhone(patient.phone);
                      if (patient.language) setEditLanguage(patient.language);
                    }}
                    placeholder="Customer Name"
                  />
                </div>
                <div>
                  <PhoneInputWithBadge
                    label="Phone (WhatsApp) *"
                    value={editPhone}
                    onChange={val => setEditPhone(val)}
                    required={true}
                    allowEmpty={false}
                    enablePatientAutocomplete={true}
                    onSelectPatient={(patient) => {
                      setEditCustomerId(patient.id);
                      const parsed = parseSalutationAndName(patient.name);
                      setEditSalutation(parsed.salutation);
                      setEditCustomSalutation(parsed.customSalutation);
                      setEditRequester(parsed.name);
                      if (patient.language) setEditLanguage(patient.language);
                    }}
                  />
                </div>
              </div>

              {/* Quantity, Advance Payment & Priority */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-text mb-1">Quantity *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={editQty}
                    onChange={e => setEditQty(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-xl font-medium focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-text mb-1">Advance Paid (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={editAdvancePayment}
                    onChange={e => setEditAdvancePayment(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-xl font-semibold text-emerald-400 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-text mb-1">Priority</label>
                  <select
                    value={editPriority}
                    onChange={e => setEditPriority(e.target.value)}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-xl font-medium focus:outline-none focus:border-primary"
                  >
                    <option value="Low">Low</option>
                    <option value="Normal">Normal</option>
                    <option value="High">High Priority</option>
                  </select>
                </div>
              </div>

              {/* Status & Distributor */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-text mb-1">Order Status</label>
                  <select
                    value={editStatus}
                    onChange={e => setEditStatus(e.target.value)}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-xl font-medium focus:outline-none focus:border-primary"
                  >
                    <option value="Inquiry">Inquiry (Pending Approval)</option>
                    <option value="Pending">Pending</option>
                    <option value="Waiting">Waiting</option>
                    <option value="Ordered">Ordered</option>
                    <option value="Ready">Ready (Arrived)</option>
                    <option value="Fulfilled">Fulfilled</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                  {editStatus === 'Ready' && editNotOnWa && (
                    <p className="text-[10px] text-rose-400 font-medium mt-1 flex items-center gap-1">
                      <span>🔴</span> Phone not on WhatsApp: Order will be marked Ready in store without sending WhatsApp.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block font-semibold text-text mb-1">Pharmarack Distributor</label>
                  <input
                    type="text"
                    placeholder="Distributor Name (optional)"
                    value={editDistributor}
                    onChange={e => setEditDistributor(e.target.value)}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-xl font-medium focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 mt-2 border-t border-border shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false);
                    setEditingOrder(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-bg3 border border-border text-muted hover:text-text font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editFormSubmitting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold shadow-md shadow-primary/20 transition-all disabled:opacity-50"
                >
                  {editFormSubmitting ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Check size={14} />
                      <span>Save Changes</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Consolidated Arrival & Delay Preview Modal */}
      {arrivalModalData && (
        <SpecialOrderArrivalModal
          isOpen={!!arrivalModalData}
          onClose={() => setArrivalModalData(null)}
          customerName={arrivalModalData.customerName}
          customerPhone={arrivalModalData.customerPhone}
          orders={arrivalModalData.orders}
          onSuccess={() => {
            whatsappQueueEvent.triggerUpdated();
            loadOrders();
          }}
        />
      )}

      {/* Live Cart Quantity Auto-Adjustment Animated Notification Card */}
      {cartAdjustmentNotice && createPortal(
        <div className="fixed top-16 right-6 z-50 animate-in fade-in slide-in-from-top-5 duration-300 pointer-events-auto">
          <div className="bg-bg2/95 border border-glass-border shadow-[0_4px_24px_rgba(0,0,0,0.12)] rounded-2xl p-4 max-w-sm w-88 flex flex-col gap-2.5 transition-all">
            <div className="flex items-center justify-between gap-2 border-b border-glass-border/40 pb-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  <ShoppingCart size={13} />
                </div>
                <span className="text-xs font-bold text-text uppercase tracking-wider">
                  Live Cart {cartAdjustmentNotice.action === 'adjusted' ? 'Auto-Adjusted' : 'Item Removed'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setCartAdjustmentNotice(null)}
                className="text-muted hover:text-text p-1 rounded-lg hover:bg-bg3 transition-colors cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex flex-col gap-1">
              <span className="font-extrabold text-sm text-text truncate">
                {cartAdjustmentNotice.productName}
              </span>
              {cartAdjustmentNotice.storeName && (
                <span className="text-[11px] text-muted">
                  Distributor: <span className="text-text font-medium">{cartAdjustmentNotice.storeName}</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              {cartAdjustmentNotice.action === 'adjusted' ? (
                <>
                  <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center gap-1">
                    Special Req: -{cartAdjustmentNotice.deductedQty}
                  </span>
                  <span className="text-[10px] font-extrabold px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                    ✓ Ordering {cartAdjustmentNotice.remainingQty} for Shelf
                  </span>
                </>
              ) : (
                <span className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  Entire {cartAdjustmentNotice.deductedQty} qty removed from cart
                </span>
              )}
            </div>

            <p className="text-[10px] text-muted leading-relaxed">
              {cartAdjustmentNotice.action === 'adjusted'
                ? 'Special order cancelled. Your pharmacy shelf quantity has been preserved in the live cart.'
                : 'Item has been deleted from your Pharmarack live cart.'}
            </p>
          </div>
        </div>,
        document.body
      )}

      {/* Delay Notice Modal */}
      {showDelayModal && (
        <DelayNoticeModal
          isOpen={showDelayModal}
          onClose={() => setShowDelayModal(false)}
          onDispatched={loadOrders}
        />
      )}

      {/* ₹50 Advance Payment QR Modal */}
      {paymentQrModalData && createPortal(
        <div className="fixed inset-0 z-global-modal bg-black/70 flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl w-[95vw] max-w-md p-6 shadow-[0_4px_24px_rgba(0,0,0,0.12)] space-y-4 animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400">
                  <QrCode size={18} />
                </div>
                <div>
                  <h3 className="font-bold text-base text-text">Special Order Payment QR</h3>
                  <p className="text-[11px] text-muted">Scan to pay booking advance via UPI</p>
                </div>
              </div>
              <button
                onClick={() => setPaymentQrModalData(null)}
                className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Order Details Card */}
            <div className="bg-bg border border-border rounded-xl p-3.5 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted font-medium">Order Code:</span>
                <span className="font-extrabold text-text px-1.5 py-0.5 rounded bg-bg3 border border-border">{paymentQrModalData.so_code}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted font-medium">Customer:</span>
                <span className="font-semibold text-text">{paymentQrModalData.customer_name} ({paymentQrModalData.customer_phone})</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted font-medium">Medicine:</span>
                <span className="font-bold text-text truncate max-w-[200px]">{paymentQrModalData.medicine_name}</span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-border">
                <span className="text-muted font-medium">Booking Advance:</span>
                <span className="text-base font-extrabold text-emerald-400">₹{Number(paymentQrModalData.amount).toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted font-medium">Payment Status:</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                  paymentQrModalData.payment_status === 'PAYMENT_CONFIRMED'
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                    : paymentQrModalData.payment_status === 'AWAITING_PAYMENT'
                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                    : 'bg-zinc-500/15 text-muted border border-border'
                }`}>
                  {paymentQrModalData.payment_status || 'UNPAID'}
                </span>
              </div>
            </div>

            {/* QR Code Display */}
            <div className="flex flex-col items-center justify-center p-4 bg-bg3 border border-border rounded-2xl shadow-inner">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(paymentQrModalData.upi_uri)}`}
                alt="UPI Payment QR"
                className="w-48 h-48 rounded-lg shadow-sm"
              />
              <div className="mt-2 text-center">
                <p className="text-xs font-bold text-text">{paymentQrModalData.payee_name}</p>
                <p className="text-[11px] font-mono text-muted">{paymentQrModalData.upi_id}</p>
              </div>
            </div>

            {/* Action Buttons (Human-in-the-Loop approval and quick share) */}
            <div className="flex flex-col gap-2 pt-1">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleSendPaymentQrWa(paymentQrModalData.order_id)}
                  disabled={sendingPaymentQrId === paymentQrModalData.order_id}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-500/20 transition-all cursor-pointer disabled:opacity-50"
                  title="Send ₹50 QR image and UPI instructions directly to customer WhatsApp"
                >
                  <Send size={14} className={sendingPaymentQrId === paymentQrModalData.order_id ? 'animate-spin' : ''} />
                  <span>{sendingPaymentQrId === paymentQrModalData.order_id ? 'Sending WA...' : '📲 Send QR via WhatsApp'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(paymentQrModalData.upi_uri);
                    toastEvent.trigger('UPI Payment link copied to clipboard!', 'success', '/crm');
                  }}
                  className="px-3 py-2.5 rounded-xl bg-bg3 hover:bg-bg border border-border text-text text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                  title="Copy UPI Deep Link to clipboard"
                >
                  <Copy size={13} />
                  <span>Copy Link</span>
                </button>
              </div>

              {/* Human Approval / Mark as Paid */}
              {paymentQrModalData.payment_status === 'PAYMENT_CONFIRMED' ? (
                <div className="w-full py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold text-center flex items-center justify-center gap-1.5">
                  <CheckCircle2 size={14} />
                  <span>Advance Payment Confirmed (₹{Number(paymentQrModalData.amount).toFixed(2)})</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => handleMarkPaymentQrPaid(paymentQrModalData.order_id)}
                  className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/40 text-blue-400 text-xs font-bold transition-all cursor-pointer"
                  title="Manually mark ₹50 advance payment as received and confirmed"
                >
                  <Check size={14} />
                  <span>Confirm / Mark Paid (₹{Number(paymentQrModalData.amount).toFixed(2)})</span>
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Modify Items Modal */}
      {modifyingOrder && (
        <OrderModifyModal
          order={modifyingOrder}
          onClose={() => setModifyingOrder(null)}
          onSuccess={async () => {
            await loadOrders();
            specialOrdersEvent.triggerUpdated();
          }}
        />
      )}
    </div>
  );
};
