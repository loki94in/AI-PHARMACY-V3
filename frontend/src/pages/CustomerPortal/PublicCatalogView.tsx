import React, { useState, useEffect } from 'react';
import {
  Search, ShoppingCart, CheckCircle2, AlertCircle, RefreshCw,
  Plus, Minus, MessageSquare, MapPin, Pill, Activity, Heart,
  Wind, ShieldCheck, ChevronRight, Store as StoreIcon, ExternalLink
} from 'lucide-react';
import { api } from '../../services/api';

interface CatalogMedicine {
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
  { key: 'all', label: 'All Chronic Refills', icon: Activity, countKey: 'all' },
  { key: 'diabetic', label: 'Diabetic Care', icon: Pill, countKey: 'diabetic' },
  { key: 'inhalation', label: 'Inhalation & Rotacaps', icon: Wind, countKey: 'inhalation_rotacaps' },
  { key: 'cholesterol', label: 'Cholesterol & Lipids', icon: ShieldCheck, countKey: 'cholesterol' },
  { key: 'tb', label: 'Tuberculosis (TB)', icon: Pill, countKey: 'tb' },
  { key: 'thyroid', label: 'Thyroid Care', icon: Activity, countKey: 'thyroid' },
  { key: 'bp_cardiac', label: 'BP & Cardiac', icon: Heart, countKey: 'bp_cardiac' },
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
            Browse verified clinical medicines, check live counter availability, and place 1-click monthly refills.
          </p>
        </div>

        {/* Branch Selector */}
        <div className="w-full md:w-72 space-y-1 shrink-0">
          <label className="text-[11px] font-bold text-muted uppercase tracking-wider flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 text-primary" />
            <span>Pickup Branch</span>
          </label>
          <select
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
          <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search medicine name, salt / composition, or brand (e.g., Metformin, Foracort, Atorva, R-Cinex)..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-bg2 border border-border rounded-xl text-text placeholder:text-muted focus:outline-none focus:border-primary text-sm shadow-sm"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
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
            const hasCustomImage = med.image_url && !imageErrors[med.name];
            const selected = selectedItems[med.name];
            const hasDiscount = med.sell_price > 0 && med.mrp > 0 && med.sell_price < med.mrp;
            const discountPer = hasDiscount ? Math.round(((med.mrp - med.sell_price) / med.mrp) * 100) : 0;

            return (
              <div
                key={`${med.name}-${idx}`}
                className="bg-bg2 border border-border rounded-2xl overflow-hidden shadow-sm hover:shadow-md hover:border-primary/40 transition-all flex flex-col justify-between"
              >
                <div>
                  {/* Image Container */}
                  <div className="relative w-full h-44 bg-bg border-b border-border flex items-center justify-center p-3 group overflow-hidden">
                    {hasCustomImage ? (
                      <img
                        src={med.image_url!}
                        alt={med.name}
                        onError={() => handleImageError(med.name)}
                        className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-2 text-muted/40">
                        <Pill className="w-12 h-12" />
                        <span className="text-[10px] font-medium text-muted">Genuine Store Item</span>
                      </div>
                    )}

                    {/* Category & Schedule Badges */}
                    <div className="absolute top-2 left-2 flex flex-col gap-1">
                      <span className="px-2 py-0.5 bg-bg2/90 backdrop-blur-sm border border-border text-[10px] font-bold text-text rounded-md shadow-xs">
                        {med.category}
                      </span>
                    </div>

                    {/* Stock Status Badge */}
                    <div className="absolute top-2 right-2">
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
                    </div>
                  </div>

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
                  </div>

                  {/* Buttons */}
                  <div className="flex items-center gap-2">
                    {selected ? (
                      <div className="flex-1 flex items-center justify-between bg-primary/10 border border-primary/30 rounded-xl px-2 py-1.5">
                        <button
                          onClick={() => onUpdateQuantity(med.name, -1)}
                          className="w-7 h-7 rounded-lg bg-bg2 flex items-center justify-center text-text hover:bg-bg3"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-xs font-bold text-primary px-2">
                          Qty: {selected.qty}
                        </span>
                        <button
                          onClick={() => onUpdateQuantity(med.name, 1)}
                          className="w-7 h-7 rounded-lg bg-bg2 flex items-center justify-center text-text hover:bg-bg3"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => onToggleItem(med.name, med.sell_price || med.mrp || 0)}
                        className="flex-1 py-2 bg-primary text-white rounded-xl text-xs font-bold hover:opacity-95 transition-all flex items-center justify-center gap-1.5 shadow-sm"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add to Refill</span>
                      </button>
                    )}

                    {/* WhatsApp Inquire / Order Button */}
                    <button
                      onClick={() => openWhatsAppOrder(med)}
                      title="Order or inquire on WhatsApp"
                      className="p-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 border border-emerald-500/30 rounded-xl transition-colors shrink-0"
                    >
                      <MessageSquare className="w-4 h-4" />
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
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-4 py-2 bg-bg2 border border-border rounded-xl text-xs font-semibold text-text disabled:opacity-40 hover:bg-bg3 transition-colors"
          >
            ← Previous
          </button>
          <span className="text-xs text-muted font-medium">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
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
    </div>
  );
};
