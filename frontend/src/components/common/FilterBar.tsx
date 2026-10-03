import React from 'react';
import { Search, X } from 'lucide-react';

export interface FilterChipOption {
  label: string;
  value: string;
  count?: number;
}

export interface FilterBarProps {
  searchValue?: string;
  onSearchChange?: (val: string) => void;
  searchPlaceholder?: string;
  chips?: FilterChipOption[];
  activeChip?: string;
  onChipChange?: (value: string) => void;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search...',
  chips,
  activeChip,
  onChipChange,
  actions,
  children,
  className = '',
}) => {
  return (
    <div
      className={`bg-bg2 border border-border rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 shadow-sm ${className}`}
    >
      {/* Left side: Search & Custom Filter Inputs */}
      <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
        {onSearchChange !== undefined && (
          <div className="relative flex-1 min-w-[180px] max-w-sm">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
            />
            <input
              type="text"
              value={searchValue || ''}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full bg-bg border border-border rounded-lg pl-8 pr-7 py-1.5 text-xs text-text placeholder:text-muted/60 focus:outline-none focus:border-primary transition-colors"
            />
            {searchValue ? (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text p-0.5 rounded transition-colors"
                title="Clear search"
              >
                <X size={12} />
              </button>
            ) : null}
          </div>
        )}

        {/* Filter Chips / Badges */}
        {chips && chips.length > 0 && onChipChange && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {chips.map((chip) => {
              const isActive = activeChip === chip.value;
              return (
                <button
                  key={chip.value}
                  type="button"
                  onClick={() => onChipChange(chip.value)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 border select-none ${
                    isActive
                      ? 'bg-primary/15 text-primary border-primary/30 font-semibold'
                      : 'bg-bg text-muted border-border hover:bg-bg3 hover:text-text'
                  }`}
                >
                  <span>{chip.label}</span>
                  {chip.count !== undefined && (
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                        isActive ? 'bg-primary/25 text-primary' : 'bg-bg3 text-muted'
                      }`}
                    >
                      {chip.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {children}
      </div>

      {/* Right side: Action Buttons */}
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
};
