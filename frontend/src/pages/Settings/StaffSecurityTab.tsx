import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient, api } from '../../services/api';
import { useApiQuery } from '../../hooks/useApiQuery';
import { toastEvent } from '../../services/events';
import type { LocalApiError, StorageLocation, RegisteredDevice } from './settingsTypes';
import { Save, RefreshCw, RotateCcw, Shield, Smartphone } from 'lucide-react';

export function StaffSecurityTab({ rawSettings, refetchSettings }: { rawSettings: Record<string, string>; refetchSettings: () => void }) {
  const [adminUsername, setAdminUsername] = useState(rawSettings.admin_username || 'admin');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [adminRemoteMode, setAdminRemoteMode] = useState(rawSettings.admin_remote_mode !== 'false');
  const [saving, setSaving] = useState(false);

  const { data: devicesList = [] } = useApiQuery<RegisteredDevice[]>(
    'registered-devices',
    () => apiClient.get('/settings/registered-devices').then((res) => res.data.devices || []),
    { staleTime: 15000 }
  );

  const handleResetSecurity = () => {
    setAdminUsername(rawSettings.admin_username || 'admin');
    setNewAdminPassword('');
    setAdminRemoteMode(rawSettings.admin_remote_mode !== 'false');
    toastEvent.trigger('Security form reset to saved parameters', 'info');
  };

  const [confirmResetDevice, setConfirmResetDevice] = useState(false);

  const handleResetDeviceAuthorization = async () => {
    if (!confirmResetDevice) {
      setConfirmResetDevice(true);
      setTimeout(() => setConfirmResetDevice(false), 5000);
      toastEvent.trigger('Click again within 5s to confirm remote device authorization reset', 'info');
      return;
    }
    setConfirmResetDevice(false);
    try {
      await apiClient.post('/security/admin/reset-device');
      toastEvent.trigger('Admin device authorization reset successfully', 'success');
      refetchSettings();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to reset device authorization: ' + (e.message || 'Unknown error'), 'error');
    }
  };

  const handleSaveSecurity = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, string> = {
        admin_username: adminUsername,
        admin_remote_mode: adminRemoteMode ? 'true' : 'false',
      };
      if (newAdminPassword.trim()) {
        payload.admin_password = newAdminPassword.trim();
      }

      await apiClient.post('/settings/save', payload);
      toastEvent.trigger('Security parameters updated successfully', 'success');
      setNewAdminPassword('');
      refetchSettings();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to save security settings: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSaveSecurity} className="space-y-6">
        <div className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2 border-b border-border pb-2">
            <Shield size={16} /> Store Administration & Credentials
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text mb-1">Admin Account Username</label>
              <input
                type="text"
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">Change Admin Password (leave blank to keep existing)</label>
              <input
                type="password"
                placeholder="Enter new strong password"
                value={newAdminPassword}
                onChange={(e) => setNewAdminPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <input
              type="checkbox"
              id="adminRemote"
              checked={adminRemoteMode}
              onChange={(e) => setAdminRemoteMode(e.target.checked)}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
            />
            <label htmlFor="adminRemote" className="text-xs font-semibold text-text cursor-pointer">
              Enable Remote Administrative Master Control Access
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleResetSecurity}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 bg-bg3 border border-border text-muted hover:text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer"
          >
            <RotateCcw size={14} />
            <span>Reset Form</span>
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            <span>Update Security Credentials</span>
          </button>
        </div>
      </form>

      {/* Registered Mobile & Desktop Devices */}
      <div className="space-y-4 pt-4 border-t border-border">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
            <Smartphone size={16} /> Authorized Registered Mobile & Desktop Terminals
          </h2>
          <button
            type="button"
            onClick={handleResetDeviceAuthorization}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 text-red-500 border border-red-500/30 font-bold text-xs rounded-xl hover:bg-red-500/20 transition-all cursor-pointer shrink-0"
          >
            <RotateCcw size={13} />
            <span>Reset Device Authorization</span>
          </button>
        </div>

        <div className="overflow-x-auto bg-bg3/20 border border-border rounded-xl">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="py-2.5 px-3">Device Name</th>
                <th className="py-2.5 px-3">OS Platform</th>
                <th className="py-2.5 px-3">Push Token</th>
                <th className="py-2.5 px-3">Last Active</th>
                <th className="py-2.5 px-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {devicesList.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-muted italic">No registered mobile device terminals found.</td>
                </tr>
              ) : (
                devicesList.map((dev) => (
                  <tr key={dev.token} className="hover:bg-bg3/50">
                    <td className="py-2.5 px-3 font-semibold text-text">{dev.device_name || 'Unnamed Terminal'}</td>
                    <td className="py-2.5 px-3 text-muted">{dev.os}</td>
                    <td className="py-2.5 px-3 font-mono text-[10px] text-muted truncate max-w-[150px]">{dev.token}</td>
                    <td className="py-2.5 px-3 text-muted">{new Date(dev.last_seen).toLocaleTimeString()}</td>
                    <td className="py-2.5 px-3 text-right">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        dev.is_online ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-muted/20 text-muted'
                      }`}>
                        {dev.is_online ? 'CONNECTED' : 'OFFLINE'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SUB-TAB 3: INTEGRATIONS & CREDENTIALS
// ==========================================

