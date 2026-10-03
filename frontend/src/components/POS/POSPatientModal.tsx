import React from 'react';
import { createPortal } from 'react-dom';
import { UserCheck, X, Phone, Calendar } from 'lucide-react';

export interface POSPatientModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  patientName: string;
  updatePatientName: (name: string) => void;
  patientPhone: string;
  setPatientPhone: (phone: string) => void;
  sanitizePhoneInput: (val: string) => string;
  refillEnabled: boolean;
  setRefillEnabled: (val: boolean) => void;
  refillDays: number;
  setRefillDays: (val: number) => void;
  handleSavePatientProfile: () => void;
}

export const POSPatientModal: React.FC<POSPatientModalProps> = ({
  isOpen,
  onClose,
  patientId,
  patientName,
  updatePatientName,
  patientPhone,
  setPatientPhone,
  sanitizePhoneInput,
  refillEnabled,
  setRefillEnabled,
  refillDays,
  setRefillDays,
  handleSavePatientProfile,
}) => {
  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-modal p-4 animate-fade-in">
      <div className="glass-panel w-[95vw] max-w-md p-6 space-y-5 border-border bg-bg2 rounded-2xl relative shadow-2xl">
        {/* Modal Header */}
        <div className="flex justify-between items-center border-b border-border pb-3">
          <h3 className="font-bold flex items-center gap-2 text-lg text-text">
            <UserCheck size={20} className="text-primary" />
            Manage Patient & Refills
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-bg3 text-muted hover:text-text transition-all"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="space-y-4">
          {/* Patient ID */}
          <div className="space-y-1.5">
            <span className="text-xs font-bold text-muted uppercase tracking-wider">Patient Card ID</span>
            <input
              id="modal-patient-id"
              name="modal_patient_card_id"
              type="text"
              autoComplete="off"
              className="premium-input w-full text-xs font-mono py-2 px-3 bg-bg3/40 cursor-not-allowed rounded-xl"
              value={patientId}
              disabled
              title="Auto-generated unique card ID"
            />
          </div>

          {/* Patient Name */}
          <div className="space-y-1.5">
            <span className="text-xs font-bold text-muted uppercase tracking-wider">Full Name</span>
            <input
              id="modal-patient-name"
              name="modal_patient_name"
              type="text"
              autoComplete="off"
              className="premium-input uppercase w-full text-sm py-2 px-3 bg-bg2/50 border-border/80 rounded-xl"
              placeholder="ENTER FULL NAME"
              value={patientName}
              onChange={(e) => updatePatientName(e.target.value)}
            />
          </div>

          {/* WhatsApp / Phone */}
          <div className="space-y-1.5">
            <span className="text-xs font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
              <Phone size={12} className="text-green" /> WhatsApp / Contact Number
            </span>
            <input
              id="modal-patient-phone"
              name="modal_patient_phone"
              type="text"
              autoComplete="off"
              className="premium-input w-full text-sm font-mono py-2 px-3 bg-bg2/50 border-border/80 rounded-xl"
              placeholder="e.g. 9876543210"
              value={patientPhone}
              onChange={(e) => setPatientPhone(sanitizePhoneInput(e.target.value))}
              maxLength={10}
            />
          </div>

          {/* Auto-Refill Manager Section */}
          <div className="border border-border rounded-2xl p-4 bg-bg3/30 space-y-3">
            <div className="flex justify-between items-center">
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-text uppercase tracking-wider flex items-center gap-1.5">
                  🔄 Auto-Refill Reminders
                </span>
                <p className="text-[10px] text-muted">Generate recurring WhatsApp stock notifications</p>
              </div>
              <label htmlFor="modal-refill-enabled" className="relative inline-flex items-center cursor-pointer" aria-label="Toggle Refill">
                <input
                  id="modal-refill-enabled"
                  name="modal_refill_enabled"
                  type="checkbox"
                  className="sr-only peer"
                  checked={refillEnabled}
                  onChange={(e) => setRefillEnabled(e.target.checked)}
                />
                <div className="w-9 h-5 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-text after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary peer-checked:after:bg-text"></div>
              </label>
            </div>

            {refillEnabled && (
              <div className="space-y-3 pt-2 border-t border-border/40 animate-fade-in">
                <div className="space-y-1.5">
                  <span className="text-xs font-bold text-muted uppercase tracking-wider flex items-center gap-1">
                    <Calendar size={12} /> Refill Interval (Days)
                  </span>
                  <div className="flex gap-2">
                    <input
                      id="modal-refill-days"
                      name="modal_refill_days"
                      type="number"
                      autoComplete="off"
                      className="premium-input text-sm font-mono py-1.5 px-3 w-20 text-center bg-bg border-border rounded-xl"
                      value={refillDays}
                      onChange={(e) => setRefillDays(Math.min(100, Math.max(1, Number(e.target.value))))}
                      min="1"
                      max="100"
                    />
                    <div className="flex gap-1 flex-1">
                      {[30, 60, 90].map((days) => (
                        <button
                          key={days}
                          type="button"
                          onClick={() => setRefillDays(days)}
                          className={`text-xs py-1 px-2.5 rounded-xl border font-mono transition-all flex-1 ${
                            refillDays === days
                              ? 'bg-primary/20 border-primary text-primary'
                              : 'bg-bg2 border-border text-muted hover:text-text'
                          }`}
                        >
                          {days}d
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Interactive 1-100 Days Slider */}
                  <div className="space-y-1 pt-1">
                    <div className="flex justify-between text-[10px] text-muted font-semibold">
                      <span>1 day</span>
                      <span className="text-primary font-bold">{refillDays} days</span>
                      <span>100 days</span>
                    </div>
                    <input
                      id="modal-refill-days-range"
                      name="modal_refill_days_range"
                      type="range"
                      min="1"
                      max="100"
                      value={refillDays}
                      onChange={(e) => setRefillDays(Number(e.target.value))}
                      className="w-full h-1.5 bg-border rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="pt-2 border-t border-border flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="premium-btn bg-bg2 border border-border text-muted hover:text-text hover:bg-bg3 py-2 px-4 text-xs font-bold uppercase tracking-wider rounded-xl"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSavePatientProfile}
            className="premium-btn bg-primary text-white hover:bg-teal-500 py-2 px-5 text-xs font-bold uppercase tracking-wider rounded-xl shadow-md"
          >
            Save Profile (Ctrl+S)
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
