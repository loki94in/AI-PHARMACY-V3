import React, { useState, useEffect, useMemo } from 'react';
import { X, Calendar, AlertTriangle, Truck, Clock, Send, CheckSquare, Square, ChevronDown, ChevronUp, Package, RefreshCw, MessageSquare, ShieldCheck, Info } from 'lucide-react';
import { api } from '../services/api';
import { toastEvent } from '../services/events';

export interface AffectedCustomerMedicine {
  name: string;
  qty: number;
  unit?: string;
  mrp?: number;
}

export interface AffectedCustomer {
  phone: string;
  name: string;
  sourceTypes: string[]; // ['Special Order', 'Refill', 'Online Order', 'CRM']
  orderRefs: string[];
  medicines: AffectedCustomerMedicine[];
  totalItems: number;
  notes?: string;
}

interface MarketClosureNoticeModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetDate: string; // YYYY-MM-DD
  endDate?: string;
  closureReason?: string;
  onConfirmPauseWithoutSending?: () => void;
  onSuccess?: (sentCount: number) => void;
}

const DEFAULT_MESSAGE_TEMPLATE = `*Order Delivery Update — {{PHARMACY_NAME}}* 🛵

Dear {{PATIENT_NAME}},
Please note that due to {{REASON}}, our market dispatch is paused on {{PAUSED_DATE}}.

Your order ({{ORDER_REF}}) containing:
{{MEDICINES}}

is scheduled for priority delivery on *{{NEXT_WORKING_DATE}}* during *{{NEXT_DELIVERY_TIME}}*.

Thank you for trusting us! For urgent assistance, feel free to reply to this message.`;

export const MarketClosureNoticeModal: React.FC<MarketClosureNoticeModalProps> = ({
  isOpen,
  onClose,
  targetDate,
  endDate,
  closureReason,
  onConfirmPauseWithoutSending,
  onSuccess,
}) => {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [patients, setPatients] = useState<AffectedCustomer[]>([]);
  const [selectedPhones, setSelectedPhones] = useState<Set<string>>(new Set());
  const [expandedPhones, setExpandedPhones] = useState<Set<string>>(new Set());
  const [nextWorkingDate, setNextWorkingDate] = useState<string>('');
  const [nextDeliveryTime, setNextDeliveryTime] = useState<string>('9:00 AM – 11:00 AM');
  const [reason, setReason] = useState<string>(closureReason || 'Market Holiday / Paused Dispatch');
  const [messageTemplate, setMessageTemplate] = useState<string>(DEFAULT_MESSAGE_TEMPLATE);
  const [activeTab, setActiveTab] = useState<'list' | 'message'>('list');

  // Load affected patients when modal opens
  useEffect(() => {
    if (!isOpen || !targetDate) return;
    setLoading(true);
    setSelectedPhones(new Set());
    setExpandedPhones(new Set());

    api.getAffectedClosurePatients({ startDate: targetDate, endDate: endDate || targetDate })
      .then((res: any) => {
        if (res?.success) {
          const list: AffectedCustomer[] = res.patients || [];
          setPatients(list);
          // Pre-select all affected customers for easy pharmacist approval
          setSelectedPhones(new Set(list.map((p) => p.phone)));
          if (res.nextWorkingDate) setNextWorkingDate(res.nextWorkingDate);
          if (res.nextDeliveryTime) setNextDeliveryTime(res.nextDeliveryTime);
          if (res.closureReason) setReason(res.closureReason);
        } else {
          setPatients([]);
        }
      })
      .catch((err: any) => {
        console.error('Failed to load affected closure patients:', err);
        toastEvent.trigger(err?.message || 'Could not load affected orders', 'error');
        setPatients([]);
      })
      .finally(() => setLoading(false));
  }, [isOpen, targetDate, endDate, closureReason]);

  const toggleSelectAll = () => {
    if (selectedPhones.size === patients.length) {
      setSelectedPhones(new Set());
    } else {
      setSelectedPhones(new Set(patients.map((p) => p.phone)));
    }
  };

  const toggleSelectPhone = (phone: string) => {
    const next = new Set(selectedPhones);
    if (next.has(phone)) {
      next.delete(phone);
    } else {
      next.add(phone);
    }
    setSelectedPhones(next);
  };

  const toggleExpandPhone = (phone: string) => {
    const next = new Set(expandedPhones);
    if (next.has(phone)) {
      next.delete(phone);
    } else {
      next.add(phone);
    }
    setExpandedPhones(next);
  };

  const expandAll = () => {
    setExpandedPhones(new Set(patients.map((p) => p.phone)));
  };

  const collapseAll = () => {
    setExpandedPhones(new Set());
  };

  // Preview generated message for first selected customer
  const previewMessage = useMemo(() => {
    const sample = patients.find((p) => selectedPhones.has(p.phone)) || patients[0];
    const patientName = sample ? sample.name : 'Customer';
    const orderRef = sample && sample.orderRefs.length > 0 ? sample.orderRefs.join(', ') : 'SO-1001';
    const medList = sample && sample.medicines.length > 0
      ? sample.medicines.map((m) => `• ${m.name} (${m.qty} ${m.unit || 'unit'})`).join('\n')
      : '• Your prescribed medications';

    return messageTemplate
      .replace(/\{\{PHARMACY_NAME\}\}/g, 'AI Pharmacy')
      .replace(/\{\{PATIENT_NAME\}\}/g, patientName)
      .replace(/\{patient_name\}/g, patientName)
      .replace(/\{\{ORDER_REF\}\}/g, orderRef)
      .replace(/\{order_ref\}/g, orderRef)
      .replace(/\{\{PAUSED_DATE\}\}/g, targetDate)
      .replace(/\{\{REASON\}\}/g, reason)
      .replace(/\{\{MEDICINES\}\}/g, medList)
      .replace(/\{medicines\}/g, medList)
      .replace(/\{\{NEXT_WORKING_DATE\}\}/g, nextWorkingDate || 'our next working day')
      .replace(/\{next_date\}/g, nextWorkingDate || 'our next working day')
      .replace(/\{\{NEXT_DELIVERY_TIME\}\}/g, nextDeliveryTime)
      .replace(/\{delivery_time\}/g, nextDeliveryTime);
  }, [messageTemplate, patients, selectedPhones, targetDate, reason, nextWorkingDate, nextDeliveryTime]);

  const handleSendNotices = async () => {
    const toSend = patients.filter((p) => selectedPhones.has(p.phone));
    if (toSend.length === 0) {
      toastEvent.trigger('Please select at least 1 customer to send WhatsApp updates', 'error');
      return;
    }

    setSending(true);
    try {
      const selectedData = toSend.map((p) => ({
        phone: p.phone,
        name: p.name,
        orderRef: p.orderRefs.join(', '),
        medicines: p.medicines.map((m) => `${m.name} (${m.qty} ${m.unit || 'qty'})`),
      }));

      const res = await api.sendClosureNotices({
        selectedPatients: selectedData,
        messageTemplate,
        nextWorkingDate,
        nextDeliveryTime,
        reason,
      });

      const sentCount = res?.sentCount ?? toSend.length;
      toastEvent.trigger(
        `Dispatched WhatsApp delivery notice to ${sentCount} patient${sentCount !== 1 ? 's' : ''}!`,
        'success'
      );
      onSuccess?.(sentCount);
      onClose();
    } catch (err: any) {
      console.error('Failed to send closure notices:', err);
      toastEvent.trigger(err?.message || 'Failed to dispatch notices', 'error');
    } finally {
      setSending(false);
    }
  };

  const handlePauseSilently = () => {
    onConfirmPauseWithoutSending?.();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-global-modal flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-bg border border-border w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="p-4 border-b border-border/40 flex items-center justify-between bg-bg2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
              <Truck size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-text">Market Dispatch Paused — Customer Review</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
                  Human Approval Required
                </span>
              </div>
              <p className="text-xs text-muted">
                Review and notify affected customers across Refills, Special Orders, Online Orders, and CRM.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-all cursor-pointer"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Schedule Context Banner */}
        <div className="p-3 bg-bg3/30 border-b border-border/50 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-text">Paused Date:</span>
            <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-500 font-bold border border-amber-500/20">
              {targetDate}
            </span>
            <span className="text-muted">•</span>
            <span className="font-semibold text-text">Next Working Delivery:</span>
            <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-500 font-bold border border-emerald-500/20 flex items-center gap-1">
              <Calendar size={12} />
              {nextWorkingDate || 'Auto-Calculating...'} ({nextDeliveryTime})
            </span>
          </div>

          <div className="flex items-center gap-1 bg-bg2 p-1 rounded-lg border border-border">
            <button
              onClick={() => setActiveTab('list')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                activeTab === 'list'
                  ? 'bg-primary text-white shadow-xs'
                  : 'text-muted hover:text-text'
              }`}
            >
              Affected Orders ({patients.length})
            </button>
            <button
              onClick={() => setActiveTab('message')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 ${
                activeTab === 'message'
                  ? 'bg-primary text-white shadow-xs'
                  : 'text-muted hover:text-text'
              }`}
            >
              <MessageSquare size={12} />
              <span>Edit Message</span>
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-muted gap-2">
              <RefreshCw size={24} className="animate-spin text-primary" />
              <span className="text-xs">Scanning Refills, Special Orders, Online Orders & CRM...</span>
            </div>
          ) : activeTab === 'list' ? (
            <div>
              {patients.length === 0 ? (
                <div className="py-10 text-center space-y-3">
                  <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto border border-emerald-500/20">
                    <ShieldCheck size={24} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-text">No Pending Orders Affected</h3>
                    <p className="text-xs text-muted max-w-sm mx-auto mt-1">
                      No active refills, special orders, online deliveries, or CRM call tasks are scheduled for {targetDate}.
                    </p>
                  </div>
                  <button
                    onClick={handlePauseSilently}
                    className="px-4 py-2 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary/90 transition-all cursor-pointer shadow-sm"
                  >
                    Confirm & Pause Date
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Select Controls & Summary */}
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={toggleSelectAll}
                        className="flex items-center gap-1.5 text-xs font-bold text-text hover:text-primary transition-all cursor-pointer"
                      >
                        {selectedPhones.size === patients.length ? (
                          <CheckSquare size={16} className="text-primary" />
                        ) : (
                          <Square size={16} className="text-muted" />
                        )}
                        <span>
                          {selectedPhones.size === patients.length ? 'Deselect All' : 'Select All'} ({selectedPhones.size}/{patients.length})
                        </span>
                      </button>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-muted">
                      <button
                        onClick={expandAll}
                        className="hover:text-text transition-colors underline cursor-pointer"
                      >
                        Expand All
                      </button>
                      <span>•</span>
                      <button
                        onClick={collapseAll}
                        className="hover:text-text transition-colors underline cursor-pointer"
                      >
                        Collapse All
                      </button>
                    </div>
                  </div>

                  {/* Customer Accordion Cards */}
                  <div className="space-y-2">
                    {patients.map((patient) => {
                      const isSelected = selectedPhones.has(patient.phone);
                      const isExpanded = expandedPhones.has(patient.phone);

                      return (
                        <div
                          key={patient.phone}
                          className={`rounded-xl border transition-all ${
                            isSelected
                              ? 'bg-bg2 border-primary/30 shadow-xs'
                              : 'bg-bg3/20 border-border opacity-75'
                          }`}
                        >
                          {/* Accordion Header */}
                          <div
                            onClick={() => toggleExpandPhone(patient.phone)}
                            className="p-3 flex items-center justify-between gap-3 cursor-pointer select-none"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSelectPhone(patient.phone);
                                }}
                                className="text-muted hover:text-text transition-colors cursor-pointer shrink-0"
                              >
                                {isSelected ? (
                                  <CheckSquare size={18} className="text-primary" />
                                ) : (
                                  <Square size={18} className="text-muted" />
                                )}
                              </button>

                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-bold text-text truncate">
                                    {patient.name}
                                  </span>
                                  <span className="text-[11px] text-muted font-mono">
                                    {patient.phone}
                                  </span>
                                  {patient.sourceTypes.map((type) => (
                                    <span
                                      key={type}
                                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                        type === 'Special Order'
                                          ? 'bg-blue-500/10 text-blue-500 border-blue-500/20'
                                          : type === 'Refill'
                                          ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                                          : type === 'Online Order'
                                          ? 'bg-purple-500/10 text-purple-500 border-purple-500/20'
                                          : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                                      }`}
                                    >
                                      {type}
                                    </span>
                                  ))}
                                </div>
                                <div className="text-[11px] text-muted flex items-center gap-2 mt-0.5">
                                  <span>{patient.orderRefs.join(', ') || 'Scheduled Delivery'}</span>
                                  <span>•</span>
                                  <span className="text-text font-semibold">
                                    {patient.medicines.length} medicine{patient.medicines.length !== 1 ? 's' : ''}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[11px] text-muted hover:text-text font-medium flex items-center gap-0.5">
                                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                              </span>
                            </div>
                          </div>

                          {/* Accordion Content: Medicines Breakdown */}
                          {isExpanded && (
                            <div className="px-3 pb-3 pt-1 border-t border-border/40 bg-bg3/10 rounded-b-xl text-xs space-y-1.5">
                              <div className="text-[11px] font-semibold text-muted mb-1 flex items-center gap-1">
                                <Package size={12} />
                                <span>Ordered Medicines ({patient.medicines.length}):</span>
                              </div>
                              {patient.medicines.length === 0 ? (
                                <p className="text-[11px] text-muted italic">No itemized medicines listed.</p>
                              ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                  {patient.medicines.map((med, idx) => (
                                    <div
                                      key={idx}
                                      className="p-2 rounded-lg bg-bg border border-border flex items-center justify-between gap-2"
                                    >
                                      <span className="font-semibold text-text truncate">{med.name}</span>
                                      <span className="font-mono text-primary font-bold whitespace-nowrap bg-primary/10 px-1.5 py-0.5 rounded text-[11px]">
                                        Qty: {med.qty} {med.unit || ''}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {patient.notes && (
                                <div className="text-[11px] text-muted bg-bg p-2 rounded-lg border border-border/40 mt-1">
                                  <span className="font-semibold text-text">Notes:</span> {patient.notes}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Tab 2: WhatsApp Message Template Customizer */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-text flex items-center gap-1.5">
                  <MessageSquare size={14} className="text-emerald-500" />
                  <span>Customize WhatsApp Message Notice</span>
                </label>
                <button
                  type="button"
                  onClick={() => setMessageTemplate(DEFAULT_MESSAGE_TEMPLATE)}
                  className="text-[11px] text-primary hover:underline cursor-pointer"
                >
                  Reset Template
                </button>
              </div>

              <textarea
                rows={7}
                value={messageTemplate}
                onChange={(e) => setMessageTemplate(e.target.value)}
                className="w-full p-3 rounded-xl bg-bg border border-border text-text font-mono text-xs focus:outline-none focus:border-primary resize-y"
                placeholder="Enter customized WhatsApp message..."
              />

              {/* Dynamic Variables Chips */}
              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className="text-muted font-semibold">Click to insert:</span>
                {[
                  '{{PATIENT_NAME}}',
                  '{{ORDER_REF}}',
                  '{{MEDICINES}}',
                  '{{PAUSED_DATE}}',
                  '{{NEXT_WORKING_DATE}}',
                  '{{NEXT_DELIVERY_TIME}}',
                  '{{REASON}}',
                  '{{PHARMACY_NAME}}',
                ].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setMessageTemplate((prev) => prev + ` ${tag}`)}
                    className="px-2 py-0.5 rounded bg-bg3 text-text hover:bg-primary/20 hover:text-primary transition-all cursor-pointer font-mono border border-border"
                  >
                    {tag}
                  </button>
                ))}
              </div>

              {/* Message Live Preview */}
              <div className="p-3 rounded-xl bg-bg2 border border-border space-y-1.5">
                <div className="text-[11px] font-bold text-muted flex items-center gap-1">
                  <Info size={12} />
                  <span>Live Preview (For First Selected Customer):</span>
                </div>
                <div className="p-2.5 rounded-lg bg-bg border border-border/60 text-xs font-sans whitespace-pre-wrap text-text">
                  {previewMessage}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-border/40 bg-bg2 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-[11px] text-muted">
            <ShieldCheck size={14} className="text-emerald-500 shrink-0" />
            <span>App will never send auto-messages without pharmacist clicking approve.</span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={handlePauseSilently}
              disabled={sending}
              className="px-3 py-2 rounded-xl text-xs font-semibold text-muted hover:text-text hover:bg-bg3 transition-all cursor-pointer"
            >
              Pause Silently
            </button>

            <button
              type="button"
              onClick={handleSendNotices}
              disabled={sending || selectedPhones.size === 0}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-primary text-white font-bold text-xs hover:bg-primary/90 transition-all cursor-pointer shadow-sm disabled:opacity-50"
            >
              {sending ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              <span>
                {sending
                  ? 'Queueing Notices...'
                  : `Approve & Send Notice (${selectedPhones.size})`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
