import React from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, Printer, MessageSquare } from 'lucide-react';
import { api } from '../../services/api';
import { toastEvent } from '../../services/events';

export interface SavedBillItem {
  name?: string;
  batch?: string;
  qty?: number | string;
  looseQty?: number | string;
  discountPer?: number | string;
  amount?: number | string;
  [key: string]: any;
}

export interface CreditDueRow {
  invoice_no: string;
  total_amount: number | string;
}

export interface POSPostSaleModalProps {
  isOpen: boolean;
  onClose: () => void;
  posShopDetails: {
    name?: string;
    address?: string;
    phone?: string;
    drugLicense?: string;
    gstin?: string;
  };
  lastSavedInvoiceNo: string;
  lastSavedPatientName: string;
  lastSavedPatientPhone: string;
  lastSavedDoctorName: string;
  lastSavedPaymentMedium: string;
  lastSavedItems: SavedBillItem[];
  lastSavedBillDiscount: number;
  lastSavedGrandTotal: number | string;
  lastSavedCreditDues?: CreditDueRow[] | null;
  lastSavedCreditBalance?: number | string;
  lastSavedNextRefillDue?: string | null;
  lastSavedWasWhatsAppSent: boolean;
  setLastSavedWasWhatsAppSent: React.Dispatch<React.SetStateAction<boolean>>;
  printCurrentBill: (fileNameBase?: any) => void;
}

export const POSPostSaleModal: React.FC<POSPostSaleModalProps> = ({
  isOpen,
  onClose,
  posShopDetails,
  lastSavedInvoiceNo,
  lastSavedPatientName,
  lastSavedPatientPhone,
  lastSavedDoctorName,
  lastSavedPaymentMedium,
  lastSavedItems,
  lastSavedBillDiscount,
  lastSavedGrandTotal,
  lastSavedCreditDues,
  lastSavedCreditBalance,
  lastSavedNextRefillDue,
  lastSavedWasWhatsAppSent,
  setLastSavedWasWhatsAppSent,
  printCurrentBill,
}) => {
  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  return (
    <>
      {/* Hidden printable bill container for window.print() */}
      {createPortal(
        <div id="printable-bill" data-print-root className="hidden">
          <div style={{ textAlign: 'center', marginBottom: '12px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: '0 0 2px 0', color: '#000' }}>
              {posShopDetails.name || 'AI PHARMACY OS'}
            </h2>
            {posShopDetails.address && (
              <p style={{ fontSize: '10px', color: '#555', margin: '0' }}>{posShopDetails.address}</p>
            )}
            <p style={{ fontSize: '11px', color: '#444', margin: '2px 0' }}>
              {[
                posShopDetails.phone ? `Ph: ${posShopDetails.phone}` : '',
                posShopDetails.drugLicense ? `D.L. No: ${posShopDetails.drugLicense}` : '',
                posShopDetails.gstin ? `GSTIN: ${posShopDetails.gstin}` : '',
              ]
                .filter(Boolean)
                .join(' | ')}
            </p>
            <p style={{ fontSize: '12px', color: '#555', margin: '2px 0', fontWeight: 'bold' }}>
              Tax Invoice / Retail Counter Receipt
            </p>
            <div style={{ borderBottom: '1px solid #ddd', margin: '8px 0' }}></div>
          </div>
          <div
            style={{
              fontSize: '12px',
              marginBottom: '12px',
              display: 'flex',
              justifyContent: 'space-between',
              color: '#000',
            }}
          >
            <div>
              <p style={{ margin: '2px 0' }}>
                <strong>Invoice No:</strong> #{lastSavedInvoiceNo}
              </p>
              <p style={{ margin: '2px 0' }}>
                <strong>Customer:</strong> {lastSavedPatientName}
              </p>
              {lastSavedPatientPhone && (
                <p style={{ margin: '2px 0' }}>
                  <strong>Phone:</strong> {lastSavedPatientPhone}
                </p>
              )}
              {lastSavedDoctorName && (
                <p style={{ margin: '2px 0' }}>
                  <strong>Doctor:</strong> {lastSavedDoctorName}
                </p>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: '2px 0' }}>
                <strong>Date:</strong> {new Date().toLocaleDateString()}
              </p>
              <p style={{ margin: '2px 0' }}>
                <strong>Payment:</strong> {lastSavedPaymentMedium}
              </p>
            </div>
          </div>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '11px',
              marginBottom: '15px',
              color: '#000',
            }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid #000', textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left', padding: '6px 2px' }}>Item Name</th>
                <th style={{ textAlign: 'left', padding: '6px 2px' }}>Batch</th>
                <th style={{ textAlign: 'center', padding: '6px 2px' }}>Qty</th>
                <th style={{ textAlign: 'center', padding: '6px 2px' }}>Loose</th>
                {lastSavedItems.some((item) => Number(item.discountPer || 0) > 0) && (
                  <th style={{ textAlign: 'center', padding: '6px 2px' }}>Disc%</th>
                )}
                <th style={{ textAlign: 'right', padding: '6px 2px' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {lastSavedItems.map((item, idx) => (
                <tr key={idx} style={{ borderBottom: '1px dotted #ccc' }}>
                  <td style={{ padding: '6px 2px' }}>{item.name}</td>
                  <td style={{ padding: '6px 2px' }}>{item.batch}</td>
                  <td style={{ padding: '6px 2px', textAlign: 'center' }}>{item.qty}</td>
                  <td style={{ padding: '6px 2px', textAlign: 'center' }}>{item.looseQty || 0}</td>
                  {lastSavedItems.some((it) => Number(it.discountPer || 0) > 0) && (
                    <td style={{ padding: '6px 2px', textAlign: 'center' }}>
                      {Number(item.discountPer || 0) > 0 ? `${item.discountPer}%` : '-'}
                    </td>
                  )}
                  <td style={{ padding: '6px 2px', textAlign: 'right', fontWeight: 600 }}>
                    ₹{Number(item.amount || 0).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div
            style={{
              borderTop: '2px solid #000',
              paddingTop: '8px',
              textAlign: 'right',
              fontSize: '12px',
              color: '#000',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', maxWidth: '260px', marginLeft: 'auto' }}>
              <span>Subtotal:</span>
              <span>₹{lastSavedItems.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2)}</span>
            </div>
            {lastSavedBillDiscount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', maxWidth: '260px', marginLeft: 'auto' }}>
                <span>Discount:</span>
                <span>-₹{Number(lastSavedBillDiscount).toFixed(2)}</span>
              </div>
            )}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                maxWidth: '260px',
                marginLeft: 'auto',
                fontWeight: 'bold',
                fontSize: '14px',
                marginTop: '4px',
                borderTop: '1px solid #000',
                paddingTop: '4px',
              }}
            >
              <span>Grand Total:</span>
              <span>₹{Number(lastSavedGrandTotal).toFixed(2)}</span>
            </div>
          </div>
          {lastSavedPaymentMedium === 'CREDIT' && lastSavedCreditDues && lastSavedCreditDues.length > 0 && (
            <div style={{ marginTop: '14px', border: '1px solid #000', padding: '8px 10px', fontSize: '11px', color: '#000' }}>
              <div
                style={{
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  borderBottom: '1px solid #999',
                  paddingBottom: '3px',
                  marginBottom: '5px',
                }}
              >
                Credit Invoices Due - {lastSavedPatientName}
              </div>
              {lastSavedCreditDues.map((due, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}>
                  <span>#{due.invoice_no}</span>
                  <span>₹{Number(due.total_amount).toFixed(2)}</span>
                </div>
              ))}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontWeight: 'bold',
                  borderTop: '1px solid #000',
                  marginTop: '4px',
                  paddingTop: '3px',
                  fontSize: '13px',
                }}
              >
                <span>Total Credit Balance:</span>
                <span>₹{Number(lastSavedCreditBalance).toFixed(2)}</span>
              </div>
            </div>
          )}
          {lastSavedPaymentMedium === 'CREDIT' && lastSavedNextRefillDue && (
            <div
              style={{
                marginTop: '10px',
                fontSize: '11px',
                color: '#000',
                background: '#f3f4f6',
                border: '1px dashed #666',
                padding: '6px 10px',
              }}
            >
              Next Refill Due: {new Date(lastSavedNextRefillDue).toLocaleDateString('en-IN')}
            </div>
          )}
          <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '11px', color: '#777' }}>
            Thank you for your visit! &middot; Get Well Soon
          </div>
        </div>,
        document.body
      )}

      {/* Post-Sale Saved Bill Confirmation Modal */}
      {createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/70 fade-in">
          <div className="bg-bg border border-border rounded-2xl w-[95vw] max-w-md shadow-2xl overflow-hidden flex flex-col p-6 space-y-5">
            <div className="text-center space-y-2">
              <div className="inline-flex p-3 rounded-full bg-green/10 border border-green/20 text-green mb-1">
                <CheckCircle size={32} className="animate-bounce" />
              </div>
              <h3 className="text-lg font-bold text-text">Sale Saved Successfully!</h3>
              <p className="text-xs text-muted">
                Invoice No: <span className="font-mono text-sky font-semibold">#{lastSavedInvoiceNo}</span>
              </p>
            </div>

            <div className="bg-bg2 border border-border p-4 rounded-xl space-y-2.5">
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted font-medium">Customer:</span>
                <span className="font-bold text-text">{lastSavedPatientName}</span>
              </div>
              {lastSavedPatientPhone && (
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted font-medium">Contact Phone:</span>
                  <span className="font-mono text-text font-semibold">{lastSavedPatientPhone}</span>
                </div>
              )}
              <div className="flex justify-between items-center text-xs pt-2 border-t border-border">
                <span className="text-muted font-medium">Total Amount:</span>
                <span className="font-mono font-black text-primary text-sm">₹{lastSavedGrandTotal}</span>
              </div>
            </div>

            {/* SMS Status / Manual Dispatch option */}
            <div className="p-3.5 rounded-xl border text-xs flex items-center gap-3 bg-bg3 border-border">
              <MessageSquare
                size={18}
                className={lastSavedWasWhatsAppSent ? 'text-green shrink-0' : 'text-muted shrink-0'}
              />
              <div className="flex-1 min-w-0">
                {lastSavedPaymentMedium === 'CREDIT' ? (
                  <p className="font-semibold text-amber-500 text-[11px] leading-tight">
                    ⚡ Credit Sale: Instant SMS/WhatsApp message sent automatically
                  </p>
                ) : lastSavedWasWhatsAppSent ? (
                  <p className="font-semibold text-green text-[11px] leading-tight">
                    ✅ SMS/WhatsApp message sent to customer
                  </p>
                ) : lastSavedPatientPhone ? (
                  <p className="text-muted text-[11px] leading-tight">SMS message not sent (WA toggle was OFF).</p>
                ) : (
                  <p className="text-muted text-[11px] italic leading-tight">No phone number saved for this sale.</p>
                )}
              </div>
              {!lastSavedWasWhatsAppSent && lastSavedPatientPhone && lastSavedInvoiceNo && (
                <button
                  onClick={async () => {
                    try {
                      const res = await api.sendWhatsappMessage(
                        lastSavedPatientPhone,
                        `Dear ${lastSavedPatientName},\n\n📄 *Sale Invoice: #${lastSavedInvoiceNo}*\nAmount Paid: ₹${lastSavedGrandTotal}\nThank you for your purchase!\n— AI Pharmacy OS`
                      );
                      if (res && res.success !== false) {
                        setLastSavedWasWhatsAppSent(true);
                        toastEvent.trigger('WhatsApp message sent successfully!', 'success');
                      } else {
                        toastEvent.trigger('Failed to send message.', 'error');
                      }
                    } catch (err) {
                      console.error(err);
                      toastEvent.trigger('Error sending message', 'error');
                    }
                  }}
                  className="px-2.5 py-1.5 rounded-lg text-[10px] font-extrabold uppercase bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all shrink-0"
                >
                  Send SMS
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <button
                onClick={() =>
                  printCurrentBill(`Invoice-${lastSavedInvoiceNo}-${lastSavedPatientName || 'Walk-in'}`)
                }
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold uppercase tracking-wider bg-primary text-white hover:bg-primary/90 transition-all flex items-center justify-center gap-2"
              >
                <Printer size={14} /> Print Bill
              </button>

              <button
                onClick={onClose}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold uppercase tracking-wider bg-bg2 border border-border text-muted hover:text-text hover:bg-bg3 transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle size={14} /> Done / Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};
