import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { UserCheck, Receipt, Tag, Scale, Wallet, Zap, CheckCircle, X, Banknote, ArrowRight } from 'lucide-react';
import { formatINR } from '../../utils/currency';

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
  const [showCashModal, setShowCashModal] = useState(false);
  const [cashTendered, setCashTendered] = useState<number | ''>('');
  // grandTotal is the saved, whole-rupee bill amount; this is only the shown difference from the exact total.
  const roundOff = grandTotal - (subtotal - discountAmount);
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

      {/* Section 2: Bill Breakdown (icon-first chips) */}
      <div className="flex items-center gap-2 border-r border-glass-border/30 pr-2.5 shrink-0">
        {/* Subtotal chip */}
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-bg3/60 border border-glass-border/40" title="Gross Subtotal">
          <Receipt size={12} className="text-muted shrink-0" />
          <span className="font-mono font-bold text-text text-xs">₹{formatINR(subtotal)}</span>
        </div>

        {/* Discount chip */}
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20" title="Bill Discount % and Calculated Savings">
          <Tag size={12} className="text-amber-500 shrink-0" />
          <div className="flex items-center gap-0.5">
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
              className="w-10 bg-bg border border-glass-border rounded px-1 py-0.5 font-mono font-bold text-center text-text text-xs focus:outline-none focus:border-primary/50 h-5"
            />
            <span className="text-[10px] text-amber-500 font-bold">%</span>
          </div>
          {discountAmount > 0 && (
            <span className="font-mono font-bold text-amber-500 text-xs">-₹{formatINR(discountAmount)}</span>
          )}
        </div>

        {/* Round-off chip */}
        {Math.abs(roundOff) >= 0.005 && (
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-bg3/60 border border-glass-border/40" title="Round-off to nearest rupee">
            <Scale size={11} className="text-muted shrink-0" />
            <span className="text-[11px] text-muted font-mono">
              {roundOff > 0 ? '+' : '-'}{formatINR(Math.abs(roundOff))}
            </span>
          </div>
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
            onClick={() => {
              setPaymentMedium(pm.id);
              if (pm.id === 'CASH' && cartLength > 0) {
                setCashTendered(grandTotal);
                setShowCashModal(true);
              }
            }}
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

      {/* Section 4: Net Payable (compact icon-first badge) */}
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-primary/10 border border-primary/30 shrink-0 shadow-xs" title="Net Payable Total">
        <Wallet size={15} className="text-primary shrink-0" />
        <span className="text-xl font-black font-mono text-primary leading-none">₹{formatINR(grandTotal)}</span>
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

      {/* Cash Payment Settlement & Change Return Modal */}
      {showCashModal && createPortal(
        <div
          className="fixed inset-0 bg-black/60 z-global-modal flex items-center justify-center p-4 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setShowCashModal(false)}
        >
          <div
            className="w-full max-w-md bg-bg2 border border-border rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.24)] p-5 animate-in zoom-in-95 duration-150 flex flex-col gap-4 text-text"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-green/15 border border-green/30 flex items-center justify-center text-green">
                  <Banknote size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-text">Cash Payment Settlement</h3>
                  <p className="text-xs text-muted">Customer cash tender and change return</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCashModal(false)}
                className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Total Due Banner */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-bg3 border border-border">
              <span className="text-xs font-semibold text-muted uppercase tracking-wider">Total Payable</span>
              <span className="text-2xl font-black font-mono text-primary">₹{formatINR(grandTotal)}</span>
            </div>

            {/* Cash Received Input */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pos-cash-tender-input" className="text-xs font-bold text-text flex items-center justify-between">
                <span>Cash Received from Customer (₹)</span>
                {typeof cashTendered === 'number' && cashTendered > grandTotal && (
                  <span className="text-xs font-mono font-bold text-green">
                    Change: ₹{formatINR(cashTendered - grandTotal)}
                  </span>
                )}
              </label>
              <input
                id="pos-cash-tender-input"
                type="number"
                autoFocus
                value={cashTendered === '' ? '' : cashTendered}
                onChange={e => setCashTendered(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setShowCashModal(false);
                    onCompleteSale(false);
                  } else if (e.key === 'Escape') {
                    setShowCashModal(false);
                  }
                }}
                placeholder="Enter received cash"
                className="w-full bg-bg border border-border focus:border-green focus:ring-1 focus:ring-green rounded-xl px-3 py-2.5 font-mono text-lg font-bold text-text outline-none transition-all"
              />

              {/* Quick Cash Presets */}
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                {[
                  { label: `Exact (₹${formatINR(grandTotal)})`, val: grandTotal },
                  { label: '₹100', val: 100 },
                  { label: '₹200', val: 200 },
                  { label: '₹500', val: 500 },
                  { label: '₹2,000', val: 2000 }
                ].filter(p => p.val >= grandTotal || p.val === grandTotal).map(preset => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setCashTendered(preset.val)}
                    className="px-2.5 py-1 text-xs font-bold font-mono rounded-lg bg-bg3 border border-glass-border/50 text-text hover:bg-bg hover:border-green/40 transition-all cursor-pointer"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Change Return Card */}
            {typeof cashTendered === 'number' && cashTendered >= grandTotal && (
              <div className="flex items-center justify-between p-3 rounded-xl bg-green/10 border border-green/30">
                <div className="flex items-center gap-2">
                  <ArrowRight size={16} className="text-green" />
                  <span className="text-xs font-bold text-green uppercase tracking-wider">Return Change to Customer</span>
                </div>
                <span className="text-xl font-black font-mono text-green">
                  ₹{formatINR(cashTendered - grandTotal)}
                </span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setShowCashModal(false)}
                className="px-3.5 py-2 rounded-xl text-xs font-bold text-muted hover:text-text hover:bg-bg3 border border-border transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCashModal(false);
                  onCompleteSale(true);
                }}
                disabled={isSavingBill}
                className="px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-sky/15 border border-sky/30 text-sky hover:bg-sky/25 transition-all cursor-pointer flex items-center gap-1.5"
              >
                <Zap size={14} /> Direct Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCashModal(false);
                  onCompleteSale(false);
                }}
                disabled={isSavingBill}
                className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-green text-white hover:bg-emerald-600 shadow-md transition-all cursor-pointer flex items-center gap-1.5"
              >
                <CheckCircle size={15} /> Save & Print (Enter)
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
