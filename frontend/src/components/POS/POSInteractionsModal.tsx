import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { BaseModal } from '../common/BaseModal';

export interface DrugInteractionItem {
  drugAName: string;
  drugBName: string;
  severity: string;
  interactingEntity: string;
}

interface POSInteractionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  drugInteractions: DrugInteractionItem[];
}

export const POSInteractionsModal: React.FC<POSInteractionsModalProps> = ({
  isOpen,
  onClose,
  drugInteractions,
}) => {
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2 text-rose-400">
          <ShieldAlert size={20} />
          <span className="text-sm font-bold text-text">Clinical Drug Interaction Analysis</span>
        </div>
      }
      maxWidth="max-w-lg"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-1.5 rounded-lg bg-bg border border-glass-border text-text font-semibold text-xs hover:bg-bg3"
        >
          Acknowledge &amp; Close
        </button>
      }
    >
      <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-1">
        {drugInteractions.map((item, idx) => (
          <div key={idx} className="p-3.5 rounded-xl bg-bg border border-border/40 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-text">{item.drugAName} ⚡ {item.drugBName}</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-rose-500/20 text-rose-300 border border-rose-500/30">
                {item.severity}
              </span>
            </div>
            <p className="text-muted leading-relaxed">
              Triggered by active substance: <strong className="text-text">{item.interactingEntity}</strong>.
              Dispensing these medications concurrently may cause adverse reactions. Please verify clinical intent with the prescribing physician.
            </p>
          </div>
        ))}
      </div>
    </BaseModal>
  );
};
