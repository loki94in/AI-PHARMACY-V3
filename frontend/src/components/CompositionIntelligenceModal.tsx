import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Pill,
  Sparkles,
  Package,
  History,
  Building2,
  TrendingUp,
  Clock,
  AlertCircle,
  Search,
  Loader2,
  Plus,
  ImageIcon,
  Maximize2,
  ShieldCheck,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { api } from '../services/api';

export interface CatalogImageItem {
  id: number;
  image_type: string;
  image_path: string;
  thumbnail_path?: string;
  verification_status: string;
  confidence_score: number;
  is_primary: number;
}

export interface CompositionIntelligenceData {
  medicine: {
    id: number;
    name: string;
    generic_name?: string | null;
    manufacturer?: string | null;
    api_reference?: string | null;
    mrp?: number | null;
    sell_price?: number | null;
  };
  api_reference: string;
  images?: CatalogImageItem[];
  in_stock_alternatives: Array<{
    inventory_id: number;
    medicine_id: number;
    medicine_name: string;
    manufacturer?: string;
    batch_no?: string;
    expiry_date?: string;
    quantity: number;
    loose_quantity?: number;
    mrp: number;
    unit_price?: number;
    rack_location?: string;
    primary_image_path?: string;
    image_type?: string;
  }>;
  purchase_history: Array<{
    id: number;
    purchase_id: number;
    invoice_no?: string;
    purchase_date?: string;
    distributor_name?: string;
    medicine_name: string;
    batch_no?: string;
    expiry_date?: string;
    quantity: number;
    cost_price: number;
    mrp: number;
  }>;
  sales_history: {
    total_units_sold: number;
    last_sold_date: string | null;
  };
  master_brands_count: number;
  master_brands_sample: Array<{
    id: number;
    name: string;
    manufacturer?: string;
    mrp?: number;
  }>;
}

interface CompositionIntelligenceModalProps {
  medicineId: number | null;
  isOpen: boolean;
  onClose: () => void;
  onSelectAlternative?: (alt: any) => void;
}

export const CompositionIntelligenceModal: React.FC<CompositionIntelligenceModalProps> = ({
  medicineId,
  isOpen,
  onClose,
  onSelectAlternative
}) => {
  const [activeTab, setActiveTab] = useState<'instock' | 'packaging' | 'history' | 'master'>('instock');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CompositionIntelligenceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [brandFilter, setBrandFilter] = useState('');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightboxIndex !== null) {
          setLightboxIndex(null);
        } else {
          onClose();
        }
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, lightboxIndex]);

  // Fetch composition intelligence
  useEffect(() => {
    if (!isOpen || !medicineId) {
      setData(null);
      setError(null);
      setLightboxIndex(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    api.getCompositionIntelligence(medicineId)
      .then((res: CompositionIntelligenceData) => {
        if (isMounted) {
          setData(res);
          // Smart default tab
          if (res.in_stock_alternatives && res.in_stock_alternatives.length > 0) {
            setActiveTab('instock');
          } else if (res.images && res.images.length > 0) {
            setActiveTab('packaging');
          } else if (res.purchase_history && res.purchase_history.length > 0) {
            setActiveTab('history');
          } else {
            setActiveTab('master');
          }
        }
      })
      .catch((err: any) => {
        if (isMounted) {
          console.error('Failed to load composition intelligence:', err);
          setError(err?.response?.data?.error || 'Failed to load medicine intelligence');
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, medicineId]);

  // Filter master brands
  const filteredMasterBrands = useMemo(() => {
    if (!data?.master_brands_sample) return [];
    if (!brandFilter.trim()) return data.master_brands_sample;
    const q = brandFilter.toLowerCase();
    return data.master_brands_sample.filter(
      b => b.name.toLowerCase().includes(q) || (b.manufacturer && b.manufacturer.toLowerCase().includes(q))
    );
  }, [data?.master_brands_sample, brandFilter]);

  const imagesList = data?.images || [];

  const formatAngleLabel = (type: string) => {
    switch (type?.toLowerCase()) {
      case 'front': return 'Front Packaging';
      case 'back': return 'Back Blister / Foil';
      case 'box': return 'Carton / Box Packaging';
      case 'tablet': return 'Tablet / Dosage Detail';
      case 'side': return 'Side Panel / Batch Details';
      case 'combined': return 'Primary Pack & Blister';
      default: return 'Packaging View';
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-4xl max-h-[90vh] flex flex-col bg-bg2 border border-glass-border rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* MODAL HEADER */}
        <div className="flex items-start justify-between p-5 border-b border-glass-border bg-bg3/50">
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20 text-primary mt-0.5">
              <Pill size={24} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-text">
                  {data?.medicine?.name || 'Medicine Intelligence'}
                </h2>
                {data?.medicine?.manufacturer && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-bg3 text-muted border border-border/50">
                    {data.medicine.manufacturer}
                  </span>
                )}
                {imagesList.length > 0 && (
                  <span className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                    <ShieldCheck size={12} />
                    <span>Verified Visuals ({imagesList.length})</span>
                  </span>
                )}
              </div>
              
              {data?.api_reference ? (
                <div className="flex items-center gap-1.5 mt-1.5 text-xs text-sky font-medium">
                  <Sparkles size={14} className="text-sky animate-pulse" />
                  <span>Active Salt Formula:</span>
                  <span className="font-bold text-text bg-sky/10 border border-sky/20 px-2 py-0.5 rounded-md">
                    {data.api_reference}
                  </span>
                </div>
              ) : (
                <p className="text-xs text-muted mt-1">Chemical composition reference</p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-muted hover:text-text hover:bg-bg3 transition-all"
            title="Close (Esc)"
          >
            <X size={20} />
          </button>
        </div>

        {/* TAB NAVIGATION */}
        <div className="flex items-center gap-2 px-5 pt-3 border-b border-glass-border bg-bg overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('instock')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'instock'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            <Package size={15} />
            <span>In-Stock Alternatives</span>
            {data && (
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                data.in_stock_alternatives.length > 0 
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-bg3 text-muted'
              }`}>
                {data.in_stock_alternatives.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('packaging')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'packaging'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            <ImageIcon size={15} />
            <span>Packaging & Angles</span>
            {imagesList.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-sky/10 border border-sky/20 text-sky">
                {imagesList.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'history'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            <History size={15} />
            <span>Pharmacy History</span>
            {data && data.purchase_history.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-bg3 text-muted">
                {data.purchase_history.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('master')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'master'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            <Building2 size={15} />
            <span>All Master Brands</span>
            {data && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-primary/10 text-primary border border-primary/20">
                {data.master_brands_count}
              </span>
            )}
          </button>
        </div>

        {/* MODAL CONTENT */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted gap-3">
              <Loader2 size={32} className="animate-spin text-primary" />
              <p className="text-sm font-medium">Scanning inventory, packaging visuals & master catalog...</p>
            </div>
          ) : error ? (
            <div className="p-6 text-center text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl space-y-2">
              <AlertCircle size={28} className="mx-auto" />
              <p className="text-sm font-semibold">{error}</p>
            </div>
          ) : data ? (
            <>
              {/* TAB 1: IN-STOCK ALTERNATIVES */}
              {activeTab === 'instock' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-muted mb-2">
                    <span>Showing identical formulation brands physically available in your store:</span>
                    <span className="font-semibold text-text">{data.in_stock_alternatives.length} sellable batch(es)</span>
                  </div>

                  {data.in_stock_alternatives.length === 0 ? (
                    <div className="text-center py-12 p-6 rounded-xl border border-glass-border bg-bg3/30 space-y-2">
                      <AlertCircle size={32} className="mx-auto text-amber-400" />
                      <h4 className="text-sm font-bold text-text">No Alternate Brands Currently in Stock</h4>
                      <p className="text-xs text-muted max-w-md mx-auto">
                        There are currently no other brands with active stock for this exact chemical formula in your store.
                        Check the <strong>Packaging & Angles</strong>, <strong>Pharmacy History</strong>, or <strong>All Master Brands</strong> tabs.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {data.in_stock_alternatives.map((alt) => (
                        <div
                          key={`sub_alt_${alt.inventory_id}`}
                          className="flex flex-col justify-between p-4 rounded-xl border border-glass-border bg-bg3 hover:border-primary/50 transition-all group"
                        >
                          <div className="flex items-start gap-3">
                            {alt.primary_image_path ? (
                              <div className="w-14 h-14 rounded-lg overflow-hidden bg-bg border border-glass-border shrink-0 flex items-center justify-center">
                                <img
                                  src={alt.primary_image_path}
                                  alt={alt.medicine_name}
                                  className="w-full h-full object-contain p-1"
                                  loading="lazy"
                                  onError={(e) => {
                                    (e.target as HTMLElement).style.display = 'none';
                                  }}
                                />
                              </div>
                            ) : null}

                            <div className="space-y-1 flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <h4 className="text-sm font-bold text-text group-hover:text-primary transition-all truncate">
                                  {alt.medicine_name}
                                </h4>
                                <span className="font-mono text-sm font-bold text-emerald-400 shrink-0">
                                  ₹{alt.mrp.toFixed(2)}
                                </span>
                              </div>

                              {alt.manufacturer && (
                                <p className="text-xs text-muted font-medium truncate">
                                  Mfg: <span className="text-text">{alt.manufacturer}</span>
                                </p>
                              )}

                              <div className="flex flex-wrap items-center gap-1.5 text-xs pt-1">
                                <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold font-mono">
                                  Stock: {alt.quantity} {alt.loose_quantity ? `(+${alt.loose_quantity} loose)` : 'Strips'}
                                </span>

                                {alt.batch_no && (
                                  <span className="px-1.5 py-0.5 rounded bg-bg text-muted border border-border/40 font-mono text-[11px]">
                                    {alt.batch_no}
                                  </span>
                                )}

                                {alt.expiry_date && (
                                  <span className="px-1.5 py-0.5 rounded bg-bg text-muted border border-border/40 text-[11px]">
                                    Exp: {alt.expiry_date}
                                  </span>
                                )}

                                {alt.rack_location && (
                                  <span className="px-1.5 py-0.5 rounded bg-sky/10 border border-sky/20 text-sky text-[11px] font-medium">
                                    Rack: {alt.rack_location}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {onSelectAlternative && (
                            <button
                              type="button"
                              onClick={() => {
                                onSelectAlternative(alt);
                                onClose();
                              }}
                              className="mt-3 w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-primary hover:bg-primary/90 text-white font-bold text-xs shadow transition-all cursor-pointer"
                            >
                              <Plus size={14} />
                              <span>Select & Add to Bill</span>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: PACKAGING & VERIFIED ANGLES */}
              {activeTab === 'packaging' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span>High-resolution packaging inspection (Front, Back blister & Carton angles):</span>
                    <span className="font-semibold text-text">{imagesList.length} verified packaging angle(s)</span>
                  </div>

                  {imagesList.length === 0 ? (
                    <div className="text-center py-12 p-6 rounded-xl border border-glass-border bg-bg3/30 space-y-3">
                      <ImageIcon size={36} className="mx-auto text-muted" />
                      <h4 className="text-sm font-bold text-text">No Packaging Visuals Available</h4>
                      <p className="text-xs text-muted max-w-md mx-auto">
                        No verified packaging photos currently exist for this medicine. You can use the AI Camera in POS or Returns to scan and record its packaging blister directly.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                      {imagesList.map((img, idx) => (
                        <div
                          key={`img_slot_${img.id}`}
                          onClick={() => setLightboxIndex(idx)}
                          className="group relative flex flex-col rounded-xl border border-glass-border bg-bg3/80 overflow-hidden hover:border-primary/60 transition-all cursor-pointer shadow-sm hover:shadow-md"
                        >
                          {/* Image Box */}
                          <div className="relative aspect-4/3 w-full bg-bg flex items-center justify-center overflow-hidden p-3">
                            <img
                              src={img.image_path}
                              alt={formatAngleLabel(img.image_type)}
                              className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                              loading="lazy"
                            />
                            
                            <div className="absolute inset-0 bg-bg/60 backdrop-blur-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-bold shadow-lg">
                                <Maximize2 size={14} />
                                <span>Inspect Full View</span>
                              </span>
                            </div>

                            {/* Angle Badge */}
                            <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-bg3/90 backdrop-blur-sm text-text text-[11px] font-bold border border-border">
                              {formatAngleLabel(img.image_type)}
                            </span>

                            {img.is_primary === 1 && (
                              <span className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-emerald-500 text-white text-[10px] font-bold shadow">
                                Primary
                              </span>
                            )}
                          </div>

                          {/* Footer Info */}
                          <div className="p-3 border-t border-glass-border bg-bg2 flex items-center justify-between text-xs">
                            <span className="font-semibold text-text truncate">
                              {formatAngleLabel(img.image_type)}
                            </span>
                            <span className="flex items-center gap-1 font-mono text-[11px] text-emerald-400 font-bold shrink-0">
                              <ShieldCheck size={13} />
                              {img.confidence_score}% Match
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: PHARMACY PURCHASE & SALES HISTORY */}
              {activeTab === 'history' && (
                <div className="space-y-5">
                  {/* Summary Metric Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    <div className="p-4 rounded-xl border border-glass-border bg-bg3">
                      <div className="flex items-center justify-between text-muted text-xs mb-1">
                        <span>Lifetime Pharmacy Sales</span>
                        <TrendingUp size={16} className="text-emerald-400" />
                      </div>
                      <div className="text-xl font-extrabold text-emerald-400 font-mono">
                        {data.sales_history.total_units_sold.toLocaleString()} <span className="text-xs font-normal text-muted">units</span>
                      </div>
                      <p className="text-[11px] text-muted mt-1">
                        Last sold: {data.sales_history.last_sold_date ? new Date(data.sales_history.last_sold_date).toLocaleDateString() : 'Never logged'}
                      </p>
                    </div>

                    <div className="p-4 rounded-xl border border-glass-border bg-bg3">
                      <div className="flex items-center justify-between text-muted text-xs mb-1">
                        <span>Historical Invoices</span>
                        <Clock size={16} className="text-sky" />
                      </div>
                      <div className="text-xl font-extrabold text-sky font-mono">
                        {data.purchase_history.length} <span className="text-xs font-normal text-muted">purchases recorded</span>
                      </div>
                      <p className="text-[11px] text-muted mt-1">
                        {data.purchase_history[0]?.purchase_date
                          ? `Latest purchase: ${new Date(data.purchase_history[0].purchase_date).toLocaleDateString()}`
                          : 'No purchase records'}
                      </p>
                    </div>

                    <div className="p-4 rounded-xl border border-glass-border bg-bg3">
                      <div className="flex items-center justify-between text-muted text-xs mb-1">
                        <span>Current In-Stock Quantity</span>
                        <Package size={16} className="text-primary" />
                      </div>
                      <div className="text-xl font-extrabold text-text font-mono">
                        {data.in_stock_alternatives.reduce((sum, a) => sum + (a.quantity || 0), 0)} <span className="text-xs font-normal text-muted">available units</span>
                      </div>
                      <p className="text-[11px] text-muted mt-1">
                        Across {data.in_stock_alternatives.length} shelf batch(es)
                      </p>
                    </div>
                  </div>

                  {/* Purchase History Table */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-text uppercase tracking-wider">
                      Purchase Invoices Log for this Formulation
                    </h4>

                    {data.purchase_history.length === 0 ? (
                      <div className="text-center py-8 text-xs text-muted border border-glass-border rounded-xl bg-bg3/30">
                        No prior purchase invoice items recorded in the system.
                      </div>
                    ) : (
                      <div className="border border-glass-border rounded-xl overflow-x-auto bg-bg3/40">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-glass-border bg-bg3/80 text-muted font-bold text-[11px] uppercase">
                              <th className="py-2.5 px-3">Date</th>
                              <th className="py-2.5 px-3">Distributor / Supplier</th>
                              <th className="py-2.5 px-3">Brand Purchased</th>
                              <th className="py-2.5 px-3">Batch & Exp</th>
                              <th className="py-2.5 px-3 text-right">Qty</th>
                              <th className="py-2.5 px-3 text-right">Cost Rate</th>
                              <th className="py-2.5 px-3 text-right">MRP</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-glass-border/30">
                            {data.purchase_history.map((ph, idx) => (
                              <tr key={`ph_${ph.id}_${idx}`} className="hover:bg-bg3 transition-all">
                                <td className="py-2.5 px-3 font-mono text-muted whitespace-nowrap">
                                  {ph.purchase_date ? new Date(ph.purchase_date).toLocaleDateString() : '—'}
                                </td>
                                <td className="py-2.5 px-3 font-semibold text-text whitespace-nowrap">
                                  {ph.distributor_name || 'Direct / Unknown'}
                                </td>
                                <td className="py-2.5 px-3 text-text font-medium">
                                  {ph.medicine_name}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-muted text-[11px] whitespace-nowrap">
                                  {ph.batch_no || '—'} {ph.expiry_date ? `(${ph.expiry_date})` : ''}
                                </td>
                                <td className="py-2.5 px-3 font-mono font-bold text-text text-right">
                                  {ph.quantity}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-muted text-right">
                                  ₹{ph.cost_price ? ph.cost_price.toFixed(2) : '0.00'}
                                </td>
                                <td className="py-2.5 px-3 font-mono font-bold text-emerald-400 text-right">
                                  ₹{ph.mrp ? ph.mrp.toFixed(2) : '0.00'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 4: ALL MASTER DATABASE BRANDS */}
              {activeTab === 'master' && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                    <p className="text-xs text-muted">
                      There are <strong className="text-text">{data.master_brands_count} brands</strong> registered in India with this formulation.
                    </p>
                    <div className="relative w-full sm:w-64">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                      <input
                        type="text"
                        value={brandFilter}
                        onChange={(e) => setBrandFilter(e.target.value)}
                        placeholder="Search brands or companies..."
                        className="w-full pl-9 pr-3 py-1.5 text-xs bg-bg3 border border-glass-border rounded-lg text-text focus:outline-none focus:border-primary"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-[50vh] overflow-y-auto pr-1">
                    {filteredMasterBrands.map((brand, bidx) => (
                      <div
                        key={`mb_${brand.id}_${bidx}`}
                        className="p-3 rounded-xl border border-glass-border bg-bg3/60 hover:border-primary/40 transition-all flex flex-col justify-between"
                      >
                        <div>
                          <h5 className="text-xs font-bold text-text leading-tight">{brand.name}</h5>
                          {brand.manufacturer && (
                            <p className="text-[11px] text-muted mt-1 line-clamp-1">
                              {brand.manufacturer}
                            </p>
                          )}
                        </div>
                        {brand.mrp !== undefined && brand.mrp !== null && brand.mrp > 0 && (
                          <span className="font-mono text-xs font-semibold text-emerald-400 mt-2">
                            Ref MRP: ₹{brand.mrp}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* MODAL FOOTER */}
        <div className="flex items-center justify-between p-4 border-t border-glass-border bg-bg3/50 text-xs text-muted">
          <span>Press <kbd className="px-1.5 py-0.5 rounded bg-bg border border-border/40 font-mono text-[10px]">Esc</kbd> to exit</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-bg border border-glass-border text-text font-semibold hover:bg-bg3 transition-all cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>

      {/* LIGHTBOX INSPECTION MODAL */}
      {lightboxIndex !== null && imagesList[lightboxIndex] && (
        <div 
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150"
          onClick={() => setLightboxIndex(null)}
        >
          <div 
            className="relative max-w-3xl max-h-[85vh] flex flex-col bg-bg2 border border-glass-border rounded-2xl overflow-hidden shadow-2xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-glass-border mb-3">
              <div>
                <h3 className="text-sm font-bold text-text">
                  {formatAngleLabel(imagesList[lightboxIndex].image_type)}
                </h3>
                <p className="text-xs text-muted font-mono">{data?.medicine?.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setLightboxIndex(null)}
                className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-all"
              >
                <X size={20} />
              </button>
            </div>

            <div className="relative flex-1 flex items-center justify-center overflow-hidden bg-bg rounded-xl min-h-[350px]">
              <img
                src={imagesList[lightboxIndex].image_path}
                alt={formatAngleLabel(imagesList[lightboxIndex].image_type)}
                className="max-h-[65vh] w-auto max-w-full object-contain"
              />

              {imagesList.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setLightboxIndex((lightboxIndex - 1 + imagesList.length) % imagesList.length)}
                    className="absolute left-2 p-2 rounded-full bg-bg3/90 text-text hover:bg-bg3 border border-border/40 shadow-lg transition-all cursor-pointer"
                    title="Previous angle"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setLightboxIndex((lightboxIndex + 1) % imagesList.length)}
                    className="absolute right-2 p-2 rounded-full bg-bg3/90 text-text hover:bg-bg3 border border-border/40 shadow-lg transition-all cursor-pointer"
                    title="Next angle"
                  >
                    <ChevronRight size={20} />
                  </button>
                </>
              )}
            </div>

            <div className="flex items-center justify-between pt-3 text-xs text-muted">
              <span>Slot {lightboxIndex + 1} of {imagesList.length}</span>
              <span className="font-mono text-emerald-400 font-bold">
                Confidence: {imagesList[lightboxIndex].confidence_score}%
              </span>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};
