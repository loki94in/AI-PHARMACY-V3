import React, { useState, useEffect, useCallback, useRef, lazy, Suspense, useMemo } from 'react';
import { useOnClickOutside } from '../../hooks/useOnClickOutside';
import { useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../../services/api';
import { toastEvent } from '../../services/events';
import { 
  RotateCcw, Plus, Trash2, Search, FileText, Camera, X, Loader2, Edit, Wand2, 
  Building2, Layers, CalendarDays, Users, History, ShieldAlert, CheckCircle2, Square, AlertTriangle, Calendar
} from 'lucide-react';
const AICamera = lazy(() => import('../../components/AICamera'));
import { useApiQuery } from '../../hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';
import Expiry from '../Expiry';
import { invalidateAfterStockWrite } from '../../utils/cacheInvalidation';
import { getTodayString, getNDaysAgoString, toDateInputValue } from '../../utils/date';
import CustomerReturn from '../CustomerReturn';
import CustomerReturnHistory from '../CustomerReturnHistory';
import ExpiryReturnReview from './ExpiryReturnReview';
import { rankAndSortMedicines } from '../../utils/searchRanker';
import { useInfiniteScroll, clearInfiniteScrollCache } from '../../hooks/useInfiniteScroll';
import { InfiniteScrollStatus } from '../../components/InfiniteScrollStatus';
import { usePersistedDateRange } from '../../hooks/usePersistedDateRange';

const generateUUID = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export interface ReturnItem {
  id: string;
  medicine_id: number | null;
  medicine_name: string;
  batch_no: string;
  expiry_date: string;
  quantity: number | string;
  cost_price: number | string;
  mrp: number | string;
  purchase_item_id?: number;
  invoice_no?: string;
  app_invoice_no?: string;
  purchase_date?: string;
  distributor_name?: string;
  distributor_id?: number;
  return_type?: 'good' | 'expiry';
  reason?: string;
}

export interface ExpiredReturnRow {
  inventory_id: number;
  medicine_id: number;
  medicine_name: string;
  batch_no: string;
  expiry_date: string;
  available_stock: number;
  quantity: number | string;
  cost_price: number | string;
  mrp: number | string;
  selected: boolean;
  invoice_no?: string;
  app_invoice_no?: string;
  purchase_date?: string;
}

export interface DistributorReturnBill {
  id: string;
  distributor_id: number | null;
  distributor_name: string;
  invoice_no?: string;
  date: string;
  loss_percentage: number;
  return_sub_type?: 'good' | 'expiry';
  reason?: string;
  expired_items: ExpiredReturnRow[];
  manual_items: ReturnItem[];
}

interface GroupedReturn {
  distributor_id: number;
  distributor_name: string;
  invoice_no: string;
  purchase_date: string;
  items: ReturnItem[];
  total_amount: number;
}

type LocalEditableReturnItem = ReturnItem & { _resolved_fields?: string[] };

type LocalHistoryReturnDetail = Omit<ReturnItem, 'quantity' | 'cost_price' | 'mrp'> & {
  quantity: number | string | null;
  cost_price: number | string | null;
  mrp: number | string | null;
};

interface LocalPurchaseLookupRow {
  medicine_id: number;
  medicine_name: string;
  batch_no: string | null;
  expiry_date: string | null;
  cost_price: number | null;
  mrp: number | null;
  purchase_item_id?: number | null;
  invoice_no: string | null;
  app_invoice_no?: string | null;
  purchase_date: string | null;
  distributor_name: string | null;
  distributor_id: number | null;
}

interface LocalReturnItemRow {
  id: number;
  medicine_id: number | null;
  medicine_name?: string | null;
  batch_no?: string | null;
  expiry_date?: string | null;
  quantity?: number | string | null;
  cost_price?: number | null;
  mrp?: number | null;
  invoice_no?: string | null;
  purchase_date?: string | null;
  distributor_name?: string | null;
  distributor_id?: number | null;
  ret_invoice_no?: string | null;
  ret_purchase_date?: string | null;
  ret_distributor_name?: string | null;
  ret_distributor_id?: number | null;
  _resolved_fields?: string[];
}

interface LocalReturnHistoryRow {
  id: number;
  return_no?: string | null;
  date?: string | null;
  type?: string | null;
  total_amount?: number | null;
  original_invoice_id?: number | string | null;
  distributor_id?: number | null;
  distributor_name?: string | null;
  purchase_invoice_no?: string | null;
  return_invoice_id?: string | null;
  return_sub_type?: string | null;
  reason?: string | null;
}

interface LocalExpiryPrefillRow {
  id?: number | null;
  medicine_id?: number | null;
  medicine_name?: string | null;
  name?: string | null;
  item_name?: string | null;
  batch_no?: string | null;
  batch?: string | null;
  expiry_date?: string | null;
  expiry?: string | null;
  quantity?: number | null;
  pack_quantity?: number | null;
  current_stock?: number | null;
  stock_quantity?: number | null;
  cost_price?: number | null;
  purchase_cost_price?: number | null;
  purchase_cost?: number | null;
  mrp?: number | null;
  purchase_item_id?: number | null;
  invoice_no?: string | null;
  purchase_invoice_no?: string | null;
  purchase_date?: string | null;
  distributor_name?: string | null;
  supplier_name?: string | null;
  distributor?: string | null;
  supplier_id?: number | null;
  distributor_id?: number | null;
}

interface LocalCameraMedicineInfo {
  potentialName?: string;
  batchNumber?: string;
  expiryDate?: string;
  mrp?: number | string;
}

interface LocalMasterDistributor {
  id?: number;
  name?: string | null;
}

const numOr0 = (v: unknown): number => parseFloat(String(v ?? '')) || 0;

function createEmptyItem(): ReturnItem {
  return {
    id: generateUUID(),
    medicine_id: null,
    medicine_name: '',
    batch_no: '',
    expiry_date: '',
    quantity: '',
    cost_price: '',
    mrp: '',
    return_type: 'good',
    reason: 'Wrong Product Delivered',
  };
}

const getInitialBills = (): DistributorReturnBill[] => {
  const saved = localStorage.getItem('returns_distributor_bills');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (e) {
      console.error('Failed to parse saved distributor return bills:', e);
    }
  }
  // Graceful migration from legacy returns_draft_tabs
  const legacySaved = localStorage.getItem('returns_draft_tabs');
  if (legacySaved) {
    try {
      const legacyTabs = JSON.parse(legacySaved);
      if (Array.isArray(legacyTabs) && legacyTabs.length > 0) {
        const migratedBills: DistributorReturnBill[] = [];
        legacyTabs.forEach(tab => {
          const items = tab.items || [];
          const distMap: Record<string, ReturnItem[]> = {};
          items.forEach((it: any) => {
            if (!it.medicine_name && !it.medicine_id) return;
            const distKey = it.distributor_name || 'General Returns';
            if (!distMap[distKey]) distMap[distKey] = [];
            distMap[distKey].push(it);
          });
          Object.entries(distMap).forEach(([distName, distItems]) => {
            const first = distItems[0];
            migratedBills.push({
              id: 'bill_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
              distributor_id: first?.distributor_id || null,
              distributor_name: distName === 'General Returns' ? '' : distName,
              invoice_no: first?.invoice_no || '',
              date: getTodayString(),
              loss_percentage: 0,
              expired_items: [],
              manual_items: distItems,
            });
          });
        });
        if (migratedBills.length > 0) return migratedBills;
      }
    } catch (e) {
      console.error('Failed to migrate legacy draft tabs:', e);
    }
  }

  return [
    {
      id: 'bill_' + Date.now(),
      distributor_id: null,
      distributor_name: '',
      invoice_no: '',
      date: getTodayString(),
      loss_percentage: 0,
      expired_items: [],
      manual_items: [createEmptyItem()],
    }
  ];
};

const getInitialActiveBillId = (initialBills: DistributorReturnBill[]): string => {
  const saved = localStorage.getItem('returns_active_bill_id');
  if (saved && initialBills.some(b => b.id === saved)) return saved;
  return initialBills[0]?.id || 'default';
};

const formatExpiryToMMYY = (val: string): string => {
  if (!val) return '';
  val = val.trim().replace(/\s+/g, '');
  if (/^\d{4}$/.test(val)) {
    const mm = val.substring(0, 2);
    const yy = val.substring(2, 4);
    return `${mm}/${yy}`;
  }
  if (/^\d{6}$/.test(val)) {
    const mm = val.substring(0, 2);
    const yyyy = val.substring(2, 6);
    return `${mm}/${yyyy.substring(2, 4)}`;
  }
  if (/^\d{2}\/\d{4}$/.test(val)) {
    const mm = val.substring(0, 2);
    const yyyy = val.substring(3, 7);
    return `${mm}/${yyyy.substring(2, 4)}`;
  }
  if (/^\d{2}\/\d{2}$/.test(val)) {
    return val;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(val)) {
    const parts = val.substring(0, 10).split('-');
    return `${parts[1]}/${parts[0].substring(2, 4)}`;
  }
  return val;
};

const getExpiryUrgencyStatus = (expiryStr: string): { label: string; className: string; rank: number } | null => {
  if (!expiryStr) return null;
  let expDate: Date | null = null;
  if (expiryStr.includes('/')) {
    const parts = expiryStr.split('/');
    let year = parseInt(parts[1], 10);
    const month = parseInt(parts[0], 10) - 1;
    if (year < 100) year += 2000;
    expDate = new Date(year, month + 1, 0);
  } else if (/^\d{4}-\d{2}-\d{2}/.test(expiryStr)) {
    expDate = new Date(expiryStr);
  }
  if (!expDate || isNaN(expDate.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (expDate < today) {
    return { label: 'EXPIRED', className: 'bg-red-500/10 text-red-500 border-red-500/20', rank: 1 };
  }
  const sixtyDaysFromNow = new Date();
  sixtyDaysFromNow.setDate(today.getDate() + 60);
  if (expDate <= sixtyDaysFromNow) {
    return { label: 'NEAR EXPIRY', className: 'bg-amber-500/10 text-amber-500 border-amber-500/20', rank: 2 };
  }
  return { label: 'VALID', className: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20', rank: 3 };
};

let cachedReturnHistory: LocalReturnHistoryRow[] | null = null;

const Returns: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get('tab') || 'returns';
  const location = useLocation();

  // Distributor Return Bills
  const initialBills = getInitialBills();
  const [bills, setBills] = useState<DistributorReturnBill[]>(initialBills);
  const [activeBillId, setActiveBillId] = useState<string>(() => getInitialActiveBillId(initialBills));

  const activeBill = useMemo(() => {
    return bills.find(b => b.id === activeBillId) || bills[0] || {
      id: 'default',
      distributor_id: null,
      distributor_name: '',
      invoice_no: '',
      date: getTodayString(),
      loss_percentage: 0,
      expired_items: [],
      manual_items: [createEmptyItem()],
    };
  }, [bills, activeBillId]);

  const [historySubTab, setHistorySubTab] = useState<'supplier' | 'customer'>('supplier');
  const [saving, setSaving] = useState(false);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);

  // Near-expiry items grouped by distributor directly from backend
  const { data: nearExpiryData = [], refetch: refetchNearExpiry } = useApiQuery<Array<{
    distributor_id: number | null;
    distributor_name: string;
    items: Array<{
      inventory_id: number;
      medicine_id: number;
      medicine_name: string;
      batch_no: string;
      expiry_date: string;
      quantity: number;
      cost_price: number;
      mrp: number;
      purchase_invoice_no?: string;
      purchase_number?: string;
      purchase_date?: string;
    }>;
  }>>(
    ['near-expiry-grouped-returns'],
    () => api.getNearExpiry(6).then(res => Array.isArray(res) ? res : (res?.data || [])),
    { staleTime: 30000 }
  );

  // Pending reviews count
  useEffect(() => {
    api.getExpiryReviews({ status: 'pending' }).then(res => {
      if (res?.stats) setPendingReviewCount(res.stats.pendingCount || 0);
    }).catch(() => {});
  }, []);

  // Sync bills to localStorage & backward-compatible stage draft sync for Expiry page
  useEffect(() => {
    localStorage.setItem('returns_distributor_bills', JSON.stringify(bills));
    localStorage.setItem('returns_active_bill_id', activeBillId);

    // Projected lightweight format for Expiry staged draft indicators
    const stagedTabs = bills.map(b => ({
      id: b.id,
      name: b.distributor_name || 'Draft',
      items: [
        ...b.expired_items.filter(i => i.selected).map(i => ({
          medicine_id: i.medicine_id,
          batch_no: i.batch_no,
          quantity: i.quantity,
        })),
        ...b.manual_items.map(i => ({
          medicine_id: i.medicine_id,
          batch_no: i.batch_no,
          quantity: i.quantity,
        }))
      ]
    }));
    localStorage.setItem('returns_draft_tabs', JSON.stringify(stagedTabs));
    window.dispatchEvent(new CustomEvent('returns-draft-changed'));
  }, [bills, activeBillId]);

  // Reactive auto-population: when activeBill has a distributor, populate matching near-expiry stock
  useEffect(() => {
    if (!activeBill || (!activeBill.distributor_id && !activeBill.distributor_name)) return;

    const match = nearExpiryData.find(g =>
      (activeBill.distributor_id && g.distributor_id === activeBill.distributor_id) ||
      (activeBill.distributor_name && g.distributor_name && g.distributor_name.toLowerCase() === activeBill.distributor_name.toLowerCase())
    );

    if (match && match.items && match.items.length > 0) {
      setBills(prevBills => {
        const bIdx = prevBills.findIndex(b => b.id === activeBill.id);
        if (bIdx === -1) return prevBills;
        const curBill = prevBills[bIdx];
        const existingKeys = new Set(curBill.expired_items.map(i => `${i.medicine_id}_${(i.batch_no || '').trim().toLowerCase()}`));

        const toAdd: ExpiredReturnRow[] = match.items
          .filter(it => !existingKeys.has(`${it.medicine_id}_${(it.batch_no || '').trim().toLowerCase()}`))
          .map(it => ({
            inventory_id: it.inventory_id,
            medicine_id: it.medicine_id,
            medicine_name: it.medicine_name,
            batch_no: it.batch_no || '',
            expiry_date: formatExpiryToMMYY(it.expiry_date || ''),
            available_stock: it.quantity || 0,
            quantity: it.quantity || 0,
            cost_price: it.cost_price ?? 0,
            mrp: it.mrp ?? 0,
            selected: true,
            invoice_no: it.purchase_invoice_no || '',
            app_invoice_no: it.purchase_number || '',
            purchase_date: it.purchase_date || '',
          }));

        if (toAdd.length === 0) return prevBills;
        
        let autoInvNo = curBill.invoice_no;
        if (!autoInvNo) {
          const foundInv = match.items.find(i => i.purchase_invoice_no)?.purchase_invoice_no;
          const foundPurNo = match.items.find(i => i.purchase_number)?.purchase_number;
          if (foundInv) autoInvNo = foundInv;
          else if (foundPurNo) autoInvNo = foundPurNo;
        }

        const updated = [...prevBills];
        updated[bIdx] = {
          ...curBill,
          invoice_no: autoInvNo || curBill.invoice_no,
          expired_items: [...curBill.expired_items, ...toAdd]
        };
        return updated;
      });
    }
  }, [activeBill.id, activeBill.distributor_id, activeBill.distributor_name, nearExpiryData]);

  // Master active distributors directory
  const { data: masterDistributors = [] } = useApiQuery<LocalMasterDistributor[]>(
    ['distributors-list'],
    async () => {
      const res = await api.getDistributors();
      return (Array.isArray(res) ? res : (res?.data || [])) as LocalMasterDistributor[];
    },
    { staleTime: 30000 }
  );

  // Distributor search dropdown state in active bill
  const [distributorSearchText, setDistributorSearchText] = useState('');
  const [showDistDropdown, setShowDistDropdown] = useState(false);
  const distributorDropdownRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(distributorDropdownRef, () => setShowDistDropdown(false));

  const filteredMasterDistributors = useMemo(() => {
    const q = distributorSearchText.trim().toLowerCase();
    if (!q) return masterDistributors;
    return masterDistributors.filter(d => (d.name || '').toLowerCase().includes(q));
  }, [masterDistributors, distributorSearchText]);

  // Search autocomplete for manual items
  const [searchResults, setSearchResults] = useState<LocalPurchaseLookupRow[]>([]);
  const [otherDistributorMatches, setOtherDistributorMatches] = useState<LocalPurchaseLookupRow[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState<number | null>(null);
  const [searchHighlightIndex, setSearchHighlightIndex] = useState(-1);
  const searchResultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (searchHighlightIndex >= 0 && searchResultsRef.current) {
      const highlighted = searchResultsRef.current.querySelector('[data-highlighted="true"]') as HTMLElement;
      if (highlighted) {
        highlighted.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }
    }
  }, [searchHighlightIndex]);

  const activeSearchRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(activeSearchRef, () => {
    setActiveSearchIndex(null);
    setSearchResults([]);
    setOtherDistributorMatches([]);
    setSearchHighlightIndex(-1);
  });

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchMedicines = useCallback((term: string, index: number) => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    const cleanTerm = (term || '').trim().replace(/\s+/g, ' ');

    if (cleanTerm.length < 2) {
      setSearchResults([]);
      setOtherDistributorMatches([]);
      setActiveSearchIndex(null);
      setSearchHighlightIndex(-1);
      return;
    }

    const distId = activeBill.distributor_id || undefined;
    const distName = activeBill.distributor_name || undefined;

    if (cleanTerm.length === 2) {
      setActiveSearchIndex(null);
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const response = await api.lookupPurchases(cleanTerm, undefined, distId, distName);
          const raw = (Array.isArray(response) ? response : (response?.data || [])) as LocalPurchaseLookupRow[];
          setSearchResults(rankAndSortMedicines(raw, cleanTerm));
          setSearchHighlightIndex(-1);
          if (raw.length === 0 && (distId || distName)) {
            const allRes = await api.lookupPurchases(cleanTerm);
            const allRaw = (Array.isArray(allRes) ? allRes : (allRes?.data || [])) as LocalPurchaseLookupRow[];
            setOtherDistributorMatches(allRaw);
          } else {
            setOtherDistributorMatches([]);
          }
        } catch (error) {
          console.error('Error prefetching medicines:', error);
        }
      }, 150);
      return;
    }

    setActiveSearchIndex(index);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await api.lookupPurchases(cleanTerm, undefined, distId, distName);
        const raw = (Array.isArray(response) ? response : (response?.data || [])) as LocalPurchaseLookupRow[];
        setSearchResults(rankAndSortMedicines(raw, cleanTerm));
        setSearchHighlightIndex(-1);
        if (raw.length === 0 && (distId || distName)) {
          const allRes = await api.lookupPurchases(cleanTerm);
          const allRaw = (Array.isArray(allRes) ? allRes : (allRes?.data || [])) as LocalPurchaseLookupRow[];
          setOtherDistributorMatches(allRaw);
        } else {
          setOtherDistributorMatches([]);
        }
      } catch (error) {
        console.error('Error searching medicines:', error);
      }
    }, 300);
  }, [activeBill.distributor_id, activeBill.distributor_name]);

  // AI Camera Scan
  const [showCamera, setShowCamera] = useState(false);
  const [cameraTargetIndex, setCameraTargetIndex] = useState<number | null>(null);

  const handleCameraScanResult = (result: { medicineInfo?: LocalCameraMedicineInfo }) => {
    if (cameraTargetIndex === null) return;
    const info = result.medicineInfo || {};
    const medName = info.potentialName || '';
    const batch = info.batchNumber || '';
    const exp = info.expiryDate ? formatExpiryToMMYY(info.expiryDate) : '';
    const mrp = info.mrp || '';

    setBills(prevBills => {
      const bIdx = prevBills.findIndex(b => b.id === activeBill.id);
      if (bIdx === -1) return prevBills;
      const curBill = prevBills[bIdx];
      const newManual = [...curBill.manual_items];
      const item = { ...newManual[cameraTargetIndex] };
      if (medName) item.medicine_name = medName;
      if (batch) item.batch_no = batch;
      if (exp) item.expiry_date = exp;
      if (mrp) item.mrp = mrp;
      newManual[cameraTargetIndex] = item;

      const updated = [...prevBills];
      updated[bIdx] = { ...curBill, manual_items: newManual };
      return updated;
    });

    setShowCamera(false);
    setCameraTargetIndex(null);

    if (medName) {
      const distId = activeBill.distributor_id || undefined;
      const distName = activeBill.distributor_name || undefined;

      api.lookupPurchases(medName, batch || undefined, distId, distName).then(res => {
        const list = (Array.isArray(res) ? res : (res?.data || [])) as LocalPurchaseLookupRow[];
        if (list.length > 0) {
          selectMedicineForManualItem(list[0], cameraTargetIndex);
        } else if (distId || distName) {
          api.lookupPurchases(medName, batch || undefined).then(allRes => {
            const allList = (Array.isArray(allRes) ? allRes : (allRes?.data || [])) as LocalPurchaseLookupRow[];
            if (allList.length > 0) {
              const actualDist = allList[0].distributor_name || 'another distributor';
              selectMedicineForManualItem(allList[0], cameraTargetIndex);
              toastEvent.trigger(
                `Scanned drug "${allList[0].medicine_name}" was purchased from ${actualDist}. Added to ${activeBill.distributor_name || 'return bill'}.`,
                'info',
                '/returns'
              );
            } else {
              toastEvent.trigger(`Scanned drug "${medName}". No purchase records found in app — you can enter manual bill details.`, 'info', '/returns');
            }
          }).catch(() => {});
        }
      }).catch(() => {});
    }
  };

  // Bill Mutation Helpers
  const updateActiveBill = (fields: Partial<DistributorReturnBill>) => {
    setBills(prevBills => {
      const bIdx = prevBills.findIndex(b => b.id === activeBill.id);
      if (bIdx === -1) return prevBills;
      const updated = [...prevBills];
      updated[bIdx] = { ...updated[bIdx], ...fields };
      return updated;
    });
  };

  const toggleExpiredItem = (index: number) => {
    setBills(prevBills => {
      const bIdx = prevBills.findIndex(b => b.id === activeBill.id);
      if (bIdx === -1) return prevBills;
      const curBill = prevBills[bIdx];
      const nextExpired = [...curBill.expired_items];
      nextExpired[index] = { ...nextExpired[index], selected: !nextExpired[index].selected };
      const updated = [...prevBills];
      updated[bIdx] = { ...curBill, expired_items: nextExpired };
      return updated;
    });
  };

  const updateExpiredItemQty = (index: number, qtyVal: string | number) => {
    setBills(prevBills => {
      const bIdx = prevBills.findIndex(b => b.id === activeBill.id);
      if (bIdx === -1) return prevBills;
      const curBill = prevBills[bIdx];
      const nextExpired = [...curBill.expired_items];
      nextExpired[index] = { ...nextExpired[index], quantity: qtyVal };
      const updated = [...prevBills];
      updated[bIdx] = { ...curBill, expired_items: nextExpired };
      return updated;
    });
  };

  const selectAllExpired = (selected: boolean) => {
    setBills(prevBills => {
      const bIdx = prevBills.findIndex(b => b.id === activeBill.id);
      if (bIdx === -1) return prevBills;
      const curBill = prevBills[bIdx];
      const nextExpired = curBill.expired_items.map(i => ({ ...i, selected }));
      const updated = [...prevBills];
      updated[bIdx] = { ...curBill, expired_items: nextExpired };
      return updated;
    });
  };

  const removeExpiredItem = (index: number) => {
    setBills(prevBills => {
      const bIdx = prevBills.findIndex(b => b.id === activeBill.id);
      if (bIdx === -1) return prevBills;
      const curBill = prevBills[bIdx];
      const nextExpired = curBill.expired_items.filter((_, i) => i !== index);
      const updated = [...prevBills];
      updated[bIdx] = { ...curBill, expired_items: nextExpired };
      return updated;
    });
  };

  const addManualItem = () => {
    setBills(prevBills => {
      const bIdx = prevBills.findIndex(b => b.id === activeBill.id);
      if (bIdx === -1) return prevBills;
      const curBill = prevBills[bIdx];
      const updated = [...prevBills];
      updated[bIdx] = { ...curBill, manual_items: [...curBill.manual_items, createEmptyItem()] };
      return updated;
    });
  };

  const updateManualItem = (index: number, field: keyof ReturnItem, value: any) => {
    setBills(prevBills => {
      const bIdx = prevBills.findIndex(b => b.id === activeBill.id);
      if (bIdx === -1) return prevBills;
      const curBill = prevBills[bIdx];
      const nextManual = [...curBill.manual_items];
      nextManual[index] = { ...nextManual[index], [field]: value };
      const updated = [...prevBills];
      updated[bIdx] = { ...curBill, manual_items: nextManual };
      return updated;
    });
  };

  const removeManualItem = (index: number) => {
    setBills(prevBills => {
      const bIdx = prevBills.findIndex(b => b.id === activeBill.id);
      if (bIdx === -1) return prevBills;
      const curBill = prevBills[bIdx];
      const nextManual = curBill.manual_items.filter((_, i) => i !== index);
      const updated = [...prevBills];
      updated[bIdx] = {
        ...curBill,
        manual_items: nextManual.length > 0 ? nextManual : [createEmptyItem()]
      };
      return updated;
    });
  };

  const selectMedicineForManualItem = (purchase: LocalPurchaseLookupRow, index: number) => {
    const isCrossDistributor = Boolean(
      activeBill.distributor_name &&
      purchase.distributor_name &&
      purchase.distributor_name !== 'Store Stock (No Invoice)' &&
      !purchase.distributor_name.includes('Catalog') &&
      activeBill.distributor_name.trim().toLowerCase() !== purchase.distributor_name.trim().toLowerCase()
    );

    if (isCrossDistributor) {
      toastEvent.trigger(
        `Added "${purchase.medicine_name}" (originally bought from ${purchase.distributor_name}) to ${activeBill.distributor_name} return.`,
        'info',
        '/returns'
      );
    }

    setBills(prevBills => {
      const bIdx = prevBills.findIndex(b => b.id === activeBill.id);
      if (bIdx === -1) return prevBills;
      const curBill = prevBills[bIdx];
      const newManual = [...curBill.manual_items];
      const item = { ...newManual[index] };

      item.medicine_id = purchase.medicine_id;
      item.medicine_name = purchase.medicine_name;
      item.batch_no = purchase.batch_no || '';
      item.expiry_date = formatExpiryToMMYY(purchase.expiry_date || '');
      item.cost_price = purchase.cost_price ?? '';
      item.mrp = purchase.mrp ?? '';
      item.purchase_item_id = purchase.purchase_item_id || undefined;
      item.invoice_no = purchase.invoice_no || purchase.app_invoice_no || undefined;
      item.app_invoice_no = purchase.app_invoice_no || undefined;
      item.distributor_name = isCrossDistributor ? (curBill.distributor_name || undefined) : (purchase.distributor_name || undefined);
      item.distributor_id = isCrossDistributor ? (curBill.distributor_id || undefined) : (purchase.distributor_id || undefined);

      const expStatus = getExpiryUrgencyStatus(purchase.expiry_date || '');
      const isExpiredOrNear = expStatus?.label === 'EXPIRED' || expStatus?.label === 'NEAR EXPIRY';
      if (!item.reason || item.reason === 'Wrong Product Delivered' || item.reason === 'Near Expiry / Expired') {
        item.return_type = isExpiredOrNear ? 'expiry' : 'good';
        item.reason = isExpiredOrNear ? 'Near Expiry / Expired' : 'Wrong Product Delivered';
      }

      let updatedDistId = curBill.distributor_id;
      let updatedDistName = curBill.distributor_name;
      if (!updatedDistName && purchase.distributor_name && purchase.distributor_name !== 'Store Stock (No Invoice)' && !purchase.distributor_name.includes('Catalog')) {
        updatedDistName = purchase.distributor_name;
        updatedDistId = purchase.distributor_id || null;
      }

      let updatedInvNo = curBill.invoice_no;
      if (!updatedInvNo && !isCrossDistributor && (purchase.invoice_no || purchase.app_invoice_no)) {
        updatedInvNo = purchase.invoice_no || purchase.app_invoice_no || '';
      }

      newManual[index] = item;
      const updated = [...prevBills];
      updated[bIdx] = {
        ...curBill,
        distributor_id: updatedDistId,
        distributor_name: updatedDistName,
        invoice_no: updatedInvNo || curBill.invoice_no,
        return_sub_type: curBill.return_sub_type || (curBill.expired_items.length === 0 ? 'good' : undefined),
        manual_items: newManual
      };
      return updated;
    });

    setSearchResults([]);
    setOtherDistributorMatches([]);
    setActiveSearchIndex(null);
    setSearchHighlightIndex(-1);
  };

  const addNewBill = (distributor?: { id?: number; name: string }) => {
    const newId = 'bill_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
    const newBill: DistributorReturnBill = {
      id: newId,
      distributor_id: distributor?.id || null,
      distributor_name: distributor?.name || '',
      invoice_no: '',
      date: getTodayString(),
      loss_percentage: 0,
      expired_items: [],
      manual_items: [createEmptyItem()],
    };
    setBills(prev => [...prev, newBill]);
    setActiveBillId(newId);
    setDistributorSearchText('');
  };

  const closeBillTab = (tabId: string) => {
    if (bills.length === 1) {
      const fresh: DistributorReturnBill = {
        id: 'bill_' + Date.now(),
        distributor_id: null,
        distributor_name: '',
        invoice_no: '',
        date: getTodayString(),
        loss_percentage: 0,
        expired_items: [],
        manual_items: [createEmptyItem()],
      };
      setBills([fresh]);
      setActiveBillId(fresh.id);
      return;
    }
    const filtered = bills.filter(b => b.id !== tabId);
    setBills(filtered);
    if (activeBillId === tabId) {
      setActiveBillId(filtered[filtered.length - 1].id);
    }
  };

  // Prefilled items handoff from Expiry Monitor page: groups by distributor
  useEffect(() => {
    const prefilledItems = location.state?.prefilledReturnItems;
    if (prefilledItems && Array.isArray(prefilledItems) && prefilledItems.length > 0) {
      setBills(prevBills => {
        const nextBills = [...prevBills];
        const groups: Record<string, { distributor_id?: number; distributor_name: string; items: any[] }> = {};

        prefilledItems.forEach((item: LocalExpiryPrefillRow) => {
          const distName = item.distributor_name || item.supplier_name || item.distributor || 'General Returns';
          const distId = item.distributor_id || item.supplier_id || undefined;
          const key = distId ? `id_${distId}` : `name_${distName.toLowerCase()}`;
          if (!groups[key]) {
            groups[key] = { distributor_id: distId, distributor_name: distName, items: [] };
          }
          groups[key].items.push(item);
        });

        let firstTargetBillId: string | null = null;

        Object.values(groups).forEach(g => {
          let targetBill = nextBills.find(b => 
            (g.distributor_id && b.distributor_id === g.distributor_id) ||
            (b.distributor_name && b.distributor_name.toLowerCase() === g.distributor_name.toLowerCase())
          );

          const mappedExpiredItems: ExpiredReturnRow[] = g.items.map(it => ({
            inventory_id: it.id || 0,
            medicine_id: it.medicine_id || it.id || 0,
            medicine_name: it.medicine_name || it.name || it.item_name || 'Unknown',
            batch_no: it.batch_no || it.batch || '',
            expiry_date: formatExpiryToMMYY(it.expiry_date || it.expiry || ''),
            available_stock: it.quantity ?? it.current_stock ?? 1,
            quantity: it.quantity ?? it.current_stock ?? 1,
            cost_price: it.cost_price ?? it.purchase_cost_price ?? it.purchase_cost ?? it.mrp ?? 0,
            mrp: it.mrp ?? 0,
            selected: true,
          }));

          if (targetBill) {
            const existingKeys = new Set(targetBill.expired_items.map(i => `${i.medicine_id}_${i.batch_no}`));
            const toAdd = mappedExpiredItems.filter(i => !existingKeys.has(`${i.medicine_id}_${i.batch_no}`));
            targetBill.expired_items = [...targetBill.expired_items, ...toAdd];
            if (!firstTargetBillId) firstTargetBillId = targetBill.id;
          } else {
            const emptyBillIdx = nextBills.findIndex(b => !b.distributor_name && b.manual_items.every(m => !m.medicine_name) && b.expired_items.length === 0);
            const newBillId = emptyBillIdx !== -1 ? nextBills[emptyBillIdx].id : 'bill_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
            const newBill: DistributorReturnBill = {
              id: newBillId,
              distributor_id: g.distributor_id || null,
              distributor_name: g.distributor_name === 'General Returns' ? '' : g.distributor_name,
              invoice_no: '',
              date: getTodayString(),
              loss_percentage: 0,
              expired_items: mappedExpiredItems,
              manual_items: [createEmptyItem()],
            };
            if (emptyBillIdx !== -1) {
              nextBills[emptyBillIdx] = newBill;
            } else {
              nextBills.push(newBill);
            }
            if (!firstTargetBillId) firstTargetBillId = newBill.id;
          }
        });

        if (firstTargetBillId) {
          setActiveBillId(firstTargetBillId);
        }
        return nextBills;
      });

      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Active Bill Calculations
  const selectedExpiredItems = useMemo(() => {
    return (activeBill.expired_items || []).filter(i => i.selected && numOr0(i.quantity) > 0);
  }, [activeBill.expired_items]);

  const validManualItems = useMemo(() => {
    return (activeBill.manual_items || []).filter(i => (i.medicine_name || i.medicine_id) && numOr0(i.quantity) > 0);
  }, [activeBill.manual_items]);

  const expiredSubtotal = useMemo(() => {
    return selectedExpiredItems.reduce((s, i) => s + (numOr0(i.cost_price) * numOr0(i.quantity)), 0);
  }, [selectedExpiredItems]);

  const manualSubtotal = useMemo(() => {
    return validManualItems.reduce((s, i) => s + (numOr0(i.cost_price) * numOr0(i.quantity)), 0);
  }, [validManualItems]);

  const totalClaimAmount = expiredSubtotal + manualSubtotal;
  const totalClaimItemsCount = selectedExpiredItems.length + validManualItems.length;
  const netCreditExpected = totalClaimAmount * (1 - (activeBill.loss_percentage || 0) / 100);

  // Total return products across all bills for top switcher pill
  const totalSupplierReturnItemsCount = useMemo(() => {
    return bills.reduce((acc, b) => {
      const exp = b.expired_items.filter(i => i.selected).length;
      const man = b.manual_items.filter(i => (i.medicine_name || i.medicine_id) && numOr0(i.quantity) > 0).length;
      return acc + exp + man;
    }, 0);
  }, [bills]);

  // Modal State for Confirm Process
  const [showProcessConfirmModal, setShowProcessConfirmModal] = useState(false);

  // Return Processing
  const handleConfirmProcessReturn = async () => {
    if (!activeBill.distributor_name && !activeBill.distributor_id) {
      toastEvent.trigger('Please select or specify a distributor for this return.', 'error', '/returns');
      setShowProcessConfirmModal(false);
      return;
    }

    const itemsToSubmit = [
      ...selectedExpiredItems.map(i => ({
        medicine_id: i.medicine_id,
        medicine_name: i.medicine_name,
        batch_no: i.batch_no,
        expiry_date: i.expiry_date,
        quantity: numOr0(i.quantity),
        cost_price: numOr0(i.cost_price),
        mrp: numOr0(i.mrp),
        distributor_id: activeBill.distributor_id || undefined,
        invoice_no: i.invoice_no || activeBill.invoice_no || 'N/A',
        app_invoice_no: i.app_invoice_no,
        return_type: 'expiry' as const,
        reason: 'Expired / Near-Expiry',
      })),
      ...validManualItems.map(i => ({
        medicine_id: i.medicine_id,
        medicine_name: i.medicine_name,
        batch_no: i.batch_no,
        expiry_date: i.expiry_date,
        quantity: numOr0(i.quantity),
        cost_price: numOr0(i.cost_price),
        mrp: numOr0(i.mrp),
        distributor_id: activeBill.distributor_id || undefined,
        invoice_no: i.invoice_no || activeBill.invoice_no || 'N/A',
        app_invoice_no: i.app_invoice_no,
        return_type: i.return_type || 'good',
        reason: i.reason || 'Wrong Product Delivered',
      }))
    ];

    if (itemsToSubmit.length === 0) {
      toastEvent.trigger('No valid return items with quantity > 0.', 'error', '/returns');
      setShowProcessConfirmModal(false);
      return;
    }

    const hasExpired = selectedExpiredItems.length > 0 || validManualItems.some(i => i.return_type === 'expiry');
    const hasGoods = validManualItems.some(i => i.return_type === 'good' || !i.return_type);
    const billSubType: 'good' | 'expiry' = activeBill.return_sub_type || (hasGoods && !hasExpired ? 'good' : (hasExpired && !hasGoods ? 'expiry' : (hasExpired ? 'expiry' : 'good')));
    const billReason = activeBill.reason || (billSubType === 'good' ? (validManualItems.find(i => i.reason)?.reason || 'Goods Return (Wrong Product / Non-Expired)') : 'Supplier Expiry Return');

    setSaving(true);
    try {
      await api.processReturns(
        itemsToSubmit,
        activeBill.loss_percentage,
        activeBill.distributor_id || undefined,
        activeBill.distributor_name || undefined,
        activeBill.invoice_no || undefined,
        billSubType,
        billReason
      );
      toastEvent.trigger(`Successfully processed ${billSubType === 'good' ? 'Goods Return' : 'return'} for ${activeBill.distributor_name || 'supplier'} (${itemsToSubmit.length} items)!`, 'success', '/returns');

      invalidateAfterStockWrite(queryClient);
      refetchNearExpiry().catch(() => {});
      refetchHistory().catch(() => {});
      api.getCompactInventory().catch(() => {});

      setShowProcessConfirmModal(false);

      if (bills.length > 1) {
        closeBillTab(activeBill.id);
      } else {
        setBills([{
          id: 'bill_' + Date.now(),
          distributor_id: null,
          distributor_name: '',
          invoice_no: '',
          date: getTodayString(),
          loss_percentage: 0,
          return_sub_type: 'good',
          reason: 'Wrong Product Delivered',
          expired_items: [],
          manual_items: [createEmptyItem()],
        }]);
      }
    } catch (error: any) {
      console.error('Error processing return:', error);
      const msg = error?.response?.data?.error || error?.message || 'Failed to process return claim. Please try again.';
      toastEvent.trigger(msg, 'error', '/returns');
    } finally {
      setSaving(false);
    }
  };

  // PDF Export for active bill
  const handleExportDistributorPDF = async () => {
    const itemsForPDF = [
      ...selectedExpiredItems.map(i => ({
        medicine_name: i.medicine_name,
        batch_no: i.batch_no,
        expiry_date: i.expiry_date,
        quantity: numOr0(i.quantity),
        cost_price: numOr0(i.cost_price),
        mrp: numOr0(i.mrp),
        invoice_no: i.invoice_no || activeBill.invoice_no || 'N/A',
        app_invoice_no: i.app_invoice_no,
        distributor_name: activeBill.distributor_name || 'Distributor',
        return_type: 'expiry',
        reason: 'Expired / Near-Expiry',
      })),
      ...validManualItems.map(i => ({
        medicine_name: i.medicine_name,
        batch_no: i.batch_no,
        expiry_date: i.expiry_date,
        quantity: numOr0(i.quantity),
        cost_price: numOr0(i.cost_price),
        mrp: numOr0(i.mrp),
        invoice_no: i.invoice_no || activeBill.invoice_no || 'N/A',
        app_invoice_no: i.app_invoice_no,
        distributor_name: i.distributor_name || activeBill.distributor_name || 'Distributor',
        return_type: i.return_type || 'good',
        reason: i.reason || 'Wrong Product Delivered',
      }))
    ];

    if (itemsForPDF.length === 0) {
      toastEvent.trigger('No valid return items to export.', 'info', '/returns');
      return;
    }

    const hasExpired = selectedExpiredItems.length > 0 || validManualItems.some(i => i.return_type === 'expiry');
    const hasGoods = validManualItems.some(i => i.return_type === 'good' || !i.return_type);
    const billSubType: 'good' | 'expiry' = activeBill.return_sub_type || (hasGoods && !hasExpired ? 'good' : (hasExpired && !hasGoods ? 'expiry' : (hasExpired ? 'expiry' : 'good')));
    const billReason = activeBill.reason || (billSubType === 'good' ? (validManualItems.find(i => i.reason)?.reason || 'Goods Return (Wrong Product / Non-Expired)') : 'Supplier Expiry Return');

    try {
      const blob = await api.exportReturnsPDF(itemsForPDF as unknown as ReadonlyArray<Record<string, unknown>>, billSubType, billReason);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${billSubType === 'good' ? 'goods-return' : 'debit-note'}-${(activeBill.distributor_name || 'supplier').replace(/\s+/g, '_')}-${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toastEvent.trigger(`${billSubType === 'good' ? 'Goods return statement' : 'Debit note'} PDF downloaded.`, 'success', '/returns');
    } catch (error) {
      console.error('Error exporting PDF:', error);
      toastEvent.trigger('Failed to export PDF statement.', 'error', '/returns');
    }
  };

  // ──────────────────────────────────────────────
  // Return History Section Logic
  // ──────────────────────────────────────────────
  const todayStr = getTodayString();
  const thirtyDaysAgoStr = getNDaysAgoString(30);

  const dateRangeHelper = usePersistedDateRange({
    storageKey: 'supplier-returns-date-range',
    defaultFrom: thirtyDaysAgoStr,
    defaultTo: todayStr,
  });

  const [searchFilterText, setSearchFilterText] = useState('');

  const queryClient = useQueryClient();
  const {
    items: returnHistory,
    totalItems: returnHistoryTotal,
    isFetching: loadingHistory,
    isFetchingNextPage: loadingMoreHistory,
    hasNextPage: hasMoreHistory,
    fetchNextPage: fetchMoreHistory,
    sentinelRef: historySentinelRef,
    refetch: refetchHistory,
  } = useInfiniteScroll<LocalReturnHistoryRow>({
    queryKey: 'supplier-return-history-list',
    cacheKey: 'supplier-return-history-cache',
    serverFilters: {
      search: searchFilterText.trim(),
      date_from: dateRangeHelper.dateRange.from,
      date_to: dateRangeHelper.dateRange.to,
    },
    fetchPage: async (pageParam, filters) => {
      const response = await api.getReturns({
        page: pageParam,
        limit: 30,
        search: filters.search || undefined,
        date_from: filters.date_from || undefined,
        date_to: filters.date_to || undefined,
      });
      if (response && response.data) {
        return {
          data: response.data || [],
          totalItems: response.totalItems || 0,
          totalPages: response.totalPages || 1,
        };
      } else {
        const list = Array.isArray(response) ? response : [];
        return {
          data: list,
          totalItems: list.length,
          totalPages: 1,
        };
      }
    },
  });

  useEffect(() => {
    const handleStockWrite = () => {
      refetchHistory().catch(() => {});
    };
    window.addEventListener('stock-write-completed', handleStockWrite);
    window.addEventListener('sse-return-created', handleStockWrite);
    return () => {
      window.removeEventListener('stock-write-completed', handleStockWrite);
      window.removeEventListener('sse-return-created', handleStockWrite);
    };
  }, [refetchHistory]);

  const [selectedHistoryReturn, setSelectedHistoryReturn] = useState<LocalReturnHistoryRow | null>(null);
  const [historyReturnItems, setHistoryReturnItems] = useState<LocalHistoryReturnDetail[]>([]);
  const [loadingHistoryItems, setLoadingHistoryItems] = useState(false);
  const [isEditingHistory, setIsEditingHistory] = useState(false);
  const [editingItems, setEditingItems] = useState<LocalEditableReturnItem[]>([]);
  const [isResolving, setIsResolving] = useState(false);
  const [deleteConfirmReturn, setDeleteConfirmReturn] = useState<LocalReturnHistoryRow | null>(null);

  const hasMissingData = historyReturnItems.some(
    i => !i.batch_no || !i.expiry_date || !(i.cost_price)
  );

  const handleSelectHistoryReturn = async (ret: LocalReturnHistoryRow) => {
    setSelectedHistoryReturn(ret);
    setLoadingHistoryItems(true);
    setIsEditingHistory(false);
    try {
      const response = await api.getReturnItems(ret.id);
      const mapped = ((response || []) as LocalReturnItemRow[]).map((item): LocalHistoryReturnDetail => ({
        id: String(item.id),
        medicine_id: item.medicine_id,
        medicine_name: item.medicine_name || 'Unknown Medicine',
        batch_no: item.batch_no || '',
        expiry_date: item.expiry_date ? formatExpiryToMMYY(item.expiry_date) : '',
        quantity: item.quantity ?? null,
        cost_price: item.cost_price ?? null,
        mrp: item.mrp || 0,
        invoice_no: item.invoice_no || ret.purchase_invoice_no || ret.return_invoice_id || 'N/A',
        purchase_date: item.purchase_date || '',
        distributor_name: item.distributor_name || ret.distributor_name || 'Unknown Distributor',
        distributor_id: item.distributor_id || ret.distributor_id || undefined,
      }));
      setHistoryReturnItems(mapped);
      setEditingItems(mapped.map(i => ({
        ...i,
        quantity: i.quantity ?? '',
        cost_price: i.cost_price ?? '',
        mrp: i.mrp ?? 0,
      })));
    } catch (error) {
      console.error('Error fetching return items:', error);
    } finally {
      setLoadingHistoryItems(false);
    }
  };

  const handleClearHistorySelection = () => {
    setSelectedHistoryReturn(null);
    setHistoryReturnItems([]);
  };

  const handleConfirmDeleteReturn = async () => {
    if (!deleteConfirmReturn) return;
    try {
      await api.deleteReturn(deleteConfirmReturn.id);
      if (selectedHistoryReturn?.id === deleteConfirmReturn.id) handleClearHistorySelection();
      invalidateAfterStockWrite(queryClient);
      clearInfiniteScrollCache('supplier-return-history-cache');
      refetchHistory().catch(() => {});
      api.getCompactInventory().catch(() => {});
      toastEvent.trigger(`Return ${deleteConfirmReturn.return_no} deleted.`, 'success', '/returns');
    } catch (err) {
      console.error('Failed to delete return:', err);
      toastEvent.trigger('Failed to delete return.', 'error', '/returns');
    } finally {
      setDeleteConfirmReturn(null);
    }
  };

  const handleSaveHistoryEdit = async () => {
    if (!selectedHistoryReturn) return;
    setSaving(true);
    try {
      const validItems = editingItems.filter(i => i.medicine_id && (parseFloat(String(i.quantity)) || 0) > 0);
      const total = validItems.reduce((s, i) => s + (Number(i.cost_price) || 0) * (Number(i.quantity) || 0), 0);
      await api.updateReturn(selectedHistoryReturn.id, { items: validItems as unknown as Array<Record<string, unknown>>, total_amount: total });
      setIsEditingHistory(false);
      await handleSelectHistoryReturn(selectedHistoryReturn);
      invalidateAfterStockWrite(queryClient);
      clearInfiniteScrollCache('supplier-return-history-cache');
      refetchHistory().catch(() => {});
      api.getCompactInventory().catch(() => {});
      toastEvent.trigger('Return claim updated successfully.', 'success', '/returns');
    } catch (err) {
      console.error('Failed to save return:', err);
      toastEvent.trigger('Failed to save changes.', 'error', '/returns');
    } finally {
      setSaving(false);
    }
  };

  const handleResolveMissing = async () => {
    if (!selectedHistoryReturn) return;
    setIsResolving(true);
    try {
      const response = await api.resolveReturnMissing(selectedHistoryReturn.id);
      const mapped = ((response || []) as LocalReturnItemRow[]).map((item): LocalEditableReturnItem => ({
        id: String(item.id),
        medicine_id: item.medicine_id,
        medicine_name: item.medicine_name || 'Unknown Medicine',
        batch_no: item.batch_no || '',
        expiry_date: item.expiry_date ? formatExpiryToMMYY(item.expiry_date) : '',
        quantity: item.quantity ?? '',
        cost_price: item.cost_price ?? '',
        mrp: item.mrp || 0,
        invoice_no: item.invoice_no || item.ret_invoice_no || 'N/A',
        purchase_date: item.purchase_date || item.ret_purchase_date || '',
        distributor_name: item.distributor_name || item.ret_distributor_name || 'Unknown Distributor',
        distributor_id: item.distributor_id || item.ret_distributor_id || undefined,
        _resolved_fields: item._resolved_fields || [],
      }));
      setEditingItems(mapped);
      setIsEditingHistory(true);
      toastEvent.trigger('Missing fields resolved from purchase history.', 'success', '/returns');
    } catch (err) {
      console.error('Failed to resolve missing data:', err);
      toastEvent.trigger('Failed to auto-fill missing data.', 'error', '/returns');
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <div className="h-full flex flex-col fade-in relative overflow-hidden gap-3 p-4 text-text">
      
      {/* Top Bar: Title & Navigation Pills */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-bg2/90 backdrop-blur-md border border-border/80 rounded-2xl p-3 px-5 shadow-sm shrink-0">
        <div className="flex items-center gap-4">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-sm shrink-0">
            <RotateCcw size={22} className="animate-in spin-in-180 duration-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-extrabold text-text tracking-tight leading-none">Returns & Expiry Command Center</h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                DISTRIBUTOR HUB
              </span>
            </div>
            <p className="text-[11px] text-muted font-medium mt-1">Manage distributor returns bill-by-bill, near-expiry inventory alerts & debit notes</p>
          </div>
        </div>

        {/* Tab Switcher Pills */}
        <div className="flex items-center gap-1.5 bg-bg3/60 p-1.5 rounded-xl border border-border/60 overflow-x-auto scrollbar-none shadow-inner">
          {[
            { id: 'returns', label: 'Supplier Returns', icon: RotateCcw, count: totalSupplierReturnItemsCount },
            { id: 'expiry', label: 'Expiry Monitor', icon: CalendarDays },
            { id: 'expiry-review', label: 'Expiry Return Review', icon: ShieldAlert, count: pendingReviewCount },
            { id: 'customer', label: 'Customer Returns', icon: Users },
            { id: 'customer-history', label: 'Return History', icon: History, count: returnHistoryTotal || returnHistory.length },
          ].map(t => {
            const Icon = t.icon;
            const isActive = currentTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setSearchParams({ tab: t.id })}
                className={`flex items-center gap-2 px-3.5 py-1.5 font-bold text-sm rounded-lg transition-all duration-200 whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-bg2 text-primary font-black shadow-md border border-border ring-1 ring-primary/20'
                    : 'text-muted hover:text-text hover:bg-bg3/90 border border-transparent'
                }`}
              >
                <Icon size={16} className={isActive ? 'text-primary animate-pulse' : 'text-muted'} />
                <span>{t.label}</span>
                {t.count !== undefined && (
                  <span className={`text-xs px-1.5 py-0.2 rounded-full font-mono font-extrabold ${
                    isActive ? 'bg-primary/20 text-primary' : 'bg-bg/50 text-muted'
                  }`}>
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ────────────────────────────────────────────────────────────── */}
      {/* Tab 1: EXPIRY MONITOR                                          */}
      {/* ────────────────────────────────────────────────────────────── */}
      {currentTab === 'expiry' ? (
        <div className="flex-1 flex flex-col overflow-hidden relative min-h-0 bg-bg2/50 border border-border/60 rounded-2xl p-4">
          <Expiry />
        </div>
      ) : currentTab === 'expiry-review' ? (
        <div className="flex-1 flex flex-col overflow-hidden relative min-h-0 bg-bg2/50 border border-border/60 rounded-2xl p-4">
          <ExpiryReturnReview onPendingCountChange={setPendingReviewCount} />
        </div>
      ) : currentTab === 'customer' ? (
        <div className="flex-1 flex flex-col overflow-y-auto relative min-h-0 bg-bg2/50 border border-border/60 rounded-2xl p-5 custom-scrollbar">
          <CustomerReturn />
        </div>
      ) : currentTab === 'customer-history' ? (
        <div className="flex-1 flex flex-col overflow-hidden relative min-h-0 bg-bg2/50 border border-border/60 rounded-2xl p-4 gap-3">
          
          <div className="flex items-center justify-between pb-2 border-b border-border/60 shrink-0">
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-primary" />
              <h2 className="text-sm font-extrabold text-text uppercase tracking-wider">Return History Center</h2>
            </div>
            <div className="flex items-center gap-1 bg-bg3/80 p-1 rounded-xl border border-border/60">
              <button
                onClick={() => setHistorySubTab('supplier')}
                className={`flex items-center gap-2 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  historySubTab === 'supplier'
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-muted hover:text-text'
                }`}
              >
                <RotateCcw size={13} />
                <span>Supplier Returns ({returnHistoryTotal || returnHistory.length})</span>
              </button>
              <button
                onClick={() => setHistorySubTab('customer')}
                className={`flex items-center gap-2 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  historySubTab === 'customer'
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-muted hover:text-text'
                }`}
              >
                <Users size={13} />
                <span>Customer Returns</span>
              </button>
            </div>
          </div>

          {historySubTab === 'customer' ? (
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              <CustomerReturnHistory />
            </div>
          ) : (
            <div className="flex-1 flex gap-4 min-h-0 overflow-hidden text-text relative">
              {/* Left Column: Supplier Return History List & Filters */}
              <div className="w-96 flex-shrink-0 flex flex-col gap-3 min-h-0 overflow-hidden bg-bg2/90 backdrop-blur-md border border-border/80 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between border-b border-border/60 pb-2.5 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-black uppercase tracking-wider text-text">Finalized Supplier Returns</h3>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-bg3 text-primary border border-border/40 font-mono">
                      {returnHistoryTotal || returnHistory.length}
                    </span>
                  </div>
                </div>

                {/* Quick Search */}
                <div className="relative flex-shrink-0">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    type="text"
                    placeholder="Search return no, supplier..."
                    value={searchFilterText}
                    onChange={e => setSearchFilterText(e.target.value)}
                    className="w-full pl-8 pr-7 py-2 bg-bg3/80 border border-border/70 rounded-xl text-xs text-text placeholder:text-muted/60 focus:outline-none focus:border-primary/60 font-medium transition-all shadow-inner"
                  />
                  {searchFilterText && (
                    <button
                      onClick={() => setSearchFilterText('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text p-0.5 rounded-full cursor-pointer"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                {/* Date Filter Bar (Order-page style with quick presets & custom date range) */}
                <div className="p-2.5 bg-bg3/50 rounded-xl border border-border/60 space-y-2 text-[10px] flex-shrink-0 shadow-inner">
                  {/* Preset Pills */}
                  <div className="flex items-center gap-1 bg-bg2/70 p-1 rounded-lg border border-border/50">
                    {[
                      {
                        label: '30 Days',
                        key: '30d',
                        action: () => dateRangeHelper.setPreset(30),
                        active: dateRangeHelper.dateRange.from === thirtyDaysAgoStr && dateRangeHelper.dateRange.to === todayStr,
                      },
                      {
                        label: 'Today',
                        key: 'today',
                        action: () => dateRangeHelper.setDateRange({ from: todayStr, to: todayStr }),
                        active: dateRangeHelper.dateRange.from === todayStr && dateRangeHelper.dateRange.to === todayStr,
                      },
                      {
                        label: 'This Month',
                        key: 'month',
                        action: () => {
                          const n = new Date();
                          const f = new Date(n.getFullYear(), n.getMonth(), 1).toISOString().slice(0, 10);
                          dateRangeHelper.setDateRange({ from: f, to: todayStr });
                        },
                        active: dateRangeHelper.dateRange.from === new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10) && dateRangeHelper.dateRange.to === todayStr,
                      },
                      {
                        label: 'All Time',
                        key: 'all',
                        action: () => dateRangeHelper.setDateRange({ from: '', to: '' }),
                        active: !dateRangeHelper.dateRange.from && !dateRangeHelper.dateRange.to,
                      },
                    ].map(p => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={p.action}
                        className={`flex-1 py-1 px-1 rounded-md text-[10px] font-bold transition-all text-center cursor-pointer ${
                          p.active
                            ? 'bg-primary text-white shadow-sm'
                            : 'text-muted hover:text-text hover:bg-bg3'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  {/* Custom From/To Date Inputs */}
                  <div className="flex items-center gap-1.5 bg-bg border border-border/60 rounded-lg px-2 py-1">
                    <Calendar size={12} className="text-primary shrink-0" />
                    <span className="text-muted font-bold text-[10px] uppercase">From</span>
                    <input
                      type="date"
                      value={toDateInputValue(dateRangeHelper.dateRange.from)}
                      max={todayStr}
                      onChange={e => dateRangeHelper.handleFromChange(e.target.value)}
                      className="flex-1 bg-transparent text-[10px] text-text font-mono focus:outline-none cursor-pointer w-0 min-w-0"
                    />
                    <span className="text-muted font-bold text-[10px] uppercase ml-1">To</span>
                    <input
                      type="date"
                      value={toDateInputValue(dateRangeHelper.dateRange.to)}
                      max={todayStr}
                      onChange={e => dateRangeHelper.handleToChange(e.target.value)}
                      className="flex-1 bg-transparent text-[10px] text-text font-mono focus:outline-none cursor-pointer w-0 min-w-0"
                    />
                  </div>
                </div>

                {/* Finalized Returns List */}
                <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar min-h-0">
                  {loadingHistory && returnHistory.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted">
                      <Loader2 size={20} className="animate-spin text-primary" />
                      <span className="text-xs">Loading returns...</span>
                    </div>
                  ) : returnHistory.length === 0 ? (
                    <div className="text-center py-8 text-muted text-xs italic">No supplier return records found.</div>
                  ) : (
                    <>
                      {returnHistory.map(ret => {
                        const isSelected = selectedHistoryReturn?.id === ret.id;
                        return (
                          <div
                            key={ret.id}
                            onClick={() => handleSelectHistoryReturn(ret)}
                            className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-1.5 select-none ${
                              isSelected
                                ? 'bg-primary/10 border-primary text-text font-bold ring-1 ring-primary/30'
                                : 'bg-bg3/40 border-border/50 text-muted hover:text-text hover:bg-bg3/80'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-mono text-xs font-bold text-text">{ret.return_no || `RET-${ret.id}`}</span>
                                {ret.return_sub_type === 'good' ? (
                                  <span className="text-[9px] font-extrabold px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-mono">
                                    Goods Return
                                  </span>
                                ) : (
                                  <span className="text-[9px] font-extrabold px-1.5 py-0.2 rounded bg-red-500/10 text-red-500 border border-red-500/20 font-mono">
                                    Expiry
                                  </span>
                                )}
                              </div>
                              <span className="text-emerald-500 font-extrabold text-xs font-mono">₹{Number(ret.total_amount || 0).toFixed(2)}</span>
                            </div>
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="truncate font-semibold text-text">{ret.distributor_name || 'Direct Supplier'}</span>
                              <span className="font-mono text-muted">{ret.date ? ret.date.substring(0, 10) : '—'}</span>
                            </div>
                            {ret.reason && (
                              <div className="text-[10px] text-muted truncate font-medium flex items-center gap-1">
                                <span className="text-[9px] uppercase font-bold text-text/70">Reason:</span>
                                <span>{ret.reason}</span>
                              </div>
                            )}
                            <div className="flex items-center justify-between text-[11px] pt-1 border-t border-border/30 mt-0.5">
                              <span className="font-mono text-[11px] text-blue-500 font-bold" title="Their Purchase Bill Invoice Number">
                                Bill: {ret.purchase_invoice_no || ret.return_invoice_id || '—'}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setDeleteConfirmReturn(ret); }}
                                className="text-muted hover:text-red p-1 rounded hover:bg-red/10 transition-colors cursor-pointer"
                                title="Delete return"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      <InfiniteScrollStatus
                        totalItems={returnHistoryTotal}
                        loadedCount={returnHistory.length}
                        isFetching={loadingHistory}
                        isFetchingNextPage={loadingMoreHistory}
                        hasNextPage={hasMoreHistory}
                        onLoadMore={fetchMoreHistory}
                        sentinelRef={historySentinelRef}
                        itemName="returns"
                      />
                    </>
                  )}
                </div>
              </div>

              {/* Right Column: Return Items Details */}
              <div className="flex-1 flex flex-col min-h-0 bg-bg2/90 backdrop-blur-md border border-border/80 rounded-2xl p-4 shadow-sm overflow-hidden">
                {selectedHistoryReturn ? (
                  <div className="flex-1 flex flex-col min-h-0 gap-3">
                    <div className="flex items-center justify-between border-b border-border/60 pb-3 flex-shrink-0">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-black text-text">Return Claim #{selectedHistoryReturn.return_no}</h3>
                          {selectedHistoryReturn.return_sub_type === 'good' ? (
                            <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                              🟢 Goods Return
                            </span>
                          ) : (
                            <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 border border-red-500/20">
                              🔴 Expiry Return
                            </span>
                          )}
                          {(selectedHistoryReturn.purchase_invoice_no || selectedHistoryReturn.return_invoice_id) && (
                            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 border border-blue-500/20 font-bold">
                              Purchase Bill: {selectedHistoryReturn.purchase_invoice_no || selectedHistoryReturn.return_invoice_id}
                            </span>
                          )}
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                            Finalized
                          </span>
                        </div>
                        <p className="text-xs text-muted mt-0.5">
                          Supplier: <strong>{selectedHistoryReturn.distributor_name || 'Direct Supplier'}</strong>
                          {(selectedHistoryReturn.purchase_invoice_no || selectedHistoryReturn.return_invoice_id) && (
                            <> • Purchase Bill: <strong className="text-blue-500 font-mono">{selectedHistoryReturn.purchase_invoice_no || selectedHistoryReturn.return_invoice_id}</strong></>
                          )}
                          {" "}• Date: {selectedHistoryReturn.date?.substring(0, 10)}
                          {selectedHistoryReturn.reason && (
                            <> • Reason: <strong className="text-text">{selectedHistoryReturn.reason}</strong></>
                          )}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        {isEditingHistory ? (
                          <>
                            <button
                              onClick={handleSaveHistoryEdit}
                              disabled={saving}
                              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all disabled:opacity-50 shadow-sm cursor-pointer"
                            >
                              {saving ? 'Saving…' : 'Save Changes'}
                            </button>
                            <button
                              onClick={() => setIsEditingHistory(false)}
                              className="bg-bg3 border border-border/60 hover:bg-bg3/80 text-text font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            {hasMissingData && (
                              <button
                                onClick={handleResolveMissing}
                                disabled={isResolving}
                                className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/30 font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all disabled:opacity-60 cursor-pointer"
                                title="Auto-fill missing batch, expiry, cost from purchase history"
                              >
                                {isResolving ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                                <span>Auto-fill Missing</span>
                              </button>
                            )}
                            <button
                              onClick={async () => {
                                try {
                                  const blob = await api.exportReturnsPDF(historyReturnItems as unknown as ReadonlyArray<Record<string, unknown>>);
                                  const url = window.URL.createObjectURL(blob);
                                  const a = document.createElement('a');
                                  a.href = url;
                                  a.download = `return-${selectedHistoryReturn.return_no}-${Date.now()}.pdf`;
                                  document.body.appendChild(a);
                                  a.click();
                                  window.URL.revokeObjectURL(url);
                                  document.body.removeChild(a);
                                } catch (error) {
                                  console.error('Error exporting PDF:', error);
                                  toastEvent.trigger('Failed to export PDF.', 'error', '/returns');
                                }
                              }}
                              className="bg-purple-600 hover:bg-purple-500 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
                            >
                              <FileText size={13} /> Export PDF
                            </button>
                            <button
                              onClick={() => setIsEditingHistory(true)}
                              className="bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                            >
                              <Edit size={13} /> Edit
                            </button>
                            <button
                              onClick={handleClearHistorySelection}
                              className="bg-bg3 border border-border/60 hover:bg-bg3/80 text-text font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                            >
                              Back
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Table View */}
                    <div className="flex-1 overflow-auto bg-bg/40 rounded-2xl border border-border/60">
                      {loadingHistoryItems ? (
                        <div className="flex flex-col items-center justify-center h-full py-12 gap-3 text-muted">
                          <Loader2 className="animate-spin text-primary" size={32} />
                          <span className="text-xs font-bold">Loading finalized items...</span>
                        </div>
                      ) : (
                        <table className="w-full text-left border-collapse min-w-[650px]">
                          <thead className="sticky top-0 z-20 bg-bg2 border-b border-border/60 shadow-sm text-muted text-xs font-bold">
                            <tr>
                              <th className="p-3 w-10">#</th>
                              <th className="p-3 min-w-[220px]">Medicine Name</th>
                              <th className="p-3 w-28">Batch</th>
                              <th className="p-3 w-28">Expiry</th>
                              <th className="p-3 w-20 text-center">Qty</th>
                              <th className="p-3 w-24 text-right">Cost Price</th>
                              <th className="p-3 w-24 text-right">Total</th>
                              <th className="p-3 w-32 text-center" title="Distributor's Purchase Bill Invoice Number">Purchase Bill Inv #</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(isEditingHistory ? editingItems : historyReturnItems).map((item, index) => (
                              <tr key={item.id} className="border-b border-border/40 hover:bg-bg3/30 transition-colors text-xs">
                                <td className="p-3 text-muted font-mono">{index + 1}</td>
                                <td className="p-3 font-bold text-text">{item.medicine_name}</td>
                                <td className="p-2 font-mono text-muted">{item.batch_no || '—'}</td>
                                <td className="p-2 font-mono text-muted">{item.expiry_date || '—'}</td>
                                <td className="p-2 text-center font-mono font-bold text-text">{item.quantity ?? '—'}</td>
                                <td className="p-2 text-right font-mono text-muted">
                                  {item.cost_price != null ? `₹${Number(item.cost_price).toFixed(2)}` : '—'}
                                </td>
                                <td className="p-3 text-right font-mono font-bold text-text">
                                  {item.cost_price != null && item.quantity != null
                                    ? `₹${(Number(item.cost_price) * Number(item.quantity)).toFixed(2)}`
                                    : '—'}
                                </td>
                                <td className="p-2 text-center">
                                  <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-500 border border-blue-500/20 font-mono text-[10px]">
                                    {item.invoice_no || 'N/A'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-muted gap-3">
                    <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                      <History size={28} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-text">Select a Return Claim</h3>
                      <p className="text-xs text-muted mt-1 max-w-sm">
                        Choose any finalized supplier return from the left list to review returned medicines, batches, quantities, reprint debit notes, or edit.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ────────────────────────────────────────────────────────────── */
        /* Tab 5: SUPPLIER RETURNS — DISTRIBUTOR-CENTRIC BILL WORKSPACE   */
        /* ────────────────────────────────────────────────────────────── */
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden text-text gap-3">
          
          {/* Top Tabs Bar: Distributor Return Bills (Purchases Pattern) */}
          <div className="bg-bg2/90 backdrop-blur-md border border-border/80 rounded-2xl p-2 shadow-sm shrink-0 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 overflow-x-auto flex-1 min-w-0 scrollbar-thin py-0.5">
              {bills.map((b) => {
                const isActive = b.id === activeBillId;
                const expCount = b.expired_items.filter(i => i.selected).length;
                const manCount = b.manual_items.filter(i => (i.medicine_name || i.medicine_id) && numOr0(i.quantity) > 0).length;
                const count = expCount + manCount;
                const displayName = b.distributor_name && b.distributor_name.trim() ? b.distributor_name : 'New Return Bill';

                return (
                  <div
                    key={b.id}
                    onClick={() => setActiveBillId(b.id)}
                    className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl border font-bold text-xs transition-all select-none cursor-pointer flex-shrink-0 whitespace-nowrap ${
                      isActive 
                        ? 'bg-primary/15 border-primary text-primary shadow-sm ring-1 ring-primary/30' 
                        : 'bg-bg3/50 border-border/60 text-muted hover:text-text hover:bg-bg3'
                    }`}
                  >
                    <Building2 size={13} className={isActive ? 'text-primary' : 'text-muted'} />
                    <span>{displayName}</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-extrabold ${isActive ? 'bg-primary/20 text-primary' : 'bg-bg/60 text-muted'}`}>
                      {count}
                    </span>
                    {bills.length > 1 && (
                      <span 
                        onClick={(e) => { e.stopPropagation(); closeBillTab(b.id); }}
                        className="hover:bg-red/10 hover:text-red rounded-full p-0.5 ml-0.5 transition-all cursor-pointer flex items-center justify-center text-muted"
                        title="Close Return Bill"
                      >
                        <X size={11} />
                      </span>
                    )}
                  </div>
                );
              })}
              <button
                onClick={() => addNewBill()}
                className="flex items-center justify-center flex-shrink-0 px-3 py-1.5 rounded-xl border border-dashed border-primary/40 text-primary hover:bg-primary/10 transition-all bg-primary/5 active:scale-95 text-xs font-bold gap-1 cursor-pointer"
                title="Add New Distributor Return Bill"
              >
                <Plus size={13} />
                <span>New Bill</span>
              </button>
            </div>
          </div>

          {/* Quick Distributor Overview Strip: shows bills and near-expiry opportunities */}
          <div className="bg-bg2/60 backdrop-blur-md border border-border/70 rounded-2xl px-4 py-2 flex items-center gap-2.5 overflow-x-auto scrollbar-none shrink-0 shadow-inner">
            <span className="text-[10px] font-black text-muted uppercase tracking-wider shrink-0 flex items-center gap-1.5">
              <Building2 size={13} className="text-primary" />
              <span>Distributor Hub:</span>
            </span>
            {bills.filter(b => b.distributor_name).map(b => {
              const expCount = b.expired_items.filter(i => i.selected).length;
              const manCount = b.manual_items.filter(i => numOr0(i.quantity) > 0 && i.medicine_name).length;
              const totalCount = expCount + manCount;
              const isCur = b.id === activeBillId;
              return (
                <button
                  key={b.id}
                  onClick={() => setActiveBillId(b.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all shrink-0 cursor-pointer ${
                    isCur
                      ? 'bg-primary text-white border-primary shadow-sm font-bold'
                      : 'bg-bg3/60 border-border/60 text-text hover:bg-bg3 font-medium'
                  }`}
                >
                  <span className="font-semibold">{b.distributor_name}</span>
                  <span className={`text-[10px] font-mono px-1 rounded ${isCur ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary'}`}>
                    {totalCount} items
                  </span>
                </button>
              );
            })}
            {nearExpiryData
              .filter(g => g.distributor_name && !bills.some(b => b.distributor_name && b.distributor_name.toLowerCase() === g.distributor_name.toLowerCase()))
              .map(g => (
                <button
                  key={g.distributor_id || g.distributor_name}
                  onClick={() => addNewBill({ id: g.distributor_id || undefined, name: g.distributor_name })}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-dashed border-amber-500/40 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition-all shrink-0 cursor-pointer text-xs font-semibold"
                  title="Open return bill with near-expiry stock"
                >
                  <Plus size={11} />
                  <span>{g.distributor_name} ({g.items.length} expired)</span>
                </button>
              ))
            }
          </div>

          {/* Active Return Bill Sheet */}
          <div className="flex-1 flex flex-col min-h-0 bg-bg2/90 backdrop-blur-md border border-border/80 rounded-2xl overflow-hidden shadow-sm">
            
            {/* Bill Header: Distributor Info & Search */}
            <div className="p-4 pb-3 border-b border-border/60 bg-bg3/20 shrink-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                
                {/* Distributor Field */}
                <div className="flex-1 min-w-[280px] max-w-md relative" ref={distributorDropdownRef}>
                  <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-1">
                    Distributor / Supplier <span className="text-red font-bold">*</span>
                  </label>
                  <div className="relative">
                    <Building2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                      type="text"
                      placeholder="Search and select distributor..."
                      value={activeBill.distributor_name || distributorSearchText}
                      onChange={(e) => {
                        setDistributorSearchText(e.target.value);
                        updateActiveBill({ distributor_name: e.target.value, distributor_id: null });
                        setShowDistDropdown(e.target.value.trim().length >= 1);
                      }}
                      onFocus={() => {
                        if (!activeBill.distributor_name) setShowDistDropdown(true);
                      }}
                      className="w-full pl-9 pr-8 py-2 bg-bg3 border border-border/70 rounded-xl text-xs text-text font-bold focus:outline-none focus:border-primary transition-all"
                    />
                    {(activeBill.distributor_name || distributorSearchText) && (
                      <button
                        onClick={() => {
                          updateActiveBill({ distributor_name: '', distributor_id: null, expired_items: [] });
                          setDistributorSearchText('');
                          setShowDistDropdown(true);
                        }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text p-0.5 rounded-full"
                        title="Change distributor"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>

                  {/* Distributor Autocomplete Dropdown */}
                  {showDistDropdown && (
                    <div className="absolute z-dropdown w-full mt-1 bg-bg2 border border-border rounded-xl shadow-2xl max-h-60 overflow-y-auto">
                      <div className="p-2 border-b border-border/40 text-[10px] font-bold text-muted uppercase tracking-wider bg-bg3/40">
                        Select Distributor ({filteredMasterDistributors.length} found)
                      </div>
                      {filteredMasterDistributors.length === 0 ? (
                        <div className="p-3 text-xs text-muted italic">
                          No registered distributor found. Type name to use as custom distributor.
                        </div>
                      ) : (
                        filteredMasterDistributors.map((d) => {
                          const distName = d.name || 'Unnamed';
                          const hasExpiredCount = nearExpiryData.find(g => 
                            (d.id && g.distributor_id === d.id) || 
                            (g.distributor_name && g.distributor_name.toLowerCase() === distName.toLowerCase())
                          )?.items?.length || 0;

                          return (
                            <button
                              key={d.id || distName}
                              type="button"
                              onClick={() => {
                                updateActiveBill({ distributor_id: d.id || null, distributor_name: distName });
                                setDistributorSearchText('');
                                setShowDistDropdown(false);
                              }}
                              className="w-full text-left px-3.5 py-2 hover:bg-bg3 border-b border-border/30 last:border-0 flex items-center justify-between text-xs text-text cursor-pointer transition-colors"
                            >
                              <span className="font-bold">{distName}</span>
                              {hasExpiredCount > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 border border-amber-500/20 font-bold font-mono">
                                  {hasExpiredCount} expired in stock
                                </span>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>

                {/* Optional Invoice Ref, Date & Return Category Selector */}
                <div className="flex flex-wrap items-center gap-3">
                  <div>
                    <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-1">
                      Purchase Bill Invoice #
                    </label>
                    <input
                      type="text"
                      placeholder="Distributor's Bill # (e.g. INV-9021)"
                      value={activeBill.invoice_no || ''}
                      onChange={e => updateActiveBill({ invoice_no: e.target.value })}
                      className="px-3 py-2 bg-bg3 border border-border/70 rounded-xl text-xs text-text font-mono focus:outline-none focus:border-primary"
                      title="Distributor's printed tax invoice number from the purchase bill"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-1">
                      Return Date
                    </label>
                    <input
                      type="date"
                      value={toDateInputValue(activeBill.date || getTodayString())}
                      onChange={e => updateActiveBill({ date: e.target.value })}
                      className="px-3 py-2 bg-bg3 border border-border/70 rounded-xl text-xs text-text font-mono focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-1">
                      Return Category
                    </label>
                    <div className="flex items-center gap-1 bg-bg3 p-1 rounded-xl border border-border/70">
                      <button
                        type="button"
                        onClick={() => {
                          updateActiveBill({ return_sub_type: 'good', loss_percentage: 0 });
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                          activeBill.return_sub_type === 'good' || (!activeBill.return_sub_type && selectedExpiredItems.length === 0)
                            ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/40 shadow-xs'
                            : 'text-muted hover:text-text'
                        }`}
                        title="Wrong product delivered or saleable non-expired stock (100% full credit refund, 0% deduction)"
                      >
                        <span>🟢 Goods Return</span>
                        <span className="text-[9px] px-1 rounded bg-emerald-500/20 font-mono font-extrabold">0% Loss</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          updateActiveBill({ return_sub_type: 'expiry' });
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                          activeBill.return_sub_type === 'expiry' || (!activeBill.return_sub_type && selectedExpiredItems.length > 0)
                            ? 'bg-red-500/20 text-red-500 border border-red-500/40 shadow-xs'
                            : 'text-muted hover:text-text'
                        }`}
                        title="Near-expiry or expired medicine claim (deduction loss % applies)"
                      >
                        <span>🔴 Expiry Return</span>
                      </button>
                    </div>
                  </div>
                </div>

              </div>
            </div>

            {/* Scrollable Body Containing Both Sections */}
            <div className="flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar">

              {/* ──────────────────────────────────────────────────────────── */}
              {/* SECTION 1: 🔴 EXPIRED & NEAR-EXPIRY PRODUCTS RETURN          */}
              {/* ──────────────────────────────────────────────────────────── */}
              <div className="bg-bg/40 border border-border/70 rounded-2xl overflow-hidden shadow-sm">
                
                {/* Section 1 Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-red-500/5 border-b border-border/60">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-red-500/10 text-red-500 border border-red-500/20">
                      <ShieldAlert size={16} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-xs font-black uppercase tracking-wider text-text">
                          Section 1: Expired & Near-Expiry Products (Inventory Stock)
                        </h3>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 border border-red-500/20 font-mono">
                          {selectedExpiredItems.length} / {activeBill.expired_items.length} Selected
                        </span>
                      </div>
                      <p className="text-[10px] text-muted font-medium mt-0.5">
                        Batches currently in stock from this distributor nearing or past expiry date. Toggle items to return.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-muted">
                      Expired Subtotal: <strong className="text-emerald-500 font-mono font-extrabold">₹{expiredSubtotal.toFixed(2)}</strong>
                    </span>
                    {activeBill.expired_items.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => selectAllExpired(true)}
                          className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-bg2 border border-border/60 hover:bg-bg3 text-text cursor-pointer transition-colors"
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          onClick={() => selectAllExpired(false)}
                          className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-bg2 border border-border/60 hover:bg-bg3 text-muted hover:text-text cursor-pointer transition-colors"
                        >
                          Deselect All
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Section 1 Table */}
                {activeBill.expired_items.length === 0 ? (
                  <div className="p-6 text-center text-muted text-xs font-medium italic flex flex-col items-center justify-center gap-1.5">
                    <CheckCircle2 size={22} className="text-emerald-500/60" />
                    <span>No near-expiry or expired batches found in active inventory for this distributor.</span>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[720px]">
                      <thead className="bg-bg2/80 border-b border-border/60 text-muted text-[11px] font-bold">
                        <tr>
                          <th className="p-2.5 w-10 text-center">Select</th>
                          <th className="p-2.5 min-w-[200px]">Medicine Name</th>
                          <th className="p-2.5 w-24">Batch</th>
                          <th className="p-2.5 w-28">Expiry</th>
                          <th className="p-2.5 w-28 text-center" title="Distributor's Purchase Bill Invoice Number">Purchase Bill Inv #</th>
                          <th className="p-2.5 w-20 text-center">In Stock</th>
                          <th className="p-2.5 w-28 text-center">Return Qty</th>
                          <th className="p-2.5 w-24 text-right">Cost Price</th>
                          <th className="p-2.5 w-28 text-right">Claim Total</th>
                          <th className="p-2.5 w-10 text-center"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeBill.expired_items.map((it, idx) => {
                          const isSel = it.selected;
                          const urgency = getExpiryUrgencyStatus(it.expiry_date);
                          const lineTotal = numOr0(it.cost_price) * numOr0(it.quantity);

                          return (
                            <tr
                              key={`${it.medicine_id}_${it.batch_no}_${idx}`}
                              className={`border-b border-border/30 text-xs transition-colors ${
                                isSel ? 'bg-primary/5 hover:bg-primary/10' : 'opacity-60 hover:opacity-100 hover:bg-bg3/20'
                              }`}
                            >
                              <td className="p-2.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => toggleExpiredItem(idx)}
                                  className="cursor-pointer text-primary focus:outline-none"
                                >
                                  {isSel ? (
                                    <CheckCircle2 size={16} className="text-primary fill-primary/20" />
                                  ) : (
                                    <Square size={16} className="text-muted" />
                                  )}
                                </button>
                              </td>
                              <td className="p-2.5 font-bold text-text">{it.medicine_name}</td>
                              <td className="p-2.5 font-mono text-muted text-xs">{it.batch_no || '—'}</td>
                              <td className="p-2.5 font-mono text-xs">
                                <div className="flex items-center gap-1.5">
                                  <span>{it.expiry_date || '—'}</span>
                                  {urgency && (
                                    <span className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded border font-mono ${urgency.className}`}>
                                      {urgency.label}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="p-2.5 text-center font-mono text-xs">
                                {it.invoice_no && it.invoice_no !== 'N/A' ? (
                                  <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-500 border border-blue-500/20 font-mono text-[10px] font-bold" title="Their Purchase Bill Invoice Number">
                                    {it.invoice_no}
                                  </span>
                                ) : (
                                  <span className="text-muted text-[10px]">—</span>
                                )}
                              </td>
                              <td className="p-2.5 text-center font-mono font-bold text-muted">{it.available_stock}</td>
                              <td className="p-2 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const cur = numOr0(it.quantity);
                                      if (cur > 1) updateExpiredItemQty(idx, cur - 1);
                                    }}
                                    className="w-6 h-6 rounded bg-bg3 border border-border/60 text-muted hover:text-text font-bold text-xs flex items-center justify-center cursor-pointer"
                                  >
                                    -
                                  </button>
                                  <input
                                    type="number"
                                    min="1"
                                    max={it.available_stock}
                                    value={it.quantity}
                                    onChange={e => updateExpiredItemQty(idx, e.target.value)}
                                    className="w-14 bg-bg3 border border-border/60 rounded px-1 py-0.5 text-text font-mono text-xs text-center focus:outline-none focus:ring-1 focus:ring-primary"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const cur = numOr0(it.quantity);
                                      if (cur < it.available_stock) updateExpiredItemQty(idx, cur + 1);
                                    }}
                                    className="w-6 h-6 rounded bg-bg3 border border-border/60 text-muted hover:text-text font-bold text-xs flex items-center justify-center cursor-pointer"
                                  >
                                    +
                                  </button>
                                </div>
                              </td>
                              <td className="p-2.5 text-right font-mono text-muted text-xs">
                                ₹{numOr0(it.cost_price).toFixed(2)}
                              </td>
                              <td className="p-2.5 text-right font-mono font-extrabold text-xs text-text">
                                ₹{lineTotal.toFixed(2)}
                              </td>
                              <td className="p-2.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => removeExpiredItem(idx)}
                                  className="text-muted hover:text-red p-1 rounded cursor-pointer transition-colors"
                                  title="Dismiss from list"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* ──────────────────────────────────────────────────────────── */}
              {/* SECTION 2: 🟢 GOODS & OTHER RETURNS (WRONG / NON-EXPIRED)     */}
              {/* ──────────────────────────────────────────────────────────── */}
              <div className="bg-bg/40 border border-border/70 rounded-2xl overflow-hidden shadow-sm">
                
                {/* Section 2 Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-emerald-500/5 border-b border-border/60">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                      <Layers size={16} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-xs font-black uppercase tracking-wider text-text">
                          Section 2: Goods & Other Returns (Wrong Product, Non-Expired, Excess, Breakage)
                        </h3>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-mono">
                          {validManualItems.length} Products
                        </span>
                      </div>
                      <p className="text-[10px] text-muted font-medium mt-0.5">
                        Return wrong products delivered by supplier or saleable non-expired stock with 0% loss deduction. Search purchase history to auto-fill details.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-muted">
                      Goods Subtotal: <strong className="text-emerald-500 font-mono font-extrabold">₹{manualSubtotal.toFixed(2)}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={addManualItem}
                      className="bg-primary hover:bg-primary/95 text-white font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-sm active:scale-95 cursor-pointer"
                    >
                      <Plus size={13} />
                      <span>Add Medicine Row</span>
                    </button>
                  </div>
                </div>

                {/* Section 2 Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[800px]">
                    <thead className="bg-bg2/80 border-b border-border/60 text-muted text-[11px] font-bold">
                      <tr>
                        <th className="p-2.5 w-8 text-center">#</th>
                        <th className="p-2.5 min-w-[200px]">Medicine Name (Search Purchase History)</th>
                        <th className="p-2.5 w-24">Batch No</th>
                        <th className="p-2.5 w-24">Expiry</th>
                        <th className="p-2.5 w-24 text-center" title="Distributor's Purchase Bill Invoice Number">Purchase Bill Inv #</th>
                        <th className="p-2.5 min-w-[170px]">Return Reason / Type</th>
                        <th className="p-2.5 w-24 text-center">Qty</th>
                        <th className="p-2.5 w-20 text-right">Cost Price</th>
                        <th className="p-2.5 w-24 text-right">Claim Total</th>
                        <th className="p-2.5 w-8 text-center"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeBill.manual_items.map((item, originalIndex) => {
                        const lineTotal = numOr0(item.cost_price) * numOr0(item.quantity);
                        const urgency = getExpiryUrgencyStatus(item.expiry_date);

                        return (
                          <tr key={item.id} className="border-b border-border/30 hover:bg-bg3/30 transition-colors text-xs">
                            <td className="p-2.5 text-center font-mono text-muted text-[10px]">{originalIndex + 1}</td>

                            {/* Medicine Search */}
                            <td className="p-2">
                              <div ref={activeSearchIndex === originalIndex ? activeSearchRef : null} className="relative">
                                <div className="flex gap-1 items-center">
                                  <input
                                    type="text"
                                    value={item.medicine_name}
                                    onChange={(e) => {
                                      updateManualItem(originalIndex, 'medicine_name', e.target.value);
                                      searchMedicines(e.target.value, originalIndex);
                                    }}
                                    className="w-full bg-bg3 border border-border/60 rounded-lg px-2.5 py-1.5 text-text font-bold text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                                    placeholder="Type 2+ chars to search..."
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCameraTargetIndex(originalIndex);
                                      setShowCamera(true);
                                    }}
                                    className="bg-sky/15 hover:bg-sky/30 border border-sky/30 text-sky w-7 h-7 rounded-lg text-xs flex-shrink-0 flex items-center justify-center transition-all cursor-pointer"
                                    title="Scan drug package using AI Camera"
                                  >
                                    <Camera size={13} />
                                  </button>
                                </div>
                                {activeSearchIndex === originalIndex && (
                                  <div ref={searchResultsRef} className="absolute z-dropdown w-full mt-1 bg-bg2 border border-border rounded-xl shadow-xl max-h-60 overflow-y-auto">
                                    {searchResults.length > 0 ? (
                                      <>
                                        {activeBill.distributor_name && (
                                          <div className="px-3 py-1.5 bg-primary/10 border-b border-border/40 text-[10px] font-bold text-primary flex items-center gap-1.5">
                                            <CheckCircle2 size={11} />
                                            <span>Purchased from {activeBill.distributor_name}</span>
                                          </div>
                                        )}
                                        {searchResults.map((result, idx) => (
                                          <button
                                            key={result.purchase_item_id || idx}
                                            type="button"
                                            data-highlighted={idx === searchHighlightIndex ? "true" : "false"}
                                            onClick={() => selectMedicineForManualItem(result, originalIndex)}
                                            className={`w-full text-left px-3 py-2 hover:bg-bg3 text-text text-xs border-b border-border/30 last:border-0 cursor-pointer transition-colors ${
                                              idx === searchHighlightIndex ? 'bg-primary/10 border-l-4 border-primary' : ''
                                            }`}
                                          >
                                            <div className="font-bold text-text">{result.medicine_name}</div>
                                            <div className="text-[10px] text-muted font-mono mt-0.5 flex items-center gap-1.5 flex-wrap">
                                              <span>Batch: <strong className="text-text">{result.batch_no}</strong></span>
                                              <span>| Cost: ₹{result.cost_price}</span>
                                              {(result.invoice_no || result.app_invoice_no) && (
                                                <span className="px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-500 border border-blue-500/20 font-bold">
                                                  Bill #: {result.invoice_no || 'N/A'}
                                                </span>
                                              )}
                                              <span>| {result.distributor_name}</span>
                                            </div>
                                          </button>
                                        ))}
                                      </>
                                    ) : otherDistributorMatches.length > 0 ? (
                                      <div className="space-y-1">
                                        <div className="px-3 py-2 bg-amber-500/10 border-b border-border/40 flex items-center justify-between gap-2 flex-wrap">
                                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-amber-500">
                                            <AlertTriangle size={12} />
                                            <span>
                                              {otherDistributorMatches[0].distributor_id ? (
                                                <>Purchased from <strong>{otherDistributorMatches[0].distributor_name}</strong> (Cross-Distributor Return)</>
                                              ) : (
                                                <>Store Stock (No purchase invoice found in app)</>
                                              )}
                                            </span>
                                          </div>
                                          {otherDistributorMatches[0].distributor_id && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                const otherDist = otherDistributorMatches[0];
                                                const existingTab = bills.find(b => 
                                                  (otherDist.distributor_id && b.distributor_id === otherDist.distributor_id) ||
                                                  (b.distributor_name && b.distributor_name.toLowerCase() === (otherDist.distributor_name || '').toLowerCase())
                                                );
                                                if (existingTab) {
                                                  setActiveBillId(existingTab.id);
                                                } else {
                                                  addNewBill({ id: otherDist.distributor_id || undefined, name: otherDist.distributor_name || 'Distributor' });
                                                }
                                                setActiveSearchIndex(null);
                                                setOtherDistributorMatches([]);
                                              }}
                                              className="text-[10px] font-bold text-amber-600 hover:text-amber-500 underline cursor-pointer"
                                            >
                                              Or switch to {otherDistributorMatches[0].distributor_name} Bill
                                            </button>
                                          )}
                                        </div>
                                        {otherDistributorMatches.map((result, idx) => (
                                          <button
                                            key={result.purchase_item_id || idx}
                                            type="button"
                                            data-highlighted={idx === searchHighlightIndex ? "true" : "false"}
                                            onClick={() => selectMedicineForManualItem(result, originalIndex)}
                                            className={`w-full text-left px-3 py-2 hover:bg-bg3 text-text text-xs border-b border-border/30 last:border-0 cursor-pointer transition-colors ${
                                              idx === searchHighlightIndex ? 'bg-primary/10 border-l-4 border-primary' : ''
                                            }`}
                                          >
                                            <div className="flex items-center justify-between gap-1">
                                              <span className="font-bold text-text">{result.medicine_name}</span>
                                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-500 border border-amber-500/30 font-semibold shrink-0">
                                                {result.distributor_id ? 'Cross-Return' : 'Store Stock'}
                                              </span>
                                            </div>
                                            <div className="text-[10px] text-muted font-mono mt-0.5 flex items-center gap-1.5 flex-wrap">
                                              <span>Batch: <strong className="text-text">{result.batch_no || '—'}</strong></span>
                                              <span>| Exp: {result.expiry_date || '—'}</span>
                                              <span>| Cost: ₹{result.cost_price || 0}</span>
                                              {(result.invoice_no || result.app_invoice_no) ? (
                                                <span className="px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-500 border border-blue-500/20 font-bold">
                                                  Orig Bill #: {result.invoice_no || result.app_invoice_no}
                                                </span>
                                              ) : (
                                                <span className="px-1.5 py-0.2 rounded bg-bg3 text-muted border border-border/50 text-[9px]">
                                                  Invoice not in app
                                                </span>
                                              )}
                                              <span>| {result.distributor_name}</span>
                                            </div>
                                          </button>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="p-3 text-center text-xs text-muted italic">
                                        No records found for "{item.medicine_name}". You can type manual details directly into the row.
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>

                            {/* Batch */}
                            <td className="p-2">
                              <input
                                type="text"
                                value={item.batch_no}
                                onChange={(e) => updateManualItem(originalIndex, 'batch_no', e.target.value)}
                                className="w-full bg-bg3 border border-border/60 rounded-lg px-2 py-1.5 text-text font-mono text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                                placeholder="Batch"
                              />
                            </td>

                            {/* Expiry */}
                            <td className="p-2">
                              <div className="flex flex-col gap-1">
                                <input
                                  type="text"
                                  value={item.expiry_date}
                                  onChange={(e) => updateManualItem(originalIndex, 'expiry_date', e.target.value)}
                                  onBlur={(e) => updateManualItem(originalIndex, 'expiry_date', formatExpiryToMMYY(e.target.value))}
                                  className="w-full bg-bg3 border border-border/60 rounded-lg px-2 py-1.5 text-text font-mono text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                                  placeholder="MM/YY"
                                />
                                {urgency && (
                                  <span className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded border text-center font-mono ${urgency.className}`}>
                                    {urgency.label}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Purchase Bill Inv # */}
                            <td className="p-2">
                              <input
                                type="text"
                                value={item.invoice_no || ''}
                                onChange={(e) => updateManualItem(originalIndex, 'invoice_no', e.target.value)}
                                className="w-full bg-bg3 border border-border/60 rounded-lg px-2 py-1.5 text-text font-mono text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                                placeholder="Manual Bill # (optional)"
                                title="Distributor's Purchase Bill Invoice Number (or manual reference)"
                              />
                            </td>

                            {/* Return Reason & Type */}
                            <td className="p-2">
                              <div className="flex flex-col gap-1">
                                <select
                                  value={item.reason || 'Wrong Product Delivered'}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    const isExp = val === 'Near Expiry / Expired';
                                    updateManualItem(originalIndex, 'reason', val);
                                    updateManualItem(originalIndex, 'return_type', isExp ? 'expiry' : 'good');
                                    if (!isExp && selectedExpiredItems.length === 0) {
                                      updateActiveBill({ loss_percentage: 0, return_sub_type: 'good' });
                                    }
                                  }}
                                  className="w-full bg-bg3 border border-border/60 rounded-lg px-2 py-1.5 text-text text-xs font-semibold focus:ring-1 focus:ring-primary focus:outline-none"
                                >
                                  <option value="Wrong Product Delivered">📦 Wrong Product Delivered</option>
                                  <option value="Non-Expired / Excess Stock">✅ Non-Expired / Excess Stock</option>
                                  <option value="Damaged / Breakage">⚠️ Damaged / Breakage</option>
                                  <option value="Batch / MRP Mismatch">🏷️ Batch / MRP Mismatch</option>
                                  <option value="Near Expiry / Expired">⏳ Near Expiry / Expired</option>
                                  <option value="Other (Custom)">✏️ Other (Custom)</option>
                                </select>
                                {item.reason === 'Other (Custom)' && (
                                  <input
                                    type="text"
                                    placeholder="Type custom reason..."
                                    className="w-full bg-bg3 border border-border/60 rounded px-2 py-1 text-text text-[11px] font-medium focus:ring-1 focus:ring-primary focus:outline-none"
                                    onChange={(e) => {
                                      updateManualItem(originalIndex, 'reason', e.target.value);
                                    }}
                                  />
                                )}
                                <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border w-fit font-mono ${
                                  item.return_type === 'expiry' || item.reason === 'Near Expiry / Expired'
                                    ? 'bg-red-500/10 text-red-500 border-red-500/20'
                                    : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                                }`}>
                                  {item.return_type === 'expiry' || item.reason === 'Near Expiry / Expired' ? '🔴 Expiry Claim' : '🟢 Goods Return (0% Loss)'}
                                </span>
                              </div>
                            </td>

                            {/* Qty */}
                            <td className="p-2 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const current = numOr0(item.quantity);
                                    if (current > 0) updateManualItem(originalIndex, 'quantity', (current - 1).toString());
                                  }}
                                  className="w-6 h-6 rounded bg-bg3 border border-border/60 text-muted hover:text-text font-bold text-xs flex items-center justify-center cursor-pointer"
                                >
                                  -
                                </button>
                                <input
                                  type="number"
                                  min="0"
                                  value={item.quantity}
                                  onChange={(e) => updateManualItem(originalIndex, 'quantity', e.target.value)}
                                  className="w-14 bg-bg3 border border-border/60 rounded px-1 py-1 text-text font-mono text-xs text-center focus:ring-1 focus:ring-primary focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const current = numOr0(item.quantity);
                                    updateManualItem(originalIndex, 'quantity', (current + 1).toString());
                                  }}
                                  className="w-6 h-6 rounded bg-bg3 border border-border/60 text-muted hover:text-text font-bold text-xs flex items-center justify-center cursor-pointer"
                                >
                                  +
                                </button>
                              </div>
                            </td>

                            {/* Cost Price */}
                            <td className="p-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.cost_price}
                                onChange={(e) => updateManualItem(originalIndex, 'cost_price', e.target.value)}
                                className="w-full bg-bg3 border border-border/60 rounded-lg px-2 py-1 text-text font-mono text-xs text-right focus:ring-1 focus:ring-primary focus:outline-none"
                              />
                            </td>

                            {/* Total */}
                            <td className="p-2.5 text-text font-extrabold text-xs font-mono text-right">
                              ₹{lineTotal.toFixed(2)}
                            </td>

                            {/* Remove */}
                            <td className="p-2 text-center">
                              <button
                                type="button"
                                onClick={() => removeManualItem(originalIndex)}
                                className="text-red/80 hover:text-red p-1 hover:bg-red/10 rounded transition-all cursor-pointer"
                                title="Remove Row"
                              >
                                <Trash2 size={13} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="p-3 border-t border-border/40 bg-bg2/40 flex justify-between items-center">
                  <button
                    type="button"
                    onClick={addManualItem}
                    className="text-xs font-bold text-primary hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Plus size={13} /> Add another medicine row
                  </button>
                  <span className="text-xs text-muted font-medium">
                    Manual Subtotal: <strong className="text-emerald-500 font-mono">₹{manualSubtotal.toFixed(2)}</strong>
                  </span>
                </div>

              </div>

            </div>

            {/* Bottom Master Action Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-bg3/60 p-4 border-t border-border/70 shadow-sm shrink-0">
              
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                    Total Return Claim ({activeBill.distributor_name || 'Supplier'})
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xl font-black text-emerald-500 font-mono">
                      ₹{totalClaimAmount.toFixed(2)}
                    </span>
                    <span className="text-xs text-muted font-semibold">
                      ({totalClaimItemsCount} item{totalClaimItemsCount !== 1 ? 's' : ''} total: {selectedExpiredItems.length} expired, {validManualItems.length} other)
                    </span>
                  </div>
                </div>

                {/* Deduction Loss % Input */}
                <div className="flex items-center gap-2 bg-bg px-3 py-1.5 rounded-xl border border-border/70">
                  <span className="text-xs font-bold text-muted">
                    {activeBill.return_sub_type === 'good' || (selectedExpiredItems.length === 0 && validManualItems.length > 0) ? '🟢 Goods Return Loss:' : 'Deduction / Loss:'}
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={activeBill.loss_percentage}
                    onChange={e => updateActiveBill({ loss_percentage: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) })}
                    className="w-12 bg-bg3 border border-border/60 rounded px-1.5 py-0.5 text-xs text-center font-mono font-bold text-text focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <span className="text-xs font-bold text-muted">%</span>
                  {activeBill.loss_percentage === 0 && (
                    <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                      100% Full Credit
                    </span>
                  )}
                  <span className="text-xs text-muted">→ Net Credit: <strong className="text-emerald-500 font-mono font-bold">₹{netCreditExpected.toFixed(2)}</strong></span>
                </div>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={handleExportDistributorPDF}
                  disabled={totalClaimItemsCount === 0}
                  className="flex-1 sm:flex-none bg-purple-600/90 hover:bg-purple-600 text-white px-4 py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 active:scale-95 shadow-sm cursor-pointer"
                >
                  <FileText size={14} />
                  <span>Export PDF Statement</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowProcessConfirmModal(true)}
                  disabled={saving || totalClaimItemsCount === 0}
                  className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 active:scale-95 shadow-sm cursor-pointer"
                >
                  <RotateCcw size={14} />
                  <span>{saving ? 'Processing...' : 'Process Return for ' + (activeBill.distributor_name || 'Distributor')}</span>
                </button>
              </div>

            </div>

          </div>

        </div>
      )}

      {/* Process Return Confirmation Modal */}
      {showProcessConfirmModal && (
        <div className="fixed inset-0 z-modal bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                  <RotateCcw size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-text uppercase tracking-wider">Confirm Supplier Return</h3>
                  <p className="text-[11px] text-muted">{activeBill.distributor_name || 'Supplier Return'}</p>
                </div>
              </div>
              <button
                onClick={() => setShowProcessConfirmModal(false)}
                className="p-1 rounded-lg hover:bg-bg3 text-muted hover:text-text transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-2 bg-bg3/50 p-3.5 rounded-xl border border-border/60 text-xs">
              <div className="flex justify-between items-center text-muted">
                <span>Return Category:</span>
                {activeBill.return_sub_type === 'good' || (selectedExpiredItems.length === 0 && validManualItems.every(i => i.return_type !== 'expiry')) ? (
                  <span className="font-bold text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full text-[10px]">
                    🟢 Goods Return (Wrong / Non-Expired)
                  </span>
                ) : (
                  <span className="font-bold text-red-500 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full text-[10px]">
                    🔴 Expiry Return
                  </span>
                )}
              </div>
              <div className="flex justify-between text-muted">
                <span>Expired / Near-Expiry Items:</span>
                <span className="font-mono font-bold text-text">{selectedExpiredItems.length} items</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>Goods / Other Return Items:</span>
                <span className="font-mono font-bold text-text">{validManualItems.length} items</span>
              </div>
              <div className="flex justify-between text-muted border-t border-border/40 pt-2">
                <span>Gross Return Claim:</span>
                <span className="font-mono font-bold text-text">₹{totalClaimAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>Agreed Loss / Deduction:</span>
                <span className="font-mono font-bold text-amber-500">
                  {activeBill.loss_percentage}%
                  {activeBill.loss_percentage === 0 && ' (100% Full Credit Refund)'}
                </span>
              </div>
              <div className="flex justify-between border-t border-border/60 pt-2 text-sm font-extrabold text-text">
                <span>Expected Credit Note:</span>
                <span className="font-mono text-emerald-500">₹{netCreditExpected.toFixed(2)}</span>
              </div>
            </div>

            <p className="text-[11px] text-muted font-medium">
              Processing will deduct returned items from current inventory stock and record a debit note claim in Return History.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowProcessConfirmModal(false)}
                className="px-4 py-2 rounded-xl bg-bg3 border border-border text-text font-bold text-xs hover:bg-bg3/80 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmProcessReturn}
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs flex items-center gap-1.5 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                <span>{saving ? 'Processing...' : 'Confirm & Process Return'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Return History Confirmation Modal */}
      {deleteConfirmReturn && (
        <div className="fixed inset-0 z-modal bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-red-500/10 text-red-500 border border-red-500/20">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-text">Delete Return Record?</h3>
                <p className="text-xs text-muted">Claim #{deleteConfirmReturn.return_no}</p>
              </div>
            </div>
            <p className="text-xs text-muted">
              Are you sure you want to delete this finalized return? This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setDeleteConfirmReturn(null)}
                className="px-4 py-2 rounded-xl bg-bg3 border border-border text-text font-bold text-xs hover:bg-bg3/80 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDeleteReturn}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs cursor-pointer shadow-sm"
              >
                Delete Return
              </button>
            </div>
          </div>
        </div>
      )}

      {showCamera && (
        <Suspense fallback={null}>
          <AICamera 
            onClose={() => { setShowCamera(false); setCameraTargetIndex(null); }}
            onScanResult={handleCameraScanResult}
          />
        </Suspense>
      )}
    </div>
  );
};

export default Returns;
