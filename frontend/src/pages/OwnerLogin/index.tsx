import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck, Lock, User, ArrowRight, AlertCircle, Loader2, Store, CheckCircle2 } from 'lucide-react';
import { authApi, type OwnerSessionResponse } from '../../api/authApi';

export const OwnerLogin: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextUrl = searchParams.get('next') || '/crm';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<OwnerSessionResponse | null>(null);

  useEffect(() => {
    let isMounted = true;
    authApi.getSession()
      .then((session) => {
        if (!isMounted) return;
        setSessionInfo(session);
        // If already authenticated on remote or desktop local, redirect to target page
        if (session.authenticated && session.user?.role === 'owner') {
          const token = localStorage.getItem('pharmacy_owner_token');
          if (session.mode === 'local' || token) {
            navigate(nextUrl, { replace: true });
          }
        }
      })
      .catch((err) => {
        console.warn('Session check fallback:', err);
      })
      .finally(() => {
        if (isMounted) setCheckingSession(false);
      });

    return () => { isMounted = false; };
  }, [navigate, nextUrl]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setErrorMessage('Please enter both username and password.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await authApi.loginOwner(username.trim(), password);
      if (res && res.token) {
        localStorage.setItem('pharmacy_owner_token', res.token);
        if (res.activeStore?.id) {
          localStorage.setItem('active_store_id', String(res.activeStore.id));
        }
        // Redirect to intended destination or CRM
        const decodedNext = decodeURIComponent(nextUrl);
        navigate(decodedNext.startsWith('/') ? decodedNext : '/crm', { replace: true });
      } else {
        setErrorMessage('Authentication succeeded but no authorization token was returned.');
      }
    } catch (err: any) {
      const serverMsg = err.response?.data?.error || err.message || 'Login failed. Please verify credentials.';
      setErrorMessage(serverMsg);
    } finally {
      setLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-bg text-text">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <span className="text-xs text-muted font-semibold uppercase tracking-wider">Verifying Session...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex flex-col justify-center items-center p-4 bg-bg text-text">
      <div className="w-full max-w-md bg-bg2 border border-border rounded-2xl shadow-2xl p-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-1">
            <ShieldCheck size={32} />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-text">
            Owner Web Portal
          </h1>
          <p className="text-xs text-muted max-w-xs">
            Secure remote management for pharmacy owner. Access CRM patients, refills, and Pharmarack live-cart.
          </p>
        </div>

        {/* Local mode informational banner */}
        {sessionInfo?.mode === 'local' && (
          <div className="bg-primary/10 border border-primary/25 rounded-xl p-3.5 flex items-start gap-3 text-xs">
            <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-text">Desktop Local Mode Active</p>
              <p className="text-muted leading-relaxed">
                You are directly on the pharmacy PC. Full access is already unlocked without a remote login gate.
              </p>
              <button
                type="button"
                onClick={() => navigate(nextUrl, { replace: true })}
                className="inline-flex items-center gap-1 font-bold text-primary hover:underline pt-1 cursor-pointer"
              >
                Continue to App <ArrowRight size={12} />
              </button>
            </div>
          </div>
        )}

        {/* Error notification */}
        {errorMessage && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-red-500">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="font-medium leading-relaxed">{errorMessage}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5" htmlFor="owner-username">
              Owner Username
            </label>
            <div className="relative">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
              <input
                id="owner-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter owner username"
                autoComplete="username"
                disabled={loading}
                className="w-full pl-10 pr-4 py-2.5 bg-bg border border-border rounded-xl text-sm text-text placeholder:text-muted/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5" htmlFor="owner-password">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
              <input
                id="owner-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
                disabled={loading}
                className="w-full pl-10 pr-4 py-2.5 bg-bg border border-border rounded-xl text-sm text-text placeholder:text-muted/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-primary hover:bg-primary/90 text-white font-bold text-sm rounded-xl shadow-lg shadow-primary/20 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Authenticating...</span>
              </>
            ) : (
              <>
                <span>Sign In to Owner Portal</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        {/* Footer info */}
        <div className="pt-2 border-t border-border/60 flex items-center justify-between text-[11px] text-muted">
          <div className="flex items-center gap-1.5">
            <Store size={13} className="text-muted" />
            <span>AI Pharmacy OS</span>
          </div>
          <span className="font-medium">Strict Owner Access</span>
        </div>
      </div>
    </div>
  );
};

export default OwnerLogin;
