import { isPatientRefillsSettled, getRefillStage } from '../../utils/refillSettled';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw, Send, Users, Phone, Calendar,
  AlertCircle, Clock, Search, Repeat2, Bell,
  Check, Package, Zap, FileText, X, Plus,
  Trash2, Sliders, ChevronDown, ShoppingCart,
  Edit2, RotateCcw, Globe, Pill, MoreHorizontal
} from 'lucide-react';
import { apiClient, api, getCompactInventoryCache, getCompactInventoryIndex } from '../../services/api';
import { toastEvent, refillEvent, messageSendEvent, whatsappQueueEvent, automationHubEvent } from '../../services/events';
import { useModalEscape } from '../../services/keyboardShortcuts';
import { PhoneInputWithBadge } from '../../components/PhoneInputWithBadge';
import { SalutationNameInput, combineSalutationAndName, parseSalutationAndName } from '../../components/SalutationNameInput';
import { DelayNoticeModal } from '../../components/DelayNoticeModal';
import { MedicineLinkModal } from '../../components/MedicineLinkModal';
import { RefillOrderModal } from '../../components/RefillOrderModal';
import { startRefillCartJob, type RefillCartItemInput } from '../../services/refillCartJobs';
import {
  type RefillPatient,
  type RefillLanguage,
  type LocalApiError,
  type RefillFulfillmentRow,
  type SalesHistoryInvoice,
  type MedicineSearchRow,
  type MedicineRow,
  type MedicineSuggestion,
  emptyRow,
  withSilentRetry,
  formatDate,
  futureDateLabel
} from './crmTypes';

let cachedRefillsData: RefillPatient[] = [];

export const RefillsSection: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<RefillPatient[]>(cachedRefillsData);
  const [selectedPatient, setSelectedPatient] = useState<RefillPatient | null>(null);
  const [showUnlinked, setShowUnlinked] = useState(false);
  const [loading, setLoading] = useState(cachedRefillsData.length === 0);
  const [search, setSearch] = useState('');
  const [markingOrdered, setMarkingOrdered] = useState(false);
  const [markingReady, setMarkingReady] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [snoozing, setSnoozing] = useState(false);
  const [runningCheck, setRunningCheck] = useState(false);
  const [filterTab, setFilterTab] = useState<'all' | 'overdue' | 'lead' | 'active' | 'paused' | 'canceled'>('all');
  const [showSettledOverdue, setShowSettledOverdue] = useState(false);
  const [activeDetailTab, setActiveDetailTab] = useState<'prescriptions' | 'fulfillments' | 'invoices'>('prescriptions');

  // Sub-detail data states
  const [fulfillments, setFulfillments] = useState<RefillFulfillmentRow[]>([]);
  const [loadingFulfillments, setLoadingFulfillments] = useState(false);
  const [invoices, setInvoices] = useState<SalesHistoryInvoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [viewInvoice, setViewInvoice] = useState<SalesHistoryInvoice | null>(null);
  const [fulfillingId, setFulfillingId] = useState<number | null>(null);
  const [fulfillingAll, setFulfillingAll] = useState(false);

  // ── Add / Edit Refill modal state ──────────────────────────────────────────
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPatient, setEditingPatient] = useState<RefillPatient | null>(null);
  const [refillSalutation, setRefillSalutation] = useState('Mr.');
  const [refillCustomSalutation, setRefillCustomSalutation] = useState('');
  const [addPatientName, setAddPatientName] = useState('');
  const [addPatientPhone, setAddPatientPhone] = useState('');
  const [addLanguage, setAddLanguage] = useState<'en' | 'hi' | 'mr'>('en');
  const [addReminderMode, setAddReminderMode] = useState<'manual' | 'auto'>('manual');
  
  // Staged reminders & Mode automation state
  const [stagedSummary, setStagedSummary] = useState<{
    total_staged: number;
    auto_count: number;
    manual_count: number;
    staged_items: Array<{
      id: number;
      recipient_name: string;
      recipient_phone: string;
      message: string;
      reminder_mode: 'auto' | 'manual';
    }>;
  } | null>(null);
  const [dispatchingAuto, setDispatchingAuto] = useState(false);
  const [sendingBriefing, setSendingBriefing] = useState(false);
  const [showStagedDetails, setShowStagedDetails] = useState(false);
  const [actioningNotifId, setActioningNotifId] = useState<number | null>(null);
  
  // Frequency state: preset vs custom
  const [freqMode, setFreqMode] = useState<'preset' | 'custom'>('preset');
  const [addInterval, setAddInterval] = useState(30);
  const [customValue] = useState(15);
  const [customUnit] = useState<'days' | 'weeks' | 'months'>('days');

  const [medicineRows, setMedicineRows] = useState<MedicineRow[]>([emptyRow()]);
  const [dropUpIndex, setDropUpIndex] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showDelayModal, setShowDelayModal] = useState(false);
  const [orderingPatient, setOrderingPatient] = useState<RefillPatient | null>(null);

  // Refill draft auto-save & restore (session resumption)
  const [hasRefillDraft, setHasRefillDraft] = useState(false);

  useEffect(() => {
    if (showAddModal && !editingPatient) {
      try {
        const raw = localStorage.getItem('crm_refill_draft');
        if (raw) {
          const draft = JSON.parse(raw);
          if (draft && (draft.addPatientName || draft.addPatientPhone || (Array.isArray(draft.medicineRows) && draft.medicineRows.some((r: any) => r.medicineName)))) {
            setRefillSalutation(draft.refillSalutation || 'Mr.');
            setRefillCustomSalutation(draft.refillCustomSalutation || '');
            setAddPatientName(draft.addPatientName || '');
            setAddPatientPhone(draft.addPatientPhone || '');
            setAddLanguage(draft.addLanguage || 'en');
            setAddReminderMode(draft.addReminderMode || 'manual');
            setAddInterval(draft.addInterval || 30);
            if (Array.isArray(draft.medicineRows) && draft.medicineRows.length > 0) {
              setMedicineRows(draft.medicineRows);
            }
            setHasRefillDraft(true);
          }
        }
      } catch (_) {}
    }
  }, [showAddModal, editingPatient]);

  useEffect(() => {
    if (!showAddModal || editingPatient) return;
    const hasContent = addPatientName.trim() || addPatientPhone.trim() || medicineRows.some(r => r.medicineName.trim());
    if (hasContent) {
      const draft = {
        refillSalutation,
        refillCustomSalutation,
        addPatientName,
        addPatientPhone,
        addLanguage,
        addReminderMode,
        addInterval,
        medicineRows: medicineRows.map(r => ({
          medicineId: r.medicineId,
          medicineName: r.medicineName,
          manufacturer: r.manufacturer,
          mrp: r.mrp,
          inStockQty: r.inStockQty,
          quantity_needed: r.quantity_needed,
          searchTerm: r.searchTerm,
          isOpen: false,
          suggestions: []
        }))
      };
      localStorage.setItem('crm_refill_draft', JSON.stringify(draft));
      setHasRefillDraft(true);
    }
  }, [showAddModal, editingPatient, refillSalutation, refillCustomSalutation, addPatientName, addPatientPhone, addLanguage, addReminderMode, addInterval, medicineRows]);

  const handleClearRefillDraft = () => {
    localStorage.removeItem('crm_refill_draft');
    setRefillSalutation('Mr.');
    setRefillCustomSalutation('');
    setAddPatientName('');
    setAddPatientPhone('');
    setAddInterval(30);
    setMedicineRows([emptyRow()]);
    setHasRefillDraft(false);
    toastEvent.trigger('Refill draft discarded', 'info', '/crm');
  };

  // Frequency slider modal
  const [editingRefill, setEditingRefill] = useState<{ id: number; currentInterval: number; name: string } | null>(null);
  const [linkingMedicine, setLinkingMedicine] = useState<{ id: number; name: string } | null>(null);
  const [priorityDropdownMedId, setPriorityDropdownMedId] = useState<number | null>(null);
  const [editIntervalVal, setEditIntervalVal] = useState<number>(30);
  const [updatingFreq, setUpdatingFreq] = useState(false);

  const handleSetPriorityDistributor = useCallback(async (medicineId: number, medName: string, targetDistributor: string) => {
    setPriorityDropdownMedId(null);
    const updateList = (list: string[] | undefined) => {
      if (!list || list.length <= 1) return list;
      const idx = list.indexOf(targetDistributor);
      if (idx <= 0) return list;
      return [targetDistributor, ...list.filter((_, i) => i !== idx)];
    };

    setSelectedPatient(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        medicines: prev.medicines.map(m =>
          m.medicine_id === medicineId
            ? { ...m, linked_distributors: updateList(m.linked_distributors) }
            : m
        )
      };
    });

    setData(prev => prev.map(p => ({
      ...p,
      medicines: p.medicines.map(m =>
        m.medicine_id === medicineId
          ? { ...m, linked_distributors: updateList(m.linked_distributors) }
          : m
      )
    })));

    cachedRefillsData = cachedRefillsData.map(p => ({
      ...p,
      medicines: p.medicines.map(m =>
        m.medicine_id === medicineId
          ? { ...m, linked_distributors: updateList(m.linked_distributors) }
          : m
      )
    }));

    try {
      const res = await api.getMedicineLinks(medicineId);
      const picks = res.links || [];
      const idx = picks.findIndex(p => p.storeName === targetDistributor);
      if (idx > 0) {
        const reordered = [picks[idx], ...picks.filter((_, i) => i !== idx)];
        await api.saveMedicineLinks(medicineId, reordered);
        toastEvent.trigger(`⭐ "${targetDistributor}" is now #1 priority for ${medName}`, 'success');
      }
    } catch (err: any) {
      toastEvent.trigger(err?.message || 'Could not update distributor priority', 'error');
    }
  }, []);

  // Resizable panel width state (persisted in localStorage, matching WhatsApp layout)
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('crm_refills_sidebar_width');
    return saved ? parseInt(saved, 10) : 360;
  });
  const [isDragging, setIsDragging] = useState(false);

  // Mouse move handler for resizing sidebar
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const newWidth = Math.min(Math.max(e.clientX - 260, 240), 550);
      setSidebarWidth(newWidth);
      localStorage.setItem('crm_refills_sidebar_width', String(newWidth));
    };

    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Ref to track currently selected patient phone for smooth silent background updates
  const selectedPatientPhoneRef = useRef<string | null>(null);
  useEffect(() => {
    selectedPatientPhoneRef.current = selectedPatient?.patient_phone || null;
  }, [selectedPatient]);

  const handleOpenAddModal = (existingPat?: RefillPatient) => {
    if (existingPat) {
      setEditingPatient(existingPat);
      const parsed = parseSalutationAndName(existingPat.patient_name);
      setRefillSalutation(parsed.salutation);
      setRefillCustomSalutation(parsed.customSalutation);
      setAddPatientName(parsed.name);
      setAddPatientPhone(existingPat.patient_phone);
      setAddLanguage((existingPat.language as RefillLanguage) || 'en');
      setAddReminderMode(existingPat.reminder_mode || 'manual');
      const interval = existingPat.medicines[0]?.refill_interval_days || 30;
      setFreqMode('preset');
      setAddInterval(interval);
      setMedicineRows(existingPat.medicines.map(m => ({
        medicineId: m.medicine_id || m.id,
        medicineName: m.medicine_name,
        searchTerm: m.medicine_name,
        suggestions: [],
        isOpen: false,
        quantity_needed: m.quantity_needed || 3,
        inStockQty: m.in_stock_qty || 0
      })));
    } else {
      setEditingPatient(null);
      setRefillSalutation('Mr.');
      setRefillCustomSalutation('');
      setAddPatientName('');
      setAddPatientPhone('');
      setAddLanguage('en');
      setAddReminderMode('manual');
      setAddInterval(30);
      setFreqMode('preset');
      setMedicineRows([emptyRow()]);
    }
    setShowAddModal(true);
  };

  const handleOpenAddMedicineForSelected = () => {
    if (!selectedPatient) {
      handleOpenAddModal();
      return;
    }
    setEditingPatient(selectedPatient);
    const parsed = parseSalutationAndName(selectedPatient.patient_name);
    setRefillSalutation(parsed.salutation);
    setRefillCustomSalutation(parsed.customSalutation);
    setAddPatientName(parsed.name);
    setAddPatientPhone(selectedPatient.patient_phone);
    setAddLanguage((selectedPatient.language as RefillLanguage) || 'en');
    setAddReminderMode(selectedPatient.reminder_mode || 'manual');
    const interval = selectedPatient.medicines[0]?.refill_interval_days || 30;
    setFreqMode('preset');
    setAddInterval(interval);
    // Keep existing rows and append one new empty row for the new medicine
    setMedicineRows([
      ...selectedPatient.medicines.map(m => ({
        medicineId: m.medicine_id || m.id,
        medicineName: m.medicine_name,
        searchTerm: m.medicine_name,
        suggestions: [],
        isOpen: false,
        quantity_needed: m.quantity_needed || 3,
        inStockQty: m.in_stock_qty || 0
      })),
      emptyRow()
    ]);
    setShowAddModal(true);
  };

  // Effective interval calculation helper
  const getEffectiveIntervalDays = useCallback(() => {
    if (freqMode === 'preset') return addInterval;
    const val = Math.max(1, Number(customValue) || 1);
    if (customUnit === 'weeks') return val * 7;
    if (customUnit === 'months') return val * 30;
    return val;
  }, [freqMode, addInterval, customValue, customUnit]);

  // Load fulfillment occurrence history for a patient
  const loadPatientFulfillments = useCallback(async (phone: string, customerId?: number) => {
    if (!phone && !customerId) {
      setFulfillments([]);
      return;
    }
    setLoadingFulfillments(true);
    try {
      const identifier = phone || String(customerId);
      const res = await apiClient.get<RefillFulfillmentRow[]>(`/refills/patient/${encodeURIComponent(identifier)}/history`);
      setFulfillments(Array.isArray(res.data) ? res.data : []);
    } catch {
      setFulfillments([]);
    } finally {
      setLoadingFulfillments(false);
    }
  }, []);

  // Load sales history / invoices for a patient
  const loadPatientInvoices = useCallback(async (phone: string, customerId?: number) => {
    if (!phone && !customerId) {
      setInvoices([]);
      return;
    }
    setLoadingInvoices(true);
    try {
      let res: Awaited<ReturnType<typeof apiClient.get<SalesHistoryInvoice[]>>> | null = null;
      if (customerId) {
        res = await apiClient.get<SalesHistoryInvoice[]>(`/crm/${customerId}/history`).catch(() => null);
      }
      if (!res || !Array.isArray(res.data) || res.data.length === 0) {
        if (phone) {
          res = await apiClient.get<SalesHistoryInvoice[]>(`/crm/history-by-phone/${encodeURIComponent(phone)}`).catch(() => null);
        }
      }
      setInvoices(Array.isArray(res?.data) ? res.data : []);
    } catch {
      setInvoices([]);
    } finally {
      setLoadingInvoices(false);
    }
  }, []);

  const selectPatientAndLoadDetails = useCallback((pat: RefillPatient) => {
    setSelectedPatient(pat);
    loadPatientFulfillments(pat.patient_phone, pat.customer_id);
    loadPatientInvoices(pat.patient_phone, pat.customer_id);
  }, [loadPatientFulfillments, loadPatientInvoices]);

  const load = useCallback(async (silent = false) => {
    if (!silent && cachedRefillsData.length === 0) setLoading(true);
    const previousPhone = selectedPatientPhoneRef.current;
    try {
      const r = await withSilentRetry(() => apiClient.get<RefillPatient[]>('/refills/panel'));
      const list = Array.isArray(r.data) ? r.data : [];
      cachedRefillsData = list;
      setData(list);

      if (list.length > 0) {
        const match = previousPhone ? list.find(p => p.patient_phone === previousPhone) : null;
        const active = match || list[0];
        setSelectedPatient(active);
        loadPatientFulfillments(active.patient_phone, active.customer_id);
        loadPatientInvoices(active.patient_phone, active.customer_id);
      } else {
        setSelectedPatient(null);
        setFulfillments([]);
        setInvoices([]);
      }
    } catch { 
      if (!silent) toastEvent.trigger('Failed to load refills', 'error', '/crm'); 
    }
    finally { setLoading(false); }
  }, [loadPatientFulfillments, loadPatientInvoices]);

  const loadStagedSummary = useCallback(async () => {
    try {
      const res = await apiClient.get('/refills/staged-summary');
      if (res.data) setStagedSummary(res.data);
    } catch (_) {}
  }, []);

  const handleTogglePatientReminderMode = async (patient: RefillPatient, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const newMode = (patient.reminder_mode || 'manual') === 'auto' ? 'manual' : 'auto';
    // Optimistic UI update
    setData(prev => prev.map(p => {
      if (p.patient_phone === patient.patient_phone) {
        return { ...p, reminder_mode: newMode };
      }
      return p;
    }));
    if (selectedPatient?.patient_phone === patient.patient_phone) {
      setSelectedPatient(prev => prev ? { ...prev, reminder_mode: newMode } : null);
    }

    try {
      await apiClient.put('/refills/patient-reminder-mode', {
        patient_phone: patient.patient_phone,
        customer_id: patient.customer_id,
        reminder_mode: newMode
      });
      toastEvent.trigger(
        `Reminder mode for ${patient.patient_name || 'Patient'} set to ${newMode === 'auto' ? '🤖 Auto' : '👆 Manual (Review)'}`,
        'success',
        '/crm'
      );
      refillEvent.triggerRefresh();
      loadStagedSummary();
    } catch {
      toastEvent.trigger('Failed to update reminder mode', 'error', '/crm');
      load(true);
    }
  };

  const handleDispatchStagedAuto = async () => {
    setDispatchingAuto(true);
    try {
      const res = await apiClient.post('/refills/dispatch-staged-auto');
      toastEvent.trigger(res.data?.message || 'Auto reminders dispatched!', 'success', '/crm');
      refillEvent.triggerRefresh();
      await loadStagedSummary();
      await load(true);
    } catch {
      toastEvent.trigger('Failed to dispatch auto reminders', 'error', '/crm');
    } finally {
      setDispatchingAuto(false);
    }
  };

  const handleSendStagedBriefing = async () => {
    setSendingBriefing(true);
    try {
      const res = await apiClient.post('/refills/send-staged-briefing');
      toastEvent.trigger(res.data?.message || 'Briefing sent to store WhatsApp!', 'success', '/crm');
    } catch (err) {
      toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to send briefing', 'error', '/crm');
    } finally {
      setSendingBriefing(false);
    }
  };

  const handleDismissStagedItem = async (id: number) => {
    setActioningNotifId(id);
    try {
      await api.cancelNotification(id);
      toastEvent.trigger('Staged reminder dismissed', 'info', '/crm');
      await loadStagedSummary();
    } catch {
      toastEvent.trigger('Failed to dismiss reminder', 'error', '/crm');
    } finally {
      setActioningNotifId(null);
    }
  };

  const handleSendSingleStagedItem = async (item: { id: number; recipient_phone: string; message: string; recipient_name: string }) => {
    setActioningNotifId(item.id);
    try {
      await api.enqueueSingleWhatsApp({
        number: item.recipient_phone,
        message: item.message,
        type: 'refill_reminder',
        targetName: item.recipient_name
      });
      await api.manualNotification(item.id);
      toastEvent.trigger(`Reminder queued for ${item.recipient_name}!`, 'success', '/crm');
      whatsappQueueEvent.triggerUpdated();
      await loadStagedSummary();
      await load(true);
    } catch {
      toastEvent.trigger('Failed to queue reminder', 'error', '/crm');
    } finally {
      setActioningNotifId(null);
    }
  };

  const handleUpdateFrequency = async () => {
    if (!editingRefill) return;
    setUpdatingFreq(true);
    try {
      await apiClient.put(`/refills/${editingRefill.id}/frequency`, { refill_interval_days: editIntervalVal });
      toastEvent.trigger(`Updated refill frequency to ${editIntervalVal} days for "${editingRefill.name}"`, 'success', '/crm');
      setEditingRefill(null);
      refillEvent.triggerRefresh();
      await load(true);
    } catch (err) {
      toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to update frequency', 'error', '/crm');
    } finally {
      setUpdatingFreq(false);
    }
  };

  const handleTogglePauseRefill = async (refillId: number, currentIsActive: boolean) => {
    // Optimistic: flip is_active in local state immediately
    setData(prev => prev.map(p => ({
      ...p,
      medicines: (p.medicines || []).map(m => m.id === refillId ? { ...m, is_active: currentIsActive ? 0 : 1 } : m)
    })));
    try {
      const res = await apiClient.post(`/refills/${refillId}/toggle-pause`);
      toastEvent.trigger(res.data?.message || `Refill ${currentIsActive ? 'paused' : 'resumed'}`, 'success', '/crm');
      refillEvent.triggerRefresh();
    } catch (err) {
      // Rollback on failure
      setData(prev => prev.map(p => ({
        ...p,
        medicines: (p.medicines || []).map(m => m.id === refillId ? { ...m, is_active: currentIsActive ? 1 : 0 } : m)
      })));
      toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to toggle pause state', 'error', '/crm');
    }
  };

  const handleCancelRefill = async (refillId: number) => {
    // Optimistic: mark medicine as inactive in local state
    setData(prev => prev.map(p => ({
      ...p,
      medicines: (p.medicines || []).map(m => m.id === refillId ? { ...m, is_active: 0, status: 'cancelled' } : m)
    })));
    try {
      await apiClient.post(`/refills/${refillId}/cancel`);
      toastEvent.trigger('Refill schedule canceled and preserved in history', 'success', '/crm');
      refillEvent.triggerRefresh();
    } catch (err) {
      // Rollback
      setData(prev => prev.map(p => ({
        ...p,
        medicines: (p.medicines || []).map(m => m.id === refillId ? { ...m, is_active: 1, status: 'pending' } : m)
      })));
      toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to cancel refill', 'error', '/crm');
    }
  };

  const handleDeletePatientRefill = async (patient: RefillPatient) => {
    // Optimistic: remove patient from local list immediately
    setData(prev => prev.filter(p => p.patient_phone !== patient.patient_phone));
    if (selectedPatient?.patient_phone === patient.patient_phone) {
      setSelectedPatient(null);
      setFulfillments([]);
      setInvoices([]);
    }
    try {
      const ids = (patient.medicines || []).map(m => m.id).filter(Boolean);
      const res = await apiClient.post('/refills/delete-patient', {
        ids,
        patient_phone: patient.patient_phone,
        customer_id: patient.customer_id,
        patient_name: patient.patient_name
      });
      toastEvent.trigger(res.data?.message || `Refill schedule deleted for ${patient.patient_name}`, 'success', '/crm');
      refillEvent.triggerRefresh();
    } catch (err) {
      // Rollback: restore from server
      toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to delete refill schedule', 'error', '/crm');
      load(true);
    }
  };

  const handleDeleteRefillItem = async (refillId: number, medicineName: string) => {
    // Optimistic: remove medicine from patient's medicines list
    setData(prev => prev.map(p => ({
      ...p,
      medicines: (p.medicines || []).filter(m => m.id !== refillId)
    })).filter(p => (p.medicines || []).length > 0));
    try {
      const res = await apiClient.delete(`/refills/${refillId}`);
      toastEvent.trigger(res.data?.message || `Deleted "${medicineName}" from refill schedule`, 'success', '/crm');
      refillEvent.triggerRefresh();
    } catch (err) {
      // Rollback
      toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to delete refill item', 'error', '/crm');
      load(true);
    }
  };

  const handleFulfillOccurrence = async (refillId: number, medicineName: string) => {
    setFulfillingId(refillId);
    try {
      const res = await apiClient.post(`/refills/${refillId}/fulfill`, {
        fulfilled_via: 'crm_single_complete'
      });
      toastEvent.trigger(res.data?.message || `Completed refill occurrence for "${medicineName}"! Next due date scheduled.`, 'success', '/crm');
      refillEvent.triggerRefresh();
      await load(true);
    } catch (err) {
      toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to mark refill fulfilled', 'error', '/crm');
    } finally {
      setFulfillingId(null);
    }
  };

  const handleFulfillAllForPatient = async (patient: RefillPatient) => {
    setFulfillingAll(true);
    try {
      const res = await apiClient.post(`/refills/patient/${encodeURIComponent(patient.patient_phone)}/fulfill-all`, {
        fulfilled_via: 'crm_batch_complete'
      });
      toastEvent.trigger(res.data?.message || `All active refills fulfilled for ${patient.patient_name}!`, 'success', '/crm');
      refillEvent.triggerRefresh();
      await load(true);
    } catch (err) {
      toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to fulfill patient refills', 'error', '/crm');
    } finally {
      setFulfillingAll(false);
    }
  };

  const handleToggleOverride = async (refillId: number) => {
    try {
      const res = await apiClient.post(`/refills/${refillId}/toggle-override`);
      toastEvent.trigger(res.data?.message || 'Stock override toggled', 'success', '/crm');
      refillEvent.triggerRefresh();
      await load(true);
    } catch (err) {
      toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to toggle override', 'error', '/crm');
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- module-cache hydration loader, silent retries
    load();
    loadStagedSummary();
    const unsub = refillEvent.subscribeRefresh(() => {
      load(true);
      loadStagedSummary();
    });
    return () => unsub();
  }, [load, loadStagedSummary]);

  useEffect(() => {
    const handleSync = () => {
      load(true);
    };
    window.addEventListener('phone-numbers-updated', handleSync);
    window.addEventListener('contacts-updated', handleSync);
    window.addEventListener('distributors-updated', handleSync);
    window.addEventListener('app-customers-updated', handleSync);
    return () => {
      window.removeEventListener('phone-numbers-updated', handleSync);
      window.removeEventListener('contacts-updated', handleSync);
      window.removeEventListener('distributors-updated', handleSync);
      window.removeEventListener('app-customers-updated', handleSync);
    };
  }, [load]);

  // Universal Escape key dismissal for Refill modals
  useModalEscape(showAddModal, () => setShowAddModal(false));
  useModalEscape(!!editingRefill, () => setEditingRefill(null));
  useModalEscape(!!viewInvoice, () => setViewInvoice(null));

  const handleCheck = async () => {
    setRunningCheck(true);
    try {
      await apiClient.post('/refills/check');
      toastEvent.trigger('Refill check triggered', 'success', '/crm');
      refillEvent.triggerRefresh();
      await load(true);
    } catch { toastEvent.trigger('Failed to run check', 'error', '/crm'); }
    finally { setRunningCheck(false); }
  };

  // ── Already Added: mark every active medicine as manually ordered (no cart write) ──
  const handleMarkAllOrdered = async (patient: RefillPatient) => {
    const ids = (patient.medicines || []).filter(m => m.status !== 'canceled').map(m => m.id).filter(Boolean);
    if (ids.length === 0) return;
    setMarkingOrdered(true);
    try {
      await Promise.all(ids.map(id => api.markRefillOrdered(id, { note: 'Manual / Phone Order' }).catch(() => {})));
      toastEvent.trigger(`Marked all refills for ${patient.patient_name} as Ordered`, 'success', '/crm');
      refillEvent.triggerRefresh();
      automationHubEvent.triggerUpdated();
      await load(true);
    } catch {
      toastEvent.trigger('Failed to mark as ordered', 'error', '/crm');
    } finally { setMarkingOrdered(false); }
  };

  // ── Send / Re-Send Collection Reminder: collection-only WhatsApp (due date + store hours auto from Settings) ──
  const handleMarkReadyPatient = async (patient: RefillPatient) => {
    const phone = (patient.patient_phone || '').trim();
    if (!phone) {
      toastEvent.trigger('Patient has no phone number stored', 'error', '/crm');
      return;
    }
    setMarkingReady(true);
    try {
      messageSendEvent.triggerSendProgress(patient.patient_name || 'Patient', 'Dispatching WhatsApp collection reminder...', 10);
      const res = await apiClient.post(`/refills/patient/${encodeURIComponent(phone)}/mark-ready`);
      if (res?.data?.success) {
        toastEvent.trigger(
          res.data.whatsapp_queued
            ? `Collection reminder queued for ${patient.patient_name}!`
            : `Marked refills for "${patient.patient_name}" as Ready!`,
          'success',
          '/crm'
        );
        whatsappQueueEvent.triggerUpdated();
        automationHubEvent.triggerUpdated();
        refillEvent.triggerRefresh();
        await load(true);
      } else {
        throw new Error(res?.data?.error || 'Failed to send collection reminder');
      }
    } catch (err) {
      toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to send collection reminder', 'error', '/crm');
    } finally { setMarkingReady(false); }
  };

  // ── Snooze Patient Refill Reminder (+1d, +3d, +7d) ────────────────────────
  const handleSnoozePatient = async (patient: RefillPatient, days: number) => {
    setSnoozing(true);
    try {
      await apiClient.post('/automation/notifications/snooze-patient', {
        patient_phone: patient.patient_phone,
        patient_name: patient.patient_name,
        days
      });
      toastEvent.trigger(`Refill reminder for ${patient.patient_name} snoozed for ${days} day(s)`, 'success', '/crm');
      refillEvent.triggerRefresh();
      automationHubEvent.triggerUpdated();
      await load(true);
    } catch {
      toastEvent.trigger('Failed to snooze reminder', 'error', '/crm');
    } finally {
      setSnoozing(false);
      setShowMoreMenu(false);
    }
  };

  // ── Sell Refill Patient → POS ─────────────────────────────────────────────
  const handleSellRefillPatient = (patient: RefillPatient) => {
    const activeMeds = patient.medicines.filter(m => m.is_active !== 0 && m.status !== 'canceled');
    const sellableMeds = activeMeds.filter(m => Number(m.in_stock_qty || 0) > 0 || m.stock_verified_override === 1);
    const outOfStockMeds = activeMeds.filter(m => !(Number(m.in_stock_qty || 0) > 0 || m.stock_verified_override === 1));

    if (sellableMeds.length === 0) {
      toastEvent.trigger(`No medicines currently in stock for ${patient.patient_name}. Please record a purchase first.`, 'error', '/crm');
      return;
    }

    navigate('/pos', {
      state: {
        prefill: {
          patientName: patient.patient_name,
          patientPhone: patient.patient_phone,
          customerId: patient.customer_id || undefined,
          refillPatient: true,
          refillIds: sellableMeds.map(m => m.id),
          medicines: sellableMeds.map(m => ({
            medicineId: m.medicine_id,
            medicine_id: m.medicine_id,
            medicine_name: m.medicine_name,
            medicineName: m.medicine_name,
            quantity_needed: m.quantity_needed || 1,
            quantity: m.quantity_needed || 1,
            inventory_id: m.inventory_id,
            batch_no: m.batch_no,
            expiry_date: m.expiry_date,
            mrp: m.mrp,
            sell_price: m.sell_price,
            unit_price: m.unit_price || m.sell_price || m.mrp || 0,
            packaging: m.packaging,
            pack_size: m.pack_size,
            in_stock_qty: m.in_stock_qty || 0,
            stock_qty: m.batch_quantity || m.in_stock_qty || 0,
            loose_quantity: m.batch_loose_quantity || 0
          }))
        }
      }
    });

    const skipNote = outOfStockMeds.length > 0
      ? ` (skipped ${outOfStockMeds.length} out-of-stock: ${outOfStockMeds.map(m => m.medicine_name).join(', ')})`
      : '';
    toastEvent.trigger(`Transferring ${sellableMeds.length} prescribed medicine(s) for ${patient.patient_name} to POS...${skipNote}`, 'info', '/pos');
  };

  // Refill → Live Cart review & order workflow (RefillOrderModal + refillCartJobs.ts background runner)
  const handleOrderRefillShortages = (patient: RefillPatient) => {
    const activeMeds = (patient.medicines || []).filter(m => m.is_active !== 0 && m.status !== 'canceled' && m.status !== 'paused');
    if (activeMeds.length === 0) {
      toastEvent.trigger(`No active prescribed medicines for ${patient.patient_name}.`, 'info', '/crm');
      return;
    }
    setOrderingPatient(patient);
  };

  // ── Fast In-Memory Local Search (0ms instant autocomplete) ────────────────
  const searchLocalInventory = (term: string): MedicineSuggestion[] => {
    const clean = term.trim().toLowerCase();
    if (!clean) return [];
    const compact = getCompactInventoryCache();
    if (!compact || compact.length === 0) return [];
    const index = getCompactInventoryIndex();
    const useIndex = index.length === compact.length;
    const compactTerm = clean.replace(/[^a-z0-9]/g, '');

    const map = new Map<number, MedicineSuggestion>();

    for (let i = 0; i < compact.length; i++) {
      const item = compact[i];
      const mId = Number(item.medicine_id || item.id || 0);
      if (!mId) continue;

      const name = useIndex ? index[i].nameLower : (item.medicine_name || item.name || '').toLowerCase();
      const code = useIndex ? index[i].itemCodeLower : (item.item_code || '').toLowerCase();
      const initials = useIndex ? index[i].initials : '';
      const initialsNoNum = useIndex ? index[i].initialsNoNum : '';

      const matched =
        name.includes(clean) ||
        code.includes(clean) ||
        (compactTerm.length >= 2 && (
          (initials && initials.startsWith(compactTerm)) ||
          (initialsNoNum && initialsNoNum.startsWith(compactTerm))
        ));

      if (matched) {
        const stock = (item.stock_qty || item.quantity || 0) + (item.loose_quantity || 0);
        const existing = map.get(mId);
        if (existing) {
          existing.in_stock_qty = (existing.in_stock_qty || 0) + stock;
          if (!existing.mrp && item.mrp) existing.mrp = item.mrp;
          if (!existing.location && (item.location || item.rack || item.shelf)) {
            existing.location = item.location || item.rack || item.shelf || '';
          }
        } else {
          map.set(mId, {
            id: mId,
            name: item.medicine_name || item.name || '',
            manufacturer: item.manufacturer || '',
            mrp: item.mrp || item.sell_price || 0,
            in_stock_qty: stock,
            location: item.location || item.rack || item.shelf || ''
          });
        }
        if (map.size >= 40) break;
      }
    }

    return Array.from(map.values());
  };

  // ── Medicine row search & inventory dropdown ──────────────────────────────
  const fetchSuggestions = async (idx: number, term: string) => {
    const clean = term.trim();
    if (!clean) {
      setMedicineRows(prev => {
        const updated = [...prev];
        if (updated[idx]) {
          updated[idx] = { ...updated[idx], suggestions: [], loadingSuggestions: false, isOpen: false };
        }
        return updated;
      });
      return;
    }

    // 1. Fast in-memory cache lookup (0ms instant)
    const localMatches = searchLocalInventory(clean);
    if (localMatches.length > 0) {
      setMedicineRows(prev => {
        const updated = [...prev];
        if (updated[idx]) {
          updated[idx] = { ...updated[idx], suggestions: localMatches, loadingSuggestions: false, isOpen: true };
        }
        return updated;
      });
      return;
    }

    // 2. Fallback to server catalog if local stock has 0 matches and user typed 2+ chars
    if (clean.length < 2) {
      setMedicineRows(prev => {
        const updated = [...prev];
        if (updated[idx]) {
          updated[idx] = { ...updated[idx], suggestions: [], loadingSuggestions: false, isOpen: true };
        }
        return updated;
      });
      return;
    }

    setMedicineRows(prev => {
      const updated = [...prev];
      if (updated[idx]) {
        updated[idx] = { ...updated[idx], loadingSuggestions: true, isOpen: true };
      }
      return updated;
    });

    try {
      const catRes = await apiClient.get<{ data?: MedicineSearchRow[] } | MedicineSearchRow[]>('/medicines', {
        params: { search: clean, limit: 20 }
      });
      const catData = Array.isArray(catRes.data) ? catRes.data : catRes.data?.data;
      const list = Array.isArray(catData) ? catData : [];
      const suggestions: MedicineSuggestion[] = list.map(m => ({
        id: m.id,
        name: m.name,
        manufacturer: m.manufacturer,
        mrp: m.mrp || m.sell_price || m.last_purchase_mrp,
        in_stock_qty: 0,
        location: (m as any).location || (m as any).rack || (m as any).shelf || ''
      }));

      setMedicineRows(prev => {
        const updated = [...prev];
        if (updated[idx]) {
          updated[idx] = { ...updated[idx], suggestions, loadingSuggestions: false, isOpen: true };
        }
        return updated;
      });
    } catch {
      setMedicineRows(prev => {
        const updated = [...prev];
        if (updated[idx]) {
          updated[idx] = { ...updated[idx], loadingSuggestions: false };
        }
        return updated;
      });
    }
  };

  const searchDebounceRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const handleMedicineSearch = (idx: number, term: string) => {
    setMedicineRows(prev => {
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        searchTerm: term,
        medicineName: term,
        medicineId: null,
        isOpen: true
      };
      return updated;
    });

    if (searchDebounceRef.current[idx]) {
      clearTimeout(searchDebounceRef.current[idx]);
    }
    searchDebounceRef.current[idx] = setTimeout(() => {
      fetchSuggestions(idx, term);
    }, 250);
  };

  const selectMedicine = (idx: number, s: MedicineSuggestion) => {
    setMedicineRows(prev => {
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        medicineId: s.id,
        medicineName: s.name,
        manufacturer: s.manufacturer,
        mrp: s.mrp,
        inStockQty: s.in_stock_qty,
        searchTerm: s.name,
        suggestions: [],
        isOpen: false
      };
      return updated;
    });
  };

  const updateQty = (idx: number, qty: number) => {
    setMedicineRows(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], quantity_needed: Math.max(1, qty) };
      return updated;
    });
  };

  // ── Submit Add / Edit Refill ──────────────────────────────────────────────
  const handleSaveRefill = async (e: React.FormEvent) => {
    e.preventDefault();
    const fullPatientName = combineSalutationAndName(refillSalutation, refillCustomSalutation, addPatientName);
    if (!fullPatientName || !addPatientPhone.trim()) {
      toastEvent.trigger('Patient name and phone are required', 'error');
      return;
    }
    const validRows = medicineRows.filter(r => r.medicineId);
    if (validRows.length === 0) {
      toastEvent.trigger('Please select at least one medicine from the inventory dropdown', 'error');
      return;
    }
    const intervalDays = getEffectiveIntervalDays();
    setSubmitting(true);
    try {
      await apiClient.put('/refills/patient-medicines', {
        customer_id: editingPatient?.customer_id,
        original_phone: editingPatient?.patient_phone || addPatientPhone.trim(),
        patient_name: fullPatientName,
        patient_phone: addPatientPhone.trim(),
        language: addLanguage,
        refill_interval_days: intervalDays,
        is_edit: !!editingPatient,
        medicines: validRows.map(row => ({
          medicine_id: row.medicineId,
          medicine_name: row.medicineName,
          quantity_needed: row.quantity_needed || 3
        }))
      });
      toastEvent.trigger(
        `${editingPatient ? 'Refill updated' : 'Refill registered'} for ${fullPatientName} (${validRows.length} medicine${validRows.length > 1 ? 's' : ''}, every ${intervalDays} days)`,
        'success',
        '/crm'
      );

      // Persist reminder mode preference for this patient
      await apiClient.put('/refills/patient-reminder-mode', {
        patient_phone: addPatientPhone.trim(),
        customer_id: editingPatient?.customer_id,
        reminder_mode: addReminderMode
      }).catch(() => {});

      localStorage.removeItem('crm_refill_draft');
      setHasRefillDraft(false);
      setShowAddModal(false);
      setEditingPatient(null);
      setRefillSalutation('Mr.');
      setRefillCustomSalutation('');
      setAddPatientName('');
      setAddPatientPhone('');
      setAddInterval(30);
      setFreqMode('preset');
      setMedicineRows([emptyRow()]);
      refillEvent.triggerRefresh();
      await load(true);
    } catch (err) {
      toastEvent.trigger((err as LocalApiError).response?.data?.error || (editingPatient ? 'Failed to update refill' : 'Failed to add refill'), 'error', '/crm');
    } finally { setSubmitting(false); }
  };

  // Filter calculation
  const filtered = data.filter(p => {
    const q = search.toLowerCase().trim();
    const matchesSearch = !q || (p.patient_name?.toLowerCase().includes(q)) || (p.patient_phone?.includes(q));
    if (!matchesSearch) return false;

    const today = new Date();
    const dueDate = new Date(p.next_refill_date);
    const isOverdue = dueDate < today;
    const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / 86400000);
    const isLeadWindow = !isOverdue && diffDays <= 6 && diffDays >= 0;

    const isSettled = isPatientRefillsSettled(p.medicines.map(m => ({ ...m, reminder_status: m.reminder_status ?? p.reminder_status })));

    // Action tabs hide patients already fully handled (ordered + reminder sent); master tabs keep everyone
    if (filterTab === 'overdue' && !showSettledOverdue && isSettled) return false;
    if (filterTab === 'lead' && isSettled) return false;
    if (filterTab === 'overdue') return isOverdue;
    if (filterTab === 'lead') return isLeadWindow;
    if (filterTab === 'active') {
      return p.medicines.some(m => m.is_active !== 0 && m.status !== 'canceled');
    }
    if (filterTab === 'paused') {
      return p.medicines.some(m => m.is_active === 0 || m.status === 'paused');
    }
    if (filterTab === 'canceled') {
      return p.medicines.some(m => m.status === 'canceled');
    }
    return true; // 'all'
  });

  // Top metric stats
  const totalPrescriptions = data.reduce((sum, p) => sum + (p.medicines?.length || 0), 0);
  const actionableOverdueCount = data.filter(p => {
    const isOverdue = new Date(p.next_refill_date) < new Date();
    const isSettled = isPatientRefillsSettled(p.medicines.map(m => ({ ...m, reminder_status: m.reminder_status ?? p.reminder_status })));
    return isOverdue && !isSettled;
  }).length;
  const settledOverdueCount = data.filter(p => {
    const isOverdue = new Date(p.next_refill_date) < new Date();
    const isSettled = isPatientRefillsSettled(p.medicines.map(m => ({ ...m, reminder_status: m.reminder_status ?? p.reminder_status })));
    return isOverdue && isSettled;
  }).length;
  const leadWindowCount = data.filter(p => {
    const today = new Date();
    const dueDate = new Date(p.next_refill_date);
    const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / 86400000);
    return dueDate >= today && diffDays <= 6 && diffDays >= 0;
  }).length;

  // Patients with an active refill medicine that has no linked distributor.
  // Derived from live data, so the card vanishes by itself once all are linked.
  const unlinkedPatients = data
    .map(p => ({
      patient: p,
      meds: (p.medicines || []).filter(
        m => m.is_active !== 0 && m.status !== 'canceled' && m.status !== 'paused' && !m.linked_distributors?.length
      ),
    }))
    .filter(x => x.meds.length > 0);

  // Selected patient calculations
  const isSelectedOverdue = selectedPatient ? new Date(selectedPatient.next_refill_date) < new Date() : false;
  const selectedDiffDays = selectedPatient
    ? Math.ceil((new Date(selectedPatient.next_refill_date).getTime() - new Date().getTime()) / 86400000)
    : 0;
  const isSelectedLeadWindow = selectedPatient && !isSelectedOverdue && selectedDiffDays <= 6 && selectedDiffDays >= 0;
  const hasSelectedShortage = selectedPatient?.medicines.some(m => Number(m.quantity_needed || 3) > Number(m.in_stock_qty || 0));
  const isSelected3DayAlert = selectedPatient && !isSelectedOverdue && selectedDiffDays <= 3 && hasSelectedShortage;

  return (
    <div className="w-full h-full flex flex-col gap-3 overflow-hidden pr-1">
      {/* ── Top Summary Metrics Cards (Matching Customer Credit Layout) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        <div className="p-3.5 bg-bg border border-border rounded-2xl flex items-center justify-between shadow-sm">
          <div>
            <p className="text-[11px] text-muted font-medium">Total Prescribed Patients</p>
            <h3 className="text-lg font-bold text-text mt-0.5">
              {data.length} <span className="text-xs font-semibold text-muted">({totalPrescriptions} Meds)</span>
            </h3>
          </div>
          <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <Repeat2 size={18} />
          </div>
        </div>

        <div className="p-3.5 bg-bg border border-border rounded-2xl flex items-center justify-between shadow-sm">
          <div>
            <p className="text-[11px] text-muted font-medium">Overdue Prescriptions</p>
            <h3 className={`text-lg font-bold mt-0.5 ${actionableOverdueCount > 0 ? 'text-red-400' : 'text-text'}`}>
              {actionableOverdueCount} Overdue
            </h3>
            {settledOverdueCount > 0 && (
              <p className="text-[10px] text-emerald-400 font-semibold mt-0.5">
                {settledOverdueCount} handled in cart/reminded
              </p>
            )}
          </div>
          <div className={`p-2 rounded-xl border ${actionableOverdueCount > 0 ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
            <AlertCircle size={18} />
          </div>
        </div>

        <div className="p-3.5 bg-bg border border-border rounded-2xl flex items-center justify-between shadow-sm">
          <div>
            <p className="text-[11px] text-muted font-medium">Due in 5-6 Days (Prep Window)</p>
            <h3 className="text-lg font-bold text-amber-400 mt-0.5">
              {leadWindowCount} Upcoming
            </h3>
          </div>
          <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Bell size={18} />
          </div>
        </div>

        {unlinkedPatients.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowUnlinked(v => !v)}
              className="w-full h-full p-3.5 bg-bg border border-amber-500/40 rounded-2xl flex items-center justify-between shadow-sm cursor-pointer text-left"
              title="Click to see patients whose medicine is not linked to a distributor"
            >
              <div>
                <p className="text-[11px] text-muted font-medium">Not linked to distributor</p>
                <h3 className="text-lg font-bold text-amber-400 mt-0.5">
                  {unlinkedPatients.length} Patient{unlinkedPatients.length > 1 ? 's' : ''}
                </h3>
              </div>
              <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <AlertCircle size={18} />
              </div>
            </button>
            {showUnlinked && (
              <div className="absolute z-dropdown left-0 right-0 top-full mt-1 max-h-64 overflow-y-auto dropdown-scroll bg-bg2 border border-border rounded-xl shadow-lg">
                {unlinkedPatients.map(({ patient, meds }) => (
                  <button
                    key={patient.customer_id ?? patient.patient_phone}
                    type="button"
                    onClick={() => {
                      selectPatientAndLoadDetails(patient);
                      setShowUnlinked(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-bg3 border-b border-border last:border-0 cursor-pointer"
                  >
                    <div className="text-xs font-bold text-text">{patient.patient_name}</div>
                    <div className="text-[10px] text-muted truncate">
                      {meds.map(m => m.medicine_name).join(', ')}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="p-3.5 bg-bg border border-border rounded-2xl flex items-center justify-between gap-2 shadow-sm">
          <button
            onClick={() => handleOpenAddModal()}
            className="flex-1 h-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary text-xs font-bold transition-all active:scale-95 cursor-pointer"
            title="Register new patient refill schedule"
          >
            <Plus size={14} />
            <span>+ Add Refill</span>
          </button>
          <button
            type="button"
            onClick={() => setShowDelayModal(true)}
            className="h-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-400 text-xs font-bold transition-all active:scale-95 cursor-pointer"
            title="Broadcast delay / market-off notice to patients"
          >
            <Clock size={13} />
            <span>Delay Notice</span>
          </button>
          <button
            onClick={handleCheck}
            disabled={runningCheck}
            className="h-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-bg3 border border-border text-xs font-bold text-text hover:text-primary transition-all disabled:opacity-50 active:scale-95 cursor-pointer"
            title="Run 3-day automated stock check"
          >
            <RefreshCw size={13} className={runningCheck ? 'animate-spin' : ''} />
            <span>Run Check</span>
          </button>
          <button
            onClick={() => load()}
            disabled={loading}
            className="p-2 rounded-xl bg-bg3 border border-border text-muted hover:text-text transition-all disabled:opacity-50 active:scale-95 cursor-pointer"
            title="Refresh refills from server"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Staged Reminders & Pharmacy Alert Banner ── */}
      {stagedSummary && stagedSummary.total_staged > 0 && (
        <div className="p-3 bg-bg2 border border-primary/30 rounded-2xl flex flex-col gap-2 shadow-sm shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary"></span>
              </span>
              <div>
                <span className="text-xs font-bold text-text">
                  {stagedSummary.total_staged} Staged Reminder{stagedSummary.total_staged > 1 ? 's' : ''} Pending Review
                </span>
                <span className="text-[11px] text-muted ml-2">
                  ({stagedSummary.auto_count} Auto 🤖, {stagedSummary.manual_count} Manual 👆)
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {stagedSummary.auto_count > 0 && (
                <button
                  type="button"
                  onClick={handleDispatchStagedAuto}
                  disabled={dispatchingAuto}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-50 cursor-pointer shadow-xs"
                  title="Human approval: One-click batch dispatch of all Auto-mode patient reminders"
                >
                  <Zap size={13} className={dispatchingAuto ? 'animate-spin' : ''} />
                  <span>{dispatchingAuto ? 'Dispatching...' : `Approve & Send Auto (${stagedSummary.auto_count})`}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleSendStagedBriefing}
                disabled={sendingBriefing}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-bg3 border border-border text-text hover:text-primary rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                title="Send current staged summary to store owner WhatsApp number first"
              >
                <Phone size={13} className={sendingBriefing ? 'animate-pulse text-primary' : 'text-primary'} />
                <span>{sendingBriefing ? 'Sending...' : 'Alert Store WhatsApp'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowStagedDetails(prev => !prev)}
                className="px-2.5 py-1.5 bg-bg3 border border-border text-muted hover:text-text rounded-xl text-xs font-semibold cursor-pointer"
              >
                {showStagedDetails ? 'Hide' : 'Review Staged'}
              </button>
            </div>
          </div>

          {/* Expandable Staged Items List */}
          {showStagedDetails && (
            <div className="mt-2 pt-2 border-t border-border grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
              {stagedSummary.staged_items.map(item => (
                <div key={item.id} className="p-2.5 bg-bg border border-border rounded-xl flex flex-col justify-between gap-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-text truncate">{item.recipient_name}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      item.reminder_mode === 'auto'
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                    }`}>
                      {item.reminder_mode === 'auto' ? '🤖 Auto' : '👆 Manual'}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted line-clamp-2">{item.message}</p>
                  <div className="flex items-center justify-between pt-1 border-t border-border/50">
                    <span className="text-[10px] text-muted">{item.recipient_phone}</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleDismissStagedItem(item.id)}
                        disabled={actioningNotifId === item.id}
                        className="px-2 py-0.5 rounded text-[10px] text-muted hover:text-red-400 cursor-pointer"
                        title="Dismiss/Disapprove this staged reminder"
                      >
                        Dismiss
                      </button>
                      {(() => {
                        const isPickup = item.message.includes('READY') || item.message.includes('COLLECTION') || item.message.includes('collection') || item.message.includes('तैयार') || item.message.includes('तयार');
                        return (
                          <button
                            type="button"
                            onClick={() => handleSendSingleStagedItem(item)}
                            disabled={actioningNotifId === item.id}
                            className={isPickup ? 'px-2 py-0.5 rounded font-bold text-[10px] cursor-pointer text-white transition-colors bg-emerald-600 hover:bg-emerald-700' : 'px-2 py-0.5 rounded font-bold text-[10px] cursor-pointer text-white transition-colors bg-primary hover:bg-primary/90'}
                            title={isPickup ? "Send pickup reminder now via WhatsApp" : "Send refill reminder now via WhatsApp"}
                          >
                            {isPickup ? 'Send Pickup' : 'Send'}
                          </button>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Main Unified Resizable Split-View Container (Matching WhatsApp & Credit) ── */}
      <div className="flex-1 min-h-0 flex bg-bg2 border border-border rounded-2xl overflow-hidden shadow-sm">
        {/* Left: Patient List Panel (Resizable Width) */}
        <div
          style={{ width: `${sidebarWidth}px` }}
          className="border-r border-border flex flex-col bg-bg3/40 min-h-0 shrink-0 select-none"
        >
          {/* Header Bar */}
          <div className="p-3 border-b border-border flex items-center justify-between gap-2 shrink-0">
            <h3 className="text-xs font-bold text-text uppercase tracking-wider flex items-center gap-1.5">
              <Repeat2 size={14} className="text-primary" />
              <span>Patients &amp; Schedules</span>
            </h3>
            <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full font-bold">
              {filtered.length}
            </span>
          </div>

          {/* Status Filter Pills */}
          <div className="p-2 border-b border-border bg-bg shrink-0 flex items-center gap-1 overflow-x-auto no-scrollbar">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'overdue', label: '🚨 Overdue' },
                { id: 'lead', label: '🔔 Due Soon' },
                { id: 'active', label: 'Active' },
                { id: 'paused', label: 'Paused' },
                { id: 'canceled', label: 'Canceled' }
              ] as const
            ).map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterTab(tab.id)}
                className={`px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all shrink-0 cursor-pointer ${
                  filterTab === tab.id
                    ? 'bg-primary text-white shadow-xs'
                    : 'text-muted hover:text-text hover:bg-bg3'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Input */}
          <div className="p-2.5 border-b border-border bg-bg shrink-0 flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-2.5 text-muted" />
              <input
                type="text"
                placeholder="Search patient, mobile or barcode..."
                value={search}
                onChange={e => {
                  const val = e.target.value;
                  setSearch(val.includes('|') ? val.split('|')[0].trim() : val);
                }}
                className="w-full pl-8 pr-2.5 py-1.5 bg-bg2 border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary"
              />
            </div>
            {filterTab === 'overdue' && settledOverdueCount > 0 && (
              <button
                type="button"
                onClick={() => setShowSettledOverdue(v => !v)}
                className={`px-2 py-1 rounded-xl border text-[10px] font-bold transition-colors cursor-pointer shrink-0 ${
                  showSettledOverdue
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                    : 'bg-bg2 border-border text-muted hover:text-text'
                }`}
                title="Toggle display of overdue patients who are already ordered & reminded"
              >
                {showSettledOverdue ? 'Hide Handled' : `+${settledOverdueCount} Handled`}
              </button>
            )}
            <button
              onClick={() => load()}
              disabled={loading}
              className="p-1.5 rounded-xl bg-bg2 border border-border text-muted hover:text-text transition-all active:scale-95 disabled:opacity-50"
              title="Refresh list"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* Patient Cards List */}
          <div className="flex-1 overflow-y-auto divide-y divide-border/40">
            {loading && data.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted flex items-center justify-center gap-2">
                <RefreshCw size={14} className="animate-spin text-primary" /> Loading refills...
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted space-y-2">
                <div>No refill patients found for this filter.</div>
                {filterTab === 'overdue' && settledOverdueCount > 0 && !showSettledOverdue && (
                  <button
                    type="button"
                    onClick={() => setShowSettledOverdue(true)}
                    className="px-3 py-1.5 rounded-xl bg-bg2 border border-border text-[11px] font-bold text-primary hover:bg-bg3 cursor-pointer"
                  >
                    View {settledOverdueCount} handled / settled patient{settledOverdueCount > 1 ? 's' : ''}
                  </button>
                )}
              </div>
            ) : (
              filtered.map(patient => {
                const isSelected = selectedPatient?.patient_phone === patient.patient_phone;
                const dueDate = new Date(patient.next_refill_date);
                const isOverdue = dueDate < new Date();
                const diffDays = Math.ceil((dueDate.getTime() - new Date().getTime()) / 86400000);
                const isLead = !isOverdue && diffDays <= 6 && diffDays >= 0;
                const medsCount = patient.medicines?.length || 0;
                const allPaused = medsCount > 0 && patient.medicines.every(m => m.is_active === 0 || m.status === 'paused');

                return (
                  <div
                    key={patient.patient_phone}
                    onClick={() => selectPatientAndLoadDetails(patient)}
                    className={`p-3 cursor-pointer transition-all flex items-center justify-between hover:bg-bg/60 ${
                      isSelected ? 'bg-primary/10 border-l-4 border-primary font-semibold' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 border ${
                          allPaused
                            ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                            : isOverdue
                            ? 'bg-red-500/15 text-red-400 border-red-500/30'
                            : isLead
                            ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                            : 'bg-primary/15 text-primary border-primary/30'
                        }`}
                      >
                        {patient.patient_name?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-text truncate flex items-center gap-1.5 flex-wrap">
                          <span className="truncate">{patient.patient_name || 'Unnamed Patient'}</span>
                          {patient.medicines?.some(m => m.patient_confirmed === 1) && (
                            <span className="px-1 py-0.2 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[8px] font-bold shrink-0" title="Patient confirmed refill via WhatsApp">
                              WA Confirmed ✅
                            </span>
                          )}
                          {patient.medicines?.some(m => m.is_ready === 1 || m.quick_bill_id) && (
                            <span className="px-1 py-0.2 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[8px] font-bold shrink-0" title="Medicines packed and ready for pickup">
                              Ready for Pickup 📦
                            </span>
                          )}
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-bg3 text-muted border border-border/60 shrink-0 font-normal">
                            {patient.language === 'hi' ? '🇮🇳 HI' : patient.language === 'mr' ? '🇮🇳 MR' : '🇬🇧 EN'}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => handleTogglePatientReminderMode(patient, e)}
                            className={`text-[9px] px-1.5 py-0.2 rounded border shrink-0 font-bold transition-all cursor-pointer ${
                              (patient.reminder_mode || 'manual') === 'auto'
                                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25'
                                : 'bg-sky-500/15 text-sky-400 border-sky-500/30 hover:bg-sky-500/25'
                            }`}
                            title="Click to toggle: Auto dispatch 🤖 vs Manual review 👆"
                          >
                            {(patient.reminder_mode || 'manual') === 'auto' ? '🤖 Auto' : '👆 Manual'}
                          </button>
                        </div>
                        <div className="text-[10px] text-muted flex items-center gap-1.5 mt-0.5 truncate">
                          <span>📱 {patient.patient_phone}</span>
                          <span>•</span>
                          <span>{medsCount} Med{medsCount !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div
                        className={`text-[10px] font-bold ${
                          allPaused ? 'text-amber-400' : isOverdue ? 'text-red-400' : isLead ? 'text-amber-400' : 'text-emerald-400'
                        }`}
                      >
                        {allPaused ? '⏸️ Paused' : isOverdue ? `Overdue ${Math.abs(diffDays)}d` : isLead ? `Due in ${diffDays}d` : formatDate(patient.next_refill_date)}
                      </div>
                      <div className="text-[9px] text-muted mt-0.5 flex items-center justify-end gap-1">
                        {patient.reminder_status === 'SENT' ? (
                          <span className="text-emerald-400 font-medium" title="Reminder sent">✓ Sent</span>
                        ) : patient.reminder_status === 'QUEUED' ? (
                          <span className="text-amber-400 font-medium" title="Reminder queued">⏳ Queued</span>
                        ) : (
                          <span>{isOverdue ? 'Action Needed' : 'Scheduled'}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Resizable Divider Handle */}
        <div
          onMouseDown={(e) => { e.preventDefault(); setIsDragging(true); }}
          className="w-1.5 hover:w-2 bg-border/40 hover:bg-primary/60 cursor-col-resize transition-all shrink-0 select-none flex items-center justify-center group"
          title="Drag to resize patient panel (auto-saved)"
        >
          <div className="w-0.5 h-6 bg-muted/40 group-hover:bg-primary rounded-full transition-colors" />
        </div>

        {/* Right: Selected Patient Command Center */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {selectedPatient ? (
            <>
              {/* Account / Patient Header Bar */}
              <div className="p-3.5 border-b border-border bg-bg2 flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary/20 text-primary border border-primary/30 font-bold text-xs flex items-center justify-center flex-shrink-0">
                    {selectedPatient.patient_name?.[0]?.toUpperCase() || 'P'}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-sm font-bold text-text">{selectedPatient.patient_name || 'Unnamed Patient'}</h2>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        isSelectedOverdue
                          ? 'bg-red-500/10 text-red-400 border-red-500/20'
                          : isSelectedLeadWindow
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      }`}>
                        {isSelectedOverdue ? '🚨 OVERDUE REFILL' : isSelectedLeadWindow ? '🔔 PREP WINDOW ACTIVE' : 'ACTIVE SCHEDULE'}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-bg3 text-text border border-border">
                        {selectedPatient.language === 'hi' ? '🇮🇳 HI' : selectedPatient.language === 'mr' ? '🇮🇳 MR' : '🇬🇧 EN'}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleTogglePatientReminderMode(selectedPatient)}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-all cursor-pointer ${
                          (selectedPatient.reminder_mode || 'manual') === 'auto'
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25'
                            : 'bg-sky-500/15 text-sky-400 border-sky-500/30 hover:bg-sky-500/25'
                        }`}
                        title="Click to toggle reminder dispatch mode for this patient"
                      >
                        {(selectedPatient.reminder_mode || 'manual') === 'auto' ? '🤖 Auto Dispatch' : '👆 Manual Approval'}
                      </button>
                    </div>
                    <div className="text-xs text-muted mt-0.5 flex items-center gap-3 flex-wrap">
                      <span className="flex items-center gap-1 font-mono text-text">
                        <Phone size={11} className="text-primary" /> {selectedPatient.patient_phone}
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Calendar size={11} className="text-accent" />
                        <span>Next Due: <strong>{formatDate(selectedPatient.next_refill_date)}</strong></span>
                        {selectedDiffDays > 0 ? (
                          <span className="text-[10px] text-muted">({selectedDiffDays} days remaining)</span>
                        ) : selectedDiffDays === 0 ? (
                          <span className="text-[10px] text-amber-400 font-bold">(Due Today)</span>
                        ) : (
                          <span className="text-[10px] text-red-400 font-bold">({Math.abs(selectedDiffDays)} days overdue)</span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right Action Toolbar — simplified 3-button staged workflow (owner rule 2026-10):
                    Stage A 'upcoming' → [Add to Cart] [Already Added] [Edit]
                    Stage B 'ordered' → [Send Reminder] [POS] [Edit]
                    Stage C 'reminded' → [Re-Send Reminder] [POS] (+ ••• overflow) */}
                <div className="flex items-center gap-2 flex-wrap">
                  {(() => {
                    const meds = (selectedPatient.medicines || []).map(m => ({
                      status: m.status,
                      cart_store_name: (m as { cart_store_name?: string | null }).cart_store_name ?? null,
                      reminder_status: m.reminder_status ?? selectedPatient.reminder_status ?? null
                    }));
                    const stage = getRefillStage(meds);
                    const unaddedCount = (selectedPatient.medicines || []).filter(
                      m => !(m as { cart_store_name?: string | null }).cart_store_name && m.status !== 'ordered' && m.status !== 'canceled'
                    ).length;
                    const editBtn = (
                      <button
                        onClick={() => handleOpenAddModal(selectedPatient)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-bg3 border border-border text-text hover:text-primary hover:border-primary/40 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer"
                        title="Edit refill schedule for this patient"
                      >
                        <Edit2 size={13} />
                        <span>Edit</span>
                      </button>
                    );
                    const posBtn = (
                      <button
                        onClick={() => handleSellRefillPatient(selectedPatient)}
                        title="Sell now: Pre-loads all prescribed medicines & quantities into POS"
                        className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black shadow-md shadow-emerald-500/20 transition-all hover:scale-105 active:scale-95 cursor-pointer"
                      >
                        <ShoppingCart size={13} />
                        <span>POS</span>
                      </button>
                    );
                    if (stage === 'upcoming') {
                      return (
                        <>
                          <button
                            onClick={() => handleOrderRefillShortages(selectedPatient)}
                            title="Add every short medicine to the Pharmarack live cart using the saved distributors"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-xs"
                          >
                            <ShoppingCart size={13} />
                            <span>Add to Cart{unaddedCount > 0 ? ` (${unaddedCount})` : ''}</span>
                          </button>
                          <button
                            onClick={() => handleMarkAllOrdered(selectedPatient)}
                            disabled={markingOrdered}
                            title="Already added / ordered outside Pharmarack"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-bg3 hover:bg-emerald-600 hover:text-white text-muted border border-border text-xs font-bold transition-all active:scale-95 disabled:opacity-50 cursor-pointer shadow-xs"
                          >
                            <Check size={13} className={markingOrdered ? 'animate-spin' : ''} />
                            <span>{markingOrdered ? 'Marking…' : 'Already Added'}</span>
                          </button>
                          {editBtn}
                        </>
                      );
                    }
                    if (stage === 'ordered') {
                      return (
                        <>
                          <button
                            onClick={() => handleMarkReadyPatient(selectedPatient)}
                            disabled={markingReady}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition-all active:scale-95 disabled:opacity-50 cursor-pointer shadow-xs"
                            title="Send collection reminder WhatsApp (due date + store hours auto from Settings)"
                          >
                            <Send size={12} className={markingReady ? 'animate-pulse' : ''} />
                            <span>{markingReady ? 'Sending…' : 'Send Reminder'}</span>
                          </button>
                          {posBtn}
                          {editBtn}
                        </>
                      );
                    }
                    return (
                      <>
                        <button
                          onClick={() => handleMarkReadyPatient(selectedPatient)}
                          disabled={markingReady}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition-all active:scale-95 disabled:opacity-50 cursor-pointer shadow-xs"
                          title="Re-send collection reminder WhatsApp"
                        >
                          <RotateCcw size={12} className={markingReady ? 'animate-spin' : ''} />
                          <span>{markingReady ? 'Sending…' : 'Re-Send Reminder'}</span>
                        </button>
                        {posBtn}
                      </>
                    );
                  })()}

                  {/* Overflow: advanced lifecycle actions */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowMoreMenu(prev => !prev)}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-bg3 hover:bg-bg3/80 border border-border text-muted hover:text-text rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-xs"
                      title="More refill actions (snooze, add medicine, fulfill cycle, delete)"
                    >
                      <MoreHorizontal size={13} />
                    </button>
                    {showMoreMenu && (
                      <div className="absolute right-0 top-full mt-1 z-dropdown bg-bg2 border border-border rounded-xl shadow-2xl p-1.5 min-w-[170px] flex flex-col gap-1 animate-in fade-in">
                        <button
                          type="button"
                          disabled={snoozing}
                          onClick={() => { setShowMoreMenu(false); handleSnoozePatient(selectedPatient, 1); }}
                          className="px-3 py-1.5 text-left text-xs font-semibold hover:bg-bg3 rounded-lg text-text transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                          <Clock size={11} className="text-amber-400" />
                          <span>{snoozing ? 'Snoozing…' : '💤 Snooze +1 Day'}</span>
                        </button>
                        <button
                          type="button"
                          disabled={snoozing}
                          onClick={() => { setShowMoreMenu(false); handleSnoozePatient(selectedPatient, 3); }}
                          className="px-3 py-1.5 text-left text-xs font-semibold hover:bg-bg3 rounded-lg text-text transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                          <Clock size={11} className="text-amber-400" />
                          <span>💤 Snooze +3 Days</span>
                        </button>
                        <button
                          type="button"
                          disabled={snoozing}
                          onClick={() => { setShowMoreMenu(false); handleSnoozePatient(selectedPatient, 7); }}
                          className="px-3 py-1.5 text-left text-xs font-semibold hover:bg-bg3 rounded-lg text-text transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                          <Clock size={11} className="text-amber-400" />
                          <span>💤 Snooze +7 Days</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowMoreMenu(false); handleOpenAddMedicineForSelected(); }}
                          className="px-3 py-1.5 text-left text-xs font-semibold hover:bg-bg3 rounded-lg text-text transition-colors flex items-center gap-2 cursor-pointer"
                        >
                          <Pill size={11} className="text-primary" />
                          <span>+ Add Med</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowMoreMenu(false); handleFulfillAllForPatient(selectedPatient); }}
                          disabled={fulfillingAll}
                          className="px-3 py-1.5 text-left text-xs font-semibold hover:bg-bg3 rounded-lg text-emerald-400 transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                          <Check size={11} className={fulfillingAll ? 'animate-spin' : ''} />
                          <span>{fulfillingAll ? 'Advancing…' : 'Fulfill Cycle'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowMoreMenu(false); handleDeletePatientRefill(selectedPatient); }}
                          className="px-3 py-1.5 text-left text-xs font-semibold hover:bg-red-500/10 rounded-lg text-red-400 transition-colors flex items-center gap-2 cursor-pointer"
                        >
                          <Trash2 size={11} />
                          <span>Delete Schedule</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Sub-Tab Navigation Bar */}
              <div className="px-4 pt-2.5 border-b border-border bg-bg3/20 flex items-center gap-4 shrink-0">
                <button
                  onClick={() => setActiveDetailTab('prescriptions')}
                  className={`pb-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
                    activeDetailTab === 'prescriptions'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted hover:text-text'
                  }`}
                >
                  <Package size={13} />
                  <span>Prescriptions &amp; Stock ({selectedPatient.medicines?.length || 0})</span>
                </button>

                <button
                  onClick={() => {
                    setActiveDetailTab('fulfillments');
                    loadPatientFulfillments(selectedPatient.patient_phone, selectedPatient.customer_id);
                  }}
                  className={`pb-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
                    activeDetailTab === 'fulfillments'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted hover:text-text'
                  }`}
                >
                  <Clock size={13} />
                  <span>Fulfillment History ({fulfillments.length})</span>
                </button>

                <button
                  onClick={() => {
                    setActiveDetailTab('invoices');
                    loadPatientInvoices(selectedPatient.patient_phone, selectedPatient.customer_id);
                  }}
                  className={`pb-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
                    activeDetailTab === 'invoices'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted hover:text-text'
                  }`}
                >
                  <FileText size={13} />
                  <span>Sales &amp; Purchase Bills ({invoices.length})</span>
                </button>
              </div>

              {/* Sub-Views Container */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                {/* ── VIEW 1: Prescriptions & Stock Analysis ── */}
                {activeDetailTab === 'prescriptions' && (
                  <div className="space-y-3">
                    {/* Lead Window Notification Banner */}
                    {isSelectedLeadWindow && (
                      <div className="px-3.5 py-2.5 bg-bg border border-amber-500/30 rounded-xl text-xs font-bold text-amber-400 flex items-center justify-between flex-wrap gap-2 shadow-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-base animate-bounce">🔔</span>
                          <span>Refill On The Way! 5-6 Day Lead Notification Window Active (Due in {selectedDiffDays} day{selectedDiffDays !== 1 ? 's' : ''})</span>
                        </div>
                        <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-md font-mono uppercase tracking-wider">
                          Order Prep Window
                        </span>
                      </div>
                    )}

                    {/* 3-Day Automated Inventory Stock Check Alert */}
                    {isSelected3DayAlert && (
                      <div className="px-3.5 py-2.5 bg-bg border border-red-500/30 rounded-xl text-xs font-extrabold text-red-400 flex items-center justify-between flex-wrap gap-2 animate-pulse shadow-xs">
                        <div className="flex items-center gap-2">
                          <AlertCircle size={14} className="text-red-400 shrink-0" />
                          <span>Automated 3-Day Inventory Stock Check: Shortage detected! Add shortage to Live Cart below.</span>
                        </div>
                        <span className="text-[10px] bg-red-500/20 text-red-300 px-2 py-0.5 rounded-md font-mono uppercase tracking-wider">
                          3-Day Stock Alert
                        </span>
                      </div>
                    )}

                    {/* Medicines List */}
                    <div className="space-y-2.5">
                      {selectedPatient.medicines.map(med => {
                        const reqQty = Number(med.quantity_needed !== undefined && med.quantity_needed !== null ? med.quantity_needed : 3);
                        const stockQty = Number(med.in_stock_qty || 0);
                        const shortageQty = Math.max(0, reqQty - stockQty);
                        const cartOrderQty = shortageQty > 0 ? shortageQty : reqQty;
                        const isPaused = med.is_active === 0 || med.status === 'paused';
                        const isCanceled = med.status === 'canceled';
                        const isOverridden = med.stock_verified_override === 1;

                        return (
                          <div
                            key={med.id}
                            className={`p-3.5 rounded-xl border flex flex-col gap-3 transition-all ${
                              isCanceled
                                ? 'bg-red-500/5 border-red-500/20 opacity-75'
                                : isPaused
                                ? 'bg-amber-500/5 border-amber-500/20'
                                : 'bg-bg border-border hover:border-border/80 shadow-xs'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3 flex-wrap">
                              <div className="flex items-start gap-2.5 min-w-[220px]">
                                <div className={`p-2 rounded-xl mt-0.5 shrink-0 ${
                                  isCanceled ? 'bg-red-500/10 text-red-400' : isPaused ? 'bg-amber-500/10 text-amber-400' : 'bg-primary/10 text-primary'
                                }`}>
                                  <Package size={16} />
                                </div>
                                <div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <h4 className={`text-sm font-bold text-text ${isCanceled ? 'line-through opacity-70' : ''}`}>
                                      {med.medicine_name}
                                    </h4>
                                    {med.packaging && (
                                      <span className="text-[10px] text-muted font-medium px-1.5 py-0.5 rounded bg-bg3 border border-border">
                                        {med.packaging}
                                      </span>
                                    )}
                                    {isPaused && (
                                      <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                        ⏸️ Paused
                                      </span>
                                    )}
                                    {isCanceled && (
                                      <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-red-500/20 text-red-400 border border-red-500/30">
                                        ❌ Canceled
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-muted flex items-center gap-3 mt-1 flex-wrap">
                                    {med.mrp ? <span>MRP: <strong>₹{med.mrp}</strong></span> : null}
                                    {med.batch_no && <span>Batch: <strong className="font-mono">{med.batch_no}</strong></span>}
                                    {med.expiry_date && <span>Exp: <strong>{med.expiry_date}</strong></span>}
                                  </div>
                                </div>
                              </div>

                              {/* Stock & Quantity Pills */}
                              <div className="flex items-center gap-2.5 flex-wrap">
                                <div className="text-right">
                                  <div className="text-[10px] text-muted font-medium uppercase tracking-wider">Required</div>
                                  <div className="text-sm font-extrabold text-text">{reqQty} Units</div>
                                </div>
                                <div className="h-6 w-px bg-border/60" />
                                <div className="text-right">
                                  <div className="text-[10px] text-muted font-medium uppercase tracking-wider">In Stock</div>
                                  <div className={`text-sm font-extrabold ${stockQty >= reqQty ? 'text-emerald-400' : stockQty > 0 ? 'text-amber-400' : 'text-red-400'}`}>
                                    {stockQty} Units
                                  </div>
                                </div>
                                <div>
                                  {stockQty >= reqQty ? (
                                    <span className="px-2.5 py-1 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold flex items-center gap-1">
                                      <Check size={11} /> In Stock
                                    </span>
                                  ) : stockQty > 0 ? (
                                    <span className="px-2.5 py-1 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-bold flex items-center gap-1">
                                      <AlertCircle size={11} /> Shortage: {shortageQty}
                                    </span>
                                  ) : (
                                    <span className="px-2.5 py-1 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-xs font-bold flex items-center gap-1">
                                      <AlertCircle size={11} /> Out of Stock ({shortageQty})
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Bottom Actions Row per Medicine */}
                            <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-border/40 flex-wrap">
                              <div className="flex items-center gap-2 flex-wrap">
                                {/* Frequency Slider Button */}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingRefill({ id: med.id, currentInterval: med.refill_interval_days || 30, name: med.medicine_name });
                                    setEditIntervalVal(med.refill_interval_days || 30);
                                  }}
                                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-bg2 border border-border hover:border-primary/50 text-muted hover:text-text text-[11px] font-semibold transition-all cursor-pointer"
                                  title="Modify Refill Frequency / Cycle with Interactive Slider"
                                >
                                  <Sliders size={11} className="text-accent" />
                                  <span>{med.refill_interval_days || 30}d Cycle (Edit)</span>
                                </button>

                                {/* Direct Live Cart Addition */}
                                <button
                                  type="button"
                                  onClick={() => startRefillCartJob(selectedPatient.patient_name, [
                                    { refillId: med.id, medicineId: med.medicine_id, medicineName: med.medicine_name, qty: cartOrderQty }
                                  ])}
                                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-primary/15 hover:bg-primary/25 border border-primary/40 text-primary text-[11px] font-bold transition-all cursor-pointer shadow-xs"
                                  title={`Add ${cartOrderQty} unit(s) of "${med.medicine_name}" to the Pharmarack Live Cart using its saved distributor`}
                                >
                                  <ShoppingCart size={12} />
                                  <span>+ Live Cart ({cartOrderQty})</span>
                                </button>
                                {med.cart_store_name && (
                                  <span className="px-2 py-1 rounded-lg bg-sky-500/15 border border-sky-500/40 text-sky-400 text-[10px] font-bold flex items-center gap-1 shadow-xs" title="Currently in today's active Pharmarack live cart">
                                    <ShoppingCart size={10} /> In Live Cart: {med.cart_store_name} ×{med.cart_qty}
                                  </span>
                                )}

                                {/* Link / Priority Distributor Selector */}
                                {med.medicine_id ? (
                                  <div className="relative">
                                    <div className="flex items-center rounded-xl bg-bg2 border border-border hover:border-primary/50 text-[11px] font-semibold transition-all shadow-2xs">
                                      <button
                                        type="button"
                                        onClick={() => setLinkingMedicine({ id: med.medicine_id as number, name: med.medicine_name })}
                                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-muted hover:text-text cursor-pointer max-w-[190px] truncate"
                                        title={med.linked_distributors?.length ? `Priority #1: ${med.linked_distributors[0]} (Click to open full Link window)` : 'Link this medicine to a Pharmarack distributor'}
                                      >
                                        <span className="shrink-0">{med.linked_distributors?.length ? '⭐' : '🔗'}</span>
                                        <span className="truncate">
                                          {med.linked_distributors?.length
                                            ? med.linked_distributors[0]
                                            : 'Link distributor'}
                                        </span>
                                      </button>
                                      {med.linked_distributors && med.linked_distributors.length > 1 && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setPriorityDropdownMedId(prev => prev === med.medicine_id ? null : (med.medicine_id as number));
                                          }}
                                          className={`px-1.5 py-1.5 border-l border-border hover:bg-bg3 text-muted hover:text-text cursor-pointer transition-colors ${
                                            priorityDropdownMedId === med.medicine_id ? 'bg-bg3 text-text' : ''
                                          }`}
                                          title={`Change priority among ${med.linked_distributors.length} linked distributors`}
                                        >
                                          <span className="text-[10px] font-bold">+{med.linked_distributors.length - 1}</span>
                                          <ChevronDown size={11} className={`inline-block ml-0.5 transition-transform ${priorityDropdownMedId === med.medicine_id ? 'rotate-180 text-primary' : ''}`} />
                                        </button>
                                      )}
                                    </div>

                                    {/* Inline Priority Selector Popover */}
                                    {priorityDropdownMedId === med.medicine_id && med.linked_distributors && (
                                      <>
                                        <div
                                          className="fixed inset-0 z-30"
                                          onClick={() => setPriorityDropdownMedId(null)}
                                        />
                                        <div className="absolute left-0 top-full mt-1.5 z-dropdown w-64 rounded-xl bg-bg2 border border-border shadow-xl p-1.5 flex flex-col gap-1 text-xs select-none">
                                          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted flex items-center justify-between border-b border-border/50">
                                            <span>Priority Distributor</span>
                                            <span className="font-mono text-primary">{med.linked_distributors.length} Linked</span>
                                          </div>
                                          <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto dropdown-scroll py-0.5">
                                            {med.linked_distributors.map((dist, idx) => (
                                              <button
                                                key={dist}
                                                type="button"
                                                onClick={() => handleSetPriorityDistributor(med.medicine_id as number, med.medicine_name, dist)}
                                                className={`flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                                                  idx === 0
                                                    ? 'bg-primary/15 text-primary font-bold border border-primary/20'
                                                    : 'hover:bg-bg3 text-text font-medium'
                                                }`}
                                              >
                                                <div className="flex items-center gap-1.5 truncate">
                                                  <span className="text-[10px] font-mono text-muted shrink-0">#{idx + 1}</span>
                                                  <span className="truncate">{dist}</span>
                                                </div>
                                                {idx === 0 && <span className="text-[10px] text-primary shrink-0">⭐ Priority #1</span>}
                                              </button>
                                            ))}
                                          </div>
                                          <div className="pt-1 border-t border-border/50">
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setPriorityDropdownMedId(null);
                                                setLinkingMedicine({ id: med.medicine_id as number, name: med.medicine_name });
                                              }}
                                              className="w-full py-1 px-2 rounded-lg text-[10.5px] font-semibold text-muted hover:text-text hover:bg-bg3 text-center transition-colors cursor-pointer"
                                            >
                                              + Link / Manage More Distributors…
                                            </button>
                                          </div>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                ) : null}

                                {/* Stock Override Toggle */}
                                <button
                                  type="button"
                                  onClick={() => handleToggleOverride(med.id)}
                                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold border transition-all cursor-pointer ${
                                    isOverridden
                                      ? 'bg-purple-500/15 border-purple-500/40 text-purple-400'
                                      : 'bg-bg2 border-border text-muted hover:text-text'
                                  }`}
                                  title="Force enable sell in POS even if inventory shows 0"
                                >
                                  <Zap size={11} />
                                  <span>{isOverridden ? 'Override On' : 'Override Stock'}</span>
                                </button>
                              </div>

                              <div className="flex items-center gap-2 flex-wrap">
                                {/* Complete Single Occurrence Button */}
                                <button
                                  type="button"
                                  onClick={() => handleFulfillOccurrence(med.id, med.medicine_name)}
                                  disabled={fulfillingId === med.id}
                                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-400 text-[11px] font-bold transition-all cursor-pointer disabled:opacity-50"
                                  title="Mark this medicine's current occurrence fulfilled and advance next due date"
                                >
                                  <Check size={12} className={fulfillingId === med.id ? 'animate-spin' : ''} />
                                  <span>{fulfillingId === med.id ? 'Fulfilling…' : '✓ Complete'}</span>
                                </button>

                                {/* Pause / Resume Toggle */}
                                <button
                                  type="button"
                                  onClick={() => handleTogglePauseRefill(med.id, med.is_active !== 0)}
                                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold border transition-all cursor-pointer ${
                                    med.is_active !== 0
                                      ? 'bg-amber-500/15 hover:bg-amber-500/25 border-amber-500/40 text-amber-400'
                                      : 'bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/40 text-emerald-400'
                                  }`}
                                  title={med.is_active !== 0 ? 'Pause refill notifications for this medicine' : 'Resume refill schedule'}
                                >
                                  {med.is_active !== 0 ? '⏸️ Pause' : '▶️ Resume'}
                                </button>

                                {/* Cancel */}
                                {!isCanceled && (
                                  <button
                                    type="button"
                                    onClick={() => handleCancelRefill(med.id)}
                                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 text-[11px] font-bold transition-all cursor-pointer"
                                    title="Cancel and archive this refill schedule"
                                  >
                                    <X size={11} />
                                    <span>Cancel</span>
                                  </button>
                                )}

                                {/* Delete Single Refill Item */}
                                <button
                                  type="button"
                                  onClick={() => handleDeleteRefillItem(med.id, med.medicine_name)}
                                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-[11px] font-bold transition-all cursor-pointer"
                                  title={`Permanently delete "${med.medicine_name}" from refill schedule`}
                                >
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── VIEW 2: Refill Fulfillment & Occurrence History ── */}
                {activeDetailTab === 'fulfillments' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-muted uppercase tracking-wider">
                        Fulfillment Occurrence History ({fulfillments.length})
                      </h4>
                      <button
                        onClick={() => loadPatientFulfillments(selectedPatient.patient_phone, selectedPatient.customer_id)}
                        disabled={loadingFulfillments}
                        className="text-xs text-primary font-semibold flex items-center gap-1 hover:underline disabled:opacity-50"
                      >
                        <RefreshCw size={12} className={loadingFulfillments ? 'animate-spin' : ''} />
                        <span>Refresh Log</span>
                      </button>
                    </div>

                    {loadingFulfillments ? (
                      <div className="p-8 text-center text-xs text-muted flex items-center justify-center gap-2">
                        <RefreshCw size={14} className="animate-spin text-primary" /> Loading fulfillment records...
                      </div>
                    ) : fulfillments.length === 0 ? (
                      <div className="p-8 text-center text-xs text-muted border border-border rounded-xl bg-bg">
                        No historical refill fulfillment records found for this patient yet.
                      </div>
                    ) : (
                      <div className="overflow-x-auto border border-border rounded-xl bg-bg">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="bg-bg3/40 border-b border-border text-muted font-bold">
                              <th className="p-3">Fulfilled Date</th>
                              <th className="p-3">Prescribed Medicine</th>
                              <th className="p-3 text-center">Fulfilled Qty</th>
                              <th className="p-3">Linked Bill / Invoice</th>
                              <th className="p-3">Method / Notes</th>
                              <th className="p-3 text-right">Next Due Scheduled</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/30">
                            {fulfillments.map((item, idx) => (
                              <tr key={idx} className="hover:bg-bg2/50">
                                <td className="p-3 font-semibold text-text">
                                  {formatDate(item.fulfilled_at || item.created_at)}
                                </td>
                                <td className="p-3 font-bold text-text">
                                  {item.medicine_name || 'Prescribed Medicine'}
                                </td>
                                <td className="p-3 text-center font-extrabold text-emerald-400">
                                  {item.quantity_fulfilled || 1} Units
                                </td>
                                <td className="p-3">
                                  {item.linked_invoice_no || item.invoice_no ? (
                                    <span className="font-mono text-[11px] text-primary font-bold">
                                      #{item.linked_invoice_no || item.invoice_no}
                                    </span>
                                  ) : (
                                    <span className="text-muted text-[11px]">Manual / CRM</span>
                                  )}
                                </td>
                                <td className="p-3">
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-bg3 text-muted border border-border">
                                    {item.fulfilled_via === 'pos_sale' ? '⚡ POS Sale' : '✓ CRM Complete'}
                                  </span>
                                </td>
                                <td className="p-3 text-right font-medium text-muted">
                                  {item.next_due_date ? formatDate(item.next_due_date) : 'Scheduled'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* ── VIEW 3: Sales & Purchase Bills History ── */}
                {activeDetailTab === 'invoices' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-muted uppercase tracking-wider">
                        Customer Invoices &amp; Bills ({invoices.length})
                      </h4>
                      <button
                        onClick={() => loadPatientInvoices(selectedPatient.patient_phone, selectedPatient.customer_id)}
                        disabled={loadingInvoices}
                        className="text-xs text-primary font-semibold flex items-center gap-1 hover:underline disabled:opacity-50"
                      >
                        <RefreshCw size={12} className={loadingInvoices ? 'animate-spin' : ''} />
                        <span>Refresh Invoices</span>
                      </button>
                    </div>

                    {loadingInvoices ? (
                      <div className="p-8 text-center text-xs text-muted flex items-center justify-center gap-2">
                        <RefreshCw size={14} className="animate-spin text-primary" /> Loading purchase invoices...
                      </div>
                    ) : invoices.length === 0 ? (
                      <div className="p-8 text-center text-xs text-muted border border-border rounded-xl bg-bg">
                        No purchase invoices recorded for this customer yet.
                      </div>
                    ) : (
                      <div className="overflow-x-auto border border-border rounded-xl bg-bg">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="bg-bg3/40 border-b border-border text-muted font-bold">
                              <th className="p-3">Invoice No</th>
                              <th className="p-3">Date</th>
                              <th className="p-3">Items Purchased</th>
                              <th className="p-3">Payment Method</th>
                              <th className="p-3 text-right">Bill Total</th>
                              <th className="p-3 text-center">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/30">
                            {invoices.map(inv => (
                              <tr key={inv.id} className="hover:bg-bg2/50">
                                <td className="p-3 font-mono font-bold text-primary">
                                  {inv.invoice_no}
                                </td>
                                <td className="p-3 text-muted">
                                  {formatDate(inv.date)}
                                </td>
                                <td className="p-3 font-medium text-text max-w-xs truncate">
                                  {inv.items && inv.items.length > 0
                                    ? inv.items.map(i => i.medicine_name).join(', ')
                                    : `${inv.item_count || 1} item(s)`}
                                </td>
                                <td className="p-3">
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-bg3 text-muted border border-border">
                                    {inv.payment_medium || 'CASH'}
                                  </span>
                                </td>
                                <td className="p-3 text-right font-extrabold text-emerald-400">
                                  ₹{(inv.total_amount || 0).toFixed(2)}
                                </td>
                                <td className="p-3 text-center">
                                  <button
                                    onClick={() => setViewInvoice(inv)}
                                    className="px-2.5 py-1 rounded-lg bg-bg2 hover:bg-bg3 border border-border text-primary text-[11px] font-semibold transition-all cursor-pointer"
                                  >
                                    View Details
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-muted text-xs gap-3">
              <div className="w-16 h-16 rounded-2xl bg-bg3/60 border border-border flex items-center justify-center">
                <Repeat2 size={32} className="text-primary/60" />
              </div>
              <p className="text-sm font-semibold text-text">
                {data.length === 0 ? 'No Refill Schedules Recorded Yet' : 'Select a patient from the left panel'}
              </p>
              <p className="text-xs text-muted max-w-sm text-center">
                {data.length === 0
                  ? 'Set up recurring refill schedules with automated WhatsApp reminders, cycle tracking, and stock-check alerts.'
                  : 'Click on any patient to view active refill prescriptions, live inventory stock status, automated shortage alerts, and fulfillment history.'}
              </p>
              {data.length === 0 && (
                <button
                  type="button"
                  onClick={() => setShowAddModal(true)}
                  className="mt-2 flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-xs font-bold shadow-md shadow-primary/20 hover:bg-primary/90 transition-all cursor-pointer"
                >
                  <Plus size={14} /> Add First Refill Schedule
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Add / Edit Refill Modal ── */}
      {showAddModal && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-modal flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-bg2 border border-border rounded-2xl w-[95vw] max-w-xl h-[80vh] min-h-[520px] max-h-[760px] overflow-hidden shadow-2xl flex flex-col">
            {/* Modal Header */}
            <div className="p-4 border-b border-border flex items-center justify-between shrink-0 bg-bg3/40">
              <div>
                <h3 className="text-sm font-bold text-text flex items-center gap-2">
                  {editingPatient ? <Edit2 size={18} className="text-primary" /> : <Repeat2 size={18} className="text-primary" />}
                  {editingPatient ? 'Edit Patient Refill Schedule' : 'Add New Patient Refill'}
                </h3>
                <p className="text-[11px] text-muted mt-0.5">
                  {editingPatient
                    ? 'Modify prescribed medications, quantities, or refill frequency'
                    : 'Select medication directly from inventory & set flexible refill frequency'}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setEditingPatient(null);
                }}
                className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSaveRefill} className="p-5 space-y-5 overflow-y-auto flex-1 min-h-0">
              {/* Restored Draft Notice */}
              {hasRefillDraft && !editingPatient && (
                <div className="flex items-center justify-between p-2.5 px-3 rounded-xl bg-primary/10 border border-primary/25 text-xs animate-fade-in">
                  <div className="flex items-center gap-2 text-primary font-semibold">
                    <RotateCcw size={14} />
                    <span>Restored uncompleted refill draft</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearRefillDraft}
                    className="text-[11px] text-muted hover:text-red-400 font-bold underline cursor-pointer"
                  >
                    Discard Draft
                  </button>
                </div>
              )}

              {/* Patient Details */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider flex items-center gap-1">
                  <Users size={11} className="text-primary" />
                  Patient Details
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <SalutationNameInput
                      salutation={refillSalutation}
                      customSalutation={refillCustomSalutation}
                      name={addPatientName}
                      onSalutationChange={(sal, custom) => {
                        setRefillSalutation(sal);
                        if (custom !== undefined) setRefillCustomSalutation(custom);
                      }}
                      onNameChange={(val) => setAddPatientName(val)}
                      placeholder="Patient Full Name *"
                      required={true}
                    />
                  </div>
                  <div>
                    <PhoneInputWithBadge
                      value={addPatientPhone}
                      onChange={val => setAddPatientPhone(val)}
                      placeholder="10-digit WhatsApp phone"
                      required={true}
                      allowEmpty={false}
                    />
                  </div>
                </div>
              </div>

              {/* WhatsApp Language Preference */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider flex items-center gap-1">
                  <Globe size={11} className="text-primary" />
                  WhatsApp Language
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setAddLanguage('en')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      addLanguage === 'en'
                        ? 'bg-primary/15 border-primary text-primary shadow-sm'
                        : 'bg-bg border-border text-muted hover:text-text hover:bg-bg3'
                    }`}
                  >
                    <span>🇬🇧</span>
                    <span>English</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddLanguage('hi')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      addLanguage === 'hi'
                        ? 'bg-primary/15 border-primary text-primary shadow-sm'
                        : 'bg-bg border-border text-muted hover:text-text hover:bg-bg3'
                    }`}
                  >
                    <span>🇮🇳</span>
                    <span>हिंदी (Hindi)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddLanguage('mr')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      addLanguage === 'mr'
                        ? 'bg-primary/15 border-primary text-primary shadow-sm'
                        : 'bg-bg border-border text-muted hover:text-text hover:bg-bg3'
                    }`}
                  >
                    <span>🇮🇳</span>
                    <span>मराठी (Marathi)</span>
                  </button>
                </div>
              </div>

              {/* Reminder Dispatch Mode (Per-Patient Automation Control) */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider flex items-center gap-1">
                  <Zap size={11} className="text-primary" />
                  Reminder Mode (Per-Customer Control)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAddReminderMode('manual')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-2 cursor-pointer ${
                      addReminderMode === 'manual'
                        ? 'bg-sky-500/15 border-sky-500/40 text-sky-400 shadow-sm'
                        : 'bg-bg border-border text-muted hover:text-text hover:bg-bg3'
                    }`}
                  >
                    <span>👆</span>
                    <span>Manual Approval (Safe)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddReminderMode('auto')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-2 cursor-pointer ${
                      addReminderMode === 'auto'
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400 shadow-sm'
                        : 'bg-bg border-border text-muted hover:text-text hover:bg-bg3'
                    }`}
                  >
                    <span>🤖</span>
                    <span>Auto Dispatch</span>
                  </button>
                </div>
              </div>

              {/* Flexible Frequency Manager with Interactive Slider & Presets */}
              <div className="bg-bg3/30 border border-border rounded-xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold text-muted uppercase tracking-wider flex items-center gap-1">
                    <Sliders size={11} className="text-accent" />
                    Flexible Frequency Manager (Slider &amp; Presets)
                  </label>
                  <span className="text-xs font-black text-primary px-2 py-0.5 rounded bg-primary/10 border border-primary/30">
                    {getEffectiveIntervalDays()} Days Interval
                  </span>
                </div>

                {/* Quick Presets */}
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { days: 15, label: '15 Days' },
                    { days: 30, label: '30 Days' },
                    { days: 60, label: '60 Days' },
                    { days: 90, label: '90 Days' }
                  ].map(opt => (
                    <button
                      key={opt.days}
                      type="button"
                      onClick={() => {
                        setFreqMode('preset');
                        setAddInterval(opt.days);
                      }}
                      className={`px-2.5 py-1.5 rounded-xl text-xs text-center border font-bold transition-all cursor-pointer ${
                        freqMode === 'preset' && addInterval === opt.days
                          ? 'bg-primary border-primary text-white shadow-md'
                          : 'bg-bg border-border text-muted hover:text-text hover:bg-bg2'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Interactive Slider Input */}
                <div className="space-y-1 pt-1">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-muted">
                    <span>1 Day</span>
                    <span className="text-text font-bold">Slide to adjust: {getEffectiveIntervalDays()} Days</span>
                    <span>180 Days</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={180}
                    value={getEffectiveIntervalDays()}
                    onChange={e => {
                      setFreqMode('preset');
                      setAddInterval(Number(e.target.value));
                    }}
                    className="w-full h-2 bg-bg border border-border rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                </div>

                {/* Dynamic Due Date & 5-Day Lead Notice Banner */}
                {(() => {
                  const effDays = getEffectiveIntervalDays();
                  const dueDate = new Date();
                  dueDate.setDate(dueDate.getDate() + effDays);

                  const leadDate = new Date(dueDate);
                  leadDate.setDate(leadDate.getDate() - 5);

                  const formattedDue = dueDate.toLocaleDateString('en-IN', {
                    weekday: 'short',
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric'
                  });

                  const formattedLead = leadDate.toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short'
                  });

                  return (
                    <div className="flex flex-col gap-1 px-3 py-2 bg-accent/10 border border-accent/20 rounded-xl text-xs text-accent">
                      <div className="flex items-center gap-2">
                        <Calendar size={13} className="shrink-0 text-accent" />
                        <span>Calculated Due Date: <strong>{formattedDue}</strong> ({effDays}-day cycle)</span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-amber-400 font-medium pl-5">
                        <span>🔔 Auto Lead Window Active: <strong>{formattedLead}</strong> (5 days before due date for order prep)</span>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Inventory Medicine Selector */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold text-muted uppercase tracking-wider flex items-center gap-1">
                    <Package size={11} className="text-primary" />
                    Medicines &amp; Inventory Selection *
                  </label>
                  <button
                    type="button"
                    onClick={() => setMedicineRows(prev => [...prev, emptyRow()])}
                    className="flex items-center gap-1 text-[11px] font-bold text-primary hover:underline cursor-pointer"
                  >
                    <Plus size={12} /> Add Another Medicine
                  </button>
                </div>

                <div className="space-y-3">
                  {medicineRows.map((row, idx) => (
                    <div
                      key={idx}
                      className="bg-bg border border-border rounded-xl p-3 space-y-2 shadow-xs hover:border-border/80 transition-all"
                    >
                      <div className="flex items-start gap-2">
                        {/* Medicine Dropdown Input */}
                        <div className="relative flex-1">
                          <div className="relative">
                            <Search size={13} className="absolute left-3 top-3 text-muted" />
                            <input
                              type="text"
                              value={row.searchTerm}
                              onFocus={e => {
                                (e.target as HTMLInputElement).select?.();
                                const rect = e.currentTarget.getBoundingClientRect();
                                if (window.innerHeight - rect.bottom < 230 && rect.top > 230) {
                                  setDropUpIndex(idx);
                                } else {
                                  setDropUpIndex(null);
                                }
                                if (row.suggestions.length === 0) {
                                  fetchSuggestions(idx, row.searchTerm);
                                } else {
                                  setMedicineRows(prev => {
                                    const updated = [...prev];
                                    updated[idx] = { ...updated[idx], isOpen: true };
                                    return updated;
                                  });
                                }
                              }}
                              onChange={e => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                if (window.innerHeight - rect.bottom < 230 && rect.top > 230) {
                                  setDropUpIndex(idx);
                                } else {
                                  setDropUpIndex(null);
                                }
                                handleMedicineSearch(idx, e.target.value);
                              }}
                              placeholder="Search all pharmacy medicines (purchased/stocked)…"
                              className="w-full pl-9 pr-8 py-2.5 bg-bg2 border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary"
                            />
                            <ChevronDown
                              size={14}
                              className="absolute right-3 top-3 text-muted pointer-events-none"
                            />
                          </div>

                          {/* Dropdown Suggestions List */}
                          {row.isOpen && (
                            <div className={`absolute left-0 right-0 z-30 bg-bg2 border border-border rounded-xl shadow-2xl overflow-hidden max-h-56 overflow-y-auto dropdown-scroll ${
                              dropUpIndex === idx
                                ? 'bottom-full mb-1'
                                : 'top-full mt-1'
                            }`}>
                              {row.loadingSuggestions && (
                                <div className="p-3 text-center text-xs text-muted flex items-center justify-center gap-2">
                                  <RefreshCw size={12} className="animate-spin" /> Fetching inventory…
                                </div>
                              )}
                              {!row.loadingSuggestions && row.suggestions.length === 0 && (
                                <div className="p-3 text-center text-xs text-muted">
                                  No matching inventory item found
                                </div>
                              )}
                              {!row.loadingSuggestions && row.suggestions.map(s => {
                                const inStock = (s.in_stock_qty || 0) > 0;
                                return (
                                  <div
                                    key={s.id}
                                    onClick={() => selectMedicine(idx, s)}
                                    className="px-3.5 py-2.5 hover:bg-primary/10 hover:border-l-2 hover:border-primary cursor-pointer border-b border-border/40 last:border-none flex items-center justify-between gap-3 transition-colors"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <p className="text-xs font-semibold text-text truncate">{s.name}</p>
                                      {s.manufacturer && (
                                        <p className="text-[10px] text-muted truncate">{s.manufacturer}</p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {s.location && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30">
                                          📍 {s.location}
                                        </span>
                                      )}
                                      {s.mrp ? (
                                        <span className="text-[11px] font-medium text-text">₹{s.mrp}</span>
                                      ) : null}
                                      <span
                                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                          inStock
                                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                            : 'bg-red-500/15 text-red-400 border border-red-500/30'
                                        }`}
                                      >
                                        {inStock ? `${s.in_stock_qty} in stock` : 'Out of Stock'}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Quantity Counter */}
                        <div className="flex items-center border border-border rounded-xl bg-bg2 overflow-hidden shrink-0">
                          <button
                            type="button"
                            onClick={() => updateQty(idx, row.quantity_needed - 1)}
                            className="px-2.5 py-2 text-muted hover:text-text hover:bg-bg3 transition-colors text-xs font-bold"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min={1}
                            value={row.quantity_needed}
                            onChange={e => updateQty(idx, Number(e.target.value))}
                            className="w-12 text-center bg-transparent text-xs font-bold text-text focus:outline-none"
                            title="Required refill quantity"
                          />
                          <button
                            type="button"
                            onClick={() => updateQty(idx, row.quantity_needed + 1)}
                            className="px-2.5 py-2 text-muted hover:text-text hover:bg-bg3 transition-colors text-xs font-bold"
                          >
                            +
                          </button>
                        </div>

                        {/* Remove Row Button */}
                        {medicineRows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setMedicineRows(prev => prev.filter((_, i) => i !== idx))}
                            className="p-2.5 text-muted hover:text-red-400 transition-colors rounded-xl hover:bg-bg3 cursor-pointer"
                            title="Remove medication"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>

                      {/* Stock Status Badge for Selected Medicine */}
                      {row.medicineId && (
                        <div className="flex items-center justify-between text-[11px] pt-1 px-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-text">{row.medicineName}</span>
                            {row.mrp && <span className="text-muted">· ₹{row.mrp}</span>}
                          </div>
                          <div
                            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              (row.inStockQty || 0) >= row.quantity_needed
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : (row.inStockQty || 0) > 0
                                ? 'bg-amber-500/15 text-amber-400'
                                : 'bg-red-500/15 text-red-400'
                            }`}
                          >
                            {(row.inStockQty || 0) >= row.quantity_needed ? (
                              <><Check size={10} /> In Stock ({row.inStockQty} available)</>
                            ) : (row.inStockQty || 0) > 0 ? (
                              <><AlertCircle size={10} /> Low Stock ({row.inStockQty} available)</>
                            ) : (
                              <><AlertCircle size={10} /> Out of Stock (Auto-holds for stock)</>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Footer Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingPatient(null);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-muted hover:bg-bg3 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold transition-all shadow-md disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                >
                  {submitting ? (
                    <><RefreshCw size={13} className="animate-spin" /> {editingPatient ? 'Updating…' : 'Registering…'}</>
                  ) : (
                    <><Check size={13} /> {editingPatient ? 'Update Refill Schedule' : 'Register Refill Schedule'}</>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ── Link medicine ↔ Pharmarack distributor product(s) ── */}
      {linkingMedicine && (
        <MedicineLinkModal
          medicineId={linkingMedicine.id}
          medicineName={linkingMedicine.name}
          onSaved={(newLinks) => {
            const links = newLinks || [];
            // Optimistic update for active patient in state (instant 0ms feedback)
            setSelectedPatient(prev => {
              if (!prev) return prev;
              return {
                ...prev,
                medicines: prev.medicines.map(m =>
                  m.medicine_id === linkingMedicine.id
                    ? { ...m, linked_distributors: links }
                    : m
                )
              };
            });
            // Optimistic update for patient list in state
            setData(prev => prev.map(p => ({
              ...p,
              medicines: p.medicines.map(m =>
                m.medicine_id === linkingMedicine.id
                  ? { ...m, linked_distributors: links }
                  : m
              )
            })));
            // Optimistic update for module cache
            cachedRefillsData = cachedRefillsData.map(p => ({
              ...p,
              medicines: p.medicines.map(m =>
                m.medicine_id === linkingMedicine.id
                  ? { ...m, linked_distributors: links }
                  : m
              )
            }));
            refillEvent.triggerRefresh();
          }}
          onClose={() => setLinkingMedicine(null)}
        />
      )}

      {/* ── Refill All-in-One Pre-Order Review Modal (Human-in-the-Loop) ── */}
      {orderingPatient && (
        <RefillOrderModal
          patientName={orderingPatient.patient_name}
          medicines={orderingPatient.medicines}
          onClose={() => setOrderingPatient(null)}
          onConfirm={(selectedItems) => {
            setOrderingPatient(null);
            startRefillCartJob(orderingPatient.patient_name, selectedItems);
          }}
          onMedicineLinked={(medId, links) => {
            setSelectedPatient(prev => {
              if (!prev) return prev;
              return {
                ...prev,
                medicines: prev.medicines.map(m =>
                  m.medicine_id === medId ? { ...m, linked_distributors: links } : m
                )
              };
            });
            setData(prev => prev.map(p => ({
              ...p,
              medicines: p.medicines.map(m =>
                m.medicine_id === medId ? { ...m, linked_distributors: links } : m
              )
            })));
            cachedRefillsData = cachedRefillsData.map(p => ({
              ...p,
              medicines: p.medicines.map(m =>
                m.medicine_id === medId ? { ...m, linked_distributors: links } : m
              )
            }));
            refillEvent.triggerRefresh();
          }}
        />
      )}

      {/* ── Inline Edit Refill Frequency Modal ── */}
      {editingRefill && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-modal flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-bg2 border border-border rounded-2xl w-[95vw] max-w-md p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-text flex items-center gap-2">
                <Sliders size={16} className="text-primary" />
                Modify Refill Frequency
              </h3>
              <button
                type="button"
                onClick={() => setEditingRefill(null)}
                className="text-muted hover:text-text p-1 rounded-lg hover:bg-bg3 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-muted">
              Adjust refill interval cycle for <strong className="text-text">{editingRefill.name}</strong>:
            </p>

            <div className="grid grid-cols-4 gap-2">
              {[15, 30, 60, 90].map(days => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setEditIntervalVal(days)}
                  className={`py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                    editIntervalVal === days
                      ? 'bg-primary border-primary text-white shadow-md'
                      : 'bg-bg border-border text-muted hover:text-text'
                  }`}
                >
                  {days} Days
                </button>
              ))}
            </div>

            <div className="space-y-1 pt-2">
              <div className="flex justify-between text-xs font-bold text-text">
                <span>Refill Interval:</span>
                <span className="text-primary font-mono">{editIntervalVal} Days</span>
              </div>
              <input
                type="range"
                min={1}
                max={180}
                value={editIntervalVal}
                onChange={e => setEditIntervalVal(Number(e.target.value))}
                className="w-full h-2 bg-bg border border-border rounded-lg appearance-none cursor-pointer accent-primary"
              />
              <div className="flex justify-between text-[10px] text-muted font-mono">
                <span>1 Day</span>
                <span>90 Days</span>
                <span>180 Days</span>
              </div>
            </div>

            <div className="p-3 bg-primary/10 border border-primary/20 rounded-xl text-xs text-primary font-semibold flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Calendar size={14} />
                <span>Calculated Next Due Date: <strong>{futureDateLabel(editIntervalVal, { day: '2-digit', month: 'short', year: 'numeric' })}</strong></span>
              </div>
              <div className="text-[11px] text-amber-400 pl-6">
                <span>🔔 Auto 5-Day Lead Window Starts: <strong>{futureDateLabel(editIntervalVal - 5, { day: '2-digit', month: 'short' })}</strong></span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setEditingRefill(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-muted hover:bg-bg3 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUpdateFrequency}
                disabled={updatingFreq}
                className="px-5 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
              >
                {updatingFreq ? 'Saving...' : 'Save Refill Frequency'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Bill / Invoice Preview Modal ── */}
      {viewInvoice && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="glass-panel w-[95vw] max-w-4xl h-[85vh] min-h-[560px] max-h-[840px] flex flex-col border-primary/20 bg-bg2 rounded-2xl shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 border-b border-border flex justify-between items-center bg-bg3/50 shrink-0">
              <div>
                <h3 className="font-bold text-base flex items-center gap-2 text-text">
                  <FileText size={18} className="text-primary" />
                  Bill Preview: {viewInvoice.invoice_no}
                </h3>
                <p className="text-xs text-muted mt-0.5">Read-only preview of customer sale invoice</p>
              </div>
              <button
                onClick={() => setViewInvoice(null)}
                className="p-1.5 rounded-lg hover:bg-bg3 text-muted hover:text-text transition-all cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 flex-1 min-h-0 overflow-y-auto">
              {/* Customer & Invoice Summary */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-bg3/30 p-3.5 rounded-xl border border-border text-xs">
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">Patient Name</div>
                  <div className="font-bold text-text">{viewInvoice.customer_name || '— (Counter Sale)'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">WhatsApp / Phone</div>
                  <div className="font-bold text-text">{viewInvoice.customer_phone || '-'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">Payment Method</div>
                  <div className="font-bold text-emerald-400">{viewInvoice.payment_medium || 'CASH'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">Sale Date</div>
                  <div className="font-bold text-text">{formatDate(viewInvoice.date)}</div>
                </div>
              </div>

              {/* Purchased Medicines Table */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-muted uppercase tracking-wider">Purchased Medicines</h4>
                  <span className="text-xs text-muted">{viewInvoice.items?.length || 0} item(s)</span>
                </div>
                <div className="overflow-x-auto border border-border rounded-xl bg-bg">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-bg3/40 border-b border-border text-muted font-bold">
                        <th className="p-2.5">Medicine Name</th>
                        <th className="p-2.5">Batch</th>
                        <th className="p-2.5 text-center">Qty (Strips/Loose)</th>
                        <th className="p-2.5 text-center">CD %</th>
                        <th className="p-2.5">MRP</th>
                        <th className="p-2.5">Unit Price</th>
                        <th className="p-2.5 text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {viewInvoice.items?.map((item, idx) => {
                        const packSize = item.pack_size || 1;
                        const looseQty = item.loose_qty || 0;
                        const discPer = item.discount_per || 0;
                        const discountedPrice = item.unit_price * (1 - discPer / 100);
                        const itemTotal = (discountedPrice * item.quantity) + ((discountedPrice / packSize) * looseQty);
                        return (
                          <tr key={idx} className="hover:bg-bg2/50">
                            <td className="p-2.5 font-semibold text-text">{item.medicine_name || `Item #${item.inventory_id}`}</td>
                            <td className="p-2.5 font-mono text-[11px] text-muted">{item.batch_number || '-'}</td>
                            <td className="p-2.5 text-center font-bold">{item.quantity} / {looseQty}</td>
                            <td className="p-2.5 text-center text-muted">{discPer}%</td>
                            <td className="p-2.5 text-muted">₹{item.mrp || 0}</td>
                            <td className="p-2.5 font-medium text-text">₹{discountedPrice.toFixed(2)}</td>
                            <td className="p-2.5 font-bold text-emerald-400 text-right">₹{Math.round(itemTotal)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-border flex justify-between items-center bg-bg3/50 shrink-0">
              <button
                onClick={() => setViewInvoice(null)}
                className="px-4 py-2 bg-bg3 text-muted rounded-xl text-xs font-semibold hover:text-text cursor-pointer"
              >
                Close Preview
              </button>
              <div className="text-right">
                <div className="text-[10px] text-muted">Total Bill Amount</div>
                <div className="text-lg font-extrabold text-emerald-400">
                  ₹{(viewInvoice.total_amount || 0).toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Delay Notice Modal */}
      {showDelayModal && (
        <DelayNoticeModal
          isOpen={showDelayModal}
          onClose={() => setShowDelayModal(false)}
          onDispatched={() => load(true)}
        />
      )}
    </div>
  );
};
