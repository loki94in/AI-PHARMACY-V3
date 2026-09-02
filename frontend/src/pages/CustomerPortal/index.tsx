import React, { useState, useEffect } from 'react';
import {
  Store as StoreIcon, Phone, Key, ShieldCheck, CheckCircle2, Clock,
  ArrowRight, RefreshCw, ShoppingCart, Check, X, AlertCircle, MapPin,
  QrCode, FileText, ChevronDown, Plus, Minus, UserCheck, MessageSquare
} from 'lucide-react';
import { api } from '../../services/api';

interface CustomerSession {
  id: number;
  name: string;
  phone: string;
  address: string;
  preferred_store_id: number;
}

interface StoreItem {
  id: number;
  name: string;
  address: string;
  phone: string;
}

interface RefillItem {
  id: number;
  medicine_id: number;
  medicine_name: string;
  generic_name?: string;
  strength?: string;
  mrp?: number;
  sell_price?: number;
  quantity_needed?: number;
  last_refill_date?: string;
  next_refill_date?: string;
  store_id?: number;
  store_name?: string;
}

interface PastBill {
  id: number;
  invoice_number: string;
  store_id: number;
  store_name: string;
  total_amount: number;
  net_amount: number;
  created_at: string;
  items: Array<{
    id: number;
    medicine_id: number;
    medicine_name: string;
    generic_name?: string;
    quantity: number;
    unit_price: number;
    total_price: number;
  }>;
}

interface SelectedMedicine {
  product: string;
  qty: number;
  price: number;
}

export default function CustomerPortal() {
  // ─── Authentication States ──────────────────────────────────────────────────
  const [session, setSession] = useState<CustomerSession | null>(() => {
    try {
      const saved = localStorage.getItem('customer_portal_session');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [phoneInput, setPhoneInput] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [isOtpMode, setIsOtpMode] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // ─── Dashboard States ───────────────────────────────────────────────────────
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<number>(1);
  const [refills, setRefills] = useState<RefillItem[]>([]);
  const [bills, setBills] = useState<PastBill[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  // ─── Selection & Checkout States ───────────────────────────────────────────
  const [selectedItems, setSelectedItems] = useState<Record<string, SelectedMedicine>>({});
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'COUNTER_PICKUP'>('COUNTER_PICKUP');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState<{
    store_name: string;
    orders: any[];
    message: string;
  } | null>(null);

  // ─── Change PIN States ─────────────────────────────────────────────────────
  const [isChangePinOpen, setIsChangePinOpen] = useState(false);
  const [pinChangeForm, setPinChangeForm] = useState({ current_pin: '', new_pin: '', confirm_pin: '' });
  const [pinChangeLoading, setPinChangeLoading] = useState(false);
  const [pinChangeError, setPinChangeError] = useState('');
  const [pinChangeSuccess, setPinChangeSuccess] = useState('');

  // Load stores on mount
  useEffect(() => {
    api.getStores().then(data => {
      if (Array.isArray(data) && data.length > 0) {
        setStores(data.map(s => ({
          id: s.id,
          name: s.name,
          address: s.address || '',
          phone: s.phone || ''
        })));
      }
    }).catch(() => {});
  }, []);

  // Fetch customer bills and refills on login or session load
  useEffect(() => {
    if (!session) return;
    setSelectedStoreId(session.preferred_store_id || 1);
    loadCustomerData(session.id, session.phone);
  }, [session]);

  const loadCustomerData = async (custId: number, phone: string) => {
    setLoadingData(true);
    try {
      const [refillRes, billRes] = await Promise.all([
        api.getCustomerRefills({ customer_id: custId, phone }),
        api.getCustomerBills({ customer_id: custId, phone })
      ]);

      const loadedRefills = refillRes?.refills || [];
      const loadedBills = billRes?.bills || [];

      setRefills(loadedRefills);
      setBills(loadedBills);

      // Pre-select all active refills by default
      const initialMap: Record<string, SelectedMedicine> = {};
      loadedRefills.forEach(r => {
        initialMap[r.medicine_name] = {
          product: r.medicine_name,
          qty: r.quantity_needed || 1,
          price: r.sell_price || r.mrp || 0
        };
      });
      setSelectedItems(initialMap);
    } catch (err) {
      console.warn('[CustomerPortal] Failed to load data:', err);
    } finally {
      setLoadingData(false);
    }
  };

  // ─── Authentication Handlers ───────────────────────────────────────────────

  const handleLoginWithPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    try {
      const res = await api.customerLogin({ login_id: phoneInput, pin: pinInput });
      if (res.success && res.customer) {
        setSession(res.customer);
        if (res.stores) setStores(res.stores);
        localStorage.setItem('customer_portal_session', JSON.stringify(res.customer));
      } else {
        setAuthError('Invalid credentials');
      }
    } catch (err: any) {
      setAuthError(err.response?.data?.error || 'Invalid phone number or 4-digit PIN');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRequestOtp = async () => {
    if (!phoneInput || phoneInput.replace(/\D/g, '').length < 10) {
      setAuthError('Please enter a valid 10-digit mobile number');
      return;
    }
    setAuthError('');
    setAuthLoading(true);

    try {
      const res = await api.customerRequestOtp({ login_id: phoneInput });
      if (res.success) {
        setOtpSent(true);
        setIsOtpMode(true);
      }
    } catch (err: any) {
      setAuthError(err.response?.data?.error || 'Failed to send WhatsApp OTP');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    try {
      const res = await api.customerVerifyOtp({ login_id: phoneInput, otp_code: otpInput });
      if (res.success && res.customer) {
        setSession(res.customer);
        if (res.stores) setStores(res.stores);
        localStorage.setItem('customer_portal_session', JSON.stringify(res.customer));
      }
    } catch (err: any) {
      setAuthError(err.response?.data?.error || 'Invalid or expired OTP');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setSession(null);
    localStorage.removeItem('customer_portal_session');
    setSelectedItems({});
    setOrderSuccess(null);
  };

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinChangeError('');
    setPinChangeSuccess('');

    if (pinChangeForm.new_pin.length < 4) {
      setPinChangeError('New PIN must be at least 4 digits');
      return;
    }
    if (pinChangeForm.new_pin !== pinChangeForm.confirm_pin) {
      setPinChangeError('New PIN and Confirm PIN do not match');
      return;
    }

    setPinChangeLoading(true);
    try {
      const res = await api.changeCustomerPin({
        customer_id: session?.id,
        phone: session?.phone,
        current_pin: pinChangeForm.current_pin,
        new_pin: pinChangeForm.new_pin
      });
      if (res.success) {
        setPinChangeSuccess('Your PIN has been updated successfully!');
        setPinChangeForm({ current_pin: '', new_pin: '', confirm_pin: '' });
        setTimeout(() => setIsChangePinOpen(false), 2000);
      }
    } catch (err: any) {
      setPinChangeError(err.response?.data?.error || 'Failed to update PIN');
    } finally {
      setPinChangeLoading(false);
    }
  };

  // ─── Item Selection Handlers ───────────────────────────────────────────────

  const toggleItem = (name: string, price: number, defaultQty = 1) => {
    setSelectedItems(prev => {
      const next = { ...prev };
      if (next[name]) {
        delete next[name];
      } else {
        next[name] = { product: name, qty: defaultQty, price };
      }
      return next;
    });
  };

  const updateQuantity = (name: string, delta: number) => {
    setSelectedItems(prev => {
      const existing = prev[name];
      if (!existing) return prev;
      const newQty = Math.max(1, existing.qty + delta);
      return {
        ...prev,
        [name]: { ...existing, qty: newQty }
      };
    });
  };

  // ─── Submit Refill Order ───────────────────────────────────────────────────

  const [orderError, setOrderError] = useState('');

  const handlePlaceOrder = async () => {
    if (!session) return;
    setOrderError('');
    const itemsList = Object.values(selectedItems);
    if (itemsList.length === 0) {
      setOrderError('Please select at least one medicine to reorder');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.placeCustomerRefillOrder({
        customer_id: session.id,
        customer_name: session.name,
        customer_phone: session.phone,
        store_id: selectedStoreId,
        items: itemsList,
        payment_method: paymentMethod
      });

      if (res.success) {
        setOrderSuccess({
          store_name: res.store_name,
          orders: res.orders,
          message: res.message
        });
      }
    } catch (err: any) {
      setOrderError(err.response?.data?.error || 'Failed to place refill order');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedList = Object.values(selectedItems);
  const totalAmount = selectedList.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const activeStore = stores.find(s => s.id === selectedStoreId) || stores[0];

  // ─── 1. LOGIN VIEW ─────────────────────────────────────────────────────────

  if (!session) {
    return (
      <div className="min-h-screen bg-bg flex flex-col justify-center items-center p-4">
        <div className="w-full max-w-md bg-bg2 border border-border rounded-2xl shadow-xl p-6 sm:p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 text-primary mb-2">
              <StoreIcon className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-bold text-text">Customer Refill Portal</h1>
            <p className="text-sm text-muted">
              Login to view your previous bills & reorder regular medicines for counter collection
            </p>
          </div>

          {authError && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2 text-sm text-red-600">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          {!isOtpMode ? (
            <form onSubmit={handleLoginWithPin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text uppercase tracking-wider mb-1.5">
                  Mobile Number (Login ID)
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    type="tel"
                    placeholder="e.g. 9876543210"
                    value={phoneInput}
                    onChange={e => setPhoneInput(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-bg border border-border rounded-xl text-text placeholder:text-muted focus:outline-none focus:border-primary text-sm font-medium"
                    required
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-text uppercase tracking-wider">
                    4-Digit PIN / Password
                  </label>
                  <button
                    type="button"
                    onClick={handleRequestOtp}
                    className="text-xs text-primary hover:underline font-medium"
                  >
                    Forgot / WhatsApp OTP
                  </button>
                </div>
                <div className="relative">
                  <Key className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    type="password"
                    maxLength={6}
                    placeholder="Enter 4-digit PIN"
                    value={pinInput}
                    onChange={e => setPinInput(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-bg border border-border rounded-xl text-text placeholder:text-muted focus:outline-none focus:border-primary text-sm font-medium tracking-widest"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-3 bg-primary text-white rounded-xl font-semibold shadow-md hover:opacity-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {authLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                <span>Login to My Portal</span>
              </button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => { setIsOtpMode(true); setOtpSent(false); }}
                  className="text-xs text-muted hover:text-text transition-colors flex items-center justify-center gap-1.5 mx-auto"
                >
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Login with WhatsApp OTP instead</span>
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text uppercase tracking-wider mb-1.5">
                  Mobile Number
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    type="tel"
                    placeholder="9876543210"
                    value={phoneInput}
                    onChange={e => setPhoneInput(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-bg border border-border rounded-xl text-text placeholder:text-muted focus:outline-none focus:border-primary text-sm font-medium"
                    required
                  />
                </div>
              </div>

              {otpSent ? (
                <div>
                  <label className="block text-xs font-semibold text-text uppercase tracking-wider mb-1.5">
                    6-Digit OTP (Sent to WhatsApp)
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    placeholder="123456"
                    value={otpInput}
                    onChange={e => setOtpInput(e.target.value)}
                    className="w-full text-center tracking-widest py-2.5 bg-bg border border-border rounded-xl text-text text-lg font-bold focus:outline-none focus:border-primary"
                    required
                  />
                  <p className="text-[11px] text-emerald-600 mt-1">✓ OTP sent to your WhatsApp number</p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleRequestOtp}
                  disabled={authLoading}
                  className="w-full py-2.5 bg-emerald-600 text-white rounded-xl font-medium text-sm hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>Send OTP via WhatsApp</span>
                </button>
              )}

              {otpSent && (
                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full py-3 bg-primary text-white rounded-xl font-semibold shadow-md hover:opacity-95 transition-all flex items-center justify-center gap-2"
                >
                  {authLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  <span>Verify & Login</span>
                </button>
              )}

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => setIsOtpMode(false)}
                  className="text-xs text-muted hover:text-text transition-colors"
                >
                  ← Back to PIN Login
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  // ─── 2. ORDER SUCCESS CONFIRMATION ─────────────────────────────────────────

  if (orderSuccess) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-bg2 border border-border rounded-2xl p-6 sm:p-8 space-y-6 text-center shadow-2xl">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-9 h-9" />
          </div>

          <div className="space-y-1">
            <h2 className="text-2xl font-bold text-text">Refill Order Placed!</h2>
            <p className="text-sm text-muted">{orderSuccess.message}</p>
          </div>

          <div className="bg-bg p-4 rounded-xl border border-border text-left space-y-3">
            <div className="flex items-center justify-between text-xs pb-2 border-b border-border text-muted">
              <span>Collection Location</span>
              <span className="font-semibold text-text">{orderSuccess.store_name}</span>
            </div>

            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-muted uppercase">Selected Medicines:</span>
              {orderSuccess.orders.map((ord: any, idx: number) => (
                <div key={ord.id} className="flex items-center justify-between text-sm text-text">
                  <span>{idx + 1}. {ord.product}</span>
                  <span className="font-bold text-primary">Qty: {ord.qty}</span>
                </div>
              ))}
            </div>

            <div className="pt-2 border-t border-border flex items-center justify-between text-xs text-muted">
              <span>Payment Mode:</span>
              <span className="font-semibold text-text">{paymentMethod === 'UPI' ? 'Paid via UPI' : 'Pay at Counter'}</span>
            </div>
          </div>

          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-600 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 shrink-0" />
            <span>Order confirmation and receipt have been sent to your WhatsApp!</span>
          </div>

          <button
            onClick={() => {
              setOrderSuccess(null);
              if (session) loadCustomerData(session.id, session.phone);
            }}
            className="w-full py-3 bg-primary text-white rounded-xl font-semibold hover:opacity-95 transition-all"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // ─── 3. MAIN DASHBOARD / REFILL SELECTION VIEW ─────────────────────────────

  return (
    <div className="min-h-screen bg-bg text-text pb-16">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 bg-bg2/90 backdrop-blur-md border-b border-border px-4 py-3 sm:px-8">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <StoreIcon className="w-5 h-5" />
            </div>
            <div>
              <span className="text-sm font-bold block leading-tight">Patient Refill Portal</span>
              <span className="text-xs text-muted">Welcome, {session.name}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => {
                setIsChangePinOpen(true);
                setPinChangeError('');
                setPinChangeSuccess('');
              }}
              className="text-xs text-text hover:text-primary px-3 py-1.5 rounded-lg border border-border hover:border-primary/40 transition-colors flex items-center gap-1.5 font-medium"
            >
              <Key className="w-3.5 h-3.5 text-primary" />
              <span>Change PIN</span>
            </button>

            <button
              onClick={handleLogout}
              className="text-xs text-muted hover:text-red-500 px-3 py-1.5 rounded-lg border border-border hover:border-red-500/30 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
        {/* Dynamic Branch / Store Selector Card */}
        <div className="bg-bg2 border border-border rounded-2xl p-4 sm:p-5 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold flex items-center gap-2 text-text">
                <MapPin className="w-4 h-4 text-primary" />
                <span>Select Collection Pharmacy Branch</span>
              </h2>
              <p className="text-xs text-muted">
                Choose the branch where you would like to pick up your packaged refill
              </p>
            </div>

            <div className="sm:w-80">
              <select
                value={selectedStoreId}
                onChange={e => setSelectedStoreId(parseInt(e.target.value, 10))}
                className="w-full bg-bg border border-border rounded-xl px-3 py-2 text-sm font-semibold text-text focus:outline-none focus:border-primary"
              >
                {stores.map(st => (
                  <option key={st.id} value={st.id}>
                    Store #{st.id} - {st.name} {st.address ? `(${st.address})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {activeStore && (
            <div className="p-2.5 bg-bg rounded-xl border border-border/60 text-xs flex flex-wrap items-center justify-between gap-2 text-muted">
              <span>📍 <strong>Address:</strong> {activeStore.address || 'Main Market Location'}</span>
              {activeStore.phone && <span>📞 <strong>Contact:</strong> {activeStore.phone}</span>}
              <span className="text-emerald-500 font-semibold">● Ready in ~30 mins</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left / Middle: Regular Medicines & Past Bills */}
          <div className="lg:col-span-2 space-y-6">
            {/* Section 1: Active Refills */}
            <div className="bg-bg2 border border-border rounded-2xl p-4 sm:p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-text">Your Regular Prescriptions</h3>
                  <p className="text-xs text-muted">Select medicines and adjust quantities for your refill</p>
                </div>
                <span className="text-xs px-2.5 py-1 bg-primary/10 text-primary font-semibold rounded-lg">
                  {refills.length} Regular Items
                </span>
              </div>

              {loadingData ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-muted text-xs">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>Loading regular medicines...</span>
                </div>
              ) : refills.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted border border-dashed border-border rounded-xl">
                  No regular refills registered yet. Select items from your previous store bills below!
                </div>
              ) : (
                <div className="space-y-2.5">
                  {refills.map(r => {
                    const isSelected = Boolean(selectedItems[r.medicine_name]);
                    const currentQty = selectedItems[r.medicine_name]?.qty || r.quantity_needed || 1;
                    const price = r.sell_price || r.mrp || 0;

                    return (
                      <div
                        key={r.id}
                        className={`p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                          isSelected
                            ? 'bg-primary/5 border-primary/40 shadow-sm'
                            : 'bg-bg border-border opacity-70 hover:opacity-100'
                        }`}
                      >
                        <div className="flex items-center gap-3 cursor-pointer select-none" onClick={() => toggleItem(r.medicine_name, price, r.quantity_needed || 1)}>
                          <div className={`w-5 h-5 rounded-md flex items-center justify-center border transition-colors ${
                            isSelected ? 'bg-primary border-primary text-white' : 'border-border bg-bg2'
                          }`}>
                            {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </div>
                          <div>
                            <span className="text-sm font-bold text-text block leading-snug">{r.medicine_name}</span>
                            <span className="text-xs text-muted">
                              {r.generic_name ? `${r.generic_name} • ` : ''}₹{price.toFixed(2)} / pack
                            </span>
                          </div>
                        </div>

                        {isSelected && (
                          <div className="flex items-center gap-2 bg-bg2 border border-border rounded-lg p-1">
                            <button
                              onClick={() => updateQuantity(r.medicine_name, -1)}
                              className="w-6 h-6 rounded flex items-center justify-center hover:bg-bg text-text"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="text-xs font-bold w-6 text-center">{currentQty}</span>
                            <button
                              onClick={() => updateQuantity(r.medicine_name, 1)}
                              className="w-6 h-6 rounded flex items-center justify-center hover:bg-bg text-text"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Section 2: Reorder from Previous In-Store Bills */}
            {bills.length > 0 && (
              <div className="bg-bg2 border border-border rounded-2xl p-4 sm:p-6 shadow-sm space-y-4">
                <div>
                  <h3 className="text-base font-bold text-text">Previous In-Store Bills</h3>
                  <p className="text-xs text-muted">Quickly pick and reorder items you previously purchased</p>
                </div>

                <div className="space-y-3">
                  {bills.map(bill => (
                    <div key={bill.id} className="bg-bg border border-border rounded-xl p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between text-xs pb-2 border-b border-border/60 text-muted">
                        <span className="font-semibold text-text">Bill #{bill.invoice_number || bill.id}</span>
                        <span>{bill.store_name || 'Main Branch'} • {new Date(bill.created_at).toLocaleDateString()}</span>
                      </div>

                      <div className="space-y-1.5">
                        {bill.items?.map(it => {
                          const isSelected = Boolean(selectedItems[it.medicine_name]);
                          const price = it.unit_price || 0;

                          return (
                            <div key={it.id} className="flex items-center justify-between text-xs py-1">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => toggleItem(it.medicine_name, price, it.quantity || 1)}
                                  className={`w-4 h-4 rounded flex items-center justify-center border ${
                                    isSelected ? 'bg-primary border-primary text-white' : 'border-border bg-bg2'
                                  }`}
                                >
                                  {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                                </button>
                                <span className="font-medium text-text">{it.medicine_name}</span>
                              </div>
                              <span className="text-muted">₹{price.toFixed(2)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Checkout & Collection Summary */}
          <div className="space-y-6">
            <div className="bg-bg2 border border-border rounded-2xl p-4 sm:p-6 shadow-md space-y-5 sticky top-20">
              <h3 className="text-base font-bold text-text flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-primary" />
                <span>Collection Order Summary</span>
              </h3>

              {selectedList.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted border border-dashed border-border rounded-xl">
                  Select at least one medicine from the left to proceed
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {selectedList.map(item => (
                      <div key={item.product} className="flex items-center justify-between text-xs text-text bg-bg p-2 rounded-lg border border-border/50">
                        <div>
                          <span className="font-semibold block">{item.product}</span>
                          <span className="text-muted">Qty: {item.qty} × ₹{item.price.toFixed(2)}</span>
                        </div>
                        <span className="font-bold text-primary">₹{(item.price * item.qty).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="pt-3 border-t border-border space-y-2 text-xs">
                    <div className="flex justify-between text-muted">
                      <span>Pickup Branch:</span>
                      <span className="font-semibold text-text">{activeStore?.name}</span>
                    </div>
                    <div className="flex justify-between text-muted">
                      <span>Total Items:</span>
                      <span className="font-semibold text-text">{selectedList.length} Medicines</span>
                    </div>
                    <div className="flex justify-between text-base font-bold text-text pt-2 border-t border-border">
                      <span>Grand Total:</span>
                      <span className="text-primary font-mono">₹{totalAmount.toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Payment Mode Selection */}
                  <div className="space-y-2 pt-2">
                    <label className="text-xs font-semibold text-text uppercase tracking-wider block">
                      Payment Mode
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('COUNTER_PICKUP')}
                        className={`py-2 px-2.5 rounded-xl border text-xs font-semibold text-center transition-all ${
                          paymentMethod === 'COUNTER_PICKUP'
                            ? 'bg-primary/10 border-primary text-primary'
                            : 'bg-bg border-border text-muted'
                        }`}
                      >
                        Pay at Counter
                      </button>

                      <button
                        type="button"
                        onClick={() => setPaymentMethod('UPI')}
                        className={`py-2 px-2.5 rounded-xl border text-xs font-semibold text-center transition-all ${
                          paymentMethod === 'UPI'
                            ? 'bg-primary/10 border-primary text-primary'
                            : 'bg-bg border-border text-muted'
                        }`}
                      >
                        Dynamic UPI QR
                      </button>
                    </div>
                  </div>

                  {paymentMethod === 'UPI' && (
                    <div className="p-3 bg-bg rounded-xl border border-border text-center space-y-2">
                      <QrCode className="w-12 h-12 mx-auto text-primary" />
                      <p className="text-[11px] text-muted">
                        Dynamic UPI QR Code will be presented upon order placement for GPay / PhonePe / Paytm.
                      </p>
                    </div>
                  )}

                  {orderError && (
                    <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-600 flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{orderError}</span>
                    </div>
                  )}

                  <button
                    onClick={handlePlaceOrder}
                    disabled={isSubmitting || selectedList.length === 0}
                    className="w-full py-3.5 bg-primary text-white rounded-xl font-bold shadow-lg hover:opacity-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
                  >
                    {isSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    <span>Place In-Store Pickup Order</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Change PIN Modal */}
      {isChangePinOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-text flex items-center gap-2">
                <Key className="w-5 h-5 text-primary" />
                <span>Change Your PIN</span>
              </h3>
              <button
                onClick={() => setIsChangePinOpen(false)}
                className="text-muted hover:text-text p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            {pinChangeError && (
              <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-600 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{pinChangeError}</span>
              </div>
            )}

            {pinChangeSuccess && (
              <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-600 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{pinChangeSuccess}</span>
              </div>
            )}

            <form onSubmit={handleChangePin} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-text uppercase tracking-wider mb-1">
                  Current 4-Digit PIN
                </label>
                <input
                  type="password"
                  maxLength={6}
                  placeholder="Enter current PIN"
                  value={pinChangeForm.current_pin}
                  onChange={e => setPinChangeForm({ ...pinChangeForm, current_pin: e.target.value })}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-text font-mono tracking-widest focus:outline-none focus:border-primary"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-text uppercase tracking-wider mb-1">
                  New 4-Digit PIN
                </label>
                <input
                  type="password"
                  maxLength={6}
                  placeholder="Enter new 4-digit PIN"
                  value={pinChangeForm.new_pin}
                  onChange={e => setPinChangeForm({ ...pinChangeForm, new_pin: e.target.value.replace(/\D/g, '') })}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-text font-mono tracking-widest focus:outline-none focus:border-primary"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-text uppercase tracking-wider mb-1">
                  Confirm New PIN
                </label>
                <input
                  type="password"
                  maxLength={6}
                  placeholder="Re-enter new 4-digit PIN"
                  value={pinChangeForm.confirm_pin}
                  onChange={e => setPinChangeForm({ ...pinChangeForm, confirm_pin: e.target.value.replace(/\D/g, '') })}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-text font-mono tracking-widest focus:outline-none focus:border-primary"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsChangePinOpen(false)}
                  className="px-4 py-2 border border-border rounded-xl text-muted hover:text-text transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pinChangeLoading}
                  className="px-5 py-2 bg-primary text-white rounded-xl font-bold shadow-md hover:opacity-95 transition-all flex items-center gap-1.5 disabled:opacity-50"
                >
                  {pinChangeLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  <span>Save New PIN</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
