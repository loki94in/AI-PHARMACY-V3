import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { AppleSegmented } from '../../components/common/AppleSegmented';
import {} from '../../utils/phone';
import { PhoneInputWithBadge } from '../../components/PhoneInputWithBadge';
import { apiClient, api } from '../../services/api';
import { useSettingsQuery } from '../../hooks/useSettingsQuery';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';
import { usePageActive } from '../../lib/keepAlive/PageActiveContext';
import { broadcastContactDataChanged, updateSettingsCache } from '../../utils/settingsSync';
import { invalidateAfterStockWrite } from '../../utils/cacheInvalidation';
import { useModalEscape, shortcutEvent } from '../../services/keyboardShortcuts';
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
import { AppearanceTab } from './AppearanceTab';
import { StoreProfileTab } from './StoreProfileTab';
import { OrderTimingTab } from './OrderTimingTab';
import { MultiStoreTab } from './MultiStoreTab';
import { StaffSecurityTab } from './StaffSecurityTab';
import { IntegrationsCredentialsTab } from './IntegrationsCredentialsTab';
import { TriggerSchedulesTab } from './TriggerSchedulesTab';
import { DataBackupsTab } from './DataBackupsTab';
import { LicenseAndUpdatesTab } from './LicenseAndUpdatesTab';

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
  if (lower === 'appearance' || lower === 'ui' || lower === 'theme' || lower === 'display') return 'appearance';
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
    { id: 'appearance', label: 'Appearance & Display', icon: Palette, desc: 'Themes, UI font scaling, popup & modal sizing, table density' },
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
      <div className="flex flex-col gap-3 bg-bg border border-border rounded-2xl p-3 px-4 shadow-sm">
        {/* Title */}
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <SettingsIcon size={22} />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-text tracking-tight leading-none">Settings & Configuration</h1>
            <p className="text-xs text-muted mt-0.5">Control center for store rules, security & integrations</p>
          </div>
        </div>

        {/* Tab Switcher Pills */}
        <AppleSegmented
          options={tabs.map((t) => ({ key: t.id, label: t.label, icon: <t.icon size={16} /> }))}
          value={activeTab}
          onChange={handleTabChange}
        />
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
            {activeTab === 'appearance' && <AppearanceTab />}
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
