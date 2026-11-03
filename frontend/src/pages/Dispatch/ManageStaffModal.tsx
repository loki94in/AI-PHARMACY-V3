import React from 'react';
import { Plus, Trash2, Edit3, Clock } from 'lucide-react';
import { BaseModal } from '../../components/common';

export interface DeliveryBoy {
  id: number;
  name: string;
  whatsapp_number?: string;
  shift_start_time?: string | null;
  shift_end_time?: string | null;
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
  newBoyShiftStart?: string;
  setNewBoyShiftStart?: (val: string) => void;
  newBoyShiftEnd?: string;
  setNewBoyShiftEnd?: (val: string) => void;
  handleAddDeliveryBoy: (e: React.FormEvent) => void;
  addingBoy: boolean;
  editingBoyId: number | null;
  setEditingBoyId: (id: number | null) => void;
  editBoyName: string;
  setEditBoyName: (val: string) => void;
  editBoyPhone: string;
  setEditBoyPhone: (val: string) => void;
  editBoyShiftStart?: string;
  setEditBoyShiftStart?: (val: string) => void;
  editBoyShiftEnd?: string;
  setEditBoyShiftEnd?: (val: string) => void;
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
  newBoyShiftStart = '',
  setNewBoyShiftStart,
  newBoyShiftEnd = '',
  setNewBoyShiftEnd,
  handleAddDeliveryBoy,
  addingBoy,
  editingBoyId,
  setEditingBoyId,
  editBoyName,
  setEditBoyName,
  editBoyPhone,
  setEditBoyPhone,
  editBoyShiftStart = '',
  setEditBoyShiftStart,
  editBoyShiftEnd = '',
  setEditBoyShiftEnd,
  handleSaveBoyEdit,
  savingBoyEdit,
  handleToggleBoyActive,
  handleDeleteBoy,
  sanitizePhoneInput,
}) => {
  const isMultiStaff = allBoys.length >= 1;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Delivery Personnel Management"
      maxWidth="max-w-lg"
    >
      <div className="space-y-4 max-h-[75vh] flex flex-col overflow-hidden">
        {/* Quick Add Form inside modal */}
        <form onSubmit={handleAddDeliveryBoy} className="p-3.5 bg-bg2/80 rounded-xl border border-glass-border space-y-2 shrink-0">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-sky uppercase tracking-wider">Add New Staff Member</p>
            {allBoys.length >= 1 && (
              <span className="text-[10px] text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-full border border-purple-500/20 font-bold">
                Shift Session Enabled
              </span>
            )}
          </div>
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

          {/* Shift Time Inputs activate when there is already 1+ staff member */}
          {isMultiStaff && (
            <div className="p-2 rounded-lg bg-bg/60 border border-glass-border space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-text">
                <Clock size={12} className="text-purple-400" />
                <span>Working Shift Hours (Auto-route orders by time)</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted block mb-0.5 font-medium">Shift Start</label>
                  <input
                    type="time"
                    className="premium-input w-full text-xs"
                    value={newBoyShiftStart}
                    onChange={e => setNewBoyShiftStart && setNewBoyShiftStart(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted block mb-0.5 font-medium">Shift End</label>
                  <input
                    type="time"
                    className="premium-input w-full text-xs"
                    value={newBoyShiftEnd}
                    onChange={e => setNewBoyShiftEnd && setNewBoyShiftEnd(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

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
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-muted uppercase tracking-wider">All Personnel ({allBoys.length})</p>
            {allBoys.length === 1 && (
              <span className="text-[10px] bg-sky/10 text-sky border border-sky/30 px-2 py-0.5 rounded-full font-bold">
                ⚡ 24x7 Auto-Assign Active
              </span>
            )}
          </div>
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
                      <div>
                        <label className="text-[10px] text-muted block mb-0.5 font-medium">Name</label>
                        <input
                          type="text"
                          value={editBoyName}
                          onChange={e => setEditBoyName(e.target.value)}
                          className="premium-input w-full text-xs font-bold"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted block mb-0.5 font-medium">WhatsApp</label>
                        <input
                          type="text"
                          placeholder="10-digit mobile"
                          maxLength={10}
                          value={editBoyPhone}
                          onChange={e => setEditBoyPhone(sanitizePhoneInput(e.target.value).slice(0, 10))}
                          className="premium-input w-full text-xs font-mono"
                        />
                      </div>
                    </div>

                    {allBoys.length >= 2 && (
                      <div className="grid grid-cols-2 gap-2 p-2 bg-bg2 rounded-lg border border-glass-border">
                        <div>
                          <label className="text-[10px] text-muted block mb-0.5 font-medium">Shift Start</label>
                          <input
                            type="time"
                            value={editBoyShiftStart}
                            onChange={e => setEditBoyShiftStart && setEditBoyShiftStart(e.target.value)}
                            className="premium-input w-full text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted block mb-0.5 font-medium">Shift End</label>
                          <input
                            type="time"
                            value={editBoyShiftEnd}
                            onChange={e => setEditBoyShiftEnd && setEditBoyShiftEnd(e.target.value)}
                            className="premium-input w-full text-xs"
                          />
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleSaveBoyEdit(boy.id)}
                        disabled={savingBoyEdit}
                        className="px-3 py-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs rounded-lg transition-all cursor-pointer"
                      >
                        Save Details
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
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-xs text-text">{boy.name}</span>
                        <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                          boy.is_active ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                        }`}>
                          {boy.is_active ? 'Active' : 'Inactive'}
                        </span>
                        {allBoys.length === 1 ? (
                          <span className="text-[9px] px-2 py-0.5 rounded-full font-bold bg-sky/15 text-sky border border-sky/30">
                            ⚡ 24x7 Default
                          </span>
                        ) : (
                          boy.shift_start_time && boy.shift_end_time ? (
                            <span className="text-[9px] px-2 py-0.5 rounded-full font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30 flex items-center gap-1">
                              <Clock size={10} /> {boy.shift_start_time} - {boy.shift_end_time}
                            </span>
                          ) : (
                            <span className="text-[9px] px-2 py-0.5 rounded-full font-bold bg-muted/15 text-muted border border-glass-border">
                              All Day (No Shift Set)
                            </span>
                          )
                        )}
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
                          if (setEditBoyShiftStart) setEditBoyShiftStart(boy.shift_start_time || '');
                          if (setEditBoyShiftEnd) setEditBoyShiftEnd(boy.shift_end_time || '');
                        }}
                        className="p-1.5 rounded-lg hover:bg-sky/20 text-sky border border-transparent hover:border-sky/30 transition-all cursor-pointer"
                        title="Edit Details / Shift"
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
