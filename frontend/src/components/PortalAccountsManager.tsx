import React, { useState, useEffect, useCallback } from 'react';
import {
  Users, Key, Phone, Store, RefreshCw, Send, Plus, Search,
  CheckCircle2, AlertCircle, ShieldCheck, Copy, Check, Lock,
  MessageSquare, ToggleLeft, ToggleRight, Trash2, Globe, Clock, History, X
} from 'lucide-react';
import { api } from '../services/api';
import { toastEvent } from '../services/events';

interface PortalAccount {
  id: number;
  customer_id: number;
  login_id: string;
  pin_display?: string;
  preferred_store_id: number;
  preferred_store_name?: string;
  status: string;
  last_login_at?: string;
  total_login_count?: number;
  total_time_spent_seconds?: number;
  last_logout_at?: string;
  customer_name: string;
  customer_address?: string;
  active_refills_count: number;
  total_bills_count: number;
  created_at: string;
}

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '0m';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

interface StoreItem {
  id: number;
  name: string;
}

export function PortalAccountsManager() {
  const [accounts, setAccounts] = useState<PortalAccount[]>([]);
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [storeFilter, setStoreFilter] = useState<number | ''>('');
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    preferred_store_id: 1,
    custom_pin: '',
    send_whatsapp: true
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Override PIN Modal State
  const [overrideModalAcc, setOverrideModalAcc] = useState<PortalAccount | null>(null);
  const [overridePinInput, setOverridePinInput] = useState('');
  const [overrideSendWa, setOverrideSendWa] = useState(true);
  const [isOverriding, setIsOverriding] = useState(false);

  // Session History Modal State
  const [sessionModalAcc, setSessionModalAcc] = useState<PortalAccount | null>(null);
  const [sessionLogs, setSessionLogs] = useState<any[]>([]);
  const [sessionStats, setSessionStats] = useState<any>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const handleOpenSessions = async (acc: PortalAccount) => {
    setSessionModalAcc(acc);
    setLoadingSessions(true);
    try {
      const res = await api.getPortalAccountSessions(acc.id);
      if (res.success) {
        setSessionLogs(res.sessions || []);
        setSessionStats(res.stats || null);
      }
    } catch (err) {
      toastEvent.trigger('Failed to fetch session history', 'error');
    } finally {
      setLoadingSessions(false);
    }
  };

  // Load stores
  useEffect(() => {
    api.getStores().then(data => {
      if (Array.isArray(data)) {
        setStores(data.map(s => ({ id: s.id, name: s.name })));
      }
    }).catch(() => {});
  }, []);

  // Fetch accounts
  const fetchAccounts = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getPortalAccounts({
        search: searchQuery || undefined,
        store_id: storeFilter ? Number(storeFilter) : undefined
      });
      if (res.success && Array.isArray(res.accounts)) {
        setAccounts(res.accounts);
      }
    } catch (err) {
      console.warn('[PortalManager] Failed to fetch accounts:', err);
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, storeFilter]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // Generate / Create Account Handler
  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.phone || formData.phone.replace(/\D/g, '').length < 10) {
      toastEvent.trigger('Please enter a valid 10-digit mobile number', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.generatePortalAccount({
        phone: formData.phone,
        name: formData.name || 'Customer',
        preferred_store_id: formData.preferred_store_id,
        custom_pin: formData.custom_pin || undefined,
        send_whatsapp: formData.send_whatsapp
      });

      if (res.success) {
        toastEvent.trigger(`Web Login created! PIN: ${res.pin}${res.whatsapp_queued ? ' (Sent to WhatsApp)' : ''}`, 'success');
        setIsModalOpen(false);
        setFormData({
          name: '',
          phone: '',
          preferred_store_id: 1,
          custom_pin: '',
          send_whatsapp: true
        });
        fetchAccounts();
      }
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || 'Failed to generate web login', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Resend WhatsApp Credentials
  const handleResendWhatsApp = async (acc: PortalAccount) => {
    try {
      const res = await api.resendPortalCredentials(acc.id);
      if (res.success) {
        toastEvent.trigger(`Credentials sent to ${acc.customer_name}'s WhatsApp!`, 'success');
        fetchAccounts();
      }
    } catch (err) {
      toastEvent.trigger('Failed to send WhatsApp message', 'error');
    }
  };

  // Toggle Status
  const handleToggleStatus = async (acc: PortalAccount) => {
    const newStatus = acc.status === 'active' ? 'disabled' : 'active';
    try {
      const res = await api.updatePortalAccount(acc.id, { status: newStatus });
      if (res.success) {
        toastEvent.trigger(`Account ${newStatus === 'active' ? 'activated' : 'disabled'}`, 'success');
        fetchAccounts();
      }
    } catch (err) {
      toastEvent.trigger('Failed to update account status', 'error');
    }
  };

  // Update Preferred Store
  const handleStoreChange = async (accId: number, storeId: number) => {
    try {
      await api.updatePortalAccount(accId, { preferred_store_id: storeId });
      toastEvent.trigger('Preferred branch updated', 'success');
      fetchAccounts();
    } catch (err) {
      toastEvent.trigger('Failed to update branch', 'error');
    }
  };

  // Handle Save PIN Override
  const handleSavePinOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideModalAcc || !overridePinInput || overridePinInput.length < 4) {
      toastEvent.trigger('Please enter at least 4 digits for PIN', 'error');
      return;
    }
    setIsOverriding(true);
    try {
      const res = await api.updatePortalAccount(overrideModalAcc.id, {
        custom_pin: overridePinInput,
        send_whatsapp: overrideSendWa
      } as any);
      if (res.success) {
        toastEvent.trigger(`PIN updated to ${overridePinInput}${overrideSendWa ? ' & sent to WhatsApp' : ''}!`, 'success');
        setOverrideModalAcc(null);
        setOverridePinInput('');
        fetchAccounts();
      }
    } catch (err: any) {
      toastEvent.trigger('Failed to update PIN', 'error');
    } finally {
      setIsOverriding(false);
    }
  };

  const copyToClipboard = (text: string, id: number) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="bg-bg2 border border-border rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
        <div>
          <h2 className="text-base font-bold text-text flex items-center gap-2">
            <Globe className="w-5 h-5 text-primary" />
            <span>Customer Web Portal & Refill Logins</span>
          </h2>
          <p className="text-xs text-muted">
            Manage customer online accounts, 4-digit PINs, collection branches, and WhatsApp credentials
          </p>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <button
            onClick={fetchAccounts}
            disabled={isLoading}
            className="p-2.5 bg-bg border border-border rounded-xl text-text hover:bg-bg3 transition-colors text-xs font-semibold flex items-center gap-1.5"
            title="Refresh list"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          <a
            href="/customer-login"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3.5 py-2.5 bg-bg border border-border rounded-xl text-text hover:bg-bg3 transition-colors text-xs font-semibold flex items-center gap-1.5"
            title="Open Customer Web Login in new tab"
          >
            <Globe className="w-4 h-4 text-primary" />
            <span className="hidden sm:inline">Open Web Login</span>
          </a>

          <button
            onClick={() => setIsModalOpen(true)}
            className="flex-1 sm:flex-none px-4 py-2.5 bg-primary text-white rounded-xl text-xs font-bold shadow-md hover:opacity-95 transition-all flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>+ Create Customer Web Login</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search by customer name or phone..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-bg2 border border-border rounded-xl text-text text-xs focus:outline-none focus:border-primary placeholder:text-muted"
          />
        </div>

        <div className="w-full sm:w-60">
          <select
            value={storeFilter}
            onChange={e => setStoreFilter(e.target.value ? Number(e.target.value) : '')}
            className="w-full py-2 px-3 bg-bg2 border border-border rounded-xl text-text text-xs font-medium focus:outline-none focus:border-primary"
          >
            <option value="">All Branches</option>
            {stores.map(st => (
              <option key={st.id} value={st.id}>
                Store #{st.id} - {st.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Accounts Table */}
      <div className="bg-bg2 border border-border rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-text border-collapse">
            <thead>
              <tr className="bg-bg border-b border-border text-muted uppercase font-bold tracking-wider text-[11px]">
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Login ID (Phone)</th>
                <th className="py-3 px-4">4-Digit PIN</th>
                <th className="py-3 px-4">Preferred Branch</th>
                <th className="py-3 px-4">Refills / Bills</th>
                <th className="py-3 px-4">Logins & Time</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {isLoading && accounts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-muted">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                    <span>Loading portal accounts...</span>
                  </td>
                </tr>
              ) : accounts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-muted">
                    No customer portal accounts found. Click "+ Create Customer Web Login" to add one!
                  </td>
                </tr>
              ) : (
                accounts.map(acc => (
                  <tr key={acc.id} className="hover:bg-bg/50 transition-colors">
                    <td className="py-3 px-4">
                      <span className="font-bold text-text block">{acc.customer_name}</span>
                      {acc.customer_address && (
                        <span className="text-[10px] text-muted truncate max-w-[150px] block">
                          {acc.customer_address}
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 font-mono font-semibold">
                      {acc.login_id}
                    </td>

                    <td className="py-3 px-4">
                      <div className="inline-flex items-center gap-1.5 bg-bg px-2 py-1 rounded-lg border border-border font-mono font-bold text-primary">
                        <span>{acc.pin_display || '••••'}</span>
                        {acc.pin_display && (
                          <button
                            onClick={() => copyToClipboard(acc.pin_display!, acc.id)}
                            className="text-muted hover:text-text transition-colors"
                            title="Copy PIN"
                          >
                            {copiedId === acc.id ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                          </button>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <select
                        value={acc.preferred_store_id || 1}
                        onChange={e => handleStoreChange(acc.id, Number(e.target.value))}
                        className="bg-bg border border-border rounded-lg px-2 py-1 text-[11px] font-semibold text-text focus:outline-none focus:border-primary"
                      >
                        {stores.map(st => (
                          <option key={st.id} value={st.id}>
                            Store #{st.id} - {st.name}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="py-3 px-4 text-muted">
                      <span className="font-semibold text-emerald-600">{acc.active_refills_count} Refills</span>
                      <span className="mx-1">•</span>
                      <span>{acc.total_bills_count} Bills</span>
                    </td>

                    <td className="py-3 px-4">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5 font-bold text-text">
                          <Clock className="w-3.5 h-3.5 text-primary" />
                          <span>{acc.total_login_count || 0} logins</span>
                          <span className="text-[10px] text-muted font-normal">({formatDuration(acc.total_time_spent_seconds)})</span>
                        </div>
                        <button
                          onClick={() => handleOpenSessions(acc)}
                          className="text-[10px] text-primary hover:underline text-left flex items-center gap-1 font-medium mt-0.5"
                        >
                          <History className="w-3 h-3" />
                          <span>View Sessions</span>
                        </button>
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        acc.status === 'active' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${acc.status === 'active' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                        {acc.status === 'active' ? 'Active' : 'Disabled'}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => {
                            const url = `${window.location.origin}/customer-login?phone=${acc.login_id}`;
                            navigator.clipboard.writeText(url);
                            setCopiedId(acc.id);
                            toastEvent.trigger(`Login link copied for ${acc.customer_name}!`, 'success');
                            setTimeout(() => setCopiedId(null), 2000);
                          }}
                          className="p-1.5 rounded-lg bg-sky-500/10 text-sky-600 hover:bg-sky-500/20 transition-colors"
                          title="Copy Customer Web Login Link"
                        >
                          {copiedId === acc.id ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                        </button>

                        <a
                          href={`/customer-login?phone=${acc.login_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                          title="Open Customer Web Login for this account"
                        >
                          <Globe className="w-4 h-4" />
                        </a>

                        <button
                          onClick={() => {
                            setOverrideModalAcc(acc);
                            setOverridePinInput(acc.pin_display || '');
                            setOverrideSendWa(true);
                          }}
                          className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 transition-colors"
                          title="Edit / Override Customer PIN"
                        >
                          <Key className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => handleResendWhatsApp(acc)}
                          className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors"
                          title="Send Credentials via WhatsApp"
                        >
                          <MessageSquare className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => handleToggleStatus(acc)}
                          className="p-1.5 rounded-lg bg-bg border border-border text-muted hover:text-text transition-colors"
                          title={acc.status === 'active' ? 'Disable Web Access' : 'Enable Web Access'}
                        >
                          {acc.status === 'active' ? <ToggleRight className="w-4 h-4 text-emerald-500" /> : <ToggleLeft className="w-4 h-4 text-muted" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Create / Generate Account */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl w-full max-w-md p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-text flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-primary" />
                <span>Create Customer Web Login</span>
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-muted hover:text-text p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateAccount} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-text uppercase tracking-wider mb-1">
                  Customer Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Rajesh Sharma"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-text focus:outline-none focus:border-primary"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-text uppercase tracking-wider mb-1">
                  Mobile Number (Login ID)
                </label>
                <input
                  type="tel"
                  placeholder="e.g. 9876543210"
                  value={formData.phone}
                  onChange={e => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-text focus:outline-none focus:border-primary font-mono"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-text uppercase tracking-wider mb-1">
                  Preferred Collection Branch
                </label>
                <select
                  value={formData.preferred_store_id}
                  onChange={e => setFormData({ ...formData, preferred_store_id: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-text focus:outline-none focus:border-primary font-semibold"
                >
                  {stores.map(st => (
                    <option key={st.id} value={st.id}>
                      Store #{st.id} - {st.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-text uppercase tracking-wider mb-1">
                  4-Digit PIN (Leave blank to auto-generate)
                </label>
                <input
                  type="text"
                  maxLength={4}
                  placeholder="e.g. 4829 (Auto-generated if empty)"
                  value={formData.custom_pin}
                  onChange={e => setFormData({ ...formData, custom_pin: e.target.value.replace(/\D/g, '') })}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-text focus:outline-none focus:border-primary font-mono tracking-wider"
                />
              </div>

              <div className="p-3 bg-bg rounded-xl border border-border flex items-center justify-between">
                <div>
                  <span className="font-bold block text-text">Send WhatsApp Credentials</span>
                  <span className="text-[10px] text-muted">Auto-pings customer with Login ID, PIN & Web Link</span>
                </div>
                <input
                  type="checkbox"
                  checked={formData.send_whatsapp}
                  onChange={e => setFormData({ ...formData, send_whatsapp: e.target.checked })}
                  className="w-4 h-4 rounded text-primary focus:ring-0 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-border rounded-xl text-muted hover:text-text transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-primary text-white rounded-xl font-bold shadow-md hover:opacity-95 transition-all flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  <span>Generate & Save</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Override / Edit PIN */}
      {overrideModalAcc && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-text flex items-center gap-2">
                <Key className="w-5 h-5 text-amber-500" />
                <span>Override Customer PIN</span>
              </h3>
              <button
                onClick={() => setOverrideModalAcc(null)}
                className="text-muted hover:text-text p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-bg rounded-xl border border-border space-y-1 text-xs">
              <span className="font-bold text-text block">{overrideModalAcc.customer_name}</span>
              <span className="text-muted font-mono">{overrideModalAcc.login_id}</span>
            </div>

            <form onSubmit={handleSavePinOverride} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-text uppercase tracking-wider mb-1">
                  New 4-Digit PIN
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={6}
                    placeholder="e.g. 1234"
                    value={overridePinInput}
                    onChange={e => setOverridePinInput(e.target.value.replace(/\D/g, ''))}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-text font-mono tracking-widest focus:outline-none focus:border-primary text-sm font-bold"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setOverridePinInput(Math.floor(1000 + Math.random() * 9000).toString())}
                    className="px-3 py-2 bg-bg border border-border rounded-xl text-muted hover:text-text font-semibold whitespace-nowrap"
                  >
                    Auto
                  </button>
                </div>
              </div>

              <div className="p-3 bg-bg rounded-xl border border-border flex items-center justify-between">
                <div>
                  <span className="font-bold block text-text">Notify Customer via WhatsApp</span>
                  <span className="text-[10px] text-muted">Auto-pings customer with new PIN</span>
                </div>
                <input
                  type="checkbox"
                  checked={overrideSendWa}
                  onChange={e => setOverrideSendWa(e.target.checked)}
                  className="w-4 h-4 rounded text-primary focus:ring-0 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setOverrideModalAcc(null)}
                  className="px-4 py-2 border border-border rounded-xl text-muted hover:text-text transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isOverriding}
                  className="px-5 py-2 bg-primary text-white rounded-xl font-bold shadow-md hover:opacity-95 transition-all flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isOverriding ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  <span>Save PIN</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Session History & Usage Auditing */}
      {sessionModalAcc && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl w-full max-w-2xl p-6 space-y-4 shadow-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-border pb-3 shrink-0">
              <div>
                <h3 className="text-base font-bold text-text flex items-center gap-2">
                  <Clock className="w-5 h-5 text-primary" />
                  <span>Customer Login & Session Auditing</span>
                </h3>
                <p className="text-xs text-muted">
                  {sessionModalAcc.customer_name} • Phone: {sessionModalAcc.login_id}
                </p>
              </div>
              <button
                onClick={() => setSessionModalAcc(null)}
                className="text-muted hover:text-text p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            {/* Top Summary Cards */}
            <div className="grid grid-cols-3 gap-3 shrink-0">
              <div className="p-3 bg-bg rounded-xl border border-border">
                <span className="text-[10px] uppercase font-bold text-muted block tracking-wider">Total Logins</span>
                <span className="text-lg font-black text-text block mt-0.5">
                  {sessionStats?.totalLogins ?? sessionModalAcc.total_login_count ?? 0}
                </span>
              </div>
              <div className="p-3 bg-bg rounded-xl border border-border">
                <span className="text-[10px] uppercase font-bold text-muted block tracking-wider">Total Time Spent</span>
                <span className="text-lg font-black text-primary block mt-0.5">
                  {formatDuration(sessionStats?.totalTimeSpentSeconds ?? sessionModalAcc.total_time_spent_seconds)}
                </span>
              </div>
              <div className="p-3 bg-bg rounded-xl border border-border">
                <span className="text-[10px] uppercase font-bold text-muted block tracking-wider">Active Sessions</span>
                <span className="text-lg font-black text-emerald-500 block mt-0.5">
                  {sessionStats?.activeSessionsCount ?? 0}
                </span>
              </div>
            </div>

            {/* Sessions Table */}
            <div className="flex-1 overflow-y-auto border border-border rounded-xl bg-bg">
              {loadingSessions ? (
                <div className="py-12 text-center text-muted text-xs">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                  <span>Loading session history...</span>
                </div>
              ) : sessionLogs.length === 0 ? (
                <div className="py-12 text-center text-muted text-xs">
                  No recorded sessions found for this customer.
                </div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 bg-bg2 border-b border-border text-muted font-bold text-[10px] uppercase">
                    <tr>
                      <th className="py-2.5 px-3">Session Start</th>
                      <th className="py-2.5 px-3">Last Active / Logout</th>
                      <th className="py-2.5 px-3">Duration</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Channel</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {sessionLogs.map((s: any) => (
                      <tr key={s.id} className="hover:bg-bg2/50 transition-colors">
                        <td className="py-2 px-3 text-text font-mono text-[11px]">
                          {s.logged_in_at ? new Date(s.logged_in_at).toLocaleString() : '—'}
                        </td>
                        <td className="py-2 px-3 text-muted text-[11px]">
                          {s.logged_out_at ? (
                            <span>Logged out {new Date(s.logged_out_at).toLocaleTimeString()}</span>
                          ) : s.last_active_at ? (
                            <span>Active {new Date(s.last_active_at).toLocaleTimeString()}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2 px-3 font-semibold text-text">
                          {formatDuration(s.duration_seconds)}
                        </td>
                        <td className="py-2 px-3">
                          {s.is_active === 1 ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-bg2 text-muted border border-border">
                              Closed
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 uppercase text-[10px] font-bold text-muted">
                          {s.channel || 'portal'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-border shrink-0">
              <button
                type="button"
                onClick={() => setSessionModalAcc(null)}
                className="px-4 py-2 bg-bg border border-border rounded-xl text-xs font-semibold text-text hover:bg-bg3 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
