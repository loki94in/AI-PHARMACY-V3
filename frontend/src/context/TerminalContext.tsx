import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type UserMode = 'cashier' | 'admin';

interface TerminalContextType {
  terminalId: string;
  terminalName: string;
  setTerminalName: (name: string) => void;
  userMode: UserMode;
  setUserMode: (mode: UserMode) => void;
  verifyAdminPin: (pin: string) => boolean;
  setAdminPin: (newPin: string) => void;
  isHostOnline: boolean;
  checkHostHealth: () => Promise<boolean>;
}

const TerminalContext = createContext<TerminalContextType | undefined>(undefined);

const DEFAULT_PIN = '1234';

function getOrGenerateTerminalId(): string {
  try {
    const existing = localStorage.getItem('pos_terminal_id');
    if (existing && existing.trim()) return existing.trim();
    const newId = 'term_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
    localStorage.setItem('pos_terminal_id', newId);
    return newId;
  } catch {
    return 'term_default_' + Math.random().toString(36).substring(2, 7);
  }
}

export const TerminalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [terminalId] = useState<string>(getOrGenerateTerminalId);
  const [terminalName, setTerminalNameState] = useState<string>(() => {
    try {
      return localStorage.getItem('pos_terminal_name') || 'Counter 1';
    } catch {
      return 'Counter 1';
    }
  });

  const [userMode, setUserModeState] = useState<UserMode>(() => {
    try {
      const saved = localStorage.getItem('app_user_mode');
      return saved === 'cashier' ? 'cashier' : 'admin';
    } catch {
      return 'admin';
    }
  });

  const [adminPin, setAdminPinState] = useState<string>(() => {
    try {
      return localStorage.getItem('app_admin_pin') || DEFAULT_PIN;
    } catch {
      return DEFAULT_PIN;
    }
  });

  const [isHostOnline, setIsHostOnline] = useState<boolean>(true);

  const setTerminalName = useCallback((name: string) => {
    const clean = name.trim() || 'Counter 1';
    setTerminalNameState(clean);
    try {
      localStorage.setItem('pos_terminal_name', clean);
    } catch {}
  }, []);

  const setUserMode = useCallback((mode: UserMode) => {
    setUserModeState(mode);
    try {
      localStorage.setItem('app_user_mode', mode);
    } catch {}
  }, []);

  const setAdminPin = useCallback((newPin: string) => {
    const clean = newPin.trim() || DEFAULT_PIN;
    setAdminPinState(clean);
    try {
      localStorage.setItem('app_admin_pin', clean);
    } catch {}
  }, []);

  const verifyAdminPin = useCallback((pin: string): boolean => {
    return pin.trim() === adminPin.trim();
  }, [adminPin]);

  const checkHostHealth = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/network/ping', { cache: 'no-store' });
      const online = res.ok;
      setIsHostOnline(online);
      return online;
    } catch {
      setIsHostOnline(false);
      return false;
    }
  }, []);

  // Event-driven host connectivity monitoring (online/offline/visibility) without polling timers
  useEffect(() => {
    const handleOnline = () => {
      checkHostHealth();
    };
    const handleOffline = () => {
      setIsHostOnline(false);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkHostHealth();
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Initial check on mount
    checkHostHealth();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [checkHostHealth]);

  return (
    <TerminalContext.Provider
      value={{
        terminalId,
        terminalName,
        setTerminalName,
        userMode,
        setUserMode,
        verifyAdminPin,
        setAdminPin,
        isHostOnline,
        checkHostHealth,
      }}
    >
      {children}
    </TerminalContext.Provider>
  );
};

export function useTerminal() {
  const context = useContext(TerminalContext);
  if (!context) {
    throw new Error('useTerminal must be used within a TerminalProvider');
  }
  return context;
}
