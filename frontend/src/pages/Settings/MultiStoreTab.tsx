import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient, api } from '../../services/api';
import { toastEvent } from '../../services/events';
import { sanitizePhoneInput, isValid10DigitPhone } from '../../utils/phone';
import type { LocalApiError, StorageLocation, RegisteredDevice } from './settingsTypes';
import { Building2, Save, RefreshCw, X, MapPin, Plus, CheckCircle2, MessageCircle, Mail, Store as StoreIcon, GitBranch, ArrowDownToLine, ArrowUpFromLine, Phone } from 'lucide-react';

export function MultiStoreTab() {
  const [stores, setStores] = useState<Array<{ id: number; name: string; code?: string; address?: string; phone?: string; email?: string; is_central: number; is_active: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<{ store_id: number; pending_count: number; synced_count: number; conflict_count: number; last_synced_at: string | null } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newStore, setNewStore] = useState({
    name: '',
    code: '',
    address: '',
    phone: '',
    email: '',
    is_central: false
  });

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [storesData, syncData] = await Promise.all([
        api.getStores(true),
        api.getSyncStatus().catch(() => null)
      ]);
      setStores(storesData || []);
      setSyncStatus(syncData);
    } catch (err) {
      console.warn('[MultiStoreTab] Failed to load store data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStore.name.trim()) {
      toastEvent.trigger('Store name is required', 'error');
      return;
    }
    const cleanPh = sanitizePhoneInput(newStore.phone);
    if (cleanPh && !isValid10DigitPhone(cleanPh)) {
      toastEvent.trigger('Please enter a valid 10-digit phone number (starts with 6, 7, 8, or 9)', 'error');
      return;
    }
    try {
      await api.createStore({ ...newStore, phone: cleanPh });
      toastEvent.trigger(`Store "${newStore.name}" created successfully`, 'success');
      setShowAddModal(false);
      setNewStore({ name: '', code: '', address: '', phone: '', email: '', is_central: false });
      loadData();
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || err.message || 'Failed to create store', 'error');
    }
  };

  const handlePushSync = async () => {
    try {
      setSyncing(true);
      const res = await api.pushSync(100);
      toastEvent.trigger(`Sync Push completed: ${res.pushedCount} item(s) synchronized`, 'success');
      loadData();
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || err.message || 'Push sync failed', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handlePullSync = async () => {
    try {
      setSyncing(true);
      const res = await api.pullSync([]);
      toastEvent.trigger(`Sync Pull completed: ${res.appliedCount} applied, ${res.conflictsCount} conflict(s)`, 'success');
      loadData();
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || err.message || 'Pull sync failed', 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Add Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h3 className="text-base font-bold text-text flex items-center gap-2">
            <StoreIcon size={18} className="text-primary" />
            <span>Store Network & Branches</span>
          </h3>
          <p className="text-xs text-muted mt-0.5">Manage local pharmacy branches, central warehouse identity, and offline data sync.</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-3 py-1.5 bg-primary text-white text-xs font-bold rounded-xl shadow-sm hover:bg-primary/90 transition-all flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
        >
          <Plus size={14} />
          <span>Add New Branch</span>
        </button>
      </div>

      {/* Store Directory Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {stores.map((s) => (
          <div key={s.id} className="p-4 rounded-2xl bg-bg2 border border-border shadow-sm flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className={`p-2 rounded-xl border ${s.is_central ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' : 'bg-primary/10 text-primary border-primary/20'}`}>
                    {s.is_central ? <Building2 size={16} /> : <GitBranch size={16} />}
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-text">{s.name}</h4>
                    <span className="font-mono text-[11px] text-muted">{s.code || `STORE-${s.id}`}</span>
                  </div>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${s.is_central ? 'bg-amber-500/10 text-amber-500 border-amber-500/30' : 'bg-blue-500/10 text-blue-500 border-blue-500/30'}`}>
                  {s.is_central ? 'Central' : 'Branch'}
                </span>
              </div>

              <div className="text-xs text-muted space-y-1 mt-3">
                {s.address && <p className="truncate flex items-center gap-1.5"><MapPin size={12} className="text-muted shrink-0" /> {s.address}</p>}
                {s.phone && <p className="truncate flex items-center gap-1.5"><MessageCircle size={12} className="text-muted shrink-0" /> {s.phone}</p>}
                {s.email && <p className="truncate flex items-center gap-1.5"><Mail size={12} className="text-muted shrink-0" /> {s.email}</p>}
              </div>
            </div>

            <div className="pt-2 border-t border-border/50 flex items-center justify-between text-[11px]">
              <span className="text-emerald-500 font-medium flex items-center gap-1">
                <CheckCircle2 size={12} /> Active
              </span>
              <span className="text-muted font-mono">Store ID: #{s.id}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Central + Local Sync Card */}
      <div className="p-5 rounded-2xl bg-bg2 border border-border space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky border border-sky-500/20">
              <RefreshCw size={16} />
            </div>
            <div>
              <h4 className="text-sm font-bold text-text">Central & Local Synchronization Hub</h4>
              <p className="text-xs text-muted">Offline-first local changes queued in SQLite sync ledger, pushed to central server on connectivity.</p>
            </div>
          </div>
          <button
            onClick={loadData}
            disabled={loading}
            className="p-1.5 text-muted hover:text-text rounded-lg hover:bg-bg3 border border-border"
            title="Refresh Sync Status"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Sync Metrics Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-bg3/40 border border-border text-left">
            <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Pending Push</span>
            <div className="text-lg font-black text-amber-500 mt-0.5">{syncStatus?.pending_count ?? 0}</div>
          </div>
          <div className="p-3 rounded-xl bg-bg3/40 border border-border text-left">
            <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Synced Records</span>
            <div className="text-lg font-black text-emerald-500 mt-0.5">{syncStatus?.synced_count ?? 0}</div>
          </div>
          <div className="p-3 rounded-xl bg-bg3/40 border border-border text-left">
            <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Conflicts</span>
            <div className="text-lg font-black text-rose-500 mt-0.5">{syncStatus?.conflict_count ?? 0}</div>
          </div>
          <div className="p-3 rounded-xl bg-bg3/40 border border-border text-left">
            <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Last Synced</span>
            <div className="text-xs font-semibold text-text truncate mt-1">
              {syncStatus?.last_synced_at ? new Date(syncStatus.last_synced_at).toLocaleTimeString() : 'Never'}
            </div>
          </div>
        </div>

        {/* Sync Actions */}
        <div className="flex flex-wrap gap-2.5 pt-2">
          <button
            onClick={handlePushSync}
            disabled={syncing}
            className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <ArrowUpFromLine size={14} />
            <span>Push Local Changes to Central</span>
          </button>
          <button
            onClick={handlePullSync}
            disabled={syncing}
            className="px-4 py-2 rounded-xl bg-bg3 hover:bg-bg3/80 text-text border border-border text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <ArrowDownToLine size={14} />
            <span>Pull Central Catalog & Updates</span>
          </button>
        </div>
      </div>

      {/* Add Branch Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-global-modal flex items-center justify-center bg-black/60 p-4 text-left">
          <div className="bg-bg border border-border w-[95vw] max-w-md rounded-3xl p-6 space-y-4 text-left shadow-[0_4px_24px_rgba(0,0,0,0.12)]">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <StoreIcon size={18} className="text-primary" />
                <h3 className="font-bold text-sm text-text">Add Pharmacy Branch / Store</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-lg hover:bg-bg3 text-muted hover:text-text"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateStore} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-text">Store Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. City Care Pharmacy - Branch 2"
                  value={newStore.name}
                  onChange={(e) => setNewStore({ ...newStore, name: e.target.value })}
                  className="w-full mt-1 px-3 py-2 text-xs bg-bg2 border border-border rounded-xl text-text focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-text">Store Code</label>
                <input
                  type="text"
                  placeholder="e.g. STORE-B"
                  value={newStore.code}
                  onChange={(e) => setNewStore({ ...newStore, code: e.target.value })}
                  className="w-full mt-1 px-3 py-2 text-xs bg-bg2 border border-border rounded-xl text-text focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-text">Address</label>
                <input
                  type="text"
                  placeholder="e.g. 45 Park Avenue, Mumbai"
                  value={newStore.address}
                  onChange={(e) => setNewStore({ ...newStore, address: e.target.value })}
                  className="w-full mt-1 px-3 py-2 text-xs bg-bg2 border border-border rounded-xl text-text focus:outline-none focus:border-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-bold text-text">Phone / WhatsApp</label>
                  <input
                    type="text"
                    maxLength={10}
                    placeholder="9876543210"
                    value={newStore.phone}
                    onChange={(e) => setNewStore({ ...newStore, phone: sanitizePhoneInput(e.target.value) })}
                    className="w-full mt-1 px-3 py-2 text-xs bg-bg2 border border-border rounded-xl text-text focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-text">Email</label>
                  <input
                    type="email"
                    placeholder="branch@pharmacy.com"
                    value={newStore.email}
                    onChange={(e) => setNewStore({ ...newStore, email: e.target.value })}
                    className="w-full mt-1 px-3 py-2 text-xs bg-bg2 border border-border rounded-xl text-text focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl bg-bg3 text-muted hover:text-text text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-primary text-white text-xs font-bold shadow-md hover:bg-primary/90"
                >
                  Save Store
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// SUB-TAB: ORDERS & FULFILMENT TIMING
// ==========================================

interface PharmacyHolidayItem {
  id: number;
  store_id: number;
  holiday_date: string;
  holiday_name: string;
  is_closed: number;
  custom_window_start: string | null;
  custom_window_end: string | null;
  created_at: string;
}

