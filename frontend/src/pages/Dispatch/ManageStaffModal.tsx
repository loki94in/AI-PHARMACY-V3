import React from 'react';
import { User, Plus, Trash2, Edit3 } from 'lucide-react';
import { BaseModal } from '../../components/common';

export interface DeliveryBoy {
  id: number;
  name: string;
  whatsapp_number?: string;
  is_active: number;
}

interface ManageStaffModalProps {
  isOpen: boolean;
  onClose: () => void;
  allBoys: DeliveryBoy[];
  newBoyName: string;
  setNewBoyName: (val: string) => void;
  newBoyPhone: string;
  setNewBoyPhone: (val: string) => void;
  handleAddDeliveryBoy: (e: React.FormEvent) => void;
  addingBoy: boolean;
  editingBoyId: number | null;
  setEditingBoyId: (id: number | null) => void;
  editBoyName: string;
  setEditBoyName: (val: string) => void;
  editBoyPhone: string;
  setEditBoyPhone: (val: string) => void;
  handleSaveBoyEdit: (id: number) => void;
  savingBoyEdit: boolean;
  handleToggleBoyActive: (boy: DeliveryBoy) => void;
  handleDeleteBoy: (id: number, name: string) => void;
  sanitizePhoneInput: (val: string) => string;
}

export const ManageStaffModal: React.FC<ManageStaffModalProps> = ({
  isOpen,
  onClose,
  allBoys,
  newBoyName,
  setNewBoyName,
  newBoyPhone,
  setNewBoyPhone,
  handleAddDeliveryBoy,
  addingBoy,
  editingBoyId,
  setEditingBoyId,
  editBoyName,
  setEditBoyName,
  editBoyPhone,
  setEditBoyPhone,
  handleSaveBoyEdit,
  savingBoyEdit,
  handleToggleBoyActive,
  handleDeleteBoy,
  sanitizePhoneInput,
}) => {
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Delivery Personnel Management"
      maxWidth="max-w-lg"
    >
      <div className="space-y-4 max-h-[70vh] flex flex-col overflow-hidden">
        {/* Quick Add Form inside modal */}
        <form onSubmit={handleAddDeliveryBoy} className="p-3.5 bg-bg2/80 rounded-xl border border-glass-border space-y-2 shrink-0">
          <p className="text-xs font-bold text-sky uppercase tracking-wider">Add New Staff Member</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Staff Name *"
              className="premium-input w-full text-xs"
              value={newBoyName}
              onChange={e => setNewBoyName(e.target.value)}
            />
            <input
              type="text"
              placeholder="WhatsApp Phone (10 digits)"
              maxLength={10}
              className="premium-input w-full text-xs font-mono"
              value={newBoyPhone}
              onChange={e => setNewBoyPhone(sanitizePhoneInput(e.target.value).slice(0, 10))}
            />
          </div>
          <button
            type="submit"
            disabled={addingBoy}
            className="w-full bg-sky hover:bg-sky-400 text-slate-900 text-xs font-bold py-2 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
          >
            <Plus size={14} /> {addingBoy ? 'Saving...' : 'Add Delivery Staff'}
          </button>
        </form>

        {/* Personnel List */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
          <p className="text-xs font-bold text-muted uppercase tracking-wider">All Personnel ({allBoys.length})</p>
          {allBoys.length === 0 ? (
            <div className="p-6 text-center text-muted text-xs border border-dashed border-glass-border rounded-xl">
              No personnel registered yet.
            </div>
          ) : (
            allBoys.map(boy => (
              <div key={boy.id} className="p-3 rounded-xl bg-bg border border-glass-border hover:border-sky/40 transition-all">
                {editingBoyId === boy.id ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={editBoyName}
                        onChange={e => setEditBoyName(e.target.value)}
                        className="premium-input w-full text-xs font-bold"
                      />
                      <input
                        type="text"
                        placeholder="10-digit mobile"
                        maxLength={10}
                        value={editBoyPhone}
                        onChange={e => setEditBoyPhone(sanitizePhoneInput(e.target.value).slice(0, 10))}
                        className="premium-input w-full text-xs font-mono"
                      />
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleSaveBoyEdit(boy.id)}
                        disabled={savingBoyEdit}
                        className="px-3 py-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs rounded-lg transition-all cursor-pointer"
                      >
                        Save Phone
                      </button>
                      <button
                        onClick={() => setEditingBoyId(null)}
                        className="px-3 py-1 bg-bg3 border border-glass-border text-muted hover:text-text text-xs rounded-lg transition-all cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-text">{boy.name}</span>
                        <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                          boy.is_active ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                        }`}>
                          {boy.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-muted flex items-center gap-2">
                        <span>📞 {boy.whatsapp_number || 'No phone set'}</span>
                        {boy.whatsapp_number && boy.whatsapp_number.replace(/\D/g, '').length !== 10 && (
                          <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 rounded font-bold">
                            ⚠️ Needs 10 digits ({boy.whatsapp_number.replace(/\D/g, '').length}/10)
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          setEditingBoyId(boy.id);
                          setEditBoyName(boy.name);
                          setEditBoyPhone(boy.whatsapp_number || '');
                        }}
                        className="p-1.5 rounded-lg hover:bg-sky/20 text-sky border border-transparent hover:border-sky/30 transition-all cursor-pointer"
                        title="Edit Phone / Details"
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        onClick={() => handleToggleBoyActive(boy)}
                        className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                          boy.is_active
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
                            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                        }`}
                      >
                        {boy.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        onClick={() => handleDeleteBoy(boy.id, boy.name)}
                        className="p-1.5 rounded-lg hover:bg-rose-500/20 text-rose-400 border border-transparent hover:border-rose-500/30 transition-all cursor-pointer"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="pt-2 shrink-0 border-t border-glass-border flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-bg3/60 border border-glass-border text-xs text-muted hover:text-text font-bold rounded-xl transition-all cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </BaseModal>
  );
};
