import React, { useState, useEffect, useRef } from 'react';
import { User, Loader2 } from 'lucide-react';
import { api } from '../services/api';
import { useOnClickOutside } from '../hooks/useOnClickOutside';

export const SALUTATION_OPTIONS = ['Mr.', 'Mrs.', 'Miss', 'Dr.', 'Other'] as const;
export type SalutationType = typeof SALUTATION_OPTIONS[number];

export interface PatientSuggestionItem {
  id: number;
  name: string;
  phone?: string;
  active_refill?: number;
  purchase_count?: number;
  last_sale_date?: string;
  language?: string;
  credit_balance?: number;
  credit_enabled?: number;
  has_special_order?: number;
}

/**
 * Combines salutation (and optional custom salutation) with an uppercase customer/patient name.
 * Avoids duplicate prefixes if the user types a salutation into the name field.
 */
export function combineSalutationAndName(salutation: string, customSalutation: string = '', name: string = ''): string {
  const trimmedName = (name || '').trim().toUpperCase();
  if (!trimmedName) return '';

  // Check if name already has a recognized salutation prefix
  const match = trimmedName.match(/^(MR\.|MRS\.|MISS|MS\.|DR\.|SHRI|SMT\.)\s*(.*)$/i);
  if (match) {
    const rawPrefix = match[1].toUpperCase();
    const actualName = match[2].trim();
    let normalizedPrefix = match[1];
    if (rawPrefix === 'MR.' || rawPrefix === 'MR') normalizedPrefix = 'Mr.';
    else if (rawPrefix === 'MRS.' || rawPrefix === 'MRS') normalizedPrefix = 'Mrs.';
    else if (rawPrefix === 'MISS' || rawPrefix === 'MS.') normalizedPrefix = 'Miss';
    else if (rawPrefix === 'DR.' || rawPrefix === 'DR') normalizedPrefix = 'Dr.';
    else if (rawPrefix === 'SHRI') normalizedPrefix = 'Shri';
    else if (rawPrefix === 'SMT.' || rawPrefix === 'SMT') normalizedPrefix = 'Smt.';
    return actualName ? `${normalizedPrefix} ${actualName}` : normalizedPrefix;
  }

  const activeSal = salutation === 'Other' ? (customSalutation || '').trim() : salutation;
  if (activeSal) {
    return `${activeSal} ${trimmedName}`;
  }
  return trimmedName;
}

/**
 * Parses a full name into standard salutation, custom salutation (if any), and uppercase name.
 */
export function parseSalutationAndName(fullName?: string | null): { salutation: string; customSalutation: string; name: string } {
  if (!fullName || !fullName.trim()) {
    return { salutation: 'Mr.', customSalutation: '', name: '' };
  }
  const trimmed = fullName.trim();
  const match = trimmed.match(/^(Mr\.|Mrs\.|Miss|Ms\.|Dr\.|Shri|Smt\.)\s*(.*)$/i);
  if (match) {
    const rawSal = match[1];
    const restName = match[2].trim().toUpperCase();
    const salUpper = rawSal.toUpperCase();

    if (salUpper === 'MR.' || salUpper === 'MR') {
      return { salutation: 'Mr.', customSalutation: '', name: restName };
    }
    if (salUpper === 'MRS.' || salUpper === 'MRS') {
      return { salutation: 'Mrs.', customSalutation: '', name: restName };
    }
    if (salUpper === 'MISS' || salUpper === 'MS.') {
      return { salutation: 'Miss', customSalutation: '', name: restName };
    }
    if (salUpper === 'DR.' || salUpper === 'DR') {
      return { salutation: 'Dr.', customSalutation: '', name: restName };
    }

    return { salutation: 'Other', customSalutation: rawSal, name: restName };
  }

  return { salutation: 'Mr.', customSalutation: '', name: trimmed.toUpperCase() };
}

interface SalutationNameInputProps {
  salutation: string;
  customSalutation?: string;
  name: string;
  onSalutationChange: (salutation: string, customSalutation?: string) => void;
  onNameChange: (name: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  inputClassName?: string;
  containerClassName?: string;
  label?: string;
  showIcon?: boolean;
  enablePatientAutocomplete?: boolean;
  onSelectPatient?: (patient: PatientSuggestionItem) => void;
}

export const SalutationNameInput: React.FC<SalutationNameInputProps> = ({
  salutation = 'Mr.',
  customSalutation = '',
  name,
  onSalutationChange,
  onNameChange,
  placeholder = 'CUSTOMER NAME',
  required = false,
  disabled = false,
  id,
  inputClassName = '',
  containerClassName = '',
  label,
  showIcon = true,
  enablePatientAutocomplete = false,
  onSelectPatient,
}) => {
  const isOther = salutation === 'Other' || (!SALUTATION_OPTIONS.includes(salutation as any) && Boolean(salutation));

  const [suggestions, setSuggestions] = useState<PatientSuggestionItem[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [isFuzzyMatch, setIsFuzzyMatch] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const justSelectedRef = useRef(false);
  const isFocusedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useOnClickOutside([containerRef, dropdownRef], () => {
    setShowSuggestions(false);
  });

  // Debounced patient autocomplete lookup
  useEffect(() => {
    if (!enablePatientAutocomplete || !isFocusedRef.current) return;
    if (justSelectedRef.current) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const query = name.trim();
    if (query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setIsLoading(true);
        const data = await api.getPatients({ q: query, limit: 8 });
        const list = Array.isArray(data) ? data : ((data as any)?.suggestions || []);
        const isFuzzy = !Array.isArray(data) && Boolean((data as any)?.isSuggestion);

        if (!justSelectedRef.current && isFocusedRef.current && name.trim() === query) {
          setSuggestions(list as PatientSuggestionItem[]);
          setIsFuzzyMatch(isFuzzy);
          setShowSuggestions(list.length > 0);
          setHighlightIndex(-1);
        }
      } catch {
        // silent fetch error fallback
      } finally {
        setIsLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [name, enablePatientAutocomplete]);

  const handleSalChange = (newSal: string) => {
    if (newSal === 'Other') {
      onSalutationChange('Other', customSalutation);
    } else {
      onSalutationChange(newSal, '');
    }
  };

  const handleCustomSalChange = (val: string) => {
    onSalutationChange('Other', val);
  };

  const handleNameInput = (val: string) => {
    justSelectedRef.current = false;
    // Strictly force UPPERCASE for all customer/patient names
    onNameChange(val.toUpperCase());
  };

  const handleSelectSuggestion = (patient: PatientSuggestionItem) => {
    justSelectedRef.current = true;
    setShowSuggestions(false);
    setSuggestions([]);
    setHighlightIndex(-1);
    const parsed = parseSalutationAndName(patient.name);
    onSalutationChange(parsed.salutation, parsed.customSalutation);
    onNameChange(parsed.name);
    onSelectPatient?.(patient);
  };

  return (
    <div ref={containerRef} className={`space-y-1 ${containerClassName}`}>
      {label && (
        <label className="block text-xs font-semibold text-text">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}
      <div className="flex gap-1.5 items-center w-full">
        {/* Salutation Select */}
        <select
          value={SALUTATION_OPTIONS.includes(salutation as any) ? salutation : 'Other'}
          onChange={(e) => handleSalChange(e.target.value)}
          disabled={disabled}
          className="px-2.5 py-2.5 text-xs font-bold rounded-xl bg-bg border border-border text-text focus:outline-none focus:border-primary cursor-pointer shrink-0 transition-colors shadow-sm"
          title="Salutation / Title (Mr / Mrs / Miss / Dr / Other)"
        >
          <option value="Mr.">Mr.</option>
          <option value="Mrs.">Mrs.</option>
          <option value="Miss">Miss</option>
          <option value="Dr.">Dr.</option>
          <option value="Other">Other</option>
        </select>

        {/* Custom Salutation text input if Other is selected */}
        {isOther && (
          <input
            type="text"
            value={customSalutation || (SALUTATION_OPTIONS.includes(salutation as any) ? '' : salutation)}
            onChange={(e) => handleCustomSalChange(e.target.value)}
            disabled={disabled}
            placeholder="TITLE"
            className="w-20 uppercase px-2.5 py-2.5 text-xs font-bold rounded-xl bg-bg border border-border text-text focus:outline-none focus:border-primary shrink-0 transition-colors shadow-sm"
            maxLength={10}
            title="Custom Title / Prefix"
          />
        )}

        {/* Uppercase Name Input */}
        <div className="relative flex-1">
          {showIcon && !isLoading && (
            <User size={14} className="absolute left-3 top-3 text-muted pointer-events-none" />
          )}
          {isLoading && (
            <Loader2 size={14} className="absolute left-3 top-3 text-primary animate-spin pointer-events-none" />
          )}
          <input
            id={id}
            type="text"
            value={name}
            onChange={(e) => handleNameInput(e.target.value)}
            onFocus={() => {
              isFocusedRef.current = true;
              if (enablePatientAutocomplete && !justSelectedRef.current && suggestions.length > 0) {
                setShowSuggestions(true);
              }
            }}
            onBlur={() => {
              isFocusedRef.current = false;
              setTimeout(() => setShowSuggestions(false), 200);
            }}
            onKeyDown={(e) => {
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
            }}
            placeholder={placeholder.toUpperCase()}
            required={required}
            disabled={disabled}
            autoComplete="off"
            className={`w-full uppercase font-semibold text-xs px-3 py-2.5 bg-bg border border-border rounded-xl text-text placeholder:text-muted/60 focus:outline-none focus:border-primary transition-all shadow-sm ${
              showIcon ? 'pl-8' : ''
            } ${inputClassName}`}
          />

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
    </div>
  );
};
