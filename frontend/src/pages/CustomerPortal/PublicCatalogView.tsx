import React, { useState, useEffect } from 'react';
import {
  Search, ShoppingCart, CheckCircle2, AlertCircle, RefreshCw,
  Plus, Minus, MessageSquare, MapPin, Pill, Activity, Heart,
  Wind, ShieldCheck, ChevronRight, Store as StoreIcon, ExternalLink,
  Eye, Camera, Layers, X, Sparkles, Trash2
} from 'lucide-react';
import { api } from '../../services/api';
import { PrescriptionUploadModal } from '../../components/PrescriptionUploadModal';

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
  onClearCart?: () => void;
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
  onClearCart,
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
  const [isPrescriptionModalOpen, setIsPrescriptionModalOpen] = useState(false);
  const [prescriptionPrefill, setPrescriptionPrefill] = useState('');

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const [configuredPharmacyName, setConfiguredPharmacyName] = useState<string>('');

  // Load configured pharmacy name on mount
  useEffect(() => {
    api.getSettings()
      .then((s: any) => {
        const name = s?.medical_name || s?.pharmacy_name || s?.shop_name || s?.store_name;
        if (name && name.trim() && name.trim().toLowerCase() !== 'main store') {
          setConfiguredPharmacyName(name.trim());
        }
      })
      .catch(() => {});
  }, []);

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
  const displayStoreName = (activeStore?.name && activeStore.name.toLowerCase() !== 'main store')
    ? activeStore.name
    : (configuredPharmacyName || 'AI Pharmacy');
  const selectedCount = Object.keys(selectedItems).length;
  const totalAmount = Object.values(selectedItems).reduce((sum, it) => sum + (it.price * it.qty), 0);

  const handleImageError = (medName: string) => {
    setImageErrors(prev => ({ ...prev, [medName]: true }));
  };

  const openWhatsAppOrder = (med: CatalogMedicine) => {
    const storePhone = activeStore?.phone ? activeStore.phone.replace(/\D/g, '') : '';
    const phoneToUse = storePhone.length === 10 ? `91${storePhone}` : storePhone;
    const msg = encodeURIComponent(
      `Hello ${displayStoreName}, I would like to inquire/order:\n\n` +
      `*Medicine:* ${med.name}\n` +
      `*Pack:* ${med.pack}\n` +
      `*Price:* ₹${(med.sell_price || med.mrp || 0).toFixed(2)}\n\n` +
      `Please let me know when it is ready for collection!`
    );
    const waUrl = phoneToUse ? `https://wa.me/${phoneToUse}?text=${msg}` : `https://wa.me/?text=${msg}`;
    window.open(waUrl, '_blank');
  };

  return (
    <div className="space-y-2.5">
      {/* Compact Store Banner (Redesigned & space-efficient) */}
      <div className="bg-bg2 border border-border rounded-xl px-3.5 py-2 sm:py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
            <StoreIcon className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0 flex items-center gap-2 flex-wrap">
            <h1 className="text-xs sm:text-sm font-bold text-text truncate">
              {displayStoreName}
            </h1>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 text-[10px] font-semibold shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Live Store Inventory</span>
            </span>
            <span className="hidden xl:inline text-[11px] text-muted">
              • Verified Chronic & Refill Medicines
            </span>
          </div>
        </div>

        {/* Actions & Compact Branch Selector */}
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          <button
            type="button"
            onClick={() => {
              setPrescriptionPrefill(debouncedSearch || '');
              setIsPrescriptionModalOpen(true);
            }}
            className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Upload Rx</span>
          </button>

          <div className="flex items-center gap-1 bg-bg border border-border rounded-lg px-2 py-1 shrink-0">
            <MapPin className="w-3 h-3 text-primary shrink-0" />
            <select
              id="pickup-branch-select"
              aria-label="Pickup Branch"
              value={activeStoreId}
              onChange={e => onChangeStore(parseInt(e.target.value, 10))}
              className="bg-transparent text-xs font-semibold text-text focus:outline-none cursor-pointer pr-1"
            >
              {stores.map(st => {
                const optName = (st.name && st.name.toLowerCase() !== 'main store')
                  ? st.name
                  : (configuredPharmacyName || 'Main Store');
                return (
                  <option key={st.id} value={st.id}>
                    {optName}
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      </div>

      {/* Compact Search & Category Row */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-2">
        <div className="relative w-full lg:w-80 xl:w-96 shrink-0">
          <label htmlFor="portal-search-input" className="sr-only">Search medicines</label>
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            id="portal-search-input"
            aria-label="Search medicine name, salt or composition"
            type="text"
            placeholder="Search medicine, salt or brand..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-8 py-1.5 bg-bg2 border border-border rounded-xl text-text placeholder:text-muted focus:outline-none focus:border-primary text-xs sm:text-sm shadow-xs"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search input"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted hover:text-text px-1 py-0.5 rounded bg-bg"
            >
              Clear
            </button>
          )}
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0 scrollbar-none flex-1">
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
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all shrink-0 ${
                  isSelected
                    ? 'bg-primary text-white shadow-xs'
                    : 'bg-bg2 hover:bg-bg3 border border-border text-text'
                }`}
              >
                <Icon className="w-3 h-3" />
                <span>{cat.label}</span>
                {typeof count === 'number' && count > 0 && (
                  <span className={`text-[9px] px-1 py-0.2 rounded-full font-bold ${
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
      <div className="flex items-center justify-between text-[11px] text-muted px-0.5">
        <span>
          Showing <strong>{medicines.length}</strong> of <strong>{totalCount}</strong> medicines
          {category !== 'all' && ` in ${CATEGORIES.find(c => c.key === category)?.label}`}
          {debouncedSearch && ` matching "${debouncedSearch}"`}
        </span>
        {totalPages > 1 && (
          <span>
            Page {page} of {totalPages}
          </span>
        )}
      </div>

      {/* Medicines Grid (4 columns on PC = exactly 8 medicines in 2 rows visible without scrolling!) */}
      {loading ? (
        <div className="py-16 flex flex-col items-center justify-center gap-2 text-muted text-xs bg-bg2 border border-border rounded-xl">
          <RefreshCw className="w-5 h-5 animate-spin text-primary" />
          <span>Searching inventory & medicine photos...</span>
        </div>
      ) : medicines.length === 0 ? (
        <div className="py-10 px-4 text-center bg-bg2 border border-dashed border-primary/40 rounded-2xl p-6 space-y-3 max-w-md mx-auto shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
            <Camera className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-bold text-text">
              {debouncedSearch ? `Couldn't find "${debouncedSearch}"?` : 'Looking for a specific medicine?'}
            </p>
            <p className="text-xs text-muted max-w-sm mx-auto leading-relaxed">
              Upload a prescription or box photo. Our pharmacist will check availability and reply directly on WhatsApp.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setPrescriptionPrefill(debouncedSearch || '');
              setIsPrescriptionModalOpen(true);
            }}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs transition-all inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Upload Prescription Photo</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
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
                className="bg-bg2 border border-border rounded-xl overflow-hidden shadow-2xs hover:shadow-md hover:border-primary/40 transition-all flex flex-col justify-between group"
              >
                <div>
                  {/* Image Container (Compact 112px height) */}
                  <div className="relative w-full h-28 bg-bg border-b border-border flex items-center justify-center p-2 group overflow-hidden">
                    {hasCustomImage ? (
                      <img
                        src={activeImgUrl!}
                        alt={med.name}
                        onError={() => handleImageError(activeImgUrl!)}
                        className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-200"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-1 text-muted/40">
                        <Pill className="w-8 h-8" />
                        <span className="text-[9px] font-medium text-muted">Genuine Item</span>
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
                      className="absolute inset-0 bg-bg3/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer z-10"
                      title="Inspect all product angles"
                    >
                      <span className="px-2 py-1 rounded-lg bg-bg/95 backdrop-blur-md border border-border text-[10px] font-bold text-text shadow-sm flex items-center gap-1 hover:scale-105 transition-transform">
                        <Eye size={11} className="text-sky" />
                        <span>Quick View</span>
                      </span>
                    </button>

                    {/* Category & Current Angle Badges */}
                    <div className="absolute top-1.5 left-1.5 flex flex-col gap-0.5 z-10 pointer-events-none">
                      <span className="px-1.5 py-0.5 bg-bg2/90 backdrop-blur-sm border border-border text-[9px] font-bold text-text rounded shadow-xs">
                        {med.category}
                      </span>
                      {currentAngle && gallery.length > 1 && (
                        <span className="px-1 py-0.2 bg-sky/20 backdrop-blur-sm border border-sky/40 text-[8px] font-bold text-sky rounded shadow-xs flex items-center gap-0.5">
                          {currentAngle.is_primary && <span>⭐</span>}
                          <span>{currentAngle.label}</span>
                        </span>
                      )}
                    </div>

                    {/* Stock Status Badges */}
                    <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-0.5 z-10 pointer-events-none">
                      {med.in_stock ? (
                        <span className="px-1.5 py-0.5 bg-emerald-500/90 text-white text-[9px] font-bold rounded shadow-xs flex items-center gap-1">
                          <span className="w-1 h-1 rounded-full bg-emerald-100 animate-pulse" />
                          <span>In Stock ({med.stock_qty})</span>
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 bg-amber-500/90 text-white text-[9px] font-bold rounded shadow-xs">
                          On Request
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Micro Thumbnail Strip (when product has multiple angles) */}
                  {gallery.length > 1 && (
                    <div className="px-2 py-1 bg-bg border-b border-border flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1 overflow-x-auto py-0.5">
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
                              className={`relative w-6 h-6 rounded overflow-hidden border p-0.5 transition-all cursor-pointer shrink-0 ${
                                isAngleSelected
                                  ? 'border-primary ring-1 ring-primary/40 bg-bg2 shadow-xs'
                                  : 'border-border/60 bg-bg hover:border-primary/50 opacity-70 hover:opacity-100'
                              }`}
                            >
                              <img
                                src={ang.url}
                                alt={ang.label}
                                className="w-full h-full object-contain"
                                onError={() => handleImageError(ang.url)}
                              />
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
                        className="text-[9px] text-sky hover:underline font-bold shrink-0 flex items-center gap-0.5 cursor-pointer"
                      >
                        <span>{gallery.length} Views</span>
                        <ChevronRight size={9} />
                      </button>
                    </div>
                  )}

                  {/* Card Body */}
                  <div className="p-2.5 space-y-1">
                    <div>
                      <h3 className="text-xs font-bold text-text line-clamp-1 leading-snug" title={med.name}>
                        {med.name}
                      </h3>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted truncate mt-0.5">
                        {med.pack && <span>{med.pack}</span>}
                        {med.pack && med.composition && <span>•</span>}
                        {med.composition && <span className="truncate italic" title={med.composition}>{med.composition}</span>}
                      </div>
                    </div>

                    {med.manufacturer && (
                      <p className="text-[9px] text-muted/70 uppercase tracking-wider truncate">
                        {med.manufacturer}
                      </p>
                    )}
                  </div>
                </div>

                {/* Pricing & Actions Row */}
                <div className="p-2.5 pt-1 border-t border-border/50 flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between">
                    <div>
                      {med.mrp > 0 || med.sell_price > 0 ? (
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-xs sm:text-sm font-extrabold text-primary">
                            ₹{(med.sell_price > 0 ? med.sell_price : med.mrp).toFixed(2)}
                          </span>
                          {med.sell_price > 0 && hasDiscount && (
                            <span className="text-[10px] text-muted line-through">
                              ₹{med.mrp.toFixed(2)}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] font-semibold text-muted">
                          On Request
                        </span>
                      )}
                    </div>

                    {hasDiscount && (
                      <span className="text-[9px] px-1 py-0.2 bg-emerald-500/10 text-emerald-600 font-bold rounded">
                        {discountPer}% OFF
                      </span>
                    )}
                  </div>

                  {/* Buttons */}
                  <div className="flex items-center gap-1.5">
                    {selected ? (
                      <div className="flex-1 flex items-center justify-between bg-primary/10 border border-primary/30 rounded-lg px-1.5 py-0.5">
                        <button
                          type="button"
                          onClick={() => onUpdateQuantity(med.name, -1)}
                          aria-label={selected.qty === 1 ? `Remove ${med.name} from refill` : `Decrease quantity for ${med.name}`}
                          title={selected.qty === 1 ? 'Remove from refill' : 'Decrease quantity'}
                          className="w-6 h-6 rounded bg-bg2 flex items-center justify-center text-text hover:bg-bg3 hover:text-red-500 transition-colors"
                        >
                          {selected.qty === 1 ? <Trash2 className="w-3 h-3 text-red-500" /> : <Minus className="w-3 h-3" />}
                        </button>
                        <span className="text-xs font-bold text-primary px-1">
                          {selected.qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => onUpdateQuantity(med.name, 1)}
                          aria-label={`Increase quantity for ${med.name}`}
                          className="w-6 h-6 rounded bg-bg2 flex items-center justify-center text-text hover:bg-bg3"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onToggleItem(med.name, med.sell_price || med.mrp || 0)}
                        aria-label={`Add ${med.name} to refill`}
                        className="flex-1 py-1.5 bg-primary text-white rounded-lg text-xs font-bold hover:opacity-90 transition-all flex items-center justify-center gap-1 shadow-xs"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Add</span>
                      </button>
                    )}

                    {/* WhatsApp Inquire / Order Button */}
                    <button
                      type="button"
                      onClick={() => openWhatsAppOrder(med)}
                      aria-label={`Order or inquire about ${med.name} on WhatsApp`}
                      title="Order on WhatsApp"
                      className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 border border-emerald-500/30 rounded-lg transition-colors shrink-0"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                    </button>
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

          <div className="flex items-center gap-2 shrink-0">
            {onClearCart && (
              <button
                type="button"
                onClick={onClearCart}
                className="px-3 py-2 text-xs font-semibold text-muted hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-colors cursor-pointer"
                title="Clear selected medicines"
              >
                Clear
              </button>
            )}
            <button
              onClick={onOpenCartModal}
              className="px-5 py-2.5 bg-primary text-white font-bold text-xs rounded-xl shadow-md hover:opacity-95 transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              <span>Review & Order</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
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
                    <span className="text-[10px] text-muted uppercase font-bold block">MRP</span>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className="text-xl font-black text-primary">
                        ₹{(quickViewMed.sell_price > 0 && quickViewMed.mrp > quickViewMed.sell_price
                          ? quickViewMed.sell_price
                          : (quickViewMed.mrp > 0 ? quickViewMed.mrp : quickViewMed.sell_price)
                        ).toFixed(2)}
                      </span>
                      {quickViewMed.sell_price > 0 && quickViewMed.mrp > quickViewMed.sell_price && (
                        <span className="text-xs text-muted line-through">
                          ₹{quickViewMed.mrp.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                  {quickViewMed.sell_price > 0 && quickViewMed.mrp > quickViewMed.sell_price && (
                    <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold text-xs">
                      {Math.round(((quickViewMed.mrp - quickViewMed.sell_price) / quickViewMed.mrp) * 100)}% OFF
                    </span>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-4 border-t border-border mt-4 space-y-2">
                {selectedItems[quickViewMed.name] ? (
                  <button
                    onClick={() => {
                      onToggleItem(quickViewMed.name, quickViewMed.sell_price, 1);
                      setQuickViewMed(null);
                    }}
                    className="w-full py-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 font-bold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Trash2 size={16} />
                    <span>Remove from Refill Cart</span>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      onToggleItem(quickViewMed.name, quickViewMed.sell_price, 1);
                      setQuickViewMed(null);
                    }}
                    className="w-full py-3 rounded-xl bg-primary text-white font-bold text-xs shadow-lg hover:opacity-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <ShoppingCart size={16} />
                    <span>Add to Monthly Refill Cart</span>
                  </button>
                )}

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

      {/* Direct Prescription / Medicine Photo Upload Modal */}
      <PrescriptionUploadModal
        isOpen={isPrescriptionModalOpen}
        onClose={() => setIsPrescriptionModalOpen(false)}
        prefillMedicineName={prescriptionPrefill}
        activeStore={activeStore}
        stores={stores}
        onSelectStoreId={onChangeStore}
      />
    </div>
  );
};
