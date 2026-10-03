import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw, Send, Users, Phone,
  Calendar, CheckCircle2, Clock, Search,
  Repeat2, MessageCircle, Check, Copy,
  X, Plus, Trash2, ChevronDown,
  ChevronUp, ClipboardList, ShoppingCart, AlertTriangle,
  Pencil, Edit3, RotateCcw, QrCode
} from 'lucide-react';
import { apiClient, api } from '../../services/api';
import { toastEvent, specialOrdersEvent, messageSendEvent, whatsappQueueEvent } from '../../services/events';
import { useOnClickOutside } from '../../hooks/useOnClickOutside';
import { useDropdownAutoScroll } from '../../hooks/useDropdownAutoScroll';
import { useModalEscape } from '../../services/keyboardShortcuts';
import { useWaPhoneStatus } from '../../hooks/useWaPhoneStatus';
import { getTodayString, getNDaysAgoString, toDateInputValue } from '../../utils/date';
import { PhoneInputWithBadge } from '../../components/PhoneInputWithBadge';
import { SalutationNameInput, combineSalutationAndName, parseSalutationAndName } from '../../components/SalutationNameInput';
import { SpecialOrderArrivalModal } from '../../components/SpecialOrderArrivalModal';
import { DelayNoticeModal } from '../../components/DelayNoticeModal';
import { OrderModifyModal } from '../../components/OrderModifyModal';
import { withSilentRetry, formatDate, type LocalApiError, type PharmarackSearchResult } from './crmTypes';

interface SpecialOrderItem {
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
  const [orders, setOrders] = useState<SpecialOrderItem[]>(cachedSpecialOrders);
  const [loading, setLoading] = useState(cachedSpecialOrders.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
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

  // New Request Form State
  const [product, setProduct] = useState('');
  const [orderSalutation, setOrderSalutation] = useState('Mr.');
  const [orderCustomSalutation, setOrderCustomSalutation] = useState('');
  const [requester, setRequester] = useState('');
  const [phone, setPhone] = useState('');
  const [qty, setQty] = useState<number | ''>(1);
  const [advancePayment, setAdvancePayment] = useState<number | ''>('');
  const [priority, setPriority] = useState('Normal');
  const [language, setLanguage] = useState('en');
  const [sendWhatsApp, setSendWhatsApp] = useState(() => {
    try {
      return localStorage.getItem('crm_order_send_whatsapp') !== 'false';
    } catch {
      return true;
    }
  });
  // WA registration check — disables booking alert toggle when number confirmed not on WA
  const { isNotOnWa: bookingNotOnWa } = useWaPhoneStatus(phone.replace(/\D/g, '').slice(-10));
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [showDelayModal, setShowDelayModal] = useState(false);

  // Edit Request Form State
  const [editingOrder, setEditingOrder] = useState<SpecialOrderItem | null>(null);
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

  // Pharmarack Search States
  const [prSearchResults, setPrSearchResults] = useState<PharmarackSearchResult[]>([]);
  const [showPrDropdown, setShowPrDropdown] = useState(false);
  const [activePrIndex, setActivePrIndex] = useState(0);
  const [loadingPr, setLoadingPr] = useState(false);
  const prDropdownRef = useRef<HTMLDivElement>(null);

  useDropdownAutoScroll(prDropdownRef, activePrIndex, showPrDropdown);

  const productContainerRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(productContainerRef, () => {
    setShowPrDropdown(false);
  });

  // Selected Pharmarack Metadata Form State
  const [selectedDistributor, setSelectedDistributor] = useState('');
  const [selectedRate, setSelectedRate] = useState<number | ''>('');
  const [selectedMrp, setSelectedMrp] = useState<number | ''>('');
  const [selectedMapped, setSelectedMapped] = useState(true);
  const [selectedScheme, setSelectedScheme] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | number>('');
  const [selectedStoreId, setSelectedStoreId] = useState<string | number>('');
  const [selectedProductCode, setSelectedProductCode] = useState('');
  const [selectedCompany, setSelectedCompany] = useState('');
  const [selectedPackaging, setSelectedPackaging] = useState('');

  // Special order draft persistence & resumption
  const [hasSpecialOrderDraft, setHasSpecialOrderDraft] = useState(false);

  useEffect(() => {
    if (showAddModal) {
      try {
        const raw = localStorage.getItem('crm_special_order_draft');
        if (raw) {
          const draft = JSON.parse(raw);
          if (draft && (draft.product || draft.requester || draft.phone)) {
            setProduct(draft.product || '');
            setOrderSalutation(draft.orderSalutation || 'Mr.');
            setOrderCustomSalutation(draft.orderCustomSalutation || '');
            setRequester(draft.requester || '');
            setPhone(draft.phone || '');
            setQty(draft.qty || 1);
            setAdvancePayment(draft.advancePayment || '');
            setPriority(draft.priority || 'Normal');
            setLanguage(draft.language || 'en');
            setSelectedDistributor(draft.selectedDistributor || '');
            setSelectedRate(draft.selectedRate || '');
            setSelectedMrp(draft.selectedMrp || '');
            setSelectedMapped(draft.selectedMapped ?? true);
            setSelectedScheme(draft.selectedScheme || '');
            setSelectedProductId(draft.selectedProductId || '');
            setSelectedStoreId(draft.selectedStoreId || '');
            setSelectedProductCode(draft.selectedProductCode || '');
            setSelectedCompany(draft.selectedCompany || '');
            setSelectedPackaging(draft.selectedPackaging || '');
            setHasSpecialOrderDraft(true);
          }
        }
      } catch (_) {}
    }
  }, [showAddModal]);

  useEffect(() => {
    if (!showAddModal) return;
    const hasContent = product.trim() || requester.trim() || phone.trim();
    if (hasContent) {
      const draft = {
        product,
        orderSalutation,
        orderCustomSalutation,
        requester,
        phone,
        qty,
        advancePayment,
        priority,
        language,
        selectedDistributor,
        selectedRate,
        selectedMrp,
        selectedMapped,
        selectedScheme,
        selectedProductId,
        selectedStoreId,
        selectedProductCode,
        selectedCompany,
        selectedPackaging,
      };
      localStorage.setItem('crm_special_order_draft', JSON.stringify(draft));
      setHasSpecialOrderDraft(true);
    }
  }, [showAddModal, product, orderSalutation, orderCustomSalutation, requester, phone, qty, advancePayment, priority, language, selectedDistributor, selectedRate, selectedMrp, selectedMapped, selectedScheme, selectedProductId, selectedStoreId, selectedProductCode, selectedCompany, selectedPackaging]);

  const handleClearSpecialOrderDraft = () => {
    localStorage.removeItem('crm_special_order_draft');
    setProduct('');
    setOrderSalutation('Mr.');
    setOrderCustomSalutation('');
    setRequester('');
    setPhone('');
    setQty(1);
    setAdvancePayment('');
    setPriority('Normal');
    setSelectedDistributor('');
    setSelectedRate('');
    setSelectedMrp('');
    setSelectedScheme('');
    setSelectedProductId('');
    setSelectedStoreId('');
    setSelectedProductCode('');
    setSelectedCompany('');
    setSelectedPackaging('');
    setHasSpecialOrderDraft(false);
    toastEvent.trigger('Special order draft discarded', 'info', '/crm');
  };

  // Past Orders Lookup & Reorder for this patient
  const cleanPhone = phone.replace(/\D/g, '').slice(-10);
  const patientPastOrders = useMemo(() => {
    if (!cleanPhone || cleanPhone.length < 8) return [];
    return orders.filter(o => {
      const op = (o.phone || '').replace(/\D/g, '').slice(-10);
      return op === cleanPhone;
    });
  }, [orders, cleanPhone]);

  const handleReorderPastItem = (past: SpecialOrderItem) => {
    isSelectingPrRef.current = true;
    setProduct(past.product);
    setQty(past.qty || 1);
    if (past.requester && !requester) {
      const { salutation, customSalutation, name: customerName } = parseSalutationAndName(past.requester);
      setOrderSalutation(salutation);
      setOrderCustomSalutation(customSalutation);
      setRequester(customerName);
    }
    if (past.pharmarack_distributor) setSelectedDistributor(past.pharmarack_distributor);
    if (past.pharmarack_rate) setSelectedRate(past.pharmarack_rate);
    if (past.pharmarack_mrp) setSelectedMrp(past.pharmarack_mrp);
    if (past.pharmarack_product_id) setSelectedProductId(past.pharmarack_product_id);
    if (past.pharmarack_store_id) setSelectedStoreId(past.pharmarack_store_id);
    if (past.pharmarack_product_code) setSelectedProductCode(past.pharmarack_product_code);
    toastEvent.trigger(`Reordered "${past.product}" (Qty: ${past.qty || 1})!`, 'success', '/crm');
  };

  // WhatsApp Chat Intelligence for this patient
  const [waMessages, setWaMessages] = useState<any[]>([]);
  const [loadingWaMessages, setLoadingWaMessages] = useState(false);

  useEffect(() => {
    if (!showAddModal || !cleanPhone || cleanPhone.length < 10) {
      setWaMessages([]);
      return;
    }
    let cancelled = false;
    setLoadingWaMessages(true);
    apiClient.get<any[]>(`/messaging/chats/${encodeURIComponent(cleanPhone)}/messages?limit=25`)
      .then(res => {
        if (cancelled) return;
        const list = Array.isArray(res.data) ? res.data : [];
        const patientMsgs = list.filter(m => !m.fromMe && m.body && m.body.trim().length > 1);
        setWaMessages(patientMsgs.slice(-5));
      })
      .catch(() => {
        if (!cancelled) setWaMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingWaMessages(false);
      });
    return () => { cancelled = true; };
  }, [showAddModal, cleanPhone]);

  const isSelectingPrRef = useRef(false);

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

  // Debounced search for Pharmarack products
  useEffect(() => {
    if (isSelectingPrRef.current) return;
    if (!product.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears dropdown when input empties
      setPrSearchResults([]);
      setShowPrDropdown(false);
      setActivePrIndex(0);
      return;
    }

    const timer = setTimeout(async () => {
      if (isSelectingPrRef.current) return;
      setLoadingPr(true);
      try {
        const results = await api.searchPharmarack(product);
        if (isSelectingPrRef.current) return;
        const matches = Array.isArray(results) ? (results as PharmarackSearchResult[]) : [];
        setPrSearchResults(matches);
        setShowPrDropdown(matches.length > 0);
        setActivePrIndex(0);
      } catch (err) {
        console.error('Pharmarack query failed:', err);
      } finally {
        setLoadingPr(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [product]);

  const handleSelectPharmarackItem = (item: PharmarackSearchResult) => {
    isSelectingPrRef.current = true;
    setProduct(item.name);
    setSelectedDistributor(item.distributor || '');
    setSelectedRate(item.rate !== null && item.rate !== undefined ? item.rate : '');
    setSelectedMrp(item.mrp !== null && item.mrp !== undefined ? item.mrp : '');
    setSelectedMapped(!!item.mapped);
    setSelectedScheme(item.scheme || '');
    setSelectedProductId(item.productId || '');
    setSelectedStoreId(item.storeId || '');
    setSelectedProductCode(item.productCode || '');
    setSelectedCompany(item.company || '');
    setSelectedPackaging(item.packaging || '');
    setPrSearchResults([]);
    setShowPrDropdown(false);
  };

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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- module-cache hydration loader, event-refresh
    loadOrders();
    const handleRefresh = () => {
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

  const handleSellSpecialOrder = (order: SpecialOrderItem) => {
    const prefill = {
      patientName: order.requester,
      patientPhone: order.phone,
      specialOrderId: order.id,
      advancePayment: order.advance_payment ? Number(order.advance_payment) : 0,
      medicines: [{ medicineName: order.product, quantity_needed: order.qty }]
    };
    toastEvent.trigger(`Transferring "${order.product}" (Qty: ${order.qty}) to POS for ${order.requester}...`, 'info', '/pos');
    navigate('/pos', { state: { prefill } });
  };

  const handleAddToCart = async (order: SpecialOrderItem) => {
    setAddingCartId(order.id);
    try {
      const res = await api.addPharmarackCart([{
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
      }]);
      if (res && res.success) {
        toastEvent.trigger(`Added "${order.product}" to Pharmarack cart!`, 'success', '/crm');
        await api.updateOrder(order.id, { status: 'Ordered' });

        // Send booking confirmation WhatsApp message to the customer
        if (order.phone) {
          try {
            messageSendEvent.triggerSendProgress(order.requester || order.phone || 'Customer', `Booking confirmation for ${order.product}`, 10);
            await api.resendSpecialOrderBooking(order.id);
            toastEvent.trigger(`Booking WhatsApp sent to ${order.requester || 'Customer'}!`, 'success', '/crm');
            whatsappQueueEvent.triggerUpdated();
          } catch (waErr) {
            console.warn('Failed to send booking WhatsApp on add to cart:', waErr);
          }
        }

        await loadOrders();
        window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'));
      } else {
        toastEvent.trigger(res?.error || 'Failed to add item to cart', 'error', '/crm');
      }
    } catch (err) {
      toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to add to cart', 'error', '/crm');
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

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const customerName = combineSalutationAndName(orderSalutation, orderCustomSalutation, requester);
    const customerPhone = phone.replace(/\D/g, '');

    if (!product.trim()) {
      toastEvent.trigger('Product name is required.', 'error', '/crm');
      return;
    }
    if (!customerName) {
      toastEvent.trigger('Customer Name is required.', 'error', '/crm');
      return;
    }
    if (!customerPhone || customerPhone.length < 8 || customerPhone.length > 15) {
      setShakePhone(true);
      setTimeout(() => setShakePhone(false), 400);
      toastEvent.trigger('Please enter a valid phone number (8–15 digits).', 'error', '/crm');
      return;
    }
    if (!qty || Number(qty) < 1) {
      toastEvent.trigger('Quantity must be at least 1.', 'error', '/crm');
      return;
    }

    setFormSubmitting(true);
    try {
      if (Boolean(sendWhatsApp) && customerPhone) {
        messageSendEvent.triggerSendProgress(customerName || 'Customer', `Booking confirmation for ${product.trim()}`, 10);
      }
      await api.createOrder({
        product: product.trim(),
        requester: customerName,
        phone: customerPhone,
        qty: Number(qty) || 1,
        priority,
        status: 'Pending',
        language,
        sendWhatsApp: Boolean(sendWhatsApp),
        pharmarack_distributor: selectedDistributor || undefined,
        pharmarack_rate: selectedRate !== '' ? Number(selectedRate) : undefined,
        pharmarack_mrp: selectedMrp !== '' ? Number(selectedMrp) : undefined,
        pharmarack_mapped: selectedMapped ? 1 : 0,
        pharmarack_scheme: selectedScheme || undefined,
        pharmarack_product_id: selectedProductId ? Number(selectedProductId) : undefined,
        pharmarack_product_code: selectedProductCode || undefined,
        pharmarack_store_id: selectedStoreId ? Number(selectedStoreId) : undefined,
        pharmarack_product_name: product.trim() || undefined,
        advance_payment: advancePayment !== '' ? Number(advancePayment) : 0
      });

      // Auto sync to Pharmarack Cart
      try {
        const cartRes = await api.addPharmarackCart([{
          productId: selectedProductId || 0,
          storeId: selectedStoreId || 0,
          qty: Number(qty) || 1,
          rate: selectedRate !== '' ? Number(selectedRate) : undefined,
          scheme: selectedScheme || undefined,
          productCode: selectedProductCode || undefined,
          company: selectedCompany || undefined,
          productName: product.trim(),
          storeName: selectedDistributor || undefined,
          packaging: selectedPackaging || undefined,
          mapped: selectedMapped
        }]);
        if (cartRes && cartRes.success) {
          window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'));
        }
      } catch (_) {}

      localStorage.removeItem('crm_special_order_draft');
      setHasSpecialOrderDraft(false);
      setShowAddModal(false);
      setProduct('');
      setOrderSalutation('Mr.');
      setOrderCustomSalutation('');
      setRequester('');
      setPhone('');
      setQty(1);
      setAdvancePayment('');
      setPriority('Normal');
      setLanguage('en');
      try {
        setSendWhatsApp(localStorage.getItem('crm_order_send_whatsapp') !== 'false');
      } catch {}
      setSelectedDistributor('');
      setSelectedRate('');
      setSelectedMrp('');
      setSelectedMapped(true);
      setSelectedScheme('');
      setSelectedProductId('');
      setSelectedStoreId('');
      setSelectedProductCode('');
      setSelectedCompany('');
      setSelectedPackaging('');
      isSelectingPrRef.current = false;
      await loadOrders();
      specialOrdersEvent.triggerUpdated();
    } catch (err) {
      toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to log special request', 'error', '/crm');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleOpenEditModal = (order: SpecialOrderItem) => {
    setEditingOrder(order);
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
    if (!customerPhone || customerPhone.length < 8 || customerPhone.length > 15) {
      setShakeEditPhone(true);
      setTimeout(() => setShakeEditPhone(false), 400);
      toastEvent.trigger('Customer phone number must be 8–15 digits.', 'error', '/crm');
      return;
    }
    if (!editQty || Number(editQty) < 1) {
      toastEvent.trigger('Quantity must be at least 1.', 'error', '/crm');
      return;
    }

    setEditFormSubmitting(true);
    try {
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

  const filteredOrders = orders.filter(o => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch = !q || 
      (o.product && o.product.toLowerCase().includes(q)) ||
      (o.requester && o.requester.toLowerCase().includes(q)) ||
      (o.phone && o.phone.includes(q)) ||
      (o.pharmarack_distributor && o.pharmarack_distributor.toLowerCase().includes(q));
    
    if (!matchesSearch) return false;

    let matchesStatus = true;
    if (statusFilter === 'Pending') matchesStatus = o.status === 'Pending';
    else if (statusFilter === 'Ordered') matchesStatus = o.status === 'Ordered';
    else if (statusFilter === 'Waiting') matchesStatus = o.status === 'Waiting';
    else if (statusFilter === 'Arrived') matchesStatus = o.status === 'Ready' || o.status === 'Arrived';
    else if (statusFilter === 'Not Arrived') matchesStatus = o.status !== 'Ready' && o.status !== 'Arrived' && o.status !== 'Fulfilled' && o.status !== 'Cancelled';
    else if (statusFilter === 'Cancelled') matchesStatus = o.status === 'Cancelled';

    if (!matchesStatus) return false;

    let matchesDate = true;
    // Smart range expansion: search term auto-expands across all database history unless manual date is pinned
    if (!isSearching && (dateFrom || dateTo)) {
      if (!o.date) {
        matchesDate = false;
      } else {
        const itemDate = o.date.substring(0, 10);
        const start = dateFrom || '0000-00-00';
        const end = dateTo || '9999-99-99';
        matchesDate = itemDate >= start && itemDate <= end;
      }
    }
    return matchesDate;
  });

  // Group filtered orders by customer phone / requester
  const customerGroups = React.useMemo(() => {
    const groupsMap = new Map<string, {
      key: string;
      requester: string;
      phone: string;
      orders: SpecialOrderItem[];
      activeOrders: SpecialOrderItem[];
      pastOrders: SpecialOrderItem[];
      activeCount: number;
      arrivedCount: number;
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
          activeOrders: [],
          pastOrders: [],
          activeCount: 0,
          arrivedCount: 0,
          totalAdvance: 0
        });
      }

      const group = groupsMap.get(groupKey)!;
      group.orders.push(order);
      if (order.advance_payment && Number(order.advance_payment) > 0) {
        group.totalAdvance += Number(order.advance_payment);
      }

      if (order.status === 'Fulfilled' || order.status === 'Cancelled') {
        group.pastOrders.push(order);
      } else {
        group.activeOrders.push(order);
        group.activeCount++;
        if (order.status === 'Ready' || order.status === 'Arrived') {
          group.arrivedCount++;
        }
      }
    });

    return Array.from(groupsMap.values());
  }, [filteredOrders]);

  const renderOrderCard = (order: SpecialOrderItem) => {
    const isArrived = order.status === 'Ready' || order.status === 'Arrived';
    const isOrdered = order.status === 'Ordered';
    const isPast = order.status === 'Fulfilled' || order.status === 'Cancelled';
    const hasAdvance = order.advance_payment && Number(order.advance_payment) > 0;

    return (
      <div
        key={order.id}
        className={`p-3.5 rounded-xl border transition-all ${
          isArrived
            ? 'bg-emerald-500/5 border-emerald-500/30'
            : order.status === 'Waiting'
            ? 'bg-amber-500/5 border-amber-500/30'
            : isOrdered
            ? 'bg-indigo-500/5 border-indigo-500/30'
            : isPast
            ? 'bg-bg/40 border-border/40 opacity-75'
            : 'bg-bg2 border-border hover:border-primary/40'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          {/* Left Column: Product & Details */}
          <div className="space-y-1 flex-1 min-w-[240px]">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-sm text-text">{order.product}</h3>
              <span className="px-2 py-0.5 rounded-md bg-bg3 border border-border text-[11px] font-bold text-primary">
                Qty: {order.qty}
              </span>
              {hasAdvance && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-extrabold flex items-center gap-1">
                  ✨ Advance: ₹{Number(order.advance_payment).toFixed(2)}
                </span>
              )}
              {order.payment_status === 'PAYMENT_CONFIRMED' ? (
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-extrabold flex items-center gap-1">
                  ✅ Advance Paid
                </span>
              ) : order.payment_status === 'AWAITING_PAYMENT' ? (
                <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-extrabold flex items-center gap-1">
                  ⏳ Awaiting ₹50
                </span>
              ) : null}
              {order.priority && (
                <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold ${
                  order.priority === 'High' ? 'bg-red-500/15 text-red-400 border border-red-500/30' : 'bg-bg3 text-muted border border-border'
                }`}>
                  {order.priority}
                </span>
              )}
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                isArrived
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : order.status === 'Waiting'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                  : isOrdered
                  ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40'
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
              <span className="text-[10px]">
                Logged: {formatDate(order.date)}
              </span>
            </div>
          </div>

          {/* Right Column: Status Action Bar */}
          <div className="flex items-center gap-1.5 flex-wrap shrink-0">
            {/* Sell Now Button */}
            <button
              onClick={() => handleSellSpecialOrder(order)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black shadow-sm shadow-emerald-500/20 transition-all hover:scale-105 active:scale-95 cursor-pointer"
              title="Sell now: Transfers patient, medicine, quantity & advance credit directly to POS"
            >
              <ShoppingCart size={13} />
              <span>⚡ Sell</span>
            </button>

            {/* View / Send ₹50 Payment QR */}
            <button
              onClick={() => handleOpenPaymentQr(order)}
              disabled={loadingPaymentQrId === order.id}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-sm shadow-purple-500/20 transition-all hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-50"
              title="Generate, view, or dispatch ₹50 booking advance payment QR via WhatsApp"
            >
              <QrCode size={13} className={loadingPaymentQrId === order.id ? 'animate-spin' : ''} />
              <span>{loadingPaymentQrId === order.id ? '...' : '💳 ₹50 QR'}</span>
            </button>

            {/* WA Notification Button */}
            {order.notified === 1 ? (
              <button
                onClick={() => handleNotifyArrival(order)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-sm shadow-sky-500/20 transition-all hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-50"
                title="Re-send arrival reminder WhatsApp notification to customer"
              >
                <MessageCircle size={12} />
                <span>Resend WA</span>
              </button>
            ) : (
              <button
                onClick={() => handleNotifyArrival(order)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-sm shadow-sky-500/20 transition-all hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-50"
                title="Manually send WhatsApp arrival notification to customer"
              >
                <MessageCircle size={12} />
                <span>📱 Ready</span>
              </button>
            )}

            {/* Pending Button */}
            {order.status !== 'Pending' && (
              <button
                onClick={() => handleUpdateStatus(order.id, 'Pending')}
                disabled={updatingId === order.id}
                className="flex items-center gap-1 px-2 py-1.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400 hover:bg-blue-500/20 text-xs font-semibold transition-all"
                title="Set status to Pending"
              >
                <Clock size={11} />
                <span>Pending</span>
              </button>
            )}

            {/* Waiting Button */}
            {order.status !== 'Waiting' && (
              <button
                onClick={() => handleUpdateStatus(order.id, 'Waiting')}
                disabled={updatingId === order.id}
                className="flex items-center gap-1 px-2 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 text-xs font-semibold transition-all"
                title="Set status to Waiting"
              >
                <Clock size={11} />
                <span>Waiting</span>
              </button>
            )}

            {/* Add to Pharmarack Cart */}
            <button
              onClick={() => handleAddToCart(order)}
              disabled={addingCartId === order.id}
              className="flex items-center gap-1 px-2 py-1.5 rounded-xl bg-primary/15 hover:bg-primary/25 border border-primary/40 text-primary text-xs font-bold transition-all disabled:opacity-50"
              title="Push special request item directly to Pharmarack Cart"
            >
              <ShoppingCart size={12} className={addingCartId === order.id ? 'animate-spin' : ''} />
              <span>Cart</span>
            </button>

            {/* Convert Refill */}
            <button
              onClick={() => handleConvertToRefill(order)}
              disabled={convertingId === order.id}
              className="flex items-center gap-1 px-2 py-1.5 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-400 text-xs font-semibold transition-all disabled:opacity-50"
              title="Convert special order into recurring patient refill schedule"
            >
              <Repeat2 size={11} />
              <span>Refill</span>
            </button>

            {/* Restore Cancelled Request */}
            {order.status === 'Cancelled' && (
              <button
                onClick={() => handleRestoreOrder(order.id)}
                disabled={restoringId === order.id}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm shadow-emerald-500/20 transition-all cursor-pointer disabled:opacity-50"
                title="Restore cancelled special request back to Pending status"
              >
                <RotateCcw size={11} className={restoringId === order.id ? 'animate-spin' : ''} />
                <span>{restoringId === order.id ? 'Restoring…' : 'Restore'}</span>
              </button>
            )}

            {/* Modify Items Button */}
            <button
              onClick={() => setModifyingOrder(order)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-xl bg-bg2 hover:bg-bg3 border border-border text-text text-xs font-bold transition-all cursor-pointer"
              title="Modify medicines, add items, or adjust quantities"
            >
              <Edit3 size={11} className="text-primary" />
              <span>Modify</span>
            </button>

            {/* Edit Button */}
            <button
              onClick={() => handleOpenEditModal(order)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 text-xs font-bold transition-all cursor-pointer"
              title="Edit Special Order Request details"
            >
              <Pencil size={11} />
              <span>Edit</span>
            </button>

            {/* Cancel Button */}
            {order.status !== 'Cancelled' && (
              <button
                onClick={() => handleDeleteOrder(order.id, order.product)}
                disabled={deletingId === order.id}
                className="flex items-center gap-1 px-2 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 hover:text-red-300 text-xs font-bold transition-all disabled:opacity-50"
                title="Cancel Special Order Request"
              >
                <Trash2 size={11} />
                <span>{deletingId === order.id ? '...' : 'Cancel'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full gap-3 overflow-hidden">
      {/* Top Controls & Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-bg border border-border rounded-xl shrink-0">
        {/* Left: Search & Status Filters */}
        <div className="flex items-center gap-2 flex-1 min-w-[280px]">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Search medicine, customer, phone, distributor (auto-searches all history)..."
              value={searchQuery}
              onChange={e => {
                const val = e.target.value;
                setSearchQuery(val.includes('|') ? val.split('|')[0].trim() : val);
              }}
              className="w-full pl-9 pr-3 py-1.5 bg-bg border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary font-medium"
            />
          </div>
          <div className="flex items-center gap-1 bg-bg3/60 p-1 rounded-xl border border-border">
            {['All', 'Pending', 'Ordered', 'Waiting', 'Arrived', 'Not Arrived', 'Cancelled'].map(st => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                  statusFilter === st ? 'bg-primary text-white shadow-sm' : 'text-muted hover:text-text'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Date Range, Fold Toggle, Remind Uncollected, Refresh, New Request */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Date Picker Controls */}
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
              className="px-2 py-0.5 text-[10px] font-semibold text-muted hover:text-text rounded"
            >
              15d
            </button>
            <button
              onClick={() => { setDateFrom(getNDaysAgoString(30)); setDateTo(getTodayString()); setManualToDate(false); }}
              className="px-2 py-0.5 text-[10px] font-semibold text-muted hover:text-text rounded"
            >
              30d
            </button>
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); }}
              className="px-2 py-0.5 text-[10px] font-semibold text-muted hover:text-text rounded"
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
            className="p-2 rounded-xl bg-bg3 hover:bg-bg border border-border text-muted hover:text-text transition-all"
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
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-md shadow-primary/20 transition-all"
          >
            <Plus size={14} />
            <span>New Special Request</span>
          </button>
        </div>
      </div>

      {/* Orders List Container - Grouped by Customer with Collapsible Fold/Unfold */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-3">
        {loading && orders.length === 0 ? (
          <div className="p-12 text-center text-xs text-muted">Loading special requests...</div>
        ) : customerGroups.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center gap-2 text-xs text-muted bg-bg2/40 rounded-2xl border border-border/50">
            <span className="font-semibold text-text text-sm">No special requests found matching your filter.</span>
            {searchQuery.trim().length >= 2 && (
              <div className="flex flex-col items-center gap-2 mt-1">
                <span className="text-amber-400 font-medium text-[12px]">
                  🔍 No exact match for "{searchQuery}". Please check spelling or try searching by product or patient name.
                </span>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="px-3 py-1 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-lg text-[12px] font-bold transition-all"
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
                {/* Customer Group Header (Fold/Unfold Bar) */}
                <div
                  onClick={() => toggleCustomer(group.key)}
                  className="p-3 bg-bg3/40 hover:bg-bg3/70 border-b border-border/60 flex items-center justify-between gap-3 cursor-pointer transition-colors select-none"
                >
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <div className="w-7 h-7 rounded-lg bg-primary/15 text-primary flex items-center justify-center font-bold text-xs">
                      <Users size={14} />
                    </div>
                    <span className="font-bold text-sm text-text">{group.requester}</span>
                    {group.phone && (
                      <span className="flex items-center gap-1 font-mono text-xs text-muted bg-bg px-2 py-0.5 rounded-md border border-border">
                        <Phone size={11} className="text-muted" />
                        {group.phone}
                      </span>
                    )}
                    {group.activeCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-400 text-[10px] font-bold">
                        {group.activeCount} Active {group.activeCount === 1 ? 'Request' : 'Requests'}
                      </span>
                    )}
                    {group.arrivedCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold flex items-center gap-1">
                        <CheckCircle2 size={10} /> {group.arrivedCount} Ready
                      </span>
                    )}
                    {group.pastOrders.length > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-bg border border-border text-muted text-[10px] font-medium">
                        {group.pastOrders.length} Past
                      </span>
                    )}
                    {group.totalAdvance > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold">
                        ✨ Advance: ₹{group.totalAdvance.toFixed(2)}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-muted text-xs">
                    {group.activeOrders.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setArrivalModalData({
                            customerName: group.requester,
                            customerPhone: group.phone,
                            orders: group.activeOrders.map(o => ({
                              id: o.id,
                              product: o.product,
                              qty: o.qty,
                              status: o.status
                            }))
                          });
                        }}
                        className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30 text-xs font-bold transition-all cursor-pointer flex items-center gap-1 shrink-0"
                        title="Send 1 consolidated WhatsApp arrival/delay message for all medicines"
                      >
                        <MessageCircle size={12} />
                        <span>Notify Arrival ({group.activeOrders.length})</span>
                      </button>
                    )}
                    <span className="text-[11px] font-medium">
                      {isExpanded ? 'Collapse' : `Expand (${group.orders.length})`}
                    </span>
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>

                {/* Customer Orders Body */}
                {isExpanded && (
                  <div className="p-3 space-y-2">
                    {/* Active Orders First */}
                    {group.activeOrders.map(order => renderOrderCard(order))}

                    {/* Past Fulfilled / Cancelled Orders (Tucked Inside If Any) */}
                    {group.pastOrders.length > 0 && (
                      <div className="pt-1">
                        {group.activeOrders.length > 0 && (
                          <div className="text-[10px] font-bold uppercase tracking-wider text-muted py-1 flex items-center gap-2">
                            <span>Past Order History ({group.pastOrders.length})</span>
                            <div className="flex-1 h-px bg-border/40" />
                          </div>
                        )}
                        <div className="space-y-1.5">
                          {group.pastOrders.map(order => renderOrderCard(order))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Add Special Request Modal inside CRM */}
      {showAddModal && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="glass-panel w-[95vw] max-w-lg h-[85vh] min-h-[560px] max-h-[840px] flex flex-col bg-bg2 rounded-2xl border border-primary/20 shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-border flex justify-between items-center bg-bg3/50 shrink-0">
              <h3 className="font-bold text-sm text-text flex items-center gap-2">
                <ClipboardList size={16} className="text-primary" />
                Register Out-of-Stock Special Request
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-lg hover:bg-bg3 text-muted hover:text-text"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateRequest} className="p-4 space-y-3.5 text-xs flex-1 min-h-0 overflow-y-auto">
              {/* Restored Draft Notice */}
              {hasSpecialOrderDraft && (
                <div className="flex items-center justify-between p-2.5 px-3 rounded-xl bg-primary/10 border border-primary/25 text-xs animate-fade-in">
                  <div className="flex items-center gap-2 text-primary font-semibold">
                    <RotateCcw size={14} />
                    <span>Restored uncompleted special order draft</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearSpecialOrderDraft}
                    className="text-[11px] text-muted hover:text-red-400 font-bold underline cursor-pointer"
                  >
                    Discard Draft
                  </button>
                </div>
              )}

              {/* Product Search with Live Pharmarack Autocomplete */}
              <div ref={productContainerRef} className="space-y-1.5 relative">
                <label className="block font-semibold text-text">Requested Medicine Name *</label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    autoFocus
                    placeholder="Search medicine e.g. Lipitor 10mg..."
                    value={product}
                    onChange={e => {
                      isSelectingPrRef.current = false;
                      setProduct(e.target.value);
                    }}
                    onFocus={() => { if (prSearchResults.length > 0) setShowPrDropdown(true); }}
                    onKeyDown={e => {
                      if (showPrDropdown && prSearchResults.length > 0) {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setActivePrIndex(prev => Math.min(prev + 1, prSearchResults.length - 1));
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setActivePrIndex(prev => Math.max(prev - 1, 0));
                        } else if (e.key === 'Enter') {
                          if (activePrIndex >= 0 && activePrIndex < prSearchResults.length) {
                            e.preventDefault();
                            handleSelectPharmarackItem(prSearchResults[activePrIndex]);
                          }
                        } else if (e.key === 'Escape') {
                          setShowPrDropdown(false);
                        }
                      }
                    }}
                    className="w-full px-3.5 py-2.5 bg-bg border border-border rounded-xl font-medium focus:outline-none focus:border-primary text-xs"
                  />
                  {loadingPr && (
                    <div className="absolute right-3 top-2.5">
                      <RefreshCw size={14} className="animate-spin text-primary" />
                    </div>
                  )}
                </div>

                {/* Dropdown Live Results from Pharmarack */}
                {showPrDropdown && prSearchResults.length > 0 && (
                  <div className="absolute left-0 right-0 mt-1 bg-bg2 border border-border rounded-xl shadow-2xl z-50 max-h-56 flex flex-col overflow-hidden">
                    <div className="p-2 border-b border-border/40 bg-bg3 shrink-0 text-[9px] font-bold text-muted uppercase tracking-wider flex justify-between items-center">
                      <span>Pharmarack Live Matches</span>
                      <button
                        type="button"
                        onClick={() => setShowPrDropdown(false)}
                        className="text-muted hover:text-text font-bold cursor-pointer"
                      >
                        Close
                      </button>
                    </div>
                    <div ref={prDropdownRef} className="flex-1 min-h-0 overflow-y-auto dropdown-scroll divide-y divide-border/30">
                    {prSearchResults.map((item, idx) => (
                      <div
                        key={idx}
                        data-highlighted={idx === activePrIndex ? "true" : "false"}
                        onClick={() => handleSelectPharmarackItem(item)}
                        // mousemove, not mouseenter: rows scrolling under a still cursor fire mouseenter and re-rendered the whole page per row
                        onMouseMove={() => { if (activePrIndex !== idx) setActivePrIndex(idx); }}
                        className={`p-3 border-b border-border/30 transition-colors cursor-pointer flex flex-col gap-1 text-xs ${
                          idx === activePrIndex ? 'bg-primary/20 border-l-4 border-primary ring-1 ring-primary/40 font-bold text-text' : 'hover:bg-bg3/80'
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-1.5 flex-wrap truncate max-w-[200px]">
                            <span className="font-bold text-text truncate" title={item.name}>
                              {item.name} <span className="text-[10px] text-muted">({item.packaging})</span>
                            </span>
                            {item.scheme && (
                              <span className="text-[8px] bg-amber-500/15 text-amber-400 border border-amber-500/30 px-1 py-0.2 rounded font-semibold uppercase">
                                {item.scheme}
                              </span>
                            )}
                          </div>
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${
                            item.mapped
                              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}>
                            {item.mapped ? 'Mapped' : 'Non-Mapped'}
                          </span>
                        </div>
                        <div className="text-[10px] text-muted truncate">
                          Distributor: <span className="text-text font-medium">{item.distributor}</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] font-mono mt-0.5">
                          <span className="text-green-400 font-bold">
                            PTR: {item.rate ? `₹${item.rate.toFixed(2)}` : 'N/A'}
                          </span>
                          <span className="text-text">
                            MRP: {item.mrp ? `₹${item.mrp.toFixed(2)}` : 'N/A'}
                          </span>
                          <span className="text-sky-400 flex items-center gap-1.5">
                            Stock: {item.stock}
                            {idx === activePrIndex && (
                              <span className="text-[10px] bg-primary text-white font-bold px-1.5 py-0.5 rounded shadow-sm">
                                ↵ Enter
                              </span>
                            )}
                          </span>
                        </div>
                      </div>
                    ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Selected Pharmarack Metadata Panel */}
              {selectedDistributor && (
                <div className="p-3 bg-primary/5 border border-primary/20 rounded-xl flex flex-col gap-1 text-[11px] animate-fade-in">
                  <div className="font-bold text-primary flex items-center justify-between">
                    <span>Selected Pharmarack Option</span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDistributor('');
                        setSelectedRate('');
                        setSelectedMrp('');
                        setSelectedMapped(true);
                        setSelectedScheme('');
                        setSelectedProductId('');
                        setSelectedStoreId('');
                        setSelectedProductCode('');
                        setSelectedCompany('');
                        setSelectedPackaging('');
                      }}
                      className="text-muted hover:text-red-400 text-[10px] font-bold underline"
                    >
                      Clear option
                    </button>
                  </div>
                  <div className="text-text flex justify-between">
                    <span>Distributor: <strong>{selectedDistributor}</strong></span>
                    <span>Rate: <strong className="text-green-400">{selectedRate !== '' ? `₹${selectedRate}` : 'N/A'}</strong></span>
                  </div>
                  {selectedScheme && (
                    <div className="text-amber-400 font-semibold">Scheme: {selectedScheme}</div>
                  )}
                </div>
              )}

              {/* Customer Name & Phone */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <SalutationNameInput
                    label="Customer Name"
                    required={true}
                    salutation={orderSalutation}
                    customSalutation={orderCustomSalutation}
                    name={requester}
                    onSalutationChange={(sal, custom) => {
                      setOrderSalutation(sal);
                      if (custom !== undefined) setOrderCustomSalutation(custom);
                    }}
                    onNameChange={(val) => setRequester(val)}
                    placeholder="Customer Name"
                  />
                </div>
                <div>
                  <PhoneInputWithBadge
                    label="Phone (WhatsApp)"
                    value={phone}
                    onChange={val => setPhone(val)}
                    required={true}
                    allowEmpty={false}
                    shakeOnError={shakePhone}
                  />
                </div>
              </div>

              {/* Patient Past Special Orders Quick-Reorder */}
              {patientPastOrders.length > 0 && (
                <div className="p-3 bg-bg3/40 border border-primary/25 rounded-xl space-y-2 animate-fade-in">
                  <div className="flex items-center justify-between text-[11px] font-bold text-text">
                    <span className="flex items-center gap-1.5 text-primary">
                      <RotateCcw size={13} />
                      Patient Past Special Orders ({patientPastOrders.length})
                    </span>
                    <span className="text-[10px] text-muted">Click Reorder to prefill</span>
                  </div>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {patientPastOrders.slice(0, 4).map((pastOrder: SpecialOrderItem) => (
                      <div
                        key={pastOrder.id}
                        className="flex items-center justify-between p-2 rounded-lg bg-bg2 border border-border text-[11px] hover:border-primary/40 transition-colors"
                      >
                        <div className="truncate max-w-[240px]">
                          <span className="font-bold text-text truncate block">{pastOrder.product}</span>
                          <span className="text-[10px] text-muted">
                            Qty: {pastOrder.qty || 1} • {formatDate(pastOrder.date)}
                            {pastOrder.pharmarack_distributor && ` • ${pastOrder.pharmarack_distributor}`}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleReorderPastItem(pastOrder)}
                          className="px-2.5 py-1 bg-primary text-white text-[10px] font-bold rounded-lg hover:bg-primary/90 transition-all flex items-center gap-1 shadow-xs cursor-pointer shrink-0"
                        >
                          <RotateCcw size={10} />
                          <span>Reorder</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* WhatsApp Chat Intelligence */}
              {waMessages.length > 0 && (
                <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl space-y-2 animate-fade-in">
                  <div className="flex items-center justify-between text-[11px] font-bold text-emerald-400">
                    <span className="flex items-center gap-1.5">
                      <MessageCircle size={13} />
                      WhatsApp Chat Intelligence
                    </span>
                    {loadingWaMessages && <RefreshCw size={11} className="animate-spin text-muted" />}
                  </div>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                    {waMessages.map((msg, idx) => (
                      <div
                        key={msg.id || idx}
                        className="p-2 rounded-lg bg-bg2 border border-border/80 text-[11px] flex flex-col gap-1"
                      >
                        <div className="text-text italic line-clamp-2">
                          "{msg.body}"
                        </div>
                        <div className="flex items-center justify-between pt-1 border-t border-border/40">
                          <span className="text-[9px] text-muted">
                            {msg.timestamp ? new Date(msg.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Patient Chat'}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              isSelectingPrRef.current = false;
                              setProduct(msg.body.trim());
                              toastEvent.trigger('Copied chat text to medicine name', 'info', '/crm');
                            }}
                            className="px-2 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-[10px] font-bold text-emerald-400 transition-colors cursor-pointer flex items-center gap-1"
                          >
                            <Plus size={10} />
                            <span>Use as Medicine Name</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Quantity, Advance Payment & Priority */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-text mb-1">Quantity *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={qty}
                    onChange={e => setQty(e.target.value === '' ? '' : Number(e.target.value))}
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
                    value={advancePayment}
                    onChange={e => setAdvancePayment(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-xl font-semibold text-emerald-400 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-text mb-1">Priority</label>
                  <select
                    value={priority}
                    onChange={e => setPriority(e.target.value)}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-xl font-medium focus:outline-none focus:border-primary"
                  >
                    <option value="Low">Low</option>
                    <option value="Normal">Normal</option>
                    <option value="High">High Priority</option>
                  </select>
                </div>
              </div>

              {/* WhatsApp Booking Alert toggle — dims when number confirmed NOT on WA */}
              <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 text-text text-[11px] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <MessageCircle size={15} className={bookingNotOnWa ? 'text-rose-400' : sendWhatsApp ? 'text-emerald-400' : 'text-muted'} />
                  <span>
                    <strong>WhatsApp Booking Alert:</strong>{' '}
                    {bookingNotOnWa
                      ? 'Number not registered on WhatsApp.'
                      : sendWhatsApp
                      ? 'Will automatically send booking confirmation to customer.'
                      : 'Confirmation message disabled.'}
                  </span>
                  {bookingNotOnWa && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-rose-500/15 text-rose-400 border border-rose-500/30 font-semibold shrink-0">Not on WA</span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={bookingNotOnWa}
                  onClick={() => {
                    if (bookingNotOnWa) return;
                    const next = !sendWhatsApp;
                    setSendWhatsApp(next);
                    try { localStorage.setItem('crm_order_send_whatsapp', String(next)); } catch {}
                  }}
                  title={bookingNotOnWa ? 'This number is not registered on WhatsApp' : sendWhatsApp ? 'Disable WA alert' : 'Enable WA alert'}
                  className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all flex items-center gap-1 shrink-0 ${
                    bookingNotOnWa
                      ? 'bg-rose-500/10 text-rose-400/60 border border-rose-500/20 cursor-not-allowed opacity-60'
                      : sendWhatsApp
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm cursor-pointer'
                      : 'bg-bg3 text-muted border border-border cursor-pointer'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${bookingNotOnWa ? 'bg-rose-400' : sendWhatsApp ? 'bg-emerald-400 animate-pulse' : 'bg-muted'}`} />
                  {bookingNotOnWa ? 'OFF' : sendWhatsApp ? 'ON' : 'OFF'}
                </button>
              </div>

              <div className="flex justify-end gap-2 pt-3 mt-2 border-t border-border shrink-0">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl bg-bg3 border border-border text-muted hover:text-text font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-5 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold shadow-md shadow-primary/20 transition-all disabled:opacity-50"
                >
                  {formSubmitting ? 'Logging Request...' : 'Log & Sync Cart'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Edit Special Request Modal */}
      {showEditModal && editingOrder && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="glass-panel w-[95vw] max-w-lg h-[80vh] min-h-[500px] max-h-[760px] flex flex-col bg-bg2 rounded-2xl border border-primary/20 shadow-2xl overflow-hidden">
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
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-5 duration-300 pointer-events-auto">
          <div className="bg-bg2/95 backdrop-blur-md border border-glass-border shadow-2xl rounded-2xl p-4 max-w-sm w-88 flex flex-col gap-2.5 transition-all">
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
        <div className="fixed inset-0 z-global-modal bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl w-[95vw] max-w-md p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
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
