import React, { useState, useEffect, useRef } from 'react';
import {
  Camera, Upload, X, CheckCircle2, AlertCircle, RefreshCw,
  MessageSquare, ExternalLink, ArrowRight, Plus, Trash2, Images,
  Store as StoreIcon, MapPin
} from 'lucide-react';
import { api } from '../services/api';

interface PrescriptionUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  prefillMedicineName?: string;
  prefillCustomerName?: string;
  prefillCustomerPhone?: string;
  activeStore?: {
    id: number;
    name: string;
    phone: string;
    address?: string;
  };
  stores?: Array<{
    id: number;
    name: string;
    phone: string;
    address?: string;
  }>;
  onSelectStoreId?: (id: number) => void;
}

interface PhotoItem {
  id: string;
  file: File;
  preview: string;
  name: string;
  sizeKb: number;
}

export const PrescriptionUploadModal: React.FC<PrescriptionUploadModalProps> = ({
  isOpen,
  onClose,
  prefillMedicineName = '',
  prefillCustomerName = '',
  prefillCustomerPhone = '',
  activeStore,
  stores,
  onSelectStoreId
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedPhotos, setSelectedPhotos] = useState<PhotoItem[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<number>(() => activeStore?.id || stores?.[0]?.id || 1);
  const [medicineName, setMedicineName] = useState(prefillMedicineName);
  const [patientName, setPatientName] = useState(prefillCustomerName);
  const [phone, setPhone] = useState(prefillCustomerPhone);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [successResult, setSuccessResult] = useState<{
    order_id: number;
    whatsapp_url: string;
    pharmacy_phone: string;
    pharmacy_name: string;
    photo_count: number;
  } | null>(null);

  // Sync prefilled data and active store when modal opens
  useEffect(() => {
    if (isOpen) {
      setMedicineName(prefillMedicineName);
      if (prefillCustomerName) setPatientName(prefillCustomerName);
      if (prefillCustomerPhone) setPhone(prefillCustomerPhone);
      if (activeStore?.id) {
        setSelectedStoreId(activeStore.id);
      } else if (stores && stores.length > 0) {
        setSelectedStoreId(stores[0].id);
      }
      setErrorMessage(null);
      setSuccessResult(null);
    }
  }, [isOpen, prefillMedicineName, prefillCustomerName, prefillCustomerPhone, activeStore, stores]);

  // Clean up preview blob URLs on unmount or reset
  useEffect(() => {
    return () => {
      selectedPhotos.forEach(p => {
        if (p.preview && p.preview.startsWith('blob:')) {
          URL.revokeObjectURL(p.preview);
        }
      });
    };
  }, [selectedPhotos]);

  if (!isOpen) return null;

  const handleFilesSelect = (files: FileList | File[]) => {
    const validPhotos: PhotoItem[] = [];
    const maxFileSize = 15 * 1024 * 1024; // 15MB per photo

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) {
        continue;
      }
      if (file.size > maxFileSize) {
        setErrorMessage(`File "${file.name}" exceeds 15MB limit and was skipped.`);
        continue;
      }

      validPhotos.push({
        id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${i}`,
        file,
        preview: URL.createObjectURL(file),
        name: file.name,
        sizeKb: Math.round(file.size / 1024)
      });
    }

    if (validPhotos.length === 0 && files.length > 0) {
      setErrorMessage('Please select valid image files (JPG, PNG, WEBP) under 15MB each.');
      return;
    }

    setErrorMessage(null);
    setSelectedPhotos(prev => {
      const combined = [...prev, ...validPhotos];
      if (combined.length > 10) {
        setErrorMessage('Maximum 10 photos can be attached per prescription order.');
        return combined.slice(0, 10);
      }
      return combined;
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesSelect(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleRemovePhoto = (id: string) => {
    setSelectedPhotos(prev => {
      const target = prev.find(p => p.id === id);
      if (target?.preview && target.preview.startsWith('blob:')) {
        URL.revokeObjectURL(target.preview);
      }
      return prev.filter(p => p.id !== id);
    });
  };

  const handleClearAllPhotos = () => {
    selectedPhotos.forEach(p => {
      if (p.preview && p.preview.startsWith('blob:')) {
        URL.revokeObjectURL(p.preview);
      }
    });
    setSelectedPhotos([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
      reader.readAsDataURL(file);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedName = patientName.trim();
    const cleanPhone = phone.replace(/\D/g, '');

    if (!trimmedName) {
      setErrorMessage('Please enter the patient or customer name.');
      return;
    }

    if (!cleanPhone || cleanPhone.length < 10) {
      setErrorMessage('Please enter a valid 10-digit mobile/WhatsApp number.');
      return;
    }

    if (selectedPhotos.length === 0 && !medicineName.trim()) {
      setErrorMessage('Please upload at least one prescription/medicine photo, or enter the medicine name.');
      return;
    }

    setIsSubmitting(true);

    try {
      // Convert all selected photos to base64
      let base64Images: string[] = [];
      if (selectedPhotos.length > 0) {
        base64Images = await Promise.all(selectedPhotos.map(p => fileToBase64(p.file)));
      }

      const currentStore = stores?.find(s => s.id === selectedStoreId) || activeStore || stores?.[0];
      const targetStoreId = currentStore?.id || selectedStoreId || 1;

      const res = await api.submitPrescriptionRequest({
        customer_name: trimmedName,
        customer_phone: cleanPhone,
        medicine_name: medicineName.trim() || undefined,
        notes: notes.trim() || undefined,
        images: base64Images.length > 0 ? base64Images : undefined,
        image: base64Images.length === 1 ? base64Images[0] : undefined,
        store_id: targetStoreId
      });

      if (res.success) {
        setSuccessResult({
          order_id: res.order_id,
          whatsapp_url: res.whatsapp_url,
          pharmacy_phone: res.pharmacy_phone,
          pharmacy_name: res.pharmacy_name,
          photo_count: selectedPhotos.length
        });

        // Automatically open WhatsApp redirect in a new tab
        if (res.whatsapp_url) {
          try {
            window.open(res.whatsapp_url, '_blank');
          } catch (_) {}
        }
      } else {
        setErrorMessage(res.message || 'Failed to submit request. Please try again.');
      }
    } catch (err: any) {
      console.error('[PrescriptionUploadModal] Submission failed:', err);
      setErrorMessage(err.response?.data?.error || err.message || 'Network error while submitting. Please check connection.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentStore = stores?.find(s => s.id === selectedStoreId) || activeStore || stores?.[0];
  const pharmacyContact = currentStore?.phone || activeStore?.phone || 'Saved Pharmacy WhatsApp';

  return (
    <div
      className="fixed inset-0 z-50 bg-bg3/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="bg-bg2 border border-border rounded-3xl shadow-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-5 sm:p-6 border-b border-border flex items-center justify-between sticky top-0 bg-bg2/95 backdrop-blur-sm z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-text leading-snug">
                Upload Prescriptions / Medicine Photos
              </h2>
              <p className="text-xs text-muted">
                Direct WhatsApp redirect to {currentStore?.name || activeStore?.name || 'Pharmacy Counter'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="w-8 h-8 rounded-full bg-bg flex items-center justify-center text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-5">
          {successResult ? (
            /* SUCCESS CONFIRMATION STATE */
            <div className="text-center py-6 space-y-5">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-10 h-10" />
              </div>

              <div className="space-y-1.5">
                <h3 className="text-xl font-bold text-text">Prescription Request Sent!</h3>
                <p className="text-xs text-muted max-w-sm mx-auto">
                  Your inquiry with <strong className="text-text">{successResult.photo_count} {successResult.photo_count === 1 ? 'photo' : 'photos'}</strong> has been registered as <strong className="text-text">Order #{successResult.order_id}</strong> in our pharmacy system.
                </p>
              </div>

              {/* Pharmacy WhatsApp Info Card */}
              <div className="bg-bg p-4 rounded-2xl border border-border text-left space-y-2">
                <div className="flex items-center justify-between text-xs text-muted pb-2 border-b border-border">
                  <span>Pharmacy Counter</span>
                  <span className="font-semibold text-text">{successResult.pharmacy_name}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted pb-2 border-b border-border">
                  <span>Store WhatsApp</span>
                  <span className="font-mono font-bold text-emerald-600">+{successResult.pharmacy_phone}</span>
                </div>
                <p className="text-[11px] text-muted pt-1">
                  Our counter pharmacist will inspect your uploaded photos, verify counter stock batches, and send you the exact price estimate with a UPI payment QR code on WhatsApp.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2.5 pt-2">
                <a
                  href={successResult.whatsapp_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>Open WhatsApp Chat Directly</span>
                  <ExternalLink className="w-3.5 h-3.5 ml-1" />
                </a>

                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-2.5 bg-bg border border-border rounded-xl text-xs font-semibold text-text hover:bg-bg3 transition-colors cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            /* SUBMISSION FORM */
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Destination Pharmacy Branch Confirmation / Selector */}
              <div className="bg-bg p-3.5 rounded-2xl border border-border space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
                      <StoreIcon className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-muted uppercase tracking-wider block">
                        Directing WhatsApp To Registered Pharmacy
                      </span>
                      <span className="text-xs font-bold text-text">
                        {currentStore?.name || 'Selected Pharmacy Branch'}
                      </span>
                    </div>
                  </div>

                  {/* Branch selector if multiple branches available */}
                  {stores && stores.length > 1 && (
                    <div className="shrink-0">
                      <select
                        aria-label="Select Destination Pharmacy"
                        value={selectedStoreId}
                        onChange={e => {
                          const newId = parseInt(e.target.value, 10);
                          setSelectedStoreId(newId);
                          if (onSelectStoreId) onSelectStoreId(newId);
                        }}
                        className="bg-bg2 border border-border rounded-xl px-2.5 py-1.5 text-xs font-semibold text-text focus:outline-none focus:border-primary"
                      >
                        {stores.map(st => (
                          <option key={st.id} value={st.id}>
                            {st.name} {st.address ? `(${st.address})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 text-[11px] text-muted border-t border-border/60">
                  {currentStore?.address && (
                    <span className="truncate max-w-[280px]">📍 {currentStore.address}</span>
                  )}
                  {currentStore?.phone && (
                    <span className="font-mono text-emerald-600 font-semibold flex items-center gap-1">
                      <MessageSquare className="w-3 h-3" />
                      <span>WhatsApp: +{currentStore.phone.replace(/\D/g, '')}</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Multiple Photos Upload Zone */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-text flex items-center gap-1.5">
                    <Images className="w-4 h-4 text-primary" />
                    <span>Prescription Slips & Medicine Box Photos</span>
                    {selectedPhotos.length > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary">
                        {selectedPhotos.length} / 10
                      </span>
                    )}
                  </label>
                  {selectedPhotos.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearAllPhotos}
                      className="text-[11px] text-red-500 hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Clear All</span>
                    </button>
                  )}
                </div>

                {/* Photo Thumbnails Grid */}
                {selectedPhotos.length > 0 ? (
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto p-1">
                      {selectedPhotos.map((photo, idx) => (
                        <div
                          key={photo.id}
                          className="relative rounded-xl overflow-hidden border border-border bg-bg group shadow-xs flex flex-col justify-between"
                        >
                          <div className="relative w-full h-24 bg-bg3/30 flex items-center justify-center overflow-hidden">
                            <img
                              src={photo.preview}
                              alt={`Prescription Page ${idx + 1}`}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            />
                            {/* Page Badge */}
                            <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-bg/90 backdrop-blur-xs text-[10px] font-bold text-text border border-border">
                              Page {idx + 1}
                            </span>
                            {/* Delete Button */}
                            <button
                              type="button"
                              onClick={() => handleRemovePhoto(photo.id)}
                              aria-label={`Remove photo ${idx + 1}`}
                              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500/90 hover:bg-red-600 text-white flex items-center justify-center shadow-md transition-colors cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="p-1.5 bg-bg2 border-t border-border flex items-center justify-between text-[10px] text-muted">
                            <span className="truncate max-w-[90px]" title={photo.name}>
                              {photo.name}
                            </span>
                            <span>{photo.sizeKb} KB</span>
                          </div>
                        </div>
                      ))}

                      {/* "+ Add More Photos" Tile in Grid */}
                      {selectedPhotos.length < 10 && (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="h-32 border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 rounded-xl flex flex-col items-center justify-center gap-1 text-muted hover:text-primary transition-all cursor-pointer"
                        >
                          <Plus className="w-5 h-5" />
                          <span className="text-[11px] font-bold">+ Add Photo</span>
                          <span className="text-[9px] opacity-70">Next Page / Box</span>
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  /* Empty State Drag & Drop Box */
                  <div
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-colors flex flex-col items-center justify-center gap-2 ${
                      isDragOver
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50 hover:bg-bg3/30'
                    }`}
                  >
                    <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                      <Upload className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-text">
                        Click or tap to snap / upload multiple photos
                      </p>
                      <p className="text-[11px] text-muted mt-0.5">
                        Upload prescription pages, medicine box front & back, or multiple strips
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 pt-1">
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-bg text-muted border border-border font-medium">
                        Multiple Pages Allowed
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-bg text-muted border border-border font-medium">
                        Up to 10 Photos
                      </span>
                    </div>
                  </div>
                )}

                {/* Hidden File Input with `multiple` */}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={e => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleFilesSelect(e.target.files);
                    }
                  }}
                />
              </div>

              {/* Medicine Name (Pre-filled if searching) */}
              <div className="space-y-1">
                <label htmlFor="modal-med-name" className="text-xs font-bold text-text">
                  Medicine / Item Name <span className="font-normal text-muted">(Optional if in photo)</span>
                </label>
                <input
                  id="modal-med-name"
                  type="text"
                  value={medicineName}
                  onChange={e => setMedicineName(e.target.value)}
                  placeholder="e.g. Glycomet GP 1, Augmentin 625, etc."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-bg border border-border text-xs text-text placeholder:text-muted/60 focus:outline-hidden focus:border-primary transition-colors"
                />
              </div>

              {/* Patient Details Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="modal-patient-name" className="text-xs font-bold text-text">
                    Patient / Customer Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="modal-patient-name"
                    type="text"
                    required
                    value={patientName}
                    onChange={e => setPatientName(e.target.value)}
                    placeholder="Full Name"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-bg border border-border text-xs text-text placeholder:text-muted/60 focus:outline-hidden focus:border-primary transition-colors"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="modal-patient-phone" className="text-xs font-bold text-text">
                    Mobile / WhatsApp Number <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="modal-patient-phone"
                    type="tel"
                    required
                    maxLength={10}
                    value={phone}
                    onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
                    placeholder="10-digit number"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-bg border border-border text-xs text-text placeholder:text-muted/60 focus:outline-hidden focus:border-primary transition-colors"
                  />
                </div>
              </div>

              {/* Additional Notes */}
              <div className="space-y-1">
                <label htmlFor="modal-notes" className="text-xs font-bold text-text">
                  Quantity or Special Instructions <span className="font-normal text-muted">(Optional)</span>
                </label>
                <textarea
                  id="modal-notes"
                  rows={2}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="e.g. Need 2 strips for monthly diabetic refill, urgently required"
                  className="w-full px-3.5 py-2 rounded-xl bg-bg border border-border text-xs text-text placeholder:text-muted/60 focus:outline-hidden focus:border-primary transition-colors resize-none"
                />
              </div>

              {/* Pharmacy WhatsApp Target Info Box */}
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-2.5 text-xs text-emerald-700">
                <MessageSquare className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="font-bold block">Connected to Pharmacy WhatsApp Counter</span>
                  <span className="text-[11px] text-emerald-600/90 leading-relaxed block">
                    Your request will redirect directly to <strong className="underline">{pharmacyContact}</strong> (configured in App Settings). Our counter pharmacist will review your photos and reply with the estimate.
                  </span>
                </div>
              </div>

              {/* Error Alert */}
              {errorMessage && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center gap-2 text-xs text-red-500">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Submit Action */}
              <div className="pt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 bg-bg border border-border rounded-xl text-xs font-semibold text-text hover:bg-bg3 transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-2 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Sending {selectedPhotos.length > 1 ? `${selectedPhotos.length} Photos` : 'Photo'}...</span>
                    </>
                  ) : (
                    <>
                      <MessageSquare className="w-4 h-4" />
                      <span>
                        Send {selectedPhotos.length > 1 ? `${selectedPhotos.length} Photos` : ''} to WhatsApp
                      </span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
