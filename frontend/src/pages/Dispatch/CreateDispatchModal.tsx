import React from 'react';
import { Truck } from 'lucide-react';
import { BaseModal } from '../../components/common/BaseModal';
import { sanitizePhoneInput } from '../../utils/phone';

interface CreateDispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  form: {
    patient_name: string;
    patient_phone: string;
    address: string;
    items: string;
    invoice_no: string;
    delivery_boy_id: string;
    notes: string;
  };
  setForm: React.Dispatch<React.SetStateAction<{
    patient_name: string;
    patient_phone: string;
    address: string;
    items: string;
    invoice_no: string;
    delivery_boy_id: string;
    notes: string;
  }>>;
  deliveryBoys: Array<{ id: number; name: string }>;
  onSubmit: (e: React.FormEvent) => void;
  saving: boolean;
  emptyForm: any;
}

export const CreateDispatchModal: React.FC<CreateDispatchModalProps> = ({
  isOpen,
  onClose,
  form,
  setForm,
  deliveryBoys,
  onSubmit,
  saving,
  emptyForm,
}) => {
  const handleClose = () => {
    onClose();
    setForm(emptyForm);
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title={
        <div className="flex items-center gap-2 text-sm font-bold text-text">
          <Truck size={18} className="text-primary" />
          <span>Create Home Delivery Order</span>
        </div>
      }
      maxWidth="max-w-lg"
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Patient Name *</label>
            <input
              className="premium-input w-full text-xs"
              placeholder="Full Name"
              value={form.patient_name}
              onChange={e => setForm(f => ({ ...f, patient_name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Phone</label>
            <input
              className="premium-input w-full text-xs font-mono"
              placeholder="9876543210"
              value={form.patient_phone}
              onChange={e => setForm(f => ({ ...f, patient_phone: sanitizePhoneInput(e.target.value) }))}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Delivery Address</label>
          <input
            className="premium-input w-full text-xs"
            placeholder="Full street address"
            value={form.address}
            onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Medicines / Items</label>
          <input
            className="premium-input w-full text-xs"
            placeholder="e.g. Paracetamol x2, Amoxicillin x1"
            value={form.items}
            onChange={e => setForm(f => ({ ...f, items: e.target.value }))}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Invoice No</label>
            <input
              className="premium-input w-full text-xs font-mono"
              placeholder="INV-..."
              value={form.invoice_no}
              onChange={e => setForm(f => ({ ...f, invoice_no: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Assign Delivery Staff</label>
            <select
              className="premium-input w-full text-xs font-medium"
              value={form.delivery_boy_id}
              onChange={e => setForm(f => ({ ...f, delivery_boy_id: e.target.value }))}
            >
              <option value="">-- Unassigned --</option>
              {deliveryBoys.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Notes</label>
          <input
            className="premium-input w-full text-xs"
            placeholder="Special instructions..."
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          />
        </div>

        <div className="flex gap-2 pt-3">
          <button
            type="submit"
            disabled={saving}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs py-2.5 rounded-xl flex-1 shadow-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {saving ? 'Creating Order...' : 'Create Dispatch Order'}
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2.5 bg-bg3/60 border border-glass-border text-muted hover:text-text font-bold text-xs rounded-xl transition-all cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </form>
    </BaseModal>
  );
};
