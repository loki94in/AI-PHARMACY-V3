import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Search, Pill, Camera, Check, AlertTriangle, Send,
  RefreshCw, Upload, Eye, Layers, ShieldCheck, Sparkles, AlertCircle
} from 'lucide-react';
import { api } from '../services/api';
import { toastEvent } from '../services/events';
import { useModalEscape } from '../services/keyboardShortcuts';

interface MedicineItem {
  id: number;
  name: string;
  generic_name?: string | null;
  manufacturer?: string | null;
  dosage_form?: string | null;
  strength?: string | null;
  mrp?: number | null;
  packaging?: string | null;
}

interface VisualReferenceData {
  medicine: MedicineItem;
  has_image: boolean;
  auto_pulled: boolean;
  primaryUrl: string | null;
  images: Record<string, { url: string; type: string; is_primary: boolean }>;
  gallery: Array<{
    id: number;
    url: string;
    type: string;
    verification_status: string;
    is_primary: boolean;
    is_active: boolean;
  }>;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  recipientPhone: string;
  recipientName?: string;
  onSuccess?: () => void;
}

export function MedicineVisualReferenceModal({
  isOpen,
  onClose,
  recipientPhone,
  recipientName,
  onSuccess
}: Props) {
  useModalEscape(isOpen, onClose);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MedicineItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedMedicine, setSelectedMedicine] = useState<MedicineItem | null>(null);

  // Visual reference resolution state
  const [loadingRef, setLoadingRef] = useState(false);
  const [visualData, setVisualData] = useState<VisualReferenceData | null>(null);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<number | undefined>(undefined);

  // Live photo capture / file upload state
  const [livePhotoBase64, setLivePhotoBase64] = useState<string | null>(null);
  const [livePhotoMime, setLivePhotoMime] = useState<string>('image/jpeg');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Custom pharmacist note & send state
  const [customNote, setCustomNote] = useState('');
  const [sending, setSending] = useState(false);
  const [approving, setApproving] = useState(false);

  // Clean reset when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setSearchResults([]);
      setSelectedMedicine(null);
      setVisualData(null);
      setSelectedImageUrl(null);
      setSelectedImageId(undefined);
      setLivePhotoBase64(null);
      setCustomNote('');
    }
  }, [isOpen]);

  // Debounced search for medicines
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(() => {
      setIsSearching(true);
      api.searchMedicines(searchQuery.trim(), 10)
        .then(res => {
          setSearchResults(res.data || []);
        })
        .catch(err => {
          console.warn('[VisualReference] Search error:', err);
        })
        .finally(() => {
          setIsSearching(false);
        });
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Handle medicine selection & visual reference resolution
  const handleSelectMedicine = async (med: MedicineItem) => {
    setSelectedMedicine(med);
    setSearchQuery('');
    setSearchResults([]);
    setLoadingRef(true);
    setVisualData(null);
    setSelectedImageUrl(null);
    setSelectedImageId(undefined);
    setLivePhotoBase64(null);

    try {
      const res = await api.getMedicineVisualReference(med.id);
      if (res && res.success) {
        setVisualData(res);
        if (res.primaryUrl) {
          setSelectedImageUrl(res.primaryUrl);
          const primItem = res.gallery.find(g => g.is_primary) || res.gallery[0];
          if (primItem) setSelectedImageId(primItem.id);
        } else if (res.gallery.length > 0) {
          setSelectedImageUrl(res.gallery[0].url);
          setSelectedImageId(res.gallery[0].id);
        }
      }
    } catch (err: any) {
      console.error('[VisualReference] Resolution error:', err);
      toastEvent.trigger('Failed to resolve medicine packaging: ' + (err.message || 'Network error'), 'error', '/crm');
    } finally {
      setLoadingRef(false);
    }
  };

  // Handle file / camera snapshot upload
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toastEvent.trigger('Please select an image file', 'info', '/crm');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64Data = (reader.result as string).split(',')[1];
      setLivePhotoBase64(base64Data);
      setLivePhotoMime(file.type);
      setSelectedImageUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  // 1-Click Approve In-App (Catalog Promotion for refills)
  const handleApproveImage = async () => {
    if (!selectedImageId) return;
    setApproving(true);
    try {
      const res = await api.approveCatalogImage(selectedImageId, 'pharmacist');
      if (res.success) {
        toastEvent.trigger('Packaging photo approved and permanently cached for refills!', 'success', '/crm');
        if (visualData) {
          setVisualData({
            ...visualData,
            gallery: visualData.gallery.map(g => g.id === selectedImageId ? { ...g, verification_status: 'APPROVED', is_primary: true } : g)
          });
        }
      }
    } catch (err: any) {
      toastEvent.trigger('Failed to approve image: ' + (err.message || 'Error'), 'error', '/crm');
    } finally {
      setApproving(false);
    }
  };

  // Handle Dispatch to Customer via WhatsApp
  const handleSend = async () => {
    if (!selectedMedicine) {
      toastEvent.trigger('Please select a medicine first', 'info', '/crm');
      return;
    }

    setSending(true);
    try {
      const res = await api.sendMedicineVisualReference({
        phone: recipientPhone,
        medicineId: selectedMedicine.id,
        imageId: selectedImageId,
        imageUrl: livePhotoBase64 ? undefined : (selectedImageUrl || undefined),
        customNote: customNote.trim() || undefined,
        livePhoto: livePhotoBase64 ? { mimetype: livePhotoMime, data: livePhotoBase64, filename: `counter-pic-${selectedMedicine.id}.jpg` } : undefined,
        customerName: recipientName
      });

      if (res.success) {
        toastEvent.trigger(`Visual reference sent to ${recipientName || recipientPhone} via WhatsApp!`, 'success', '/crm');
        if (res.owner_notified) {
          toastEvent.trigger('Admin WhatsApp notified for packaging verification', 'info', '/crm');
        }
        if (onSuccess) onSuccess();
        onClose();
      } else {
        toastEvent.trigger(res.message || 'Failed to send visual reference', 'error', '/crm');
      }
    } catch (err: any) {
      console.error('[VisualReference] Send error:', err);
      toastEvent.trigger('Error sending visual reference: ' + (err.message || 'Failed'), 'error', '/crm');
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  const currentGalleryItem = visualData?.gallery.find(g => g.id === selectedImageId);
  const isPendingReview = currentGalleryItem?.verification_status === 'PENDING_REVIEW' || visualData?.auto_pulled;

  return createPortal(
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-modal flex items-center justify-center p-4">
      <div className="bg-bg2 border border-border rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between bg-bg3/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center border border-emerald-500/20">
              <Pill size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text">Medicine Visual Reference</h3>
              <p className="text-[11px] text-muted">
                Send verified packaging photo to {recipientName ? <span className="font-semibold text-text">{recipientName}</span> : 'customer'} ({recipientPhone})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-all"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          
          {/* Step 1: Search Medicine */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-text flex items-center gap-1.5">
              <Search size={13} className="text-primary" />
              <span>Select Medicine:</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={selectedMedicine ? selectedMedicine.name : "Type medicine name (e.g. Telista, D-Rise, Pan 40)..."}
                className="w-full pl-9 pr-4 py-2 bg-bg border border-border rounded-xl text-xs text-text placeholder:text-muted focus:outline-none focus:border-primary transition-all"
              />
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              {isSearching && (
                <RefreshCw size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-primary animate-spin" />
              )}
            </div>

            {/* Search Results Dropdown */}
            {searchResults.length > 0 && (
              <div className="border border-border rounded-xl bg-bg shadow-lg divide-y divide-border/40 max-h-48 overflow-y-auto mt-1">
                {searchResults.map(med => (
                  <div
                    key={med.id}
                    onClick={() => handleSelectMedicine(med)}
                    className="p-2.5 hover:bg-bg3 cursor-pointer transition-all flex items-center justify-between"
                  >
                    <div>
                      <div className="text-xs font-bold text-text flex items-center gap-2">
                        <span>{med.name}</span>
                        {med.strength && (
                          <span className="text-[10px] px-1.5 py-0.2 bg-primary/10 text-primary font-mono rounded">
                            {med.strength}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted truncate mt-0.5">
                        {med.generic_name || 'Generic not specified'} • {med.manufacturer || 'Unknown Mfg'}
                      </div>
                    </div>
                    {med.mrp ? (
                      <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        ₹{med.mrp}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Loading Indicator for CDN Auto-Pull */}
          {loadingRef && (
            <div className="p-6 rounded-xl bg-bg border border-border flex flex-col items-center justify-center gap-2 text-center">
              <RefreshCw size={24} className="text-primary animate-spin" />
              <div className="text-xs font-semibold text-text">Checking Local Storage &amp; Auto-Pulling from CDN...</div>
              <p className="text-[11px] text-muted max-w-sm">
                Validating packaging composition, brand equality, and dosage form against catalog standards.
              </p>
            </div>
          )}

          {/* Step 2: Selected Medicine & Visual Reference Card */}
          {selectedMedicine && !loadingRef && (
            <div className="space-y-4">
              
              {/* Medicine Summary Header */}
              <div className="p-3 bg-bg3/60 border border-border rounded-xl flex items-start justify-between">
                <div>
                  <div className="text-sm font-bold text-text flex items-center gap-2">
                    <span>{selectedMedicine.name}</span>
                    {selectedMedicine.dosage_form && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-primary/20 text-primary rounded uppercase font-semibold">
                        {selectedMedicine.dosage_form}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted mt-1 space-y-0.5">
                    {selectedMedicine.generic_name && (
                      <div><strong className="text-text">Salts:</strong> {selectedMedicine.generic_name}</div>
                    )}
                    {selectedMedicine.manufacturer && (
                      <div><strong className="text-text">Mfg:</strong> {selectedMedicine.manufacturer}</div>
                    )}
                  </div>
                </div>
                {selectedMedicine.mrp && (
                  <div className="text-right">
                    <span className="text-xs text-muted block">MRP</span>
                    <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">₹{selectedMedicine.mrp}</span>
                  </div>
                )}
              </div>

              {/* Packaging Photo Section */}
              <div className="p-3.5 bg-bg border border-border rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-text">Packaging Visual Reference:</span>
                    {selectedImageUrl ? (
                      isPendingReview ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 font-semibold flex items-center gap-1">
                          <AlertCircle size={10} /> Auto-pulled CDN (Review)
                        </span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-semibold flex items-center gap-1">
                          <ShieldCheck size={10} /> Verified Catalog Image
                        </span>
                      )
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-500 border border-rose-500/20 font-semibold flex items-center gap-1">
                        <AlertTriangle size={10} /> No Online Photo
                      </span>
                    )}
                  </div>

                  {/* Camera / Upload Trigger */}
                  <div className="flex items-center gap-1.5">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileSelect}
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-2.5 py-1 rounded-lg bg-bg2 border border-border text-xs text-text hover:text-primary transition-all flex items-center gap-1 active:scale-95"
                      title="Take Live Camera Snapshot or Upload Strip Photo"
                    >
                      <Camera size={12} />
                      <span>{selectedImageUrl ? 'Change / Snap' : 'Snap Live Photo'}</span>
                    </button>

                    {/* 1-Click Approve In-App Button for Refills */}
                    {isPendingReview && selectedImageId && (
                      <button
                        type="button"
                        onClick={handleApproveImage}
                        disabled={approving}
                        className="px-2.5 py-1 rounded-lg bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-500 border border-emerald-500/30 text-xs font-semibold transition-all flex items-center gap-1 active:scale-95"
                        title="Promote and permanently cache for future refills"
                      >
                        <Check size={12} />
                        <span>{approving ? 'Saving...' : 'Approve for Refills'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Packaging Angle Switcher (if multiple exist) */}
                {visualData && visualData.gallery.length > 1 && (
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                    {visualData.gallery.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setSelectedImageUrl(item.url);
                          setSelectedImageId(item.id);
                        }}
                        className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border transition-all capitalize ${
                          selectedImageUrl === item.url
                            ? 'bg-primary/20 border-primary text-primary'
                            : 'bg-bg2 border-border text-muted hover:text-text'
                        }`}
                      >
                        {item.type} {item.is_primary ? '⭐' : ''}
                      </button>
                    ))}
                  </div>
                )}

                {/* Packaging Image Preview Box */}
                {selectedImageUrl ? (
                  <div className="relative group w-full h-48 bg-bg2 rounded-xl border border-border overflow-hidden flex items-center justify-center p-2">
                    <img
                      src={selectedImageUrl}
                      alt={selectedMedicine.name}
                      className="max-h-full max-w-full object-contain rounded-lg transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-bg3/90 border border-border text-text text-[10px] font-medium backdrop-blur-sm">
                      {livePhotoBase64 ? '📸 Live Counter Photo' : (currentGalleryItem?.type ? `${currentGalleryItem.type.toUpperCase()} Face` : 'Primary Pack')}
                    </div>
                  </div>
                ) : (
                  <div className="p-6 rounded-xl bg-bg2/50 border border-dashed border-border text-center space-y-2">
                    <div className="w-10 h-10 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center mx-auto">
                      <Camera size={18} />
                    </div>
                    <p className="text-xs text-text font-bold">No packaging photo found in catalog or CDN</p>
                    <p className="text-[11px] text-muted max-w-xs mx-auto">
                      You can send the message with clinical specifications only, or snap a quick photo from your pharmacy counter.
                    </p>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-xl bg-primary text-white text-xs font-bold transition-all shadow-md active:scale-95 inline-flex items-center gap-1.5"
                    >
                      <Camera size={13} />
                      <span>Snap Counter Photo</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Step 3: Pharmacist Custom Note & Safety Disclaimer */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-text flex items-center justify-between">
                  <span>Pharmacist Custom Note (Optional):</span>
                  <span className="text-[10px] text-muted">Sent along with packaging photo</span>
                </label>
                <textarea
                  value={customNote}
                  onChange={e => setCustomNote(e.target.value)}
                  placeholder="e.g. Please verify if 60,000 IU is the exact dosage prescribed by your doctor. Take 1 capsule weekly."
                  rows={2}
                  className="w-full p-2.5 bg-bg border border-border rounded-xl text-xs text-text placeholder:text-muted focus:outline-none focus:border-primary resize-none"
                />

                {/* Mandatory Safety Disclaimer Notice */}
                <div className="p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 flex items-start gap-2 text-amber-600 dark:text-amber-400">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <div className="text-[11px] leading-relaxed">
                    <strong>Safety Notice (Auto-appended):</strong> &ldquo;Packaging artwork, colors, or strip designs may vary across manufacturer batches. Please verify the active medicine name and strength printed on your physical strip.&rdquo;
                  </div>
                </div>

                {/* Admin Verification Notice */}
                {isPendingReview && (
                  <div className="p-2 rounded-xl bg-sky/5 border border-sky/20 flex items-center gap-2 text-sky text-[11px]">
                    <Sparkles size={13} className="shrink-0" />
                    <span>Store Owner will automatically be notified on WhatsApp to review and cache this photo.</span>
                  </div>
                )}
              </div>

            </div>
          )}

        </div>

        {/* Modal Footer / Dispatch Actions */}
        <div className="p-4 border-t border-border flex items-center justify-between bg-bg3/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-border bg-bg text-xs font-bold text-muted hover:text-text transition-all active:scale-95"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSend}
            disabled={!selectedMedicine || sending}
            className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md shadow-emerald-600/20 active:scale-95 disabled:opacity-50 flex items-center gap-2"
          >
            {sending ? (
              <>
                <RefreshCw size={13} className="animate-spin" />
                <span>Sending to WhatsApp...</span>
              </>
            ) : (
              <>
                <Send size={13} />
                <span>Approve &amp; Send to WhatsApp</span>
              </>
            )}
          </button>
        </div>

      </div>
    </div>,
    document.body
  );
}
