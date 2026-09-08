import React, { useState, useRef, useEffect } from 'react';
import { useStore, type Store } from '../context/StoreContext';
import { Store as StoreIcon, ChevronDown, Check, Building2, MapPin } from 'lucide-react';

interface StoreSelectorProps {
  className?: string;
  showPrefix?: boolean;
}

export const StoreSelector: React.FC<StoreSelectorProps> = ({ className = '', showPrefix = false }) => {
  const { stores, activeStore, activeStoreId, setActiveStoreId } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (stores.length <= 1 && !activeStore) {
    return null;
  }

  const hasMultipleStores = stores.length > 1;

  return (
    <div className={`relative inline-block text-left ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => hasMultipleStores && setIsOpen(!isOpen)}
        className={`h-8 px-2.5 rounded-xl border border-glass-border bg-glass-bg text-muted hover:text-text hover:bg-bg3/60 transition-colors shadow-xs flex items-center gap-1.5 text-xs font-semibold shrink-0 ${
          hasMultipleStores ? 'cursor-pointer' : 'cursor-default'
        }`}
        title={`Active Store: ${activeStore?.name || 'Main Store'}${activeStore?.code ? ` (${activeStore.code})` : ''}${hasMultipleStores ? ' — Click to switch' : ''}`}
        aria-label="Active Store"
      >
        <StoreIcon size={14} className="text-primary shrink-0" />
        {showPrefix && <span className="text-muted font-normal hidden sm:inline">Active Store:</span>}
        <span className="truncate max-w-[100px] sm:max-w-[140px] text-text font-semibold">
          {activeStore?.name || 'Main Store'}
        </span>
        {hasMultipleStores && (
          <ChevronDown
            size={12}
            className="text-muted shrink-0 transition-transform duration-200"
            style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }}
          />
        )}
      </button>

      {isOpen && hasMultipleStores && (
        <div className="absolute right-0 mt-2 w-64 rounded-xl bg-bg2 border border-border shadow-2xl py-1.5 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="px-3 py-2 border-b border-border text-[11px] font-semibold text-muted uppercase tracking-wider flex items-center justify-between">
            <span>Select Active Store</span>
            <span className="text-[10px] lowercase text-muted font-normal">({stores.length} available)</span>
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {stores.map((store: Store) => {
              const isSelected = store.id === activeStoreId;
              return (
                <button
                  key={store.id}
                  onClick={() => {
                    setActiveStoreId(store.id);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 flex items-start gap-2.5 transition-colors ${
                    isSelected ? 'bg-primary/10 text-primary' : 'text-text hover:bg-bg3'
                  }`}
                >
                  <div className="mt-0.5">
                    {store.is_central ? (
                      <Building2 className={`w-4 h-4 ${isSelected ? 'text-primary' : 'text-muted'}`} />
                    ) : (
                      <MapPin className={`w-4 h-4 ${isSelected ? 'text-primary' : 'text-muted'}`} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm truncate">{store.name}</span>
                      {isSelected && <Check className="w-4 h-4 text-primary shrink-0 ml-1" />}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted mt-0.5">
                      {store.code && <span className="font-mono text-[11px]">{store.code}</span>}
                      {store.is_central ? (
                        <span className="text-[10px] px-1 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 font-medium">
                          Central
                        </span>
                      ) : (
                        <span className="text-[10px] px-1 rounded bg-blue-500/10 text-blue-500 border border-blue-500/20 font-medium">
                          Branch
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
