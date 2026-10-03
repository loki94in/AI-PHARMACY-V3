import React from 'react';
import { CreditCard, ExternalLink, Camera, Check, X, Upload, CheckCircle2, Clock, RefreshCw } from 'lucide-react';
import { BaseModal } from '../../components/common/BaseModal';

export interface PaymentQrModalData {
  isOpen: boolean;
  orderId: number;
  amount: number;
  upiUri: string;
  upiId: string;
  payeeName: string;
  label: string;
  isPaidMarked?: boolean;
}

interface PaymentQrModalProps {
  modalData: PaymentQrModalData | null;
  onClose: () => void;
  screenshotFile: File | null;
  screenshotPreview: string | null;
  onScreenshotChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveScreenshot: () => void;
  onMarkPaid: () => void;
  isMarkingPaid: boolean;
}

export const PaymentQrModal: React.FC<PaymentQrModalProps> = ({
  modalData,
  onClose,
  screenshotFile,
  screenshotPreview,
  onScreenshotChange,
  onRemoveScreenshot,
  onMarkPaid,
  isMarkingPaid,
}) => {
  if (!modalData || !modalData.isOpen) return null;

  return (
    <BaseModal
      isOpen={modalData.isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-primary" />
          <div>
            <h3 className="text-sm font-bold text-text">Scan &amp; Pay via UPI</h3>
            <span className="text-[11px] text-muted block">{modalData.label}</span>
          </div>
        </div>
      }
      maxWidth="max-w-sm"
      footer={
        <div className="w-full space-y-2">
          {!modalData.isPaidMarked ? (
            <button
              onClick={onMarkPaid}
              disabled={isMarkingPaid}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2 text-xs disabled:opacity-50 cursor-pointer"
            >
              {isMarkingPaid ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              <span>I HAVE PAID</span>
            </button>
          ) : (
            <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-500 text-xs font-semibold flex items-center justify-center gap-1.5">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>Payment Reported — Awaiting Pharmacy Verification</span>
            </div>
          )}

          <button
            onClick={onClose}
            className="w-full py-1.5 text-xs text-muted hover:text-text font-medium cursor-pointer"
          >
            {modalData.isPaidMarked ? 'Close & View Orders' : 'Cancel & Close'}
          </button>
        </div>
      }
    >
      <div className="space-y-4 text-center">
        {/* Total Amount Badge */}
        <div className="p-3 bg-primary/10 rounded-xl border border-primary/20">
          <span className="text-[11px] text-muted block mb-0.5">Total Payable Amount</span>
          <span className="text-xl font-extrabold text-primary">₹{modalData.amount.toFixed(2)}</span>
        </div>

        {/* QR Code Container */}
        <div className="p-3 bg-bg3 rounded-xl border border-border inline-block shadow-sm mx-auto">
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(modalData.upiUri)}`}
            alt="UPI Payment QR"
            className="w-44 h-44 mx-auto"
          />
        </div>

        {/* UPI Account Details */}
        <div className="space-y-1.5 text-left bg-bg p-3 rounded-xl border border-border text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-muted">Payee:</span>
            <span className="font-semibold text-text">{modalData.payeeName}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted">UPI ID:</span>
            <span className="font-mono font-bold text-primary">{modalData.upiId}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted">Order Ref:</span>
            <span className="font-mono text-text">#{modalData.orderId}</span>
          </div>
        </div>

        {/* Direct Pay Link for Mobile */}
        <a
          href={modalData.upiUri}
          className="w-full py-2 bg-bg3 hover:bg-bg border border-border text-text rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span>Open in UPI App (GPay / PhonePe / Paytm)</span>
        </a>

        {/* Payment Screenshot Attachment (Proof) */}
        {!modalData.isPaidMarked && (
          <div className="text-left bg-bg p-3 rounded-xl border border-border space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-text flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-primary" />
                <span>Attach Payment Screenshot</span>
              </label>
              <span className="text-[10px] text-muted">(Recommended)</span>
            </div>

            {screenshotPreview ? (
              <div className="relative rounded-lg overflow-hidden border border-border bg-bg2 p-1.5 flex items-center gap-2">
                <img
                  src={screenshotPreview}
                  alt="Payment proof preview"
                  className="w-12 h-12 object-cover rounded-md border border-border"
                />
                <div className="flex-1 min-w-0 text-[11px]">
                  <p className="font-medium text-text truncate">{screenshotFile?.name || 'Screenshot attached'}</p>
                  <p className="text-[10px] text-emerald-500 font-semibold flex items-center gap-1">
                    <Check className="w-3 h-3" /> Ready to forward to pharmacy
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onRemoveScreenshot}
                  className="p-1 text-muted hover:text-red-400 rounded-md transition-colors"
                  title="Remove screenshot"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <label className="flex items-center justify-center gap-2 w-full p-2.5 rounded-lg border border-dashed border-border hover:border-primary/50 bg-bg2 hover:bg-bg3 cursor-pointer transition-colors text-xs text-muted hover:text-text">
                <Upload className="w-3.5 h-3.5 text-primary" />
                <span className="text-[11px]">Upload GPay / PhonePe / Paytm receipt</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onScreenshotChange}
                />
              </label>
            )}
          </div>
        )}
      </div>
    </BaseModal>
  );
};
