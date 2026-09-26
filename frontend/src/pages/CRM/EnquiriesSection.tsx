import React, { useState, useEffect, useCallback } from 'react';
import {
  MessageSquare,
  Search,
  Plus,
  ArrowRight,
  RefreshCw,
  Phone,
  CheckCircle2,
  Calendar,
  Pill,
  ExternalLink,
  X,
  Send,
  ShoppingCart,
  Repeat2
} from 'lucide-react';
import { api } from '../../services/api';
import { usePageActive } from '../../lib/keepAlive/PageActiveContext';

let cachedEnquiriesPatients: any[] | null = null;

export const EnquiriesSection: React.FC = () => {
  const isPageActive = usePageActive();
  const [patients, setPatients] = useState<any[]>(() => cachedEnquiriesPatients || []);
  const [isLoading, setIsLoading] = useState<boolean>(!cachedEnquiriesPatients);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<'ALL' | 'TAB' | 'BOTTLE'>('ALL');
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);

  // New Enquiry Form State
  const [formPatientName, setFormPatientName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formMedName, setFormMedName] = useState('');
  const [formMedId, setFormMedId] = useState<number | null>(null);
  const [formGroup, setFormGroup] = useState<'TAB' | 'BOTTLE' | 'ALL'>('TAB');
  const [formQty, setFormQty] = useState(1);
  const [formMrp, setFormMrp] = useState<number | null>(null);
  const [formNotes, setFormNotes] = useState('');
  const [browseSuggestions, setBrowseSuggestions] = useState<any[]>([]);
  const [isBrowsing, setIsBrowsing] = useState(false);

  const fetchEnquiries = useCallback(async () => {
    try {
      const res = await api.getEnquiriesPanel();
      if (res.success && Array.isArray(res.patients)) {
        cachedEnquiriesPatients = res.patients;
        setPatients(res.patients);
      }
    } catch (err) {
      console.warn('[EnquiriesSection] Failed to fetch enquiries panel:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isPageActive) {
      fetchEnquiries();
    }
  }, [isPageActive, fetchEnquiries]);

  // Live SSE listener
  useEffect(() => {
    const handleUpdate = () => {
      if (isPageActive) {
        fetchEnquiries();
      }
    };
    window.addEventListener('sse-enquiry-updated', handleUpdate);
    window.addEventListener('app-enquiries-updated', handleUpdate);
    return () => {
      window.removeEventListener('sse-enquiry-updated', handleUpdate);
      window.removeEventListener('app-enquiries-updated', handleUpdate);
    };
  }, [isPageActive, fetchEnquiries]);

  // Search medicines within group when typing or changing group in modal
  useEffect(() => {
    if (!isNewModalOpen) return;
    let cancelled = false;
    const fetchBrowse = async () => {
      setIsBrowsing(true);
      try {
        const res = await api.browseMedicines(formGroup, formMedName, 1, 20);
        if (!cancelled && res.success && Array.isArray(res.items)) {
          setBrowseSuggestions(res.items);
        }
      } catch (err) {
        console.warn('[EnquiriesSection] Browse failed:', err);
      } finally {
        if (!cancelled) setIsBrowsing(false);
      }
    };

    const timer = setTimeout(fetchBrowse, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [formGroup, formMedName, isNewModalOpen]);

  const handleAnswerWhatsApp = async (id: number) => {
    setActionLoadingId(id);
    try {
      await api.answerEnquiry(id);
      fetchEnquiries();
    } catch (err) {
      console.error('[EnquiriesSection] Answer failed:', err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleConvertToOrder = async (id: number) => {
    setActionLoadingId(id);
    try {
      await api.convertEnquiryToOrder(id);
      fetchEnquiries();
    } catch (err) {
      console.error('[EnquiriesSection] Convert to order failed:', err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleConvertToRefill = async (id: number) => {
    setActionLoadingId(id);
    try {
      await api.convertEnquiryToRefill(id);
      fetchEnquiries();
    } catch (err) {
      console.error('[EnquiriesSection] Convert to refill failed:', err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCreateEnquirySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formPatientName.trim() || !formMedName.trim()) return;

    try {
      await api.createEnquiry({
        patient_name: formPatientName.trim(),
        patient_phone: formPhone.trim(),
        medicine_name: formMedName.trim(),
        medicine_id: formMedId,
        dosage_group: formGroup,
        qty: formQty,
        mrp: formMrp,
        notes: formNotes.trim()
      });
      setIsNewModalOpen(false);
      // Reset form
      setFormPatientName('');
      setFormPhone('');
      setFormMedName('');
      setFormMedId(null);
      setFormMrp(null);
      setFormNotes('');
      fetchEnquiries();
    } catch (err) {
      console.error('[EnquiriesSection] Create enquiry failed:', err);
    }
  };

  // Filter patients by search query and dosage group
  const filteredPatients = patients.filter(p => {
    const matchesSearch =
      !searchQuery ||
      p.patient_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.patient_phone?.includes(searchQuery);

    const matchesGroup =
      activeGroup === 'ALL' ||
      p.enquiries?.some((e: any) => e.dosage_group === activeGroup);

    return matchesSearch && matchesGroup;
  });

  return (
    <div className="space-y-4">
      {/* Top Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-bg2 rounded-2xl border border-border">
        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by patient name or phone..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-bg rounded-xl border border-border text-xs text-text focus:outline-none focus:border-primary"
            />
          </div>

          {/* Dosage Group Pills */}
          <div className="flex items-center p-0.5 bg-bg rounded-xl border border-border text-xs font-semibold">
            {(['ALL', 'TAB', 'BOTTLE'] as const).map(group => (
              <button
                key={group}
                type="button"
                onClick={() => setActiveGroup(group)}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  activeGroup === group
                    ? 'bg-primary text-white shadow-xs'
                    : 'text-muted hover:text-text'
                }`}
              >
                {group === 'TAB' ? '💊 Solids (TAB)' : group === 'BOTTLE' ? '🧴 Liquids (BOTTLE)' : 'All Forms'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchEnquiries}
            className="p-2 rounded-xl bg-bg border border-border text-muted hover:text-text transition-colors cursor-pointer"
            title="Refresh Enquiries"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setIsNewModalOpen(true)}
            className="px-3 py-1.5 rounded-xl bg-primary text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs hover:opacity-90 transition-opacity cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Enquiry</span>
          </button>
        </div>
      </div>

      {/* Enquiries Patient Cards List */}
      {isLoading ? (
        <div className="p-8 text-center text-muted text-xs flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-primary" />
          <span>Loading medicine enquiries...</span>
        </div>
      ) : filteredPatients.length === 0 ? (
        <div className="p-12 text-center bg-bg2 rounded-2xl border border-border space-y-2">
          <MessageSquare className="w-8 h-8 text-muted mx-auto opacity-50" />
          <p className="text-xs font-semibold text-text">No medicine enquiries found</p>
          <p className="text-[11px] text-muted">
            Incoming WhatsApp enquiries and customer medicine queries will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredPatients.map((patient, pIdx) => (
            <div
              key={patient.patient_phone || pIdx}
              className="p-4 bg-bg2 rounded-2xl border border-border space-y-3 shadow-xs"
            >
              {/* Patient Header */}
              <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                    {patient.patient_name?.[0]?.toUpperCase() || 'P'}
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-text">{patient.patient_name}</h4>
                    {patient.patient_phone && (
                      <p className="text-[11px] font-mono text-muted flex items-center gap-1">
                        <Phone className="w-3 h-3 text-muted" />
                        <span>+{patient.patient_phone}</span>
                      </p>
                    )}
                  </div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-md bg-bg font-bold text-muted border border-border">
                  {patient.enquiries?.length || 0} Queries
                </span>
              </div>

              {/* Items in this patient's enquiry */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {patient.enquiries?.map((item: any) => (
                  <div
                    key={item.id}
                    className="p-3 bg-bg rounded-xl border border-border space-y-2 flex flex-col justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-bold text-text line-clamp-1">
                          {item.medicine_name}
                        </span>
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                            item.dosage_group === 'TAB'
                              ? 'bg-sky-500/10 text-sky-600 border border-sky-500/20'
                              : item.dosage_group === 'BOTTLE'
                              ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20'
                              : 'bg-muted/10 text-muted'
                          }`}
                        >
                          {item.dosage_group}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
                        <span>Qty: <strong className="text-text">{item.qty || 1}</strong></span>
                        <span>•</span>
                        <span>
                          MRP:{' '}
                          <strong className="text-text">
                            {item.mrp ? `₹${Number(item.mrp).toFixed(2)}` : 'N/A'}
                          </strong>
                        </span>
                        <span>•</span>
                        <span className="capitalize">{item.status}</span>
                      </div>

                      {item.notes && (
                        <p className="text-[10px] text-muted italic line-clamp-2">
                          "{item.notes}"
                        </p>
                      )}
                    </div>

                    {/* Action Buttons (Rule 6: Pharmacist Controls) */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-border/40">
                      {item.status === 'open' && (
                        <button
                          type="button"
                          disabled={actionLoadingId === item.id}
                          onClick={() => handleAnswerWhatsApp(item.id)}
                          className="px-2 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-semibold flex items-center gap-1 hover:opacity-90 transition-opacity cursor-pointer"
                        >
                          <Send className="w-3 h-3" />
                          <span>Answer on WA</span>
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={actionLoadingId === item.id || item.status === 'converted'}
                        onClick={() => handleConvertToOrder(item.id)}
                        className={`px-2 py-1 rounded-lg text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer ${
                          item.status === 'converted'
                            ? 'bg-bg2 text-muted border border-border cursor-not-allowed'
                            : 'bg-primary text-white hover:opacity-90'
                        }`}
                      >
                        <ShoppingCart className="w-3 h-3" />
                        <span>{item.status === 'converted' ? 'Converted' : 'Convert to Order'}</span>
                      </button>

                      <button
                        type="button"
                        disabled={actionLoadingId === item.id}
                        onClick={() => handleConvertToRefill(item.id)}
                        className="px-2 py-1 rounded-lg bg-bg2 border border-border text-text hover:bg-bg text-[10px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <Repeat2 className="w-3 h-3 text-muted" />
                        <span>Register Refill</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Enquiry Modal */}
      {isNewModalOpen && (
        <div className="fixed inset-0 z-global-modal flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-bg border border-border rounded-2xl w-full max-w-md p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-border pb-2.5">
              <h3 className="text-sm font-bold text-text flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary" />
                <span>Create Medicine Enquiry</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsNewModalOpen(false)}
                className="p-1 rounded-lg hover:bg-bg2 text-muted hover:text-text cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateEnquirySubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-text">Patient Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Ramesh Patel"
                    value={formPatientName}
                    onChange={e => setFormPatientName(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-bg2 border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-text">WhatsApp Phone</label>
                  <input
                    type="tel"
                    placeholder="10-digit number"
                    value={formPhone}
                    onChange={e => setFormPhone(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-bg2 border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              {/* Dosage Group Filter */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-text">Formulation Group</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['TAB', 'BOTTLE', 'ALL'] as const).map(group => (
                    <button
                      key={group}
                      type="button"
                      onClick={() => {
                        setFormGroup(group);
                        setFormMedId(null);
                      }}
                      className={`py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                        formGroup === group
                          ? 'bg-primary text-white border-primary shadow-xs'
                          : 'bg-bg2 text-muted border-border hover:text-text'
                      }`}
                    >
                      {group === 'TAB' ? '💊 Solids (TAB)' : group === 'BOTTLE' ? '🧴 Liquids' : 'Universal'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Medicine Autocomplete & Browse */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-text">Medicine Name *</label>
                <input
                  type="text"
                  required
                  placeholder="Type to filter within group..."
                  value={formMedName}
                  onChange={e => {
                    setFormMedName(e.target.value);
                    setFormMedId(null);
                  }}
                  className="w-full px-2.5 py-1.5 bg-bg2 border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary"
                />

                {/* Scoped browse suggestions */}
                {browseSuggestions.length > 0 && !formMedId && (
                  <div className="max-h-36 overflow-y-auto rounded-xl border border-border bg-bg2 divide-y divide-border/60 mt-1">
                    {browseSuggestions.map((item: any) => (
                      <div
                        key={item.id}
                        onClick={() => {
                          setFormMedName(item.name);
                          setFormMedId(item.id);
                          setFormMrp(item.mrp);
                        }}
                        className="p-2 hover:bg-bg transition-colors cursor-pointer flex items-center justify-between text-xs"
                      >
                        <div>
                          <span className="font-bold text-text">{item.name}</span>
                          <span className="text-[10px] text-muted ml-1.5">{item.dosage_form || ''}</span>
                        </div>
                        <span className="font-bold text-text">
                          {item.mrp ? `₹${Number(item.mrp).toFixed(2)}` : 'MRP N/A'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-text">Quantity</label>
                  <input
                    type="number"
                    min={1}
                    value={formQty}
                    onChange={e => setFormQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-full px-2.5 py-1.5 bg-bg2 border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-text">MRP (Snapshot)</label>
                  <input
                    type="text"
                    readOnly
                    placeholder="Auto-fetched"
                    value={formMrp ? `₹${Number(formMrp).toFixed(2)}` : 'N/A'}
                    className="w-full px-2.5 py-1.5 bg-bg3 border border-border rounded-xl text-xs text-muted font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-text">Notes</label>
                <textarea
                  rows={2}
                  placeholder="Patient query notes..."
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-bg2 border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsNewModalOpen(false)}
                  className="px-3 py-1.5 rounded-xl border border-border text-xs font-semibold text-muted hover:text-text cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-primary text-white text-xs font-semibold hover:opacity-90 transition-opacity shadow-xs cursor-pointer"
                >
                  Create Enquiry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default EnquiriesSection;
