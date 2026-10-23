import React from 'react';
import { Package, Zap, AlertTriangle, Layers, CheckCircle2 } from 'lucide-react';
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

interface SingleOrderConfirmModalProps {
  target: Distributor | null;
  onClose: () => void;
  onConfirm: () => void;
  isPlacing: boolean;
  isItemIncludedInDispatch: (item: CartLineItem, dist: Distributor) => boolean;
  getDistributorCheckedTotal: (dist: Distributor) => number;
  limitIssues?: string[];
  assignedBoyName?: string | null;
}

export const SingleOrderConfirmModal: React.FC<SingleOrderConfirmModalProps> = ({
  target,
  onClose,
  onConfirm,
  isPlacing,
  isItemIncludedInDispatch,
  getDistributorCheckedTotal,
  limitIssues = [],
  assignedBoyName
}) => {
  if (!target) return null;

  const itemsToPlace = target.items.filter(item => isItemIncludedInDispatch(item, target));
  const finalItems = itemsToPlace.length > 0 ? itemsToPlace : target.items;
  const totalAmount = getDistributorCheckedTotal(target);

  return (
    <BaseModal
      isOpen={Boolean(target)}
      onClose={onClose}
      title="Finalize & Place Pharmarack Order"
      maxWidth="max-w-xl"
    >
      <div className="space-y-4">
        {/* Distributor Headline */}
        <div className="flex items-center justify-between -mt-2">
          <div className="flex items-center gap-2">
            <Package size={16} className="text-emerald-400" />
            <h4 className="text-sm font-black text-text uppercase tracking-wide truncate max-w-[320px]">
              {target.storeName}
            </h4>
          </div>
          <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
            <Zap size={11} />
            <span>Direct REST API</span>
          </span>
        </div>

        {/* Top Summary Card */}
        <div className="bg-bg3/40 border border-glass-border rounded-xl p-3.5 flex items-center justify-between text-xs">
          <div>
            <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Items to Place</span>
            <span className="text-sm font-extrabold text-text font-mono flex items-center gap-1.5 mt-0.5">
              <Layers size={13} className="text-muted" />
              <span>{finalItems.length} products</span>
            </span>
          </div>

          {assignedBoyName && (
            <div className="text-center px-2">
              <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Assigned Collector</span>
              <span className="text-xs font-bold text-text truncate max-w-[150px] inline-block mt-0.5">
                {assignedBoyName}
              </span>
            </div>
          )}

          <div className="text-right">
            <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Total Payable</span>
            <span className="text-base font-black text-emerald-400 font-mono block mt-0.5">
              ₹{totalAmount.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Warning if order limits have issues */}
        {limitIssues.length > 0 && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-2.5 text-xs text-amber-300">
            <AlertTriangle size={15} className="shrink-0 text-amber-400 mt-0.5" />
            <div>
              <p className="font-bold text-[11px] uppercase tracking-wide text-amber-400">Distributor Order Condition Notice:</p>
              <p className="text-[11px] leading-relaxed mt-0.5">{limitIssues.join(' | ')}</p>
            </div>
          </div>
        )}

        {/* Medicines List Preview */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted">
              Medicines to be ordered:
            </span>
            <span className="text-[10px] font-bold text-muted font-mono">
              {finalItems.reduce((acc, it) => acc + (Number(it.qty) || 1), 0)} total units
            </span>
          </div>

          <div className="bg-bg/80 border border-glass-border rounded-xl max-h-56 overflow-y-auto custom-scrollbar divide-y divide-glass-border/20 text-xs">
            {finalItems.map((item, idx) => {
              const itemTotal = (item.ptr > 0 ? item.ptr : 0) * (item.qty || 1);
              return (
                <div key={item.productCode || idx} className="p-2.5 flex items-center justify-between gap-3 hover:bg-bg3/30 transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="font-extrabold text-text text-[11px] truncate">
                      {item.productName}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-muted mt-0.5">
                      {item.company && <span className="truncate max-w-[120px]">{item.company}</span>}
                      {item.packaging && <span>• {item.packaging}</span>}
                      {item.scheme && <span className="text-emerald-400 font-bold">• Scheme: {item.scheme}</span>}
                    </div>
                  </div>

                  <div className="text-center px-2 shrink-0">
                    <span className="text-[10px] font-bold text-muted block uppercase">Qty</span>
                    <span className="font-mono font-extrabold text-text text-xs bg-bg3/60 px-2 py-0.5 rounded border border-glass-border/40">
                      {item.qty}
                    </span>
                  </div>

                  <div className="text-right shrink-0 min-w-[70px]">
                    <span className="text-[10px] text-muted block font-mono">
                      {item.ptr > 0 ? `₹${item.ptr.toFixed(2)}` : '—'}
                    </span>
                    <span className="font-mono font-black text-text text-xs">
                      {itemTotal > 0 ? `₹${itemTotal.toFixed(2)}` : '—'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Security / Speed Assurance Note */}
        <div className="flex items-center gap-2 px-1 text-[11px] text-muted">
          <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
          <span>Order is placed directly on official Pharmarack server via authenticated REST API (~1 sec).</span>
        </div>

        {/* Actions Footer */}
        <div className="bg-bg3/60 px-2 py-3 border-t border-glass-border flex items-center justify-end gap-2.5 pt-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isPlacing}
            className="px-4 py-2 rounded-xl text-xs font-bold text-muted hover:text-text hover:bg-bg3 transition-all cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPlacing || finalItems.length === 0}
            className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold text-xs flex items-center gap-2 transition-all active:scale-95 shadow-md cursor-pointer disabled:opacity-50"
          >
            {isPlacing ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                <span>Placing Order on Pharmarack...</span>
              </>
            ) : (
              <>
                <Zap size={14} className="fill-current" />
                <span>Confirm & Place Order</span>
              </>
            )}
          </button>
        </div>
      </div>
    </BaseModal>
  );
};
