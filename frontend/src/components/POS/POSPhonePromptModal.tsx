import React from 'react';
import { Send } from 'lucide-react';
import { BaseModal } from '../common/BaseModal';
import { PhoneInputWithBadge } from '../PhoneInputWithBadge';
import { sanitizePhoneInput, isValid10DigitPhone } from '../../utils/phone';
import { toastEvent } from '../../services/events';

interface POSPhonePromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientName: string;
  promptPhoneValue: string;
  setPromptPhoneValue: (val: string) => void;
  shakePromptPhone: boolean;
  setShakePromptPhone: (val: boolean) => void;
  onConfirm: (phone: string) => void;
  isCreditSale?: boolean;
  onSkipPhone?: () => void;
}

export const POSPhonePromptModal: React.FC<POSPhonePromptModalProps> = ({
  isOpen,
  onClose,
  patientName,
  promptPhoneValue,
  setPromptPhoneValue,
  shakePromptPhone,
  setShakePromptPhone,
  onConfirm,
  isCreditSale = true,
  onSkipPhone,
}) => {
  const handleSubmit = () => {
    const val = sanitizePhoneInput(promptPhoneValue);
    if (!isValid10DigitPhone(val)) {
      setShakePromptPhone(true);
      setTimeout(() => setShakePromptPhone(false), 400);
      toastEvent.trigger('Please enter a valid 10-digit phone number (starting with 6, 7, 8, or 9).', 'error');
      return;
    }
    onConfirm(val);
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2 text-base font-bold text-text">
          <Send size={18} className="text-primary" />
          <span>{isCreditSale ? 'WhatsApp Number Required for Credit Bill' : 'Valid 10-Digit Mobile Number Required'}</span>
        </div>
      }
      maxWidth="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-bg3 text-muted rounded-xl text-xs font-semibold hover:text-text cursor-pointer"
          >
            Cancel
          </button>
          {!isCreditSale && onSkipPhone && (
            <button
              type="button"
              onClick={onSkipPhone}
              className="px-4 py-2 bg-bg3 text-text hover:bg-bg border border-border rounded-xl text-xs font-semibold cursor-pointer transition-all"
            >
              Clear &amp; Proceed as Walk-in
            </button>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            className="px-4 py-2 bg-primary text-white rounded-xl text-xs font-bold hover:bg-primary/90 transition-all flex items-center gap-1.5 shadow-md cursor-pointer"
          >
            <Send size={14} />
            {isCreditSale ? 'Save & Send Credit Bill' : 'Save Bill'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-muted leading-relaxed">
          {isCreditSale ? (
            <>
              To save this credit transaction and automatically send the instant WhatsApp credit PDF bill, please enter the mobile number for{' '}
              <strong className="text-text">{patientName || 'Customer'}</strong>:
            </>
          ) : (
            <>
              The customer mobile number entered for <strong className="text-text">{patientName || 'Customer'}</strong> is incomplete. Please enter a valid 10-digit mobile number, or proceed without a phone for a walk-in bill:
            </>
          )}
        </p>
        <div className="space-y-1.5">
          <PhoneInputWithBadge
            label="WhatsApp Phone Number"
            value={promptPhoneValue}
            onChange={val => setPromptPhoneValue(val)}
            placeholder="Enter 10-digit phone number (e.g. 9876543210)"
            required={true}
            allowEmpty={false}
            shakeOnError={shakePromptPhone}
          />
        </div>
      </div>
    </BaseModal>
  );
};
