import React from 'react';
import { MessageSquare, RefreshCw, CheckCircle } from 'lucide-react';
import { BaseModal } from '../../components/common/BaseModal';

interface TemplateEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  globalTemplate: string;
  setGlobalTemplate: (val: string) => void;
  onSave: () => void;
  saving?: boolean;
  savingTemplate?: boolean;
}

export const TemplateEditorModal: React.FC<TemplateEditorModalProps> = ({
  isOpen,
  onClose,
  globalTemplate,
  setGlobalTemplate,
  onSave,
  saving,
  savingTemplate,
}) => {
  const isSaving = saving ?? savingTemplate ?? false;
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2 text-base font-bold text-text">
          <MessageSquare className="text-amber-400" size={18} />
          <span>Edit Default Reminder Message Template</span>
        </div>
      }
      maxWidth="max-w-lg"
      footer={
        <div className="flex justify-end gap-2 w-full">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-bg3 hover:bg-bg3/80 text-muted font-bold text-xs cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="px-4 py-2 rounded-xl bg-primary text-white font-bold text-xs hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer shadow-md"
          >
            {isSaving ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle size={13} />}
            <span>Save Template</span>
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-muted">
          Customize the default format used for auto-reminders and manual dispatches. Use placeholder tags to insert live data dynamically.
        </p>

        <div className="space-y-1.5">
          <label className="text-xs font-bold text-text">Template Format:</label>
          <textarea
            rows={4}
            value={globalTemplate}
            onChange={e => setGlobalTemplate(e.target.value)}
            className="w-full p-3 rounded-xl bg-bg text-text font-mono text-xs border border-glass-border focus:outline-none focus:border-amber-400/60 leading-relaxed"
            placeholder="📦 Has today's order been dispatched or collected by {delivery_boy} ({phone})? - {store_name}"
          />
        </div>

        <div className="p-3 rounded-xl bg-bg/50 border border-glass-border text-[11px] space-y-1 text-muted">
          <p className="font-bold text-text">Available Dynamic Placeholders:</p>
          <div className="flex flex-wrap gap-1.5 font-mono text-[10px]">
            <span className="px-1.5 py-0.5 rounded bg-bg3 text-amber-300 font-bold">{'{distributor_name}'}</span>
            <span className="px-1.5 py-0.5 rounded bg-bg3 text-sky font-bold">{'{delivery_boy}'}</span>
            <span className="px-1.5 py-0.5 rounded bg-bg3 text-emerald-300 font-bold">{'{phone}'}</span>
            <span className="px-1.5 py-0.5 rounded bg-bg3 text-purple-300 font-bold">{'{store_name}'}</span>
          </div>
        </div>
      </div>
    </BaseModal>
  );
};
