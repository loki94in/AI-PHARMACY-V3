import React from 'react';
import { UserCheck, FileText, Zap, CheckCircle } from 'lucide-react';

interface POSCheckoutBarProps {
  patientName: string;
  patientPhone: string;
  selectedCustomerId?: any;
  subtotal: number;
  discount: number;
  setDiscount: (val: number) => void;
  discountAmount: number;
  paymentMedium: string;
  setPaymentMedium: (val: string) => void;
  grandTotal: number;
  cartLength: number;
  isSavingBill: boolean;
  lastInvoiceNo?: string | null;
  onCompleteSale: (directSave: boolean) => void;
}

export const POSCheckoutBar: React.FC<POSCheckoutBarProps> = ({
  patientName,
  patientPhone,
  selectedCustomerId,
  subtotal,
  discount,
  setDiscount,
  discountAmount,
  paymentMedium,
  setPaymentMedium,
  grandTotal,
  cartLength,
  isSavingBill,
  lastInvoiceNo,
  onCompleteSale,
}) => {
  return (
    <div className="shrink-0 w-full flex flex-row items-center gap-2 px-3 py-1.5 bg-bg2/95 border-t border-glass-border/50 shadow-[0_-4px_16px_rgba(0,0,0,0.14)] overflow-x-auto">
      {/* Section 1: Customer (single line) */}
      <div className="flex items-center gap-1.5 min-w-[140px] border-r border-glass-border/30 pr-2.5 shrink-0">
        <UserCheck size={14} className="text-primary shrink-0" />
        <div className="flex flex-col leading-tight">
          <span className="text-xs font-bold text-text truncate max-w-[120px]">{patientName || 'Walk-in'}</span>
          <span className="text-[11px] text-muted font-mono truncate">
            {patientPhone || '—'}
            {patientPhone && <span className="ml-1 text-green font-bold">· WA</span>}
            {selectedCustomerId && <span className="ml-1 text-primary font-bold">· Reg</span>}
          </span>
        </div>
      </div>

      {/* Section 2: Bill Breakdown (single line) */}
      <div className="flex items-center gap-2 min-w-[220px] border-r border-glass-border/30 pr-2.5 shrink-0">
        <FileText size={13} className="text-muted shrink-0" />
        <span className="text-[11px] text-muted">Sub:</span>
        <span className="font-mono font-bold text-text text-xs">₹{Math.round(subtotal)}</span>
        <span className="text-[11px] text-muted ml-1">Disc%</span>
        <input
          id="pos-bill-discount-input"
          name="pos_bill_discount"
          type="number"
          autoComplete="off"
          value={discount === 0 || discount === undefined || discount === null ? '' : discount}
          onChange={e => setDiscount(e.target.value === '' ? 0 : Math.min(100, Math.max(0, Number(e.target.value))))}
          placeholder="0"
          onKeyDown={e => {
            if (e.key === 'Tab' && e.shiftKey) {
              // back to the cart's trailing empty medicine row
              const rows = document.querySelectorAll<HTMLInputElement>('input[id^="row-med-input-"]');
              const last = rows.length > 0 ? rows[rows.length - 1] : null;
              if (last && !last.disabled) { e.preventDefault(); last.focus(); last.select?.(); }
            }
          }}
          className="w-12 bg-bg border border-glass-border rounded px-1.5 py-0.5 font-mono font-bold text-center text-text text-xs focus:outline-none focus:border-primary/50 h-6"
        />
        {discountAmount > 0 && (
          <span className="font-mono font-bold text-amber-500 text-xs">-₹{Math.round(discountAmount)}</span>
        )}
      </div>

      {/* Section 3: Payment Method (single row) */}
      <div className="flex items-center gap-1 border-r border-glass-border/30 pr-2.5 shrink-0">
        {[
          { id: 'CASH', label: '💵 Cash', activeClass: 'bg-green/15 text-green border-green/40' },
          { id: 'UPI', label: '📱 UPI', activeClass: 'bg-primary/15 text-primary border-primary/40' },
          { id: 'CREDIT', label: '📜 Credit', activeClass: 'bg-amber-500/15 text-amber-500 border-amber-500/40' }
        ].map(pm => (
          <button
            key={pm.id}
            type="button"
            onClick={() => setPaymentMedium(pm.id)}
            // one Tab stop for the group (selected mode); ←/→ switch the mode
            tabIndex={paymentMedium === pm.id ? 0 : -1}
            data-pos-payment={pm.id}
            onKeyDown={e => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault();
              const ids = ['CASH', 'UPI', 'CREDIT'];
              const next = ids[(ids.indexOf(pm.id) + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
              setPaymentMedium(next);
              setTimeout(() => document.querySelector<HTMLButtonElement>(`[data-pos-payment="${next}"]`)?.focus(), 0);
            }}
            className={`py-1 px-2 rounded text-[11px] font-extrabold uppercase border text-center transition-all cursor-pointer ${
              paymentMedium === pm.id
                ? `${pm.activeClass} ring-1 ring-primary/20`
                : 'bg-bg3/40 border-glass-border/30 text-muted hover:text-text hover:bg-bg3'
            }`}
          >
            {pm.label}
          </button>
        ))}
      </div>

      {/* Last saved bill (real number from the last sale; hidden until a bill exists) */}
      {lastInvoiceNo && (
        <div className="flex flex-col leading-tight border-r border-glass-border/30 pr-2.5 shrink-0" title="Last saved bill">
          <span className="text-[11px] text-muted">Last bill</span>
          <span className="text-xs font-mono font-bold text-sky">#{lastInvoiceNo}</span>
        </div>
      )}

      {/* Section 4: Net Payable (compact) */}
      <div className="flex items-baseline gap-1.5 px-2.5 py-1 rounded-lg bg-primary/5 border border-primary/20 shrink-0">
        <span className="text-[11px] font-black text-primary uppercase tracking-widest">Total</span>
        <span className="text-xl font-black font-mono text-primary leading-none">₹{grandTotal.toLocaleString()}</span>
      </div>

      {/* Section 5: Action Buttons */}
      <div className="flex items-center gap-1.5 shrink-0 ml-auto">
        <button
          onClick={() => onCompleteSale(true)}
          disabled={cartLength === 0 || isSavingBill}
          className={`py-1.5 px-3.5 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer border ${
            cartLength === 0 || isSavingBill
              ? 'bg-bg3 border-glass-border text-muted cursor-not-allowed'
              : 'bg-sky/15 border-sky/30 text-sky hover:bg-sky/25'
          }`}
        >
          <Zap size={13} /> {isSavingBill ? 'Saving...' : 'Direct Save'}
        </button>
        <button
          onClick={() => onCompleteSale(false)}
          disabled={cartLength === 0 || isSavingBill}
          className={`py-2 px-4.5 rounded-lg text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer shadow-md ${
            cartLength === 0 || isSavingBill
              ? 'bg-bg3 border border-glass-border text-muted cursor-not-allowed'
              : 'bg-green text-white hover:bg-emerald-600 shadow-[0_0_14px_rgba(16,185,129,0.3)] hover:-translate-y-px'
          }`}
        >
          <CheckCircle size={15} />
          {isSavingBill ? 'Saving...' : 'Save & Print (Ctrl+S)'}
        </button>
      </div>
    </div>
  );
};
