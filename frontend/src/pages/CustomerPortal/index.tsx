import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Store as StoreIcon, Phone, Key, ShieldCheck, CheckCircle2, Clock,
  ArrowRight, RefreshCw, ShoppingCart, ShoppingBag, Check, X, AlertCircle, MapPin,
  QrCode, FileText, ChevronDown, Plus, Minus, UserCheck, MessageSquare,
  Activity, Pill, Heart, Wind, Search, ChevronRight, Receipt,
  CreditCard, ExternalLink, Copy, RotateCcw, Trash2
} from 'lucide-react';
import { api } from '../../services/api';
import { authApi } from '../../api/authApi';
import { PublicCatalogView } from './PublicCatalogView';

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
  status?: string;
  paused_at?: string;
  pause_reason?: string;
  resume_at?: string;
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
  const location = useLocation();
  const navigate = useNavigate();

  // ─── Portal Navigation Tab ──────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'catalog' | 'portal'>('catalog');
  const [isCartModalOpen, setIsCartModalOpen] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');

  // Auto-detect direct customer login routes and prefilled phone query parameters
  useEffect(() => {
    try {
      const search = location.search || window.location.search || '';
      const params = new URLSearchParams(search);
      const phoneParam = params.get('phone') || '';
      if (phoneParam) {
        setPhoneInput(phoneParam.replace(/\D/g, ''));
        setActiveTab('portal');
      }
      const isLoginPath =
        location.pathname.includes('/customer-login') ||
        location.pathname.includes('/customer/login') ||
        location.pathname.includes('/my-bills') ||
        location.pathname.includes('/customer-bills') ||
        params.get('tab') === 'login' ||
        params.get('tab') === 'portal';

      if (isLoginPath) {
        setActiveTab('portal');
      }
      if (params.get('otp') === '1') {
        setIsOtpMode(true);
      }
    } catch (_) {}
  }, [location]);

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

  const [stores, setStores] = useState<StoreItem[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<number>(1);
  const [refills, setRefills] = useState<RefillItem[]>([]);
  const [bills, setBills] = useState<PastBill[]>([]);
  const [customerOrders, setCustomerOrders] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  // ─── Selection & Checkout States ───────────────────────────────────────────
  const [selectedItems, setSelectedItems] = useState<Record<string, SelectedMedicine>>({});
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'COUNTER_PICKUP'>('UPI');
  const [deliveryMode, setDeliveryMode] = useState<'pickup' | 'delivery'>('pickup');
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [paymentQrModal, setPaymentQrModal] = useState<{
    isOpen: boolean;
    orderId: number;
    label: string;
    payeeName: string;
    upiId: string;
    upiUri: string;
    qrImageUrl?: string;
    amount: number;
    isPaidMarked?: boolean;
  } | null>(null);
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState<{
    store_name: string;
    orders: any[];
    message: string;
    timing?: any;
    returnPolicy?: any;
  } | null>(null);

  // ─── Change PIN States ─────────────────────────────────────────────────────
  const [isChangePinOpen, setIsChangePinOpen] = useState(false);
  const [pinChangeForm, setPinChangeForm] = useState({ current_pin: '', new_pin: '', confirm_pin: '' });
  const [pinChangeLoading, setPinChangeLoading] = useState(false);
  const [pinChangeError, setPinChangeError] = useState('');
  const [pinChangeSuccess, setPinChangeSuccess] = useState('');

  // Load stores & delivery configuration on mount
  useEffect(() => {
    api.getStores().then(data => {
      const arr = Array.isArray(data) ? data : ((data as any)?.stores || []);
      if (arr.length > 0) {
        const mapped = arr.map((s: any) => ({
          id: s.id,
          name: s.name,
          address: s.address || '',
          phone: s.phone || ''
        }));
        setStores(mapped);
        setSelectedStoreId(prev => (mapped.some((st: StoreItem) => st.id === prev) ? prev : mapped[0].id));
      }
    }).catch(() => {});

    api.getDeliveryConfig().then(res => {
      if (res?.success) {
        setDeliveryEnabled(res.delivery_enabled);
        if (!res.delivery_enabled) {
          setDeliveryMode('pickup');
        }
      }
    }).catch(() => {});
  }, []);

  // Fetch customer bills and refills on login or session load
  useEffect(() => {
    if (!session) return;
    setSelectedStoreId(session.preferred_store_id || 1);
    loadCustomerData(session.id, session.phone);
  }, [session]);

  // Real-time synchronization: refresh customer profile and order status on SSE updates
  useEffect(() => {
    const handleInvalidate = () => {
      if (session) {
        loadCustomerData(session.id, session.phone);
      }
    };
    window.addEventListener('cache-invalidate', handleInvalidate);
    return () => window.removeEventListener('cache-invalidate', handleInvalidate);
  }, [session]);

  const loadCustomerData = async (custId: number, phone: string) => {
    setLoadingData(true);
    try {
      const token = localStorage.getItem('customer_portal_token') || undefined;
      const [refillRes, billRes, orderRes] = await Promise.all([
        api.getCustomerRefills({ customer_id: custId, phone, token }),
        api.getCustomerBills({ customer_id: custId, phone, token }),
        api.getCustomerOrders({ customer_id: custId, phone, token })
      ]);

      const loadedRefills = refillRes?.refills || [];
      const loadedBills = billRes?.bills || [];
      const loadedOrders = orderRes?.orders || [];

      setRefills(loadedRefills);
      setBills(loadedBills);
      setCustomerOrders(loadedOrders);

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
        if (res.token) {
          localStorage.setItem('customer_portal_token', res.token);
        }
      }
    } catch (err: any) {
      setAuthError(err.response?.data?.error || 'Invalid or expired OTP');
    } finally {
      setAuthLoading(false);
    }
  };

  // Periodic session heartbeat (every 60s while active tab)
  useEffect(() => {
    if (!session) return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        authApi.heartbeat().catch(() => {});
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [session]);

  const handleLogout = () => {
    try {
      authApi.logout().catch(() => {});
    } catch (_) {}
    setSession(null);
    localStorage.removeItem('customer_portal_session');
    localStorage.removeItem('customer_portal_token');
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
      const newQty = existing.qty + delta;
      if (newQty <= 0) {
        const next = { ...prev };
        delete next[name];
        return next;
      }
      return {
        ...prev,
        [name]: { ...existing, qty: newQty }
      };
    });
  };

  const clearCart = () => {
    setSelectedItems({});
  };

  // ─── Submit Refill Order ───────────────────────────────────────────────────

  const [orderError, setOrderError] = useState('');

  const handlePlaceOrder = async () => {
    const custName = (session?.name || guestName || '').trim();
    const custPhone = (session?.phone || guestPhone || '').replace(/\D/g, '');

    if (!custName) {
      setOrderError('Please enter your full name');
      return;
    }
    if (!custPhone || custPhone.length < 10) {
      setOrderError('Please enter a valid 10-digit mobile number');
      return;
    }
    if (deliveryMode === 'delivery' && !deliveryAddress.trim() && !(session?.address)) {
      setOrderError('Please enter your delivery address');
      return;
    }

    setOrderError('');
    const itemsList = Object.values(selectedItems);
    if (itemsList.length === 0) {
      setOrderError('Please select at least one medicine to reorder');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.placeCustomerRefillOrder({
        customer_id: session?.id,
        customer_name: custName,
        customer_phone: custPhone,
        store_id: selectedStoreId || 1,
        items: itemsList,
        payment_method: paymentMethod,
        delivery_mode: deliveryMode,
        delivery_address: deliveryAddress.trim() || session?.address || '',
        notes: orderNotes.trim()
      });

      if (res.success) {
        setOrderSuccess({
          store_name: res.store_name,
          orders: res.orders,
          message: res.message,
          timing: (res as any)?.timing,
          returnPolicy: (res as any)?.returnPolicy
        });
        setIsCartModalOpen(false);
        setSelectedItems({});
        setDeliveryAddress('');
        setOrderNotes('');

        // Open 3-UPI QR modal if UPI payment was selected (§12, §13)
        if (res.payment_qr) {
          const qr = res.payment_qr;
          setPaymentQrModal({
            isOpen: true,
            orderId: res.order_id || res.orders[0]?.id,
            label: qr.label || 'Pharmacy Counter UPI (QR 1)',
            payeeName: qr.payee_name || 'AI Pharmacy',
            upiId: qr.upi_id,
            upiUri: qr.upi_uri,
            qrImageUrl: qr.qr_image_url,
            amount: qr.amount || totalAmount,
            isPaidMarked: false
          });
        }
      }
    } catch (err: any) {
      setOrderError(err.response?.data?.error || 'Failed to place order');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMarkPaid = async () => {
    if (!paymentQrModal?.orderId) return;
    setIsMarkingPaid(true);
    try {
      await api.markOrderPaid(paymentQrModal.orderId);
      setPaymentQrModal(prev => prev ? { ...prev, isPaidMarked: true } : null);
      if (session) {
        loadCustomerData(session.id, session.phone);
      }
    } catch (err: any) {
      setOrderError(err.response?.data?.error || 'Failed to submit payment status');
    } finally {
      setIsMarkingPaid(false);
    }
  };

  const handleOpenOrderPaymentQr = async (order: any) => {
    try {
      const qrRes = await api.getOrderPaymentQr(order.id);
      if (qrRes?.success) {
        setPaymentQrModal({
          isOpen: true,
          orderId: order.id,
          label: qrRes.label || 'Pharmacy Counter UPI',
          payeeName: qrRes.payee_name || 'AI Pharmacy',
          upiId: qrRes.upi_id,
          upiUri: qrRes.upi_uri,
          qrImageUrl: qrRes.qr_image_url,
          amount: qrRes.amount || order.total_amount,
          isPaidMarked: order.payment_status === 'PENDING_VERIFICATION'
        });
      }
    } catch (err: any) {
      setOrderError(err.response?.data?.error || 'Failed to open payment QR');
    }
  };

  const [refillingInvoiceId, setRefillingInvoiceId] = useState<number | null>(null);

  const handleRefillEntireBill = async (invoiceId: number) => {
    if (!session) return;
    setRefillingInvoiceId(invoiceId);
    try {
      const res = await api.refillFromInvoice(invoiceId, {
        customer_id: session.id,
        login_id: session.phone,
        store_id: selectedStoreId || session.preferred_store_id || 1
      });
      if (res.success) {
        setOrderSuccess({
          store_name: activeStore?.name || 'Pharmacy',
          orders: res.orders,
          message: res.message,
          timing: (res as any)?.timing,
          returnPolicy: (res as any)?.returnPolicy
        });
      }
    } catch (err: any) {
      setOrderError(err.response?.data?.error || 'Failed to create refill order');
    } finally {
      setRefillingInvoiceId(null);
    }
  };

  const selectedList = Object.values(selectedItems);
  const totalAmount = selectedList.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const activeStore = stores.find(s => s.id === selectedStoreId) || stores[0];

  // ─── 1. ORDER SUCCESS CONFIRMATION ─────────────────────────────────────────

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

            {orderSuccess.timing?.estimatedDeliveryWindowFormatted && (
              <div className="pt-2 border-t border-border space-y-1">
                <div className="flex items-center justify-between text-xs text-muted">
                  <span className="flex items-center gap-1 font-semibold text-text">
                    <Clock className="w-3.5 h-3.5 text-primary" />
                    <span>Estimated Fulfilment:</span>
                  </span>
                  <span className="font-bold text-primary">{orderSuccess.timing.estimatedDeliveryWindowFormatted}</span>
                </div>
                {orderSuccess.timing.scheduleReason && (
                  <p className="text-[11px] text-amber-500 font-medium bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-lg">
                    ℹ️ {orderSuccess.timing.scheduleReason}
                  </p>
                )}
              </div>
            )}

            {orderSuccess.returnPolicy?.message && (
              <div className="pt-2 border-t border-border flex items-center justify-between text-xs text-muted">
                <span className="flex items-center gap-1">
                  <RotateCcw className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Return Policy:</span>
                </span>
                <span className="text-[11px] font-semibold text-emerald-600">{orderSuccess.returnPolicy.message}</span>
              </div>
            )}
          </div>

          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-600 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 shrink-0" />
            <span>Order confirmation and receipt have been sent to your WhatsApp!</span>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3">
            <button
              onClick={() => {
                setOrderSuccess(null);
                setActiveTab('catalog');
              }}
              className="flex-1 w-full py-3 bg-primary text-white rounded-xl font-semibold hover:opacity-95 transition-all text-sm"
            >
              Browse More Medicines
            </button>
            {session && (
              <button
                onClick={() => {
                  setOrderSuccess(null);
                  setActiveTab('portal');
                  loadCustomerData(session.id, session.phone);
                }}
                className="flex-1 w-full py-3 bg-bg border border-border rounded-xl font-semibold hover:bg-bg3 transition-all text-sm text-text"
              >
                View My Refills
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── 2. MASTER PORTAL & CATALOG LAYOUT ─────────────────────────────────────

  return (
    <div className="min-h-full w-full bg-bg text-text pb-16">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 bg-bg2/90 backdrop-blur-md border-b border-border px-4 py-3 sm:px-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Logo & Store Title */}
          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-between sm:justify-start">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <StoreIcon className="w-5 h-5" />
              </div>
              <div>
                <span className="text-sm font-bold block leading-tight">Pune Pharmacy Web Portal</span>
                <span className="text-[11px] text-muted">
                  {session ? `Welcome, ${session.name}` : 'Live Medicine Catalog & Refills'}
                </span>
              </div>
            </div>

            {/* Mobile Account Action */}
            <div className="sm:hidden">
              {session ? (
                <button
                  onClick={handleLogout}
                  className="text-xs text-red-500 font-semibold px-2 py-1 border border-red-500/20 rounded-lg"
                >
                  Logout
                </button>
              ) : (
                <button
                  onClick={() => setActiveTab('portal')}
                  className="text-xs text-primary font-semibold px-2.5 py-1 bg-primary/10 rounded-lg"
                >
                  Login
                </button>
              )}
            </div>
          </div>

          {/* Center Navigation Tabs */}
          <div className="flex items-center bg-bg border border-border rounded-xl p-1 gap-1 w-full sm:w-auto">
            <button
              onClick={() => setActiveTab('catalog')}
              className={`flex-1 sm:flex-initial px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'catalog'
                  ? 'bg-primary text-white shadow-xs'
                  : 'text-muted hover:text-text'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Browse Catalog & Refills</span>
            </button>

            <button
              onClick={() => setActiveTab('portal')}
              className={`flex-1 sm:flex-initial px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'portal'
                  ? 'bg-primary text-white shadow-xs'
                  : 'text-muted hover:text-text'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>{session ? 'My Prescriptions & Bills' : 'My Account / Login'}</span>
            </button>
          </div>

          {/* Desktop User Actions */}
          <div className="hidden sm:flex items-center gap-2.5">
            {session ? (
              <>
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
              </>
            ) : (
              <button
                onClick={() => setActiveTab('portal')}
                className="text-xs px-3.5 py-1.5 bg-primary/10 text-primary font-bold rounded-lg hover:bg-primary hover:text-white transition-all flex items-center gap-1.5"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Patient Login</span>
              </button>
            )}

            <button
              onClick={() => navigate('/website-orders')}
              className="text-xs text-muted hover:text-primary px-3 py-1.5 rounded-lg border border-border hover:border-primary/40 transition-colors flex items-center gap-1.5 font-medium"
              title="Return to Pharmacy Staff Workspace"
            >
              <span>← Staff Workspace</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
        {/* VIEW 1: PUBLIC CATALOG */}
        {activeTab === 'catalog' && (
          <PublicCatalogView
            stores={stores}
            activeStoreId={selectedStoreId}
            onChangeStore={setSelectedStoreId}
            selectedItems={selectedItems}
            onToggleItem={toggleItem}
            onUpdateQuantity={updateQuantity}
            onClearCart={clearCart}
            onOpenCartModal={() => setIsCartModalOpen(true)}
            onOpenLogin={() => setActiveTab('portal')}
          />
        )}

        {/* VIEW 2: PERSONAL PORTAL & LOGIN */}
        {activeTab === 'portal' && !session && (
          <div className="flex flex-col justify-center items-center py-8">
            <div className="w-full max-w-md bg-bg2 border border-border rounded-2xl shadow-xl p-6 sm:p-8 space-y-6">
              <div className="text-center space-y-2">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 text-primary mb-2">
                  <StoreIcon className="w-7 h-7" />
                </div>
                <h1 className="text-2xl font-bold text-text">Customer Web Login</h1>
                <p className="text-sm text-muted">
                  Directly connected to your in-store sales history & bills. Login to view past invoices and reorder medicines.
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
        )}

        {/* VIEW 2: LOGGED IN PORTAL DASHBOARD */}
        {activeTab === 'portal' && session && (
          <div className="space-y-6">
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
          {/* Left / Middle: Regular Medicines, Online Orders & Past Bills */}
          <div className="lg:col-span-2 space-y-6">
            {/* Section 0: Active & Recent Online Orders */}
            {customerOrders.length > 0 && (
              <div className="bg-bg2 border border-border rounded-2xl p-4 sm:p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-text flex items-center gap-2">
                      <ShoppingBag className="w-4 h-4 text-primary" />
                      <span>Your Online Orders & Live Status</span>
                    </h3>
                    <p className="text-xs text-muted">Track fulfilment and payment status for orders placed online</p>
                  </div>
                  <span className="text-xs px-2.5 py-1 bg-primary/10 text-primary font-semibold rounded-lg">
                    {customerOrders.length} {customerOrders.length === 1 ? 'Online Order' : 'Online Orders'}
                  </span>
                </div>

                <div className="space-y-3">
                  {customerOrders.map(order => {
                    const isPendingVerification = order.payment_status === 'PENDING_VERIFICATION';
                    const isPaid = order.payment_status === 'CONFIRMED' || order.payment_status === 'PAYMENT_CONFIRMED';
                    const isUnpaid = !isPendingVerification && !isPaid;

                    return (
                      <div key={order.id} className="bg-bg border border-border rounded-xl p-4 space-y-3 shadow-xs">
                        {/* Header: Order ID, Store, Time, Badges */}
                        <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-border/60 flex-wrap">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-black text-primary">#{order.id}</span>
                              <span className="text-xs font-bold text-text">{order.store_name || 'Pharmacy Branch'}</span>
                              <span className="text-[10px] text-muted">
                                {order.created_at ? new Date(order.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Recent'}
                              </span>
                            </div>
                            {order.estimated_delivery_start && order.estimated_delivery_end && (
                              <div className="text-[11px] text-muted flex items-center gap-1 mt-1">
                                <Clock className="w-3 h-3 text-primary" />
                                <span>Expected Delivery: <strong className="text-text">{new Date(order.estimated_delivery_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – {new Date(order.estimated_delivery_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong></span>
                              </div>
                            )}
                          </div>

                          {/* Payment & Fulfilment Badges */}
                          <div className="flex flex-col items-end gap-1">
                            {isPendingVerification ? (
                              <span className="px-2.5 py-1 rounded-lg text-[10px] font-black bg-amber-500/15 text-amber-500 border border-amber-500/30 flex items-center gap-1 animate-pulse">
                                <Clock className="w-3 h-3" />
                                <span>Payment Confirmation Pending</span>
                              </span>
                            ) : isPaid ? (
                              <span className="px-2.5 py-1 rounded-lg text-[10px] font-black bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Payment Confirmed</span>
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-lg text-[10px] font-black bg-purple-500/15 text-purple-400 border border-purple-500/30 flex items-center gap-1">
                                <CreditCard className="w-3 h-3" />
                                <span>Payment Pending</span>
                              </span>
                            )}

                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                              order.status === 'Fulfilled' || order.status === 'ORDER_READY_FOR_PICKUP' || order.status === 'Ready'
                                ? 'bg-blue-500/10 text-blue-500 border-blue-500/30'
                                : 'bg-bg3 text-muted border-border'
                            }`}>
                              Status: {order.status === 'ORDER_READY_FOR_PICKUP' ? 'Ready for Pickup' : (order.status || 'Pending')}
                            </span>
                          </div>
                        </div>

                        {/* Order Items */}
                        <div className="space-y-1 bg-bg2/40 p-2.5 rounded-xl border border-border/50">
                          {order.items?.map((item: any, idx: number) => (
                            <div key={idx} className="flex items-center justify-between text-xs py-0.5">
                              <span className="text-text font-medium">{item.product_name || item.product || order.product}</span>
                              <span className="text-muted font-mono">Qty: {item.requested_qty || item.qty || order.qty || 1}</span>
                            </div>
                          ))}
                        </div>

                        {/* Payment & Re-open QR CTA */}
                        <div className="pt-2 border-t border-border/60 flex items-center justify-between gap-2 flex-wrap text-xs">
                          <div className="flex items-center gap-1">
                            <span className="text-muted">Total:</span>
                            <span className="font-bold text-primary font-mono text-sm">₹{Number(order.total_amount || 0).toFixed(2)}</span>
                          </div>

                          <div className="flex items-center gap-2">
                            {isPendingVerification && (
                              <span className="text-[11px] text-amber-500 font-medium">
                                ⏳ Awaiting pharmacy verification. Please share your screenshot on WhatsApp.
                              </span>
                            )}

                            {order.payment_screenshot_path && (
                              <span className="text-[10px] text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md font-semibold flex items-center gap-1">
                                <span>📸 Screenshot Received</span>
                              </span>
                            )}

                            {isUnpaid && (
                              <button
                                type="button"
                                onClick={() => handleOpenOrderPaymentQr(order)}
                                className="px-3 py-1.5 bg-primary text-white rounded-xl text-xs font-bold shadow-sm hover:opacity-95 transition-all flex items-center gap-1.5 cursor-pointer"
                              >
                                <QrCode className="w-3.5 h-3.5" />
                                <span>Pay via UPI QR</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

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
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-text block leading-snug">{r.medicine_name}</span>
                              {r.status === 'paused' && (
                                <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-500 border border-amber-500/30 font-bold">
                                  Paused
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-muted">
                              {r.generic_name ? `${r.generic_name} • ` : ''}₹{price.toFixed(2)} / pack
                              {r.next_refill_date && (
                                <span className="ml-1.5 text-[11px] text-primary font-medium">
                                  • Next Refill: {new Date(r.next_refill_date).toLocaleDateString()}
                                </span>
                              )}
                            </span>
                          </div>
                        </div>

                        {isSelected && (
                          <div className="flex items-center gap-2 bg-bg2 border border-border rounded-lg p-1">
                            <button
                              onClick={() => updateQuantity(r.medicine_name, -1)}
                              title={currentQty === 1 ? 'Remove from refill' : 'Decrease quantity'}
                              className="w-6 h-6 rounded flex items-center justify-center hover:bg-bg text-text hover:text-red-500 transition-colors cursor-pointer"
                            >
                              {currentQty === 1 ? <Trash2 className="w-3 h-3 text-red-500" /> : <Minus className="w-3 h-3" />}
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

            {/* Section 2: Reorder from Previous In-Store Bills & Sell History */}
            <div className="bg-bg2 border border-border rounded-2xl p-4 sm:p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-text flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-primary" />
                    <span>Past Store Purchases & Invoices</span>
                    {bills.length > 0 && (
                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">
                        {bills.length} {bills.length === 1 ? 'bill' : 'bills'}
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-muted">
                    In-store POS counter purchases directly connected to your account ({session.phone})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => loadCustomerData(session.id, session.phone)}
                  className="p-1.5 hover:bg-bg rounded-lg text-muted hover:text-text transition-colors flex items-center gap-1 text-xs"
                  title="Refresh bills"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingData ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
              </div>

              {bills.length === 0 ? (
                <div className="py-8 text-center border border-dashed border-border rounded-xl text-xs text-muted space-y-1.5 p-4">
                  <Receipt className="w-8 h-8 text-muted/50 mx-auto mb-2" />
                  <p className="font-semibold text-text text-sm">No in-store bills found for this phone number yet</p>
                  <p className="max-w-sm mx-auto">
                    When you purchase medicines at our pharmacy counter, your invoices and medicine history will appear here automatically.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {bills.map(bill => (
                    <div key={bill.id} className="bg-bg border border-border rounded-xl p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between text-xs pb-2 border-b border-border/60 text-muted gap-2 flex-wrap">
                        <div>
                          <span className="font-semibold text-text">Bill #{bill.invoice_number || bill.id}</span>
                          <span className="ml-2">{bill.store_name || 'Main Branch'} • {new Date(bill.created_at).toLocaleDateString()}</span>
                          <span className="ml-2 font-bold text-text">₹{Number(bill.total_amount || 0).toFixed(2)}</span>
                        </div>
                        <button
                          type="button"
                          disabled={refillingInvoiceId === bill.id}
                          onClick={() => handleRefillEntireBill(bill.id)}
                          className="px-2.5 py-1 text-[11px] font-bold bg-primary text-white rounded-lg hover:bg-primary/90 transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          title="Reorder all items in this bill using current prices"
                        >
                          <RefreshCw size={11} className={refillingInvoiceId === bill.id ? 'animate-spin' : ''} />
                          <span>{refillingInvoiceId === bill.id ? 'Refilling…' : 'Refill Entire Bill'}</span>
                        </button>
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
                                {it.quantity && it.quantity > 1 && (
                                  <span className="text-[10px] text-muted bg-bg2 px-1.5 py-0.5 rounded">×{it.quantity}</span>
                                )}
                              </div>
                              <span className="text-muted font-medium">₹{price.toFixed(2)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
                        <div className="max-w-[60%]">
                          <span className="font-semibold block truncate">{item.product}</span>
                          <span className="text-muted">Qty: {item.qty} × ₹{item.price.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-primary">₹{(item.price * item.qty).toFixed(2)}</span>
                          <button
                            type="button"
                            onClick={() => toggleItem(item.product, item.price)}
                            title={`Remove ${item.product}`}
                            className="p-1 rounded-md text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
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
                  <div className="space-y-1.5 pt-2">
                    <label className="text-xs font-semibold text-text uppercase tracking-wider block">
                      Payment Mode
                    </label>
                    <div className="p-3 bg-primary/10 border border-primary/20 rounded-xl flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <QrCode className="w-5 h-5 text-primary" />
                        <div>
                          <span className="text-xs font-bold text-text block">Dynamic UPI QR</span>
                          <span className="text-[10px] text-muted">Scan & pay with any UPI app</span>
                        </div>
                      </div>
                      <span className="text-[10px] font-black uppercase px-2 py-0.5 bg-primary text-white rounded-md">UPI</span>
                    </div>
                  </div>

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
      </div>
      )}
    </main>

      {/* Public Catalog Cart Checkout Modal */}
      {isCartModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-bg2 border border-border rounded-2xl w-full max-w-lg p-5 sm:p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-primary" />
                <h3 className="text-base font-bold text-text">Refill Order Checkout</h3>
              </div>
              <button
                onClick={() => setIsCartModalOpen(false)}
                className="text-muted hover:text-text p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            {orderError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-600 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{orderError}</span>
              </div>
            )}

            {/* Selected Items List */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-muted uppercase tracking-wider block">
                  Selected Medicines ({selectedList.length})
                </span>
                {selectedList.length > 0 && (
                  <button
                    type="button"
                    onClick={clearCart}
                    className="text-[11px] font-semibold text-muted hover:text-red-400 transition-colors cursor-pointer"
                  >
                    Clear All
                  </button>
                )}
              </div>
              <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                {selectedList.map(item => (
                  <div key={item.product} className="flex items-center justify-between p-3 bg-bg rounded-xl border border-border">
                    <div className="space-y-0.5 max-w-[50%]">
                      <span className="text-xs font-bold text-text block truncate">{item.product}</span>
                      <span className="text-[11px] text-muted">₹{item.price.toFixed(2)} each</span>
                    </div>
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <button
                        onClick={() => updateQuantity(item.product, -1)}
                        className="w-6 h-6 rounded-md bg-bg2 flex items-center justify-center text-text hover:bg-bg3 hover:text-red-500 transition-colors cursor-pointer"
                        title={item.qty === 1 ? 'Remove medicine' : 'Decrease quantity'}
                      >
                        {item.qty === 1 ? <Trash2 className="w-3 h-3 text-red-500" /> : <Minus className="w-3 h-3" />}
                      </button>
                      <span className="text-xs font-bold text-primary px-1.5">{item.qty}</span>
                      <button
                        onClick={() => updateQuantity(item.product, 1)}
                        className="w-6 h-6 rounded-md bg-bg2 flex items-center justify-center text-text hover:bg-bg3 transition-colors cursor-pointer"
                        title="Increase quantity"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <span className="text-xs font-bold text-text ml-1 min-w-16 text-right">
                        ₹{(item.price * item.qty).toFixed(2)}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleItem(item.product, item.price)}
                        className="p-1 rounded-md text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors ml-1 cursor-pointer"
                        title={`Remove ${item.product}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Total */}
            <div className="p-3 bg-primary/10 rounded-xl border border-primary/20 flex items-center justify-between">
              <span className="text-xs font-semibold text-text">Estimated Total Amount:</span>
              <span className="text-base font-extrabold text-primary">₹{totalAmount.toFixed(2)}</span>
            </div>

            {/* Delivery / Collection Mode Selection (§15: Feature Flagged) */}
            {deliveryEnabled ? (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text uppercase tracking-wider block">
                  Order Fulfillment
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setDeliveryMode('pickup')}
                    className={`p-2.5 rounded-xl border text-xs font-bold text-left transition-all ${
                      deliveryMode === 'pickup'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-bg text-muted'
                    }`}
                  >
                    🏢 In-Store Pickup
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeliveryMode('delivery')}
                    className={`p-2.5 rounded-xl border text-xs font-bold text-left transition-all ${
                      deliveryMode === 'delivery'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-bg text-muted'
                    }`}
                  >
                    🚚 Home Delivery
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-bg rounded-xl border border-border flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="p-2 rounded-lg bg-primary/10 text-primary text-sm">🏢</span>
                  <div>
                    <span className="text-xs font-bold text-text block">Order Fulfillment: In-Store Pickup</span>
                    <span className="text-[11px] text-muted">Home delivery is currently disabled. Collect directly from the branch.</span>
                  </div>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                  Pickup Only
                </span>
              </div>
            )}

            {/* Branch Selection (for pickup or primary branch) */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-text uppercase tracking-wider flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-primary" />
                <span>Pickup Pharmacy Branch</span>
              </label>
              <select
                value={selectedStoreId}
                onChange={e => setSelectedStoreId(parseInt(e.target.value, 10))}
                className="w-full bg-bg border border-border rounded-xl px-3 py-2 text-xs font-semibold text-text focus:outline-none focus:border-primary"
              >
                {stores.length > 0 ? (
                  stores.map(st => (
                    <option key={st.id} value={st.id}>
                      Store #{st.id} - {st.name} {st.address ? `(${st.address})` : ''}
                    </option>
                  ))
                ) : (
                  <option value={1}>Store #1 - Main Store</option>
                )}
              </select>
            </div>

            {/* Delivery Address (Preserved, shown only when delivery is enabled AND selected) */}
            {deliveryEnabled && deliveryMode === 'delivery' && (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-text uppercase tracking-wider block">
                  Delivery Address <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="Full delivery address with flat/house no, landmark, pincode"
                  value={deliveryAddress || session?.address || ''}
                  onChange={e => setDeliveryAddress(e.target.value)}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary resize-none"
                  required
                />
              </div>
            )}

            {/* Customer Details (If Guest) */}
            {!session && (
              <div className="space-y-3 pt-2 border-t border-border">
                <span className="text-xs font-bold text-muted uppercase tracking-wider block">
                  Patient Contact Info (For Order Updates on WhatsApp)
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-text mb-1">Full Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Rahul Sharma"
                      value={guestName}
                      onChange={e => setGuestName(e.target.value)}
                      className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-text mb-1">WhatsApp Mobile Number</label>
                    <input
                      type="tel"
                      placeholder="e.g. 9876543210"
                      value={guestPhone}
                      onChange={e => setGuestPhone(e.target.value)}
                      className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary"
                      required
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Optional Instructions / Notes */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted block">
                Special Instructions (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Call before delivery, prefer evening pickup, etc."
                value={orderNotes}
                onChange={e => setOrderNotes(e.target.value)}
                className="w-full px-3 py-1.5 bg-bg border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary"
              />
            </div>

            {/* Payment Mode */}
            <div className="space-y-1.5 pt-1">
              <label className="text-xs font-semibold text-text uppercase tracking-wider block">
                {deliveryMode === 'delivery' ? 'Payment Method' : 'Collection Payment Mode'}
              </label>
              <div className="p-3 bg-primary/10 border border-primary/20 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <QrCode className="w-5 h-5 text-primary" />
                  <div>
                    <span className="text-xs font-bold text-text block">Pay via UPI (Dynamic QR)</span>
                    <span className="text-[11px] text-muted">Scan & pay via GPay / PhonePe / Paytm upon placement</span>
                  </div>
                </div>
                <span className="text-[10px] font-black uppercase px-2 py-0.5 bg-primary text-white rounded-md">UPI QR</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => setIsCartModalOpen(false)}
                className="px-4 py-2 border border-border rounded-xl text-xs font-semibold text-muted hover:text-text"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmitting || selectedList.length === 0}
                onClick={handlePlaceOrder}
                className="px-5 py-2.5 bg-primary text-white rounded-xl text-xs font-bold shadow-md hover:opacity-95 transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {isSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                <span>{deliveryMode === 'delivery' ? 'Confirm & Place Delivery Order' : 'Confirm & Place Pickup Order'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* 3-UPI QR Payment Modal (§12, §13, §14) */}
      {paymentQrModal && paymentQrModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-bg2 border border-border rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl text-center">
            <div className="flex items-center justify-between border-b border-border pb-3 text-left">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-primary" />
                <div>
                  <h3 className="text-sm font-bold text-text">Scan & Pay via UPI</h3>
                  <span className="text-[11px] text-muted block">{paymentQrModal.label}</span>
                </div>
              </div>
              <button
                onClick={() => setPaymentQrModal(null)}
                className="text-muted hover:text-text p-1 rounded-lg text-sm"
              >
                ✕
              </button>
            </div>

            {/* Total Amount Badge */}
            <div className="p-3 bg-primary/10 rounded-xl border border-primary/20">
              <span className="text-[11px] text-muted block mb-0.5">Total Payable Amount</span>
              <span className="text-xl font-extrabold text-primary">₹{paymentQrModal.amount.toFixed(2)}</span>
            </div>

            {/* QR Code Container */}
            <div className="p-3 bg-bg3 rounded-xl border border-border inline-block shadow-sm mx-auto">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(paymentQrModal.upiUri)}`}
                alt="UPI Payment QR"
                className="w-44 h-44 mx-auto"
              />
            </div>

            {/* UPI Account Details */}
            <div className="space-y-1.5 text-left bg-bg p-3 rounded-xl border border-border text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-muted">Payee:</span>
                <span className="font-semibold text-text">{paymentQrModal.payeeName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">UPI ID:</span>
                <span className="font-mono font-bold text-primary">{paymentQrModal.upiId}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Order Ref:</span>
                <span className="font-mono text-text">#{paymentQrModal.orderId}</span>
              </div>
            </div>

            {/* Direct Pay Link for Mobile */}
            <a
              href={paymentQrModal.upiUri}
              className="w-full py-2 bg-bg3 hover:bg-bg border border-border text-text rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Open in UPI App (GPay / PhonePe / Paytm)</span>
            </a>

            {/* Actions: "I HAVE PAID" (§12) */}
            <div className="space-y-2 pt-1">
              {!paymentQrModal.isPaidMarked ? (
                <button
                  onClick={handleMarkPaid}
                  disabled={isMarkingPaid}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2 text-xs disabled:opacity-50"
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
                onClick={() => setPaymentQrModal(null)}
                className="w-full py-1.5 text-xs text-muted hover:text-text font-medium"
              >
                {paymentQrModal.isPaidMarked ? 'Close & View Orders' : 'Cancel & Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
