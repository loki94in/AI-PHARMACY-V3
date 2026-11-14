import React, { useState } from 'react';
import { 
  X, 
  FileDown, 
  Send, 
  CheckSquare, 
  Layers, 
  Building2, 
  SortAsc, 
  MapPin, 
  Calendar, 
  Loader2 
} from 'lucide-react';
import { api } from '../../services/api';
import { toastEvent } from '../../services/events';

interface ShelfRemovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultDateFrom: string;
  defaultDateTo: string;
}

export const ShelfRemovalModal: React.FC<ShelfRemovalModalProps> = ({
  isOpen,
  onClose,
  defaultDateFrom,
  defaultDateTo
}) => {
  const [sortBy, setSortBy] = useState<'alphabetical' | 'company' | 'rack' | 'expiry_date'>('alphabetical');
  const [dosageForm, setDosageForm] = useState<'all' | 'solid' | 'liquid'>('all');
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(defaultDateTo);
  const [customPhone, setCustomPhone] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSendingWa, setIsSendingWa] = useState(false);

  if (!isOpen) return null;

  const handleDownloadPdf = async () => {
    setIsDownloading(true);
    try {
      const blob = await api.downloadShelfRemovalPdf({
        date_from: dateFrom,
        date_to: dateTo,
        sort_by: sortBy,
        dosage_form: dosageForm
      });

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `shelf_removal_picklist_${sortBy}_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toastEvent.trigger('Shelf Removal Pick-List PDF downloaded successfully!', 'success', '/expiry');
      onClose();
    } catch (err: any) {
      console.error('Failed to download shelf removal PDF:', err);
      toastEvent.trigger('Failed to generate shelf removal PDF.', 'error', '/expiry');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSendWhatsApp = async () => {
    setIsSendingWa(true);
    try {
      const res = await api.sendShelfRemovalWhatsApp({
        date_from: dateFrom,
        date_to: dateTo,
        sort_by: sortBy,
        dosage_form: dosageForm,
        phone: customPhone.trim() || undefined
      });

      if (res.success) {
        toastEvent.trigger(res.message || 'Pick-list PDF queued for WhatsApp dispatch!', 'success', '/expiry');
        onClose();
      } else {
        toastEvent.trigger(res.message || 'No items found or failed to dispatch.', 'info', '/expiry');
      }
    } catch (err: any) {
      console.error('Failed to send shelf removal PDF to WhatsApp:', err);
      const errMsg = err?.response?.data?.error || err.message || 'Failed to dispatch via WhatsApp';
      toastEvent.trigger(errMsg, 'error', '/expiry');
    } finally {
      setIsSendingWa(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div 
        className="w-full max-w-lg rounded-2xl bg-bg2 border border-border shadow-2xl overflow-hidden flex flex-col text-text"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border bg-bg3/40 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <CheckSquare size={18} />
            </div>
            <div>
              <h2 className="text-sm font-black text-text tracking-wide">Shelf Removal Pick-List PDF</h2>
              <p className="text-[11px] text-muted font-medium">Print or send a checklist with physical checkboxes to pull expired stock</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 flex flex-col gap-4 overflow-y-auto max-h-[75vh]">
          {/* 1. Sorting Order */}
          <div>
            <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-2">
              1. Shelf Arrangement / Sorting Order
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'alphabetical', label: 'Alphabetical (A → Z)', desc: 'Store organized by brand name', icon: SortAsc },
                { id: 'company', label: 'Company-wise', desc: 'Grouped by manufacturer / company', icon: Building2 },
                { id: 'rack', label: 'Rack / Shelf Location', desc: 'Order by physical shelf rack', icon: MapPin },
                { id: 'expiry_date', label: 'Expiry Date', desc: 'Earliest expiring batches first', icon: Calendar }
              ].map(opt => {
                const Icon = opt.icon;
                const isSelected = sortBy === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSortBy(opt.id as any)}
                    className={`p-3 rounded-xl border text-left transition-all flex flex-col gap-1 cursor-pointer ${
                      isSelected 
                        ? 'bg-primary/10 border-primary text-text shadow-sm ring-1 ring-primary/30' 
                        : 'bg-bg3/50 border-border text-muted hover:text-text hover:bg-bg3'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Icon size={14} className={isSelected ? 'text-primary' : 'text-muted'} />
                      <span className="text-xs font-bold">{opt.label}</span>
                    </div>
                    <span className="text-[10px] text-muted">{opt.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Dosage Form Filter */}
          <div>
            <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-2">
              2. Dosage Form Scope
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'all', label: 'All Dosage Forms', desc: 'All inventory forms' },
                { id: 'solid', label: 'Solid Only', desc: 'Tablets, Capsules, Strips' },
                { id: 'liquid', label: 'Liquid Only', desc: 'Syrups, Suspensions, Drops' }
              ].map(opt => {
                const isSelected = dosageForm === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setDosageForm(opt.id as any)}
                    className={`p-2.5 rounded-xl border text-left transition-all flex flex-col gap-0.5 cursor-pointer ${
                      isSelected 
                        ? 'bg-primary/10 border-primary text-text shadow-sm ring-1 ring-primary/30' 
                        : 'bg-bg3/50 border-border text-muted hover:text-text hover:bg-bg3'
                    }`}
                  >
                    <span className="text-xs font-bold">{opt.label}</span>
                    <span className="text-[10px] text-muted">{opt.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Date Range Window */}
          <div>
            <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-2">
              3. Date Range Window
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[10px] text-muted block mb-1">From Date</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl bg-bg border border-border text-xs text-text focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <span className="text-[10px] text-muted block mb-1">To Date</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl bg-bg border border-border text-xs text-text focus:outline-none focus:border-primary"
                />
              </div>
            </div>
          </div>

          {/* 4. Optional WhatsApp Target Override */}
          <div>
            <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-1">
              WhatsApp Recipient Phone (Optional Override)
            </label>
            <input
              type="text"
              placeholder="Leave blank to use default Store / Owner phone number"
              value={customPhone}
              onChange={e => setCustomPhone(e.target.value)}
              className="w-full px-3 py-1.5 rounded-xl bg-bg border border-border text-xs text-text placeholder:text-muted/60 focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-border bg-bg3/40 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-bg3 text-text hover:bg-bg3/80 text-xs font-bold cursor-pointer transition-colors"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSendWhatsApp}
              disabled={isSendingWa || isDownloading}
              className="px-4 py-2 rounded-xl bg-green hover:bg-green/90 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-all shadow-sm"
            >
              {isSendingWa ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Queuing WhatsApp...</span>
                </>
              ) : (
                <>
                  <Send size={14} />
                  <span>Send to WhatsApp</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={isDownloading || isSendingWa}
              className="px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-all shadow-sm"
            >
              {isDownloading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Generating PDF...</span>
                </>
              ) : (
                <>
                  <FileDown size={14} />
                  <span>Download / Print PDF</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
