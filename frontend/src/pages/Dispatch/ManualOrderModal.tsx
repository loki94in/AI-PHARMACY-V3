import React from 'react';
import { PhoneCall, RefreshCw, Plus } from 'lucide-react';
import { BaseModal } from '../../components/common/BaseModal';

interface ManualOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  manualDistributorName?: string;
  distributorName?: string;
  setManualDistributorName?: (val: string) => void;
  setDistributorName?: (val: string) => void;
  manualDistributorPhone?: string;
  distributorPhone?: string;
  setManualDistributorPhone?: (val: string) => void;
  setDistributorPhone?: (val: string) => void;
  manualDeliveryBoyId?: number | null;
  deliveryBoyId?: number | null;
  setManualDeliveryBoyId?: (val: number | null) => void;
  setDeliveryBoyId?: (val: number | null) => void;
  deliveryBoys: Array<{ id: number; name: string }>;
  onCreateManualOrder?: () => void;
  onSave?: () => void;
  savingManualOrder?: boolean;
  saving?: boolean;
}

export const ManualOrderModal: React.FC<ManualOrderModalProps> = ({
  isOpen,
  onClose,
  manualDistributorName: rawManualDistName,
  distributorName,
  setManualDistributorName: rawSetManualDistName,
  setDistributorName,
  manualDistributorPhone: rawManualDistPhone,
  distributorPhone,
  setManualDistributorPhone: rawSetManualDistPhone,
  setDistributorPhone,
  manualDeliveryBoyId: rawManualDelBoyId,
  deliveryBoyId,
  setManualDeliveryBoyId: rawSetManualDelBoyId,
  setDeliveryBoyId,
  deliveryBoys,
  onCreateManualOrder: rawOnCreate,
  onSave,
  savingManualOrder: rawSavingManual,
  saving,
}) => {
  const manualDistributorName = rawManualDistName ?? distributorName ?? '';
  const setManualDistributorName = rawSetManualDistName ?? setDistributorName ?? (() => {});
  const manualDistributorPhone = rawManualDistPhone ?? distributorPhone ?? '';
  const setManualDistributorPhone = rawSetManualDistPhone ?? setDistributorPhone ?? (() => {});
  const manualDeliveryBoyId = rawManualDelBoyId ?? deliveryBoyId ?? null;
  const setManualDeliveryBoyId = rawSetManualDelBoyId ?? setDeliveryBoyId ?? (() => {});
  const onCreateManualOrder = rawOnCreate ?? onSave ?? (() => {});
  const savingManualOrder = rawSavingManual ?? saving ?? false;
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2 text-base font-bold text-text">
          <PhoneCall className="text-emerald-400" size={18} />
          <span>Record Phone Call Order Reminder</span>
        </div>
      }
      maxWidth="max-w-md"
      footer={
        <div className="flex justify-end gap-2 w-full">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-bg3 hover:bg-bg3/80 text-muted font-bold text-xs cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onCreateManualOrder}
            disabled={savingManualOrder}
            className="px-4 py-2 rounded-xl bg-emerald-500 text-white font-bold text-xs hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer shadow-md"
          >
            {savingManualOrder ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
            <span>Add Phone Order</span>
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-muted">
          Add a distributor order placed via personal phone call. The system will track and trigger dispatch reminders automatically if no stock email or invoice is received.
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold text-text block mb-1">Distributor Name *</label>
            <input
              type="text"
              value={manualDistributorName}
              onChange={e => setManualDistributorName(e.target.value)}
              placeholder="e.g. Apex Pharma"
              className="w-full px-3 py-2 rounded-xl bg-bg text-text text-xs border border-glass-border focus:outline-none focus:border-emerald-400/60 font-medium"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-text block mb-1">Distributor Phone (WhatsApp)</label>
            <input
              type="text"
              value={manualDistributorPhone}
              onChange={e => setManualDistributorPhone(e.target.value)}
              placeholder="e.g. 9876543210"
              className="w-full px-3 py-2 rounded-xl bg-bg text-text text-xs border border-glass-border focus:outline-none focus:border-emerald-400/60 font-mono"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-text block mb-1">Assigned Delivery Staff</label>
            <select
              value={manualDeliveryBoyId || ''}
              onChange={e => setManualDeliveryBoyId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 rounded-xl bg-bg text-text text-xs border border-glass-border focus:outline-none font-medium cursor-pointer"
            >
              <option value="">👤 Unassigned / Store Admin</option>
              {deliveryBoys.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </BaseModal>
  );
};
