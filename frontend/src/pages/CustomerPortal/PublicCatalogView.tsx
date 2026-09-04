import React, { useState, useEffect } from 'react';
import {
  Search, ShoppingCart, CheckCircle2, AlertCircle, RefreshCw,
  Plus, Minus, MessageSquare, MapPin, Pill, Activity, Heart,
  Wind, ShieldCheck, ChevronRight, Store as StoreIcon, ExternalLink,
  Eye, Camera, Layers, X, Sparkles
} from 'lucide-react';
import { api } from '../../services/api';

interface CatalogMedicine {
  id?: number;
  name: string;
  category: string;
  pack: string;
  composition: string;
  manufacturer: string;
  mrp: number;
  sell_price: number;
  stock_qty: number;
  in_stock: boolean;
  image_url: string | null;
  images: Record<string, any>;
  gallery?: Array<{ url: string; type: string; label: string; is_primary?: boolean }>;
}

interface PublicCatalogViewProps {
  stores: Array<{ id: number; name: string; address: string; phone: string }>;
  activeStoreId: number;
  onChangeStore: (id: number) => void;
  selectedItems: Record<string, { product: string; qty: number; price: number }>;
  onToggleItem: (name: string, price: number, defaultQty?: number) => void;
  onUpdateQuantity: (name: string, delta: number) => void;
  onOpenCartModal: () => void;
  onOpenLogin: () => void;
}

const CATEGORIES = [
  { key: 'all', label: 'All Refills (Diabetic, BP, Thyroid, TB)', icon: Activity, countKey: 'all' },
  { key: 'diabetic', label: 'Diabetic Care', icon: Pill, countKey: 'diabetic' },
  { key: 'bp_cardiac', label: 'Blood Pressure & Cardiac', icon: Heart, countKey: 'bp_cardiac' },
  { key: 'thyroid', label: 'Thyroid Care', icon: Activity, countKey: 'thyroid' },
  { key: 'tb', label: 'Tuberculosis (TB)', icon: ShieldCheck, countKey: 'tb' },
];

export const PublicCatalogView: React.FC<PublicCatalogViewProps> = ({
  stores,
  activeStoreId,
  onChangeStore,
  selectedItems,
  onToggleItem,
  onUpdateQuantity,
  onOpenCartModal,
  onOpenLogin
}) => {
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [medicines, setMedicines] = useState<CatalogMedicine[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});
  const [selectedAngleMap, setSelectedAngleMap] = useState<Record<string, string>>({});
  const [quickViewMed, setQuickViewMed] = useState<CatalogMedicine | null>(null);
  const [modalActiveImage, setModalActiveImage] = useState<string | null>(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Load category summary counts on mount
  useEffect(() => {
    api.getPublicCatalogSummary()
      .then(res => {
        if (res?.success && res.summary) {
          setSummary(res.summary);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch catalog medicines
  useEffect(() => {
    setLoading(true);
    api.getPublicCatalog({
      category: category === 'all' ? undefined : category,
      search: debouncedSearch || undefined,
      page,
      limit: 24
    })
      .then(res => {
        if (res?.success) {
          setMedicines(res.medicines || []);
          setTotalCount(res.total_count || 0);
          setTotalPages(res.total_pages || 1);
        }
      })
      .catch(err => {
        console.warn('[PublicCatalogView] Fetch error:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [category, debouncedSearch, page]);

  const activeStore = stores.find(s => s.id === activeStoreId) || stores[0];
  const selectedCount = Object.keys(selectedItems).length;
  const totalAmount = Object.values(selectedItems).reduce((sum, it) => sum + (it.price * it.qty), 0);

  const handleImageError = (medName: string) => {
    setImageErrors(prev => ({ ...prev, [medName]: true }));
  };

  const openWhatsAppOrder = (med: CatalogMedicine) => {
    const storePhone = activeStore?.phone ? activeStore.phone.replace(/\D/g, '') : '';
    const phoneToUse = storePhone.length === 10 ? `91${storePhone}` : storePhone;
    const msg = encodeURIComponent(
      `Hello ${activeStore?.name || 'Pharmacy'}, I would like to inquire/order:\n\n` +
      `*Medicine:* ${med.name}\n` +
      `*Pack:* ${med.pack}\n` +
      `*Price:* ₹${(med.sell_price || med.mrp || 0).toFixed(2)}\n\n` +
      `Please let me know when it is ready for collection!`
    );
    const waUrl = phoneToUse ? `https://wa.me/${phoneToUse}?text=${msg}` : `https://wa.me/?text=${msg}`;
    window.open(waUrl, '_blank');
  };

  return (
    <div className="space-y-6">
      {/* Hero Store Banner */}
      <div className="bg-bg2 border border-border rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Live Store Inventory Connected</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-text">
            {activeStore ? activeStore.name : 'Pune Pharmacy'} — Online Medicine & Refill Catalog
          </h1>
          <p className="text-xs sm:text-sm text-muted">
            Browse verified clinical medicines for Diabetes, Blood Pressure, Thyroid, and Tuberculosis (TB) with live counter availability.
          </p>
        </div>

        {/* Branch Selector */}
        <div className="w-full md:w-72 space-y-1 shrink-0">
          <label htmlFor="pickup-branch-select" className="text-[11px] font-bold text-muted uppercase tracking-wider flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 text-primary" />
            <span>Pickup Branch</span>
          </label>
          <select
            id="pickup-branch-select"
            aria-label="Pickup Branch"
            value={activeStoreId}
            onChange={e => onChangeStore(parseInt(e.target.value, 10))}
            className="w-full bg-bg border border-border rounded-xl px-3 py-2 text-xs sm:text-sm font-semibold text-text focus:outline-none focus:border-primary"
          >
            {stores.map(st => (
              <option key={st.id} value={st.id}>
                {st.name} {st.address ? `(${st.address})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Search & Category Filter Bar */}
      <div className="space-y-3">
        <div className="relative">
          <label htmlFor="portal-search-input" className="sr-only">Search medicines</label>
          <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            id="portal-search-input"
            aria-label="Search medicine name, salt or composition"
            type="text"
            placeholder="Search medicine name, salt / composition, or brand (e.g., Metformin, Telmisartan, Thyronorm, R-Cinex)..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-bg2 border border-border rounded-xl text-text placeholder:text-muted focus:outline-none focus:border-primary text-sm shadow-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search input"
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-text px-1.5 py-0.5 rounded bg-bg"
            >
              Clear
            </button>
          )}
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
          {CATEGORIES.map(cat => {
            const Icon = cat.icon;
            const count = summary[cat.countKey];
            const isSelected = category === cat.key;
            return (
              <button
                key={cat.key}
                onClick={() => {
                  setCategory(cat.key);
                  setPage(1);
                }}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all shrink-0 ${
                  isSelected
                    ? 'bg-primary text-white shadow-md'
                    : 'bg-bg2 hover:bg-bg3 border border-border text-text'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{cat.label}</span>
                {typeof count === 'number' && count > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                    isSelected ? 'bg-primary-hover text-white' : 'bg-bg text-muted'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Results Header */}
      <div className="flex items-center justify-between text-xs text-muted px-1">
        <span>
          Showing <strong>{medicines.length}</strong> of <strong>{totalCount}</strong> verified medicines
          {category !== 'all' && ` in ${CATEGORIES.find(c => c.key === category)?.label}`}
          {debouncedSearch && ` matching "${debouncedSearch}"`}
        </span>
        {totalPages > 1 && (
          <span>
            Page {page} of {totalPages}
          </span>
        )}
      </div>

      {/* Medicines Grid */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3 text-muted text-sm bg-bg2 border border-border rounded-2xl">
          <RefreshCw className="w-6 h-6 animate-spin text-primary" />
          <span>Searching live inventory & verified medicine photos...</span>
        </div>
      ) : medicines.length === 0 ? (
        <div className="py-16 text-center text-muted bg-bg2 border border-dashed border-border rounded-2xl p-6 space-y-2">
          <Pill className="w-8 h-8 mx-auto text-muted/60" />
          <p className="text-sm font-semibold text-text">No medicines found matching your criteria</p>
          <p className="text-xs">Try selecting a different clinical category or clearing your search query.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {medicines.map((med, idx) => {
            const gallery = (med.gallery && med.gallery.length > 0)
              ? med.gallery
              : (med.image_url ? [{ url: med.image_url, type: 'combined', label: 'Front & Back', is_primary: true }] : []);
            const activeImgUrl = selectedAngleMap[med.name] || med.image_url || (gallery[0]?.url ?? null);
            const hasCustomImage = activeImgUrl && !imageErrors[activeImgUrl] && !imageErrors[med.name];
            const currentAngle = gallery.find(g => g.url === activeImgUrl) || gallery[0];
            const selected = selectedItems[med.name];
            const hasDiscount = med.sell_price > 0 && med.mrp > 0 && med.sell_price < med.mrp;
            const discountPer = hasDiscount ? Math.round(((med.mrp - med.sell_price) / med.mrp) * 100) : 0;

            return (
              <div
                key={`${med.name}-${idx}`}
                className="bg-bg2 border border-border rounded-2xl overflow-hidden shadow-sm hover:shadow-md hover:border-primary/40 transition-all flex flex-col justify-between"
              >
                <div>
                  {/* Image Container with Multi-Angle View */}
                  <div className="relative w-full h-44 bg-bg border-b border-border flex items-center justify-center p-3 group overflow-hidden">
                    {hasCustomImage ? (
                      <img
                        src={activeImgUrl!}
                        alt={med.name}
                        onError={() => handleImageError(activeImgUrl!)}
                        className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-2 text-muted/40">
                        <Pill className="w-12 h-12" />
                        <span className="text-[10px] font-medium text-muted">Genuine Store Item</span>
                      </div>
                    )}

                    {/* Quick View Hover Overlay */}
                    <button
                      type="button"
                      onClick={() => {
                        setQuickViewMed(med);
                        setModalActiveImage(activeImgUrl);
                      }}
                      aria-label={`Inspect all product angles for ${med.name}`}
                      className="absolute inset-0 bg-bg3/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer z-10"
                      title="Inspect all product angles"
                    >
                      <span className="px-3 py-1.5 rounded-xl bg-bg/95 backdrop-blur-md border border-border text-xs font-bold text-text shadow-xl flex items-center gap-1.5 hover:scale-105 transition-transform">
                        <Eye size={13} className="text-sky" />
                        <span>Quick View ({gallery.length || 1})</span>
                      </span>
                    </button>

                    {/* Category & Current Angle Badges */}
                    <div className="absolute top-2 left-2 flex flex-col gap-1 z-10 pointer-events-none">
                      <span className="px-2 py-0.5 bg-bg2/90 backdrop-blur-sm border border-border text-[10px] font-bold text-text rounded-md shadow-xs">
                        {med.category}
                      </span>
                      {currentAngle && (
                        <span className="px-1.5 py-0.5 bg-sky/20 backdrop-blur-sm border border-sky/40 text-[9px] font-bold text-sky rounded-md shadow-xs flex items-center gap-1">
                          {currentAngle.is_primary && <span>⭐</span>}
                          <span>{currentAngle.label}</span>
                        </span>
                      )}
                    </div>

                    {/* Stock Status & Angle Count Badges */}
                    <div className="absolute top-2 right-2 flex flex-col items-end gap-1 z-10 pointer-events-none">
                      {med.in_stock ? (
                        <span className="px-2 py-0.5 bg-emerald-500/90 text-white text-[10px] font-bold rounded-md shadow-xs flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-100 animate-pulse" />
                          <span>In Stock ({med.stock_qty})</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-amber-500/90 text-white text-[10px] font-bold rounded-md shadow-xs">
                          Available on Request
                        </span>
                      )}
                      {gallery.length > 1 && (
                        <span className="px-1.5 py-0.5 bg-bg/90 backdrop-blur-sm border border-border text-[9px] font-bold text-text rounded-md shadow-xs flex items-center gap-1">
                          <Camera size={10} className="text-sky" />
                          <span>{gallery.length} Views</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 3-4 Angle Micro-Thumbnail Strip (shown when product has multiple angles) */}
                  {gallery.length > 1 && (
                    <div className="px-3 py-1.5 bg-bg border-b border-border flex items-center justify-between gap-1 overflow-x-auto">
                      <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                        {gallery.slice(0, 4).map((ang, aIdx) => {
                          const isAngleSelected = (activeImgUrl === ang.url);
                          return (
                            <button
                              key={`${ang.url}-${aIdx}`}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedAngleMap(prev => ({ ...prev, [med.name]: ang.url }));
                              }}
                              onMouseEnter={() => {
                                setSelectedAngleMap(prev => ({ ...prev, [med.name]: ang.url }));
                              }}
                              aria-label={`${med.name} ${ang.label} angle view`}
                              title={ang.label}
                              className={`relative w-8 h-8 rounded-lg overflow-hidden border p-0.5 transition-all cursor-pointer shrink-0 ${
                                isAngleSelected
                                  ? 'border-primary ring-2 ring-primary/40 bg-bg2 shadow-xs'
                                  : 'border-border/60 bg-bg hover:border-primary/50 opacity-70 hover:opacity-100'
                              }`}
                            >
                              <img
                                src={ang.url}
                                alt={ang.label}
                                className="w-full h-full object-contain"
                                onError={() => handleImageError(ang.url)}
                              />
                              {ang.is_primary && (
                                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 border border-bg shadow-xs" title="Primary 2-in-1" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setQuickViewMed(med);
                          setModalActiveImage(activeImgUrl);
                        }}
                        className="text-[10px] text-sky hover:underline font-bold shrink-0 flex items-center gap-0.5 cursor-pointer ml-1"
                      >
                        <span>{gallery.length} Views</span>
                        <ChevronRight size={11} />
                      </button>
                    </div>
                  )}

                  {/* Card Content */}
                  <div className="p-4 space-y-2">
                    <div>
                      <h3 className="text-sm font-bold text-text line-clamp-2 leading-snug" title={med.name}>
                        {med.name}
                      </h3>
                      {med.pack && (
                        <span className="text-[11px] text-muted font-medium block mt-0.5">
                          Pack: {med.pack}
                        </span>
                      )}
                    </div>

                    {med.composition && (
                      <p className="text-[11px] text-muted line-clamp-2 font-mono bg-bg px-2 py-1 rounded-md border border-border/50">
                        {med.composition}
                      </p>
                    )}

                    {med.manufacturer && (
                      <p className="text-[10px] text-muted font-semibold uppercase tracking-wider truncate">
                        By {med.manufacturer}
                      </p>
                    )}
                  </div>
                </div>

                {/* Pricing and Actions */}
                <div className="p-4 pt-0 border-t border-border/60 mt-2 space-y-3">
                  <div className="flex items-baseline justify-between pt-2">
                    <div>
                      {med.mrp > 0 || med.sell_price > 0 ? (
                        <div className="space-y-0.5">
                          {med.sell_price > 0 && hasDiscount ? (
                            <>
                              <div className="flex items-baseline gap-1.5">
                                <span className="text-base font-extrabold text-primary">
                                  ₹{med.sell_price.toFixed(2)}
                                </span>
                              </div>
                              <span className="text-xs text-muted">
                                MRP <span className="line-through">₹{med.mrp.toFixed(2)}</span>
                              </span>
                            </>
                          ) : (
                            <span className="text-base font-extrabold text-primary">
                              MRP ₹{(med.mrp > 0 ? med.mrp : med.sell_price).toFixed(2)}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs font-semibold text-muted">
                          Price on Request
                        </span>
                      )}
                    </div>

                    {hasDiscount && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-600 font-bold rounded">
                        {discountPer}% OFF
                      </span>
                    )}
                                  {/* Buttons */}
                  <div className="flex items-center gap-2">
                    {selected ? (
                      <div className="flex-1 flex items-center justify-between bg-primary/10 border border-primary/30 rounded-xl px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => onUpdateQuantity(med.name, -1)}
                          aria-label={`Decrease quantity for ${med.name}`}
                          className="w-7 h-7 rounded-lg bg-bg2 flex items-center justify-center text-text hover:bg-bg3"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-xs font-bold text-primary px-2">
                          Qty: {selected.qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => onUpdateQuantity(med.name, 1)}
                          aria-label={`Increase quantity for ${med.name}`}
                          className="w-7 h-7 rounded-lg bg-bg2 flex items-center justify-center text-text hover:bg-bg3"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onToggleItem(med.name, med.sell_price || med.mrp || 0)}
                        aria-label={`Add ${med.name} to refill`}
                        className="flex-1 py-2 bg-primary text-white rounded-xl text-xs font-bold hover:opacity-95 transition-all flex items-center justify-center gap-1.5 shadow-sm"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add to Refill</span>
                      </button>
                    )}

                    {/* WhatsApp Inquire / Order Button */}
                    <button
                      type="button"
                      onClick={() => openWhatsAppOrder(med)}
                      aria-label={`Order or inquire about ${med.name} on WhatsApp`}
                      title="Order or inquire on WhatsApp"
                      className="p-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 border border-emerald-500/30 rounded-xl transition-colors shrink-0"
                    >
                      <MessageSquare className="w-4 h-4" />
                    </button>
                  </div>
     </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-4">
          <button
            type="button"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            aria-label="Go to previous page"
            className="px-4 py-2 bg-bg2 border border-border rounded-xl text-xs font-semibold text-text disabled:opacity-40 hover:bg-bg3 transition-colors"
          >
            ← Previous
          </button>
          <span className="text-xs text-muted font-medium">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            aria-label="Go to next page"
            className="px-4 py-2 bg-bg2 border border-border rounded-xl text-xs font-semibold text-text disabled:opacity-40 hover:bg-bg3 transition-colors"
          >
            Next →
          </button>
        </div>
      )}

      {/* Floating Bottom Cart Bar */}
      {selectedCount > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-11/12 max-w-xl bg-bg2/95 backdrop-blur-md border border-primary/40 rounded-2xl p-3 sm:p-4 shadow-2xl flex items-center justify-between gap-4 animate-in slide-in-from-bottom-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center shrink-0">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs font-bold text-text block">
                {selectedCount} {selectedCount === 1 ? 'Medicine' : 'Medicines'} Selected
              </span>
              <span className="text-[11px] text-muted">
                Estimated Total: <strong className="text-primary">₹{totalAmount.toFixed(2)}</strong>
              </span>
            </div>
          </div>

          <button
            onClick={onOpenCartModal}
            className="px-5 py-2.5 bg-primary text-white font-bold text-xs rounded-xl shadow-md hover:opacity-95 transition-all flex items-center gap-1.5 shrink-0"
          >
            <span>Review & Order</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Multi-Angle Quick View Modal */}
      {quickViewMed && (
        <div
          className="fixed inset-0 z-50 bg-bg3/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setQuickViewMed(null)}
        >
          <div
            className="bg-bg2 border border-border rounded-3xl shadow-2xl max-w-3xl w-full overflow-hidden flex flex-col md:flex-row max-h-[90vh]"
            onClick={e => e.stopPropagation()}
          >
            {/* Left: Interactive Multi-Angle Gallery */}
            <div className="md:w-1/2 bg-bg border-b md:border-b-0 md:border-r border-border p-6 flex flex-col justify-between">
              {/* Main Angle Preview */}
              <div className="relative w-full h-64 sm:h-72 bg-bg3/30 rounded-2xl border border-border/80 p-4 flex items-center justify-center overflow-hidden">
                {modalActiveImage && !imageErrors[modalActiveImage] ? (
                  <img
                    src={modalActiveImage}
                    alt={quickViewMed.name}
                    className="max-h-full max-w-full object-contain drop-shadow-md transition-all duration-300"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 text-muted">
                    <Pill className="w-12 h-12 text-muted/50" />
                    <span className="text-xs font-semibold">Standard Pharma Packaging</span>
                  </div>
                )}

                {/* Angle Tag on Preview */}
                {(() => {
                  const modalGallery = (quickViewMed.gallery && quickViewMed.gallery.length > 0)
                    ? quickViewMed.gallery
                    : (quickViewMed.image_url ? [{ url: quickViewMed.image_url, type: 'combined', label: 'Front & Back', is_primary: true }] : []);
                  const curAngle = modalGallery.find(g => g.url === modalActiveImage) || modalGallery[0];
                  if (!curAngle) return null;
                  return (
                    <div className="absolute top-3 left-3 flex items-center gap-1.5">
                      <span className="px-2.5 py-1 rounded-lg bg-bg2/90 backdrop-blur-md border border-sky/40 text-sky text-[11px] font-bold shadow-md flex items-center gap-1">
                        {curAngle.is_primary && <span>⭐</span>}
                        <span>{curAngle.label}</span>
                      </span>
                    </div>
                  );
                })()}
              </div>

              {/* Angle Description Banner */}
              {(() => {
                const modalGallery = (quickViewMed.gallery && quickViewMed.gallery.length > 0)
                  ? quickViewMed.gallery
                  : (quickViewMed.image_url ? [{ url: quickViewMed.image_url, type: 'combined', label: 'Front & Back', is_primary: true }] : []);
                const curAngle = modalGallery.find(g => g.url === modalActiveImage) || modalGallery[0];
                const DESCRIPTIONS: Record<string, string> = {
                  combined: 'Dual-sided overview: Displays both front branding and reverse composition simultaneously.',
                  front: 'Front Face: Official packaging artwork showing trade name, dosage form & strength.',
                  back: 'Back / Blister View: Active chemical salts, manufacturing license, batch & expiry details.',
                  box: 'Packaging Carton: Outer 3D box view as received from verified pharmaceutical distributors.',
                  tablet: 'Dosage Form: Close-up inspection of actual physical tablet/capsule.'
                };
                return (
                  <div className="my-3 p-2.5 rounded-xl bg-bg3/60 border border-border text-[11px] text-muted">
                    <span className="font-bold text-text">Angle Guide: </span>
                    {DESCRIPTIONS[curAngle?.type || 'front'] || 'Verified authentic product photography.'}
                  </div>
                );
              })()}

              {/* 3-4 Angle Thumbnails Row */}
              {(() => {
                const modalGallery = (quickViewMed.gallery && quickViewMed.gallery.length > 0)
                  ? quickViewMed.gallery
                  : (quickViewMed.image_url ? [{ url: quickViewMed.image_url, type: 'combined', label: 'Front & Back', is_primary: true }] : []);
                if (modalGallery.length <= 1) return null;
                return (
                  <div className="pt-2 border-t border-border">
                    <span className="text-[10px] uppercase font-bold text-muted tracking-wider block mb-2">
                      Available Views ({modalGallery.length}):
                    </span>
                    <div className="flex items-center gap-2 overflow-x-auto pb-1">
                      {modalGallery.map((ang, idx) => {
                        const isSelected = (modalActiveImage === ang.url);
                        return (
                          <button
                            key={`${ang.url}-${idx}`}
                            type="button"
                            onClick={() => setModalActiveImage(ang.url)}
                            className={`p-1.5 rounded-xl border flex flex-col items-center gap-1 transition-all cursor-pointer ${
                              isSelected
                                ? 'border-primary ring-2 ring-primary/40 bg-primary/10 shadow-sm'
                                : 'border-border bg-bg hover:border-primary/40 opacity-70 hover:opacity-100'
                            }`}
                          >
                            <img
                              src={ang.url}
                              alt={ang.label}
                              className="w-12 h-12 object-contain rounded-lg"
                              onError={() => handleImageError(ang.url)}
                            />
                            <span className="text-[9px] font-bold text-text truncate max-w-[64px]">
                              {ang.type === 'combined' ? '⭐ Both' : ang.label.split(' ')[0]}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Right: Product Master Specs & Actions */}
            <div className="md:w-1/2 p-6 flex flex-col justify-between overflow-y-auto">
              <div className="space-y-4">
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="px-2 py-0.5 rounded-md bg-bg border border-border text-[10px] font-bold text-sky uppercase">
                      {quickViewMed.category}
                    </span>
                    <h2 className="text-lg sm:text-xl font-black text-text mt-1 leading-snug">
                      {quickViewMed.name}
                    </h2>
                    {quickViewMed.manufacturer && (
                      <p className="text-xs text-muted font-medium mt-0.5">
                        Mfg: <span className="text-text font-semibold">{quickViewMed.manufacturer}</span>
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setQuickViewMed(null)}
                    className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer"
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Salt Composition */}
                {quickViewMed.composition && (
                  <div className="p-3 rounded-xl bg-bg border border-border space-y-1">
                    <span className="text-[10px] font-bold uppercase text-muted tracking-wider block">
                      Active Composition / Salt
                    </span>
                    <p className="text-xs text-text font-mono font-medium leading-relaxed">
                      {quickViewMed.composition}
                    </p>
                  </div>
                )}

                {/* Specs Grid */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-bg border border-border">
                    <span className="text-[10px] text-muted block uppercase font-bold">Packaging</span>
                    <span className="font-semibold text-text">{quickViewMed.pack || 'Standard Strip'}</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-bg border border-border">
                    <span className="text-[10px] text-muted block uppercase font-bold">Availability</span>
                    <span className={`font-semibold ${quickViewMed.in_stock ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {quickViewMed.in_stock ? `In Stock (${quickViewMed.stock_qty})` : 'Order on Request'}
                    </span>
                  </div>
                </div>

                {/* Pricing Block */}
                <div className="p-3.5 rounded-xl bg-bg3/40 border border-border flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-muted uppercase font-bold block">Patient Price</span>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className="text-xl font-black text-primary">
                        ₹{quickViewMed.sell_price.toFixed(2)}
                      </span>
                      {quickViewMed.mrp > quickViewMed.sell_price && (
                        <span className="text-xs text-muted line-through">
                          ₹{quickViewMed.mrp.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                  {quickViewMed.mrp > quickViewMed.sell_price && (
                    <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold text-xs">
                      {Math.round(((quickViewMed.mrp - quickViewMed.sell_price) / quickViewMed.mrp) * 100)}% OFF
                    </span>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-4 border-t border-border mt-4 space-y-2">
                <button
                  onClick={() => {
                    onToggleItem(quickViewMed.name, quickViewMed.sell_price, 1);
                    setQuickViewMed(null);
                  }}
                  className="w-full py-3 rounded-xl bg-primary text-white font-bold text-xs shadow-lg hover:opacity-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <ShoppingCart size={16} />
                  <span>
                    {selectedItems[quickViewMed.name] ? 'Update in Refill Cart' : 'Add to Monthly Refill Cart'}
                  </span>
                </button>

                <button
                  onClick={() => {
                    openWhatsAppOrder(quickViewMed);
                    setQuickViewMed(null);
                  }}
                  className="w-full py-2.5 rounded-xl bg-bg hover:bg-bg3 border border-border text-text font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer text-center"
                >
                  <MessageSquare size={15} className="text-emerald-500" />
                  <span>Inquire / Order via WhatsApp</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
