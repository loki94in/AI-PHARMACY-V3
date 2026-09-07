import React, { useState, useEffect, useRef } from 'react';
import {
  Globe, Search, RefreshCw, CheckCircle2, EyeOff, Image,
  Package, Zap, Filter, ChevronLeft, ChevronRight, X, Sparkles
} from 'lucide-react';
import { toastEvent } from '../../services/events';

interface MedicineCatalogItem {
  id: number;
  name: string;
  generic_name?: string | null;
  manufacturer?: string | null;
  category?: string | null;
  mrp?: number | null;
  sell_price?: number | null;
  packaging?: string | null;
  is_portal_visible: number;
  is_website_visible: number;
  featured_rank: number;
  primary_image?: string | null;
  stock_qty: number;
}

interface CatalogVisibilityResponse {
  success: boolean;
  page: number;
  limit: number;
  total_count: number;
  total_pages: number;
  stats: {
    total_medicines: number;
    portal_enabled: number;
    with_image: number;
    in_stock: number;
  };
  medicines: MedicineCatalogItem[];
}

export default function OnlineCatalog() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'in_stock' | 'online' | 'offline' | 'with_image' | 'all'>('in_stock');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CatalogVisibilityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [publishInStockLoading, setPublishInStockLoading] = useState(false);

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = (query = search, activeFilter = filter, activePage = page) => {
    setLoading(true);
    const params = new URLSearchParams({
      search: query,
      filter: activeFilter,
      page: String(activePage),
      limit: '50'
    });

    fetch(`/api/customer-portal/admin/catalog-visibility?${params}`)
      .then(r => r.json())
      .then((res: CatalogVisibilityResponse) => {
        setData(res);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        toastEvent.trigger('Failed to load catalog visibility data', 'error');
      });
  };

  useEffect(() => {
    loadData(search, filter, page);
  }, [filter, page]);

  const handleSearchChange = (val: string) => {
    setSearch(val);
    setPage(1);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      loadData(val, filter, 1);
    }, 350);
  };

  const handleToggleSingle = async (item: MedicineCatalogItem) => {
    const newVal = !item.is_portal_visible;
    setTogglingId(item.id);

    try {
      const res = await fetch(`/api/customer-portal/admin/catalog-visibility/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_portal_visible: newVal, is_website_visible: newVal })
      });
      const result = await res.json();
      if (result.success) {
        setData(prev => prev ? {
          ...prev,
          medicines: prev.medicines.map(m =>
            m.id === item.id ? { ...m, is_portal_visible: newVal ? 1 : 0, is_website_visible: newVal ? 1 : 0 } : m
          ),
          stats: {
            ...prev.stats,
            portal_enabled: Math.max(0, prev.stats.portal_enabled + (newVal ? 1 : -1))
          }
        } : prev);
        toastEvent.trigger(
          newVal ? `"${item.name.trim()}" is now ONLINE` : `"${item.name.trim()}" is now OFFLINE`,
          'success'
        );
      }
    } catch {
      toastEvent.trigger('Failed to toggle medicine status', 'error');
    } finally {
      setTogglingId(null);
    }
  };

  const handleBulkToggle = async (isOnline: boolean) => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);

    try {
      const res = await fetch('/api/customer-portal/admin/catalog-visibility/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          medicine_ids: Array.from(selectedIds),
          is_portal_visible: isOnline,
          is_website_visible: isOnline
        })
      });
      const result = await res.json();
      if (result.success) {
        toastEvent.trigger(
          `${selectedIds.size} medicines set to ${isOnline ? 'ONLINE' : 'OFFLINE'}`,
          'success'
        );
        setSelectedIds(new Set());
        loadData(search, filter, page);
      }
    } catch {
      toastEvent.trigger('Failed to update selected medicines', 'error');
    } finally {
      setBulkLoading(false);
    }
  };

  const handlePublishAllInStock = async (isOnline: boolean) => {
    setPublishInStockLoading(true);
    try {
      const res = await fetch('/api/customer-portal/admin/catalog-visibility/publish-in-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_online: isOnline })
      });
      const result = await res.json();
      if (result.success) {
        toastEvent.trigger(
          isOnline
            ? 'All in-stock medicines are now ONLINE and available to patients!'
            : 'All in-stock medicines have been set OFFLINE',
          'success'
        );
        loadData(search, filter, page);
      }
    } catch {
      toastEvent.trigger('Failed to publish in-stock medicines', 'error');
    } finally {
      setPublishInStockLoading(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllPage = () => {
    if (!data?.medicines) return;
    if (selectedIds.size === data.medicines.length && data.medicines.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(data.medicines.map(m => m.id)));
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-bg text-text">
      {/* ── Top Header Panel ────────────────────────────────────────── */}
      <div className="p-4 sm:p-5 border-b border-border bg-bg2/80 shrink-0">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0 shadow-xs">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-black text-text tracking-tight flex items-center gap-2">
                  Online Store Catalog Manager
                </h1>
                <p className="text-xs text-muted mt-0.5">
                  Select which medicines go <strong className="text-emerald-500 font-bold">Online</strong> (visible to patients) or remain <strong className="text-muted font-bold">Offline</strong> (in-store only).
                </p>
              </div>
            </div>
          </div>

          {/* Quick Stats & Global Actions */}
          <div className="flex flex-wrap items-center gap-2.5">
            {data?.stats && (
              <div className="flex items-center gap-1.5 text-xs bg-bg3 border border-border p-1 rounded-xl">
                <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 font-bold">
                  🌐 {data.stats.portal_enabled.toLocaleString()} Online
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-primary/10 text-primary font-bold">
                  📦 {data.stats.in_stock.toLocaleString()} In Stock
                </span>
                <span className="px-2.5 py-1 rounded-lg text-muted">
                  🖼 {data.stats.with_image.toLocaleString()} Images
                </span>
              </div>
            )}

            <button
              disabled={publishInStockLoading}
              onClick={() => handlePublishAllInStock(true)}
              className="h-9 px-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
              title="Publish all active medicines with inventory stock > 0 to the online store"
            >
              {publishInStockLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              <span>⚡ Publish All In-Stock Online</span>
            </button>
          </div>
        </div>

        {/* ── Search & Filter Row ────────────────────────────────────── */}
        <div className="mt-4 flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
          <div className="relative flex-1 max-w-xl">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
            <input
              type="text"
              placeholder="Search medicine name, composition, manufacturer..."
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-bg3 border border-border rounded-xl text-sm text-text placeholder:text-muted focus:outline-none focus:border-primary/60 transition-all"
            />
            {search && (
              <button
                onClick={() => handleSearchChange('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Filter Chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            {([
              { key: 'in_stock', label: '📦 In Stock Only' },
              { key: 'online', label: '🌐 Online' },
              { key: 'offline', label: '📴 Offline' },
              { key: 'with_image', label: '🖼 With Image' },
              { key: 'all', label: 'All Catalog' }
            ] as const).map(f => (
              <button
                key={f.key}
                onClick={() => { setFilter(f.key); setPage(1); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                  filter === f.key
                    ? 'bg-primary text-white border-primary shadow-xs'
                    : 'bg-bg3 border-border text-muted hover:text-text hover:border-primary/30'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Bulk Actions Floating / Top Bar ──────────────────────────── */}
      {selectedIds.size > 0 && (
        <div className="px-5 py-2.5 bg-primary/10 border-b border-primary/30 flex items-center justify-between shrink-0 animate-in fade-in">
          <div className="flex items-center gap-3">
            <span className="text-xs font-black text-primary">
              {selectedIds.size} medicine{selectedIds.size > 1 ? 's' : ''} selected
            </span>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-muted hover:text-text underline cursor-pointer"
            >
              Clear
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              disabled={bulkLoading}
              onClick={() => handleBulkToggle(true)}
              className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer shadow-xs"
            >
              {bulkLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Globe className="w-3 h-3" />}
              <span>Make Online (Go Online)</span>
            </button>
            <button
              disabled={bulkLoading}
              onClick={() => handleBulkToggle(false)}
              className="px-3 py-1.5 bg-bg3 hover:bg-red-500/20 text-muted hover:text-red-400 border border-border rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
            >
              <EyeOff className="w-3 h-3" />
              <span>Make Offline (Go Offline)</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Main Medicines List Workspace ────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted gap-3">
            <RefreshCw className="w-8 h-8 animate-spin text-primary" />
            <span className="text-sm font-semibold">Loading catalog medicines...</span>
          </div>
        ) : data && data.medicines.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted text-center max-w-md mx-auto">
            <Package className="w-12 h-12 opacity-30 mb-3" />
            <h3 className="text-base font-bold text-text">No medicines found</h3>
            <p className="text-xs mt-1 text-muted">
              {filter === 'online'
                ? 'No medicines are currently published online. Switch to "In Stock Only" to pick medicines to publish.'
                : 'No medicines match the selected filter or search terms.'}
            </p>
            {filter !== 'in_stock' && (
              <button
                onClick={() => { setFilter('in_stock'); setPage(1); }}
                className="mt-4 px-4 py-2 bg-primary text-white rounded-xl text-xs font-bold hover:bg-primary/90 transition-all cursor-pointer"
              >
                View In-Stock Medicines
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Header select-all bar */}
            {data && data.medicines.length > 0 && (
              <div className="flex items-center justify-between px-3 py-1 text-xs text-muted">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === data.medicines.length && data.medicines.length > 0}
                    onChange={toggleSelectAllPage}
                    className="rounded border-border cursor-pointer w-4 h-4"
                  />
                  <span>Select all {data.medicines.length} on this page</span>
                </label>
                <span>Showing page {data.page} of {data.total_pages} ({data.total_count.toLocaleString()} medicines)</span>
              </div>
            )}

            {/* Medicine Rows */}
            {data?.medicines.map(med => {
              const cleanName = med.name.replace(/^\t+/, '').trim();
              const isOnline = !!med.is_portal_visible;
              const isSelected = selectedIds.has(med.id);
              const isBusy = togglingId === med.id;

              return (
                <div
                  key={med.id}
                  className={`flex items-center gap-3.5 p-3.5 rounded-xl border transition-all ${
                    isSelected
                      ? 'border-primary/60 bg-primary/5'
                      : isOnline
                        ? 'border-emerald-500/30 bg-emerald-500/[0.03] hover:border-emerald-500/50'
                        : 'border-border bg-bg2 hover:border-border/80'
                  }`}
                >
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(med.id)}
                    className="rounded border-border cursor-pointer w-4 h-4 shrink-0"
                  />

                  {/* Image Thumbnail */}
                  <div className="w-12 h-12 rounded-lg bg-bg3 border border-border shrink-0 flex items-center justify-center overflow-hidden">
                    {med.primary_image ? (
                      <img
                        src={med.primary_image}
                        alt={cleanName}
                        className="w-full h-full object-contain p-1"
                        loading="lazy"
                        onError={e => { (e.target as HTMLElement).style.display = 'none'; }}
                      />
                    ) : (
                      <Image className="w-5 h-5 text-muted/40" />
                    )}
                  </div>

                  {/* Medicine Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-text truncate">{cleanName}</span>
                      {med.stock_qty > 0 ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 font-bold shrink-0">
                          In Stock: {med.stock_qty}
                        </span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-bg3 border border-border text-muted font-medium shrink-0">
                          0 Stock
                        </span>
                      )}
                      {med.packaging && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg3 border border-border text-muted font-mono shrink-0">
                          {med.packaging}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted mt-1 flex-wrap">
                      {med.generic_name && (
                        <span className="truncate max-w-xs">{med.generic_name}</span>
                      )}
                      {med.manufacturer && (
                        <>
                          <span>•</span>
                          <span className="truncate max-w-[200px]">{med.manufacturer}</span>
                        </>
                      )}
                      {med.category && (
                        <>
                          <span>•</span>
                          <span>{med.category}</span>
                        </>
                      )}
                      {med.mrp != null && med.mrp > 0 && (
                        <>
                          <span>•</span>
                          <span className="font-mono font-bold text-text">MRP ₹{Number(med.mrp).toFixed(2)}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Online / Offline Toggle Button & Badge */}
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleToggleSingle(med)}
                      className={`relative w-12 h-6 rounded-full border transition-all cursor-pointer ${
                        isOnline
                          ? 'bg-emerald-500 border-emerald-600'
                          : 'bg-bg3 border-border hover:border-primary/40'
                      } ${isBusy ? 'opacity-50' : ''}`}
                      title={isOnline ? 'Currently ONLINE (visible on portal & website) — Click to take OFFLINE' : 'Currently OFFLINE (hidden from patients) — Click to take ONLINE'}
                    >
                      {isBusy ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin absolute top-1 left-1" style={{ color: '#ffffff' }} />
                      ) : (
                        <span
                          className={`absolute top-0.5 w-5 h-5 rounded-full shadow-xs transition-all ${
                            isOnline ? 'left-6' : 'left-0.5'
                          }`}
                          style={{ backgroundColor: '#ffffff' }}
                        />
                      )}
                    </button>

                    <span
                      className={`text-xs font-black tracking-wider w-16 text-right ${
                        isOnline ? 'text-emerald-500' : 'text-muted'
                      }`}
                    >
                      {isOnline ? 'ONLINE' : 'OFFLINE'}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Pagination Controls */}
            {data && data.total_pages > 1 && (
              <div className="flex items-center justify-between pt-4 pb-2 text-xs">
                <span className="text-muted">
                  Page <strong className="text-text">{data.page}</strong> of {data.total_pages}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    disabled={page <= 1 || loading}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    className="px-3 py-1.5 rounded-lg border border-border bg-bg2 hover:bg-bg3 text-text font-bold disabled:opacity-40 transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" /> Previous
                  </button>
                  <button
                    disabled={page >= data.total_pages || loading}
                    onClick={() => setPage(p => p + 1)}
                    className="px-3 py-1.5 rounded-lg border border-border bg-bg2 hover:bg-bg3 text-text font-bold disabled:opacity-40 transition-all flex items-center gap-1 cursor-pointer"
                  >
                    Next <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
