import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { PhoneInputWithBadge } from '../../components/PhoneInputWithBadge';
import { apiClient, api } from '../../services/api';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';
import { broadcastContactDataChanged, updateSettingsCache } from '../../utils/settingsSync';
import { useModalEscape, shortcutEvent } from '../../services/keyboardShortcuts';
import { toastEvent } from '../../services/events';
import type { LocalApiError, StorageLocation, RegisteredDevice } from './settingsTypes';
import { Building2, Trash2, Save, RefreshCw, RotateCcw, X, FileText, MapPin, Plus, Upload, Image as ImageIcon, PenTool, Sliders, Palette, Eye, Move, Phone } from 'lucide-react';

export function StoreProfileTab({ rawSettings, refetchSettings }: { rawSettings: Record<string, string>; refetchSettings: () => void }) {
  const [formData, setFormData] = useState({
    pharmacyName: rawSettings.pharmacy_name || rawSettings.shop_name || rawSettings.store_name || '',
    address: rawSettings.address || rawSettings.shop_address || rawSettings.store_address || '',
    googleMapsUrl: rawSettings.google_maps_url || rawSettings.store_map_link || rawSettings.maps_url || '',
    phone: rawSettings.phone || rawSettings.shop_phone || '',
    gstin: rawSettings.gstin || '',
    drugLicense: rawSettings.drug_license || rawSettings.license_number || '',
    email: rawSettings.email || '',
    ownerWhatsappNumber: rawSettings.owner_whatsapp_number || '',
    defaultTaxRate: rawSettings.default_tax_rate || '18',
    invoicePrefix: rawSettings.invoice_prefix || 'INV-',
    autoPrint: rawSettings.auto_print === 'true',
    defaultPaymentMode: rawSettings.default_payment_mode || 'Cash',
    lowStockThreshold: rawSettings.low_stock_threshold || '10',
    expiryAlertDays: rawSettings.expiry_alert_days || '90',
    requireDoctorOnBill: rawSettings.require_doctor_on_bill !== 'false',
  });

  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  // Stamp & Signature states
  const [stampPreview, setStampPreview] = useState<string | null>(null);
  const [sigPreview, setSigPreview] = useState<string | null>(null);
  const [rawStampImage, setRawStampImage] = useState<string | null>(null);
  const [_rawSigImage, setRawSigImage] = useState<string | null>(null);
  const [stampUploading, setStampUploading] = useState(false);
  const [sigUploading, setSigUploading] = useState(false);
  const [autoRemoveBg, setAutoRemoveBg] = useState(true);

  // Studio Modal State & Coordinates
  const [showStudioModal, setShowStudioModal] = useState(false);
  useModalEscape(showStudioModal, () => setShowStudioModal(false));
  const [stampColorPreset, setStampColorPreset] = useState<'original' | 'blue' | 'violet' | 'red' | 'green'>('original');
  const [shadowThreshold, setShadowThreshold] = useState(218);
  const [stampPosX, setStampPosX] = useState(parseFloat(rawSettings.stamp_pos_x || '410'));
  const [stampPosY, setStampPosY] = useState(parseFloat(rawSettings.stamp_pos_y || '510'));
  const [stampScale, setStampScale] = useState(parseFloat(rawSettings.stamp_scale || '100'));
  const [stampRot, setStampRot] = useState(parseFloat(rawSettings.stamp_rotation || '-12'));
  const [sigPosX, setSigPosX] = useState(parseFloat(rawSettings.sig_pos_x || '415'));
  const [sigPosY, setSigPosY] = useState(parseFloat(rawSettings.sig_pos_y || '620'));
  const [sigScale, setSigScale] = useState(parseFloat(rawSettings.sig_scale || '100'));
  const [activeDragItem, setActiveDragItem] = useState<'stamp' | 'sig' | null>(null);

  // Load existing stamp and signature on mount
  useEffect(() => {
    apiClient.get('/settings/stamp').then(res => {
      if (res.data?.exists && res.data?.dataUrl) {
        setStampPreview(res.data.dataUrl);
        setRawStampImage(res.data.dataUrl);
      }
    }).catch(() => {});

    apiClient.get('/settings/signature').then(res => {
      if (res.data?.exists && res.data?.dataUrl) {
        setSigPreview(res.data.dataUrl);
        setRawSigImage(res.data.dataUrl);
      }
    }).catch(() => {});
  }, []);

  // Helper to process white-background removal, dark shadow stripping, and ink recoloring
  const processInkImage = (rawDataUrl: string, colorPreset: string, threshold: number): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(rawDataUrl);
            return;
          }
          ctx.drawImage(img, 0, 0);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imgData.data;

          const colors: Record<string, [number, number, number]> = {
            blue: [29, 78, 216],
            violet: [109, 40, 217],
            red: [220, 38, 38],
            green: [5, 150, 105],
          };
          const targetColor = colors[colorPreset];

          // 1. Calculate estimated paper background brightness
          let brightnessSum = 0;
          let brightPixelCount = 0;
          for (let i = 0; i < data.length; i += 16) {
            const b = (data[i] + data[i + 1] + data[i + 2]) / 3;
            if (b > 120) {
              brightnessSum += b;
              brightPixelCount++;
            }
          }
          const estimatedPaperBg = brightPixelCount > 0 ? Math.min(250, Math.max(160, brightnessSum / brightPixelCount)) : 220;
          const effectiveThreshold = Math.min(threshold, estimatedPaperBg - 10);

          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const brightness = (r + g + b) / 3;
            const maxC = Math.max(r, g, b);
            const minC = Math.min(r, g, b);
            const chroma = maxC - minC;
            const saturation = maxC > 0 ? chroma / maxC : 0;

            // (A) Colored ink detection (blue ballpoint pen, purple stamp, red stamp, green ink)
            const isColoredInk = saturation >= 0.08 && chroma >= 14;

            // (B) Pen / ink stroke detection (darker than surrounding paper)
            const isPenStroke = brightness < (estimatedPaperBg - 26) || brightness < 140;

            // (C) Neutral paper background & shadows
            const isNeutralTone = chroma < 14;
            const isPaperBackground = brightness >= effectiveThreshold;
            const isShadow = isNeutralTone && !isPenStroke;

            if (isPaperBackground || isShadow) {
              data[i + 3] = 0; // 100% transparent
            } else {
              // Calculate alpha based on ink confidence
              let alpha = 255;
              if (isColoredInk) {
                alpha = Math.min(255, Math.max(80, Math.floor((saturation / 0.2) * 255)));
              } else {
                const strokeDarkness = Math.max(0, estimatedPaperBg - brightness);
                alpha = Math.min(255, Math.max(80, Math.floor((strokeDarkness / 45) * 255)));
              }
              data[i + 3] = alpha;

              if (targetColor) {
                const darkness = isColoredInk ? Math.min(1, Math.max(0.4, saturation * 1.5)) : (1 - brightness / 255);
                data[i] = Math.round(targetColor[0] * (0.25 + 0.75 * darkness));
                data[i + 1] = Math.round(targetColor[1] * (0.25 + 0.75 * darkness));
                data[i + 2] = Math.round(targetColor[2] * (0.25 + 0.75 * darkness));
              }
            }
          }
          ctx.putImageData(imgData, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch {
          resolve(rawDataUrl);
        }
      };
      img.onerror = () => resolve(rawDataUrl);
      img.src = rawDataUrl;
    });
  };

  const handleUploadStamp = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStampUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (re) => {
        const rawData = re.target?.result as string;
        setRawStampImage(rawData);
        const processed = await processInkImage(rawData, stampColorPreset, shadowThreshold);
        setStampPreview(processed);
        await apiClient.post('/settings/upload-stamp', { image: processed });
        toastEvent.trigger('Stamp uploaded. Studio opened to adjust placement & ink style.', 'info');
        setShowStudioModal(true);
        refetchSettings();
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      toastEvent.trigger('Failed to upload stamp: ' + (err?.message || 'Unknown error'), 'error');
    } finally {
      setStampUploading(false);
      e.target.value = '';
    }
  };

  const handleDeleteStamp = async () => {
    try {
      await apiClient.delete('/settings/stamp');
      setStampPreview(null);
      setRawStampImage(null);
      toastEvent.trigger('Custom stamp removed. Switched to default digital stamp.', 'info');
      refetchSettings();
    } catch (err: any) {
      toastEvent.trigger('Failed to remove stamp: ' + (err?.message || 'Unknown error'), 'error');
    }
  };

  const handleUploadSignature = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSigUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (re) => {
        const rawData = re.target?.result as string;
        setRawSigImage(rawData);
        const processed = await processInkImage(rawData, 'original', shadowThreshold);
        setSigPreview(processed);
        await apiClient.post('/settings/upload-signature', { image: processed });
        toastEvent.trigger('Signature uploaded. Studio opened to adjust position.', 'info');
        setShowStudioModal(true);
        refetchSettings();
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      toastEvent.trigger('Failed to upload signature: ' + (err?.message || 'Unknown error'), 'error');
    } finally {
      setSigUploading(false);
      e.target.value = '';
    }
  };

  const handleDeleteSignature = async () => {
    try {
      await apiClient.delete('/settings/signature');
      setSigPreview(null);
      setRawSigImage(null);
      toastEvent.trigger('Custom signature removed.', 'info');
      refetchSettings();
    } catch (err: any) {
      toastEvent.trigger('Failed to remove signature: ' + (err?.message || 'Unknown error'), 'error');
    }
  };

  // Re-process stamp image when ink color preset or threshold changes
  const handleColorChange = async (preset: 'original' | 'blue' | 'violet' | 'red' | 'green') => {
    setStampColorPreset(preset);
    if (rawStampImage) {
      const updated = await processInkImage(rawStampImage, preset, shadowThreshold);
      setStampPreview(updated);
    }
  };

  const handleThresholdChange = async (val: number) => {
    setShadowThreshold(val);
    if (rawStampImage) {
      const updated = await processInkImage(rawStampImage, stampColorPreset, val);
      setStampPreview(updated);
    }
  };

  const handleSaveStoreProfile = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, string> = {
        pharmacy_name: formData.pharmacyName,
        shop_name: formData.pharmacyName,
        store_name: formData.pharmacyName,
        address: formData.address,
        shop_address: formData.address,
        store_address: formData.address,
        google_maps_url: formData.googleMapsUrl,
        phone: formData.phone,
        shop_phone: formData.phone,
        gstin: formData.gstin,
        drug_license: formData.drugLicense,
        email: formData.email,
        owner_whatsapp_number: formData.ownerWhatsappNumber,
        default_tax_rate: formData.defaultTaxRate,
        invoice_prefix: formData.invoicePrefix,
        auto_print: formData.autoPrint ? 'true' : 'false',
        default_payment_mode: formData.defaultPaymentMode,
        low_stock_threshold: formData.lowStockThreshold,
        expiry_alert_days: formData.expiryAlertDays,
        require_doctor_on_bill: formData.requireDoctorOnBill ? 'true' : 'false',
        stamp_pos_x: String(Math.round(stampPosX)),
        stamp_pos_y: String(Math.round(stampPosY)),
        stamp_scale: String(Math.round(stampScale)),
        stamp_rotation: String(Math.round(stampRot)),
        sig_pos_x: String(Math.round(sigPosX)),
        sig_pos_y: String(Math.round(sigPosY)),
        sig_scale: String(Math.round(sigScale)),
      };

      await apiClient.post('/settings/save', payload);
      toastEvent.trigger('Store profile updated successfully', 'success');
      updateSettingsCache(queryClient, payload);
      broadcastContactDataChanged(queryClient);
      refetchSettings();
    } catch (err: any) {
      toastEvent.trigger('Failed to save store profile: ' + (err?.message || 'Unknown error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveStoreProfileRef = useRef(handleSaveStoreProfile);
  handleSaveStoreProfileRef.current = handleSaveStoreProfile;

  useEffect(() => {
    return shortcutEvent.subscribeSave(() => {
      void handleSaveStoreProfileRef.current();
    });
  }, []);

  const handleApplyStudioSettings = async () => {
    setSaving(true);
    try {
      const payload: Record<string, string> = {
        pharmacy_name: formData.pharmacyName,
        shop_name: formData.pharmacyName,
        store_name: formData.pharmacyName,
        address: formData.address,
        shop_address: formData.address,
        store_address: formData.address,
        google_maps_url: formData.googleMapsUrl,
        phone: formData.phone,
        shop_phone: formData.phone,
        gstin: formData.gstin,
        drug_license: formData.drugLicense,
        email: formData.email,
        owner_whatsapp_number: formData.ownerWhatsappNumber,
        default_tax_rate: formData.defaultTaxRate,
        invoice_prefix: formData.invoicePrefix,
        auto_print: formData.autoPrint ? 'true' : 'false',
        default_payment_mode: formData.defaultPaymentMode,
        low_stock_threshold: formData.lowStockThreshold,
        expiry_alert_days: formData.expiryAlertDays,
        require_doctor_on_bill: formData.requireDoctorOnBill ? 'true' : 'false',
        stamp_pos_x: String(Math.round(stampPosX)),
        stamp_pos_y: String(Math.round(stampPosY)),
        stamp_scale: String(Math.round(stampScale)),
        stamp_rotation: String(Math.round(stampRot)),
        sig_pos_x: String(Math.round(sigPosX)),
        sig_pos_y: String(Math.round(sigPosY)),
        sig_scale: String(Math.round(sigScale)),
      };

      await apiClient.post('/settings/save', payload);

      if (stampPreview && stampPreview.startsWith('data:image')) {
        try {
          await apiClient.post('/settings/upload-stamp', { image: stampPreview });
        } catch (stampErr) {
          console.warn('Stamp image upload sync:', stampErr);
        }
      }
      if (sigPreview && sigPreview.startsWith('data:image')) {
        try {
          await apiClient.post('/settings/upload-signature', { image: sigPreview });
        } catch (sigErr) {
          console.warn('Signature image upload sync:', sigErr);
        }
      }

      toastEvent.trigger('Store profile & PDF Bill layout saved successfully!', 'success');
      updateSettingsCache(queryClient, payload);
      broadcastContactDataChanged(queryClient);
      refetchSettings();
      setShowStudioModal(false);
    } catch (err: any) {
      toastEvent.trigger('Failed to save settings: ' + (err?.message || 'Unknown error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Storage Locations state
  const storageLocQuery = useApiQuery<StorageLocation[]>(
    ['storage-locations'],
    () => apiClient.get('/settings/storage-locations').then(res => res.data || []),
  );
  const storageLocations = storageLocQuery.data || [];
  const fetchStorageLocations = () => storageLocQuery.refetch();
  const [storageLocForm, setStorageLocForm] = useState({ name: '', code: '', type: 'rack', description: '', is_default: false, is_active: true });
  const [editingLocId, setEditingLocId] = useState<number | null>(null);

  const handleResetStoreProfile = () => {
    setFormData({
      pharmacyName: rawSettings.pharmacy_name || rawSettings.shop_name || rawSettings.store_name || '',
      address: rawSettings.address || rawSettings.shop_address || rawSettings.store_address || '',
      googleMapsUrl: rawSettings.google_maps_url || rawSettings.store_map_link || rawSettings.maps_url || '',
      phone: rawSettings.phone || rawSettings.shop_phone || '',
      gstin: rawSettings.gstin || '',
      drugLicense: rawSettings.drug_license || rawSettings.license_number || '',
      email: rawSettings.email || '',
      ownerWhatsappNumber: rawSettings.owner_whatsapp_number || '',
      defaultTaxRate: rawSettings.default_tax_rate || '18',
      invoicePrefix: rawSettings.invoice_prefix || 'INV-',
      autoPrint: rawSettings.auto_print === 'true',
      defaultPaymentMode: rawSettings.default_payment_mode || 'Cash',
      lowStockThreshold: rawSettings.low_stock_threshold || '10',
      expiryAlertDays: rawSettings.expiry_alert_days || '90',
      requireDoctorOnBill: rawSettings.require_doctor_on_bill !== 'false',
    });
    toastEvent.trigger('Store profile form reset to saved parameters', 'info');
  };

  const handleSaveStorageLoc = async () => {
    if (!storageLocForm.name.trim()) {
      toastEvent.trigger('Location name is required', 'error');
      return;
    }
    try {
      if (editingLocId) {
        await apiClient.put(`/settings/storage-locations/${editingLocId}`, storageLocForm);
        toastEvent.trigger('Storage location updated', 'success');
      } else {
        await apiClient.post('/settings/storage-locations', storageLocForm);
        toastEvent.trigger('Storage location created', 'success');
      }
      setStorageLocForm({ name: '', code: '', type: 'rack', description: '', is_default: false, is_active: true });
      setEditingLocId(null);
      fetchStorageLocations();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger(e.response?.data?.error || 'Failed to save storage location', 'error');
    }
  };

  const handleDeleteStorageLoc = async (id: number) => {
    try {
      await apiClient.delete(`/settings/storage-locations/${id}`);
      toastEvent.trigger('Storage location deleted', 'success');
      fetchStorageLocations();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger(e.response?.data?.error || 'Failed to delete storage location', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSaveStoreProfile} className="space-y-6">
        {/* Core Pharmacy Details */}
        <div className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2 border-b border-border pb-2">
            <Building2 size={16} /> Core Store Identity & Details
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text mb-1">Pharmacy / Shop Name *</label>
              <input
                type="text"
                required
                value={formData.pharmacyName}
                onChange={(e) => setFormData({ ...formData, pharmacyName: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                placeholder="e.g. LifeCare Pharmacy"
              />
            </div>

            <div>
              <PhoneInputWithBadge
                label="Primary Store Phone / Mobile"
                value={formData.phone}
                onChange={val => setFormData({ ...formData, phone: val })}
                allowEmpty={true}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">Store GSTIN Number</label>
              <input
                type="text"
                value={formData.gstin}
                onChange={(e) => setFormData({ ...formData, gstin: e.target.value.toUpperCase() })}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                placeholder="27AAAAA0000A1Z5"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">Drug License Number(s)</label>
              <input
                type="text"
                value={formData.drugLicense}
                onChange={(e) => setFormData({ ...formData, drugLicense: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                placeholder="Form 20/21 License No."
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">Store Email Address</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                placeholder="pharmacy@example.com"
              />
            </div>

            <div>
              <PhoneInputWithBadge
                label="Owner WhatsApp Contact"
                value={formData.ownerWhatsappNumber}
                onChange={val => setFormData({ ...formData, ownerWhatsappNumber: val })}
                allowEmpty={true}
              />
            </div>

            <div className="md:col-span-2 lg:col-span-3">
              <label className="block text-xs font-semibold text-text mb-1">Complete Store Address</label>
              <textarea
                rows={2}
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                placeholder="Street address, City, Pin code"
              />
            </div>

            <div className="md:col-span-2 lg:col-span-3">
              <label className="block text-xs font-semibold text-text mb-1 flex items-center gap-1.5">
                <MapPin size={13} className="text-primary" /> Google Maps Location / Directions URL
              </label>
              <input
                type="url"
                value={formData.googleMapsUrl}
                onChange={(e) => setFormData({ ...formData, googleMapsUrl: e.target.value.trim() })}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                placeholder="https://maps.app.goo.gl/your-store-location"
              />
              <p className="text-[10px] text-muted mt-1">
                Customers will receive this direct navigation link in WhatsApp order arrival &amp; pickup messages.
              </p>
            </div>
          </div>
        </div>

        {/* Operating Defaults */}
        <div className="space-y-4 pt-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2 border-b border-border pb-2">
            <FileText size={16} /> POS & Invoice Operating Defaults
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text mb-1">Invoice Number Prefix</label>
              <input
                type="text"
                value={formData.invoicePrefix}
                onChange={(e) => setFormData({ ...formData, invoicePrefix: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">Default GST Tax Rate (%)</label>
              <input
                type="number"
                value={formData.defaultTaxRate}
                onChange={(e) => setFormData({ ...formData, defaultTaxRate: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">Default Payment Method</label>
              <select
                value={formData.defaultPaymentMode}
                onChange={(e) => setFormData({ ...formData, defaultPaymentMode: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              >
                <option value="Cash">Cash</option>
                <option value="UPI">UPI / QR Code</option>
                <option value="Card">Credit / Debit Card</option>
                <option value="Credit">Credit Bill (Khata)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">Low Stock Warning Threshold (Qty)</label>
              <input
                type="number"
                value={formData.lowStockThreshold}
                onChange={(e) => setFormData({ ...formData, lowStockThreshold: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">Expiry Alert Period (Days)</label>
              <input
                type="number"
                value={formData.expiryAlertDays}
                onChange={(e) => setFormData({ ...formData, expiryAlertDays: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-3 pt-4">
              <input
                type="checkbox"
                id="autoPrint"
                checked={formData.autoPrint}
                onChange={(e) => setFormData({ ...formData, autoPrint: e.target.checked })}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
              />
              <label htmlFor="autoPrint" className="text-xs font-semibold text-text cursor-pointer">
                Auto-print receipt immediately on sale completion
              </label>
            </div>

            <div className="flex items-center gap-3 pt-4">
              <input
                type="checkbox"
                id="requireDoctorOnBill"
                checked={formData.requireDoctorOnBill}
                onChange={(e) => setFormData({ ...formData, requireDoctorOnBill: e.target.checked })}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
              />
              <label htmlFor="requireDoctorOnBill" className="text-xs font-semibold text-text cursor-pointer">
                Require Doctor Name to save bills in POS (Default: Mandatory)
              </label>
            </div>
          </div>
        </div>

        {/* Digital Pharmacy Stamp & Pharmacist Signature */}
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <PenTool size={16} /> Official Pharmacy Stamp & Signature (PDF & Bill Invoices)
            </h2>
            <label className="flex items-center gap-2 text-xs font-medium text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={autoRemoveBg}
                onChange={(e) => setAutoRemoveBg(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary"
              />
              <span>Auto-remove white paper background (keep colored ink)</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Custom Stamp Card */}
            <div className="bg-bg3/30 border border-border rounded-2xl p-4 flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-text flex items-center gap-1.5">
                    <ImageIcon size={14} className="text-primary" /> Pharmacy Round Stamp
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowStudioModal(true)}
                      className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 transition-all cursor-pointer flex items-center gap-1"
                    >
                      <Eye size={11} /> Open Studio
                    </button>
                    {stampPreview ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                        Custom Stamp Active
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-bg3 text-muted border border-border">
                        Default Digital Stamp
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-muted leading-relaxed">
                  Stamped automatically on the Grand Total of sales bills, WhatsApp invoices, and ledger statements.
                </p>
              </div>

              {/* Preview Area */}
              <div className="h-28 rounded-xl border border-dashed border-border bg-bg2 flex items-center justify-center relative overflow-hidden">
                {stampPreview ? (
                  <div className="relative group flex items-center justify-center p-2">
                    <img
                      src={stampPreview}
                      alt="Pharmacy Stamp"
                      className="max-h-24 max-w-full object-contain filter drop-shadow-sm"
                    />
                  </div>
                ) : (
                  <div className="text-center p-3 text-muted space-y-1">
                    <Building2 size={24} className="mx-auto text-muted/60" />
                    <p className="text-[10px]">Using auto-generated digital seal with your store name & D.L. number</p>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                <label className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm">
                  {stampUploading ? <RefreshCw size={13} className="animate-spin" /> : <Upload size={13} />}
                  <span>{stampPreview ? 'Replace Stamp' : 'Upload Stamp Photo'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleUploadStamp}
                    disabled={stampUploading}
                    className="hidden"
                  />
                </label>
                {stampPreview && (
                  <button
                    type="button"
                    onClick={handleDeleteStamp}
                    className="px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 border border-rose-500/20 font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1"
                    title="Remove custom stamp and use auto-generated stamp"
                  >
                    <Trash2 size={13} />
                    <span>Remove</span>
                  </button>
                )}
              </div>
            </div>

            {/* Custom Signature Card */}
            <div className="bg-bg3/30 border border-border rounded-2xl p-4 flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-text flex items-center gap-1.5">
                    <PenTool size={14} className="text-primary" /> Pharmacist / Authorized Signature
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowStudioModal(true)}
                      className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 transition-all cursor-pointer flex items-center gap-1"
                    >
                      <Eye size={11} /> Open Studio
                    </button>
                    {sigPreview ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                        Signature Active
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-bg3 text-muted border border-border">
                        Manual Sign Line
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-muted leading-relaxed">
                  Printed on the bottom-right over "Authorized Signatory" for registered invoices.
                </p>
              </div>

              {/* Preview Area */}
              <div className="h-28 rounded-xl border border-dashed border-border bg-bg2 flex items-center justify-center relative overflow-hidden">
                {sigPreview ? (
                  <div className="relative group flex items-center justify-center p-2">
                    <img
                      src={sigPreview}
                      alt="Pharmacist Signature"
                      className="max-h-24 max-w-full object-contain filter drop-shadow-sm"
                    />
                  </div>
                ) : (
                  <div className="text-center p-3 text-muted space-y-1">
                    <PenTool size={24} className="mx-auto text-muted/60" />
                    <p className="text-[10px]">No signature uploaded. A physical signature line is displayed.</p>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                <label className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm">
                  {sigUploading ? <RefreshCw size={13} className="animate-spin" /> : <Upload size={13} />}
                  <span>{sigPreview ? 'Replace Signature' : 'Upload Signature'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleUploadSignature}
                    disabled={sigUploading}
                    className="hidden"
                  />
                </label>
                {sigPreview && (
                  <button
                    type="button"
                    onClick={handleDeleteSignature}
                    className="px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 border border-rose-500/20 font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1"
                    title="Remove signature"
                  >
                    <Trash2 size={13} />
                    <span>Remove</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={handleResetStoreProfile}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 bg-bg3 border border-border text-muted hover:text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer"
          >
            <RotateCcw size={14} />
            <span>Reset Form</span>
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            <span>Save Store Profile</span>
          </button>
        </div>
      </form>

      {/* Interactive Stamp & Signature Placement Studio Modal */}
      {showStudioModal && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/75 p-4 sm:p-6 fade-in overflow-y-auto">
          <div className="bg-bg border border-border rounded-3xl w-[95vw] max-w-5xl h-[85vh] min-h-[580px] max-h-[860px] shadow-[0_4px_24px_rgba(0,0,0,0.12)] overflow-hidden flex flex-col">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-border bg-bg3/40 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
                  <Palette size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-text text-sm sm:text-base flex items-center gap-2">
                    Live PDF Bill Placement & Ink Studio
                  </h3>
                  <p className="text-[11px] text-muted">
                    Preview and customize how your pharmacy stamp, signature, and DL No appear on PDF sales invoices
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowStudioModal(false)}
                className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body: Left side Canvas, Right side Controls */}
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 overflow-y-auto">
              
              {/* Left Side: Live Bill Canvas Preview (7 cols) */}
              <div className="lg:col-span-7 flex flex-col items-center">
                <div className="text-xs font-bold text-muted uppercase tracking-wider mb-2 self-start flex items-center gap-1.5">
                  <Eye size={14} className="text-primary" /> Live Invoice Canvas Preview (Drag to Position)
                </div>

                <div 
                  className="w-full rounded-2xl shadow-xl border border-slate-300 p-6 relative overflow-hidden select-none font-sans text-xs flex flex-col justify-between"
                  style={{ minHeight: '520px', maxHeight: '560px', backgroundColor: '#ffffff', color: '#0f172a' }}
                  onMouseMove={(e) => {
                    if (!activeDragItem) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const relX = Math.round(e.clientX - rect.left);
                    const relY = Math.round(e.clientY - rect.top);
                    if (activeDragItem === 'stamp') {
                      setStampPosX(Math.max(20, Math.min(480, relX)));
                      setStampPosY(Math.max(100, Math.min(500, relY)));
                    } else if (activeDragItem === 'sig') {
                      setSigPosX(Math.max(20, Math.min(480, relX)));
                      setSigPosY(Math.max(250, Math.min(520, relY)));
                    }
                  }}
                  onMouseUp={() => setActiveDragItem(null)}
                  onMouseLeave={() => setActiveDragItem(null)}
                >
                  {/* Bill Header */}
                  <div className="text-center border-b border-slate-200 pb-3">
                    <h2 className="text-base font-black uppercase tracking-wide" style={{ color: '#0f172a' }}>
                      {formData.pharmacyName || 'AI PHARMACY & WELLNESS'}
                    </h2>
                    {formData.address && <p className="text-[10px] text-slate-600 mt-0.5">{formData.address}</p>}
                    <p className="text-[10px] font-semibold text-slate-700 mt-0.5">
                      {[
                        formData.phone ? `Ph: ${formData.phone}` : '',
                        formData.drugLicense ? `D.L. No: ${formData.drugLicense}` : 'D.L. No: 20B/21B-49210',
                        formData.gstin ? `GSTIN: ${formData.gstin}` : 'GSTIN: 27AAAAA0000A1Z5'
                      ].filter(Boolean).join(' | ')}
                    </p>
                    <div className="inline-block mt-1 px-2 py-0.5 rounded bg-slate-100 text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                      Tax Invoice / Retail Sale Bill
                    </div>
                  </div>

                  {/* Bill Meta */}
                  <div className="flex justify-between items-center text-[11px] text-slate-700 py-2 border-b border-slate-100">
                    <div>
                      <div><strong style={{ color: '#0f172a' }}>Invoice:</strong> #INV-2026-0892</div>
                      <div><strong style={{ color: '#0f172a' }}>Patient:</strong> John Doe (Walk-in)</div>
                    </div>
                    <div className="text-right">
                      <div><strong style={{ color: '#0f172a' }}>Date:</strong> 30/08/2026</div>
                      <div><strong style={{ color: '#0f172a' }}>Payment:</strong> CASH (PAID)</div>
                    </div>
                  </div>

                  {/* Sample Items Table */}
                  <div className="flex-1 py-2">
                    <table className="w-full text-left text-[10px] border-collapse">
                      <thead>
                        <tr className="border-b border-slate-300 font-bold text-slate-800">
                          <th className="py-1">Medicine</th>
                          <th className="py-1">Batch</th>
                          <th className="py-1">Exp</th>
                          <th className="py-1 text-right">Qty</th>
                          <th className="py-1 text-right">MRP</th>
                          <th className="py-1 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        <tr>
                          <td className="py-1 font-medium" style={{ color: '#0f172a' }}>Paracetamol 650mg IP</td>
                          <td className="py-1 font-mono">B24-819</td>
                          <td className="py-1">05/28</td>
                          <td className="py-1 text-right">15</td>
                          <td className="py-1 text-right">₹2.40</td>
                          <td className="py-1 text-right font-medium">₹36.00</td>
                        </tr>
                        <tr>
                          <td className="py-1 font-medium" style={{ color: '#0f172a' }}>Azithromycin 500mg Tab</td>
                          <td className="py-1 font-mono">AZ-9920</td>
                          <td className="py-1">11/27</td>
                          <td className="py-1 text-right">6</td>
                          <td className="py-1 text-right">₹21.00</td>
                          <td className="py-1 text-right font-medium">₹126.00</td>
                        </tr>
                        <tr>
                          <td className="py-1 font-medium" style={{ color: '#0f172a' }}>Pantoprazole DSR Cap</td>
                          <td className="py-1 font-mono">PNT-44</td>
                          <td className="py-1">08/27</td>
                          <td className="py-1 text-right">10</td>
                          <td className="py-1 text-right">₹14.50</td>
                          <td className="py-1 text-right font-medium">₹145.00</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Totals Section */}
                  <div className="border-t border-slate-200 pt-2 flex justify-end">
                    <div className="w-56 text-[11px] space-y-1 text-slate-700">
                      <div className="flex justify-between">
                        <span>Subtotal:</span>
                        <span className="font-medium">₹307.00</span>
                      </div>
                      <div className="flex justify-between text-rose-600">
                        <span>Discount (5%):</span>
                        <span className="font-medium">-₹15.35</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Tax (5% GST):</span>
                        <span className="font-medium">₹14.58</span>
                      </div>
                      <div className="flex justify-between font-black text-sm pt-1 border-t border-slate-300" style={{ color: '#0f172a' }}>
                        <span>Grand Total:</span>
                        <span className="text-primary font-black">₹306.00</span>
                      </div>
                    </div>
                  </div>

                  {/* Footer with Barcode + Signatory */}
                  <div className="border-t border-slate-200 pt-3 mt-2 flex justify-between items-end">
                    {/* Left: Barcodes */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-10 rounded p-1 flex items-center justify-center font-mono text-[8px]" style={{ backgroundColor: '#0f172a', color: '#ffffff' }}>
                          QR
                        </div>
                        <div className="space-y-0.5">
                          <div className="h-6 w-28 rounded-sm flex items-center justify-center font-mono text-[7px] tracking-widest" style={{ backgroundColor: '#0f172a', color: '#ffffff' }}>
                            |||| ||| ||||| ||
                          </div>
                          <div className="text-[8px] font-mono text-slate-500">INV-2026-0892</div>
                        </div>
                      </div>
                    </div>

                    {/* Right: Signatory Line */}
                    <div className="text-center w-36">
                      <div className="border-b border-slate-300 pb-1 mb-1"></div>
                      <span className="text-[10px] font-bold text-slate-600 uppercase">Authorized Signatory</span>
                    </div>
                  </div>

                  {/* DRAGGABLE STAMP LAYER */}
                  <div
                    onMouseDown={() => setActiveDragItem('stamp')}
                    className="absolute cursor-move group select-none transition-shadow"
                    style={{
                      left: `${stampPosX}px`,
                      top: `${stampPosY}px`,
                      transform: `translate(-50%, -50%) rotate(${stampRot}deg) scale(${stampScale / 100})`,
                      zIndex: 30,
                    }}
                    title="Click and drag to reposition stamp"
                  >
                    <div className="relative p-1 rounded-xl group-hover:ring-2 group-hover:ring-primary group-hover:bg-primary/5">
                      {stampPreview ? (
                        <img
                          src={stampPreview}
                          alt="Custom Stamp"
                          className="max-h-24 max-w-[120px] object-contain filter drop-shadow-md pointer-events-none"
                        />
                      ) : (
                        <div className="w-24 h-24 rounded-full border-2 border-dashed border-emerald-600 flex flex-col items-center justify-center text-emerald-700 bg-emerald-500/10 pointer-events-none p-1 text-center">
                          <span className="text-[7px] font-bold uppercase leading-tight line-clamp-1">{formData.pharmacyName || 'AI PHARMACY'}</span>
                          <span className="text-[9px] font-black my-0.5">PAID &amp; VERIFIED</span>
                          <span className="text-[6px] font-bold uppercase">{formData.drugLicense || 'VERIFIED'}</span>
                        </div>
                      )}
                      <div className="absolute -top-3 -right-3 hidden group-hover:flex items-center gap-1 bg-primary text-white text-[8px] px-1.5 py-0.5 rounded-full font-bold shadow">
                        <Move size={8} /> Drag
                      </div>
                    </div>
                  </div>

                  {/* DRAGGABLE SIGNATURE LAYER */}
                  {sigPreview && (
                    <div
                      onMouseDown={() => setActiveDragItem('sig')}
                      className="absolute cursor-move group select-none transition-shadow"
                      style={{
                        left: `${sigPosX}px`,
                        top: `${sigPosY}px`,
                        transform: `translate(-50%, -50%) scale(${sigScale / 100})`,
                        zIndex: 25,
                      }}
                      title="Click and drag to reposition signature"
                    >
                      <div className="relative p-1 rounded-xl group-hover:ring-2 group-hover:ring-sky group-hover:bg-sky/5">
                        <img
                          src={sigPreview}
                          alt="Signature"
                          className="max-h-14 max-w-[110px] object-contain filter drop-shadow-md pointer-events-none"
                        />
                        <div className="absolute -top-3 -right-3 hidden group-hover:flex items-center gap-1 bg-sky text-white text-[8px] px-1.5 py-0.5 rounded-full font-bold shadow">
                          <Move size={8} /> Drag
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              </div>

              {/* Right Side: Ink Style & Placement Studio Controls (5 cols) */}
              <div className="lg:col-span-5 flex flex-col justify-between space-y-4">
                
                <div className="space-y-4">
                  {/* Ink Color Palette */}
                  <div className="bg-bg3/30 border border-border rounded-2xl p-4 space-y-3">
                    <div className="text-xs font-bold text-text flex items-center gap-1.5">
                      <Palette size={14} className="text-primary" /> Stamp Ink Color &amp; Style
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'original', label: 'Original Ink', color: 'bg-slate-500' },
                        { id: 'blue', label: 'Royal Blue', color: 'bg-blue-600' },
                        { id: 'violet', label: 'Deep Violet', color: 'bg-purple-600' },
                        { id: 'red', label: 'Crimson Red', color: 'bg-red-600' },
                        { id: 'green', label: 'Emerald Green', color: 'bg-emerald-600' },
                      ].map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => handleColorChange(preset.id as any)}
                          className={`px-2.5 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer ${
                            stampColorPreset === preset.id
                              ? 'border-primary bg-primary/15 text-primary shadow-sm'
                              : 'border-border bg-bg2 text-muted hover:text-text'
                          }`}
                        >
                          <span className={`w-2.5 h-2.5 rounded-full ${preset.color}`} />
                          <span className="truncate">{preset.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Paper Shadow Removal Tolerance Slider */}
                  <div className="bg-bg3/30 border border-border rounded-2xl p-4 space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-text flex items-center gap-1.5">
                        <Sliders size={14} className="text-primary" /> White Background &amp; Shadow Removal
                      </span>
                      <span className="font-mono text-muted text-[11px]">{shadowThreshold}</span>
                    </div>
                    <input
                      type="range"
                      min={170}
                      max={245}
                      value={shadowThreshold}
                      onChange={(e) => handleThresholdChange(Number(e.target.value))}
                      className="w-full accent-primary cursor-pointer"
                    />
                    <p className="text-[10px] text-muted">
                      Increase threshold to strip off grey shadows or paper creases from mobile photos.
                    </p>
                  </div>

                  {/* Quick Position Presets */}
                  <div className="bg-bg3/30 border border-border rounded-2xl p-4 space-y-2.5">
                    <div className="text-xs font-bold text-text flex items-center gap-1.5">
                      <Move size={14} className="text-primary" /> Quick Stamp Position Presets
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setStampPosX(390);
                          setStampPosY(380);
                        }}
                        className="p-2 rounded-xl text-[11px] font-bold bg-bg2 border border-border text-muted hover:text-text hover:border-primary transition-all cursor-pointer text-center"
                      >
                        Over Grand Total
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setStampPosX(240);
                          setStampPosY(380);
                        }}
                        className="p-2 rounded-xl text-[11px] font-bold bg-bg2 border border-border text-muted hover:text-text hover:border-primary transition-all cursor-pointer text-center"
                      >
                        Beside Total
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setStampPosX(390);
                          setStampPosY(470);
                        }}
                        className="p-2 rounded-xl text-[11px] font-bold bg-bg2 border border-border text-muted hover:text-text hover:border-primary transition-all cursor-pointer text-center"
                      >
                        Signatory Box
                      </button>
                    </div>
                  </div>

                  {/* Fine Adjustment Sliders */}
                  <div className="bg-bg3/30 border border-border rounded-2xl p-4 space-y-3">
                    <div className="space-y-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-text">Stamp Size Scale</span>
                        <span className="font-mono text-muted text-[11px]">{Math.round(stampScale)}%</span>
                      </div>
                      <input
                        type="range"
                        min={70}
                        max={130}
                        value={stampScale}
                        onChange={(e) => setStampScale(Number(e.target.value))}
                        className="w-full accent-primary cursor-pointer"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-text">Stamp Tilt Angle</span>
                        <span className="font-mono text-muted text-[11px]">{Math.round(stampRot)}°</span>
                      </div>
                      <input
                        type="range"
                        min={-25}
                        max={25}
                        value={stampRot}
                        onChange={(e) => setStampRot(Number(e.target.value))}
                        className="w-full accent-primary cursor-pointer"
                      />
                    </div>

                    {sigPreview && (
                      <div className="space-y-1 pt-1 border-t border-border">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-semibold text-text">Signature Size Scale</span>
                          <span className="font-mono text-muted text-[11px]">{Math.round(sigScale)}%</span>
                        </div>
                        <input
                          type="range"
                          min={70}
                          max={130}
                          value={sigScale}
                          onChange={(e) => setSigScale(Number(e.target.value))}
                          className="w-full accent-primary cursor-pointer"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom Modal Actions */}
                <div className="pt-3 border-t border-border flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowStudioModal(false)}
                    disabled={saving}
                    className="px-4 py-2.5 rounded-xl border border-border text-muted hover:text-text font-bold text-xs bg-bg2 hover:bg-bg3 transition-all cursor-pointer"
                  >
                    Skip &amp; Keep Defaults
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyStudioSettings}
                    disabled={saving}
                    className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-md"
                  >
                    {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                    <span>Apply &amp; Save to PDF Invoices</span>
                  </button>
                </div>

              </div>
            </div>

          </div>
        </div>,
        document.body
      )}

      {/* Storage Racks & Locations */}
      <div className="space-y-4 pt-4 border-t border-border">
        <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2 border-b border-border pb-2">
          <MapPin size={16} /> Physical Storage Racks & Shelves Directory
        </h2>

        <div className="bg-bg3/30 border border-border rounded-xl p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              type="text"
              placeholder="Rack Name (e.g. Rack A-1)"
              value={storageLocForm.name}
              onChange={(e) => setStorageLocForm({ ...storageLocForm, name: e.target.value })}
              className="px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
            />
            <input
              type="text"
              placeholder="Short Code (e.g. R-A1)"
              value={storageLocForm.code}
              onChange={(e) => setStorageLocForm({ ...storageLocForm, code: e.target.value })}
              className="px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
            />
            <select
              value={storageLocForm.type}
              onChange={(e) => setStorageLocForm({ ...storageLocForm, type: e.target.value })}
              className="px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
            >
              <option value="rack">Main Rack</option>
              <option value="fridge">Cold Storage / Fridge</option>
              <option value="drawer">Narcotics Drawer</option>
              <option value="counter">Front Counter Display</option>
            </select>
            <button
              onClick={handleSaveStorageLoc}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer"
            >
              <Plus size={14} /> {editingLocId ? 'Update Location' : 'Add Storage Location'}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="py-2 px-3">Location Name</th>
                  <th className="py-2 px-3">Code</th>
                  <th className="py-2 px-3">Type</th>
                  <th className="py-2 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {storageLocations.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-muted italic">No custom storage locations registered yet.</td>
                  </tr>
                ) : (
                  storageLocations.map((loc) => (
                    <tr key={loc.id} className="hover:bg-bg3/50">
                      <td className="py-2 px-3 font-semibold text-text">{loc.name}</td>
                      <td className="py-2 px-3 text-muted font-mono">{loc.code}</td>
                      <td className="py-2 px-3 uppercase text-[10px] font-bold text-primary">{loc.type}</td>
                      <td className="py-2 px-3 text-right space-x-2">
                        <button
                          onClick={() => {
                            setEditingLocId(loc.id);
                            setStorageLocForm({ name: loc.name, code: loc.code, type: loc.type, description: loc.description || '', is_default: !!loc.is_default, is_active: !!loc.is_active });
                          }}
                          className="text-primary hover:underline font-semibold cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteStorageLoc(loc.id)}
                          className="text-red-500 hover:underline font-semibold cursor-pointer"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SUB-TAB 2: STAFF & SECURITY
// ==========================================

