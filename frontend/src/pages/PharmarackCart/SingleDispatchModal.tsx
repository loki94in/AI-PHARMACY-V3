import React from 'react';
import { Truck, MessageSquare } from 'lucide-react';
import { BaseModal } from '../../components/common';

interface CartLineItem {
  productId: number | null;
  storeId: number;
  productCode: string;
  productName: string;
  company: string;
  packaging: string;
  qty: number;
  ptr: number;
  mrp: number;
  scheme: string;
  stock: number | null;
  amount: number;
  cartSource: string;
  isChecked: boolean;
  createdDate: string;
}

interface Distributor {
  storeId: number;
  storeName: string;
  lineTotal: number;
  deliveryPersons: { name: string; code: string }[];
  items: CartLineItem[];
}

interface DeliveryBoyItem {
  id?: number;
  name: string;
  whatsapp_number?: string;
  is_active?: number;
}

interface SingleDispatchModalProps {
  target: Distributor | null;
  onClose: () => void;
  singleDispatchBoyId: number | null;
  setSingleDispatchBoyId: (id: number | null) => void;
  deliveryBoysList: DeliveryBoyItem[];
  isItemIncludedInDispatch: (item: CartLineItem, dist: Distributor) => boolean;
  getDistributorCheckedTotal: (dist: Distributor) => number;
  sendingWaDistributorId: number | null;
  onConfirm: () => void;
  orderNo?: string;
  setOrderNo?: (val: string) => void;
  previewMessage?: string;
}

export const SingleDispatchModal: React.FC<SingleDispatchModalProps> = ({
  target,
  onClose,
  singleDispatchBoyId,
  setSingleDispatchBoyId,
  deliveryBoysList,
  isItemIncludedInDispatch,
  getDistributorCheckedTotal,
  sendingWaDistributorId,
  onConfirm,
  orderNo = '',
  setOrderNo,
  previewMessage = '',
}) => {
  if (!target) return null;

  return (
    <BaseModal
      isOpen={Boolean(target)}
      onClose={onClose}
      title="Dispatch Reminder to Distributor"
      maxWidth="max-w-lg"
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between -mt-2">
          <p className="text-xs text-text font-bold truncate max-w-[280px]">{target.storeName}</p>
          <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
            Official PO Reminder
          </span>
        </div>

        <div className="bg-bg3/40 border border-glass-border rounded-xl p-3 flex items-center justify-between text-xs">
          <div>
            <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Items in Cart</span>
            <span className="text-sm font-extrabold text-text font-mono">
              {target.items.filter(i => isItemIncludedInDispatch(i, target)).length} items
            </span>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Total Cart Value</span>
            <span className="text-sm font-black text-emerald-400 font-mono">
              ₹{getDistributorCheckedTotal(target).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Pharmarack Official Order ID / PO Number */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-text flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              📦 Official Pharmarack Order # / PO ID:
            </span>
            <span className="text-[10px] text-muted font-normal">
              (From Sent PO History or portal checkout)
            </span>
          </label>
          <input
            type="text"
            value={orderNo}
            onChange={(e) => setOrderNo?.(e.target.value)}
            placeholder="e.g. 784512, 784519 (all of today's IDs, comma-separated)"
            className="w-full text-xs px-3 py-2.5 rounded-xl bg-bg border border-glass-border text-text font-mono font-bold focus:outline-none focus:border-emerald-500 transition-all placeholder:text-muted/50"
          />
          <p className="text-[10px] text-muted">
            All of today's Order IDs for this distributor are auto-included (old + new, comma-separated) so one WhatsApp reminder covers every same-day order. Individual medicine items are omitted for privacy and speed.
          </p>
        </div>

        {/* Assigned Delivery Staff */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-text flex items-center gap-1.5">
            <Truck size={13} className="text-primary" /> Delivery / Pickup Staff:
          </label>
          <select
            value={singleDispatchBoyId ?? ''}
            onChange={(e) => setSingleDispatchBoyId(e.target.value ? Number(e.target.value) : null)}
            className="w-full text-xs px-3 py-2.5 rounded-xl bg-bg border border-glass-border text-text font-medium focus:outline-none focus:border-emerald-500 transition-all cursor-pointer"
          >
            <option value="">👤 Unassigned / Store Admin Fallback</option>
            {deliveryBoysList.map((b) => (
              <option key={b.id} value={b.id}>
                👤 {b.name} {b.whatsapp_number ? `(+91 ${b.whatsapp_number.slice(-10)})` : ''}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-muted">
            Assigned pickup contact will be sent to the distributor so warehouse staff can identify your collector.
          </p>
        </div>

        {/* Live Message Preview */}
        {previewMessage && (
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted block">
              WhatsApp Message Preview:
            </span>
            <div className="bg-bg/80 border border-glass-border rounded-xl p-3 text-[11px] text-text/90 font-mono whitespace-pre-wrap leading-relaxed max-h-36 overflow-y-auto custom-scrollbar">
              {previewMessage}
            </div>
          </div>
        )}

        <div className="bg-bg3/60 px-2 py-3 border-t border-glass-border flex items-center justify-between gap-2">
          <p className="text-[10px] text-muted hidden sm:block">
            Distributor gets Order ID reminder; Delivery Staff gets item list for pickup.
          </p>
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-muted hover:text-text hover:bg-bg3 transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={sendingWaDistributorId === target.storeId}
              className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold text-xs flex items-center gap-1.5 transition-all active:scale-95 shadow-md cursor-pointer disabled:opacity-50"
            >
              <MessageSquare size={14} />
              <span>Confirm & Send Reminder</span>
            </button>
          </div>
        </div>
      </div>
    </BaseModal>
  );
};
