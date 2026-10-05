import React from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink } from 'lucide-react';
import { PhoneInputWithBadge } from '../PhoneInputWithBadge';

export interface DistributorModalProps {
  isOpen: boolean;
  onClose: () => void;
  editDistributorId: number | null;
  newDistributor: {
    name: string;
    phone: string;
    email: string;
    address: string;
    state_code: string;
  };
  setNewDistributor: React.Dispatch<
    React.SetStateAction<{
      name: string;
      phone: string;
      email: string;
      address: string;
      state_code: string;
    }>
  >;
  saveDistributor: () => void;
  savingDistributor: boolean;
  indianStateCodes: Array<{ code: string; name: string }>;
}

export const DistributorModal: React.FC<DistributorModalProps> = ({
  isOpen,
  onClose,
  editDistributorId,
  newDistributor,
  setNewDistributor,
  saveDistributor,
  savingDistributor,
  indianStateCodes,
}) => {
  useModalEscape(isOpen, onClose);
  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 bg-black/60 z-modal flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-bg2 border border-border rounded-xl p-6 w-[95vw] max-w-md shadow-2xl">
        <h3 className="text-lg font-semibold text-text mb-4">
          {editDistributorId ? 'Edit Distributor' : 'Add New Distributor'}
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted mb-2">Name *</label>
            <input
              type="text"
              value={newDistributor.name}
              onChange={(e) => setNewDistributor({ ...newDistributor, name: e.target.value })}
              className="w-full bg-bg3 border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-primary/50"
              placeholder="Distributor name"
            />
          </div>

          <div>
            <PhoneInputWithBadge
              label="Phone Number"
              value={newDistributor.phone}
              onChange={(val) => setNewDistributor({ ...newDistributor, phone: val })}
              allowEmpty={true}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted mb-2">Email (Optional)</label>
            <input
              type="email"
              value={newDistributor.email}
              onChange={(e) => setNewDistributor({ ...newDistributor, email: e.target.value })}
              className="w-full bg-bg3 border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-primary/50"
              placeholder="distributor@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted mb-2">Address (Optional)</label>
            <textarea
              value={newDistributor.address}
              onChange={(e) => setNewDistributor({ ...newDistributor, address: e.target.value })}
              className="w-full bg-bg3 border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-primary/50"
              placeholder="Full address"
              rows={3}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted mb-2">State Code (Optional)</label>
            <select
              value={newDistributor.state_code}
              onChange={(e) => setNewDistributor({ ...newDistributor, state_code: e.target.value })}
              className="w-full bg-bg3 border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-primary/50"
            >
              <option value="">Select State Code (Optional)</option>
              {[...indianStateCodes]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((state) => (
                  <option key={state.code} value={state.code}>
                    {state.code} - {state.name}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 mt-6">
          {editDistributorId ? (
            <a
              href={`/learning?tab=distributor_layouts&id=${editDistributorId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-500/10 border border-sky-500/30 text-xs font-bold text-sky hover:bg-sky-500/20 transition-all"
              title="Open full distributor profile & OCR rules in AI Learning page"
            >
              <ExternalLink size={13} />
              <span>Open in AI Learning</span>
            </a>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="border border-border text-muted hover:text-text hover:bg-bg3 px-4 py-2 rounded-lg text-xs font-bold transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveDistributor}
              disabled={savingDistributor || !newDistributor.name}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-50"
            >
              {savingDistributor ? 'Saving...' : editDistributorId ? 'Save Changes' : 'Add Distributor'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
