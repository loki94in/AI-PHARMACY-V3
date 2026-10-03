import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, FileText, Send, CheckCircle2, X, Users, Phone, QrCode, Zap, Package, RotateCcw } from 'lucide-react';
import type { SalesHistoryInvoice, SalesHistoryItemLine, LocalApiError } from './crmTypes';
import { formatDate } from './crmTypes';
import { useWaPhoneStatus } from '../../hooks/useWaPhoneStatus';
import { useModalEscape } from '../../services/keyboardShortcuts';
import { api, apiClient } from '../../services/api';
import { toastEvent, whatsappQueueEvent, messageSendEvent } from '../../services/events';
import { toDateInputValue } from '../../utils/date';

interface CreditCustomerItem {
  id: number;
  name: string;
  phone: string;
  address?: string;
  language?: string;
  credit_balance: number;
  credit_due_date?: string;
  unpaid_bills_count: number;
  last_sale_date?: string;
}

let cachedCreditCustomers: CreditCustomerItem[] = [];
let cachedSelectedCustomerId: number | null = null;

export const CustomerCreditSection: React.FC = () => {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<CreditCustomerItem[]>(cachedCreditCustomers);
  const [selectedCustomer, setSelectedCustomer] = useState<CreditCustomerItem | null>(() => {
    if (cachedCreditCustomers.length > 0) {
      const match = cachedCreditCustomers.find(c => c.id === cachedSelectedCustomerId);
      return match || cachedCreditCustomers[0];
    }
    return null;
  });
  const [customerInvoices, setCustomerInvoices] = useState<SalesHistoryInvoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [loading, setLoading] = useState(cachedCreditCustomers.length === 0);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newDueDate, setNewDueDate] = useState('');
  const [payingId, setPayingId] = useState<number | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [collectingPayment, setCollectingPayment] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);
  // WA registration check — disables credit WA reminder button when number confirmed not on WA
  const creditPhone = (selectedCustomer?.phone || '').replace(/\D/g, '').slice(-10);
  const { isNotOnWa: creditNotOnWa } = useWaPhoneStatus(creditPhone);
  const [viewInvoice, setViewInvoice] = useState<SalesHistoryInvoice | null>(null);

  const loadCustomerInvoices = useCallback(async (customerId: number) => {
    setLoadingInvoices(true);
    try {
      const res = await apiClient.get<SalesHistoryInvoice[]>(`/crm/${customerId}/history`);
      setCustomerInvoices(Array.isArray(res.data) ? res.data : []);
    } catch {
      toastEvent.trigger('Failed to load customer purchase bills', 'error', '/crm');
    } finally {
      setLoadingInvoices(false);
    }
  }, []);

  // Handle ESC key to close viewInvoice modal.
  const viewInvoiceRef = useRef(viewInvoice);
  useEffect(() => {
    viewInvoiceRef.current = viewInvoice;
  }, [viewInvoice]);

  // Universal Escape key dismissal for Credit Ledger viewInvoice modal
  useModalEscape(!!viewInvoice, () => setViewInvoice(null));

  const selectedCustomerIdRef = useRef<number | null>(null);
  useEffect(() => {
    selectedCustomerIdRef.current = selectedCustomer?.id ?? null;
    if (selectedCustomer?.id) {
      cachedSelectedCustomerId = selectedCustomer.id;
    }
  }, [selectedCustomer]);

  const loadCreditCustomers = useCallback(async () => {
    if (cachedCreditCustomers.length === 0) {
      setLoading(true);
    }
    const previousId = cachedSelectedCustomerId;
    try {
      const [res, invoicesRes] = await Promise.all([
        apiClient.get<CreditCustomerItem[]>('/crm/credit-customers'),
        previousId
          ? apiClient.get<SalesHistoryInvoice[]>(`/crm/${previousId}/history`).catch(() => null)
          : Promise.resolve(null)
      ]);
      const data = Array.isArray(res.data) ? res.data : [];
      cachedCreditCustomers = data;
      setCustomers(data);
      if (data.length > 0) {
        const match = data.find((c: CreditCustomerItem) => c.id === previousId);
        const active = match || data[0];
        cachedSelectedCustomerId = active.id;
        setSelectedCustomer(active);
        if (active.id === previousId && invoicesRes) {
          setCustomerInvoices(Array.isArray(invoicesRes.data) ? invoicesRes.data : []);
        } else {
          loadCustomerInvoices(active.id);
        }
      }
    } catch {
      toastEvent.trigger('Failed to load credit customers', 'error', '/crm');
    } finally {
      setLoading(false);
    }
  }, [loadCustomerInvoices]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- module-cache hydration loader
    loadCreditCustomers();
  }, [loadCreditCustomers]);

  const handleSaveDueDate = async (id: number) => {
    try {
      await apiClient.put(`/crm/credit-customers/${id}/due-date`, { due_date: newDueDate || null });
      toastEvent.trigger('Due date updated', 'success', '/crm');
      setEditingId(null);
      await loadCreditCustomers();
    } catch {
      toastEvent.trigger('Failed to update due date', 'error', '/crm');
    }
  };

  const [checkingOverdue, setCheckingOverdue] = useState(false);

  const handleCheckOverdueCredit = async () => {
    setCheckingOverdue(true);
    try {
      const res = await apiClient.post('/crm/credit-customers/check-overdue', {});
      toastEvent.trigger(res.data?.message || 'Overdue credit check completed', 'success', '/crm');
      await loadCreditCustomers();
      whatsappQueueEvent.triggerUpdated();
    } catch (err) {
      toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to check overdue credit', 'error', '/crm');
    } finally {
      setCheckingOverdue(false);
    }
  };

  const handleSendManualReminder = async (cust: CreditCustomerItem) => {
    setSendingId(cust.id);
    try {
      messageSendEvent.triggerSendProgress(cust.name || 'Customer', 'Dispatching WhatsApp credit reminder...', 10);
      await apiClient.post(`/crm/credit-customers/${cust.id}/send-reminder`, {});
      toastEvent.trigger(`Manual credit reminder sent to ${cust.name}`, 'success', '/crm');
      whatsappQueueEvent.triggerUpdated();
    } catch (err) {
      toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to send WhatsApp reminder', 'error', '/crm');
    } finally {
      setSendingId(null);
    }
  };

  const handlePayBalance = async (id: number) => {
    const amt = parseFloat(payAmount);
    if (isNaN(amt) || amt <= 0) {
      toastEvent.trigger('Enter a valid payment amount', 'error', '/crm');
      return;
    }
    setCollectingPayment(true);
    try {
      const res = await apiClient.post('/crm/ledger/pay', { amount: amt, customer_id: id });
      const successMsg = res.data?.message || `Collected ₹${amt.toFixed(2)} payment`;
      toastEvent.trigger(successMsg, 'success', '/crm');
      setPayingId(null);
      setPayAmount('');
      await loadCreditCustomers();
    } catch (err) {
      toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to process payment', 'error', '/crm');
    } finally {
      setCollectingPayment(false);
    }
  };

  const handleClearCredit = async (id: number, name: string) => {
    try {
      await apiClient.post(`/crm/credit-customers/${id}/clear`);
      toastEvent.trigger(`Cleared credit entry for ${name}`, 'success', '/crm');
      setSelectedCustomer(null);
      await loadCreditCustomers();
    } catch {
      toastEvent.trigger('Failed to clear customer credit', 'error', '/crm');
    }
  };

  const filtered = customers.filter(c => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.phone && c.phone.includes(q))
    );
  });

  const totalDues = customers.reduce((sum, c) => sum + (c.credit_balance || 0), 0);

  return (
    <div className="w-full h-full flex flex-col gap-3 overflow-hidden pr-1">
      {/* Header Cards & Quick Search */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 shrink-0">
        <div className="p-3.5 bg-bg border border-border rounded-2xl flex items-center justify-between shadow-sm">
          <div>
            <p className="text-[11px] text-muted font-medium">Total Medical Outstanding Dues</p>
            <h3 className="text-lg font-bold text-amber-400 mt-0.5">₹{totalDues.toFixed(2)}</h3>
          </div>
          <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Users size={18} />
          </div>
        </div>

        <div className="p-3.5 bg-bg border border-border rounded-2xl flex items-center justify-between shadow-sm">
          <div>
            <p className="text-[11px] text-muted font-medium">Active Credit Customers</p>
            <h3 className="text-lg font-bold text-text mt-0.5">{customers.length} Customers</h3>
          </div>
          <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <Users size={18} />
          </div>
        </div>

        <div className="p-3.5 bg-bg border border-border rounded-2xl flex items-center gap-2 shadow-sm">
          <button
            onClick={loadCreditCustomers}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-bg3 border border-border text-xs font-bold text-text hover:text-primary transition-all disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
          <button
            onClick={handleCheckOverdueCredit}
            disabled={checkingOverdue}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-primary/10 border border-primary/20 text-xs font-bold text-primary hover:bg-primary/20 transition-all disabled:opacity-50"
            title="Scan overdue credit accounts and queue amount-specific UPI QR reminders"
          >
            <QrCode size={14} className={checkingOverdue ? 'animate-spin' : ''} />
            <span>Check Overdue (QR)</span>
          </button>
        </div>
      </div>

      {/* Split-View Container */}
      <div className="flex-1 flex flex-col md:flex-row gap-3 overflow-hidden min-h-0">
        {/* LEFT PANEL: Customer Credit Accounts List */}
        <div className="w-full md:w-80 lg:w-96 shrink-0 bg-bg border border-border rounded-2xl flex flex-col overflow-hidden shadow-sm">
          <div className="p-3 border-b border-border bg-bg3/40 flex items-center justify-between">
            <h3 className="text-xs font-bold text-text uppercase tracking-wider flex items-center gap-1.5">
              <Users size={14} className="text-amber-400" />
              Credit Customers / Accounts
            </h3>
            <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full font-bold">
              {filtered.length}
            </span>
          </div>

          {/* Search Input */}
          <div className="p-2 border-b border-border bg-bg">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-2.5 text-muted" />
              <input
                type="text"
                placeholder="Search customer name, mobile or barcode..."
                value={search}
                onChange={e => {
                  const val = e.target.value;
                  setSearch(val.includes('|') ? val.split('|')[0].trim() : val);
                }}
                className="w-full pl-8 pr-2.5 py-1.5 bg-bg2 border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* Customer Cards List */}
          <div className="flex-1 overflow-y-auto divide-y divide-border/30">
            {loading && customers.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted">Loading credit customers...</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted">No credit customers found.</div>
            ) : (
              filtered.map(cust => {
                const isSelected = selectedCustomer?.id === cust.id;
                return (
                  <div
                    key={cust.id}
                    onClick={() => {
                      setSelectedCustomer(cust);
                      loadCustomerInvoices(cust.id);
                    }}
                    className={`p-3 cursor-pointer transition-all flex items-center justify-between hover:bg-primary/5 ${
                      isSelected ? 'bg-primary/10 border-l-4 border-primary font-semibold' : ''
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold text-text flex items-center gap-1.5">
                        <span>{cust.name || 'Unnamed Patient'}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky/10 text-sky border border-sky/20 font-medium">UPI QR</span>
                      </div>
                      <div className="text-[10px] text-muted flex items-center gap-1.5 mt-0.5">
                        <span>📱 {cust.phone || 'No phone'}</span>
                        <span>•</span>
                        <span>{cust.unpaid_bills_count} Unpaid Bill(s)</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold text-amber-400">₹{(cust.credit_balance || 0).toFixed(2)}</div>
                      <div className="text-[9px] text-muted mt-0.5">
                        {cust.credit_due_date ? `Due: ${formatDate(cust.credit_due_date)}` : 'No Due Date'}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT PANEL: Selected Account Purchases & Actions */}
        <div className="flex-1 bg-bg2 border border-border rounded-2xl flex flex-col overflow-hidden shadow-sm">
          {selectedCustomer ? (
            <>
              {/* Account Header */}
              <div className="p-3.5 border-b border-border bg-bg3/30 flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-text">{selectedCustomer.name || 'Unnamed Patient'}</h2>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      CREDIT ACCOUNT
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-bg3 text-text border border-border">
                      {selectedCustomer.language === 'hi' ? '🇮🇳 HI' : selectedCustomer.language === 'mr' ? '🇮🇳 MR' : '🇬🇧 EN'}
                    </span>
                  </div>
                  <div className="text-xs text-muted mt-0.5 flex items-center gap-3">
                    <span>📱 {selectedCustomer.phone || 'No phone'}</span>
                    {selectedCustomer.address && <span>📍 {selectedCustomer.address}</span>}
                  </div>
                </div>

                {/* Right Side Balance & Action Buttons */}
                <div className="flex items-center gap-3">
                  <div className="text-right pr-2">
                    <div className="text-[10px] text-muted font-medium uppercase tracking-wider">Outstanding Balance</div>
                    <div className="text-base font-extrabold text-amber-400">₹{(selectedCustomer.credit_balance || 0).toFixed(2)}</div>
                  </div>

                  {/* Collect Payment Action Toggle */}
                  <button
                    onClick={() => {
                      if (payingId === selectedCustomer.id) {
                        setPayingId(null);
                      } else {
                        setPayingId(selectedCustomer.id);
                        setPayAmount(String(selectedCustomer.credit_balance || 0));
                      }
                    }}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-all flex items-center gap-1.5 ${
                      payingId === selectedCustomer.id
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                    }`}
                  >
                    <Zap size={14} className={payingId === selectedCustomer.id ? 'animate-pulse' : ''} />
                    <span>{payingId === selectedCustomer.id ? 'Cancel Payment' : 'Collect Payment'}</span>
                  </button>

                  {/* WhatsApp Reminder Button — disabled when number confirmed NOT on WA */}
                  <button
                    onClick={() => !creditNotOnWa && handleSendManualReminder(selectedCustomer)}
                    disabled={sendingId === selectedCustomer.id || creditNotOnWa}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      creditNotOnWa
                        ? 'bg-rose-500/10 text-rose-400/60 border border-rose-500/20 cursor-not-allowed opacity-60'
                        : 'bg-primary hover:bg-primary/90 text-white disabled:opacity-50 cursor-pointer'
                    }`}
                    title={creditNotOnWa ? 'This number is not registered on WhatsApp' : 'Send instant manual credit reminder on WhatsApp with UPI QR & Statement PDF'}
                  >
                    <QrCode size={13} className={sendingId === selectedCustomer.id ? 'animate-pulse' : ''} />
                    <span>{creditNotOnWa ? 'Not on WhatsApp' : 'Send WhatsApp Reminder + QR'}</span>
                  </button>

                  {/* Clear Credit Entry Button */}
                  <button
                    onClick={() => handleClearCredit(selectedCustomer.id, selectedCustomer.name || 'Customer')}
                    className="px-3 py-1.5 rounded-xl bg-red-500/10 text-red border border-red-500/30 hover:bg-red-500/20 text-xs font-bold transition-all"
                    title="Clear credit balance and remove entry from CRM credit list"
                  >
                    Clear Entry
                  </button>

                  {/* New Sale → POS Button */}
                  <button
                    onClick={() => navigate('/pos', {
                      state: {
                        prefill: {
                          patientName: selectedCustomer.name,
                          patientPhone: selectedCustomer.phone
                        }
                      }
                    })}
                    className="px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 text-xs font-bold transition-all flex items-center gap-1.5"
                    title="Open POS with this patient pre-filled"
                  >
                    <Package size={13} />
                    New Sale → POS
                  </button>
                </div>
              </div>

              {/* LIVE ANIMATED PAYMENT CALCULATION & AUTO-RECEIPT PANEL */}
              {payingId === selectedCustomer.id && (() => {
                const originalBal = selectedCustomer.credit_balance || 0;
                const enteredPay = parseFloat(payAmount) || 0;
                const liveRemaining = Math.max(0, originalBal - enteredPay);
                const payPercent = Math.min(100, Math.max(0, (enteredPay / (originalBal || 1)) * 100));
                const isFullPay = enteredPay >= originalBal && originalBal > 0;

                return (
                  <div className="p-3.5 bg-gradient-to-r from-emerald-500/10 via-bg3 to-bg2 border-b border-emerald-500/30 flex flex-col gap-2.5 transition-all duration-300 ease-out animate-in fade-in slide-in-from-top-1 shrink-0">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      {/* Input & Quick Percent Chips */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                          <Zap size={14} className="text-emerald-400 animate-bounce" />
                          Collect Amount:
                        </span>
                        <div className="relative flex items-center">
                          <span className="absolute left-2.5 text-xs font-bold text-muted">₹</span>
                          <input
                            type="number"
                            placeholder="0.00"
                            value={payAmount}
                            onChange={e => setPayAmount(e.target.value)}
                            className="w-32 pl-6 pr-2.5 py-1.5 bg-bg border border-emerald-500/40 rounded-xl text-xs font-bold text-text focus:outline-none focus:ring-2 focus:ring-emerald-500/50 shadow-inner"
                            autoFocus
                          />
                        </div>

                        {/* Quick preset chips */}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setPayAmount(String(originalBal))}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${isFullPay ? 'bg-emerald-500 text-white shadow-sm' : 'bg-bg3 text-muted hover:text-text border border-border'}`}
                          >
                            100% Full (₹{originalBal.toFixed(2)})
                          </button>
                          <button
                            type="button"
                            onClick={() => setPayAmount(String((originalBal * 0.5).toFixed(2)))}
                            className="px-2 py-1 rounded-lg text-[10px] font-bold bg-bg3 text-muted hover:text-text border border-border transition-all"
                          >
                            50% (₹{(originalBal * 0.5).toFixed(2)})
                          </button>
                          <button
                            type="button"
                            onClick={() => setPayAmount(String((originalBal * 0.25).toFixed(2)))}
                            className="px-2 py-1 rounded-lg text-[10px] font-bold bg-bg3 text-muted hover:text-text border border-border transition-all"
                          >
                            25% (₹{(originalBal * 0.25).toFixed(2)})
                          </button>
                        </div>
                      </div>

                      {/* Action Button */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handlePayBalance(selectedCustomer.id)}
                          disabled={collectingPayment || enteredPay <= 0}
                          className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white font-bold text-xs shadow-md shadow-emerald-500/20 transition-all disabled:opacity-50"
                        >
                          <CheckCircle2 size={14} className={collectingPayment ? 'animate-spin' : ''} />
                          <span>{collectingPayment ? 'Collecting & Sending Receipt...' : `Confirm & Collect ₹${enteredPay.toFixed(2)}`}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPayingId(null)}
                          className="px-2.5 py-1.5 rounded-xl bg-bg3 border border-border text-muted hover:text-text text-xs font-semibold transition-all"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>

                    {/* Live Calculation Preview Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-border/40 text-xs">
                      <div className="flex items-center justify-between p-2 rounded-xl bg-bg/50 border border-border/50">
                        <span className="text-muted text-[11px]">Original Dues:</span>
                        <span className="font-bold text-amber-400">₹{originalBal.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                        <span className="text-emerald-400 text-[11px] font-medium">Paying Now:</span>
                        <span className="font-extrabold text-emerald-400">– ₹{enteredPay.toFixed(2)}</span>
                      </div>
                      <div className={`flex items-center justify-between p-2 rounded-xl border transition-all duration-300 ${liveRemaining === 0 ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400' : 'bg-bg/50 border-border/50 text-text'}`}>
                        <span className="text-[11px] font-medium">New Remaining Dues:</span>
                        <span className="font-extrabold text-xs transition-all duration-300">
                          {liveRemaining === 0 ? '✨ Fully Cleared (₹0.00)' : `₹${liveRemaining.toFixed(2)}`}
                        </span>
                      </div>
                    </div>

                    {/* Live Progress Bar & WhatsApp Auto Notice */}
                    <div className="w-full">
                      <div className="flex justify-between text-[10px] text-muted mb-1 font-medium">
                        <span>Dues Cleared: {payPercent.toFixed(0)}%</span>
                        <span className="text-emerald-400 font-semibold">
                          {selectedCustomer.phone ? '📱 Auto WhatsApp Receipt Will Be Sent' : 'No phone saved for WhatsApp'}
                        </span>
                      </div>
                      <div className="w-full h-2 bg-bg rounded-full overflow-hidden border border-border/40 p-0.5">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500 ease-out shadow-sm"
                          style={{ width: `${payPercent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Due Date Management Bar */}
              <div className="px-4 py-2 bg-bg border-b border-border flex items-center justify-between text-xs shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-muted font-medium">Agreed Credit Due Date:</span>
                  {editingId === selectedCustomer.id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="date"
                        value={toDateInputValue(newDueDate)}
                        onChange={e => setNewDueDate(e.target.value)}
                        className="px-2 py-0.5 bg-bg2 border border-border rounded text-xs text-text focus:outline-none"
                      />
                      <button onClick={() => handleSaveDueDate(selectedCustomer.id)} className="px-2 py-0.5 rounded bg-emerald-500 text-white font-bold text-[10px]">Save</button>
                      <button onClick={() => setEditingId(null)} className="px-2 py-0.5 text-muted text-[10px]">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className={selectedCustomer.credit_due_date ? 'text-text font-bold' : 'text-muted italic'}>
                        {selectedCustomer.credit_due_date ? formatDate(selectedCustomer.credit_due_date) : 'Not Set'}
                      </span>
                      <button onClick={() => { setEditingId(selectedCustomer.id); setNewDueDate(selectedCustomer.credit_due_date || ''); }} className="text-[10px] text-primary hover:underline font-bold">
                        Edit Date
                      </button>
                    </div>
                  )}
                </div>
                <span className="text-muted text-[11px] font-medium">{customerInvoices.length} Credit Purchase Bill(s)</span>
              </div>

              {/* Credit Purchase History Table */}
              <div className="flex-1 overflow-y-auto p-4">
                <h4 className="text-xs font-bold text-text uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <FileText size={14} className="text-primary" />
                  Credit Purchase History &amp; Bills
                </h4>

                {loadingInvoices ? (
                  <div className="p-8 text-center text-xs text-muted">Loading purchase bills...</div>
                ) : customerInvoices.length === 0 ? (
                  <div className="p-8 text-center text-xs text-muted">No credit purchase bills found for this customer.</div>
                ) : (
                  <div className="overflow-x-auto border border-border rounded-xl">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-bg3/50 border-b border-border text-muted font-bold">
                          <th className="p-2.5">Purchase Date</th>
                          <th className="p-2.5">Bill Number</th>
                          <th className="p-2.5">Doctor</th>
                          <th className="p-2.5">Payment Mode</th>
                          <th className="p-2.5">Status</th>
                          <th className="p-2.5 text-right">Bill Amount</th>
                          <th className="p-2.5 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {customerInvoices.map(inv => (
                          <tr key={inv.id} className="hover:bg-bg/50 transition-colors">
                            <td className="p-2.5 text-muted">{formatDate(inv.date)}</td>
                            <td className="p-2.5 font-bold">
                              <button
                                onClick={() => setViewInvoice(inv)}
                                className="text-primary hover:underline font-mono font-bold flex items-center gap-1"
                                title="Click to view full medicine list & bill preview"
                              >
                                <FileText size={12} />
                                <span>{inv.invoice_no}</span>
                              </button>
                            </td>
                            <td className="p-2.5 text-muted">{inv.doctor_name || '-'}</td>
                            <td className="p-2.5 font-semibold text-text">{inv.payment_medium || 'CREDIT'}</td>
                            <td className="p-2.5">
                              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                inv.payment_status === 'PAID'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              }`}>
                                {inv.payment_status || 'UNPAID'}
                              </span>
                            </td>
                            <td className="p-2.5 font-extrabold text-amber-400 text-right">₹{(inv.total_amount || 0).toFixed(2)}</td>
                            <td className="p-2.5 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => setViewInvoice(inv)}
                                  className="px-2 py-1 rounded-lg bg-bg3 border border-border text-[11px] font-semibold text-text hover:text-primary transition-all flex items-center gap-1"
                                >
                                  <FileText size={11} />
                                  <span>View</span>
                                </button>
                                <button
                                  onClick={async () => {
                                    try {
                                      const full = await api.getSale(inv.id) as { items?: SalesHistoryItemLine[]; doctor_name?: string };
                                      const items = Array.isArray(full.items) ? full.items : [];
                                      navigate('/pos', {
                                        state: {
                                          prefill: {
                                            patientName: selectedCustomer.name,
                                            patientPhone: selectedCustomer.phone,
                                            selectedCustomerId: selectedCustomer.id,
                                            doctorName: full.doctor_name || inv.doctor_name || '',
                                            refillPatient: true,
                                            medicines: items.map(it => ({
                                              medicineId: it.medicine_id,
                                              medicineName: it.medicine_name || it.name,
                                              inventory_id: it.inventory_id,
                                              batch_no: it.batch_no || it.batch_number || '',
                                              expiry_date: it.expiry_date || '',
                                              mrp: it.mrp || 0,
                                              sell_price: it.sell_price || null,
                                              quantity: it.quantity || 1,
                                              loose_qty: it.loose_qty || 0,
                                              unit_price: it.unit_price || it.sell_price || it.mrp || 0,
                                              discount: it.discount_per || it.discount || 0,
                                              pack_size: it.pack_size || 1
                                            }))
                                          }
                                        }
                                      });
                                      toastEvent.trigger(`Transferring repeat prescription for ${selectedCustomer.name} to POS...`, 'info', '/pos');
                                    } catch {
                                      toastEvent.trigger('Failed to load bill items for POS', 'error');
                                    }
                                  }}
                                  className="px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-bold text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all flex items-center gap-1 shadow-sm"
                                  title="Load this previous prescription into POS for refill sale"
                                >
                                  <RotateCcw size={11} />
                                  <span>Refill</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-muted text-xs gap-3">
              <div className="w-16 h-16 rounded-2xl bg-bg3/60 border border-border flex items-center justify-center">
                <Users size={32} className="text-primary/60" />
              </div>
              <p className="text-sm font-semibold text-text">
                {customers.length === 0 ? 'No Outstanding Customer Credit' : 'Select a credit customer from the left panel'}
              </p>
              <p className="text-xs text-muted max-w-sm text-center">
                {customers.length === 0
                  ? 'All customer credit dues are currently cleared. Credit sales recorded at POS will automatically track here.'
                  : 'Select a customer from the left panel to inspect unpaid bills, ledger statements, and dispatch WhatsApp payment QR reminders.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Bill Preview Modal (Matching Sales History Page Popup) */}
      {viewInvoice && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="glass-panel w-[95vw] max-w-4xl h-[85vh] min-h-[560px] max-h-[840px] flex flex-col border-primary/20 bg-bg2 rounded-2xl shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 border-b border-border flex justify-between items-center bg-bg3/50 shrink-0">
              <div>
                <h3 className="font-bold text-base flex items-center gap-2 text-text">
                  <FileText size={18} className="text-primary" />
                  Bill Preview: {viewInvoice.invoice_no}
                </h3>
                <p className="text-xs text-muted mt-0.5">Read-only preview of credit sale invoice</p>
              </div>
              <button
                onClick={() => setViewInvoice(null)}
                className="p-1.5 rounded-lg hover:bg-bg3 text-muted hover:text-text transition-all"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 flex-1 min-h-0 overflow-y-auto">
              {/* Customer & Invoice Summary */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-bg3/30 p-3.5 rounded-xl border border-border text-xs">
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">Patient Name</div>
                  <div className="font-bold text-text">{viewInvoice.customer_name || 'Walk-in'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">WhatsApp / Phone</div>
                  <div className="font-bold text-text">{viewInvoice.customer_phone || '-'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">Payment Method</div>
                  <div className="font-bold text-amber-400">{viewInvoice.payment_medium || 'CREDIT'} ({viewInvoice.payment_status || 'UNPAID'})</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">Sale Date</div>
                  <div className="font-bold text-text">{formatDate(viewInvoice.date)}</div>
                </div>
              </div>

              {/* Purchased Medicines Table */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-muted uppercase tracking-wider">Purchased Medicines</h4>
                  <span className="text-xs text-muted">{viewInvoice.items?.length || 0} item(s)</span>
                </div>
                <div className="overflow-x-auto border border-border rounded-xl bg-bg">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-bg3/40 border-b border-border text-muted font-bold">
                        <th className="p-2.5">Medicine Name</th>
                        <th className="p-2.5">Batch</th>
                        <th className="p-2.5 text-center">Qty (Strips/Loose)</th>
                        <th className="p-2.5 text-center">CD %</th>
                        <th className="p-2.5">MRP</th>
                        <th className="p-2.5">Unit Price</th>
                        <th className="p-2.5 text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {viewInvoice.items?.map((item, idx) => {
                        const packSize = item.pack_size || 1;
                        const looseQty = item.loose_qty || 0;
                        const discPer = item.discount_per || 0;
                        const discountedPrice = item.unit_price * (1 - discPer / 100);
                        const itemTotal = (discountedPrice * item.quantity) + ((discountedPrice / packSize) * looseQty);
                        return (
                          <tr key={idx} className="hover:bg-bg2/50">
                            <td className="p-2.5 font-semibold text-text">{item.medicine_name || `Item #${item.inventory_id}`}</td>
                            <td className="p-2.5 font-mono text-[11px] text-muted">{item.batch_number || '-'}</td>
                            <td className="p-2.5 text-center font-bold">{item.quantity} / {looseQty}</td>
                            <td className="p-2.5 text-center text-muted">{discPer}%</td>
                            <td className="p-2.5 text-muted">₹{item.mrp || 0}</td>
                            <td className="p-2.5 font-medium text-text">₹{discountedPrice.toFixed(2)}</td>
                            <td className="p-2.5 font-bold text-emerald-400 text-right">₹{Math.round(itemTotal)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-border flex justify-between items-center bg-bg3/50 shrink-0">
              <button
                onClick={() => setViewInvoice(null)}
                className="px-4 py-2 bg-bg3 text-muted rounded-xl text-xs font-semibold hover:text-text"
              >
                Close Preview
              </button>
              <div className="text-right">
                <div className="text-[10px] text-muted">Total Bill Amount</div>
                <div className="text-lg font-extrabold text-amber-400">
                  ₹{(viewInvoice.total_amount || 0).toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
