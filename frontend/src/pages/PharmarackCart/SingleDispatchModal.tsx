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
}) => {
  if (!target) return null;

  return (
    <BaseModal
      isOpen={Boolean(target)}
      onClose={onClose}
      title="Assign Delivery Person"
      maxWidth="max-w-md"
    >
      <div className="space-y-4">
        <p className="text-[11px] text-muted truncate max-w-[340px] -mt-2 font-bold">{target.storeName}</p>

        <div className="bg-bg3/40 border border-glass-border rounded-xl p-3 flex items-center justify-between text-xs">
          <div>
            <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Items to Send</span>
            <span className="text-sm font-extrabold text-text font-mono">
              {target.items.filter(i => isItemIncludedInDispatch(i, target)).length} items
            </span>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Order Value</span>
            <span className="text-sm font-black text-emerald-400 font-mono">
              ₹{getDistributorCheckedTotal(target).toFixed(2)}
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-bold text-text flex items-center gap-1.5">
            <Truck size={13} className="text-primary" /> Delivery Boy for this order:
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
            The selected delivery staff will be included in the order message and assigned to pick up this parcel.
          </p>
        </div>

        <div className="bg-bg3/60 px-2 py-3 border-t border-glass-border flex items-center justify-end gap-2">
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
            <span>Confirm & Send via WhatsApp</span>
          </button>
        </div>
      </div>
    </BaseModal>
  );
};
