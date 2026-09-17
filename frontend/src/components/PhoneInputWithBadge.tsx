import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, MessageSquare, Check, X, HelpCircle, Loader2 } from 'lucide-react';
import { sanitizePhoneInput } from '../utils/phone';
import { apiClient } from '../services/api';

interface PhoneInputWithBadgeProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  label?: string;
  required?: boolean;
  allowEmpty?: boolean;
  className?: string;
  disabled?: boolean;
  id?: string;
  shakeOnError?: boolean;
  checkWhatsApp?: boolean;
  onValidationChange?: (isValid: boolean) => void;
}

export const PhoneInputWithBadge: React.FC<PhoneInputWithBadgeProps> = ({
  value,
  onChange,
  placeholder = '10-digit phone number...',
  label,
  required = false,
  allowEmpty = true,
  className = '',
  disabled = false,
  id,
  shakeOnError = false,
  checkWhatsApp = true,
  onValidationChange
}) => {
  const [isShaking, setIsShaking] = useState(false);
  const [waStatus, setWaStatus] = useState<'idle' | 'checking' | 'available' | 'not_available' | 'unable_to_verify'>('idle');
  const prewarmed = useRef(false);

  // Silent fire-and-forget prewarm — called on first focus so WhatsApp is
  // never sleeping by the time the user finishes typing 10 digits.
  const prewarmWhatsApp = useCallback(() => {
    if (prewarmed.current) return;
    prewarmed.current = true;
    apiClient.post('/messaging/prewarm').catch(() => { /* silent */ });
  }, []);

  const cleanDigits = (value || '').replace(/\D/g, '');
  const isComplete = cleanDigits.length === 10;
  const isPartial = cleanDigits.length > 0 && cleanDigits.length < 10;
  const isEmpty = cleanDigits.length === 0;

  const isValid = (isEmpty && allowEmpty && !required) || isComplete;

  useEffect(() => {
    if (onValidationChange) {
      onValidationChange(isValid);
    }
  }, [isValid, onValidationChange]);

  // Debounced WhatsApp capability check (MULTI-PHARMACY.md §16)
  useEffect(() => {
    if (!checkWhatsApp || !isComplete) {
      setWaStatus('idle');
      return;
    }

    setWaStatus('checking');
    const timer = setTimeout(async () => {
      try {
        const res = await apiClient.get('/messaging/check-phone', {
          params: { phone: cleanDigits }
        });
        const status = res.data?.status;
        if (status === 'AVAILABLE') setWaStatus('available');
        else if (status === 'NOT_AVAILABLE') setWaStatus('not_available');
        else setWaStatus('unable_to_verify');
      } catch (_) {
        setWaStatus('unable_to_verify');
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [checkWhatsApp, isComplete, cleanDigits]);

  useEffect(() => {
    if (shakeOnError || isPartial) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- shake must react to parent error-prop signal
      setIsShaking(true);
      const timer = setTimeout(() => setIsShaking(false), 400);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- adding isPartial would re-shake on every keystroke
  }, [shakeOnError]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = sanitizePhoneInput(e.target.value);
    onChange(sanitized);
  };

  const handleBlur = () => {
    if (isPartial || (isEmpty && required)) {
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 400);
    }
  };

  const handleFocus = () => {
    prewarmWhatsApp();
  };

  let badgeText;
  let badgeColor;

  if (isComplete) {
    badgeText = '10/10 ✓ Valid';
    badgeColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 font-bold';
  } else if (isPartial) {
    const remaining = 10 - cleanDigits.length;
    badgeText = `${remaining} left (${cleanDigits.length}/10)`;
    badgeColor = 'bg-amber-500/15 text-amber-400 border-amber-500/30 font-mono animate-pulse font-bold';
  } else if (required && isEmpty) {
    badgeText = '10 digits required';
    badgeColor = 'bg-rose-500/15 text-rose-400 border-rose-500/30 font-bold';
  } else {
    badgeText = 'Optional (10 digits)';
    badgeColor = 'bg-bg2 text-muted border-border';
  }

  const borderClass = isShaking
    ? 'border-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.3)] animate-shake'
    : isPartial
    ? 'border-amber-500/70 focus:border-amber-400'
    : isComplete
    ? 'border-emerald-500/70 focus:border-emerald-400'
    : 'border-border focus:border-primary';

  const inputId = id || 'phone-input-badge';

  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <div className="flex items-center justify-between text-xs font-bold text-text">
          <label htmlFor={inputId} className="flex items-center gap-1.5">
            <Phone size={13} className="text-muted" />
            {label} {required && <span className="text-rose-400">*</span>}
          </label>
          <div className="flex items-center gap-1.5">
            {checkWhatsApp && isComplete && waStatus !== 'idle' && (
              <span className={`text-[10px] px-2 py-0.5 rounded-md border transition-all flex items-center gap-1 font-semibold ${
                waStatus === 'available'
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : waStatus === 'checking'
                  ? 'bg-sky-500/15 text-sky-400 border-sky-500/30 animate-pulse'
                  : waStatus === 'not_available'
                  ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                  : 'bg-bg2 text-muted border-border'
              }`}>
                {waStatus === 'checking' && (
                  <>
                    <Loader2 size={10} className="animate-spin" />
                    Checking...
                  </>
                )}
                {waStatus === 'available' && (
                  <>
                    <Check size={10} className="text-emerald-400" />
                    WhatsApp Available
                  </>
                )}
                {waStatus === 'not_available' && (
                  <>
                    <X size={10} className="text-rose-400" />
                    WhatsApp Not Available
                  </>
                )}
                {waStatus === 'unable_to_verify' && (
                  <>
                    <HelpCircle size={10} className="text-muted" />
                    Unable to Verify
                  </>
                )}
              </span>
            )}
            <span className={`text-[10px] px-2 py-0.5 rounded-md border transition-all ${badgeColor}`}>
              {badgeText}
            </span>
          </div>
        </div>
      )}

      <div className="relative flex items-center">
        <input
          id={inputId}
          name={inputId}
          type="tel"
          autoComplete="off"
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
          onFocus={handleFocus}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={10}
          className={`
            w-full bg-bg border rounded-xl px-3.5 py-2.5 text-xs text-text placeholder:text-muted/60
            focus:outline-none transition-all duration-200
            ${!label ? (checkWhatsApp && isComplete ? 'pr-36' : 'pr-28') : ''}
            ${borderClass}
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        />
        {!label && (
          <span className="absolute right-2 flex items-center gap-1 pointer-events-none select-none">
            {/* WA status morphing icon — only when check is on and number is complete */}
            {checkWhatsApp && isComplete && waStatus !== 'idle' && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-md border flex items-center gap-0.5 font-semibold transition-all duration-300 ${
                waStatus === 'available'
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : waStatus === 'checking'
                  ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                  : waStatus === 'not_available'
                  ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                  : 'bg-bg2 text-muted border-border'
              }`}>
                {waStatus === 'checking' && <Loader2 size={9} className="animate-spin" />}
                {waStatus === 'available' && <Check size={9} />}
                {waStatus === 'not_available' && <X size={9} />}
                {waStatus === 'unable_to_verify' && <HelpCircle size={9} />}
                WA
              </span>
            )}
            <span className={`text-[10px] px-2 py-0.5 rounded-md border transition-all ${badgeColor}`}>
              {badgeText}
            </span>
          </span>
        )}
      </div>
    </div>
  );
};
