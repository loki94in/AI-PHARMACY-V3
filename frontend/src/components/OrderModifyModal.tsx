import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Plus,
  Trash2,
  Search,
  ShoppingBag,
  Check,
  AlertCircle,
  MessageSquare,
  RefreshCw,
  Edit3
} from 'lucide-react';
import { api } from '../services/api';
import { toastEvent } from '../services/events';

export interface OrderItemLine {
  id?: number;
  medicine_id?: number | null;
  product_name: string;
  requested_qty: number;
  mrp: number;
  sell_price: number;
  subtotal: number;
  isNew?: boolean;
}

interface OrderModifyModalProps {
  order: any;
  onClose: () => void;
  onSuccess: () => void;
}

export const OrderModifyModal: React.FC<OrderModifyModalProps> = ({
  order,
  onClose,
  onSuccess
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<OrderItemLine[]>([]);
  const [removedItemIds, setRemovedItemIds] = useState<number[]>([]);
  const [notes, setNotes] = useState(order?.notes || '');
  const [advancePayment, setAdvancePayment] = useState<number | string>(
    order?.advance_payment !== undefined && order?.advance_payment !== null ? order.advance_payment : ''
  );
  const [sendWhatsApp, setSendWhatsApp] = useState(Boolean(order?.phone && String(order.phone).replace(/\D/g, '').length >= 10));

  // Search state for adding new items
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Fetch current items on mount
  useEffect(() => {
    let isMounted = true;
    const loadItems = async () => {
      try {
        setLoading(true);
        const res = await api.getOrderItems(order.id);
        if (isMounted && res?.items) {
          setItems(
            res.items.map((it: any) => ({
              id: it.id && it.id > 0 ? it.id : undefined,
              medicine_id: it.medicine_id || null,
              product_name: it.product_name || order.product || 'Medicine',
              requested_qty: Math.max(1, Number(it.requested_qty || it.qty || 1)),
              mrp: Number(it.mrp || 0),
              sell_price: Number(it.sell_price !== undefined ? it.sell_price : (it.mrp || 0)),
              subtotal: Number(it.subtotal || 0) || (Math.max(1, Number(it.requested_qty || 1)) * Number(it.sell_price || it.mrp || 0))
            }))
          );
        }
      } catch (err) {
        console.warn('[OrderModifyModal] Failed to load items:', err);
        if (isMounted) {
          // Fallback to order header
          setItems([
            {
              id: undefined,
              medicine_id: order.medicine_id || null,
              product_name: order.medicine_name || order.product || 'Medicine',
              requested_qty: order.qty || 1,
              mrp: order.pharmarack_mrp || 0,
              sell_price: order.pharmarack_rate || order.advance_payment || order.pharmarack_mrp || 0,
              subtotal: (order.qty || 1) * (order.pharmarack_rate || order.advance_payment || order.pharmarack_mrp || 0)
            }
          ]);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadItems();
    return () => {
      isMounted = false;
    };
  }, [order.id, order.medicine_id, order.medicine_name, order.product, order.qty, order.pharmarack_mrp, order.pharmarack_rate, order.advance_payment]);

  // Debounced search for adding new medicine
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.searchMedicines(q, 10);
        const list = res?.data || [];
        setSearchResults(list);
        setShowSearchDropdown(true);
      } catch (_) {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Click outside listener for search dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowSearchDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Update line item quantity
  const handleUpdateQty = (index: number, newQty: number) => {
    const validQty = Math.max(1, newQty);
    setItems(prev => {
      const updated = [...prev];
      const item = { ...updated[index] };
      item.requested_qty = validQty;
      item.subtotal = validQty * (item.sell_price || item.mrp || 0);
      updated[index] = item;
      return updated;
    });
  };

  // Update line item price
  const handleUpdatePrice = (index: number, newPrice: number) => {
    const validPrice = Math.max(0, newPrice);
    setItems(prev => {
      const updated = [...prev];
      const item = { ...updated[index] };
      item.sell_price = validPrice;
      item.subtotal = item.requested_qty * validPrice;
      updated[index] = item;
      return updated;
    });
  };

  // Delete line item
  const handleDeleteItem = (index: number) => {
    if (items.length <= 1) {
      toastEvent.trigger('An order must have at least one medicine item.', 'error');
      return;
    }
    const itemToDelete = items[index];
    if (itemToDelete.id && itemToDelete.id > 0) {
      setRemovedItemIds(prev => [...prev, itemToDelete.id!]);
    }
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  // Add selected medicine from search
  const handleSelectMedicine = (med: any) => {
    const price = Number(med.mrp || 0);
    const newItem: OrderItemLine = {
      medicine_id: med.id,
      product_name: med.name,
      requested_qty: 1,
      mrp: price,
      sell_price: price,
      subtotal: price,
      isNew: true
    };
    setItems(prev => [...prev, newItem]);
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchDropdown(false);
    toastEvent.trigger(`Added "${med.name}" to order`, 'success');
  };

  // Add custom manual item if not found in catalog
  const handleAddCustomItem = () => {
    const name = searchQuery.trim();
    if (!name) return;
    const newItem: OrderItemLine = {
      product_name: name,
      requested_qty: 1,
      mrp: 0,
      sell_price: 0,
      subtotal: 0,
      isNew: true
    };
    setItems(prev => [...prev, newItem]);
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchDropdown(false);
    toastEvent.trigger(`Added "${name}" to order`, 'success');
  };

  // Calculated totals
  const totalAmount = useMemo(() => {
    return items.reduce((sum, it) => sum + (Number(it.subtotal) || 0), 0);
  }, [items]);

  const totalUnits = useMemo(() => {
    return items.reduce((sum, it) => sum + (Number(it.requested_qty) || 1), 0);
  }, [items]);

  // Submit changes
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (items.length === 0) {
      toastEvent.trigger('Please include at least one medicine item.', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        items: items.map(it => ({
          id: it.id,
          medicine_id: it.medicine_id,
          product_name: it.product_name.trim(),
          requested_qty: it.requested_qty,
          mrp: it.mrp,
          sell_price: it.sell_price
        })),
        removed_item_ids: removedItemIds,
        notes: notes.trim(),
        send_whatsapp: sendWhatsApp,
        advance_payment: advancePayment !== '' ? Number(advancePayment) : undefined
      };

      const res = await api.updateOrderItems(order.id, payload);
      if (res?.success) {
        toastEvent.trigger(
          sendWhatsApp
            ? `Order #${order.id} updated & customer notified on WhatsApp!`
            : `Order #${order.id} updated successfully!`,
          'success'
        );
        onSuccess();
        onClose();
      } else {
        toastEvent.trigger(res?.message || 'Failed to update order', 'error');
      }
    } catch (err: any) {
      toastEvent.trigger(err?.response?.data?.error || err?.message || 'Failed to update order', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-global-modal bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-bg border border-border rounded-2xl max-w-2xl w-full p-5 space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[92vh] text-left">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border/60 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Edit3 size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-text">
                  Modify Order #{order.so_code || `SO-TMSA-${order.id}`}
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                  {order.status || 'Pending'}
                </span>
              </div>
              <p className="text-xs text-muted">
                {order.requester || 'Customer'} {order.phone ? `• ${order.phone}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg2 cursor-pointer transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        {loading ? (
          <div className="py-16 text-center text-muted flex flex-col items-center justify-center gap-2">
            <RefreshCw size={24} className="animate-spin text-primary" />
            <span className="text-xs">Loading order items...</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden space-y-4">
            {/* Search and Add Item Section */}
            <div className="space-y-1.5" ref={searchContainerRef}>
              <label className="text-xs font-bold text-text flex items-center gap-1.5">
                <Plus size={13} className="text-primary" />
                <span>Add Medicine to Order</span>
              </label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search catalog by medicine name (e.g. Paracetamol, Telma)..."
                  className="w-full pl-9 pr-20 py-2 text-xs bg-bg2 border border-border rounded-xl text-text placeholder:text-muted/60 focus:outline-none focus:border-primary"
                />
                {searchQuery.trim() && (
                  <button
                    type="button"
                    onClick={handleAddCustomItem}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-primary hover:bg-primary/90 text-white text-[10px] font-bold transition-all cursor-pointer"
                  >
                    + Add Custom
                  </button>
                )}

                {/* Dropdown Results */}
                {showSearchDropdown && (
                  <div className="absolute z-dropdown left-0 right-0 top-full mt-1 bg-bg border border-border rounded-xl shadow-xl max-h-48 overflow-y-auto divide-y divide-border/60">
                    {searching ? (
                      <div className="p-3 text-center text-xs text-muted animate-pulse">Searching catalog...</div>
                    ) : searchResults.length > 0 ? (
                      searchResults.map((med) => (
                        <div
                          key={med.id}
                          onClick={() => handleSelectMedicine(med)}
                          className="p-2.5 hover:bg-bg2 cursor-pointer flex items-center justify-between text-xs transition-colors"
                        >
                          <div className="min-w-0 pr-2">
                            <div className="font-bold text-text truncate">{med.name}</div>
                            <div className="text-[10px] text-muted truncate">
                              {med.generic_name || med.manufacturer || 'Medicine'}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-bold text-primary">₹{Number(med.mrp || 0).toFixed(2)}</div>
                            <span className="text-[9px] text-muted">Click to add</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="p-3 text-center text-xs text-muted flex items-center justify-between">
                        <span>No catalog matches found.</span>
                        <button
                          type="button"
                          onClick={handleAddCustomItem}
                          className="text-primary font-bold hover:underline"
                        >
                          Add as custom item
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Line Items Table */}
            <div className="flex-1 overflow-y-auto border border-border rounded-xl bg-bg2/40 divide-y divide-border/60">
              <div className="bg-bg3/60 px-3 py-2 text-[10px] font-bold text-muted uppercase tracking-wider grid grid-cols-12 gap-2">
                <span className="col-span-5 sm:col-span-6">Medicine / Product</span>
                <span className="col-span-3 sm:col-span-2 text-center">Qty</span>
                <span className="col-span-2 text-right">Price</span>
                <span className="col-span-2 text-right">Action</span>
              </div>

              {items.map((item, idx) => (
                <div key={idx} className="p-2.5 grid grid-cols-12 gap-2 items-center text-xs">
                  {/* Medicine Name */}
                  <div className="col-span-5 sm:col-span-6">
                    <span className="font-bold text-text block truncate" title={item.product_name}>
                      {item.product_name}
                    </span>
                    {item.isNew && (
                      <span className="text-[9px] font-bold text-emerald-500 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20 inline-block">
                        New
                      </span>
                    )}
                  </div>

                  {/* Quantity Stepper */}
                  <div className="col-span-3 sm:col-span-2 flex items-center justify-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleUpdateQty(idx, item.requested_qty - 1)}
                      disabled={item.requested_qty <= 1}
                      className="w-6 h-6 rounded-lg bg-bg border border-border flex items-center justify-center text-text hover:bg-bg3 disabled:opacity-40 cursor-pointer font-bold"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={item.requested_qty}
                      onChange={(e) => handleUpdateQty(idx, parseInt(e.target.value, 10) || 1)}
                      className="w-10 text-center font-bold text-xs bg-bg border border-border rounded-lg py-0.5 text-text focus:outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      onClick={() => handleUpdateQty(idx, item.requested_qty + 1)}
                      className="w-6 h-6 rounded-lg bg-bg border border-border flex items-center justify-center text-text hover:bg-bg3 cursor-pointer font-bold"
                    >
                      +
                    </button>
                  </div>

                  {/* Unit Price */}
                  <div className="col-span-2 flex items-center justify-end">
                    <span className="text-muted text-[10px] mr-1">₹</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={item.sell_price}
                      onChange={(e) => handleUpdatePrice(idx, parseFloat(e.target.value) || 0)}
                      className="w-16 text-right font-bold text-xs bg-bg border border-border rounded-lg px-1.5 py-0.5 text-text focus:outline-none focus:border-primary"
                    />
                  </div>

                  {/* Delete Item */}
                  <div className="col-span-2 flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => handleDeleteItem(idx)}
                      disabled={items.length <= 1}
                      title={items.length <= 1 ? 'An order must contain at least 1 medicine' : 'Remove item from order'}
                      className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Notes & Summary Bar */}
            <div className="space-y-3 pt-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-muted block mb-1">Pharmacist / Order Notes</label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Customer requested dose change / Added Dolo 650"
                    className="w-full px-3 py-1.5 text-xs bg-bg2 border border-border rounded-xl text-text placeholder:text-muted/60 focus:outline-none focus:border-primary"
                  />
                </div>

                <div className="p-3 bg-bg2 rounded-xl border border-border flex flex-col justify-between space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted">Total Medicines:</span>
                    <span className="font-bold text-text">{items.length} items ({totalUnits} units)</span>
                  </div>
                  <div className="flex items-center justify-between text-xs border-t border-border/60 pt-1.5">
                    <span className="font-bold text-text">Updated Total:</span>
                    <span className="text-base font-black text-primary">₹{totalAmount.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Human-in-the-Loop WhatsApp Notification Toggle */}
              {order.phone && (
                <div className="p-2.5 rounded-xl bg-primary/5 border border-primary/20 flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-text">
                    <input
                      type="checkbox"
                      checked={sendWhatsApp}
                      onChange={(e) => setSendWhatsApp(e.target.checked)}
                      className="rounded border-border text-primary focus:ring-primary w-4 h-4 cursor-pointer"
                    />
                    <span className="font-semibold flex items-center gap-1.5">
                      <MessageSquare size={13} className="text-primary" />
                      <span>Send updated bill & item summary to customer on WhatsApp</span>
                    </span>
                  </label>
                  <span className="text-[10px] text-muted">{order.phone}</span>
                </div>
              )}
            </div>

            {/* Footer Buttons */}
            <div className="pt-2 flex items-center justify-between border-t border-border/60">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-bg2 hover:bg-bg3 border border-border text-xs font-bold text-muted hover:text-text cursor-pointer transition-colors"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={saving || items.length === 0}
                className="px-5 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-all"
              >
                {saving ? (
                  <>
                    <RefreshCw size={13} className="animate-spin" />
                    <span>Saving Changes...</span>
                  </>
                ) : (
                  <>
                    <Check size={14} />
                    <span>Save Order Changes (₹{totalAmount.toFixed(2)})</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
export default OrderModifyModal;
