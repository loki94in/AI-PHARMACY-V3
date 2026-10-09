import type { ReactNode } from 'react';

export interface SegmentedOption<K extends string> {
  key: K;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
}

interface AppleSegmentedProps<K extends string> {
  options: ReadonlyArray<SegmentedOption<K>>;
  value: K;
  onChange: (key: K) => void;
  className?: string;
}

/** iOS-style segmented control: solid track, raised thumb. Solid fills only (no-GPU safe). */
export function AppleSegmented<K extends string>({ options, value, onChange, className = '' }: AppleSegmentedProps<K>) {
  return (
    <div className={`flex items-center gap-0.5 bg-bg3 p-1 rounded-xl overflow-x-auto scrollbar-none ${className}`} role="tablist">
      {options.map(opt => {
        const isActive = opt.key === value;
        return (
          <button
            key={opt.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(opt.key)}
            className={`flex items-center gap-2 px-3 py-1.5 font-semibold text-xs rounded-lg transition-colors whitespace-nowrap cursor-pointer active:scale-[.98] ${
              isActive ? 'bg-bg text-text shadow-sm' : 'text-muted hover:text-text'
            }`}
          >
            {opt.icon && <span className={isActive ? 'text-primary' : 'text-muted'}>{opt.icon}</span>}
            <span>{opt.label}</span>
            {opt.badge}
          </button>
        );
      })}
    </div>
  );
}
