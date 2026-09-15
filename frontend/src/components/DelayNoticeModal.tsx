import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Clock, X, Search, Check, Send, AlertCircle,
  RefreshCw, Sparkles, CheckCircle2, Filter
} from 'lucide-react';
import { apiClient } from '../services/api';
import { toastEvent } from '../services/events';
import { useModalEscape } from '../services/keyboardShortcuts';

export interface DelayCandidate {
  id: number;
  type: 'special_order' | 'refill';
  patient_name: string;
  patient_phone: string;
  medicine_name: string;
  qty: number;
  scheduled_date: string | null;
  status: string;
  distributor_name?: string | null;
  store_id: number;
}

interface DelayNoticeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDispatched?: () => void;
}

const TEMPLATE_PRESETS = [
  {
    id: 'festival',
    label: '🪔 Festival / Holiday',
    text: 'Dear {patient_name}, due to a festival/market closure today, your scheduled medicine ({medicine_name}) from our distributor will be delayed by 1 day. We apologize for the inconvenience and will update you as soon as it arrives! — {pharmacy_name}',
  },
  {
    id: 'weather',
    label: '🌧️ Weather / Strike',
    text: 'Dear {patient_name}, due to severe weather/transport disruption today, wholesale supply of your medicine ({medicine_name}) is delayed by 1 day. We are monitoring arrivals and will notify you promptly! — {pharmacy_name}',
  },
  {
    id: 'distributor_delay',
    label: '📦 Distributor Delay',
    text: 'Dear {patient_name}, the distributor shipment containing your medicine ({medicine_name}) has been delayed. It is now expected tomorrow. We apologize for the delay! — {pharmacy_name}',
  },
  {
    id: 'custom',
    label: '✍️ Custom Reason',
    text: 'Dear {patient_name}, your scheduled medicine ({medicine_name}) is delayed today. We expect it to be ready tomorrow. Thank you for your patience! — {pharmacy_name}',
  },
];

export function DelayNoticeModal({ isOpen, onClose, onDispatched }: DelayNoticeModalProps) {
  useModalEscape(isOpen, onClose);

  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<DelayCandidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activePreset, setActivePreset] = useState<string>('festival');
  const [messageTemplate, setMessageTemplate] = useState<string>(TEMPLATE_PRESETS[0].text);
  const [postponeDays, setPostponeDays] = useState<number>(1);
  const [postponeDate, setPostponeDate] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'special_order' | 'refill'>('all');
  const [dispatching, setDispatching] = useState<boolean>(false);

  // Load candidates when modal opens
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setLoading(true);

    apiClient.get('/crm/delay-notice-candidates')
      .then(res => {
        if (!isMounted) return;
        const list: DelayCandidate[] = res.data?.candidates || [];
        setCandidates(list);

        // Select all candidates with valid phone numbers by default
        const initialSelected = new Set<string>();
        list.forEach(c => {
          const raw = (c.patient_phone || '').replace(/\D/g, '');
          if (raw.length >= 10) {
            initialSelected.add(`${c.type}_${c.id}`);
          }
        });
        setSelectedIds(initialSelected);
      })
      .catch(err => {
        if (!isMounted) return;
        toastEvent.trigger(err?.response?.data?.error || err?.message || 'Failed to fetch delay notice candidates', 'error', '/crm');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  const handleSelectPreset = (presetId: string) => {
    setActivePreset(presetId);
    const found = TEMPLATE_PRESETS.find(p => p.id === presetId);
    if (found) {
      setMessageTemplate(found.text);
    }
  };

  const handleInsertTag = (tag: string) => {
    setMessageTemplate(prev => `${prev} ${tag}`);
  };

  // Filter candidates based on search and type tab
  const filteredCandidates = useMemo(() => {
    return candidates.filter(c => {
      if (typeFilter !== 'all' && c.type !== typeFilter) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        c.patient_name.toLowerCase().includes(q) ||
        c.patient_phone.includes(q) ||
        c.medicine_name.toLowerCase().includes(q) ||
        (c.distributor_name && c.distributor_name.toLowerCase().includes(q))
      );
    });
  }, [candidates, typeFilter, searchQuery]);

  const toggleSelectCandidate = (key: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    const validFilteredKeys = filteredCandidates
      .filter(c => (c.patient_phone || '').replace(/\D/g, '').length >= 10)
      .map(c => `${c.type}_${c.id}`);

    const allSelected = validFilteredKeys.every(k => selectedIds.has(k));

    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        validFilteredKeys.forEach(k => next.delete(k));
      } else {
        validFilteredKeys.forEach(k => next.add(k));
      }
      return next;
    });
  };

  const selectedCandidates = useMemo(() => {
    return candidates.filter(c => selectedIds.has(`${c.type}_${c.id}`));
  }, [candidates, selectedIds]);

  const skippedCount = candidates.length - selectedCandidates.length;

  const handleSendBroadcast = async () => {
    if (selectedCandidates.length === 0) {
      toastEvent.trigger('Please select at least one patient to send delay notices.', 'info', '/crm');
      return;
    }

    if (!messageTemplate.trim()) {
      toastEvent.trigger('Message template cannot be empty.', 'error', '/crm');
      return;
    }

    setDispatching(true);
    try {
      const res = await apiClient.post('/crm/broadcast-delay-notices', {
        recipients: selectedCandidates,
        message_template: messageTemplate.trim(),
        postpone_days: postponeDate ? postponeDays : 0,
      });

      if (res.data?.success) {
        toastEvent.trigger(res.data.message || `Queued ${res.data.queued_count} delay notice messages!`, 'success', '/crm');
        if (onDispatched) onDispatched();
        onClose();
      } else {
        toastEvent.trigger(res.data?.error || 'Failed to dispatch delay notices', 'error', '/crm');
      }
    } catch (err: any) {
      toastEvent.trigger(err?.response?.data?.error || err?.message || 'Error broadcasting delay notices', 'error', '/crm');
    } finally {
      setDispatching(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
      <div className="bg-bg2 border border-border rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150 text-text">
        {/* Modal Header */}
        <div className="bg-bg3/80 px-5 py-3.5 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Clock size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-text text-sm">BROADCAST DELAY & MARKET-OFF NOTICE</h3>
                <span className="px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 text-[10px] font-bold">
                  {candidates.length} Scheduled
                </span>
              </div>
              <p className="text-[11px] text-muted">
                Notify scheduled special orders & refill patients when distributors are closed
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer"
            title="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 custom-scrollbar space-y-4 text-xs">
          {/* Section 1: Presets & Template Composer */}
          <div className="p-3.5 rounded-xl bg-bg border border-border space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-[11px] font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles size={12} className="text-purple-400" />
                1. Select Reason Preset & Edit Message
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {TEMPLATE_PRESETS.map(preset => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset.id)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                      activePreset === preset.id
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'bg-bg2 hover:bg-bg3 text-muted hover:text-text border border-border'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Template Input */}
            <div className="space-y-1.5">
              <textarea
                value={messageTemplate}
                onChange={e => setMessageTemplate(e.target.value)}
                rows={3}
                placeholder="Type your delay notification message..."
                className="w-full px-3 py-2 bg-bg2 border border-border rounded-xl text-xs text-text focus:outline-none focus:border-purple-500 font-sans leading-relaxed resize-none"
              />
              <div className="flex items-center justify-between flex-wrap gap-2 pt-0.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-muted">Insert Tag:</span>
                  {['{patient_name}', '{medicine_name}', '{pharmacy_name}', '{qty}'].map(tag => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => handleInsertTag(tag)}
                      className="px-1.5 py-0.5 rounded bg-bg2 hover:bg-bg3 border border-border text-[10px] font-mono text-purple-400 transition-colors cursor-pointer"
                      title={`Click to append ${tag}`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>

                {/* Postpone Option */}
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={postponeDate}
                    onChange={e => setPostponeDate(e.target.checked)}
                    className="w-3.5 h-3.5 rounded text-purple-600 border-border focus:ring-0 cursor-pointer"
                  />
                  <span className="text-[11px] font-medium text-text">
                    Postpone delivery date by
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={7}
                    value={postponeDays}
                    disabled={!postponeDate}
                    onChange={e => setPostponeDays(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-12 px-1.5 py-0.5 text-center bg-bg2 border border-border rounded text-[11px] font-bold text-text disabled:opacity-40"
                  />
                  <span className="text-[11px] font-medium text-text">day(s)</span>
                </label>
              </div>
            </div>
          </div>

          {/* Section 2: Patient Queue & Selection Table */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-[11px] font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
                <Filter size={12} className="text-purple-400" />
                2. Review Queue ({selectedCandidates.length} of {candidates.length} Selected)
              </span>

              {/* Filters & Search */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center bg-bg p-0.5 rounded-lg border border-border">
                  <button
                    type="button"
                    onClick={() => setTypeFilter('all')}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                      typeFilter === 'all' ? 'bg-purple-600 text-white' : 'text-muted hover:text-text'
                    }`}
                  >
                    All ({candidates.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTypeFilter('special_order')}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                      typeFilter === 'special_order' ? 'bg-purple-600 text-white' : 'text-muted hover:text-text'
                    }`}
                  >
                    Special Requests ({candidates.filter(c => c.type === 'special_order').length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTypeFilter('refill')}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                      typeFilter === 'refill' ? 'bg-purple-600 text-white' : 'text-muted hover:text-text'
                    }`}
                  >
                    Refills ({candidates.filter(c => c.type === 'refill').length})
                  </button>
                </div>

                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    type="text"
                    placeholder="Search patient / medicine..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pl-7 pr-2.5 py-1 bg-bg border border-border rounded-lg text-[11px] text-text focus:outline-none focus:border-purple-500 w-44"
                  />
                </div>
              </div>
            </div>

            {/* Candidates Table */}
            <div className="border border-border rounded-xl overflow-hidden bg-bg/50 max-h-64 overflow-y-auto custom-scrollbar">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 bg-bg3/95 backdrop-blur-sm border-b border-border text-[10px] font-bold uppercase tracking-wider text-muted select-none">
                  <tr>
                    <th className="py-2.5 px-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={filteredCandidates.length > 0 && filteredCandidates.every(c => selectedIds.has(`${c.type}_${c.id}`))}
                        onChange={toggleSelectAllFiltered}
                        className="w-3.5 h-3.5 rounded text-purple-600 border-border focus:ring-0 cursor-pointer"
                        title="Select or deselect all filtered"
                      />
                    </th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Patient / Phone</th>
                    <th className="py-2.5 px-3">Medicine & Qty</th>
                    <th className="py-2.5 px-3">Current Status</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-muted">
                        <div className="flex items-center justify-center gap-2">
                          <RefreshCw size={14} className="animate-spin text-purple-400" />
                          <span>Scanning scheduled orders and upcoming refills...</span>
                        </div>
                      </td>
                    </tr>
                  ) : filteredCandidates.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-muted">
                        {candidates.length === 0
                          ? 'No pending special orders or upcoming refills found.'
                          : 'No items match your filter.'}
                      </td>
                    </tr>
                  ) : (
                    filteredCandidates.map(c => {
                      const key = `${c.type}_${c.id}`;
                      const isSelected = selectedIds.has(key);
                      const rawPhone = (c.patient_phone || '').replace(/\D/g, '');
                      const hasValidPhone = rawPhone.length >= 10;

                      return (
                        <tr
                          key={key}
                          className={`hover:bg-bg3/30 transition-colors ${
                            !isSelected ? 'opacity-60 bg-bg3/10' : ''
                          }`}
                        >
                          <td className="py-2.5 px-3 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={!hasValidPhone}
                              onChange={() => toggleSelectCandidate(key)}
                              className="w-3.5 h-3.5 rounded text-purple-600 border-border focus:ring-0 cursor-pointer disabled:opacity-40"
                            />
                          </td>
                          <td className="py-2.5 px-3">
                            {c.type === 'special_order' ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/15 text-purple-400 border border-purple-500/30">
                                Special Order
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-500/15 text-sky-400 border border-sky-500/30">
                                Refill
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-medium">
                            <div className="text-text font-bold">{c.patient_name}</div>
                            <div className="text-[11px] text-muted flex items-center gap-1 font-mono">
                              {hasValidPhone ? (
                                <span>{c.patient_phone}</span>
                              ) : (
                                <span className="text-red-400 flex items-center gap-0.5">
                                  <AlertCircle size={10} /> No valid phone
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-text">{c.medicine_name}</div>
                            <div className="text-[10px] text-muted">
                              Qty: <strong className="font-mono text-text">{c.qty}</strong>
                              {c.distributor_name && <span> · Dist: {c.distributor_name}</span>}
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-bg2 border border-border text-muted">
                              {c.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => toggleSelectCandidate(key)}
                              disabled={!hasValidPhone}
                              className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                                isSelected
                                  ? 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/30'
                                  : 'bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border border-purple-500/30'
                              }`}
                              title={isSelected ? 'Skip this patient (e.g. medicine already arrived in shop)' : 'Include this patient'}
                            >
                              {isSelected ? 'Skip' : 'Include'}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Skipping reminder tip */}
            <div className="flex items-center justify-between text-[11px] text-muted px-1">
              <span>
                💡 Tip: If any medicine is already available in the pharmacy, click <strong>Skip</strong> or uncheck their row.
              </span>
              <span>
                {skippedCount > 0 ? (
                  <span className="text-amber-400 font-bold">{skippedCount} patient(s) skipped</span>
                ) : (
                  <span className="text-emerald-400 font-bold">All eligible patients selected</span>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="bg-bg3/80 px-5 py-3.5 border-t border-border flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-muted">
            Will send <strong className="text-purple-400 font-bold">{selectedCandidates.length}</strong> delay message(s) via throttled WhatsApp background queue
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={dispatching}
              className="px-4 py-2 rounded-xl text-xs font-bold text-muted hover:text-text hover:bg-bg3 border border-border transition-all cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSendBroadcast}
              disabled={dispatching || selectedCandidates.length === 0}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-black shadow-md shadow-purple-500/20 transition-all active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {dispatching ? (
                <>
                  <RefreshCw size={13} className="animate-spin" />
                  <span>Queueing Messages...</span>
                </>
              ) : (
                <>
                  <Send size={13} />
                  <span>Send Delay Notice ({selectedCandidates.length})</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
