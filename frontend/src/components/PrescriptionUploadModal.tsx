import React, { useState, useEffect, useRef } from 'react';
import {
  Camera, Upload, X, CheckCircle2, AlertCircle, RefreshCw,
  MessageSquare, ExternalLink, ArrowRight, Plus, Trash2, Images,
  Store as StoreIcon, MapPin, ShieldCheck, Sparkles, Pill, Check
} from 'lucide-react';
import { api } from '../services/api';
import { optimizeImageForUpload } from '../utils/imageOptimizer';

const DOSAGE_FORM_OPTIONS = [
  { key: 'TABLET', label: 'Tablet / Capsule', icon: '💊', sub: 'Solid strips (Dolo, Telma, Pan-D)' },
  { key: 'SYRUP', label: 'Syrup / Liquid', icon: '🧴', sub: 'Liquid bottles (Cough Syp, Suspension)' },
  { key: 'CREAM', label: 'Cream / Ointment', icon: '🩹', sub: 'Tubes (Volini, Betadine, Gel)' },
  { key: 'DROPS', label: 'Eye / Ear Drops', icon: '💧', sub: 'Liquid drops (Ciplox, Refresh)' },
  { key: 'INJECTION', label: 'Injection / Vial', icon: '💉', sub: 'Insulin, Vials, Syringes' },
  { key: 'OTHER', label: 'Device / Other', icon: '📦', sub: 'Cotton, Bandage, Knee Cap' }
];

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
  base64?: string;
  originalSizeKb?: number;
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
  const [dosageForm, setDosageForm] = useState<string>('TABLET');
  const [companyName, setCompanyName] = useState<string>('');
  const [packSize, setPackSize] = useState<string>('');
  const [estimatedMrp, setEstimatedMrp] = useState('');
  const [patientName, setPatientName] = useState(prefillCustomerName);
  const [phone, setPhone] = useState(prefillCustomerPhone);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isScanningPhoto, setIsScanningPhoto] = useState(false);
  const [aiDetectedCard, setAiDetectedCard] = useState<{
    name?: string;
    dosageForm?: string;
    company?: string;
    strength?: string;
    confidence?: number;
  } | null>(null);
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
      setDosageForm('TABLET');
      setCompanyName('');
      setPackSize('');
      setEstimatedMrp('');
      setAiDetectedCard(null);
      setIsScanningPhoto(false);
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

  const handleFilesSelect = async (files: FileList | File[]) => {
    const validPhotos: PhotoItem[] = [];
    const maxFileSize = 25 * 1024 * 1024; // Allow up to 25MB raw phone photos since we compress them client-side

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) {
        continue;
      }
      if (file.size > maxFileSize) {
        setErrorMessage(`File "${file.name}" exceeds 25MB limit and was skipped.`);
        continue;
      }

      try {
        const opt = await optimizeImageForUpload(file, 1400, 0.82);
        validPhotos.push({
          id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${i}`,
          file,
          preview: opt.base64,
          base64: opt.base64,
          name: file.name,
          sizeKb: opt.sizeKb,
          originalSizeKb: opt.originalSizeKb
        });
      } catch (optErr) {
        validPhotos.push({
          id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${i}`,
          file,
          preview: URL.createObjectURL(file),
          name: file.name,
          sizeKb: Math.round(file.size / 1024),
          originalSizeKb: Math.round(file.size / 1024)
        });
      }
    }

    if (validPhotos.length === 0 && files.length > 0) {
      setErrorMessage('Please select valid image files (JPG, PNG, WEBP).');
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

    // Auto-scan first uploaded photo with AI Camera using pre-compressed base64
    if (validPhotos.length > 0) {
      autoScanFirstPhoto(validPhotos[0]);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const autoScanFirstPhoto = async (photoItem: PhotoItem) => {
    try {
      setIsScanningPhoto(true);
      const b64 = photoItem.base64 || await fileToBase64(photoItem.file);
      // Try fast offline prescription scanner first, fallback to analyzeImage
      let res: any;
      try {
        res = await api.scanPrescription(b64);
      } catch {
        res = await api.analyzeImage(b64);
      }

      if (res?.items && res.items.length > 0) {
        const first = res.items[0];
        const topMatch = first.matchedMedicines?.[0];
        const detectedName = topMatch?.name || first.brandName || '';
        const detectedForm = first.dosageForm || 'TABLET';
        const detectedStr = first.strength || '';
        const detectedComp = topMatch?.manufacturer || '';

        setAiDetectedCard({
          name: detectedName || first.brandName || 'Prescription Medicines',
          dosageForm: detectedForm,
          company: detectedComp,
          strength: detectedStr,
          confidence: 95
        });

        if (detectedName) {
          setMedicineName(detectedName);
        }
        setDosageForm(detectedForm === 'CAPSULE' ? 'TABLET' : detectedForm);
        if (detectedComp) setCompanyName(detectedComp);
        if (detectedStr) setPackSize(detectedStr);

        // Prepend notes with all detected medicines and doctor if multiple items found
        if (res.items.length > 1) {
          const summary = `Detected Prescribed Medicines:\n` + res.items.map((it: any, idx: number) => {
            const m = it.matchedMedicines?.[0];
            return `${idx + 1}. ${m?.name || it.brandName} (${it.dosageForm}) - Qty: ${it.prescribedQuantity}`;
          }).join('\n');
          setNotes(prev => prev ? `${prev}\n\n${summary}` : summary);
        }
      } else if (res && (res.potentialName || res.rawText)) {
        const detectedName = res.potentialName || '';
        const detectedForm = res.detectedDosageForm || '';
        const detectedStr = res.strength || '';
        const detectedComp = res.company || res.detectedCompany || '';

        setAiDetectedCard({
          name: detectedName || 'Medicine Strip/Box',
          dosageForm: detectedForm || 'TABLET',
          company: detectedComp,
          strength: detectedStr,
          confidence: Math.round((res.confidence || 0.88) * 100)
        });

        if (detectedName) {
          setMedicineName(detectedName);
        }
        if (detectedForm) {
          const upper = detectedForm.toUpperCase();
          if (upper.includes('TAB') || upper.includes('CAP')) setDosageForm('TABLET');
          else if (upper.includes('SYP') || upper.includes('SUSP') || upper.includes('LIQUID')) setDosageForm('SYRUP');
          else if (upper.includes('CREAM') || upper.includes('OINT') || upper.includes('GEL')) setDosageForm('CREAM');
          else if (upper.includes('DROP')) setDosageForm('DROPS');
          else if (upper.includes('INJ') || upper.includes('VIAL')) setDosageForm('INJECTION');
          else setDosageForm('OTHER');
        }
        if (detectedComp) {
          setCompanyName(detectedComp);
        }
        if (detectedStr) {
          setPackSize(detectedStr);
        }
      }
    } catch (scanErr) {
      console.warn('[PrescriptionUploadModal] AI auto-scan notification:', scanErr);
    } finally {
      setIsScanningPhoto(false);
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
    setAiDetectedCard(null);
    setIsScanningPhoto(false);
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
      // Convert all selected photos to base64 using pre-optimized payload
      let base64Images: string[] = [];
      if (selectedPhotos.length > 0) {
        base64Images = await Promise.all(
          selectedPhotos.map(p => (p.base64 ? Promise.resolve(p.base64) : fileToBase64(p.file)))
        );
      }

      const currentStore = stores?.find(s => s.id === selectedStoreId) || activeStore || stores?.[0];
      const targetStoreId = currentStore?.id || selectedStoreId || 1;

      const parsedMrp = estimatedMrp ? parseFloat(estimatedMrp) : undefined;
      const res = await api.submitPrescriptionRequest({
        customer_name: trimmedName,
        customer_phone: cleanPhone,
        medicine_name: medicineName.trim() || undefined,
        dosage_form: dosageForm || undefined,
        company_name: companyName.trim() || undefined,
        pack_size: packSize.trim() || undefined,
        mrp: (parsedMrp && !isNaN(parsedMrp)) ? parsedMrp : undefined,
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

        // No automatic redirect to WhatsApp — customer stays 100% on the web app!
        // The backend autonomously analyzes the prescription and notifies the pharmacy counter.
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
                Submitted directly to {currentStore?.name || activeStore?.name || 'Pharmacy Counter'}
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
                <h3 className="text-xl font-bold text-text">Request Received in App!</h3>
                <p className="text-xs text-muted max-w-sm mx-auto">
                  Your inquiry with <strong className="text-text">{successResult.photo_count > 0 ? `${successResult.photo_count} ${successResult.photo_count === 1 ? 'photo' : 'photos'}` : 'medicine details'}</strong> has been registered as <strong className="text-text">Order #{successResult.order_id}</strong> in our pharmacy system.
                </p>
              </div>

              {/* Pharmacy Received Info Card */}
              <div className="bg-bg p-4 rounded-2xl border border-border text-left space-y-2">
                <div className="flex items-center justify-between text-xs text-muted pb-2 border-b border-border">
                  <span>Pharmacy Branch</span>
                  <span className="font-semibold text-text">{successResult.pharmacy_name}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted pb-2 border-b border-border">
                  <span>Pharmacy WhatsApp</span>
                  <span className="font-mono font-bold text-primary">+{successResult.pharmacy_phone}</span>
                </div>
                <p className="text-[11px] text-muted pt-1">
                  Our counter pharmacist is reviewing your medicine request, verifying stock batches, and will send you the exact price estimate with a UPI payment QR code directly on WhatsApp.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2.5 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-3 bg-primary hover:bg-primary/90 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Done (Return to Store)</span>
                </button>

                {successResult.whatsapp_url && (
                  <a
                    href={successResult.whatsapp_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-2 bg-transparent text-muted hover:text-text font-medium text-[11px] transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Need to message pharmacy directly on WhatsApp? (Optional)</span>
                    <ExternalLink className="w-3 h-3 ml-0.5 opacity-70" />
                  </a>
                )}
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
                        Receiving Pharmacy Branch
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
                            <span className="font-mono text-emerald-600 font-medium" title={photo.originalSizeKb ? `Optimized from ${photo.originalSizeKb} KB` : undefined}>
                              {photo.sizeKb} KB
                            </span>
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

              {/* AI Auto-Detection Card / Scanner */}
              {isScanningPhoto && (
                <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-2.5 animate-pulse text-xs text-emerald-700 font-semibold">
                  <RefreshCw className="w-4 h-4 animate-spin text-emerald-600 shrink-0" />
                  <span>AI Scanning photo label... identifying medicine, type & company...</span>
                </div>
              )}

              {aiDetectedCard && !isScanningPhoto && (
                <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-1.5 text-xs text-text">
                  <div className="flex items-center justify-between">
                    <span className="font-bold flex items-center gap-1 text-emerald-700">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                      <span>AI Auto-Detected from Photo:</span>
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-800 text-[10px] font-bold">
                      {aiDetectedCard.confidence}% Match
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs">
                    <span className="font-bold text-text bg-bg px-2 py-1 rounded-lg border border-border">
                      {aiDetectedCard.name || medicineName}
                    </span>
                    {aiDetectedCard.dosageForm && (
                      <span className="text-muted bg-bg px-2 py-1 rounded-lg border border-border">
                        Type: <strong className="text-text">{aiDetectedCard.dosageForm}</strong>
                      </span>
                    )}
                    {aiDetectedCard.company && (
                      <span className="text-muted bg-bg px-2 py-1 rounded-lg border border-border">
                        Company: <strong className="text-text">{aiDetectedCard.company}</strong>
                      </span>
                    )}
                    {aiDetectedCard.strength && (
                      <span className="text-muted bg-bg px-2 py-1 rounded-lg border border-border">
                        Pack: <strong className="text-text">{aiDetectedCard.strength}</strong>
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted pt-0.5">
                    Fields below have been auto-filled. You can adjust them anytime.
                  </p>
                </div>
              )}

              {/* Minimal 4-Field Layout (Easy for Anyone With Less Knowledge) */}
              
              {/* Field 1: Medicine / Product Name */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label htmlFor="modal-med-name" className="text-xs font-bold text-text flex items-center gap-1">
                    <span>1. Medicine / Product Name</span>
                    <span className="text-red-500 font-bold">*</span>
                  </label>
                  <span className="text-[11px] text-muted">e.g. Dolo 650, Augmentin, Pan-D</span>
                </div>
                <input
                  id="modal-med-name"
                  type="text"
                  value={medicineName}
                  onChange={e => setMedicineName(e.target.value)}
                  placeholder="Type name (e.g. Dolo 650, Pan-D, Augmentin 625, Glycomet GP 1)"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-bg border border-border text-xs sm:text-sm text-text placeholder:text-muted/60 focus:outline-hidden focus:border-primary transition-colors font-medium"
                />
                <p className="text-[10px] text-muted">
                  💡 Type what is written on your strip, bottle or prescription.
                </p>
              </div>

              {/* Field 2: Type / Dosage Form (1-Tap Selection) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-text flex items-center gap-1">
                    <span>2. Type of Medicine</span>
                    <span className="text-red-500 font-bold">*</span>
                  </label>
                  <span className="text-[11px] text-muted">1-Tap Selection</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {DOSAGE_FORM_OPTIONS.map(opt => {
                    const isSelected = dosageForm === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setDosageForm(opt.key)}
                        className={`p-2.5 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-primary/10 border-primary shadow-xs ring-1 ring-primary/30'
                            : 'bg-bg border-border hover:border-primary/50 hover:bg-bg3/30'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="text-base">{opt.icon}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-primary" />}
                        </div>
                        <div className="mt-1">
                          <div className={`text-xs font-bold ${isSelected ? 'text-primary' : 'text-text'}`}>
                            {opt.label}
                          </div>
                          <div className="text-[9px] text-muted truncate mt-0.5">
                            {opt.sub}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted">
                  💡 Tap 💊 Tablet for solid strips, or 🧴 Syrup for liquid bottles.
                </p>
              </div>

              {/* Fields 3 & 4: Company & Pack Size (Optional) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Field 3: Company Name */}
                <div className="space-y-1">
                  <label htmlFor="modal-company-name" className="text-xs font-bold text-text flex items-center justify-between">
                    <span>3. Company / Brand</span>
                    <span className="font-normal text-muted text-[11px]">(Optional)</span>
                  </label>
                  <input
                    id="modal-company-name"
                    type="text"
                    value={companyName}
                    onChange={e => setCompanyName(e.target.value)}
                    placeholder="e.g. Cipla, Sun Pharma, Micro Labs"
                    className="w-full px-3.5 py-2 rounded-xl bg-bg border border-border text-xs text-text placeholder:text-muted/60 focus:outline-hidden focus:border-primary transition-colors"
                  />
                  <p className="text-[10px] text-muted">
                    💡 Leave blank if you don't know the company.
                  </p>
                </div>

                {/* Field 4: Pack Size */}
                <div className="space-y-1">
                  <label htmlFor="modal-pack-size" className="text-xs font-bold text-text flex items-center justify-between">
                    <span>4. Pack Size / Packing</span>
                    <span className="font-normal text-muted text-[11px]">(Optional)</span>
                  </label>
                  <input
                    id="modal-pack-size"
                    type="text"
                    value={packSize}
                    onChange={e => setPackSize(e.target.value)}
                    placeholder="e.g. 10 Tablets, 15 Tab, 100ml, 30g"
                    className="w-full px-3.5 py-2 rounded-xl bg-bg border border-border text-xs text-text placeholder:text-muted/60 focus:outline-hidden focus:border-primary transition-colors"
                  />
                  <p className="text-[10px] text-muted">
                    💡 Leave blank for standard 1 pack.
                  </p>
                </div>
              </div>

              {/* Optional MRP */}
              <div className="space-y-1">
                <label htmlFor="modal-med-mrp" className="text-xs font-bold text-text flex items-center justify-between">
                  <span>Approx. MRP / Budget (₹)</span>
                  <span className="font-normal text-muted text-[11px]">(Optional)</span>
                </label>
                <input
                  id="modal-med-mrp"
                  type="number"
                  step="0.01"
                  min="0"
                  value={estimatedMrp}
                  onChange={e => setEstimatedMrp(e.target.value)}
                  placeholder="e.g. 135"
                  className="w-full px-3.5 py-2 rounded-xl bg-bg border border-border text-xs text-text placeholder:text-muted/60 focus:outline-hidden focus:border-primary transition-colors"
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

              {/* Process Flow Info Box: When Request is Received in the App */}
              <div className="p-3.5 rounded-2xl bg-bg border border-border space-y-2 text-xs">
                <div className="flex items-center gap-2 text-text font-bold">
                  <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
                  <span>When Your Request is Received in the App:</span>
                </div>
                <div className="space-y-1.5 text-[11px] text-muted pl-6">
                  <p className="flex items-start gap-1.5">
                    <span className="font-bold text-primary shrink-0">1.</span>
                    <span>Our counter pharmacist verifies local inventory batches or queries mapped distributor stock.</span>
                  </p>
                  <p className="flex items-start gap-1.5">
                    <span className="font-bold text-primary shrink-0">2.</span>
                    <span>We finalize your exact price and send a secure UPI Payment QR code to your WhatsApp.</span>
                  </p>
                  <p className="flex items-start gap-1.5">
                    <span className="font-bold text-primary shrink-0">3.</span>
                    <span>Your order remains <strong className="text-text">Pending</strong> until payment is verified, then is confirmed and packed immediately.</span>
                  </p>
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
                  className="flex-2 py-2.5 bg-primary hover:opacity-95 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Submitting Request...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Submit Request to Pharmacy</span>
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
