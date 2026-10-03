import React from 'react';
import { Key, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { BaseModal } from '../../components/common/BaseModal';

interface ChangePinModalProps {
  isOpen: boolean;
  onClose: () => void;
  pinChangeError: string | null;
  pinChangeSuccess: string | null;
  pinChangeForm: { current_pin: string; new_pin: string; confirm_pin: string };
  setPinChangeForm: (val: { current_pin: string; new_pin: string; confirm_pin: string }) => void;
  pinChangeLoading: boolean;
  onSubmit: (e: React.FormEvent) => void;
}

export const ChangePinModal: React.FC<ChangePinModalProps> = ({
  isOpen,
  onClose,
  pinChangeError,
  pinChangeSuccess,
  pinChangeForm,
  setPinChangeForm,
  pinChangeLoading,
  onSubmit,
}) => {
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2 text-base font-bold text-text">
          <Key className="w-5 h-5 text-primary" />
          <span>Change Your PIN</span>
        </div>
      }
      maxWidth="max-w-sm"
    >
      <div className="space-y-4">
        {pinChangeError && (
          <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-600 flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{pinChangeError}</span>
          </div>
        )}

        {pinChangeSuccess && (
          <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-600 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{pinChangeSuccess}</span>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-semibold text-text uppercase tracking-wider mb-1">
              Current 4-Digit PIN
            </label>
            <input
              type="password"
              maxLength={6}
              placeholder="Enter current PIN"
              value={pinChangeForm.current_pin}
              onChange={e => setPinChangeForm({ ...pinChangeForm, current_pin: e.target.value })}
              className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-text font-mono tracking-widest focus:outline-none focus:border-primary"
              required
            />
          </div>

          <div>
            <label className="block font-semibold text-text uppercase tracking-wider mb-1">
              New 4-Digit PIN
            </label>
            <input
              type="password"
              maxLength={6}
              placeholder="Enter new 4-digit PIN"
              value={pinChangeForm.new_pin}
              onChange={e => setPinChangeForm({ ...pinChangeForm, new_pin: e.target.value.replace(/\D/g, '') })}
              className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-text font-mono tracking-widest focus:outline-none focus:border-primary"
              required
            />
          </div>

          <div>
            <label className="block font-semibold text-text uppercase tracking-wider mb-1">
              Confirm New PIN
            </label>
            <input
              type="password"
              maxLength={6}
              placeholder="Re-enter new 4-digit PIN"
              value={pinChangeForm.confirm_pin}
              onChange={e => setPinChangeForm({ ...pinChangeForm, confirm_pin: e.target.value.replace(/\D/g, '') })}
              className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-text font-mono tracking-widest focus:outline-none focus:border-primary"
              required
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-border rounded-xl text-muted hover:text-text transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pinChangeLoading}
              className="px-5 py-2 bg-primary text-white rounded-xl font-bold shadow-md hover:opacity-95 transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {pinChangeLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              <span>Save New PIN</span>
            </button>
          </div>
        </form>
      </div>
    </BaseModal>
  );
};
