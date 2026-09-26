import React, { useState, useEffect } from 'react';
import { X, Calendar, AlertTriangle, Store, Truck, Clock, CheckCircle } from 'lucide-react';
import { api } from '../services/api';
import { toastEvent } from '../services/events';

interface MarketClosureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigSaved?: () => void;
}

export const MarketClosureModal: React.FC<MarketClosureModalProps> = ({
  isOpen,
  onClose,
  onConfigSaved,
}) => {
  const [enabled, setEnabled] = useState(false);
  const [type, setType] = useState<'market_closed' | 'pharmacy_closed'>('market_closed');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [lookaheadDays, setLookaheadDays] = useState(7);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    api.getMarketClosureStatus()
      .then((res: any) => {
        if (res?.config) {
          setEnabled(Boolean(res.config.enabled));
          setType(res.config.type || 'market_closed');
          setStartDate(res.config.startDate || '');
          setEndDate(res.config.endDate || '');
          setReason(res.config.reason || '');
          setLookaheadDays(Number(res.config.lookaheadDays) || 7);
        }
      })
      .catch((err: any) => console.error('Failed to load closure config:', err));
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (enabled && !startDate) {
      toastEvent.trigger('Please select at least a start date for the closure window', 'error');
      return;
    }
    setIsSaving(true);
    try {
      await api.saveMarketClosureStatus({
        enabled,
        type,
        startDate,
        endDate: endDate || startDate,
        reason,
        lookaheadDays,
      });
      toastEvent.trigger(
        enabled
          ? `${type === 'market_closed' ? 'Market' : 'Store'} closure schedule saved. 7-day advance buffer activated.`
          : 'Closure schedule deactivated.',
        'info'
      );
      onConfigSaved?.();
      onClose();
    } catch (err: any) {
      toastEvent.trigger(err?.message || 'Failed to save closure schedule', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-global-modal flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-bg border border-border w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border/40 flex items-center justify-between bg-bg2">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-xl ${type === 'market_closed' ? 'bg-amber-500/10 text-amber-500' : 'bg-rose-500/10 text-rose-500'}`}>
              {type === 'market_closed' ? <Truck size={20} /> : <Store size={20} />}
            </div>
            <div>
              <h2 className="text-base font-bold text-text">Market & Store Closure Planner</h2>
              <p className="text-xs text-muted">Prepare advance stock in Pharmarack and alert upcoming refill patients</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-all cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto max-h-[75vh]">
          {/* Active Toggle Switch */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-bg2 border border-border/50">
            <div className="space-y-0.5">
              <span className="text-sm font-bold text-text">Closure Mode Active</span>
              <p className="text-xs text-muted">When enabled, calculates 7-day stock buffer & patient alerts</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={e => setEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-text after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600 peer-checked:after:bg-text"></div>
            </label>
          </div>

          {/* Closure Type Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted uppercase tracking-wider">Closure Type</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setType('market_closed')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-1 ${
                  type === 'market_closed'
                    ? 'border-amber-500/60 bg-amber-500/10 text-amber-500 shadow-xs'
                    : 'border-border/60 bg-bg2 text-muted hover:text-text hover:bg-bg3'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Truck size={16} />
                  <span className="text-xs font-bold">Market Closed</span>
                </div>
                <p className="text-[11px] opacity-80 font-normal">
                  Distributors/wholesale closed (3–4 days). Store is open; order stock beforehand.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setType('pharmacy_closed')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-1 ${
                  type === 'pharmacy_closed'
                    ? 'border-rose-500/60 bg-rose-500/10 text-rose-500 shadow-xs'
                    : 'border-border/60 bg-bg2 text-muted hover:text-text hover:bg-bg3'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Store size={16} />
                  <span className="text-xs font-bold">Store Closed</span>
                </div>
                <p className="text-[11px] opacity-80 font-normal">
                  Pharmacy store holiday. Notify patients to pick up medicines before shutdown.
                </p>
              </button>
            </div>
          </div>

          {/* Date Range Selection */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-muted">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full bg-bg2 border border-border/60 rounded-xl px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-muted">End Date (Reopening)</label>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full bg-bg2 border border-border/60 rounded-xl px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* Reason */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-muted">Closure Reason / Occasion (Optional)</label>
            <input
              type="text"
              placeholder="e.g. Diwali Festival, Mandi Holiday, Association Strike"
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="w-full bg-bg2 border border-border/60 rounded-xl px-3 py-2 text-sm text-text focus:outline-none focus:border-primary placeholder:text-muted/60"
            />
          </div>

          {/* Lookahead Days */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-muted">Advance Look-Ahead Window</label>
              <span className="text-xs font-bold text-amber-500 font-mono">{lookaheadDays} Days</span>
            </div>
            <input
              type="range"
              min={3}
              max={14}
              step={1}
              value={lookaheadDays}
              onChange={e => setLookaheadDays(Number(e.target.value))}
              className="w-full accent-amber-500"
            />
            <p className="text-[11px] text-muted">
              Scans all patient refills due up to {lookaheadDays} days past closure to pre-stock inventory.
            </p>
          </div>

          {/* Operational Guidance */}
          <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs text-amber-500/90 flex items-start gap-2">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <span>
              <strong>Advance Supply Guarantee:</strong> Once saved, the Pharmarack Cart will display an interactive checklist of upcoming refill shortages. Staged WhatsApp notices will be prepared for your approval.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border/40 bg-bg2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-bold text-muted hover:text-text hover:bg-bg3 transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2 rounded-xl text-sm font-bold bg-amber-600 text-white hover:bg-amber-500 transition-all cursor-pointer shadow-xs disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Closure Schedule'}
          </button>
        </div>
      </div>
    </div>
  );
};
