import React, { useState, useEffect, useCallback } from 'react';
import { useTerminal } from '../../context/TerminalContext';
import { toastEvent } from '../../services/events';
import {
  Monitor,
  Wifi,
  WifiOff,
  Copy,
  Check,
  RefreshCw,
  Lock,
  Unlock,
  Shield,
  Laptop,
  Layers,
  ArrowRight,
  Info,
  Server
} from 'lucide-react';

interface HostInfo {
  hostname: string;
  primaryIp: string;
  availableIps: string[];
  apiPort: number;
  webPort: number;
  lanUrls: Array<{ ip: string; clientUrl: string; apiUrl: string }>;
  pairingUrl: string;
  status: string;
  system: {
    platform: string;
    arch: string;
    uptimeSec: number;
  };
}

export function NetworkTerminalsTab() {
  const {
    terminalId,
    terminalName,
    setTerminalName,
    userMode,
    setUserMode,
    isHostOnline,
    checkHostHealth,
    setAdminPin,
    verifyAdminPin
  } = useTerminal();

  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);
  const [loadingHost, setLoadingHost] = useState(true);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState(terminalName);
  const [isEditingName, setIsEditingName] = useState(false);

  // PIN management state
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [isChangingPin, setIsChangingPin] = useState(false);

  // Live cart reservations
  const [reservations, setReservations] = useState<Record<number, any[]>>({});
  const [loadingReservations, setLoadingReservations] = useState(false);

  const fetchHostInfo = useCallback(async () => {
    try {
      setLoadingHost(true);
      const res = await fetch('/api/network/host-info');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setHostInfo(data);
        }
      }
    } catch (err: any) {
      console.warn('[NetworkTerminalsTab] Failed to fetch host info:', err);
    } finally {
      setLoadingHost(false);
    }
  }, []);

  const fetchReservations = useCallback(async () => {
    try {
      setLoadingReservations(true);
      const res = await fetch('/api/sales/cart-reservations');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.reservations) {
          setReservations(data.reservations);
        }
      }
    } catch {} finally {
      setLoadingReservations(false);
    }
  }, []);

  useEffect(() => {
    fetchHostInfo();
    fetchReservations();
  }, [fetchHostInfo, fetchReservations]);

  const handleCopy = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    toastEvent.trigger('LAN connection URL copied to clipboard!', 'success');
    setTimeout(() => setCopiedUrl(null), 2500);
  };

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    if (nameInput.trim()) {
      setTerminalName(nameInput.trim());
      setIsEditingName(false);
      toastEvent.trigger(`Terminal name updated to "${nameInput.trim()}"`, 'success');
    }
  };

  const handleChangePin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyAdminPin(currentPin)) {
      toastEvent.trigger('Incorrect current Admin PIN', 'error');
      return;
    }
    if (newPin.trim().length < 4) {
      toastEvent.trigger('New PIN must be at least 4 digits', 'error');
      return;
    }
    setAdminPin(newPin.trim());
    setCurrentPin('');
    setNewPin('');
    setIsChangingPin(false);
    toastEvent.trigger('Admin PIN updated successfully', 'success');
  };

  const activeReservationCount = Object.keys(reservations).length;

  return (
    <div className="space-y-6">
      {/* SECTION 1: PRIMARY HOST SERVER STATUS */}
      <div className="p-5 rounded-3xl bg-bg2 border border-border shadow-xs flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-primary/10 text-primary border border-primary/20">
              <Server size={22} />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-text tracking-tight flex items-center gap-2">
                <span>Primary Pharmacy Host Server</span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${isHostOnline ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                  {isHostOnline ? <Wifi size={11} /> : <WifiOff size={11} />}
                  <span>{isHostOnline ? 'Active Host' : 'Offline'}</span>
                </span>
              </h2>
              <p className="text-xs text-muted">
                Central database &amp; background workers controller for all billing counters on this LAN
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              fetchHostInfo();
              checkHostHealth();
            }}
            disabled={loadingHost}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-bg text-text text-xs font-bold hover:bg-bg3 transition-all cursor-pointer active:scale-95 disabled:opacity-50 self-start sm:self-auto"
          >
            <RefreshCw size={13} className={loadingHost ? 'animate-spin' : ''} />
            <span>Refresh Status</span>
          </button>
        </div>

        {hostInfo ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Box 1: Primary LAN URL */}
            <div className="p-4 rounded-2xl bg-bg border border-border flex flex-col justify-between gap-2">
              <span className="text-[11px] font-bold text-muted uppercase tracking-wider">Local Network (LAN) URL</span>
              <div className="font-mono text-sm font-extrabold text-primary truncate">
                {hostInfo.pairingUrl}
              </div>
              <button
                type="button"
                onClick={() => handleCopy(hostInfo.pairingUrl)}
                className="mt-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-white text-xs font-bold hover:opacity-90 transition-all cursor-pointer shadow-xs active:scale-95"
              >
                {copiedUrl === hostInfo.pairingUrl ? <Check size={13} /> : <Copy size={13} />}
                <span>{copiedUrl === hostInfo.pairingUrl ? 'Copied' : 'Copy LAN URL'}</span>
              </button>
            </div>

            {/* Box 2: Host Identity */}
            <div className="p-4 rounded-2xl bg-bg border border-border flex flex-col justify-between gap-1 text-xs">
              <span className="text-[11px] font-bold text-muted uppercase tracking-wider">Host Machine Details</span>
              <div className="flex items-center justify-between">
                <span className="text-muted">Hostname:</span>
                <span className="font-mono font-bold text-text">{hostInfo.hostname}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Primary IP:</span>
                <span className="font-mono font-bold text-text">{hostInfo.primaryIp}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">HTTP Port:</span>
                <span className="font-mono font-bold text-text">{hostInfo.webPort}</span>
              </div>
            </div>

            {/* Box 3: Connection Guide */}
            <div className="p-4 rounded-2xl bg-bg border border-border flex flex-col justify-between gap-1 text-xs">
              <span className="text-[11px] font-bold text-muted uppercase tracking-wider">Connect Other Computers</span>
              <p className="text-[11px] text-muted leading-relaxed">
                Open Google Chrome or Edge on any other PC or tablet on the same Wi-Fi/LAN and enter:
              </p>
              <div className="p-2 rounded-xl bg-bg3 border border-border font-mono text-[11px] font-bold text-text select-all truncate text-center">
                {hostInfo.pairingUrl}
              </div>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center text-xs text-muted">
            {loadingHost ? 'Detecting network configuration...' : 'Unable to read network host configuration.'}
          </div>
        )}
      </div>

      {/* SECTION 2: THIS TERMINAL'S CONFIGURATION */}
      <div className="p-5 rounded-3xl bg-bg2 border border-border shadow-xs flex flex-col gap-4">
        <div className="flex items-center gap-3 pb-3 border-b border-border">
          <div className="p-2.5 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Monitor size={22} />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-text tracking-tight">This PC’s Terminal Profile</h2>
            <p className="text-xs text-muted">Configure this specific counter’s identity, bill prefix, and cashier lock</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Left: Terminal Name & Counter Identity */}
          <div className="p-4 rounded-2xl bg-bg border border-border flex flex-col gap-3">
            <span className="text-xs font-bold text-text">Counter / Station Designation</span>
            <p className="text-[11px] text-muted">
              Identifies which counter generated each bill in the sales history and ledger (e.g. Counter 1, Counter 2, Delivery Counter).
            </p>

            {isEditingName ? (
              <form onSubmit={handleSaveName} className="flex items-center gap-2">
                <input
                  type="text"
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  className="flex-1 bg-bg2 border border-primary px-3 py-2 rounded-xl text-xs text-text focus:outline-none"
                  autoFocus
                />
                <button
                  type="submit"
                  className="px-3.5 py-2 bg-primary text-white text-xs font-bold rounded-xl hover:opacity-90 cursor-pointer"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingName(false)}
                  className="px-3 py-2 bg-bg3 text-muted text-xs font-bold rounded-xl hover:text-text cursor-pointer"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <div className="flex items-center justify-between p-3 rounded-xl bg-bg2 border border-border">
                <div className="flex items-center gap-2">
                  <Laptop size={16} className="text-primary" />
                  <span className="font-extrabold text-sm text-text">{terminalName}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNameInput(terminalName);
                    setIsEditingName(true);
                  }}
                  className="px-3 py-1 bg-primary/10 text-primary border border-primary/20 rounded-lg text-xs font-bold hover:bg-primary/20 cursor-pointer"
                >
                  Edit Name
                </button>
              </div>
            )}

            <div className="text-[11px] text-muted font-mono">
              Terminal Identifier: <span className="text-text font-bold">{terminalId}</span>
            </div>
          </div>

          {/* Right: Security Role & Admin PIN */}
          <div className="p-4 rounded-2xl bg-bg border border-border flex flex-col justify-between gap-3">
            <div>
              <span className="text-xs font-bold text-text">Security Role &amp; Cashier Lock</span>
              <p className="text-[11px] text-muted mt-1">
                In Cashier Mode, this terminal can only perform POS sales, customer lookups, and returns. Wholesale purchases, supplier margins, and financial reports are hidden.
              </p>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-bg2 border border-border">
              <div className="flex items-center gap-2">
                {userMode === 'cashier' ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-black uppercase">
                    <Lock size={12} />
                    <span>Cashier Mode</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/15 border border-primary/30 text-primary text-xs font-black uppercase">
                    <Unlock size={12} />
                    <span>Admin Mode</span>
                  </span>
                )}
              </div>

              {userMode === 'cashier' ? (
                <button
                  type="button"
                  onClick={() => setUserMode('admin')}
                  className="px-3 py-1 bg-primary text-white rounded-lg text-xs font-bold hover:opacity-90 cursor-pointer shadow-xs"
                >
                  Switch to Admin
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setUserMode('cashier')}
                  className="px-3 py-1 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 cursor-pointer shadow-xs"
                >
                  Lock into Cashier Mode
                </button>
              )}
            </div>

            {/* Change Admin PIN Accordion */}
            {isChangingPin ? (
              <form onSubmit={handleChangePin} className="flex flex-col gap-2 p-3 rounded-xl bg-bg2 border border-border">
                <span className="text-xs font-bold text-text">Update 4-Digit Admin PIN</span>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    maxLength={8}
                    value={currentPin}
                    onChange={e => setCurrentPin(e.target.value)}
                    placeholder="Current PIN"
                    className="w-1/2 bg-bg border border-border px-2.5 py-1.5 rounded-lg text-xs text-text focus:outline-none"
                    autoFocus
                  />
                  <input
                    type="password"
                    maxLength={8}
                    value={newPin}
                    onChange={e => setNewPin(e.target.value)}
                    placeholder="New PIN (min 4)"
                    className="w-1/2 bg-bg border border-border px-2.5 py-1.5 rounded-lg text-xs text-text focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <button
                    type="submit"
                    className="px-3 py-1 bg-primary text-white text-xs font-bold rounded-lg hover:opacity-90 cursor-pointer"
                  >
                    Save New PIN
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsChangingPin(false)}
                    className="px-3 py-1 bg-bg3 text-muted text-xs font-bold rounded-lg hover:text-text cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setIsChangingPin(true)}
                className="text-[11px] text-primary hover:underline self-start cursor-pointer font-bold"
              >
                Change Admin PIN (Default: 1234)
              </button>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 3: LIVE MULTI-COUNTER CART SOFT-RESERVATIONS */}
      <div className="p-5 rounded-3xl bg-bg2 border border-border shadow-xs flex flex-col gap-4">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Layers size={22} />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-text tracking-tight flex items-center gap-2">
                <span>Active Multi-Terminal Cart Reservations</span>
                <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[10px] font-black uppercase">
                  {activeReservationCount} Reserved Items
                </span>
              </h2>
              <p className="text-xs text-muted">
                Items currently held in other counters’ active checkout carts (auto-expires in 5 minutes)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={fetchReservations}
            disabled={loadingReservations}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-bg text-text text-xs font-bold hover:bg-bg3 transition-all cursor-pointer active:scale-95 disabled:opacity-50"
          >
            <RefreshCw size={13} className={loadingReservations ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>

        {activeReservationCount === 0 ? (
          <div className="py-8 text-center text-xs text-muted flex flex-col items-center gap-2">
            <Check size={24} className="text-emerald-400" />
            <span>No active item collisions across terminals. All stock is freely available for billing.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {Object.entries(reservations).map(([invId, resList]) => (
              <div key={invId} className="flex items-center justify-between p-3 rounded-2xl bg-bg border border-border text-xs">
                <div className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span className="font-extrabold text-text">
                    {resList[0]?.medicineName || `Inventory #${invId}`}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {resList.map((res, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded-lg bg-bg3 border border-border text-[11px] font-bold text-muted"
                    >
                      {res.terminalName}: <strong className="text-text">{res.quantity} qty</strong>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
