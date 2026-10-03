import React from 'react';
import {
  ShieldCheck, Key, MessageSquare, UserPlus, AlertCircle, CheckCircle2,
  RefreshCw, Eye, EyeOff, User, Phone, MapPin, Lock, BadgeCheck, Truck, FileText
} from 'lucide-react';

interface CustomerPortalAuthProps {
  authMode: 'pin' | 'otp' | 'register';
  setAuthMode: (mode: 'pin' | 'otp' | 'register') => void;
  isOtpMode: boolean;
  setIsOtpMode: (val: boolean) => void;
  authError: string;
  setAuthError: (val: string) => void;
  authSuccess: string;
  setAuthSuccess: (val: string) => void;
  authLoading: boolean;
  phoneInput: string;
  setPhoneInput: (val: string) => void;
  pinInput: string;
  setPinInput: (val: string) => void;
  showPinPassword: boolean;
  setShowPinPassword: (val: boolean) => void;
  handleLogin: (e: React.FormEvent) => void;
  otpSent: boolean;
  setOtpSent: (val: boolean) => void;
  otpInput: string;
  setOtpInput: (val: string) => void;
  handleRequestOtp: () => void;
  handleVerifyOtp: (e: React.FormEvent) => void;
  regName: string;
  setRegName: (val: string) => void;
  regPhone: string;
  setRegPhone: (val: string) => void;
  regAddress: string;
  setRegAddress: (val: string) => void;
  regPin: string;
  setRegPin: (val: string) => void;
  regConfirmPin: string;
  setRegConfirmPin: (val: string) => void;
  handleRegister: (e: React.FormEvent) => void;
}

export const CustomerPortalAuth: React.FC<CustomerPortalAuthProps> = ({
  authMode,
  setAuthMode,
  isOtpMode,
  setIsOtpMode,
  authError,
  setAuthError,
  authSuccess,
  setAuthSuccess,
  authLoading,
  phoneInput,
  setPhoneInput,
  pinInput,
  setPinInput,
  showPinPassword,
  setShowPinPassword,
  handleLogin,
  otpSent,
  setOtpSent,
  otpInput,
  setOtpInput,
  handleRequestOtp,
  handleVerifyOtp,
  regName,
  setRegName,
  regPhone,
  setRegPhone,
  regAddress,
  setRegAddress,
  regPin,
  setRegPin,
  regConfirmPin,
  setRegConfirmPin,
  handleRegister,
}) => {
  return (
    <div className="max-w-xl mx-auto bg-bg2 border border-border rounded-3xl shadow-xl p-6 sm:p-8 space-y-6">
      {/* Header */}
      <div className="text-center space-y-1.5">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-primary/10 text-primary mb-1">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <h3 className="text-xl sm:text-2xl font-black text-text">
          {authMode === 'register' ? 'Create Patient Account' : 'Patient Portal Access'}
        </h3>
        <p className="text-xs text-muted">
          {authMode === 'register'
            ? 'Register once to manage all prescriptions, bills & refills online'
            : 'Secure access to your medical bills, prescriptions & delivery history'}
        </p>
      </div>

      {/* Segmented Auth Selector Tabs */}
      <div className="grid grid-cols-3 gap-1 p-1 bg-bg border border-border rounded-2xl text-xs font-bold">
        <button
          type="button"
          onClick={() => { setAuthMode('pin'); setIsOtpMode(false); setAuthError(''); setAuthSuccess(''); }}
          className={`py-2 px-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            authMode === 'pin' && !isOtpMode
              ? 'bg-primary text-white shadow-xs'
              : 'text-muted hover:text-text'
          }`}
        >
          <Key className="w-3.5 h-3.5" />
          <span className="truncate">PIN Login</span>
        </button>

        <button
          type="button"
          onClick={() => { setAuthMode('otp'); setIsOtpMode(true); setAuthError(''); setAuthSuccess(''); }}
          className={`py-2 px-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            authMode === 'otp' || isOtpMode
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'text-muted hover:text-text'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span className="truncate">WhatsApp OTP</span>
        </button>

        <button
          type="button"
          onClick={() => { setAuthMode('register'); setIsOtpMode(false); setAuthError(''); setAuthSuccess(''); }}
          className={`py-2 px-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            authMode === 'register'
              ? 'bg-primary text-white shadow-xs'
              : 'text-muted hover:text-text'
          }`}
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span className="truncate">Register</span>
        </button>
      </div>

      {/* Alert feedback */}
      {authError && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-2 text-xs font-semibold text-rose-500">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{authError}</span>
        </div>
      )}

      {authSuccess && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-2 text-xs font-semibold text-emerald-500">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{authSuccess}</span>
        </div>
      )}

      {/* FORM 1: PIN Login */}
      {authMode === 'pin' && !isOtpMode && (
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-[11px] font-bold text-text uppercase tracking-wider mb-1.5">
              Mobile Number
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-muted">+91</span>
              <input
                type="tel"
                maxLength={10}
                placeholder="9876543210"
                value={phoneInput}
                onChange={e => setPhoneInput(e.target.value.replace(/\D/g, ''))}
                className="w-full pl-12 pr-4 py-2.5 bg-bg border border-border rounded-xl text-text placeholder:text-muted focus:outline-none focus:border-primary text-sm font-semibold tracking-wider"
                required
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[11px] font-bold text-text uppercase tracking-wider">
                Portal Security PIN (4–6 digits)
              </label>
              <button
                type="button"
                onClick={() => { setAuthMode('otp'); setIsOtpMode(true); setOtpSent(false); setAuthError(''); setAuthSuccess(''); }}
                className="text-[11px] text-primary hover:underline font-semibold cursor-pointer"
              >
                Forgot PIN?
              </button>
            </div>
            <div className="relative">
              <Key className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type={showPinPassword ? 'text' : 'password'}
                maxLength={6}
                placeholder="••••••"
                value={pinInput}
                onChange={e => setPinInput(e.target.value)}
                className="w-full pl-10 pr-10 py-2.5 bg-bg border border-border rounded-xl text-text placeholder:text-muted focus:outline-none focus:border-primary text-sm font-semibold tracking-widest"
                required
              />
              <button
                type="button"
                onClick={() => setShowPinPassword(!showPinPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted hover:text-text cursor-pointer"
              >
                {showPinPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={authLoading}
            className="w-full py-3 bg-primary hover:opacity-95 text-white rounded-xl font-bold shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 text-sm cursor-pointer"
          >
            {authLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            <span>Login to My Patient Portal</span>
          </button>

          <div className="p-2.5 bg-bg border border-border rounded-xl text-[11px] text-muted text-center leading-relaxed">
            💡 Visited our pharmacy counter before? If you don't know your PIN, click{' '}
            <button
              type="button"
              onClick={() => { setAuthMode('otp'); setIsOtpMode(true); setOtpSent(false); setAuthError(''); setAuthSuccess(''); }}
              className="text-primary font-bold hover:underline cursor-pointer inline"
            >
              Forgot PIN / WhatsApp OTP
            </button>{' '}
            to receive an instant code on WhatsApp.
          </div>

          <div className="pt-1 text-center text-xs text-muted">
            <span>New to our pharmacy? </span>
            <button
              type="button"
              onClick={() => setAuthMode('register')}
              className="text-primary font-bold hover:underline cursor-pointer"
            >
              Register your account in 10 seconds →
            </button>
          </div>
        </form>
      )}

      {/* FORM 2: WhatsApp OTP Login */}
      {(authMode === 'otp' || isOtpMode) && (
        <form onSubmit={handleVerifyOtp} className="space-y-4">
          <div>
            <label className="block text-[11px] font-bold text-text uppercase tracking-wider mb-1.5">
              WhatsApp Mobile Number
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-muted">+91</span>
              <input
                type="tel"
                maxLength={10}
                placeholder="9876543210"
                value={phoneInput}
                onChange={e => setPhoneInput(e.target.value.replace(/\D/g, ''))}
                className="w-full pl-12 pr-4 py-2.5 bg-bg border border-border rounded-xl text-text placeholder:text-muted focus:outline-none focus:border-primary text-sm font-semibold tracking-wider"
                required
              />
            </div>
            <p className="text-[11px] text-muted mt-1">
              We will send a 6-digit verification code directly to your WhatsApp.
            </p>
          </div>

          {otpSent ? (
            <div className="space-y-2">
              <label className="block text-[11px] font-bold text-text uppercase tracking-wider">
                6-Digit WhatsApp Verification Code
              </label>
              <input
                type="text"
                maxLength={6}
                placeholder="123456"
                value={otpInput}
                onChange={e => setOtpInput(e.target.value)}
                className="w-full text-center tracking-widest py-3 bg-bg border-2 border-emerald-500/50 rounded-xl text-text text-xl font-bold focus:outline-none focus:border-emerald-500 font-mono"
                required
                autoFocus
              />
              <div className="flex items-center justify-between text-xs pt-1">
                <span className="text-emerald-500 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>OTP sent to WhatsApp!</span>
                </span>
                <button
                  type="button"
                  onClick={handleRequestOtp}
                  disabled={authLoading}
                  className="text-primary hover:underline font-bold cursor-pointer"
                >
                  Resend Code
                </button>
              </div>

              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-md transition-all flex items-center justify-center gap-2 mt-2 cursor-pointer"
              >
                {authLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                <span>Verify &amp; Enter Portal</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleRequestOtp}
              disabled={authLoading || phoneInput.length < 10}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {authLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
              <span>Send 6-Digit OTP via WhatsApp</span>
            </button>
          )}

          <div className="pt-1 text-center text-xs text-muted">
            <button
              type="button"
              onClick={() => { setAuthMode('pin'); setIsOtpMode(false); }}
              className="hover:text-text transition-colors cursor-pointer"
            >
              ← Back to PIN Login
            </button>
          </div>
        </form>
      )}

      {/* FORM 3: Patient Registration */}
      {authMode === 'register' && (
        <form onSubmit={handleRegister} className="space-y-3.5">
          {/* Notice for existing counter bill patients */}
          <div className="p-3.5 bg-amber-500/10 border border-amber-500/25 rounded-2xl flex items-start gap-2.5 text-xs text-amber-500">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
            <div className="space-y-1">
              <p className="font-bold">Already purchased from our pharmacy counter?</p>
              <p className="text-[11px] leading-relaxed opacity-95">
                If you have a past bill from our store, your mobile number is <strong>already registered</strong>! You don't need to create a new account. Simply click{' '}
                <button
                  type="button"
                  onClick={() => { setAuthMode('otp'); setIsOtpMode(true); setOtpSent(false); setAuthError(''); setAuthSuccess(''); }}
                  className="font-bold underline text-amber-500 hover:opacity-80 cursor-pointer inline"
                >
                  WhatsApp OTP
                </button>{' '}
                to login instantly with your phone number.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-text uppercase tracking-wider mb-1">
              Patient Full Name <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <User className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                placeholder="e.g. Ramesh Patel"
                value={regName}
                onChange={e => setRegName(e.target.value)}
                className="w-full pl-8 pr-3 py-2 bg-bg border border-border rounded-xl text-text placeholder:text-muted focus:outline-none focus:border-primary text-sm font-medium"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-text uppercase tracking-wider mb-1">
              Mobile Number (WhatsApp) <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <Phone className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="tel"
                maxLength={10}
                placeholder="10-digit mobile number"
                value={regPhone}
                onChange={e => setRegPhone(e.target.value.replace(/\D/g, ''))}
                className="w-full pl-8 pr-3 py-2 bg-bg border border-border rounded-xl text-text placeholder:text-muted focus:outline-none focus:border-primary text-sm font-medium font-mono"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-text uppercase tracking-wider mb-1">
              Delivery / Home Address
            </label>
            <div className="relative">
              <MapPin className="w-3.5 h-3.5 absolute left-3 top-2.5 text-muted" />
              <textarea
                rows={2}
                placeholder="Flat / Building, Street, Area, City"
                value={regAddress}
                onChange={e => setRegAddress(e.target.value)}
                className="w-full pl-8 pr-3 py-2 bg-bg border border-border rounded-xl text-text placeholder:text-muted focus:outline-none focus:border-primary text-xs font-medium resize-none leading-relaxed"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-bold text-text uppercase tracking-wider mb-1">
                Set 4–6 Digit PIN <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Lock className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="password"
                  maxLength={6}
                  placeholder="Set PIN"
                  value={regPin}
                  onChange={e => setRegPin(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 bg-bg border border-border rounded-xl text-text placeholder:text-muted focus:outline-none focus:border-primary text-sm font-semibold tracking-widest text-center"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-text uppercase tracking-wider mb-1">
                Confirm PIN <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Lock className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="password"
                  maxLength={6}
                  placeholder="Confirm PIN"
                  value={regConfirmPin}
                  onChange={e => setRegConfirmPin(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 bg-bg border border-border rounded-xl text-text placeholder:text-muted focus:outline-none focus:border-primary text-sm font-semibold tracking-widest text-center"
                  required
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={authLoading}
            className="w-full py-3 bg-primary hover:opacity-95 text-white rounded-xl font-bold shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 text-sm cursor-pointer mt-1"
          >
            {authLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            <span>Register Account &amp; Log In</span>
          </button>

          <div className="pt-1 text-center text-xs text-muted">
            <span>Already registered? </span>
            <button
              type="button"
              onClick={() => { setAuthMode('pin'); setIsOtpMode(false); }}
              className="text-primary font-bold hover:underline cursor-pointer"
            >
              Back to PIN Login →
            </button>
          </div>
        </form>
      )}

      {/* Patient Trust Guarantees */}
      <div className="pt-4 border-t border-border/70 grid grid-cols-2 gap-2 text-[11px] text-muted">
        <div className="flex items-center gap-1.5">
          <BadgeCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <span>100% Genuine Pharmacy Supply</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Truck className="w-3.5 h-3.5 text-primary shrink-0" />
          <span>Free Pickup or Fast Delivery</span>
        </div>
        <div className="flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-sky-500 shrink-0" />
          <span>Digital Prescription History</span>
        </div>
        <div className="flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <span>WhatsApp Delivery Updates</span>
        </div>
      </div>
    </div>
  );
};
