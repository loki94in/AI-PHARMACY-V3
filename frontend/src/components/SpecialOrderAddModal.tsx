import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Search, Plus, Minus, ClipboardList, ShoppingCart,
  RefreshCw, Check, AlertCircle, MessageCircle, RotateCcw,
  Store, Tag, ArrowRight, CheckCircle2, Clock
} from 'lucide-react';
import { api, apiClient } from '../services/api';
import { toastEvent, messageSendEvent } from '../services/events';
import { useModalEscape } from '../services/keyboardShortcuts';
import { useDropdownAutoScroll } from '../hooks/useDropdownAutoScroll';
import { useOnClickOutside } from '../hooks/useOnClickOutside';
import { useWaPhoneStatus } from '../hooks/useWaPhoneStatus';
import { PhoneInputWithBadge } from './PhoneInputWithBadge';
import { SalutationNameInput, combineSalutationAndName, parseSalutationAndName } from './SalutationNameInput';
import { sanitizePhoneInput, isValid10DigitPhone } from '../utils/phone';
import type { SpecialOrderItem } from '../pages/CRM/SpecialOrdersSection';
import type { PharmarackSearchResult } from '../pages/CRM/crmTypes';

interface SpecialOrderAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOrderCreated: () => void | Promise<void>;
  existingOrders?: SpecialOrderItem[];
}

export const SpecialOrderAddModal: React.FC<SpecialOrderAddModalProps> = ({
  isOpen,
  onClose,
  onOrderCreated,
  existingOrders = []
}) => {
  // Form fields
  const [product, setProduct] = useState('');
  const [orderSalutation, setOrderSalutation] = useState('Mr.');
  const [orderCustomSalutation, setOrderCustomSalutation] = useState('');
  const [requester, setRequester] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [qty, setQty] = useState<number | ''>(1);
  const [advancePayment, setAdvancePayment] = useState<number | ''>('');
  const [priority, setPriority] = useState('Normal');
  const [language, setLanguage] = useState('mr'); // Default Marathi per project standard
  const [sendWhatsApp, setSendWhatsApp] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('crm_order_send_whatsapp');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  // Selected Pharmarack option
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

  // Search & Dropdown State
  const [prSearchResults, setPrSearchResults] = useState<PharmarackSearchResult[]>([]);
  const [showPrDropdown, setShowPrDropdown] = useState(false);
  const [activePrIndex, setActivePrIndex] = useState(0);
  const [loadingPr, setLoadingPr] = useState(false);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);

  // In-memory query cache for instant (0ms) keyboard navigation & backspacing
  const prCacheRef = useRef<Map<string, PharmarackSearchResult[]>>(new Map());
  const isSelectingRef = useRef(false);
  const prDropdownRef = useRef<HTMLDivElement>(null);
  const productInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll dropdown active item
  useDropdownAutoScroll(prDropdownRef, activePrIndex, showPrDropdown);
  useOnClickOutside([prDropdownRef, productInputRef], () => setShowPrDropdown(false));

  // WhatsApp verification for entered phone
  const cleanPhone = phone.replace(/\D/g, '').slice(-10);
  const { isNotOnWa, waStatus } = useWaPhoneStatus(cleanPhone);

  // Universal Escape key dismissal
  useModalEscape(isOpen, onClose);

  // Draft persistence & restoration
  useEffect(() => {
    if (isOpen) {
      try {
        const saved = localStorage.getItem('crm_special_order_draft');
        if (saved) {
          const draft = JSON.parse(saved);
          if (draft && (draft.product || draft.requester || draft.phone)) {
            setProduct(draft.product || '');
            setOrderSalutation(draft.orderSalutation || 'Mr.');
            setOrderCustomSalutation(draft.orderCustomSalutation || '');
            setRequester(draft.requester || '');
            setPhone(draft.phone || '');
            setQty(draft.qty || 1);
            setAdvancePayment(draft.advancePayment || '');
            setPriority(draft.priority || 'Normal');
            setLanguage(draft.language || 'mr');
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
            setHasDraft(true);
          }
        }
      } catch (_) {}
    }
  }, [isOpen]);

  // Debounced auto-save draft to localStorage (500ms debounce to avoid typing lag)
  useEffect(() => {
    if (!isOpen) return;
    const hasContent = Boolean(product.trim() || requester.trim() || phone.trim());
    if (!hasContent) return;

    const timer = setTimeout(() => {
      try {
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
        setHasDraft(true);
      } catch (_) {}
    }, 500);

    return () => clearTimeout(timer);
  }, [isOpen, product, orderSalutation, orderCustomSalutation, requester, phone, qty, advancePayment, priority, language, selectedDistributor, selectedRate, selectedMrp, selectedMapped, selectedScheme, selectedProductId, selectedStoreId, selectedProductCode, selectedCompany, selectedPackaging]);

  const handleDiscardDraft = () => {
    try {
      localStorage.removeItem('crm_special_order_draft');
    } catch (_) {}
    setProduct('');
    setOrderSalutation('Mr.');
    setOrderCustomSalutation('');
    setRequester('');
    setPhone('');
    setSelectedCustomerId(null);
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
    setHasDraft(false);
    toastEvent.trigger('Special order draft discarded', 'info', '/crm');
  };

  // High-performance search with client caching & 200ms debounce
  useEffect(() => {
    if (isSelectingRef.current) return;
    const query = product.trim();

    if (!query || query.length < 2) {
      setPrSearchResults([]);
      setShowPrDropdown(false);
      setActivePrIndex(0);
      setLoadingPr(false);
      return;
    }

    // 1. Instant Cache Hit (0ms)
    const norm = query.toLowerCase();
    if (prCacheRef.current.has(norm)) {
      const cached = prCacheRef.current.get(norm)!;
      setPrSearchResults(cached);
      setShowPrDropdown(cached.length > 0);
      setActivePrIndex(0);
      setLoadingPr(false);
      return;
    }

    // 2. Fast 200ms debounce network fetch
    setLoadingPr(true);
    const timer = setTimeout(async () => {
      if (isSelectingRef.current) return;
      try {
        const results = await api.searchPharmarack(query);
        if (isSelectingRef.current) return;
        const matches = Array.isArray(results) ? (results as PharmarackSearchResult[]) : [];
        prCacheRef.current.set(norm, matches);
        setPrSearchResults(matches);
        setShowPrDropdown(matches.length > 0);
        setActivePrIndex(0);
      } catch (err) {
        console.error('Pharmarack query failed:', err);
      } finally {
        setLoadingPr(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [product]);

  // Handle item selection with ZERO blur-misses
  const handleSelectPharmarackItem = useCallback((item: PharmarackSearchResult) => {
    isSelectingRef.current = true;
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
    setShowPrDropdown(false);

    // Re-enable typing after microtask
    setTimeout(() => {
      isSelectingRef.current = false;
    }, 50);
  }, []);

  const handleClearSelectedOption = () => {
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
  };

  // WhatsApp Chat Intelligence for entered phone
  const [waMessages, setWaMessages] = useState<any[]>([]);
  const [loadingWaMessages, setLoadingWaMessages] = useState(false);

  useEffect(() => {
    if (!isOpen || !cleanPhone || cleanPhone.length < 10) {
      setWaMessages([]);
      return;
    }
    let cancelled = false;
    setLoadingWaMessages(true);
    apiClient.get<any[]>(`/messaging/chats/${encodeURIComponent(cleanPhone)}/messages?limit=15`)
      .then(res => {
        if (cancelled) return;
        const list = Array.isArray(res.data) ? res.data : [];
        const patientMsgs = list.filter(m => !m.fromMe && m.body && m.body.trim().length > 1);
        setWaMessages(patientMsgs.slice(-4));
      })
      .catch(() => {
        if (!cancelled) setWaMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingWaMessages(false);
      });
    return () => { cancelled = true; };
  }, [isOpen, cleanPhone]);

  // Patient past orders lookup
  const patientPastOrders = useMemo(() => {
    if (!cleanPhone || cleanPhone.length < 8) return [];
    return existingOrders.filter(o => {
      const op = (o.phone || '').replace(/\D/g, '').slice(-10);
      return op === cleanPhone;
    });
  }, [existingOrders, cleanPhone]);

  const handleReorderPastItem = (past: SpecialOrderItem) => {
    isSelectingRef.current = true;
    setProduct(past.product);
    setQty(past.qty || 1);
    if (past.pharmarack_distributor) setSelectedDistributor(past.pharmarack_distributor);
    if (past.pharmarack_rate) setSelectedRate(past.pharmarack_rate);
    if (past.pharmarack_mrp) setSelectedMrp(past.pharmarack_mrp);
    if (past.pharmarack_product_id) setSelectedProductId(past.pharmarack_product_id);
    if (past.pharmarack_store_id) setSelectedStoreId(past.pharmarack_store_id);
    if (past.pharmarack_product_code) setSelectedProductCode(past.pharmarack_product_code);
    toastEvent.trigger(`Selected "${past.product}" from past orders!`, 'success', '/crm');
    setTimeout(() => { isSelectingRef.current = false; }, 50);
  };

  // Submit Order Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const customerName = combineSalutationAndName(orderSalutation, orderCustomSalutation, requester);
    const cleanPh = sanitizePhoneInput(phone);

    if (!product.trim()) {
      toastEvent.trigger('Please enter a medicine name.', 'error', '/crm');
      return;
    }
    if (!customerName) {
      toastEvent.trigger('Customer Name is required.', 'error', '/crm');
      return;
    }
    if (!cleanPh || !isValid10DigitPhone(cleanPh)) {
      toastEvent.trigger('Please enter a valid 10-digit mobile number.', 'error', '/crm');
      return;
    }
    if (!qty || Number(qty) < 1) {
      toastEvent.trigger('Quantity must be at least 1.', 'error', '/crm');
      return;
    }

    setFormSubmitting(true);
    try {
      if (Boolean(sendWhatsApp) && cleanPh) {
        messageSendEvent.triggerSendProgress(customerName || 'Customer', `Booking confirmation for ${product.trim()}`, 10);
      }

      await api.createOrder({
        product: product.trim(),
        requester: customerName,
        phone: cleanPh,
        customer_id: selectedCustomerId || undefined,
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

      // Update CRM patient record
      try {
        if (selectedCustomerId) {
          await api.updatePatient(selectedCustomerId, { name: customerName, phone: cleanPh, language });
        } else if (cleanPh) {
          await api.addPatient({ name: customerName, phone: cleanPh, language });
        }
      } catch (_) {}

      // Auto add to Pharmarack cart if distributor selected
      if (selectedProductId && selectedStoreId) {
        try {
          await api.addPharmarackCart([{
            productId: selectedProductId,
            storeId: selectedStoreId,
            qty: Number(qty) || 1,
            productCode: selectedProductCode,
            productName: product.trim(),
            company: selectedCompany,
            packaging: selectedPackaging,
            rate: selectedRate !== '' ? Number(selectedRate) : undefined,
            mrp: selectedMrp !== '' ? Number(selectedMrp) : undefined,
            scheme: selectedScheme,
            storeName: selectedDistributor,
            mapped: selectedMapped
          }]);
        } catch (_) {}
      }

      try {
        localStorage.removeItem('crm_special_order_draft');
      } catch (_) {}

      toastEvent.trigger('Special Request registered and queued successfully!', 'success', '/crm');
      await onOrderCreated();
      onClose();
    } catch (err: any) {
      toastEvent.trigger(err?.response?.data?.error || err?.message || 'Failed to register special order', 'error', '/crm');
    } finally {
      setFormSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-global-modal flex items-center justify-center p-4 bg-black/60 transition-all duration-300 animate-in fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Sized identically to Live Cart Add Modal for maximum consistency and comfortable layout */}
      <div
        className="glass-panel w-[95vw] max-w-6xl xl:max-w-7xl h-[85vh] min-h-[560px] max-h-[840px] p-4 md:p-5 relative border border-glass-border/60 shadow-[0_0_60px_rgba(59,130,246,0.25)] bg-bg2 text-text animate-in fade-in zoom-in-95 duration-200 flex flex-col overflow-hidden rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between pb-3.5 border-b border-border/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary shadow-xs">
              <ClipboardList size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-extrabold text-text tracking-tight">Register Out-of-Stock Special Request</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/15 text-primary border border-primary/30">
                  Live Cart & 24/7 Sync Ready
                </span>
              </div>
              <p className="text-xs text-muted mt-0.5">
                Book patient shortages, link distributor options, and auto-dispatch localized WhatsApp confirmation.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {hasDraft && (
              <button
                type="button"
                onClick={handleDiscardDraft}
                className="px-2.5 py-1 text-[11px] font-bold text-muted hover:text-red-400 bg-bg3/60 hover:bg-bg3 border border-border rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                title="Discard uncompleted saved draft"
              >
                <RotateCcw size={11} />
                <span>Discard Draft</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-muted hover:text-text rounded-lg hover:bg-bg3 transition-colors border border-glass-border/50 bg-bg3/60"
              title="Close Modal (Esc)"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 2-Column Responsive Body */}
        <form onSubmit={handleSubmit} className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-5 pt-3.5 overflow-hidden">
          {/* ─── LEFT COLUMN: MEDICINE SEARCH & DISTRIBUTOR RESULTS (7 COLS) ─── */}
          <div className="lg:col-span-7 flex flex-col min-h-0 h-full overflow-hidden border-b lg:border-b-0 lg:border-r border-border/60 lg:pr-5">
            {/* Search Input Box */}
            <div className="space-y-1.5 shrink-0 relative">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-text flex items-center gap-1.5">
                  <span>Requested Medicine Name *</span>
                  <span className="text-[10px] text-muted font-normal">(Instant Pharmarack & Local Search)</span>
                </label>
                <span className="text-[10px] text-muted font-mono hidden sm:inline">
                  ↑↓ Navigate • ↵ Select • Esc Close
                </span>
              </div>

              <div className="relative">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  ref={productInputRef}
                  type="text"
                  required
                  autoFocus
                  placeholder="Search medicine brand or composition (e.g. Telma 40, Lipitor, Glycomet)..."
                  value={product}
                  onChange={e => {
                    isSelectingRef.current = false;
                    setProduct(e.target.value);
                  }}
                  onFocus={() => {
                    if (prSearchResults.length > 0) setShowPrDropdown(true);
                  }}
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
                  className="w-full pl-10 pr-10 py-2.5 bg-bg border border-border rounded-xl text-xs text-text font-medium focus:outline-none focus:border-primary shadow-xs"
                />
                {loadingPr ? (
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                    <RefreshCw size={14} className="animate-spin text-primary" />
                  </div>
                ) : product ? (
                  <button
                    type="button"
                    onClick={() => {
                      setProduct('');
                      handleClearSelectedOption();
                      setPrSearchResults([]);
                      setShowPrDropdown(false);
                      productInputRef.current?.focus();
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text p-1"
                  >
                    <X size={13} />
                  </button>
                ) : null}
              </div>
            </div>

            {/* Selected Option Notification Card */}
            {selectedDistributor && (
              <div className="mt-2.5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 shrink-0 flex items-center justify-between gap-3 text-xs animate-in fade-in">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-emerald-400">✓ Linked Distributor Option</span>
                    {selectedMapped && (
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300">Mapped</span>
                    )}
                    {selectedScheme && (
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300">Scheme: {selectedScheme}</span>
                    )}
                  </div>
                  <div className="text-[11px] text-text font-medium truncate mt-0.5">
                    <strong>{selectedDistributor}</strong>
                    {selectedRate !== '' && (
                      <span className="ml-2 font-mono text-emerald-400 font-bold">PTR: ₹{Number(selectedRate).toFixed(2)}</span>
                    )}
                    {selectedMrp !== '' && (
                      <span className="ml-2 font-mono text-muted">MRP: ₹{Number(selectedMrp).toFixed(2)}</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleClearSelectedOption}
                  className="px-2 py-1 text-[10px] font-bold text-muted hover:text-red-400 bg-bg2 rounded-lg border border-border shrink-0 cursor-pointer"
                >
                  Change
                </button>
              </div>
            )}

            {/* Results List / Dropdown Panel */}
            <div className="flex-1 min-h-0 mt-2.5 flex flex-col overflow-hidden">
              {showPrDropdown && prSearchResults.length > 0 ? (
                <div className="flex-1 min-h-0 flex flex-col bg-bg border border-border/80 rounded-xl overflow-hidden shadow-sm">
                  <div className="p-2 border-b border-border/40 bg-bg3/60 shrink-0 flex items-center justify-between text-[10px] font-bold text-muted uppercase tracking-wider">
                    <span>Pharmarack Live Matches ({prSearchResults.length})</span>
                    <button
                      type="button"
                      onClick={() => setShowPrDropdown(false)}
                      className="text-muted hover:text-text cursor-pointer"
                    >
                      Hide
                    </button>
                  </div>

                  <div
                    ref={prDropdownRef}
                    className="flex-1 min-h-0 overflow-y-auto dropdown-scroll divide-y divide-border/30 p-1"
                  >
                    {prSearchResults.map((item, idx) => {
                      const isHighlighted = idx === activePrIndex;
                      return (
                        <div
                          key={`${item.productId || item.name}-${idx}`}
                          data-highlighted={isHighlighted ? 'true' : 'false'}
                          // onMouseDown fires BEFORE blur, fixing selecting lag completely
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handleSelectPharmarackItem(item);
                          }}
                          onMouseMove={() => {
                            if (activePrIndex !== idx) setActivePrIndex(idx);
                          }}
                          className={`p-3 rounded-xl transition-all cursor-pointer flex flex-col gap-1 text-xs mb-1 ${
                            isHighlighted
                              ? 'bg-primary/20 border-l-4 border-primary ring-1 ring-primary/40 font-bold text-text shadow-xs'
                              : 'hover:bg-bg3/80 border border-transparent'
                          }`}
                        >
                          <div className="flex justify-between items-start">
                            <div className="flex items-center gap-1.5 flex-wrap truncate max-w-[280px]">
                              <span className="font-bold text-text truncate" title={item.name}>
                                {item.name}
                              </span>
                              {item.packaging && (
                                <span className="text-[10px] text-muted">({item.packaging})</span>
                              )}
                              {item.scheme && (
                                <span className="text-[8px] bg-amber-500/15 text-amber-500 border border-amber-500/30 px-1 py-0.5 rounded font-semibold uppercase">
                                  {item.scheme}
                                </span>
                              )}
                            </div>
                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${
                              item.mapped
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                : 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
                            }`}>
                              {item.mapped ? 'Mapped' : 'Non-Mapped'}
                            </span>
                          </div>

                          <div className="text-[10px] text-muted truncate">
                            Distributor: <span className="text-text font-medium">{item.distributor || 'General'}</span>
                          </div>

                          <div className="flex justify-between items-center text-[10px] font-mono mt-0.5">
                            <span className="text-emerald-400 font-bold">
                              PTR: {item.rate != null ? `₹${Number(item.rate).toFixed(2)}` : 'N/A'}
                            </span>
                            <span className="text-text">
                              MRP: {item.mrp != null ? `₹${Number(item.mrp).toFixed(2)}` : 'N/A'}
                            </span>
                            <span className="text-sky-400 flex items-center gap-1.5">
                              Stock: {item.stock ?? 'Live'}
                              {isHighlighted && (
                                <span className="text-[9px] bg-primary text-white font-bold px-1.5 py-0.5 rounded shadow-sm">
                                  ↵ Select
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* Auxiliary Helper Panels (Chat Intelligence & Past Orders) when dropdown is idle */
                <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
                  {/* WhatsApp Chat Intelligence */}
                  {waMessages.length > 0 && (
                    <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-bold text-emerald-400">
                        <span className="flex items-center gap-1.5">
                          <MessageCircle size={13} />
                          <span>WhatsApp Chat Intelligence (Recent Patient Chats)</span>
                        </span>
                        {loadingWaMessages && <RefreshCw size={11} className="animate-spin text-muted" />}
                      </div>
                      <div className="space-y-1.5">
                        {waMessages.map((msg, idx) => (
                          <div
                            key={msg.id || idx}
                            className="p-2 rounded-lg bg-bg2 border border-border/80 text-[11px] flex flex-col gap-1"
                          >
                            <div className="text-text italic line-clamp-2">"{msg.body}"</div>
                            <div className="flex items-center justify-between pt-1 border-t border-border/40">
                              <span className="text-[9px] text-muted">
                                {msg.timestamp ? new Date(msg.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Patient Message'}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  isSelectingRef.current = false;
                                  setProduct(msg.body.trim());
                                  toastEvent.trigger('Copied chat text to medicine search', 'info', '/crm');
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

                  {/* Patient Past Orders Shortcut */}
                  {patientPastOrders.length > 0 && (
                    <div className="p-3 bg-bg3/40 border border-border/70 rounded-xl space-y-2">
                      <div className="text-[11px] font-bold text-text flex items-center gap-1.5">
                        <Clock size={13} className="text-primary" />
                        <span>Previous Shortage Orders for this Customer</span>
                      </div>
                      <div className="space-y-1.5">
                        {patientPastOrders.slice(0, 4).map(past => (
                          <div
                            key={past.id}
                            className="p-2 rounded-lg bg-bg border border-border text-xs flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="font-bold text-text truncate">{past.product}</div>
                              <div className="text-[10px] text-muted font-mono">Qty: {past.qty} • Status: {past.status}</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleReorderPastItem(past)}
                              className="px-2 py-1 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-[10px] font-bold transition-colors cursor-pointer flex items-center gap-1 shrink-0"
                            >
                              <RotateCcw size={10} />
                              <span>Reorder</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {waMessages.length === 0 && patientPastOrders.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center p-8 text-center text-muted border border-dashed border-border/60 rounded-xl">
                      <Search size={28} className="opacity-30 mb-2 text-primary" />
                      <p className="text-xs font-bold text-text">Live Distributor Search</p>
                      <p className="text-[11px] max-w-sm mt-1 text-muted">
                        Type medicine name above to preview live stock, mapped distributors, and distributor rates across Pharmarack.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ─── RIGHT COLUMN: CUSTOMER & ORDER SPECIFICATION (5 COLS) ─── */}
          <div className="lg:col-span-5 flex flex-col justify-between min-h-0 h-full overflow-y-auto space-y-4 pr-1">
            <div className="space-y-3.5">
              <div className="border-b border-border/60 pb-1.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Customer & Order Details</h3>
              </div>

              {/* Customer Name with Salutation & Autocomplete */}
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
                onNameChange={(val) => {
                  setSelectedCustomerId(null);
                  setRequester(val);
                }}
                enablePatientAutocomplete={true}
                onSelectPatient={(patient) => {
                  setSelectedCustomerId(patient.id);
                  if (patient.phone) setPhone(patient.phone);
                  if (patient.language) setLanguage(patient.language);
                }}
                placeholder="Enter customer name..."
              />

              {/* Mobile Phone with WhatsApp check */}
              <PhoneInputWithBadge
                label="Phone (WhatsApp Number) *"
                value={phone}
                onChange={val => setPhone(val)}
                required={true}
                allowEmpty={false}
                enablePatientAutocomplete={true}
                onSelectPatient={(patient) => {
                  setSelectedCustomerId(patient.id);
                  const parsed = parseSalutationAndName(patient.name);
                  setOrderSalutation(parsed.salutation);
                  setOrderCustomSalutation(parsed.customSalutation);
                  setRequester(parsed.name);
                  if (patient.language) setLanguage(patient.language);
                }}
              />

              {/* Quantity, Advance Paid & Priority */}
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-text mb-1">Quantity *</label>
                  <div className="flex items-center border border-border rounded-xl bg-bg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setQty(prev => Math.max(1, (Number(prev) || 1) - 1))}
                      className="px-2 py-2 text-muted hover:text-text hover:bg-bg3 transition-colors"
                    >
                      <Minus size={12} />
                    </button>
                    <input
                      type="number"
                      min="1"
                      required
                      value={qty}
                      onChange={e => setQty(e.target.value === '' ? '' : Math.max(1, Number(e.target.value)))}
                      className="w-full text-center bg-transparent text-xs font-bold text-text focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setQty(prev => (Number(prev) || 0) + 1)}
                      className="px-2 py-2 text-muted hover:text-text hover:bg-bg3 transition-colors"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-text mb-1">Advance (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={advancePayment}
                    onChange={e => setAdvancePayment(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-2.5 py-2 bg-bg border border-border rounded-xl text-xs font-bold text-emerald-400 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-text mb-1">Priority</label>
                  <select
                    value={priority}
                    onChange={e => setPriority(e.target.value)}
                    className="w-full px-2 py-2 bg-bg border border-border rounded-xl text-xs font-semibold focus:outline-none focus:border-primary"
                  >
                    <option value="Normal">Normal</option>
                    <option value="High">High</option>
                    <option value="Low">Low</option>
                  </select>
                </div>
              </div>

              {/* Language Selector (Sets permanent customer preference) */}
              <div>
                <label className="block text-[11px] font-bold text-text mb-1">
                  Customer WhatsApp Language
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { id: 'mr', label: 'मराठी (Default)' },
                    { id: 'hi', label: 'हिंदी' },
                    { id: 'en', label: 'English' }
                  ].map(l => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setLanguage(l.id)}
                      className={`py-1.5 px-2 rounded-xl text-xs font-bold border transition-all ${
                        language === l.id
                          ? 'bg-primary text-white border-primary shadow-xs'
                          : 'bg-bg border-border text-muted hover:text-text'
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* WhatsApp Booking Alert Toggle */}
              <div className="p-3 rounded-xl bg-bg3/60 border border-border text-xs flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <MessageCircle size={15} className={sendWhatsApp ? 'text-emerald-400' : 'text-muted'} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-text">WhatsApp Confirmation</span>
                      {isNotOnWa ? (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">
                          Not on WhatsApp
                        </span>
                      ) : waStatus === 'AVAILABLE' ? (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                          On WhatsApp
                        </span>
                      ) : waStatus === 'checking' ? (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-sky-500/15 text-sky-400 border border-sky-500/30 animate-pulse">
                          Checking WA...
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[10px] text-muted leading-tight">
                      {!sendWhatsApp
                        ? 'Confirmation message turned OFF by user.'
                        : isNotOnWa
                        ? 'WhatsApp alert is ON • Note: Number not registered on WA (dispatch will safely skip WA).'
                        : `Auto-send booking notice in ${language === 'mr' ? 'Marathi' : language === 'hi' ? 'Hindi' : 'English'}.`}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const next = !sendWhatsApp;
                    setSendWhatsApp(next);
                    try { localStorage.setItem('crm_order_send_whatsapp', String(next)); } catch {}
                  }}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
                    sendWhatsApp
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-xs'
                      : 'bg-bg border border-border text-muted hover:text-text'
                  }`}
                  title={sendWhatsApp ? 'WhatsApp confirmation enabled' : 'WhatsApp confirmation disabled'}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${sendWhatsApp ? 'bg-emerald-400 animate-pulse' : 'bg-muted'}`} />
                  {sendWhatsApp ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>

            {/* Bottom Actions Bar */}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border/80 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-bg3 hover:bg-bg border border-border text-muted hover:text-text font-bold text-xs transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={formSubmitting}
                className="px-6 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white font-extrabold text-xs shadow-md shadow-primary/20 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {formSubmitting ? (
                  <>
                    <RefreshCw size={13} className="animate-spin" />
                    <span>Logging Request...</span>
                  </>
                ) : (
                  <>
                    <span>Log & Sync Cart</span>
                    <ArrowRight size={13} />
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
