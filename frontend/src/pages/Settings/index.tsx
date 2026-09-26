import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import {} from '../../utils/phone';
import { PhoneInputWithBadge } from '../../components/PhoneInputWithBadge';
import { apiClient, api } from '../../services/api';
import { useSettingsQuery } from '../../hooks/useSettingsQuery';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';
import { usePageActive } from '../../lib/keepAlive/PageActiveContext';
import { broadcastContactDataChanged, updateSettingsCache } from '../../utils/settingsSync';
import { invalidateAfterStockWrite } from '../../utils/cacheInvalidation';
import { useModalEscape } from '../../services/keyboardShortcuts';
import {
  Settings as SettingsIcon,
  Building2,
  Database,
  Trash2,
  Save,
  RefreshCw,
  Zap,
  Clock,
  RotateCcw,
  Shield,
  ShieldCheck,
  AlertTriangle,
  X,
  FileText,
  Send,
  MapPin,
  Plus,
  CheckCircle2,
  MessageCircle,
  Mail,
  Stethoscope,
  Truck,
  Smartphone,
  Upload,
  Image as ImageIcon,
  PenTool,
  Check,
  Sliders,
  Palette,
  Eye,
  Move,
  CheckCircle,
  Store as StoreIcon,
  GitBranch,
  ArrowDownToLine,
  ArrowUpFromLine,
  CreditCard,
  Calendar,
  ShoppingCart,
  Layers,
  Sparkles,
  ExternalLink,
  Globe,
  Copy,
  Phone,
  Cloud
} from 'lucide-react';
import { toastEvent } from '../../services/events';
import { BackupCenterContent } from '../../components/BackupCenterModal';

// ==========================================
// TYPES & INTERFACES
// ==========================================

type LocalApiError = { response?: { data?: { error?: string } }; message?: string };

interface StorageLocation {
  id: number;
  name: string;
  code: string;
  type: string;
  description: string;
  is_default: number;
  is_active: number;
}

interface RegisteredDevice {
  token: string;
  device_name: string;
  os: string;
  last_seen: string;
  is_online: number;
}

// Map legacy tab search params to the store infrastructure tabs
function normalizeSettingsTab(tabParam: string | null): string {
  if (!tabParam) return 'profile';
  const lower = tabParam.toLowerCase();
  if (lower === 'profile' || lower === 'store') return 'profile';
  if (lower === 'stores' || lower === 'branches' || lower === 'multistore' || lower === 'sync') return 'stores';
  if (lower === 'staff' || lower === 'security') return 'staff';
  if (lower === 'ordertiming' || lower === 'timing' || lower === 'delivery' || lower === 'schedule' || lower === 'holidays') return 'orderTiming';
  if (lower === 'integrations' || lower === 'credentials') return 'integrations';
  if (lower === 'triggers' || lower === 'schedules' || lower === 'cron' || lower === 'automation') return 'triggers';
  if (lower === 'backups' || lower === 'data' || lower === 'maintenance') return 'backups';
  if (lower === 'license' || lower === 'updates' || lower === 'binding' || lower === 'system') return 'license';
  return 'profile';
}

// ==========================================
// MAIN SETTINGS COMPONENT
// ==========================================

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = normalizeSettingsTab(searchParams.get('tab'));
  const isPageVisible = usePageActive();

  const { data: rawSettings = {}, isLoading: loadingSettings, refetch: refetchSettings } = useSettingsQuery();

  const tabs = [
    { id: 'profile', label: 'Store Profile', icon: Building2, desc: 'Pharmacy details, invoice layout & tax' },
    { id: 'orderTiming', label: 'Orders & Fulfilment Timing', icon: Clock, desc: 'Cutoff times, Sunday/holiday calendar & delivery windows' },
    { id: 'stores', label: 'Multi-Store & Sync', icon: StoreIcon, desc: 'Branch stores, offline sync & central management' },
    { id: 'staff', label: 'Staff & Security', icon: Shield, desc: 'Cashier accounts, admin access & devices' },
    { id: 'integrations', label: 'Integrations & Credentials', icon: Zap, desc: 'WhatsApp, Telegram, Gmail & Pharmarack' },
    { id: 'triggers', label: 'Trigger Schedules', icon: Clock, desc: 'Manage automated trigger times, intervals & cron frequencies' },
    { id: 'backups', label: 'Data & Backups', icon: Database, desc: 'Database backups, fetch control & reset' },
    { id: 'license', label: 'License & Updates', icon: ShieldCheck, desc: 'Hardware binding, anti-piracy key & software updates' }
  ];

  const handleTabChange = (tabId: string) => {
    setSearchParams({ tab: tabId });
  };

  return (
    <div className="flex flex-col h-full text-text p-4 space-y-4 overflow-y-auto">
      {/* Compact Unified Top Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-bg border border-border rounded-2xl p-3 px-4 shadow-sm">
        {/* Title */}
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <SettingsIcon size={22} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-text leading-none">Settings & Configuration</h1>
            <p className="text-xs text-muted mt-0.5">Control center for store rules, security & integrations</p>
          </div>
        </div>

        {/* Tab Switcher Pills */}
        <div className="flex items-center gap-1.5 bg-bg3/40 p-1 rounded-xl border border-border overflow-x-auto scrollbar-none">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-2 px-3 py-1.5 font-semibold text-sm rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-bg2 text-primary font-bold shadow-sm border border-border'
                    : 'text-muted hover:text-text hover:bg-bg3/80 border border-transparent'
                }`}
              >
                <Icon size={16} className={isActive ? 'text-primary' : 'text-muted'} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Tab Workspace Panel — paints cached settings instantly; the
          spinner shows only when NO cached snapshot exists (true cold load). */}
      <div className="flex-1 bg-bg border border-border rounded-2xl p-5 shadow-sm">
        {loadingSettings && (!rawSettings || Object.keys(rawSettings).length === 0) ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw size={24} className="animate-spin text-primary mr-2" />
            <span className="text-sm font-semibold text-muted">Hydrating pharmacy configuration settings...</span>
          </div>
        ) : (
          <>
            {activeTab === 'profile' && <StoreProfileTab rawSettings={rawSettings} refetchSettings={refetchSettings} />}
            {activeTab === 'orderTiming' && <OrderTimingTab rawSettings={rawSettings} refetchSettings={refetchSettings} />}
            {activeTab === 'stores' && <MultiStoreTab />}
            {activeTab === 'staff' && <StaffSecurityTab rawSettings={rawSettings} refetchSettings={refetchSettings} />}
            {activeTab === 'integrations' && <IntegrationsCredentialsTab rawSettings={rawSettings} refetchSettings={refetchSettings} isVisible={isPageVisible} />}
            {activeTab === 'triggers' && <TriggerSchedulesTab rawSettings={rawSettings} refetchSettings={refetchSettings} />}
            {activeTab === 'backups' && <DataBackupsTab rawSettings={rawSettings} refetchSettings={refetchSettings} />}
            {activeTab === 'license' && <LicenseAndUpdatesTab />}
          </>
        )}
      </div>
    </div>
  );
}

// ==========================================
// SUB-TAB 1: STORE PROFILE
// ==========================================

function StoreProfileTab({ rawSettings, refetchSettings }: { rawSettings: Record<string, string>; refetchSettings: () => void }) {
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
  const [rawSigImage, setRawSigImage] = useState<string | null>(null);
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
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/75 backdrop-blur-md p-4 sm:p-6 fade-in overflow-y-auto">
          <div className="bg-bg border border-border rounded-3xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[92vh]">
            
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
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 overflow-y-auto">
              
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

function StaffSecurityTab({ rawSettings, refetchSettings }: { rawSettings: Record<string, string>; refetchSettings: () => void }) {
  const [adminUsername, setAdminUsername] = useState(rawSettings.admin_username || 'admin');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [adminRemoteMode, setAdminRemoteMode] = useState(rawSettings.admin_remote_mode !== 'false');
  const [saving, setSaving] = useState(false);

  const { data: devicesList = [] } = useApiQuery<RegisteredDevice[]>(
    'registered-devices',
    () => apiClient.get('/settings/registered-devices').then((res) => res.data.devices || []),
    { staleTime: 15000 }
  );

  const handleResetSecurity = () => {
    setAdminUsername(rawSettings.admin_username || 'admin');
    setNewAdminPassword('');
    setAdminRemoteMode(rawSettings.admin_remote_mode !== 'false');
    toastEvent.trigger('Security form reset to saved parameters', 'info');
  };

  const handleResetDeviceAuthorization = async () => {
    if (!window.confirm('Are you sure you want to reset remote admin device authorization? This will require re-authorization for remote admin sessions.')) return;
    try {
      await apiClient.post('/security/admin/reset-device');
      toastEvent.trigger('Admin device authorization reset successfully', 'success');
      refetchSettings();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to reset device authorization: ' + (e.message || 'Unknown error'), 'error');
    }
  };

  const handleSaveSecurity = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, string> = {
        admin_username: adminUsername,
        admin_remote_mode: adminRemoteMode ? 'true' : 'false',
      };
      if (newAdminPassword.trim()) {
        payload.admin_password = newAdminPassword.trim();
      }

      await apiClient.post('/settings/save', payload);
      toastEvent.trigger('Security parameters updated successfully', 'success');
      setNewAdminPassword('');
      refetchSettings();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to save security settings: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSaveSecurity} className="space-y-6">
        <div className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2 border-b border-border pb-2">
            <Shield size={16} /> Store Administration & Credentials
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text mb-1">Admin Account Username</label>
              <input
                type="text"
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">Change Admin Password (leave blank to keep existing)</label>
              <input
                type="password"
                placeholder="Enter new strong password"
                value={newAdminPassword}
                onChange={(e) => setNewAdminPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <input
              type="checkbox"
              id="adminRemote"
              checked={adminRemoteMode}
              onChange={(e) => setAdminRemoteMode(e.target.checked)}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
            />
            <label htmlFor="adminRemote" className="text-xs font-semibold text-text cursor-pointer">
              Enable Remote Administrative Master Control Access
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleResetSecurity}
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
            <span>Update Security Credentials</span>
          </button>
        </div>
      </form>

      {/* Registered Mobile & Desktop Devices */}
      <div className="space-y-4 pt-4 border-t border-border">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
            <Smartphone size={16} /> Authorized Registered Mobile & Desktop Terminals
          </h2>
          <button
            type="button"
            onClick={handleResetDeviceAuthorization}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 text-red-500 border border-red-500/30 font-bold text-xs rounded-xl hover:bg-red-500/20 transition-all cursor-pointer shrink-0"
          >
            <RotateCcw size={13} />
            <span>Reset Device Authorization</span>
          </button>
        </div>

        <div className="overflow-x-auto bg-bg3/20 border border-border rounded-xl">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="py-2.5 px-3">Device Name</th>
                <th className="py-2.5 px-3">OS Platform</th>
                <th className="py-2.5 px-3">Push Token</th>
                <th className="py-2.5 px-3">Last Active</th>
                <th className="py-2.5 px-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {devicesList.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-muted italic">No registered mobile device terminals found.</td>
                </tr>
              ) : (
                devicesList.map((dev) => (
                  <tr key={dev.token} className="hover:bg-bg3/50">
                    <td className="py-2.5 px-3 font-semibold text-text">{dev.device_name || 'Unnamed Terminal'}</td>
                    <td className="py-2.5 px-3 text-muted">{dev.os}</td>
                    <td className="py-2.5 px-3 font-mono text-[10px] text-muted truncate max-w-[150px]">{dev.token}</td>
                    <td className="py-2.5 px-3 text-muted">{new Date(dev.last_seen).toLocaleTimeString()}</td>
                    <td className="py-2.5 px-3 text-right">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        dev.is_online ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-muted/20 text-muted'
                      }`}>
                        {dev.is_online ? 'CONNECTED' : 'OFFLINE'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SUB-TAB 3: INTEGRATIONS & CREDENTIALS
// ==========================================

function IntegrationsCredentialsTab({ rawSettings, refetchSettings, isVisible }: { rawSettings: Record<string, string>; refetchSettings: () => void; isVisible: boolean }) {
  const [waPreferredSystem, setWaPreferredSystem] = useState(rawSettings.whatsapp_preferred_system || 'web');
  const [waBusinessToken, setWaBusinessToken] = useState(rawSettings.wa_business_access_token || '');
  const [waBusinessPhoneId, setWaBusinessPhoneId] = useState(rawSettings.wa_business_phone_number_id || '');
  const [emailInvoiceRecipient, setEmailInvoiceRecipient] = useState<string>(() => {
    if (rawSettings.notify_owner_on_email_whatsapp === '0') return 'none';
    return rawSettings.email_invoice_whatsapp_recipient || 'both';
  });
  
  const [telegramEnabled, setTelegramEnabled] = useState(rawSettings.telegram_enabled === 'true');
  const [telegramToken, setTelegramToken] = useState(rawSettings.telegram_token || '');
  const [telegramChatId, setTelegramChatId] = useState(rawSettings.telegram_chat_id || '');

  const [gmailUser, setGmailUser] = useState(rawSettings.gmail_user || '');
  const [gmailPass, setGmailPass] = useState(rawSettings.gmail_pass || '');

  const [pharmarackUser, setPharmarackUser] = useState(rawSettings.pharmarack_username || '');
  const [pharmarackPass, setPharmarackPass] = useState(rawSettings.pharmarack_password || '');
  const [pharmarackRefreshing, setPharmarackRefreshing] = useState(false);
  const [reorderWindowMonths, setReorderWindowMonths] = useState(rawSettings.pharmarack_reorder_window_months || '2');
  const [waIdleSleepMin, setWaIdleSleepMin] = useState(rawSettings.whatsapp_idle_sleep_min || '0');
  const [combinePharmarackSearch, setCombinePharmarackSearch] = useState(rawSettings.combine_pharmarack_pharmacy_search !== 'false');
  const [autoAddToLiveCart, setAutoAddToLiveCart] = useState(rawSettings.auto_add_to_live_cart !== 'false');
  const [geminiApiKey, setGeminiApiKey] = useState(rawSettings.gemini_api_key || '');
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [testingGemini, setTestingGemini] = useState(false);
  const [savingGemini, setSavingGemini] = useState(false);
  const [geminiStatus, setGeminiStatus] = useState<{ type: 'success' | 'error' | 'idle'; message?: string }>({
    type: rawSettings.gemini_api_key ? 'success' : 'idle',
    message: rawSettings.gemini_api_key ? 'API Key saved and active in settings' : undefined
  });

  const [activeSubTab, setActiveSubTab] = useState<'all' | 'pharmarack' | 'whatsapp' | 'telegram' | 'gmail' | 'gemini' | 'cloudflare' | 'payments'>('all');
  const [savingSection, setSavingSection] = useState<string | null>(null);

  const integrationSubTabs = [
    { id: 'all', label: 'All Services', icon: Layers },
    { id: 'pharmarack', label: 'Pharmarack B2B', icon: Zap },
    { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
    { id: 'telegram', label: 'Telegram Bot', icon: Send },
    { id: 'gmail', label: 'Gmail Scanner', icon: Mail },
    { id: 'gemini', label: 'Gemini AI Vision', icon: Sparkles },
    { id: 'cloudflare', label: 'Cloudflare Tunnel', icon: Globe },
    { id: 'payments', label: 'UPI QR Payments', icon: CreditCard },
  ];

  // 3-UPI QR Code System & Delivery Feature Flag (§13, §15)
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [paymentQrs, setPaymentQrs] = useState<Array<{ id: string; label: string; payee_name: string; upi_id: string; is_active: boolean }>>([
    { id: 'QR_1', label: 'Pharmacy Counter UPI (QR 1)', payee_name: 'AI Pharmacy Counter 1', upi_id: 'aipharmacy1@upi', is_active: true },
    { id: 'QR_2', label: 'Pharmacy Counter UPI (QR 2)', payee_name: 'AI Pharmacy Counter 2', upi_id: 'aipharmacy2@upi', is_active: true },
    { id: 'QR_3', label: 'Pharmacy Counter UPI (QR 3)', payee_name: 'AI Pharmacy Counter 3', upi_id: 'aipharmacy3@upi', is_active: true }
  ]);

  useEffect(() => {
    api.getDeliveryConfig().then(res => {
      if (res?.success) setDeliveryEnabled(res.delivery_enabled);
    }).catch(() => {});

    api.getPaymentQrs().then(res => {
      if (res?.success && Array.isArray(res.configs) && res.configs.length > 0) {
        setPaymentQrs(res.configs);
      }
    }).catch(() => {});
  }, []);

  // Cloudflare Tunnel State
  const [cfAutostart, setCfAutostart] = useState(
    rawSettings.cloudflare_tunnel_autostart === '1' || rawSettings.cloudflare_tunnel_autostart === 'true'
  );
  const [cfToken, setCfToken] = useState(rawSettings.cloudflare_tunnel_token || '');
  const [cfCustomDomain, setCfCustomDomain] = useState(rawSettings.cloudflare_tunnel_custom_domain || '');
  const [showCfToken, setShowCfToken] = useState(false);
  const [cfTunnelStatus, setCfTunnelStatus] = useState<import('../../services/api').TunnelStatusResponse | null>(null);
  const [cfLoading, setCfLoading] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const fetchCfStatus = useCallback(async () => {
    try {
      const res = await api.getTunnelStatus();
      if (res?.success) {
        setCfTunnelStatus(res);
      }
    } catch (err) {
      console.error('Failed to get tunnel status:', err);
    }
  }, []);

  useEffect(() => {
    if (isVisible) {
      fetchCfStatus();
      const handleStatus = () => fetchCfStatus();
      window.addEventListener('sse-tunnel-status-changed', handleStatus);
      return () => {
        window.removeEventListener('sse-tunnel-status-changed', handleStatus);
      };
    }
  }, [isVisible, fetchCfStatus]);

  const handleToggleTunnel = async () => {
    setCfLoading(true);
    try {
      if (cfTunnelStatus?.isRunning) {
        await api.stopTunnel();
        toastEvent.trigger('Cloudflare Tunnel stopped', 'info');
      } else {
        await api.startTunnel();
        toastEvent.trigger('Starting Cloudflare Tunnel...', 'info');
      }
      setTimeout(fetchCfStatus, 1500);
    } catch (err: any) {
      toastEvent.trigger('Tunnel operation failed: ' + (err.message || 'Unknown error'), 'error');
    } finally {
      setCfLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (cfTunnelStatus?.url) {
      const storeUrl = `${cfTunnelStatus.url}/portal`;
      navigator.clipboard.writeText(storeUrl);
      setCopiedLink(true);
      toastEvent.trigger('Store portal link copied to clipboard!', 'success');
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  // WhatsApp Web QR & Status — P1 "events, not timers": event-driven via SSE push / focus.
  // Polls ONLY while actively awaiting a QR scan after explicit user connection.
  const [waStatus, setWaStatus] = useState<{ status: string; qr?: string; message?: string }>({ status: 'UNKNOWN' });
  const fetchWaStatus = useCallback(async () => {
    if (!isVisible) return;
    try {
      const res = await api.getWhatsAppStatus();
      if (res) {
        setWaStatus({
          status: (res as any).status || (res.isReady ? 'READY' : 'DISCONNECTED'),
          qr: res.qrUrl || undefined,
          message: res.message
        });
      }
    } catch (err) {
      console.error('Failed to fetch WhatsApp status:', err);
    }
  }, [isVisible]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSE/focus-driven WA status subscription
    fetchWaStatus();
    const handleSse = () => fetchWaStatus();
    window.addEventListener('sse-wa-status-changed', handleSse);
    window.addEventListener('focus', handleSse);
    return () => {
      window.removeEventListener('sse-wa-status-changed', handleSse);
      window.removeEventListener('focus', handleSse);
    };
  }, [fetchWaStatus]);

  useEffect(() => {
    // Poll ONLY while actively connecting (user initiated connection and QR code is standing by)
    const isActivelyConnecting = waStatus.status === 'CONNECTING' || waStatus.status === 'SCAN_QR';
    if (!isActivelyConnecting || !isVisible) return;
    const interval = setInterval(fetchWaStatus, 3000);
    return () => clearInterval(interval);
  }, [waStatus.status, isVisible, fetchWaStatus]);

  // Telegram status: fetched on mount / focus / setting change (zero unnecessary polling timers)
  const { data: telegramStatus } = useApiQuery<{ isReady: boolean }>(
    'telegram-status',
    () => apiClient.get('/settings/telegram-status').then(res => res.data),
    { enabled: isVisible && telegramEnabled }
  );

  const handleResetIntegrations = () => {
    setWaPreferredSystem(rawSettings.whatsapp_preferred_system || 'web');
    setWaBusinessToken(rawSettings.wa_business_access_token || '');
    setWaBusinessPhoneId(rawSettings.wa_business_phone_number_id || '');
    setEmailInvoiceRecipient(rawSettings.notify_owner_on_email_whatsapp === '0' ? 'none' : (rawSettings.email_invoice_whatsapp_recipient || 'both'));
    setTelegramEnabled(rawSettings.telegram_enabled === 'true');
    setTelegramToken(rawSettings.telegram_token || '');
    setTelegramChatId(rawSettings.telegram_chat_id || '');
    setGmailUser(rawSettings.gmail_user || '');
    setGmailPass(rawSettings.gmail_pass || '');
    setPharmarackUser(rawSettings.pharmarack_username || '');
    setPharmarackPass(rawSettings.pharmarack_password || '');
    setReorderWindowMonths(rawSettings.pharmarack_reorder_window_months || '2');
    setWaIdleSleepMin(rawSettings.whatsapp_idle_sleep_min || '0');
    setCombinePharmarackSearch(rawSettings.combine_pharmarack_pharmacy_search !== 'false');
    setAutoAddToLiveCart(rawSettings.auto_add_to_live_cart !== 'false');
    setGeminiApiKey(rawSettings.gemini_api_key || '');
    setCfAutostart(rawSettings.cloudflare_tunnel_autostart === '1' || rawSettings.cloudflare_tunnel_autostart === 'true');
    setCfToken(rawSettings.cloudflare_tunnel_token || '');
    setCfCustomDomain(rawSettings.cloudflare_tunnel_custom_domain || '');
    toastEvent.trigger('All integration credentials reset to saved parameters', 'info');
  };

  const handleSaveGeminiKeyOnly = async () => {
    if (!geminiApiKey || geminiApiKey.trim() === '') {
      toastEvent.trigger('Please enter a Gemini API Key to save', 'error');
      return;
    }
    setSavingGemini(true);
    try {
      await apiClient.post('/settings/save-single', { key: 'gemini_api_key', value: geminiApiKey.trim() });
      toastEvent.trigger('Google Gemini API Key saved to database!', 'success');
      setGeminiStatus({ type: 'success', message: 'API Key successfully saved and active' });
      refetchSettings();
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Save failed';
      toastEvent.trigger('Failed to save API Key: ' + msg, 'error');
      setGeminiStatus({ type: 'error', message: 'Save error: ' + msg });
    } finally {
      setSavingGemini(false);
    }
  };

  const handleTestGeminiKey = async () => {
    if (!geminiApiKey || geminiApiKey.trim() === '') {
      toastEvent.trigger('Please enter a Gemini API Key to test', 'error');
      return;
    }
    setTestingGemini(true);
    setGeminiStatus({ type: 'idle' });
    try {
      const res = await apiClient.post('/settings/test-gemini-key', { apiKey: geminiApiKey.trim() });
      if (res.data?.success) {
        // Auto-save key to database when verified
        await apiClient.post('/settings/save-single', { key: 'gemini_api_key', value: geminiApiKey.trim() });
        refetchSettings();
        const msg = res.data.message || 'Google Gemini API key verified and connected successfully!';
        toastEvent.trigger(msg, 'success');
        setGeminiStatus({ type: 'success', message: msg });
      } else {
        const errMsg = res.data?.error || 'Google rejected the API key';
        toastEvent.trigger(errMsg, 'error');
        setGeminiStatus({ type: 'error', message: errMsg });
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Connection test failed';
      toastEvent.trigger('Gemini API Key error: ' + msg, 'error');
      setGeminiStatus({ type: 'error', message: msg });
    } finally {
      setTestingGemini(false);
    }
  };

  // Dedicated Card-Level Save & Reset Handlers
  const handleSavePharmarackOnly = async () => {
    setSavingSection('pharmarack');
    try {
      const payload: Record<string, string> = {
        pharmarack_username: pharmarackUser,
        pharmarack_password: pharmarackPass,
        pharmarack_mode: 'Live',
        pharmarack_reorder_window_months: reorderWindowMonths,
        combine_pharmarack_pharmacy_search: combinePharmarackSearch ? 'true' : 'false',
        auto_add_to_live_cart: autoAddToLiveCart ? 'true' : 'false'
      };
      await apiClient.post('/settings/save', payload);
      toastEvent.trigger('Pharmarack B2B credentials and settings saved!', 'success');
      updateSettingsCache(queryClient, payload);
      refetchSettings();
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Failed to save Pharmarack credentials';
      toastEvent.trigger(msg, 'error');
    } finally {
      setSavingSection(null);
    }
  };

  const handleResetPharmarackOnly = () => {
    setPharmarackUser(rawSettings.pharmarack_username || '');
    setPharmarackPass(rawSettings.pharmarack_password || '');
    setReorderWindowMonths(rawSettings.pharmarack_reorder_window_months || '2');
    setCombinePharmarackSearch(rawSettings.combine_pharmarack_pharmacy_search !== 'false');
    setAutoAddToLiveCart(rawSettings.auto_add_to_live_cart !== 'false');
    toastEvent.trigger('Pharmarack credentials reset to saved parameters', 'info');
  };

  const handleSaveGmailOnly = async () => {
    setSavingSection('gmail');
    try {
      const payload: Record<string, string> = {
        gmail_user: gmailUser,
        gmail_pass: gmailPass
      };
      await apiClient.post('/settings/save', payload);
      toastEvent.trigger('Gmail scanner credentials saved successfully!', 'success');
      updateSettingsCache(queryClient, payload);
      refetchSettings();
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Failed to save Gmail credentials';
      toastEvent.trigger(msg, 'error');
    } finally {
      setSavingSection(null);
    }
  };

  const handleResetGmailOnly = () => {
    setGmailUser(rawSettings.gmail_user || '');
    setGmailPass(rawSettings.gmail_pass || '');
    toastEvent.trigger('Gmail credentials reset to saved parameters', 'info');
  };

  const handleSaveTelegramOnly = async () => {
    setSavingSection('telegram');
    try {
      const payload: Record<string, string> = {
        telegram_enabled: telegramEnabled ? 'true' : 'false',
        telegram_token: telegramToken,
        telegram_chat_id: telegramChatId
      };
      await apiClient.post('/settings/save', payload);
      toastEvent.trigger('Telegram bot configuration saved!', 'success');
      updateSettingsCache(queryClient, payload);
      refetchSettings();
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Failed to save Telegram settings';
      toastEvent.trigger(msg, 'error');
    } finally {
      setSavingSection(null);
    }
  };

  const handleResetTelegramOnly = () => {
    setTelegramEnabled(rawSettings.telegram_enabled === 'true');
    setTelegramToken(rawSettings.telegram_token || '');
    setTelegramChatId(rawSettings.telegram_chat_id || '');
    toastEvent.trigger('Telegram settings reset to saved parameters', 'info');
  };

  const handleSaveWhatsappOnly = async () => {
    setSavingSection('whatsapp');
    try {
      const payload: Record<string, string> = {
        whatsapp_preferred_system: waPreferredSystem,
        wa_business_access_token: waBusinessToken,
        wa_business_phone_number_id: waBusinessPhoneId,
        whatsapp_idle_sleep_min: waIdleSleepMin,
        email_invoice_whatsapp_recipient: emailInvoiceRecipient,
        notify_owner_on_email_whatsapp: emailInvoiceRecipient === 'none' ? '0' : '1'
      };
      await apiClient.post('/settings/save', payload);
      toastEvent.trigger('WhatsApp configuration saved!', 'success');
      updateSettingsCache(queryClient, payload);
      refetchSettings();
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Failed to save WhatsApp settings';
      toastEvent.trigger(msg, 'error');
    } finally {
      setSavingSection(null);
    }
  };

  const handleResetWhatsappOnly = () => {
    setWaPreferredSystem(rawSettings.whatsapp_preferred_system || 'web');
    setWaBusinessToken(rawSettings.wa_business_access_token || '');
    setWaBusinessPhoneId(rawSettings.wa_business_phone_number_id || '');
    setWaIdleSleepMin(rawSettings.whatsapp_idle_sleep_min || '0');
    setEmailInvoiceRecipient(rawSettings.notify_owner_on_email_whatsapp === '0' ? 'none' : (rawSettings.email_invoice_whatsapp_recipient || 'both'));
    toastEvent.trigger('WhatsApp configuration reset to saved parameters', 'info');
  };

  const handleSaveCloudflareOnly = async () => {
    setSavingSection('cloudflare');
    try {
      const payload: Record<string, string> = {
        cloudflare_tunnel_autostart: cfAutostart ? '1' : '0',
        cloudflare_tunnel_token: cfToken.trim(),
        cloudflare_tunnel_custom_domain: cfCustomDomain.trim()
      };
      await apiClient.post('/settings/save', payload);
      await api.configureTunnel({
        token: cfToken.trim(),
        customDomain: cfCustomDomain.trim(),
        autostart: cfAutostart
      }).catch(() => {});
      toastEvent.trigger('Cloudflare Tunnel configuration saved!', 'success');
      updateSettingsCache(queryClient, payload);
      refetchSettings();
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Failed to save Cloudflare settings';
      toastEvent.trigger(msg, 'error');
    } finally {
      setSavingSection(null);
    }
  };

  const handleResetCloudflareOnly = () => {
    setCfAutostart(rawSettings.cloudflare_tunnel_autostart === '1' || rawSettings.cloudflare_tunnel_autostart === 'true');
    setCfToken(rawSettings.cloudflare_tunnel_token || '');
    setCfCustomDomain(rawSettings.cloudflare_tunnel_custom_domain || '');
    toastEvent.trigger('Cloudflare Tunnel settings reset to saved parameters', 'info');
  };

  const handleSavePaymentQrsOnly = async () => {
    setSavingSection('payments');
    try {
      await Promise.all([
        api.savePaymentQrs(paymentQrs),
        api.saveDeliveryConfig(deliveryEnabled)
      ]);
      toastEvent.trigger('Online payments and QR code configuration saved!', 'success');
      refetchSettings();
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Failed to save payment QR settings';
      toastEvent.trigger(msg, 'error');
    } finally {
      setSavingSection(null);
    }
  };

  const handleResetPaymentQrsOnly = async () => {
    try {
      const res = await api.getPaymentQrs();
      if (res?.success && Array.isArray(res.configs) && res.configs.length > 0) {
        setPaymentQrs(res.configs);
      }
      const delRes = await api.getDeliveryConfig();
      if (delRes?.success) setDeliveryEnabled(delRes.delivery_enabled);
      toastEvent.trigger('Payment QR parameters reset to saved state', 'info');
    } catch {
      toastEvent.trigger('Failed to reset payment QR parameters', 'error');
    }
  };

  const handleSaveIntegrations = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, string> = {
        whatsapp_preferred_system: waPreferredSystem,
        wa_business_access_token: waBusinessToken,
        wa_business_phone_number_id: waBusinessPhoneId,
        email_invoice_whatsapp_recipient: emailInvoiceRecipient,
        notify_owner_on_email_whatsapp: emailInvoiceRecipient === 'none' ? '0' : '1',
        telegram_enabled: telegramEnabled ? 'true' : 'false',
        telegram_token: telegramToken,
        telegram_chat_id: telegramChatId,
        gmail_user: gmailUser,
        gmail_pass: gmailPass,
        pharmarack_username: pharmarackUser,
        pharmarack_password: pharmarackPass,
        pharmarack_mode: 'Live',
        pharmarack_reorder_window_months: reorderWindowMonths,
        whatsapp_idle_sleep_min: waIdleSleepMin,
        combine_pharmarack_pharmacy_search: combinePharmarackSearch ? 'true' : 'false',
        gemini_api_key: geminiApiKey,
        cloudflare_tunnel_autostart: cfAutostart ? '1' : '0',
        cloudflare_tunnel_token: cfToken.trim(),
        cloudflare_tunnel_custom_domain: cfCustomDomain.trim()
      };

      await apiClient.post('/settings/save', payload);
      await Promise.all([
        api.savePaymentQrs(paymentQrs),
        api.saveDeliveryConfig(deliveryEnabled),
        api.configureTunnel({
          token: cfToken.trim(),
          customDomain: cfCustomDomain.trim(),
          autostart: cfAutostart
        }).catch(() => {})
      ]);
      toastEvent.trigger('Integrations, 3-QR pool & API credentials saved successfully', 'success');
      updateSettingsCache(queryClient, payload);
      broadcastContactDataChanged(queryClient);
      refetchSettings();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to save integration settings: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleCombineSearch = async (val: boolean) => {
    setCombinePharmarackSearch(val);
    try {
      await apiClient.post('/settings', { key: 'combine_pharmarack_pharmacy_search', value: val ? 'true' : 'false' });
      toastEvent.trigger(`Combine Pharmarack & Pharmacy search ${val ? 'enabled' : 'disabled'}`, 'success');
      refetchSettings();
    } catch {
      toastEvent.trigger('Failed to update setting', 'error');
    }
  };

  const handleToggleAutoAddToCart = async (val: boolean) => {
    setAutoAddToLiveCart(val);
    try {
      await apiClient.post('/settings', { key: 'auto_add_to_live_cart', value: val ? 'true' : 'false' });
      toastEvent.trigger(`Auto Add to Live Cart ${val ? 'enabled' : 'disabled'}`, 'success');
      refetchSettings();
    } catch {
      toastEvent.trigger('Failed to update Auto Add to Live Cart setting', 'error');
    }
  };

  const handleTriggerPharmarackRefresh = async () => {
    setPharmarackRefreshing(true);
    try {
      const res = await apiClient.post('/pharmarack/trigger-reauth');
      if (res.data?.success) {
        toastEvent.trigger('Pharmarack live B2B session refreshed successfully', 'success');
        refetchSettings();
      } else {
        toastEvent.trigger(res.data?.message || 'Session expired. Click "Open Login Window" to complete authentication.', 'info');
      }
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Pharmarack session refresh error: ' + e.message, 'error');
    } finally {
      setPharmarackRefreshing(false);
    }
  };

  const handleLaunchPharmarackLogin = async () => {
    try {
      toastEvent.trigger('Opening Pharmarack Login window in Chrome...', 'info');
      await api.launchPharmarackLoginWindow();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger(e?.response?.data?.error || 'Failed to launch login window', 'error');
    }
  };

  const handleReorderWindowChange = async (months: string) => {
    setReorderWindowMonths(months);
    try {
      await apiClient.post('/settings', { key: 'pharmarack_reorder_window_months', value: months });
      toastEvent.trigger(`Reorder lookback window set to ${months} months`, 'success');
      refetchSettings();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to save reorder window: ' + e.message, 'error');
    }
  };

  return (
    <form onSubmit={handleSaveIntegrations} className="space-y-6">
      {/* Sub-navigation Filter Bar for Fast Navigation */}
      <div className="flex items-center gap-1.5 p-1.5 bg-bg3/40 border border-border rounded-xl overflow-x-auto scrollbar-none shadow-xs">
        {integrationSubTabs.map((sub) => {
          const Icon = sub.icon;
          const isActive = activeSubTab === sub.id;
          return (
            <button
              key={sub.id}
              type="button"
              onClick={() => setActiveSubTab(sub.id as any)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                isActive
                  ? 'bg-primary text-white shadow-xs'
                  : 'text-muted hover:text-text hover:bg-bg3/80'
              }`}
            >
              <Icon size={14} />
              <span>{sub.label}</span>
            </button>
          );
        })}
      </div>

      {/* WhatsApp Section */}
      {(activeSubTab === 'all' || activeSubTab === 'whatsapp') && (
        <div className="bg-bg2 border border-border rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <MessageCircle size={16} /> WhatsApp Messaging Infrastructure
            </h2>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
              waPreferredSystem === 'web'
                ? waStatus.status === 'READY'
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : waStatus.status === 'SLEEPING'
                    ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                    : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                : waBusinessToken
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-bg border border-border text-muted'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                waPreferredSystem === 'web' && waStatus.status === 'READY' ? 'bg-emerald-400 animate-pulse' : 'bg-muted'
              }`} />
              {waPreferredSystem === 'web' ? `Web Status: ${waStatus.status}` : waBusinessToken ? 'Cloud API Configured' : 'Not Configured'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-bg3/30 border border-border rounded-xl p-4 space-y-3">
              <h3 className="text-xs font-bold text-text uppercase">WhatsApp Automated System</h3>
              <div>
                <label className="block text-xs font-semibold text-text mb-1">Preferred Integration System</label>
                <select
                  value={waPreferredSystem}
                  onChange={(e) => setWaPreferredSystem(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                >
                  <option value="web">Automated WhatsApp Web (Headless Chrome QR)</option>
                  <option value="business">Official WhatsApp Business Cloud API</option>
                </select>
              </div>

              {waPreferredSystem === 'web' && (
                <div className="p-3 bg-bg rounded-xl border border-border space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-text">Web Status:</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      waStatus.status === 'READY'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : waStatus.status === 'SLEEPING'
                          ? 'bg-sky-500/20 text-sky-400'
                          : 'bg-amber-500/20 text-amber-400'
                    }`}>
                      {waStatus.status}
                    </span>
                  </div>
                  {waStatus.status === 'SLEEPING' && (
                    <p className="text-[11px] text-muted">
                      Browser closed to save memory. It wakes automatically when you send a message.
                    </p>
                  )}
                  <div>
                    <label className="block text-xs font-semibold text-text mb-1" htmlFor="wa-idle-sleep-min">
                      Sleep browser after idle (minutes)
                    </label>
                    <input
                      id="wa-idle-sleep-min"
                      type="number"
                      min={0}
                      max={480}
                      value={waIdleSleepMin}
                      onChange={(e) => setWaIdleSleepMin(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                      placeholder="0"
                    />
                    <p className="text-[10px] text-muted mt-1">
                      0 = Never sleep (stays awake 24/7 so customer incoming messages &amp; replies are never missed). &gt;0 frees ~250–400 MB RAM while idle.
                    </p>
                  </div>
                  {waStatus.qr && (
                    <div className="flex flex-col items-center py-2 rounded-lg" style={{ backgroundColor: '#ffffff' }}>
                      <img src={waStatus.qr} alt="WhatsApp Web QR Code" className="w-32 h-32" />
                      <span className="text-[10px] text-gray-700 font-semibold mt-1">Scan with WhatsApp on phone</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="bg-bg3/30 border border-border rounded-xl p-4 space-y-3">
              <h3 className="text-xs font-bold text-text uppercase">Meta WhatsApp Business API Keys</h3>
              <div>
                <label className="block text-xs font-semibold text-text mb-1">Phone Number ID</label>
                <input
                  type="text"
                  value={waBusinessPhoneId}
                  onChange={(e) => setWaBusinessPhoneId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none font-mono"
                  placeholder="Meta Phone Number ID"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text mb-1">System User Access Token</label>
                <input
                  type="password"
                  value={waBusinessToken}
                  onChange={(e) => setWaBusinessToken(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none font-mono"
                  placeholder="Permanent Bearer Token"
                />
              </div>
            </div>

            {/* Email Invoice WhatsApp Alert Recipient Management */}
            <div className="md:col-span-2 bg-bg3/30 border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-text uppercase flex items-center gap-2">
                    <Mail size={14} className="text-primary" /> Invoice Email WhatsApp Notifications
                  </h3>
                  <p className="text-[11px] text-muted mt-0.5">
                    Choose which phone number(s) receive automatic WhatsApp alerts when distributor invoice emails are received.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-1">
                {[
                  {
                    id: 'both',
                    label: 'Both Numbers',
                    desc: 'Store & Owner',
                    phone: [rawSettings.shop_phone || rawSettings.phone, rawSettings.owner_whatsapp_number].filter(Boolean).join(' + ') || 'Both configured'
                  },
                  {
                    id: 'pharmacy',
                    label: 'Pharmacy / Counter',
                    desc: 'Store Phone',
                    phone: rawSettings.shop_phone || rawSettings.phone || 'Not configured'
                  },
                  {
                    id: 'owner',
                    label: 'Owner WhatsApp',
                    desc: 'Owner Mobile',
                    phone: rawSettings.owner_whatsapp_number || 'Not configured'
                  },
                  {
                    id: 'none',
                    label: 'Disabled',
                    desc: 'No Alerts',
                    phone: 'Turned off'
                  }
                ].map((opt) => {
                  const isSelected = emailInvoiceRecipient === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setEmailInvoiceRecipient(opt.id)}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? 'bg-primary/10 border-primary shadow-sm text-text'
                          : 'bg-bg2/60 border-border text-muted hover:text-text hover:bg-bg2'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold">{opt.label}</span>
                        <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${isSelected ? 'border-primary bg-primary' : 'border-border'}`}>
                          {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-bg"></span>}
                        </span>
                      </div>
                      <div className="mt-2 text-[10px] text-muted truncate">
                        <span className="font-mono">{opt.phone}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* WhatsApp Card Action Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-bg3/40 border border-border rounded-xl p-3 mt-3">
            <span className="text-[11px] text-muted">
              Saves preferred messaging route, Meta Cloud API credentials, idle sleep, and recipient settings
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetWhatsappOnly}
                disabled={savingSection === 'whatsapp'}
                className="flex items-center gap-1.5 px-3 py-2 bg-bg3 border border-border text-muted hover:text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer disabled:opacity-50"
              >
                <RotateCcw size={13} />
                <span>Reset</span>
              </button>
              <button
                type="button"
                onClick={handleSaveWhatsappOnly}
                disabled={savingSection === 'whatsapp'}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm disabled:opacity-50"
              >
                {savingSection === 'whatsapp' ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                <span>Save WhatsApp Settings</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Telegram Bot */}
      {(activeSubTab === 'all' || activeSubTab === 'telegram') && (
        <div className="bg-bg2 border border-border rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <Send size={16} /> Telegram Alert Bot &amp; Prescription Receiver
            </h2>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
              telegramEnabled && telegramStatus?.isReady
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : telegramToken
                  ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                  : 'bg-bg border border-border text-muted'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${telegramEnabled && telegramStatus?.isReady ? 'bg-emerald-400 animate-pulse' : 'bg-muted'}`} />
              {telegramEnabled && telegramStatus?.isReady ? 'Bot Online & Listening' : telegramToken ? 'Credentials Saved' : 'Not Configured'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center gap-3 md:col-span-3">
              <input
                type="checkbox"
                id="tgEnabled"
                checked={telegramEnabled}
                onChange={(e) => setTelegramEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
              />
              <label htmlFor="tgEnabled" className="text-xs font-bold text-text cursor-pointer">
                Enable Automated Telegram Bot Notifications &amp; Photo Ingestion
              </label>
              {telegramEnabled && (
                <span className={`ml-auto px-2.5 py-1 rounded text-[10px] font-bold ${
                  telegramStatus?.isReady ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/20 text-red-400'
                }`}>
                  {telegramStatus?.isReady ? 'BOT ONLINE & LISTENING' : 'BOT DISCONNECTED'}
                </span>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">Telegram Bot Token</label>
              <input
                type="password"
                value={telegramToken}
                onChange={(e) => setTelegramToken(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none font-mono"
                placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">Target Chat / Channel ID</label>
              <input
                type="text"
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none font-mono"
                placeholder="-100123456789"
              />
            </div>
          </div>

          {/* Telegram Card Action Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-bg3/40 border border-border rounded-xl p-3 mt-3">
            <span className="text-[11px] text-muted">
              Used to receive photo prescriptions and broadcast urgent low-stock or expiry alerts
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetTelegramOnly}
                disabled={savingSection === 'telegram'}
                className="flex items-center gap-1.5 px-3 py-2 bg-bg3 border border-border text-muted hover:text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer disabled:opacity-50"
              >
                <RotateCcw size={13} />
                <span>Reset</span>
              </button>
              <button
                type="button"
                onClick={handleSaveTelegramOnly}
                disabled={savingSection === 'telegram'}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm disabled:opacity-50"
              >
                {savingSection === 'telegram' ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                <span>Save Telegram Credentials</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gmail / Email */}
      {(activeSubTab === 'all' || activeSubTab === 'gmail') && (
        <div className="bg-bg2 border border-border rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <Mail size={16} /> Gmail / IMAP Mail Order Scanner Credentials
            </h2>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
              gmailUser && gmailPass
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-bg border border-border text-muted'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${gmailUser && gmailPass ? 'bg-emerald-400' : 'bg-muted'}`} />
              {gmailUser && gmailPass ? 'Credentials Configured' : 'Credentials Not Set'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text mb-1">IMAP Gmail Account Address</label>
              <input
                type="email"
                value={gmailUser}
                onChange={(e) => setGmailUser(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                placeholder="store.distributor.invoices@gmail.com"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text mb-1">Google App Password (16-character secret)</label>
              <input
                type="password"
                value={gmailPass}
                onChange={(e) => setGmailPass(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none font-mono"
                placeholder="abcd efgh ijkl mnop"
              />
            </div>
          </div>

          {/* Gmail Card Action Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-bg3/40 border border-border rounded-xl p-3 mt-3">
            <span className="text-[11px] text-muted">
              Used by automatic background worker to scan distributor invoices &amp; purchase confirmations
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetGmailOnly}
                disabled={savingSection === 'gmail'}
                className="flex items-center gap-1.5 px-3 py-2 bg-bg3 border border-border text-muted hover:text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer disabled:opacity-50"
              >
                <RotateCcw size={13} />
                <span>Reset</span>
              </button>
              <button
                type="button"
                onClick={handleSaveGmailOnly}
                disabled={savingSection === 'gmail'}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm disabled:opacity-50"
              >
                {savingSection === 'gmail' ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                <span>Save Gmail Credentials</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pharmarack B2B */}
      {(activeSubTab === 'all' || activeSubTab === 'pharmarack') && (
        <div className="bg-bg2 border border-border rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <Zap size={16} /> Pharmarack B2B Live Ordering Credentials
            </h2>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
              pharmarackUser && pharmarackPass
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${pharmarackUser && pharmarackPass ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              {pharmarackUser && pharmarackPass ? 'Live B2B Configured' : 'Credentials Missing'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div>
              <label className="block text-xs font-semibold text-text mb-1">Pharmarack Login Username / Phone</label>
              <input
                type="text"
                value={pharmarackUser}
                onChange={(e) => setPharmarackUser(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                placeholder="Mobile / Username"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text mb-1">Pharmarack Login Password</label>
              <input
                type="password"
                value={pharmarackPass}
                onChange={(e) => setPharmarackPass(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                placeholder="Account Password"
              />
            </div>
            <div>
              <button
                type="button"
                onClick={handleTriggerPharmarackRefresh}
                disabled={pharmarackRefreshing}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-bg3 border border-border text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer"
                title="Attempt silent token refresh from saved Chrome session profile"
              >
                <RefreshCw size={14} className={pharmarackRefreshing ? 'animate-spin' : ''} />
                <span>Refresh Session</span>
              </button>
            </div>
            <div>
              <button
                type="button"
                onClick={handleLaunchPharmarackLogin}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/80 transition-all cursor-pointer shadow-sm"
                title="Open Chrome window with auto-filled credentials to enter OTP"
              >
                <Smartphone size={14} />
                <span>Open Login (OTP)</span>
              </button>
            </div>
          </div>

          {/* Dedicated Pharmarack Save & Reset Action Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-bg3/40 border border-border rounded-xl p-3">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                pharmarackUser && pharmarackPass
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
              }`}>
                <span className={`w-2 h-2 rounded-full ${pharmarackUser && pharmarackPass ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                {pharmarackUser && pharmarackPass ? 'Credentials Configured' : 'Credentials Missing'}
              </span>
              <span className="text-[11px] text-muted">
                Auto-fill login will use these credentials when launching Chrome
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetPharmarackOnly}
                disabled={savingSection === 'pharmarack'}
                className="flex items-center gap-1.5 px-3 py-2 bg-bg3 border border-border text-muted hover:text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer disabled:opacity-50"
              >
                <RotateCcw size={13} />
                <span>Reset</span>
              </button>
              <button
                type="button"
                onClick={handleSavePharmarackOnly}
                disabled={savingSection === 'pharmarack'}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm disabled:opacity-50"
              >
                {savingSection === 'pharmarack' ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                <span>Save Pharmarack Credentials</span>
              </button>
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-xs font-semibold text-text mb-1">Reorder Suggestions Lookback Window</label>
            <select
              value={reorderWindowMonths}
              onChange={(e) => handleReorderWindowChange(e.target.value)}
              className="w-full md:w-1/3 px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
            >
              <option value="2">2 months</option>
              <option value="4">4 months</option>
              <option value="6">6 months</option>
              <option value="8">8 months</option>
            </select>
            <p className="text-[11px] text-muted mt-1">
              How far back sales/purchase history is weighed for restock suggestions and the &quot;Ordered Recently&quot; list in the Reorder Hub. Changing this recomputes suggestions in the background.
            </p>
          </div>

          {/* Combine Pharmarack & Local Pharmacy Search Toggle */}
          <div className="bg-bg3/30 border border-border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-text flex items-center gap-1.5">
                <Layers size={14} className="text-primary" /> Combine Pharmarack &amp; Local Pharmacy Search
              </span>
              <p className="text-[11px] text-muted max-w-xl">
                When Pharmarack is offline, disconnected, or has no results, automatically search your local pharmacy purchase history and inventory. Displays each distributor&apos;s specific PTR, MRP, packaging, and stock in the exact same card dropdown.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="combinePharmarackSearchToggle"
                checked={combinePharmarackSearch}
                onChange={(e) => handleToggleCombineSearch(e.target.checked)}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
              />
              <label htmlFor="combinePharmarackSearchToggle" className="text-xs font-semibold text-text cursor-pointer">
                {combinePharmarackSearch ? 'Enabled' : 'Disabled'}
              </label>
            </div>
          </div>

          {/* Auto Add to Live Cart Toggle */}
          <div className="bg-bg3/30 border border-border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-text flex items-center gap-1.5">
                <ShoppingCart size={14} className="text-primary" /> Auto Add to Live Cart
              </span>
              <p className="text-[11px] text-muted max-w-xl">
                When enabled, confirmed customer orders are automatically added into your Pharmarack Live Cart. When disabled, requests are staged for your manual review and addition.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="autoAddToLiveCartToggle"
                checked={autoAddToLiveCart}
                onChange={(e) => handleToggleAutoAddToCart(e.target.checked)}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
              />
              <label htmlFor="autoAddToLiveCartToggle" className="text-xs font-semibold text-text cursor-pointer">
                {autoAddToLiveCart ? 'Enabled' : 'Disabled'}
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Google Gemini AI Vision Credentials */}
      {(activeSubTab === 'all' || activeSubTab === 'gemini') && (
        <div className="bg-bg2 border border-border rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <Sparkles size={16} /> Google Gemini AI Vision (Prescription &amp; Purchase OCR)
            </h2>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-sky hover:underline font-semibold"
            >
              <span>Get Free Key (Google AI Studio)</span>
              <ExternalLink size={12} />
            </a>
          </div>

          <div className="bg-bg3/30 border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-primary/10 text-primary mt-0.5">
                <Sparkles size={18} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-xs font-bold text-text">Cloud Vision AI Assistant</h3>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky/10 text-sky border border-sky/20">
                    1,500 Scans/Day Free
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    No Credit Card Required
                  </span>
                </div>
                <p className="text-[11px] text-muted mt-1 leading-relaxed">
                  Empowers automatic cloud fallback for illegible cursive doctor handwriting and complex purchase invoice line items.
                  Your app runs the <strong>Local Offline Scanner first</strong> (3.6s, ₹0 cost), and seamlessly calls Gemini whenever an API key is configured.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end pt-1">
              <div className="sm:col-span-8">
                <label className="block text-xs font-semibold text-text mb-1">
                  Google Gemini API Key
                </label>
                <div className="relative">
                  <input
                    type={showGeminiKey ? 'text' : 'password'}
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                    className="w-full pl-3 pr-10 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none font-mono"
                    placeholder="AIzaSy..."
                  />
                  <button
                    type="button"
                    onClick={() => setShowGeminiKey(!showGeminiKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text cursor-pointer p-1"
                    title={showGeminiKey ? 'Hide key' : 'Show key'}
                  >
                    <Eye size={14} />
                  </button>
                </div>
              </div>

              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={handleSaveGeminiKeyOnly}
                  disabled={savingGemini || !geminiApiKey}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Save API key directly to database"
                >
                  {savingGemini ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                  <span>{savingGemini ? 'Saving...' : 'Save Key'}</span>
                </button>
              </div>

              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={handleTestGeminiKey}
                  disabled={testingGemini || !geminiApiKey}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-bg3 border border-border text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Verify API key with Google AI Studio and auto-save"
                >
                  <RefreshCw size={14} className={testingGemini ? 'animate-spin' : ''} />
                  <span>{testingGemini ? 'Testing...' : 'Test & Verify'}</span>
                </button>
              </div>
            </div>

            {/* Live Status Feedback Banner */}
            {geminiStatus.type !== 'idle' && (
              <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 transition-all ${
                geminiStatus.type === 'success'
                  ? 'bg-primary/10 border-primary/20 text-primary'
                  : 'bg-bg3 border-border text-text'
              }`}>
                {geminiStatus.type === 'success' ? (
                  <CheckCircle2 size={16} className="text-primary shrink-0" />
                ) : (
                  <AlertTriangle size={16} className="text-muted shrink-0" />
                )}
                <span className="font-semibold">{geminiStatus.message}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cloudflare Tunnel & Live Online Store Section */}
      {(activeSubTab === 'all' || activeSubTab === 'cloudflare') && (
        <div className="bg-bg2 border border-border rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <Globe size={16} /> Cloudflare Tunnel — Zero-Cost Online Store
            </h2>
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 self-start sm:self-auto">
              $0 Cloud Bills • Unlimited Local Storage • Auto HTTPS
            </span>
          </div>

          <div className="bg-bg3/30 border border-border rounded-xl p-4 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/60 pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-text">Tunnel Service Status:</span>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                    cfTunnelStatus?.isRunning
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-bg border border-border text-muted'
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${cfTunnelStatus?.isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-muted'}`} />
                    {cfTunnelStatus?.isRunning ? 'LIVE & ACCESSIBLE' : 'OFFLINE'}
                  </span>
                </div>
                <p className="text-[11px] text-muted">
                  Securely tunnels patient store traffic and product images from this computer to the public internet via Cloudflare edge network.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleToggleTunnel}
                  disabled={cfLoading}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm ${
                    cfTunnelStatus?.isRunning
                      ? 'bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25'
                      : 'bg-primary text-white hover:bg-primary/90'
                  }`}
                >
                  {cfLoading ? <RefreshCw size={13} className="animate-spin" /> : <Globe size={13} />}
                  <span>{cfLoading ? 'Processing...' : cfTunnelStatus?.isRunning ? 'Stop Tunnel' : 'Start Tunnel'}</span>
                </button>

                {cfTunnelStatus?.url && (
                  <>
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="flex items-center gap-1.5 px-3 py-2 bg-bg border border-border text-text hover:text-primary rounded-xl text-xs font-medium transition-all cursor-pointer"
                      title="Copy patient store link"
                    >
                      {copiedLink ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                      <span>{copiedLink ? 'Copied' : 'Copy Store Link'}</span>
                    </button>
                    <a
                      href={`${cfTunnelStatus.url}/portal`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-2 bg-bg border border-border text-text hover:text-primary rounded-xl text-xs font-medium transition-all"
                    >
                      <ExternalLink size={13} />
                      <span>Open Store</span>
                    </a>
                  </>
                )}
              </div>
            </div>

            {cfTunnelStatus?.url && (
              <div className="p-3 bg-bg border border-emerald-500/20 rounded-xl flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 overflow-hidden">
                  <span className="font-semibold text-text shrink-0">Live URL:</span>
                  <span className="font-mono text-primary truncate select-all">{cfTunnelStatus.url}/portal</span>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                  Encrypted HTTPS
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="cfAutostartToggle"
                    checked={cfAutostart}
                    onChange={(e) => setCfAutostart(e.target.checked)}
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                  />
                  <label htmlFor="cfAutostartToggle" className="text-xs font-bold text-text cursor-pointer">
                    Auto-start Tunnel on Server Boot
                  </label>
                </div>
                <p className="text-[11px] text-muted pl-6">
                  When enabled, Cloudflare Tunnel starts automatically whenever you run the pharmacy application.
                </p>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-text">
                  Custom Domain (Optional)
                </label>
                <input
                  type="text"
                  value={cfCustomDomain}
                  onChange={(e) => setCfCustomDomain(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none font-mono"
                  placeholder="e.g. store.mypharmacy.com"
                />
                <p className="text-[10px] text-muted">
                  Leave empty for automatic free <code className="text-primary">trycloudflare.com</code> address.
                </p>
              </div>

              <div className="md:col-span-2 space-y-1">
                <label className="block text-xs font-bold text-text">
                  Cloudflare Tunnel Token (Optional - Required for Custom Permanent Domains)
                </label>
                <div className="relative">
                  <input
                    type={showCfToken ? 'text' : 'password'}
                    value={cfToken}
                    onChange={(e) => setCfToken(e.target.value)}
                    className="w-full pl-3 pr-10 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none font-mono"
                    placeholder="eyJhIjoi... (from Cloudflare Zero Trust Dashboard)"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCfToken(!showCfToken)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text cursor-pointer p-1"
                    title={showCfToken ? 'Hide token' : 'Show token'}
                  >
                    <Eye size={14} />
                  </button>
                </div>
                <p className="text-[10px] text-muted">
                  If you have your own domain on Cloudflare Zero Trust, paste your tunnel run token here. If empty, the app runs in Quick Tunnel mode with zero configuration needed.
                </p>
              </div>
            </div>

            {/* Cloudflare Card Action Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-bg border border-border rounded-xl p-3 mt-2">
              <span className="text-[11px] text-muted">
                Saves autostart preference, custom domain, and Cloudflare token
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetCloudflareOnly}
                  disabled={savingSection === 'cloudflare'}
                  className="flex items-center gap-1.5 px-3 py-2 bg-bg3 border border-border text-muted hover:text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw size={13} />
                  <span>Reset</span>
                </button>
                <button
                  type="button"
                  onClick={handleSaveCloudflareOnly}
                  disabled={savingSection === 'cloudflare'}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm disabled:opacity-50"
                >
                  {savingSection === 'cloudflare' ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                  <span>Save Tunnel Settings</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3-UPI QR Rotation Pool & Fulfillment (§13, §15) */}
      {(activeSubTab === 'all' || activeSubTab === 'payments') && (
        <div className="bg-bg2 border border-border rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <CreditCard size={16} /> Online Customer Payments &amp; Fulfillment (3-QR Pool)
            </h2>
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 self-start sm:self-auto">
              Strict Alternating Rotation (QR N ≠ Previous QR)
            </span>
          </div>

          {/* Feature Flag: Home Delivery vs In-Store Pickup */}
          <div className="bg-bg3/30 border border-border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-text block">Enable Home Delivery Checkout</span>
              <p className="text-[11px] text-muted max-w-xl">
                When disabled, customer online checkout operates strictly in <strong>In-Store Pickup Only</strong> mode.
                The customer address schema and database records remain fully preserved for future re-activation.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="enableDeliveryToggle"
                checked={deliveryEnabled}
                onChange={(e) => setDeliveryEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
              />
              <label htmlFor="enableDeliveryToggle" className="text-xs font-semibold text-text cursor-pointer">
                {deliveryEnabled ? 'Enabled' : 'Disabled'}
              </label>
            </div>
          </div>

          {/* 3 QR Code Configuration Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {paymentQrs.map((qr, idx) => (
              <div key={qr.id} className="bg-bg3/25 border border-border rounded-xl p-4 space-y-3 shadow-sm">
                <div className="flex items-center justify-between border-b border-border/60 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-md bg-primary/10 text-primary text-[10px] font-black flex items-center justify-center border border-primary/20">
                      {idx + 1}
                    </span>
                    <span className="text-xs font-bold text-text">{qr.id} Slot</span>
                  </div>
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={qr.is_active}
                      onChange={(e) => {
                        const updated = [...paymentQrs];
                        updated[idx] = { ...updated[idx], is_active: e.target.checked };
                        setPaymentQrs(updated);
                      }}
                      className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary"
                    />
                    <span>Active</span>
                  </label>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-muted mb-1">Display Label</label>
                  <input
                    type="text"
                    value={qr.label}
                    onChange={(e) => {
                      const updated = [...paymentQrs];
                      updated[idx] = { ...updated[idx], label: e.target.value };
                      setPaymentQrs(updated);
                    }}
                    className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-muted mb-1">Payee Name (as in bank)</label>
                  <input
                    type="text"
                    value={qr.payee_name}
                    onChange={(e) => {
                      const updated = [...paymentQrs];
                      updated[idx] = { ...updated[idx], payee_name: e.target.value };
                      setPaymentQrs(updated);
                    }}
                    className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-muted mb-1">UPI ID / VPA</label>
                  <input
                    type="text"
                    value={qr.upi_id}
                    onChange={(e) => {
                      const updated = [...paymentQrs];
                      updated[idx] = { ...updated[idx], upi_id: e.target.value };
                      setPaymentQrs(updated);
                    }}
                    placeholder="name@upi"
                    className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none font-mono"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Payment QR Card Action Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-bg3/40 border border-border rounded-xl p-3 mt-3">
            <span className="text-[11px] text-muted">
              Saves delivery checkout mode and active 3-QR rotation pool configurations
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetPaymentQrsOnly}
                disabled={savingSection === 'payments'}
                className="flex items-center gap-1.5 px-3 py-2 bg-bg3 border border-border text-muted hover:text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer disabled:opacity-50"
              >
                <RotateCcw size={13} />
                <span>Reset</span>
              </button>
              <button
                type="button"
                onClick={handleSavePaymentQrsOnly}
                disabled={savingSection === 'payments'}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm disabled:opacity-50"
              >
                {savingSection === 'payments' ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                <span>Save Payment &amp; QR Settings</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sticky Bottom Master Save & Reset Bar */}
      <div className="sticky bottom-0 bg-bg/95 backdrop-blur-md border border-border p-3.5 rounded-2xl shadow-xl flex flex-col sm:flex-row items-center justify-between gap-3 mt-6 z-20">
        <div className="flex items-center gap-2 text-xs text-muted">
          <CheckCircle2 size={16} className="text-primary shrink-0" />
          <span>
            {activeSubTab === 'all'
              ? 'Bulk Action: Save or reset all 7 service credentials simultaneously'
              : `Bulk Action: Save or reset all credentials across all integrations`}
          </span>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
          <button
            type="button"
            onClick={handleResetIntegrations}
            disabled={saving}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-bg3 border border-border text-muted hover:text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer disabled:opacity-50"
          >
            <RotateCcw size={14} />
            <span>Reset All Changes</span>
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center justify-center gap-2 px-5 py-2.5 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm disabled:opacity-50"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            <span>Save All Integrations &amp; Credentials</span>
          </button>
        </div>
      </div>
    </form>
  );
}



// ==========================================
// SUB-TAB 5: DATA & BACKUPS
// ==========================================

function DataBackupsTab({ rawSettings, refetchSettings }: { rawSettings: Record<string, string>; refetchSettings: () => void }) {
  const [backupFrequency, setBackupFrequency] = useState(rawSettings.backup_frequency || 'off');
  const [gdriveEnabled, setGdriveEnabled] = useState(rawSettings.backup_gdrive_enabled === 'true');
  const [emailBackupEnabled, setEmailBackupEnabled] = useState(rawSettings.backup_email_backup_enabled === 'true');
  const [savingFreq, setSavingFreq] = useState(false);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [showSystemResetModal, setShowSystemResetModal] = useState(false);
  const [resetModalInitialMode, setResetModalInitialMode] = useState<'data' | 'factory'>('data');
  const queryClient = useQueryClient();

  // Universal Escape key dismissal for Backup & Reset modals
  useModalEscape(showBackupModal, () => setShowBackupModal(false));
  useModalEscape(showSystemResetModal, () => setShowSystemResetModal(false));

  const hasGdriveAuth = !!(rawSettings.gmail_oauth_refresh_token || rawSettings.gmail_user);

  const handleSaveBackupSchedule = async () => {
    setSavingFreq(true);
    try {
      await apiClient.post('/settings/save', {
        backup_frequency: backupFrequency,
        backup_gdrive_enabled: gdriveEnabled ? 'true' : 'false',
        backup_email_backup_enabled: emailBackupEnabled ? 'true' : 'false'
      });
      toastEvent.trigger('Backup configuration updated', 'success');
      refetchSettings();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to update backup schedule: ' + e.message, 'error');
    } finally {
      setSavingFreq(false);
    }
  };

  const handleClearCache = async () => {
    try {
      queryClient.clear();
      invalidateAfterStockWrite(queryClient);
      toastEvent.trigger('Local inventory & search cache cleared successfully', 'success');
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to clear cache: ' + e.message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Database Backup Center */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2 border-b border-border pb-2">
          <Database size={16} /> Automated Database Backup & Google Drive Cloud Protection
        </h2>

        <div className="bg-bg3/30 border border-border rounded-xl p-4 space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <label className="block text-xs font-semibold text-text mb-1">Automated Schedule Frequency</label>
              <select
                value={backupFrequency}
                onChange={(e) => setBackupFrequency(e.target.value)}
                className="px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              >
                <option value="off">Off (Manual Backups Only)</option>
                <option value="daily">Daily Automatic Backup</option>
                <option value="weekly">Weekly Automatic Backup</option>
                <option value="monthly">Monthly Automatic Backup</option>
              </select>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleSaveBackupSchedule}
                disabled={savingFreq}
                className="px-4 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer"
              >
                Save Configuration
              </button>
              <button
                onClick={() => setShowBackupModal(true)}
                className="px-4 py-2 bg-bg3 border border-border text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer flex items-center gap-1.5"
              >
                <Cloud size={14} className="text-green" />
                Open Cloud Backup Vault
              </button>
            </div>
          </div>

          {/* Quick Cloud Options */}
          <div className="pt-3 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={gdriveEnabled}
                onChange={(e) => setGdriveEnabled(e.target.checked)}
                className="rounded border-border text-primary focus:ring-primary w-4 h-4 cursor-pointer"
              />
              <div>
                <span className="font-bold text-text flex items-center gap-1.5">
                  <Cloud size={13} className="text-green" />
                  Auto-Upload to Google Drive on Schedule
                </span>
                <span className="text-[11px] text-muted block">
                  {hasGdriveAuth ? `Account: ${rawSettings.gmail_user || 'Linked'}` : 'Requires Google Account connection in Backup Vault'}
                </span>
              </div>
            </label>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={emailBackupEnabled}
                onChange={(e) => setEmailBackupEnabled(e.target.checked)}
                className="rounded border-border text-primary focus:ring-primary w-4 h-4 cursor-pointer"
              />
              <div>
                <span className="font-semibold text-text block">Email Backup Attachment</span>
                <span className="text-[11px] text-muted block">Sends copy to inbox via App Password</span>
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* Maintenance, Cache & Reset */}
      <div className="space-y-4 pt-2 border-t border-border">
        <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2 border-b border-border pb-2">
          <Trash2 size={16} /> System Maintenance, Data Reset & Factory Wipe
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Card 1: Search Cache */}
          <div className="flex flex-col justify-between gap-4 bg-bg3/20 border border-border rounded-xl p-4">
            <div>
              <h3 className="text-xs font-bold text-text flex items-center gap-2">
                <RefreshCw size={14} className="text-amber-400" /> Clear Search Cache
              </h3>
              <p className="text-[11px] text-muted mt-1">Forces instant re-hydration of SQLite compact indexes without touching sales data.</p>
            </div>
            <div>
              <button
                onClick={handleClearCache}
                className="w-full py-2 bg-amber-500/10 text-amber-500 border border-amber-500/30 font-bold text-xs rounded-xl hover:bg-amber-500/20 transition-all cursor-pointer"
              >
                Clear Search Cache
              </button>
            </div>
          </div>

          {/* Card 2: System Data Reset */}
          <div className="flex flex-col justify-between gap-4 bg-bg3/20 border border-border rounded-xl p-4">
            <div>
              <h3 className="text-xs font-bold text-text flex items-center gap-2">
                <RotateCcw size={14} className="text-amber-400" /> System Data Reset
              </h3>
              <p className="text-[11px] text-muted mt-1">Wipes sales, inventory & transactions. Keeps store profile & API keys intact.</p>
            </div>
            <div>
              <button
                onClick={() => { setShowSystemResetModal(true); setResetModalInitialMode('data'); }}
                className="w-full py-2 bg-amber-500/10 text-amber-500 border border-amber-500/30 font-bold text-xs rounded-xl hover:bg-amber-500/20 transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <RotateCcw size={13} />
                <span>Reset Sales & Inventory</span>
              </button>
            </div>
          </div>

          {/* Card 3: Full Factory Reset */}
          <div className="flex flex-col justify-between gap-4 bg-red-500/5 border border-red-500/30 rounded-xl p-4">
            <div>
              <h3 className="text-xs font-bold text-red-400 flex items-center gap-2">
                <Trash2 size={14} className="text-red-400" /> Full Factory Reset (Complete Wipe)
              </h3>
              <p className="text-[11px] text-muted mt-1">Completely wipes ALL saved data, WhatsApp/Gmail tokens, Pharmarack logins, doctors, distributors & settings to fresh factory state.</p>
            </div>
            <div>
              <button
                onClick={() => { setShowSystemResetModal(true); setResetModalInitialMode('factory'); }}
                className="w-full py-2 bg-red-600 text-white font-bold text-xs rounded-xl hover:bg-red-700 transition-all cursor-pointer shadow-sm flex items-center justify-center gap-1.5"
              >
                <Trash2 size={13} />
                <span>Full Factory Reset</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Full Backup Modal */}
      {showBackupModal && (
        <div className="fixed inset-0 z-global-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-bg border border-border rounded-2xl p-6 w-full max-w-3xl max-h-[85vh] overflow-y-auto relative shadow-2xl">
            <button
              onClick={() => setShowBackupModal(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
            <BackupCenterContent onClose={() => setShowBackupModal(false)} />
          </div>
        </div>
      )}

      {/* System Data Reset Modal */}
      {showSystemResetModal && (
        <ResetDataModal
          initialMode={resetModalInitialMode}
          onClose={() => setShowSystemResetModal(false)}
          refetchSettings={refetchSettings}
        />
      )}
    </div>
  );
}

// ==========================================
// SYSTEM DATA & FACTORY RESET MODAL
// ==========================================

interface ResetDataModalProps {
  initialMode?: 'data' | 'factory';
  onClose: () => void;
  refetchSettings: () => void;
}

function ResetDataModal({ initialMode = 'data', onClose, refetchSettings }: ResetDataModalProps) {
  useModalEscape(true, onClose);
  const [resetType, setResetType] = useState<'data' | 'factory'>(initialMode);
  const [dataCounts, setDataCounts] = useState<{ medicines: number; inventory: number; bills: number; purchases: number; customers: number } | null>(null);
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [confirmInput, setConfirmInput] = useState('');
  const [resetting, setResetting] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    apiClient.get('/utilities/data-counts')
      .then(res => setDataCounts(res.data))
      .catch(err => console.warn('Failed to fetch data counts:', err))
      .finally(() => setLoadingCounts(false));
  }, []);

  const requiredWord = resetType === 'factory' ? 'FACTORY RESET' : 'RESET';
  const isConfirmed = confirmInput.trim().toUpperCase() === requiredWord;

  const handleExecuteReset = async () => {
    if (!isConfirmed) return;
    setResetting(true);
    try {
      const res = await apiClient.post('/utilities/reset-data', { wipeAll: resetType === 'factory' }, { timeout: 300000 });
      
      // 1. Purge all localStorage sent order history keys & cached state
      try {
        localStorage.removeItem('pharmacart_sent_wa_history');
        localStorage.removeItem('pharmarack_last_sent_wa_time_map');
        localStorage.removeItem('pharmarack_last_batch_sent_time');
        localStorage.removeItem('pharmarack_sent_history');
        localStorage.removeItem('pharmarack_latest_sent_map');
        localStorage.removeItem('custom_distributor_phones');
        localStorage.removeItem('pos_active_tabs');
        localStorage.removeItem('sells-date-range');
        if (resetType === 'factory') {
          localStorage.clear();
          sessionStorage.clear();
        }
      } catch (_) {}

      // 2. Clear QueryClient and invalidate queries
      queryClient.clear();
      invalidateAfterStockWrite(queryClient);
      refetchSettings();

      // 3. Dispatch events to notify all active pages
      window.dispatchEvent(new CustomEvent('clear-app-cache'));
      window.dispatchEvent(new CustomEvent('clear-sent-history'));
      window.dispatchEvent(new CustomEvent('settings-updated'));

      toastEvent.trigger(res.data?.message || 'Database reset successfully', 'success');
      onClose();

      // 4. Force browser page reload after short delay to flush all module-level memory variables across SPA
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('System reset failed: ' + (e.response?.data?.error || e.message || 'Unknown error'), 'error');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-global-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-bg border border-border rounded-2xl p-6 w-full max-w-xl relative shadow-2xl space-y-5">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer"
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-red-500/10 text-red-500 border border-red-500/30">
            <AlertTriangle size={24} />
          </div>
          <div>
            <h2 className="text-base font-bold text-text">System Data Reset & Factory Initialization</h2>
            <p className="text-xs text-muted">Re-initialize database tables, self-heal schemas, or execute full factory reset.</p>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => { setResetType('data'); setConfirmInput(''); }}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              resetType === 'data'
                ? 'bg-amber-500/10 border-amber-500/40 text-amber-500 font-bold'
                : 'bg-bg3/30 border-border text-muted hover:text-text'
            }`}
          >
            <div className="font-bold text-xs flex items-center gap-1.5">
              <RotateCcw size={14} /> System Data Reset
            </div>
            <p className="text-[11px] mt-1 opacity-80">Wipes sales, inventory & transactions. Keeps store profile & API keys intact.</p>
          </button>

          <button
            type="button"
            onClick={() => { setResetType('factory'); setConfirmInput(''); }}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              resetType === 'factory'
                ? 'bg-red-500/10 border-red-500/40 text-red-500 font-bold'
                : 'bg-bg3/30 border-border text-muted hover:text-text'
            }`}
          >
            <div className="font-bold text-xs flex items-center gap-1.5">
              <Trash2 size={14} /> Full Factory Reset
            </div>
            <p className="text-[11px] mt-1 opacity-80">Complete wipe of all data, store profile, cashier accounts & integration tokens.</p>
          </button>
        </div>

        {/* Impact Summary */}
        <div className="bg-bg3/30 border border-border rounded-xl p-4 space-y-2">
          <h3 className="text-xs font-bold text-text uppercase tracking-wider">Live Database Snapshot</h3>
          {loadingCounts ? (
            <div className="flex items-center text-xs text-muted py-2">
              <RefreshCw size={14} className="animate-spin mr-2" /> Counting active records...
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-center text-xs">
              <div className="p-2 bg-bg rounded-lg border border-border">
                <div className="font-bold text-text">{dataCounts?.medicines ?? 0}</div>
                <div className="text-[10px] text-muted">Medicines</div>
              </div>
              <div className="p-2 bg-bg rounded-lg border border-border">
                <div className="font-bold text-text">{dataCounts?.inventory ?? 0}</div>
                <div className="text-[10px] text-muted">Batches</div>
              </div>
              <div className="p-2 bg-bg rounded-lg border border-border">
                <div className="font-bold text-text">{dataCounts?.bills ?? 0}</div>
                <div className="text-[10px] text-muted">Sales Bills</div>
              </div>
              <div className="p-2 bg-bg rounded-lg border border-border">
                <div className="font-bold text-text">{dataCounts?.purchases ?? 0}</div>
                <div className="text-[10px] text-muted">Purchases</div>
              </div>
              <div className="p-2 bg-bg rounded-lg border border-border">
                <div className="font-bold text-text">{dataCounts?.customers ?? 0}</div>
                <div className="text-[10px] text-muted">Customers</div>
              </div>
            </div>
          )}
        </div>

        {/* Confirmation Input */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-text">
            Type <span className="font-mono font-bold text-red-400">{requiredWord}</span> to confirm execution:
          </label>
          <input
            type="text"
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            placeholder={`Type ${requiredWord} here`}
            className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-red-500 focus:outline-none"
          />
        </div>

        {/* Modal Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-bg3 border border-border text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleExecuteReset}
            disabled={!isConfirmed || resetting}
            className={`flex items-center gap-2 px-5 py-2 font-bold text-xs rounded-xl transition-all cursor-pointer shadow-sm ${
              isConfirmed && !resetting
                ? resetType === 'factory' ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-amber-600 text-white hover:bg-amber-700'
                : 'bg-muted/20 text-muted cursor-not-allowed border border-border'
            }`}
          >
            {resetting ? <RefreshCw size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            <span>Execute {resetType === 'factory' ? 'Factory Reset' : 'System Reset'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SUB-TAB 5: TRIGGER SCHEDULES & AUTOMATION
// ==========================================

function TriggerSchedulesTab({ rawSettings, refetchSettings }: { rawSettings: Record<string, string>; refetchSettings: () => void }) {
  const [formData, setFormData] = useState({
    automationEnabled: rawSettings.automation_enabled !== 'false',

    // 1. Daily Operational Check
    triggerDailyCheckEnabled: rawSettings.trigger_daily_check_enabled !== 'false',
    triggerDailyCheckTime: rawSettings.trigger_daily_check_time || '09:00',
    dailyBriefingTemplate: rawSettings.daily_briefing_template || 'detailed',

    // 2. Near-Expiry Stock Scan
    triggerExpiryScanEnabled: rawSettings.trigger_expiry_scan_enabled !== 'false',
    triggerExpiryScanTime: rawSettings.trigger_expiry_scan_time || '09:00',
    triggerExpiryScanDays: rawSettings.trigger_expiry_scan_days || '1,16',
    triggerExpiryLookaheadDays: rawSettings.trigger_expiry_lookahead_days || '90',

    // 3. Distributor Dispatch Reminder
    triggerDispatchReminderEnabled: rawSettings.trigger_dispatch_reminder_enabled === 'true',
    triggerDispatchReminderTimeStart: rawSettings.trigger_dispatch_reminder_time_start || '12:30',
    triggerDispatchReminderTimeEnd: rawSettings.trigger_dispatch_reminder_time_end || '13:00',
    triggerAfternoonDispatchReminderEnabled: rawSettings.trigger_afternoon_dispatch_reminder_enabled === 'true',
    triggerAfternoonDispatchReminderTime: rawSettings.trigger_afternoon_dispatch_reminder_time || '14:00',

    // 4. Nightly Database Backup
    triggerBackupEnabled: rawSettings.trigger_backup_enabled !== 'false',
    triggerBackupTime: rawSettings.trigger_backup_time || '21:59',

    // 5. Auto Expiry Return Memos
    triggerExpiryReturnEnabled: rawSettings.trigger_expiry_return_enabled !== 'false',
    triggerExpiryReturnIntervalDays: rawSettings.trigger_expiry_return_interval_days || '15',

    // 6. Pharmarack Token Refresher
    triggerPharmarackRefreshEnabled: rawSettings.trigger_pharmarack_refresh_enabled !== 'false',
    triggerPharmarackRefreshIntervalMin: rawSettings.trigger_pharmarack_refresh_interval_min || '20',

    // 7. WhatsApp Message Queue
    triggerWhatsappQueueEnabled: rawSettings.trigger_whatsapp_queue_enabled !== 'false',
    triggerWhatsappQueueIntervalSec: rawSettings.trigger_whatsapp_queue_interval_sec || '30',

    // 8. Email PDF Invoice Poller
    triggerEmailPollerEnabled: rawSettings.trigger_email_poller_enabled !== 'false',
    triggerEmailPollerIntervalMin: rawSettings.trigger_email_poller_interval_min || '15',

    // 9. Doctor Daily Reports
    triggerDoctorReportEnabled: rawSettings.trigger_doctor_report_enabled !== 'false',
    triggerDoctorReportTime: rawSettings.trigger_doctor_report_time || '20:00',

    // 10. Patient Chronic Refill Evaluator
    triggerRefillsEnabled: rawSettings.trigger_refills_enabled !== 'false',
    triggerRefillsCheckTime: rawSettings.trigger_refills_check_time || '09:00',
    defaultRefillReminderMode: rawSettings.default_refill_reminder_mode || 'manual',
    reminderAdminPreviewEnabled: rawSettings.reminder_admin_preview_enabled !== 'false',

    // 11. Pharmarack Cart Auto-Send Cutoff
    triggerPharmarackCartSendEnabled: rawSettings.trigger_pharmarack_cart_send_enabled !== 'false',
    triggerPharmarackCartSendTime: rawSettings.trigger_pharmarack_cart_send_time || '11:00',

    // 12. Non-WhatsApp Patient Fallback
    nonWaFallbackEnabled: rawSettings.non_wa_fallback_enabled !== 'false',
    nonWaFallbackMode: rawSettings.non_wa_fallback_mode || 'both',
    nonWaFallbackAlertPhone: rawSettings.non_wa_fallback_alert_phone || '',
  });

  const [saving, setSaving] = useState(false);
  const [sendingTestBriefing, setSendingTestBriefing] = useState(false);
  const queryClient = useQueryClient();

  const handleSendTestBriefing = async () => {
    setSendingTestBriefing(true);
    try {
      const res = await apiClient.post('/settings/send-test-briefing', {
        template: formData.dailyBriefingTemplate
      });
      if (res.data?.success) {
        toastEvent.trigger(res.data.message || 'Test briefing dispatched to store WhatsApp!', 'success');
      } else {
        toastEvent.trigger(res.data?.error || 'Failed to send test briefing', 'error');
      }
    } catch (err: any) {
      toastEvent.trigger(err?.response?.data?.error || err?.message || 'Failed to send test briefing', 'error');
    } finally {
      setSendingTestBriefing(false);
    }
  };

  const handleSaveTriggers = async () => {
    setSaving(true);
    try {
      const payload: Record<string, string> = {
        automation_enabled: formData.automationEnabled ? 'true' : 'false',
        trigger_daily_check_enabled: formData.triggerDailyCheckEnabled ? 'true' : 'false',
        trigger_daily_check_time: formData.triggerDailyCheckTime,
        daily_briefing_template: formData.dailyBriefingTemplate || 'detailed',
        trigger_expiry_scan_enabled: formData.triggerExpiryScanEnabled ? 'true' : 'false',
        trigger_expiry_scan_time: formData.triggerExpiryScanTime,
        trigger_expiry_scan_days: formData.triggerExpiryScanDays,
        trigger_expiry_lookahead_days: formData.triggerExpiryLookaheadDays,
        trigger_dispatch_reminder_enabled: formData.triggerDispatchReminderEnabled ? 'true' : 'false',
        trigger_dispatch_reminder_time_start: formData.triggerDispatchReminderTimeStart,
        trigger_dispatch_reminder_time_end: formData.triggerDispatchReminderTimeEnd,
        trigger_afternoon_dispatch_reminder_enabled: formData.triggerAfternoonDispatchReminderEnabled ? 'true' : 'false',
        trigger_afternoon_dispatch_reminder_time: formData.triggerAfternoonDispatchReminderTime,
        trigger_backup_enabled: formData.triggerBackupEnabled ? 'true' : 'false',
        trigger_backup_time: formData.triggerBackupTime,
        trigger_expiry_return_enabled: formData.triggerExpiryReturnEnabled ? 'true' : 'false',
        trigger_expiry_return_interval_days: formData.triggerExpiryReturnIntervalDays,
        trigger_pharmarack_refresh_enabled: formData.triggerPharmarackRefreshEnabled ? 'true' : 'false',
        trigger_pharmarack_refresh_interval_min: formData.triggerPharmarackRefreshIntervalMin,
        trigger_whatsapp_queue_enabled: formData.triggerWhatsappQueueEnabled ? 'true' : 'false',
        trigger_whatsapp_queue_interval_sec: formData.triggerWhatsappQueueIntervalSec,
        trigger_email_poller_enabled: formData.triggerEmailPollerEnabled ? 'true' : 'false',
        trigger_email_poller_interval_min: formData.triggerEmailPollerIntervalMin,
        trigger_doctor_report_enabled: formData.triggerDoctorReportEnabled ? 'true' : 'false',
        trigger_doctor_report_time: formData.triggerDoctorReportTime,
        trigger_refills_enabled: formData.triggerRefillsEnabled ? 'true' : 'false',
        trigger_refills_check_time: formData.triggerRefillsCheckTime,
        default_refill_reminder_mode: formData.defaultRefillReminderMode,
        reminder_admin_preview_enabled: formData.reminderAdminPreviewEnabled ? 'true' : 'false',
        trigger_pharmarack_cart_send_enabled: formData.triggerPharmarackCartSendEnabled ? 'true' : 'false',
        trigger_pharmarack_cart_send_time: formData.triggerPharmarackCartSendTime,
        // Non-WhatsApp patient fallback (v69)
        non_wa_fallback_enabled: formData.nonWaFallbackEnabled ? 'true' : 'false',
        non_wa_fallback_mode: formData.nonWaFallbackMode,
        non_wa_fallback_alert_phone: formData.nonWaFallbackAlertPhone,
      };

      await api.saveSettings(payload);
      refetchSettings();
      updateSettingsCache(queryClient, payload);
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toastEvent.trigger('Automated trigger schedules saved & applied successfully!', 'success');
    } catch (err) {
      console.error('Failed to save trigger schedules:', err);
      toastEvent.trigger('Failed to save trigger schedules', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner & Save Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-bg3/40 border border-border">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 mt-0.5">
            <Clock size={22} />
          </div>
          <div>
            <h2 className="text-sm font-bold text-text">Automated Trigger Schedule Engine</h2>
            <p className="text-xs text-muted mt-0.5">Configure execution times, frequency intervals & auto-triggers for every background worker in AI PHARMACY OS.</p>
          </div>
        </div>

        <button
          onClick={handleSaveTriggers}
          disabled={saving}
          className="flex items-center justify-center gap-2 px-5 py-2.5 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm disabled:opacity-50"
        >
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
          <span>{saving ? 'Applying Schedules...' : 'Save & Apply Schedules'}</span>
        </button>
      </div>

      {/* Global Master Toggle */}
      <div className="p-4 rounded-2xl bg-bg3/20 border border-border flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-text">Master Background Automation Switch</div>
          <div className="text-[11px] text-muted">Master override to enable or pause all background automated workers across the system.</div>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={formData.automationEnabled}
            onChange={(e) => setFormData({ ...formData, automationEnabled: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-bg3 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
        </label>
      </div>

      {/* Grid of 10 Trigger Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Trigger 1: Daily Operational Check */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-500" />
              <span className="text-xs font-bold text-text">Daily Operational Check</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerDailyCheckEnabled}
                onChange={(e) => setFormData({ ...formData, triggerDailyCheckEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Evaluates patient refills, checks overdue Khata credit notes, and triggers bounced product alerts daily.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Execution Time:</label>
            <input
              type="time"
              value={formData.triggerDailyCheckTime}
              onChange={(e) => setFormData({ ...formData, triggerDailyCheckTime: e.target.value })}
              className="px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>

          {/* WhatsApp Briefing Template Selection & Live Test */}
          <div className="pt-2 border-t border-border/60 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-text">WhatsApp Briefing Template:</label>
              <button
                type="button"
                onClick={handleSendTestBriefing}
                disabled={sendingTestBriefing}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all cursor-pointer disabled:opacity-50"
              >
                {sendingTestBriefing ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}
                <span>Send Test Briefing</span>
              </button>
            </div>
            <select
              value={formData.dailyBriefingTemplate}
              onChange={(e) => setFormData({ ...formData, dailyBriefingTemplate: e.target.value })}
              className="w-full px-2.5 py-1.5 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary font-medium"
            >
              <option value="detailed">Template 4: Itemized Detail List (Default - Medicines & Qty)</option>
              <option value="compact">Template 1: Compact Worklist (Patients & Stock Only)</option>
              <option value="checklist">Template 2: Action Checklist ([ ] Priorities)</option>
              <option value="executive">Template 3: Executive Summary (Counts & Status)</option>
            </select>
            <p className="text-[10px] text-muted">
              {formData.dailyBriefingTemplate === 'detailed' && 'Includes full medicine brand names, quantities, and stock status for each patient.'}
              {formData.dailyBriefingTemplate === 'compact' && 'Compact view showing patient names and medicine counts without long brand names.'}
              {formData.dailyBriefingTemplate === 'checklist' && 'Numbered operational to-do checklist with priority task order.'}
              {formData.dailyBriefingTemplate === 'executive' && 'Fast 5-line summary highlighting total counts, high alerts, and store status.'}
            </p>
          </div>
        </div>

        {/* Trigger 2: Near-Expiry Stock Scan */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" />
              <span className="text-xs font-bold text-text">Near-Expiry Stock Scan & Alerts</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerExpiryScanEnabled}
                onChange={(e) => setFormData({ ...formData, triggerExpiryScanEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Scans inventory for batches nearing expiration and sends alerts to store owner.</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] font-semibold text-text">Time:</label>
              <input
                type="time"
                value={formData.triggerExpiryScanTime}
                onChange={(e) => setFormData({ ...formData, triggerExpiryScanTime: e.target.value })}
                className="w-full px-2 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] font-semibold text-text">Days:</label>
              <input
                type="text"
                placeholder="1,16"
                value={formData.triggerExpiryScanDays}
                onChange={(e) => setFormData({ ...formData, triggerExpiryScanDays: e.target.value })}
                className="w-full px-2 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>

        {/* Trigger 3: Distributor Dispatch Reminder */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Truck size={16} className="text-blue-500" />
              <span className="text-xs font-bold text-text">Distributor Dispatch Reminders</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerDispatchReminderEnabled}
                onChange={(e) => setFormData({ ...formData, triggerDispatchReminderEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Sends automated daily dispatches and stock reminders to suppliers during active window.</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] font-semibold text-text">Start:</label>
              <input
                type="time"
                value={formData.triggerDispatchReminderTimeStart}
                onChange={(e) => setFormData({ ...formData, triggerDispatchReminderTimeStart: e.target.value })}
                className="w-full px-2 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] font-semibold text-text">End:</label>
              <input
                type="time"
                value={formData.triggerDispatchReminderTimeEnd}
                onChange={(e) => setFormData({ ...formData, triggerDispatchReminderTimeEnd: e.target.value })}
                className="w-full px-2 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>

        {/* Trigger 3B: Afternoon Delivery Boy Dispatch */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Truck size={16} className="text-emerald-500" />
              <span className="text-xs font-bold text-text">Afternoon Delivery Boy Dispatch</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerAfternoonDispatchReminderEnabled}
                onChange={(e) => setFormData({ ...formData, triggerAfternoonDispatchReminderEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Sends a consolidated WhatsApp collection summary with repeat order counts (e.g. 2x) to active Delivery Staff.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Dispatch Time:</label>
            <input
              type="time"
              value={formData.triggerAfternoonDispatchReminderTime}
              onChange={(e) => setFormData({ ...formData, triggerAfternoonDispatchReminderTime: e.target.value })}
              className="px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Trigger 4: Nightly Database Backup */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database size={16} className="text-purple-500" />
              <span className="text-xs font-bold text-text">Nightly Database Backup</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerBackupEnabled}
                onChange={(e) => setFormData({ ...formData, triggerBackupEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Automatically compiles compressed database backups every night.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Backup Time:</label>
            <input
              type="time"
              value={formData.triggerBackupTime}
              onChange={(e) => setFormData({ ...formData, triggerBackupTime: e.target.value })}
              className="px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Trigger 5: Auto Expiry Return Review Scans */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RotateCcw size={16} className="text-indigo-500" />
              <span className="text-xs font-bold text-text">Auto Expiry Return Review Scans</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerExpiryReturnEnabled}
                onChange={(e) => setFormData({ ...formData, triggerExpiryReturnEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Scans in-stock inventory only (never sold or already-returned batches) for expired batches and creates pending items for pharmacist review. Requires manual approval before stock deduction.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Interval (days):</label>
            <input
              type="number"
              min="1"
              max="365"
              placeholder="15"
              value={formData.triggerExpiryReturnIntervalDays}
              onChange={(e) => setFormData({ ...formData, triggerExpiryReturnIntervalDays: e.target.value })}
              className="w-full px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Trigger 6: Pharmarack Token Refresher */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RefreshCw size={16} className="text-teal-500" />
              <span className="text-xs font-bold text-text">Pharmarack Token Refresher</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerPharmarackRefreshEnabled}
                onChange={(e) => setFormData({ ...formData, triggerPharmarackRefreshEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Keeps Pharmarack session rolling and refreshes OAuth tokens headlessly.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Interval (Minutes):</label>
            <input
              type="number"
              min="5"
              max="120"
              value={formData.triggerPharmarackRefreshIntervalMin}
              onChange={(e) => setFormData({ ...formData, triggerPharmarackRefreshIntervalMin: e.target.value })}
              className="w-24 px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Trigger 7: WhatsApp Message Queue */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageCircle size={16} className="text-green-500" />
              <span className="text-xs font-bold text-text">WhatsApp Message Queue</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerWhatsappQueueEnabled}
                onChange={(e) => setFormData({ ...formData, triggerWhatsappQueueEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Processes pending outbound WhatsApp messages with rate-limiting and anti-ban protection.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Interval (Seconds):</label>
            <input
              type="number"
              min="5"
              max="300"
              value={formData.triggerWhatsappQueueIntervalSec}
              onChange={(e) => setFormData({ ...formData, triggerWhatsappQueueIntervalSec: e.target.value })}
              className="w-24 px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Trigger 8: Email PDF Invoice Poller */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail size={16} className="text-cyan-500" />
              <span className="text-xs font-bold text-text">Email PDF Invoice Poller</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerEmailPollerEnabled}
                onChange={(e) => setFormData({ ...formData, triggerEmailPollerEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Scans linked store email inbox for incoming distributor invoices and queues OCR parsing.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Polling (Minutes):</label>
            <input
              type="number"
              min="5"
              max="120"
              value={formData.triggerEmailPollerIntervalMin}
              onChange={(e) => setFormData({ ...formData, triggerEmailPollerIntervalMin: e.target.value })}
              className="w-24 px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Trigger 9: Doctor Daily Reports */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Stethoscope size={16} className="text-rose-500" />
              <span className="text-xs font-bold text-text">Doctor Daily Summary Reports</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerDoctorReportEnabled}
                onChange={(e) => setFormData({ ...formData, triggerDoctorReportEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-rose-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Compiles daily prescription statistics and emails/whatsapps reports to partner doctors.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Report Time:</label>
            <input
              type="time"
              value={formData.triggerDoctorReportTime}
              onChange={(e) => setFormData({ ...formData, triggerDoctorReportTime: e.target.value })}
              className="px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Trigger 10: Chronic Refill Evaluator */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap size={16} className="text-sky-500" />
              <span className="text-xs font-bold text-text">Chronic Medication Refill Alerts</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerRefillsEnabled}
                onChange={(e) => setFormData({ ...formData, triggerRefillsEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Scans chronic dosage schedules and queues 3-day refill alerts for patients.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Check Time:</label>
            <input
              type="time"
              value={formData.triggerRefillsCheckTime}
              onChange={(e) => setFormData({ ...formData, triggerRefillsCheckTime: e.target.value })}
              className="px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>

          <div className="pt-2 border-t border-border/40 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold text-text">Default Dispatch Mode</div>
                <div className="text-[10px] text-muted">Initial mode for newly enrolled refill patients</div>
              </div>
              <div className="flex items-center bg-bg rounded-lg p-0.5 border border-border text-[11px]">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, defaultRefillReminderMode: 'manual' })}
                  className={`px-2 py-1 rounded-md font-bold transition-all ${
                    formData.defaultRefillReminderMode === 'manual'
                      ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30'
                      : 'text-muted hover:text-text'
                  }`}
                >
                  Manual 👆
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, defaultRefillReminderMode: 'auto' })}
                  className={`px-2 py-1 rounded-md font-bold transition-all ${
                    formData.defaultRefillReminderMode === 'auto'
                      ? 'bg-primary/20 text-primary border border-primary/30'
                      : 'text-muted hover:text-text'
                  }`}
                >
                  Auto 🤖
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold text-text">Alert Pharmacy WhatsApp First</div>
                <div className="text-[10px] text-muted">Send staged refill briefing to store number before dispatch</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.reminderAdminPreviewEnabled}
                  onChange={(e) => setFormData({ ...formData, reminderAdminPreviewEnabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-zinc-100 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-100 after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>
          </div>
        </div>

        {/* Trigger 10b: Non-WhatsApp Patient Fallback */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Phone size={16} className="text-orange-400" />
              <span className="text-xs font-bold text-text">Non-WhatsApp Patient Fallback</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                id="non-wa-fallback-enabled"
                checked={formData.nonWaFallbackEnabled}
                onChange={(e) => setFormData({ ...formData, nonWaFallbackEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-zinc-100 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-100 after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-400"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">When a refill or credit patient does not have WhatsApp, create a call task for counter staff and/or alert the pharmacy owner to call them manually.</p>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-semibold text-text whitespace-nowrap w-24">Channel:</label>
              <select
                id="non-wa-fallback-mode"
                value={formData.nonWaFallbackMode}
                onChange={(e) => setFormData({ ...formData, nonWaFallbackMode: e.target.value })}
                className="px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary flex-1"
              >
                <option value="both">Both — In-App Call Board + Owner WhatsApp Alert</option>
                <option value="board">In-App Call Board Only</option>
                <option value="owner">Owner WhatsApp Alert Only</option>
                <option value="off">Disabled</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-semibold text-text whitespace-nowrap w-24">Alert Phone:</label>
              <input
                id="non-wa-fallback-alert-phone"
                type="tel"
                value={formData.nonWaFallbackAlertPhone}
                onChange={(e) => setFormData({ ...formData, nonWaFallbackAlertPhone: e.target.value })}
                placeholder="Owner WhatsApp number (e.g. 9876543210)"
                className="px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary flex-1"
              />
            </div>
            <p className="text-[10px] text-muted">Leave Alert Phone blank to use the Admin WhatsApp number configured above.</p>
          </div>
        </div>

        {/* Trigger 11: Pharmarack Cart Daily Auto-Send Cutoff */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart size={16} className="text-emerald-400" />
              <span className="text-xs font-bold text-text">Pharmarack Cart Auto-Send Cutoff</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerPharmarackCartSendEnabled}
                onChange={(e) => setFormData({ ...formData, triggerPharmarackCartSendEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-zinc-100 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-100 after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Daily deadline when today's Pharmarack cart orders automatically batch-dispatch to suppliers & delivery boys.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Cutoff Time:</label>
            <input
              type="time"
              value={formData.triggerPharmarackCartSendTime}
              onChange={(e) => setFormData({ ...formData, triggerPharmarackCartSendTime: e.target.value })}
              className="px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SUB-TAB 6: MULTI-STORE & CENTRAL SYNC
// ==========================================

function MultiStoreTab() {
  const [stores, setStores] = useState<Array<{ id: number; name: string; code?: string; address?: string; phone?: string; email?: string; is_central: number; is_active: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<{ store_id: number; pending_count: number; synced_count: number; conflict_count: number; last_synced_at: string | null } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newStore, setNewStore] = useState({
    name: '',
    code: '',
    address: '',
    phone: '',
    email: '',
    is_central: false
  });

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [storesData, syncData] = await Promise.all([
        api.getStores(true),
        api.getSyncStatus().catch(() => null)
      ]);
      setStores(storesData || []);
      setSyncStatus(syncData);
    } catch (err) {
      console.warn('[MultiStoreTab] Failed to load store data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStore.name.trim()) {
      toastEvent.trigger('Store name is required', 'error');
      return;
    }
    try {
      await api.createStore(newStore);
      toastEvent.trigger(`Store "${newStore.name}" created successfully`, 'success');
      setShowAddModal(false);
      setNewStore({ name: '', code: '', address: '', phone: '', email: '', is_central: false });
      loadData();
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || err.message || 'Failed to create store', 'error');
    }
  };

  const handlePushSync = async () => {
    try {
      setSyncing(true);
      const res = await api.pushSync(100);
      toastEvent.trigger(`Sync Push completed: ${res.pushedCount} item(s) synchronized`, 'success');
      loadData();
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || err.message || 'Push sync failed', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handlePullSync = async () => {
    try {
      setSyncing(true);
      const res = await api.pullSync([]);
      toastEvent.trigger(`Sync Pull completed: ${res.appliedCount} applied, ${res.conflictsCount} conflict(s)`, 'success');
      loadData();
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || err.message || 'Pull sync failed', 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Add Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h3 className="text-base font-bold text-text flex items-center gap-2">
            <StoreIcon size={18} className="text-primary" />
            <span>Store Network & Branches</span>
          </h3>
          <p className="text-xs text-muted mt-0.5">Manage local pharmacy branches, central warehouse identity, and offline data sync.</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-3 py-1.5 bg-primary text-white text-xs font-bold rounded-xl shadow-sm hover:bg-primary/90 transition-all flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
        >
          <Plus size={14} />
          <span>Add New Branch</span>
        </button>
      </div>

      {/* Store Directory Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {stores.map((s) => (
          <div key={s.id} className="p-4 rounded-2xl bg-bg2 border border-border shadow-sm flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className={`p-2 rounded-xl border ${s.is_central ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' : 'bg-primary/10 text-primary border-primary/20'}`}>
                    {s.is_central ? <Building2 size={16} /> : <GitBranch size={16} />}
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-text">{s.name}</h4>
                    <span className="font-mono text-[11px] text-muted">{s.code || `STORE-${s.id}`}</span>
                  </div>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${s.is_central ? 'bg-amber-500/10 text-amber-500 border-amber-500/30' : 'bg-blue-500/10 text-blue-500 border-blue-500/30'}`}>
                  {s.is_central ? 'Central' : 'Branch'}
                </span>
              </div>

              <div className="text-xs text-muted space-y-1 mt-3">
                {s.address && <p className="truncate flex items-center gap-1.5"><MapPin size={12} className="text-muted shrink-0" /> {s.address}</p>}
                {s.phone && <p className="truncate flex items-center gap-1.5"><MessageCircle size={12} className="text-muted shrink-0" /> {s.phone}</p>}
                {s.email && <p className="truncate flex items-center gap-1.5"><Mail size={12} className="text-muted shrink-0" /> {s.email}</p>}
              </div>
            </div>

            <div className="pt-2 border-t border-border/50 flex items-center justify-between text-[11px]">
              <span className="text-emerald-500 font-medium flex items-center gap-1">
                <CheckCircle2 size={12} /> Active
              </span>
              <span className="text-muted font-mono">Store ID: #{s.id}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Central + Local Sync Card */}
      <div className="p-5 rounded-2xl bg-bg2 border border-border space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky border border-sky-500/20">
              <RefreshCw size={16} />
            </div>
            <div>
              <h4 className="text-sm font-bold text-text">Central & Local Synchronization Hub</h4>
              <p className="text-xs text-muted">Offline-first local changes queued in SQLite sync ledger, pushed to central server on connectivity.</p>
            </div>
          </div>
          <button
            onClick={loadData}
            disabled={loading}
            className="p-1.5 text-muted hover:text-text rounded-lg hover:bg-bg3 border border-border"
            title="Refresh Sync Status"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Sync Metrics Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-bg3/40 border border-border text-left">
            <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Pending Push</span>
            <div className="text-lg font-black text-amber-500 mt-0.5">{syncStatus?.pending_count ?? 0}</div>
          </div>
          <div className="p-3 rounded-xl bg-bg3/40 border border-border text-left">
            <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Synced Records</span>
            <div className="text-lg font-black text-emerald-500 mt-0.5">{syncStatus?.synced_count ?? 0}</div>
          </div>
          <div className="p-3 rounded-xl bg-bg3/40 border border-border text-left">
            <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Conflicts</span>
            <div className="text-lg font-black text-rose-500 mt-0.5">{syncStatus?.conflict_count ?? 0}</div>
          </div>
          <div className="p-3 rounded-xl bg-bg3/40 border border-border text-left">
            <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Last Synced</span>
            <div className="text-xs font-semibold text-text truncate mt-1">
              {syncStatus?.last_synced_at ? new Date(syncStatus.last_synced_at).toLocaleTimeString() : 'Never'}
            </div>
          </div>
        </div>

        {/* Sync Actions */}
        <div className="flex flex-wrap gap-2.5 pt-2">
          <button
            onClick={handlePushSync}
            disabled={syncing}
            className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <ArrowUpFromLine size={14} />
            <span>Push Local Changes to Central</span>
          </button>
          <button
            onClick={handlePullSync}
            disabled={syncing}
            className="px-4 py-2 rounded-xl bg-bg3 hover:bg-bg3/80 text-text border border-border text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <ArrowDownToLine size={14} />
            <span>Pull Central Catalog & Updates</span>
          </button>
        </div>
      </div>

      {/* Add Branch Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-global-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 text-left">
          <div className="bg-bg border border-border w-full max-w-md rounded-3xl p-6 space-y-4 text-left shadow-2xl">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <StoreIcon size={18} className="text-primary" />
                <h3 className="font-bold text-sm text-text">Add Pharmacy Branch / Store</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-lg hover:bg-bg3 text-muted hover:text-text"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateStore} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-text">Store Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. City Care Pharmacy - Branch 2"
                  value={newStore.name}
                  onChange={(e) => setNewStore({ ...newStore, name: e.target.value })}
                  className="w-full mt-1 px-3 py-2 text-xs bg-bg2 border border-border rounded-xl text-text focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-text">Store Code</label>
                <input
                  type="text"
                  placeholder="e.g. STORE-B"
                  value={newStore.code}
                  onChange={(e) => setNewStore({ ...newStore, code: e.target.value })}
                  className="w-full mt-1 px-3 py-2 text-xs bg-bg2 border border-border rounded-xl text-text focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-text">Address</label>
                <input
                  type="text"
                  placeholder="e.g. 45 Park Avenue, Mumbai"
                  value={newStore.address}
                  onChange={(e) => setNewStore({ ...newStore, address: e.target.value })}
                  className="w-full mt-1 px-3 py-2 text-xs bg-bg2 border border-border rounded-xl text-text focus:outline-none focus:border-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-bold text-text">Phone / WhatsApp</label>
                  <input
                    type="text"
                    placeholder="9876543210"
                    value={newStore.phone}
                    onChange={(e) => setNewStore({ ...newStore, phone: e.target.value })}
                    className="w-full mt-1 px-3 py-2 text-xs bg-bg2 border border-border rounded-xl text-text focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-text">Email</label>
                  <input
                    type="email"
                    placeholder="branch@pharmacy.com"
                    value={newStore.email}
                    onChange={(e) => setNewStore({ ...newStore, email: e.target.value })}
                    className="w-full mt-1 px-3 py-2 text-xs bg-bg2 border border-border rounded-xl text-text focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl bg-bg3 text-muted hover:text-text text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-primary text-white text-xs font-bold shadow-md hover:bg-primary/90"
                >
                  Save Store
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// SUB-TAB: ORDERS & FULFILMENT TIMING
// ==========================================

interface PharmacyHolidayItem {
  id: number;
  store_id: number;
  holiday_date: string;
  holiday_name: string;
  is_closed: number;
  custom_window_start: string | null;
  custom_window_end: string | null;
  created_at: string;
}

function OrderTimingTab({ rawSettings, refetchSettings }: { rawSettings: Record<string, string>; refetchSettings: () => void }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  // Form states
  const [cutoffTime, setCutoffTime] = useState(rawSettings.pharmacy_cutoff_time || '23:00');
  const [deliveryStart, setDeliveryStart] = useState(rawSettings.delivery_window_start || '19:00');
  const [deliveryEnd, setDeliveryEnd] = useState(rawSettings.delivery_window_end || '21:00');
  const [sundayEnabled, setSundayEnabled] = useState(rawSettings.sunday_orders_enabled === 'true');
  const [sundayStart, setSundayStart] = useState(rawSettings.sunday_window_start || '10:00');
  const [sundayEnd, setSundayEnd] = useState(rawSettings.sunday_window_end || '14:00');
  const [holidayDeliveryEnabled, setHolidayDeliveryEnabled] = useState(rawSettings.holiday_delivery_enabled === 'true');
  const [returnWindowDays, setReturnWindowDays] = useState(rawSettings.return_window_days || '15');
  const [refillPauseRecalc, setRefillPauseRecalc] = useState(rawSettings.refill_pause_recalculation_enabled !== 'false');

  // Holidays state
  const [holidays, setHolidays] = useState<PharmacyHolidayItem[]>([]);
  const [loadingHolidays, setLoadingHolidays] = useState(false);
  const [showAddHoliday, setShowAddHoliday] = useState(false);
  const [holidayForm, setHolidayForm] = useState({
    name: '',
    date: '',
    isClosed: true,
    customStart: '10:00',
    customEnd: '14:00'
  });
  const [savingHoliday, setSavingHoliday] = useState(false);
  const [deletingHolidayId, setDeletingHolidayId] = useState<number | null>(null);

  const fetchHolidays = useCallback(async () => {
    setLoadingHolidays(true);
    try {
      const res = await apiClient.get('/settings/holidays');
      if (res?.data?.holidays) {
        setHolidays(res.data.holidays);
      }
    } catch (err: any) {
      console.error('Failed to load holidays:', err);
    } finally {
      setLoadingHolidays(false);
    }
  }, []);

  useEffect(() => {
    fetchHolidays();
  }, [fetchHolidays]);

  const handleSaveTimingSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, string> = {
        pharmacy_cutoff_time: cutoffTime,
        delivery_window_start: deliveryStart,
        delivery_window_end: deliveryEnd,
        sunday_orders_enabled: sundayEnabled ? 'true' : 'false',
        sunday_window_start: sundayStart,
        sunday_window_end: sundayEnd,
        holiday_delivery_enabled: holidayDeliveryEnabled ? 'true' : 'false',
        return_window_days: returnWindowDays,
        refill_pause_recalculation_enabled: refillPauseRecalc ? 'true' : 'false'
      };

      await apiClient.post('/settings/save', payload);
      toastEvent.trigger('Fulfilment timing & order rules updated successfully', 'success');
      updateSettingsCache(queryClient, payload);
      refetchSettings();
    } catch (err: any) {
      toastEvent.trigger('Failed to save timing settings: ' + (err?.message || 'Unknown error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holidayForm.name.trim() || !holidayForm.date) {
      toastEvent.trigger('Holiday name and date are required', 'error');
      return;
    }

    setSavingHoliday(true);
    try {
      await apiClient.post('/settings/holidays', {
        holiday_name: holidayForm.name.trim(),
        holiday_date: holidayForm.date,
        is_closed: holidayForm.isClosed,
        custom_window_start: holidayForm.isClosed ? null : holidayForm.customStart,
        custom_window_end: holidayForm.isClosed ? null : holidayForm.customEnd
      });

      toastEvent.trigger(`Holiday "${holidayForm.name}" added`, 'success');
      setHolidayForm({ name: '', date: '', isClosed: true, customStart: '10:00', customEnd: '14:00' });
      setShowAddHoliday(false);
      fetchHolidays();
    } catch (err: any) {
      toastEvent.trigger('Failed to add holiday: ' + (err?.response?.data?.error || err?.message || 'Unknown error'), 'error');
    } finally {
      setSavingHoliday(false);
    }
  };

  const handleDeleteHoliday = async (id: number, name: string) => {
    setDeletingHolidayId(id);
    try {
      await apiClient.delete(`/settings/holidays/${id}`);
      toastEvent.trigger(`Holiday "${name}" deleted`, 'info');
      setHolidays(prev => prev.filter(h => h.id !== id));
    } catch (err: any) {
      toastEvent.trigger('Failed to delete holiday: ' + (err?.message || 'Unknown error'), 'error');
    } finally {
      setDeletingHolidayId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Save Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border">
        <div>
          <h2 className="text-base font-bold text-text flex items-center gap-2">
            <Clock size={18} className="text-primary" />
            Orders & Fulfilment Timing Engine
          </h2>
          <p className="text-xs text-muted mt-0.5">
            Configure order cutoff times, daily delivery windows, Sunday/holiday scheduling shifts, and return policies.
          </p>
        </div>
        <button
          type="button"
          onClick={() => handleSaveTimingSettings()}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-xs font-bold rounded-xl shadow-sm hover:bg-primary/90 transition-all cursor-pointer disabled:opacity-50"
        >
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
          <span>{saving ? 'Saving...' : 'Save Timing Rules'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card 1: Cutoff & Daily Delivery Window */}
        <div className="bg-bg2 border border-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <Clock size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text">Daily Order Cutoff & Delivery Windows</h3>
              <p className="text-[11px] text-muted">Authoritative server schedule for website, portal & store orders</p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <div>
              <label className="block text-xs font-bold text-text mb-1">
                Order Cutoff Time (24h format)
              </label>
              <input
                type="time"
                value={cutoffTime}
                onChange={(e) => setCutoffTime(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-bg border border-border rounded-xl text-text focus:outline-none focus:border-primary"
              />
              <p className="text-[10px] text-muted mt-1">
                Default 23:00 (11:00 PM). Orders placed after this time automatically shift to the next operating day.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs font-bold text-text mb-1">
                  Delivery Window Start
                </label>
                <input
                  type="time"
                  value={deliveryStart}
                  onChange={(e) => setDeliveryStart(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-bg border border-border rounded-xl text-text focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-text mb-1">
                  Delivery Window End
                </label>
                <input
                  type="time"
                  value={deliveryEnd}
                  onChange={(e) => setDeliveryEnd(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-bg border border-border rounded-xl text-text focus:outline-none focus:border-primary"
                />
              </div>
            </div>
            <p className="text-[10px] text-muted">
              Default 19:00 to 21:00 (7:00 PM – 9:00 PM). Calculated and broadcast on all order confirmations.
            </p>
          </div>
        </div>

        {/* Card 2: Sunday & Weekend Operations */}
        <div className="bg-bg2 border border-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-sky/10 text-sky">
              <Calendar size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text">Sunday Operating Rules</h3>
              <p className="text-[11px] text-muted">Handle Sunday closure or reduced delivery hours</p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <label className="flex items-center gap-2.5 p-2.5 bg-bg border border-border rounded-xl cursor-pointer hover:bg-bg3/50 transition-all">
              <input
                type="checkbox"
                checked={sundayEnabled}
                onChange={(e) => setSundayEnabled(e.target.checked)}
                className="w-4 h-4 rounded text-primary focus:ring-primary"
              />
              <div className="text-xs">
                <span className="font-bold text-text">Open for Delivery on Sundays</span>
                <p className="text-[10px] text-muted">
                  {sundayEnabled
                    ? 'Deliveries are processed on Sundays using the window below.'
                    : 'Pharmacy is closed on Sundays. Sunday orders automatically shift to Monday.'}
                </p>
              </div>
            </label>

            {sundayEnabled && (
              <div className="grid grid-cols-2 gap-3 p-3 bg-bg border border-border rounded-xl">
                <div>
                  <label className="block text-[11px] font-bold text-text mb-1">
                    Sunday Window Start
                  </label>
                  <input
                    type="time"
                    value={sundayStart}
                    onChange={(e) => setSundayStart(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-bg2 border border-border rounded-lg text-text focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-text mb-1">
                    Sunday Window End
                  </label>
                  <input
                    type="time"
                    value={sundayEnd}
                    onChange={(e) => setSundayEnd(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-bg2 border border-border rounded-lg text-text focus:outline-none focus:border-primary"
                  />
                </div>
              </div>
            )}

            <label className="flex items-center gap-2.5 p-2.5 bg-bg border border-border rounded-xl cursor-pointer hover:bg-bg3/50 transition-all">
              <input
                type="checkbox"
                checked={holidayDeliveryEnabled}
                onChange={(e) => setHolidayDeliveryEnabled(e.target.checked)}
                className="w-4 h-4 rounded text-primary focus:ring-primary"
              />
              <div className="text-xs">
                <span className="font-bold text-text">Deliver on Pharmacy Holidays</span>
                <p className="text-[10px] text-muted">
                  {holidayDeliveryEnabled
                    ? 'Holidays allow delivery unless specifically marked closed in the calendar below.'
                    : 'All calendar holidays pause delivery and shift fulfilment to the next operating day.'}
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Card 3: Return Policy & Refill Auto-Pause Recalculation */}
        <div className="bg-bg2 border border-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500">
              <RotateCcw size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text">Return Window & Refill Recalculation</h3>
              <p className="text-[11px] text-muted">Post-delivery policy window and recurring prescription shifts</p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <div>
              <label className="block text-xs font-bold text-text mb-1">
                Return Window Duration (Days)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="90"
                  value={returnWindowDays}
                  onChange={(e) => setReturnWindowDays(e.target.value)}
                  className="w-24 px-3 py-2 text-xs bg-bg border border-border rounded-xl text-text focus:outline-none focus:border-primary font-bold"
                />
                <span className="text-xs text-muted">Days from actual delivery confirmation timestamp</span>
              </div>
              <p className="text-[10px] text-muted mt-1">
                Standard: 15 days. Returns can be initiated up to {returnWindowDays} days after delivery. Staff override allows supervisor exceptions.
              </p>
            </div>

            <label className="flex items-center gap-2.5 p-2.5 bg-bg border border-border rounded-xl cursor-pointer hover:bg-bg3/50 transition-all">
              <input
                type="checkbox"
                checked={refillPauseRecalc}
                onChange={(e) => setRefillPauseRecalc(e.target.checked)}
                className="w-4 h-4 rounded text-primary focus:ring-primary"
              />
              <div className="text-xs">
                <span className="font-bold text-text">Refill Auto-Pause Recalculation</span>
                <p className="text-[10px] text-muted">
                  When a customer or doctor resumes a paused refill, automatically push next refill date by the paused duration, skipping closed Sundays & holidays.
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Card 4: Pharmacy Holiday Calendar Management */}
        <div className="bg-bg2 border border-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-500">
                <Calendar size={16} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-text">Holiday Calendar</h3>
                <p className="text-[11px] text-muted">{holidays.length} scheduled holiday(s)</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowAddHoliday(!showAddHoliday)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary border border-primary/20 text-xs font-bold rounded-lg hover:bg-primary/20 transition-all cursor-pointer"
            >
              <Plus size={14} />
              <span>Add Holiday</span>
            </button>
          </div>

          {/* Add Holiday Inline Form */}
          {showAddHoliday && (
            <form onSubmit={handleAddHoliday} className="p-3 bg-bg border border-border rounded-xl space-y-3">
              <div className="text-xs font-bold text-text flex items-center justify-between">
                <span>Add Scheduled Holiday</span>
                <button
                  type="button"
                  onClick={() => setShowAddHoliday(false)}
                  className="text-muted hover:text-text"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-muted mb-1">Holiday Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Republic Day"
                    value={holidayForm.name}
                    onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })}
                    className="w-full px-2.5 py-1.5 text-xs bg-bg2 border border-border rounded-lg text-text focus:outline-none focus:border-primary"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-muted mb-1">Date</label>
                  <input
                    type="date"
                    value={holidayForm.date}
                    onChange={(e) => setHolidayForm({ ...holidayForm, date: e.target.value })}
                    className="w-full px-2.5 py-1.5 text-xs bg-bg2 border border-border rounded-lg text-text focus:outline-none focus:border-primary"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 text-xs text-text cursor-pointer">
                  <input
                    type="checkbox"
                    checked={holidayForm.isClosed}
                    onChange={(e) => setHolidayForm({ ...holidayForm, isClosed: e.target.checked })}
                    className="w-3.5 h-3.5 rounded text-primary"
                  />
                  <span>Full Day Closed (No deliveries)</span>
                </label>
                <button
                  type="submit"
                  disabled={savingHoliday}
                  className="px-3 py-1.5 bg-primary text-white text-xs font-bold rounded-lg shadow-sm hover:bg-primary/90 disabled:opacity-50"
                >
                  {savingHoliday ? 'Adding...' : 'Save Holiday'}
                </button>
              </div>
            </form>
          )}

          {/* Holiday List */}
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {loadingHolidays ? (
              <div className="flex items-center justify-center py-6 text-xs text-muted">
                <RefreshCw size={14} className="animate-spin mr-1.5" /> Loading holiday schedule...
              </div>
            ) : holidays.length === 0 ? (
              <div className="text-center py-6 text-xs text-muted bg-bg/50 border border-border rounded-xl">
                No holidays added yet. Deliveries will run on regular daily schedule.
              </div>
            ) : (
              holidays.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between p-2.5 bg-bg border border-border rounded-xl text-xs"
                >
                  <div>
                    <div className="font-bold text-text flex items-center gap-1.5">
                      <span>{h.holiday_name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                        h.is_closed ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                      }`}>
                        {h.is_closed ? 'Closed' : 'Custom Hours'}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted mt-0.5">
                      📅 {h.holiday_date}
                      {!h.is_closed && h.custom_window_start && ` (${h.custom_window_start} - ${h.custom_window_end})`}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDeleteHoliday(h.id, h.holiday_name)}
                    disabled={deletingHolidayId === h.id}
                    className="p-1.5 text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all cursor-pointer disabled:opacity-50"
                    title="Delete holiday"
                  >
                    {deletingHolidayId === h.id ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── License Management Card ──────────────────────────────────────────────────
// Allows viewing machine hardware ID, license status, and activating/updating license key online
function LicenseManagementCard() {
  const [status, setStatus] = React.useState<{
    valid: boolean;
    mode: 'testing' | 'licensed' | 'grace' | 'expired';
    pharmacyName: string | null;
    licenseId: string | null;
    daysUntilExpiry: number | null;
    message: string;
  } | null>(null);
  const [machineId, setMachineId] = React.useState<string>('');
  const [copied, setCopied] = React.useState(false);

  // Form state
  const [showForm, setShowForm] = React.useState(false);
  const [inputLicenseId, setInputLicenseId] = React.useState('');
  const [inputLicenseKey, setInputLicenseKey] = React.useState('');
  const [activating, setActivating] = React.useState(false);
  const [activateError, setActivateError] = React.useState<string | null>(null);
  const [activateSuccess, setActivateSuccess] = React.useState<string | null>(null);

  const loadStatus = React.useCallback(async () => {
    try {
      const [statusRes, machineRes] = await Promise.allSettled([
        apiClient.get('/license/status'),
        apiClient.get('/license/machine-id'),
      ]);
      if (statusRes.status === 'fulfilled') setStatus(statusRes.value.data);
      if (machineRes.status === 'fulfilled') setMachineId(machineRes.value.data.machineId || '');
    } catch {
      // offline or unreachable
    }
  }, []);

  React.useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleCopyMachineId = () => {
    if (!machineId) return;
    navigator.clipboard.writeText(machineId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputLicenseId.trim() || !inputLicenseKey.trim()) {
      setActivateError('Please enter both License ID and License Key');
      return;
    }
    setActivating(true);
    setActivateError(null);
    setActivateSuccess(null);
    try {
      const res = await apiClient.post('/license/activate', {
        licenseId: inputLicenseId.trim(),
        licenseKey: inputLicenseKey.trim(),
      });
      if (res.data.success) {
        setActivateSuccess(`License activated successfully for ${res.data.pharmacyName || 'this PC'}!`);
        setInputLicenseId('');
        setInputLicenseKey('');
        setShowForm(false);
        void loadStatus();
      } else {
        setActivateError(res.data.error || 'Activation failed');
      }
    } catch (err: any) {
      setActivateError(err?.response?.data?.error || err?.message || 'Could not connect to license server');
    } finally {
      setActivating(false);
    }
  };

  const getStatusBadge = () => {
    if (!status) return null;
    if (status.mode === 'licensed') {
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-green-500/10 text-green-600 border border-green-500/20">
          <CheckCircle2 size={13} />
          Active License
        </span>
      );
    }
    if (status.mode === 'testing') {
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20">
          <Clock size={13} />
          Testing Mode ({status.daysUntilExpiry}d left)
        </span>
      );
    }
    if (status.mode === 'grace') {
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/15 text-amber-700 border border-amber-500/30">
          <AlertTriangle size={13} />
          Offline Grace ({status.daysUntilExpiry}d left)
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-red-500/10 text-red-500 border border-red-500/20">
        <AlertTriangle size={13} />
        License Unverified / Expired
      </span>
    );
  };

  return (
    <div className="bg-bg2 border border-border rounded-2xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
            <Shield size={16} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-text">App License & Machine Binding</h3>
            <p className="text-[11px] text-muted">
              1 PC = 1 Key · Hardware-locked anti-piracy protection
            </p>
          </div>
        </div>
        {getStatusBadge()}
      </div>

      {/* Details summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-bg border border-border text-xs">
        <div>
          <span className="text-[11px] text-muted block">Licensed To:</span>
          <span className="font-bold text-text">
            {status?.pharmacyName || 'Testing / Unregistered'}
          </span>
        </div>
        <div>
          <span className="text-[11px] text-muted block">License ID:</span>
          <span className="font-mono font-medium text-text">
            {status?.licenseId || 'None (Testing Mode)'}
          </span>
        </div>
        <div className="sm:col-span-2 flex items-center justify-between gap-2 pt-2 border-t border-border">
          <div>
            <span className="text-[11px] text-muted block">This PC Machine ID:</span>
            <span className="font-mono text-[11px] text-text">
              {machineId || 'Detecting...'}
            </span>
          </div>
          {machineId && (
            <button
              type="button"
              onClick={handleCopyMachineId}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-bg2 hover:bg-bg3 border border-border text-[11px] font-medium text-text transition-colors cursor-pointer shrink-0"
              title="Copy Machine ID to send to support"
            >
              <Copy size={12} />
              {copied ? 'Copied!' : 'Copy ID'}
            </button>
          )}
        </div>
      </div>

      {/* Success banner */}
      {activateSuccess && (
        <div className="p-3 rounded-xl border border-green-500/20 bg-green-500/10 text-xs text-green-600 font-medium flex items-center gap-2">
          <CheckCircle2 size={14} className="shrink-0" />
          {activateSuccess}
        </div>
      )}

      {/* Action / Toggle Form */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">
          Need to enter a new key or activate after hardware change?
        </span>
        <button
          type="button"
          onClick={() => {
            setShowForm(v => !v);
            setActivateError(null);
          }}
          className="text-xs font-bold text-primary hover:underline cursor-pointer"
        >
          {showForm ? 'Cancel' : (status?.mode === 'licensed' ? 'Change License Key' : 'Enter License Key')}
        </button>
      </div>

      {/* Activation Form */}
      {showForm && (
        <form onSubmit={handleActivate} className="p-4 rounded-xl bg-bg border border-border space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-muted mb-1 uppercase tracking-wider">
                License ID
              </label>
              <input
                type="text"
                placeholder="e.g. PHARM-A3B2"
                value={inputLicenseId}
                onChange={e => setInputLicenseId(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 rounded-xl bg-bg2 border border-border text-xs text-text font-mono uppercase focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-muted mb-1 uppercase tracking-wider">
                License Key
              </label>
              <input
                type="text"
                placeholder="XXXX-XXXX-XXXX-XXXX"
                value={inputLicenseKey}
                onChange={e => setInputLicenseKey(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 rounded-xl bg-bg2 border border-border text-xs text-text font-mono uppercase focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          {activateError && (
            <div className="p-2.5 rounded-lg border border-red-500/20 bg-red-500/10 text-xs text-red-500 flex items-center gap-2">
              <AlertTriangle size={13} className="shrink-0" />
              {activateError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="submit"
              disabled={activating}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-xs font-bold rounded-xl shadow-sm hover:bg-primary/90 transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={13} className={activating ? 'animate-spin' : ''} />
              {activating ? 'Validating Online...' : 'Activate & Lock to This PC'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── Software Update Card ──────────────────────────────────────────────────────
// Isolated component so its state doesn't re-render the entire Settings page
function SoftwareUpdateCard() {
  const [checking, setChecking] = React.useState(false);
  const [installing, setInstalling] = React.useState(false);
  const [result, setResult] = React.useState<{
    hasUpdate: boolean;
    latestVersion?: string;
    downloadUrl?: string;
    changelog?: string;
    downloading?: boolean;
    readyToInstall?: boolean;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [lastChecked, setLastChecked] = React.useState<string | null>(null);

  const handleCheckNow = async () => {
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiClient.post('/license/check-update');
      setResult(res.data);
      setLastChecked(new Date().toLocaleTimeString());
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Could not reach update server. Check internet connection.');
    } finally {
      setChecking(false);
    }
  };

  // Live-update the card as the background silent download progresses,
  // so it never gets stuck showing a stale "Download" link once the
  // auto-updater has already grabbed the installer for us.
  React.useEffect(() => {
    const handler = (e: Event) => {
      const raw  = (e as CustomEvent).detail;
      const data = raw?.payload || raw;
      if (!data?.latestVersion) return;
      setResult({
        hasUpdate:      true,
        latestVersion:  data.latestVersion,
        downloadUrl:    data.downloadUrl,
        changelog:      data.changelog || '',
        downloading:    !!data.downloading,
        readyToInstall: !!data.readyToInstall,
      });
    };
    window.addEventListener('sse:update_available', handler);
    return () => window.removeEventListener('sse:update_available', handler);
  }, []);

  const handleInstallAndRestart = async () => {
    setInstalling(true);
    try {
      const res  = await fetch('/api/system/apply-update', { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        toastEvent.trigger(data.error || 'Failed to start update installation.', 'error');
        setInstalling(false);
      }
      // On success the backend kills the process — no need to reset state
    } catch (_) {
      // Backend terminates server during install — this catch is expected
    }
  };

  return (
    <div className="bg-bg2 border border-border rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
            <RefreshCw size={16} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-text">Software Update</h3>
            <p className="text-[11px] text-muted">
              AI Pharmacy — auto-checks every 15 days when internet is available
              {lastChecked && <span className="ml-1">· Last checked {lastChecked}</span>}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleCheckNow}
          disabled={checking}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary border border-primary/20 text-xs font-bold rounded-lg hover:bg-primary/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw size={13} className={checking ? 'animate-spin' : ''} />
          {checking ? 'Checking...' : 'Check Now'}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className={`p-3 rounded-xl border text-xs ${
          result.hasUpdate
            ? 'bg-primary/5 border-primary/20 text-text'
            : 'bg-green-500/5 border-green-500/20 text-text'
        }`}>
          {result.hasUpdate ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-primary">
                  🎉 Update available — v{result.latestVersion}
                </span>
                {result.readyToInstall ? (
                  <button
                    type="button"
                    onClick={handleInstallAndRestart}
                    disabled={installing}
                    className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-[11px] font-bold hover:bg-emerald-700 transition-colors disabled:opacity-60"
                  >
                    <RefreshCw size={11} className={installing ? 'animate-spin' : ''} />
                    {installing ? 'Installing & restarting...' : 'Install & Restart'}
                  </button>
                ) : result.downloading ? (
                  <span className="flex items-center gap-1 px-2.5 py-1 bg-primary/10 text-primary rounded-lg text-[11px] font-bold">
                    <ArrowDownToLine size={11} className="animate-pulse" />
                    Downloading in background...
                  </span>
                ) : result.downloadUrl && (
                  <a
                    href={result.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 px-2.5 py-1 bg-primary text-white rounded-lg text-[11px] font-bold hover:bg-primary/90 transition-colors"
                  >
                    <ExternalLink size={11} />
                    Download
                  </a>
                )}
              </div>
              {result.changelog && (
                <p className="text-[11px] text-muted whitespace-pre-line leading-relaxed border-t border-border pt-2">
                  {result.changelog}
                </p>
              )}
            </div>
          ) : (
            <span className="flex items-center gap-1.5 text-green-600 font-medium">
              <CheckCircle2 size={13} />
              You're up to date — v{result.latestVersion}
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="p-3 rounded-xl border border-red-500/20 bg-red-500/5 text-xs text-red-500 flex items-center gap-2">
          <AlertTriangle size={13} className="shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}

// ── Sub-Tab 8: License & Software Updates ─────────────────────────────────────
function LicenseAndUpdatesTab() {
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="bg-bg2 border border-border rounded-2xl p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <ShieldCheck size={22} />
          </div>
          <div>
            <h2 className="text-sm font-bold text-text">License, Machine Binding & Software Updates</h2>
            <p className="text-xs text-muted mt-0.5">
              Manage your hardware-locked anti-piracy activation, review machine fingerprint, and install real-time application updates.
            </p>
          </div>
        </div>
      </div>

      <LicenseManagementCard />
      <SoftwareUpdateCard />
    </div>
  );
}


