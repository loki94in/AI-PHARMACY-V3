import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, MessageSquare, Check, X, HelpCircle, Loader2 } from 'lucide-react';
import { sanitizePhoneInput } from '../utils/phone';
import { api, apiClient } from '../services/api';
import type { PatientSuggestionItem } from './SalutationNameInput';

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
  enablePatientAutocomplete?: boolean;
  onSelectPatient?: (patient: PatientSuggestionItem) => void;
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
  onValidationChange,
  enablePatientAutocomplete = false,
  onSelectPatient
}) => {
  const [isShaking, setIsShaking] = useState(false);
  const [waStatus, setWaStatus] = useState<'idle' | 'checking' | 'available' | 'not_available' | 'unable_to_verify'>('idle');
  const prewarmed = useRef(false);

  // Patient Autocomplete State
  const [suggestions, setSuggestions] = useState<PatientSuggestionItem[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [isFuzzyMatch, setIsFuzzyMatch] = useState(false);
  const [isLoadingPatients, setIsLoadingPatients] = useState(false);
  const justSelectedRef = useRef(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  // Debounced patient phone autocomplete lookup
  useEffect(() => {
    if (!enablePatientAutocomplete) return;
    if (justSelectedRef.current) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    if (cleanDigits.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setIsLoadingPatients(true);
        const data = await api.getPatients({ q: cleanDigits, limit: 8 });
        const list = Array.isArray(data) ? data : ((data as any)?.suggestions || []);
        const isFuzzy = !Array.isArray(data) && Boolean((data as any)?.isSuggestion);

        if (!justSelectedRef.current) {
          setSuggestions(list as PatientSuggestionItem[]);
          setIsFuzzyMatch(isFuzzy);
          setShowSuggestions(list.length > 0);
          setHighlightIndex(-1);

          // Direct 10-digit auto-fill: if user entered exactly 10 digits and an exact phone match exists
          if (cleanDigits.length === 10 && onSelectPatient && list.length > 0) {
            const exactMatch = (list as PatientSuggestionItem[]).find(
              p => (p.phone || '').replace(/\D/g, '') === cleanDigits || (p.phone || '').replace(/\D/g, '').endsWith(cleanDigits)
            );
            if (exactMatch) {
              onSelectPatient(exactMatch);
            }
          }
        }
      } catch {
        // silent fetch error fallback
      } finally {
        setIsLoadingPatients(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [cleanDigits, enablePatientAutocomplete, onSelectPatient]);

  const handleSelectSuggestion = (patient: PatientSuggestionItem) => {
    justSelectedRef.current = true;
    setShowSuggestions(false);
    setHighlightIndex(-1);
    const cleanP = (patient.phone || '').replace(/\D/g, '');
    const valid10 = cleanP.length === 12 && cleanP.startsWith('91') ? cleanP.slice(2) : cleanP;
    onChange(valid10 || patient.phone || '');
    onSelectPatient?.(patient);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    justSelectedRef.current = false;
    const sanitized = sanitizePhoneInput(e.target.value);
    onChange(sanitized);
  };

  const handleBlur = () => {
    setTimeout(() => setShowSuggestions(false), 200);
    if (isPartial || (isEmpty && required)) {
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 400);
    }
  };

  const handleFocus = () => {
    prewarmWhatsApp();
    if (enablePatientAutocomplete && !justSelectedRef.current && suggestions.length > 0) {
      setShowSuggestions(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (enablePatientAutocomplete && showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIndex((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Escape') {
        setShowSuggestions(false);
        setHighlightIndex(-1);
      } else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
        if (highlightIndex >= 0 && highlightIndex < suggestions.length) {
          e.preventDefault();
          handleSelectSuggestion(suggestions[highlightIndex]);
        }
      }
    }
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
          onKeyDown={handleKeyDown}
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

        {/* Autocomplete Suggestions Dropdown */}
        {enablePatientAutocomplete && showSuggestions && suggestions.length > 0 && (
          <div
            ref={dropdownRef}
            className="absolute left-0 right-0 top-full z-dropdown mt-1.5 bg-bg2 border border-border rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.16)] overflow-hidden max-h-52 flex flex-col animate-fade-in"
          >
            {isFuzzyMatch && (
              <div className="px-3 py-1.5 bg-amber-500/10 text-amber-400 text-[11px] font-bold border-b border-amber-500/20 flex items-center gap-1.5 shrink-0 select-none">
                <span>🔍</span> Suggested patients:
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto dropdown-scroll divide-y divide-border/10">
              {suggestions.map((p, idx) => {
                const isHighlighted = idx === highlightIndex;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectSuggestion(p);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                      isHighlighted
                        ? 'bg-primary/20 text-text font-bold border-l-4 border-primary ring-1 ring-primary/40'
                        : 'text-text hover:bg-primary/10'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                      <span className="font-semibold truncate">{p.name}</span>
                      {p.active_refill === 1 && (
                        <span
                          className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded bg-violet-500/15 border border-violet-500/30 text-violet-400 text-[10px] font-bold"
                          title="Active Refill Schedule"
                        >
                          🔁 Refill
                        </span>
                      )}
                      {p.has_special_order === 1 && (
                        <span
                          className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-bold"
                          title="Special Order Customer"
                        >
                          📦 Special Order
                        </span>
                      )}
                      {(p.purchase_count || 0) > 0 && p.active_refill !== 1 && p.has_special_order !== 1 && (
                        <span
                          className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded bg-blue-500/15 border border-blue-500/30 text-blue-400 text-[10px] font-bold"
                          title="Walk-in / POS Customer"
                        >
                          ⭐ POS
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 font-mono text-[11px] text-muted">
                      {p.phone && <span className="text-text font-semibold">{p.phone}</span>}
                      {isHighlighted && (
                        <span className="text-[10px] bg-primary text-white font-bold px-1.5 py-0.5 rounded shadow-xs">
                          ↵ Enter
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
