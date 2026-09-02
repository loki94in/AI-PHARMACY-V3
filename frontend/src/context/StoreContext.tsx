import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export interface Store {
  id: number;
  name: string;
  code?: string;
  address?: string;
  phone?: string;
  email?: string;
  is_central: number;
  is_active: number;
}

interface StoreContextType {
  stores: Store[];
  activeStore: Store | null;
  activeStoreId: number;
  setActiveStoreId: (id: number) => void;
  isLoading: boolean;
  refetchStores: () => Promise<void>;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [stores, setStores] = useState<Store[]>([]);
  const [activeStoreId, setActiveStoreIdState] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('active_store_id');
      return saved ? parseInt(saved, 10) || 1 : 1;
    } catch {
      return 1;
    }
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchStores = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/stores');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setStores(data);
          const exists = data.some((s: Store) => s.id === activeStoreId);
          if (!exists) {
            setActiveStoreIdState(data[0].id);
            localStorage.setItem('active_store_id', String(data[0].id));
          }
        }
      }
    } catch (err) {
      console.warn('[StoreContext] Failed to load stores:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeStoreId]);

  useEffect(() => {
    fetchStores();
  }, [fetchStores]);

  const setActiveStoreId = (id: number) => {
    setActiveStoreIdState(id);
    try {
      localStorage.setItem('active_store_id', String(id));
    } catch (_) {}
  };

  const activeStore = stores.find(s => s.id === activeStoreId) || stores[0] || null;

  return (
    <StoreContext.Provider
      value={{
        stores,
        activeStore,
        activeStoreId,
        setActiveStoreId,
        isLoading,
        refetchStores: fetchStores
      }}
    >
      {children}
    </StoreContext.Provider>
  );
};

export const useStore = (): StoreContextType => {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error('useStore must be used within a StoreProvider');
  }
  return context;
};
