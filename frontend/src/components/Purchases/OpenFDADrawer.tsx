import React from 'react';
import { createPortal } from 'react-dom';
import { X, RefreshCw, BookOpen, AlertTriangle, ShieldAlert, Factory } from 'lucide-react';
import { useModalEscape } from '../../services/keyboardShortcuts';

export interface EnrichedDetails {
  activeIngredients?: string[];
  indications?: string;
  warnings?: string;
  sideEffects?: string;
  manufacturer?: string;
  enrichmentSource?: string;
  [key: string]: unknown;
}

export interface OpenFDADrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedItem: { medicine_name?: string; [key: string]: unknown } | null;
  enrichedData: EnrichedDetails | null;
  loading: boolean;
}

export const OpenFDADrawer: React.FC<OpenFDADrawerProps> = ({
  isOpen,
  onClose,
  selectedItem,
  enrichedData,
  loading,
}) => {
  useModalEscape(isOpen, onClose);
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`fixed top-0 right-0 h-full w-full max-w-[450px] bg-bg2 border-l border-border transition-all duration-300 ease-in-out z-drawer flex flex-col pt-16 ${
        isOpen
          ? 'translate-x-0 shadow-2xl pointer-events-auto'
          : 'translate-x-full shadow-none pointer-events-none'
      }`}
    >
      {selectedItem && (
        <>
          {/* Header */}
          <div className="p-6 border-b border-border flex justify-between items-center bg-bg3">
            <div className="min-w-0 flex-1 mr-4">
              <span className="text-xs font-bold uppercase tracking-wider text-purple-400 px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 mb-1 inline-block">
                Medical Profile
              </span>
              <h4
                className="text-xl font-bold mt-1 text-text truncate"
                title={selectedItem.medicine_name}
              >
                {selectedItem.medicine_name}
              </h4>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-bg border border-border text-muted hover:text-text transition-colors shrink-0"
              aria-label="Close panel"
            >
              <X size={20} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="space-y-5">
              <h5 className="text-xs font-bold uppercase tracking-widest text-muted border-b border-border pb-2">
                openFDA Intelligence
              </h5>

              {loading ? (
                <div className="flex flex-col items-center justify-center py-10 space-y-3">
                  <RefreshCw className="animate-spin text-purple-500" size={24} />
                  <span className="text-sm text-muted">Retrieving OpenFDA monographs...</span>
                </div>
              ) : enrichedData ? (
                <div className="space-y-5 fade-in">
                  {/* Active Ingredients */}
                  <div>
                    <span className="text-xs text-muted uppercase font-bold block mb-2">
                      Active Ingredients
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {enrichedData.activeIngredients && enrichedData.activeIngredients.length > 0 ? (
                        enrichedData.activeIngredients.map((ing: string, i: number) => (
                          <span
                            key={i}
                            className="px-3 py-1 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20"
                          >
                            {ing}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-muted italic">Generic formula not indexed.</span>
                      )}
                    </div>
                  </div>

                  {/* Indications */}
                  <div className="space-y-1.5">
                    <span className="text-xs text-muted uppercase font-bold flex items-center gap-1.5 text-sky">
                      <BookOpen size={14} className="text-sky" /> Indications & Usage
                    </span>
                    <div className="bg-bg3 p-3 rounded-lg border border-border text-sm text-muted leading-relaxed max-h-48 overflow-y-auto">
                      {enrichedData.indications || 'Not available.'}
                    </div>
                  </div>

                  {/* Warnings */}
                  <div className="space-y-1.5">
                    <span className="text-xs text-muted uppercase font-bold flex items-center gap-1.5 text-yellow-500">
                      <AlertTriangle size={14} /> Warnings & Precautions
                    </span>
                    <div className="bg-yellow-500/5 p-3 rounded-lg border border-yellow-500/20 text-sm text-yellow-200/80 leading-relaxed max-h-48 overflow-y-auto">
                      {enrichedData.warnings || 'No active drug safety warnings.'}
                    </div>
                  </div>

                  {/* Side Effects */}
                  <div className="space-y-1.5">
                    <span className="text-xs text-muted uppercase font-bold flex items-center gap-1.5 text-red-500">
                      <ShieldAlert size={14} /> Adverse Reactions
                    </span>
                    <div className="bg-red-500/5 p-3 rounded-lg border border-red-500/20 text-sm text-red-300 leading-relaxed max-h-48 overflow-y-auto">
                      {enrichedData.sideEffects || 'No common adverse reactions logged.'}
                    </div>
                  </div>

                  {/* Source and Manufacturer */}
                  <div className="pt-2 flex justify-between items-center text-xs text-muted">
                    <span className="flex items-center gap-1">
                      <Factory size={12} /> Mfg: {enrichedData.manufacturer || 'Unknown'}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-green-500/10 border border-green-500/20 text-green-500 font-bold uppercase text-[10px] tracking-wide">
                      Source: {enrichedData.enrichmentSource || 'FDA'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-6 text-muted italic">No enrichment profile found.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>,
    document.body
  );
};
