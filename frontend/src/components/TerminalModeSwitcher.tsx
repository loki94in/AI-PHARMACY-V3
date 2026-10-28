import React, { useState } from 'react';
import { useTerminal } from '../context/TerminalContext';
import { Monitor, Lock, Unlock, Check, X, ShieldAlert, Wifi, WifiOff } from 'lucide-react';

export const TerminalModeSwitcher: React.FC = () => {
  const {
    terminalName,
    setTerminalName,
    userMode,
    setUserMode,
    verifyAdminPin,
    isHostOnline,
  } = useTerminal();

  const [isOpen, setIsOpen] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(terminalName);

  const handleOpen = () => {
    setPinInput('');
    setPinError(false);
    setIsEditingName(false);
    setNameInput(terminalName);
    setIsOpen(true);
  };

  const handleUnlockAdmin = (e: React.FormEvent) => {
    e.preventDefault();
    if (verifyAdminPin(pinInput)) {
      setUserMode('admin');
      setIsOpen(false);
      setPinInput('');
      setPinError(false);
    } else {
      setPinError(true);
    }
  };

  const handleLockCashier = () => {
    setUserMode('cashier');
    setIsOpen(false);
  };

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    if (nameInput.trim()) {
      setTerminalName(nameInput.trim());
      setIsEditingName(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={`
          flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border transition-all text-xs font-bold cursor-pointer shrink-0
          ${userMode === 'cashier'
            ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20'
            : 'bg-primary/10 border-primary/25 text-primary hover:bg-primary/20'}
        `}
        title={`Terminal: ${terminalName} (${userMode === 'cashier' ? 'Cashier Mode' : 'Admin Mode'})`}
      >
        <Monitor size={14} className="shrink-0" />
        <span className="truncate max-w-[85px] sm:max-w-[110px]">{terminalName}</span>
        {userMode === 'cashier' ? (
          <span className="flex items-center gap-1 text-[10px] font-black uppercase text-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 rounded-md">
            <Lock size={10} />
            <span>Cashier</span>
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[10px] font-black uppercase text-primary bg-primary/15 px-1.5 py-0.5 rounded-md">
            <Unlock size={10} />
            <span>Admin</span>
          </span>
        )}
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${isHostOnline ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`}
          title={isHostOnline ? 'Connected to Host' : 'Host Disconnected'}
        />
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/60 animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsOpen(false);
          }}
        >
          <div className="bg-bg2 border border-border w-full max-w-sm rounded-3xl p-5 shadow-2xl flex flex-col gap-4 text-text animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-primary/15 text-primary">
                  <Monitor size={18} />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm tracking-tight text-text">Terminal Configuration</h3>
                  <p className="text-[11px] text-muted font-medium">Manage counter &amp; security mode</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-xl text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Host Status & Terminal Name */}
            <div className="p-3 rounded-2xl bg-bg3 border border-border flex flex-col gap-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted font-semibold">Host Connection:</span>
                <span className={`inline-flex items-center gap-1.5 font-bold ${isHostOnline ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {isHostOnline ? <Wifi size={13} /> : <WifiOff size={13} />}
                  <span>{isHostOnline ? 'Online (LAN)' : 'Disconnected'}</span>
                </span>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-border/50">
                <span className="text-muted font-semibold">Terminal Name:</span>
                {isEditingName ? (
                  <form onSubmit={handleSaveName} className="flex items-center gap-1">
                    <input
                      type="text"
                      value={nameInput}
                      onChange={e => setNameInput(e.target.value)}
                      className="bg-bg border border-primary px-2 py-0.5 rounded-lg text-xs text-text w-28 focus:outline-none"
                      autoFocus
                    />
                    <button
                      type="submit"
                      className="p-1 bg-primary text-white rounded-lg hover:opacity-90"
                      title="Save name"
                    >
                      <Check size={12} />
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-text">{terminalName}</span>
                    <button
                      type="button"
                      onClick={() => setIsEditingName(true)}
                      className="text-[10px] text-primary hover:underline cursor-pointer"
                    >
                      Edit
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Role Switcher */}
            {userMode === 'cashier' ? (
              <form onSubmit={handleUnlockAdmin} className="flex flex-col gap-3">
                <div className="flex items-start gap-2 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs">
                  <ShieldAlert size={16} className="text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-muted leading-relaxed text-[11px]">
                    This terminal is currently in <strong className="text-text">Cashier Mode</strong>. Enter the 4-digit Admin PIN to unlock full management access (Purchases, Reports, Settings).
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-text">Admin PIN (Default: 1234)</label>
                  <input
                    type="password"
                    maxLength={8}
                    value={pinInput}
                    onChange={e => {
                      setPinInput(e.target.value);
                      setPinError(false);
                    }}
                    placeholder="Enter PIN"
                    className="w-full bg-bg border border-border focus:border-primary px-3 py-2 rounded-xl text-sm tracking-widest text-text text-center font-mono focus:outline-none"
                    autoFocus
                  />
                  {pinError && (
                    <span className="text-[11px] font-bold text-rose-400 text-center">
                      Incorrect PIN. Try again.
                    </span>
                  )}
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl font-extrabold text-xs bg-primary text-white hover:opacity-90 shadow-md transition-all cursor-pointer active:scale-98"
                >
                  Unlock Admin Access
                </button>
              </form>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="p-3 rounded-2xl bg-primary/10 border border-primary/20 text-xs flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 font-bold text-primary">
                    <Unlock size={14} />
                    <span>Admin Mode Active</span>
                  </div>
                  <p className="text-[11px] text-muted">
                    All pages, financial reports, and settings are currently visible on this PC. Switch to Cashier Mode before handing this terminal to billing staff.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleLockCashier}
                  className="w-full py-2.5 rounded-xl font-extrabold text-xs bg-emerald-600 text-white hover:bg-emerald-700 shadow-md transition-all cursor-pointer active:scale-98 flex items-center justify-center gap-2"
                >
                  <Lock size={13} />
                  <span>Switch to Cashier Mode</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
