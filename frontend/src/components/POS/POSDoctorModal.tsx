import React from 'react';
import { createPortal } from 'react-dom';
import { Edit, Plus, X, CheckCircle } from 'lucide-react';

export interface POSDoctorModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingDoctorId: string | number | null;
  newDoctorName: string;
  setNewDoctorName: (val: string) => void;
  newDoctorSpecialty: string;
  setNewDoctorSpecialty: (val: string) => void;
  newDoctorPhone: string;
  setNewDoctorPhone: (val: string) => void;
  newDoctorClinic: string;
  setNewDoctorClinic: (val: string) => void;
  newDoctorRegNo: string;
  setNewDoctorRegNo: (val: string) => void;
  sanitizePhoneInput: (val: string) => string;
  handleRegisterDoctor: () => void;
}

export const POSDoctorModal: React.FC<POSDoctorModalProps> = ({
  isOpen,
  onClose,
  editingDoctorId,
  newDoctorName,
  setNewDoctorName,
  newDoctorSpecialty,
  setNewDoctorSpecialty,
  newDoctorPhone,
  setNewDoctorPhone,
  newDoctorClinic,
  setNewDoctorClinic,
  newDoctorRegNo,
  setNewDoctorRegNo,
  sanitizePhoneInput,
  handleRegisterDoctor,
}) => {
  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 fade-in">
      <div className="bg-bg border border-border rounded-2xl w-[95vw] max-w-sm shadow-2xl overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-border bg-bg3/30 flex items-center justify-between">
          <h3 className="font-bold flex items-center gap-2 text-sky text-sm">
            {editingDoctorId ? <Edit size={18} className="text-amber-400" /> : <Plus size={18} />}
            {editingDoctorId ? 'Edit Doctor Profile' : 'Register New Doctor'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-text transition-colors"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="modal-doctor-name" className="text-xs font-bold text-muted uppercase tracking-wider">
              Doctor Name *
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm font-semibold">Dr.</span>
              <input
                id="modal-doctor-name"
                name="modal_doctor_name"
                type="text"
                autoComplete="off"
                className="premium-input w-full pl-9 rounded-xl bg-bg2/40 border-border"
                placeholder="John Doe"
                value={newDoctorName}
                onChange={(e) => setNewDoctorName(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="modal-doctor-specialty" className="text-xs font-bold text-muted uppercase tracking-wider">
              Specialization
            </label>
            <input
              id="modal-doctor-specialty"
              name="modal_doctor_specialty"
              type="text"
              autoComplete="off"
              className="premium-input w-full rounded-xl bg-bg2/40 border-border"
              placeholder="e.g. Cardiologist"
              value={newDoctorSpecialty}
              onChange={(e) => setNewDoctorSpecialty(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="modal-doctor-phone" className="text-xs font-bold text-muted uppercase tracking-wider">
              Phone
            </label>
            <input
              id="modal-doctor-phone"
              name="modal_doctor_phone"
              type="text"
              autoComplete="off"
              className="premium-input w-full rounded-xl bg-bg2/40 border-border font-mono"
              placeholder="10-digit Phone Number"
              value={newDoctorPhone}
              onChange={(e) => setNewDoctorPhone(sanitizePhoneInput(e.target.value))}
              maxLength={10}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="modal-doctor-clinic" className="text-xs font-bold text-muted uppercase tracking-wider">
              Clinic Name
            </label>
            <input
              id="modal-doctor-clinic"
              name="modal_doctor_clinic"
              type="text"
              autoComplete="off"
              className="premium-input w-full rounded-xl bg-bg2/40 border-border"
              placeholder="Clinic / Hospital Name"
              value={newDoctorClinic}
              onChange={(e) => setNewDoctorClinic(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="modal-doctor-reg-no" className="text-xs font-bold text-muted uppercase tracking-wider">
              Registration No.
            </label>
            <input
              id="modal-doctor-reg-no"
              name="modal_doctor_reg_no"
              type="text"
              autoComplete="off"
              className="premium-input w-full rounded-xl bg-bg2/40 border-border"
              placeholder="e.g. MMC-12345"
              value={newDoctorRegNo}
              onChange={(e) => setNewDoctorRegNo(e.target.value)}
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border bg-bg3/30 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-bold text-muted hover:text-text hover:bg-bg2 transition-all border border-transparent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleRegisterDoctor}
            disabled={!newDoctorName}
            className="px-4 py-2 rounded-xl text-sm font-bold bg-sky text-white hover:bg-sky/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-[0_0_15px_rgba(14,165,233,0.2)]"
          >
            <CheckCircle size={16} /> Save Doctor
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
