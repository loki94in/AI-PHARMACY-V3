import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSettingsQuery } from '../../hooks/useSettingsQuery';
import { api } from '../../services/api';
import { updateSettingsCache } from '../../utils/settingsSync';
import { toastEvent } from '../../services/events';
import { PAGE_SHORTCUT_DEFAULTS, getPageBindings, setPageBindings, resetPageBindings, isBindableKey } from '../../services/keyboardShortcuts';
import { TOAST_STYLE_OPTIONS, getToastStyle, setToastStyle, type ToastStyle } from '../../utils/toastStyle';
import {
  Palette,
  Sun,
  Moon,
  Monitor,
  Type,
  Maximize2,
  Rows,
  Sparkles,
  RotateCcw,
  Check,
  Eye,
  Sliders,
  CheckCircle2,
  Layers,
  Zap,
} from 'lucide-react';
import {
  FONT_SIZE_MAP,
  MODAL_SIZE_MAP,
  TABLE_DENSITY_MAP,
  BORDER_RADIUS_MAP,
  type AppearancePreferences,
} from '../../hooks/useAppearanceSync';

export const AppearanceTab: React.FC = () => {
  const queryClient = useQueryClient();
  const { data: rawSettings = {}, isLoading } = useSettingsQuery();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [toastStyle, setToastStyleState] = useState<ToastStyle>(getToastStyle);
  const [bindings, setBindings] = useState(getPageBindings);
  const [capturing, setCapturing] = useState<string | null>(null);

  const saveBinding = (path: string, key: string) => {
    const next = { ...bindings, [path]: key };
    setPageBindings(next);
    setBindings(next);
    setCapturing(null);
  };

  // Current values from settings or defaults
  const currentTheme = (rawSettings['app_theme_mode'] || 'light') as AppearancePreferences['themeMode'];
  const currentFontSize = (rawSettings['app_font_size'] || 'normal') as AppearancePreferences['fontSize'];
  const currentModalSize = (rawSettings['app_modal_size'] || 'normal') as AppearancePreferences['modalSize'];
  const currentTableDensity = (rawSettings['app_table_density'] || 'normal') as AppearancePreferences['tableDensity'];
  const currentBorderRadius = (rawSettings['app_border_radius'] || 'standard') as AppearancePreferences['borderRadius'];
  const currentReducedMotion = rawSettings['app_reduced_motion'] === 'true';
  const currentKeepAliveEssential = (rawSettings['keep_alive_essential_pages'] ?? (typeof window !== 'undefined' ? localStorage.getItem('keep_alive_essential_pages') : 'true')) !== 'false';

  const toggleKeepAliveEssential = () => {
    const nextVal = currentKeepAliveEssential ? 'false' : 'true';
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('keep_alive_essential_pages', nextVal);
      } catch { /* ignore */ }
    }
    handleUpdate('keep_alive_essential_pages', nextVal, 'Keep Sell & Inventory in Memory');
  };

  const handleUpdate = async (key: string, value: string, label: string) => {
    try {
      setSavingKey(key);
      updateSettingsCache(queryClient, { [key]: value });
      await api.saveSingleSetting(key, value);
      toastEvent.trigger(`${label} updated`, 'success');
    } catch (err) {
      console.error('Failed to update appearance setting:', err);
      toastEvent.trigger(`Failed to save ${label}`, 'error');
    } finally {
      setSavingKey(null);
    }
  };

  const handleResetDefaults = async () => {
    try {
      setSavingKey('reset');
      const defaults = {
        app_theme_mode: 'light',
        app_font_size: 'normal',
        app_modal_size: 'normal',
        app_table_density: 'normal',
        app_border_radius: 'standard',
        app_reduced_motion: 'false',
        keep_alive_essential_pages: 'true',
      };
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('keep_alive_essential_pages', 'true'); } catch { /* ignore */ }
      }
      updateSettingsCache(queryClient, defaults);
      await api.saveSettings(defaults);
      toastEvent.trigger('Display preferences reset to factory defaults', 'success');
    } catch (err) {
      console.error('Failed to reset display settings:', err);
      toastEvent.trigger('Failed to reset display preferences', 'error');
    } finally {
      setSavingKey(null);
    }
  };

  const fontOptions: { id: AppearancePreferences['fontSize']; label: string; px: string; desc: string }[] = [
    { id: 'compact', label: 'Compact', px: FONT_SIZE_MAP.compact, desc: 'Maximum screen density for high-throughput counters' },
    { id: 'normal', label: 'Standard', px: FONT_SIZE_MAP.normal, desc: 'Balanced default pharmacy scale' },
    { id: 'large', label: 'Comfortable', px: FONT_SIZE_MAP.large, desc: 'Enhanced legibility for medium monitors' },
    { id: 'huge', label: 'High Contrast', px: FONT_SIZE_MAP.huge, desc: 'Enlarged text for large POS displays' },
    { id: 'touch', label: 'Touch POS', px: FONT_SIZE_MAP.touch, desc: 'Maximum touch-friendly scale for tablets & low vision' },
  ];

  const modalOptions: { id: AppearancePreferences['modalSize']; label: string; width: string; desc: string }[] = [
    { id: 'compact', label: 'Compact (520px)', width: MODAL_SIZE_MAP.compact, desc: 'Focused popups for quick batch & discount prompts' },
    { id: 'normal', label: 'Standard (640px)', width: MODAL_SIZE_MAP.normal, desc: 'Default dialog width with optimal padding' },
    { id: 'wide', label: 'Wide (800px)', width: MODAL_SIZE_MAP.wide, desc: 'Extended width for multi-column batch tables' },
    { id: 'spacious', label: 'Spacious (960px)', width: MODAL_SIZE_MAP.spacious, desc: 'Full-viewport view for customer history & audits' },
  ];

  const densityOptions: { id: AppearancePreferences['tableDensity']; label: string; desc: string }[] = [
    { id: 'compact', label: 'Compact Rows', desc: 'Tight vertical padding — shows maximum bill & inventory rows' },
    { id: 'normal', label: 'Standard Rows', desc: 'Standard readable row height for everyday billing' },
    { id: 'relaxed', label: 'Comfortable Rows', desc: 'Touch-friendly taller rows with generous spacing' },
  ];

  const radiusOptions: { id: AppearancePreferences['borderRadius']; label: string; desc: string }[] = [
    { id: 'sharp', label: 'Sharp Corners (4px)', desc: 'Clean square edges with minimal rounding' },
    { id: 'standard', label: 'Modern Rounded (12px)', desc: 'Balanced standard rounded cards & inputs' },
    { id: 'curved', label: 'Curved Soft (20px)', desc: 'Smooth pill-shaped buttons & curved panels' },
  ];

  return (
    <div className="space-y-6">
      {/* Header card with Reset action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-bg border border-border shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <Palette size={24} />
          </div>
          <div>
            <h2 className="text-base font-bold text-text">Appearance & Display Preferences</h2>
            <p className="text-xs text-muted mt-0.5">
              Customize themes, UI font size scaling, popup dialog widths, and data-table density across all pages.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleResetDefaults}
          disabled={savingKey !== null || isLoading}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl border border-border bg-bg2 text-muted hover:text-text hover:border-primary/40 transition-colors shadow-sm self-start sm:self-auto disabled:opacity-50"
        >
          <RotateCcw size={14} className={savingKey === 'reset' ? 'animate-spin' : ''} />
          Reset to Defaults
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Columns: Settings Controls */}
        <div className="lg:col-span-2 space-y-6">
          {/* 1. Theme Mode Card */}
          <div className="p-5 rounded-2xl bg-bg border border-border shadow-sm space-y-4">
            <div className="flex items-center gap-2.5">
              <Sun size={18} className="text-primary" />
              <h3 className="text-sm font-bold text-text">Interface Color Mode</h3>
            </div>
            <p className="text-xs text-muted">
              Choose your visual theme. Changes apply instantly across the entire application and persist in database storage.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { id: 'light', label: 'Day / Light Mode', icon: Sun, desc: 'Pristine pure-white layout with high contrast' },
                { id: 'dark', label: 'Night / Dark Mode', icon: Moon, desc: 'Obsidian dark palette for low-light environments' },
                { id: 'system', label: 'System Adaptive', icon: Monitor, desc: 'Automatically matches your operating system' },
              ].map((t) => {
                const Icon = t.icon;
                const isSelected = currentTheme === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleUpdate('app_theme_mode', t.id, 'Color Theme')}
                    className={`flex flex-col text-left p-3.5 rounded-xl border transition-all ${
                      isSelected
                        ? 'border-primary bg-primary/10 ring-1 ring-primary/30 shadow-sm'
                        : 'border-border bg-bg2 hover:border-primary/40 hover:bg-bg3'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-2">
                      <div className={`p-2 rounded-lg ${isSelected ? 'bg-primary text-white' : 'bg-bg text-muted border border-border'}`}>
                        <Icon size={16} />
                      </div>
                      {isSelected && <CheckCircle2 size={16} className="text-primary" />}
                    </div>
                    <span className="text-xs font-bold text-text">{t.label}</span>
                    <span className="text-[11px] text-muted mt-1 leading-snug">{t.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Global Font Size Scaling */}
          <div className="p-5 rounded-2xl bg-bg border border-border shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Type size={18} className="text-primary" />
                <h3 className="text-sm font-bold text-text">Global UI Font Size</h3>
              </div>
              <span className="text-xs font-mono font-bold text-primary bg-primary/10 px-2.5 py-0.5 rounded-full border border-primary/20">
                {FONT_SIZE_MAP[currentFontSize] || '14px'}
              </span>
            </div>
            <p className="text-xs text-muted">
              Dynamically scales the base typography of all headings, buttons, dropdowns, inputs, and tables app-wide.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5">
              {fontOptions.map((f) => {
                const isSelected = currentFontSize === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => handleUpdate('app_font_size', f.id, 'UI Font Size')}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all ${
                      isSelected
                        ? 'border-primary bg-primary/10 ring-1 ring-primary/30 shadow-sm'
                        : 'border-border bg-bg2 hover:border-primary/40 hover:bg-bg3'
                    }`}
                  >
                    <span className="font-extrabold text-text mb-1" style={{ fontSize: f.px }}>
                      Aa
                    </span>
                    <span className="text-xs font-bold text-text">{f.label}</span>
                    <span className="text-[10px] text-muted font-mono mt-0.5">{f.px}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Page shortcut keys — per device */}
          <div className="p-5 rounded-2xl bg-bg border border-border shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-2.5">
              <div className="flex items-center gap-2.5">
                <Zap size={18} className="text-primary" />
                <h3 className="text-sm font-bold text-text">Page Shortcut Keys</h3>
              </div>
              <button
                type="button"
                onClick={() => { resetPageBindings(); setBindings(getPageBindings()); setCapturing(null); }}
                className="px-3 py-1.5 rounded-lg border border-border bg-bg2 text-xs font-bold text-text hover:border-primary/40 cursor-pointer"
              >
                Reset keys
              </button>
            </div>
            <p className="text-xs text-muted">
              Press a key to jump to a page from anywhere. Click a key, then press the new one (F1–F12 except F11). Backspace clears it. Saved on this device.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {PAGE_SHORTCUT_DEFAULTS.map((d) => {
                const isCapturing = capturing === d.path;
                return (
                  <div key={d.path} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border bg-bg2">
                    <span className="text-xs font-bold text-text">{d.label}</span>
                    <button
                      type="button"
                      onClick={() => setCapturing(isCapturing ? null : d.path)}
                      onKeyDown={(e) => {
                        if (!isCapturing) return;
                        e.preventDefault();
                        e.stopPropagation();
                        if (e.key === 'Escape') { setCapturing(null); return; }
                        if (e.key === 'Backspace' || e.key === 'Delete') { saveBinding(d.path, ''); return; }
                        if (!isBindableKey(e.key)) { toastEvent.trigger('Use F1–F12 (F11 is full-screen)', 'error'); return; }
                        const owner = PAGE_SHORTCUT_DEFAULTS.find(o => o.path !== d.path && bindings[o.path] === e.key);
                        if (owner) { toastEvent.trigger(`${e.key} is already used by ${owner.label}`, 'error'); return; }
                        saveBinding(d.path, e.key);
                      }}
                      onBlur={() => { if (isCapturing) setCapturing(null); }}
                      data-shortcut-capture={isCapturing ? 'true' : undefined}
                      className={`min-w-[88px] px-3 py-1.5 rounded-lg border text-xs font-mono font-bold cursor-pointer ${
                        isCapturing ? 'border-primary bg-primary/10 text-text' : 'border-border bg-bg text-text hover:border-primary/40'
                      }`}
                    >
                      {isCapturing ? 'Press a key…' : bindings[d.path] || 'None'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Notification (toast) look — per device, preview shows a sample at the top of the screen */}
          <div className="p-5 rounded-2xl bg-bg border border-border shadow-sm space-y-4">
            <div className="flex items-center gap-2.5">
              <Sparkles size={18} className="text-primary" />
              <h3 className="text-sm font-bold text-text">Notification Style</h3>
            </div>
            <p className="text-xs text-muted">
              Pick how pop-up messages look. They fade out by themselves after about 4 seconds. Click a style to choose it and see a sample.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {TOAST_STYLE_OPTIONS.map((o) => {
                const isSelected = toastStyle === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      setToastStyle(o.id);
                      setToastStyleState(o.id);
                      window.dispatchEvent(new CustomEvent('toast-preview', { detail: { message: 'Refill saved. Medicine linked to distributor.', type: 'success' } }));
                    }}
                    className={`flex items-start justify-between gap-3 p-3.5 rounded-xl border text-left transition-all ${
                      isSelected ? 'border-primary bg-primary/10 ring-1 ring-primary/30' : 'border-border bg-bg2 hover:border-primary/40 hover:bg-bg3'
                    }`}
                  >
                    <div>
                      <span className="text-xs font-bold text-text">{o.id}. {o.label}</span>
                      <p className="text-[11px] text-muted mt-1">{o.desc}</p>
                    </div>
                    {isSelected && <Check size={14} className="text-primary shrink-0" />}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              {(['success', 'error', 'info'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent('toast-preview', { detail: { message: t === 'error' ? 'Refill saved but no distributor is linked.' : 'Sample notification message.', type: t } }))}
                  className="px-3 py-1.5 rounded-lg border border-border bg-bg2 text-xs font-bold text-text hover:border-primary/40 cursor-pointer"
                >
                  Preview {t}
                </button>
              ))}
            </div>
          </div>

          {/* 3. Modal & Popup Sizing */}
          <div className="p-5 rounded-2xl bg-bg border border-border shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Maximize2 size={18} className="text-primary" />
                <h3 className="text-sm font-bold text-text">Modal & Dialog Max Width</h3>
              </div>
              <span className="text-xs font-mono font-bold text-primary bg-primary/10 px-2.5 py-0.5 rounded-full border border-primary/20">
                {MODAL_SIZE_MAP[currentModalSize] || '640px'}
              </span>
            </div>
            <p className="text-xs text-muted">
              Configures the default viewport width for batch selection popups, payment windows, and patient management dialogs.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {modalOptions.map((m) => {
                const isSelected = currentModalSize === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleUpdate('app_modal_size', m.id, 'Modal Size')}
                    className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'border-primary bg-primary/10 ring-1 ring-primary/30 shadow-sm'
                        : 'border-border bg-bg2 hover:border-primary/40 hover:bg-bg3'
                    }`}
                  >
                    <div className={`p-2 rounded-lg mt-0.5 ${isSelected ? 'bg-primary text-white' : 'bg-bg text-muted border border-border'}`}>
                      <Layers size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-text">{m.label}</span>
                        {isSelected && <Check size={14} className="text-primary" />}
                      </div>
                      <p className="text-[11px] text-muted mt-1 leading-snug">{m.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Table Density & Row Height */}
          <div className="p-5 rounded-2xl bg-bg border border-border shadow-sm space-y-4">
            <div className="flex items-center gap-2.5">
              <Rows size={18} className="text-primary" />
              <h3 className="text-sm font-bold text-text">Data Table Row Density</h3>
            </div>
            <p className="text-xs text-muted">
              Controls vertical row spacing in the POS Cart, Inventory Catalog, Sells List, and Purchase History tables.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {densityOptions.map((d) => {
                const isSelected = currentTableDensity === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => handleUpdate('app_table_density', d.id, 'Table Density')}
                    className={`flex flex-col text-left p-3.5 rounded-xl border transition-all ${
                      isSelected
                        ? 'border-primary bg-primary/10 ring-1 ring-primary/30 shadow-sm'
                        : 'border-border bg-bg2 hover:border-primary/40 hover:bg-bg3'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1.5">
                      <span className="text-xs font-bold text-text">{d.label}</span>
                      {isSelected && <Check size={14} className="text-primary" />}
                    </div>
                    <span className="text-[11px] text-muted leading-snug">{d.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 5. Border Radius & Animation Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Border Radius */}
            <div className="p-5 rounded-2xl bg-bg border border-border shadow-sm space-y-3">
              <div className="flex items-center gap-2">
                <Sliders size={16} className="text-primary" />
                <h4 className="text-xs font-bold text-text">Corner Rounding</h4>
              </div>
              <div className="space-y-2">
                {radiusOptions.map((r) => {
                  const isSelected = currentBorderRadius === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => handleUpdate('app_border_radius', r.id, 'Corner Rounding')}
                      className={`w-full flex items-center justify-between p-2.5 text-xs rounded-xl border transition-all ${
                        isSelected
                          ? 'border-primary bg-primary/10 text-primary font-bold'
                          : 'border-border bg-bg2 text-muted hover:text-text'
                      }`}
                    >
                      <span>{r.label}</span>
                      {isSelected && <Check size={12} />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Animations Toggle */}
            <div className="p-5 rounded-2xl bg-bg border border-border shadow-sm space-y-3 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-primary" />
                  <h4 className="text-xs font-bold text-text">Animations & Motion</h4>
                </div>
                <p className="text-[11px] text-muted leading-relaxed">
                  Reduce animations to eliminate background CPU cycles on older PCs or integrated graphics.
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() =>
                    handleUpdate(
                      'app_reduced_motion',
                      currentReducedMotion ? 'false' : 'true',
                      'Animation Mode'
                    )
                  }
                  className={`w-full flex items-center justify-between p-3 rounded-xl border text-xs font-semibold transition-all ${
                    currentReducedMotion
                      ? 'border-amber-500/40 bg-amber-500/10 text-text'
                      : 'border-border bg-bg2 text-muted hover:text-text'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Zap size={14} className={currentReducedMotion ? 'text-amber-500' : 'text-muted'} />
                    {currentReducedMotion ? 'Reduced Motion (Active)' : 'Standard Fluid Animations'}
                  </span>
                  <div
                    className={`w-9 h-5 rounded-full p-0.5 transition-colors ${
                      currentReducedMotion ? 'bg-primary' : 'bg-bg3 border border-border'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-bg shadow-sm transform transition-transform ${
                        currentReducedMotion ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* 6. Page Keep-Alive & Performance */}
          <div className="p-5 rounded-2xl bg-bg border border-border shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap size={16} className="text-primary" />
                <h4 className="text-xs font-bold text-text">Instant Page Keep-Alive (Zero-Lag Switching)</h4>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${
                currentKeepAliveEssential
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                  : 'border-border bg-bg2 text-muted'
              }`}>
                {currentKeepAliveEssential ? 'Active (0ms switch)' : 'Lazy Mount'}
              </span>
            </div>
            <p className="text-[11px] text-muted leading-relaxed">
              Pre-loads Sell (<code className="font-mono text-text">/sells</code>) and Inventory (<code className="font-mono text-text">/inventory</code>) tabs in hidden background mode at boot. Uses only ~10–15 MB of PC RAM and 0 KB internet data, ensuring page transitions happen with 0 milliseconds delay.
            </p>

            <button
              type="button"
              onClick={toggleKeepAliveEssential}
              className={`w-full flex items-center justify-between p-3.5 rounded-xl border text-xs font-semibold transition-all ${
                currentKeepAliveEssential
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-text'
                  : 'border-border bg-bg2 text-muted hover:text-text'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <CheckCircle2 size={16} className={currentKeepAliveEssential ? 'text-emerald-500' : 'text-muted'} />
                <div className="text-left">
                  <div className="font-bold text-text">
                    {currentKeepAliveEssential ? 'Keep Sell & Inventory in Memory (Enabled)' : 'Mount on Click Only (Disabled)'}
                  </div>
                  <div className="text-[10px] text-muted mt-0.5">
                    {currentKeepAliveEssential ? 'Permanent 0ms instant display, no blank screen flashes' : 'Loads only when clicked; frees ~15 MB RAM'}
                  </div>
                </div>
              </div>
              <div
                className={`w-9 h-5 rounded-full p-0.5 transition-colors shrink-0 ${
                  currentKeepAliveEssential ? 'bg-primary' : 'bg-bg3 border border-border'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-bg shadow-sm transform transition-transform ${
                    currentKeepAliveEssential ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </div>
            </button>
          </div>
        </div>

        {/* Right 1 Column: Real-Time Live Preview Canvas */}
        <div className="space-y-4">
          <div className="sticky top-4 space-y-4">
            <div className="p-5 rounded-2xl bg-bg border border-border shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Eye size={16} className="text-primary" />
                  <h3 className="text-sm font-bold text-text">Live Preview Canvas</h3>
                </div>
                <span className="text-[10px] font-semibold text-muted bg-bg2 px-2 py-0.5 rounded-md border border-border">
                  Instant Preview
                </span>
              </div>
              <p className="text-xs text-muted">
                Here is how active UI components render with your currently selected display settings:
              </p>

              {/* Sample POS Item Card */}
              <div className="p-3.5 rounded-xl border border-border bg-bg2 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-text">Paracetamol 500mg</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-primary text-white">
                    ₹ 18.50
                  </span>
                </div>
                <div className="text-[11px] text-muted flex items-center justify-between">
                  <span>Batch: BATCH-2026A</span>
                  <span>Expiry: 12/28</span>
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    className="flex-1 py-1.5 px-3 rounded-lg bg-primary text-white font-bold text-xs shadow-sm hover:opacity-95"
                  >
                    Add to Cart
                  </button>
                  <button
                    type="button"
                    className="py-1.5 px-3 rounded-lg bg-bg border border-border text-text font-semibold text-xs hover:bg-bg3"
                  >
                    Details
                  </button>
                </div>
              </div>

              {/* Sample Scalable Table Preview */}
              <div className="rounded-xl border border-border overflow-hidden bg-bg">
                <table className="w-full text-left border-collapse app-scalable-table">
                  <thead>
                    <tr className="border-b border-border bg-bg2 text-[11px] font-bold text-muted">
                      <th className="px-2.5 py-1.5">Item</th>
                      <th className="px-2.5 py-1.5 text-center">Qty</th>
                      <th className="px-2.5 py-1.5 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs text-text divide-y divide-border/60">
                    <tr>
                      <td className="px-2.5 py-1.5">Amoxicillin 250</td>
                      <td className="px-2.5 py-1.5 text-center">2</td>
                      <td className="px-2.5 py-1.5 text-right font-mono">₹45.00</td>
                    </tr>
                    <tr>
                      <td className="px-2.5 py-1.5">Cetirizine 10mg</td>
                      <td className="px-2.5 py-1.5 text-center">1</td>
                      <td className="px-2.5 py-1.5 text-right font-mono">₹12.00</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Sample Dialog Preview Mini-Box */}
              <div className="p-3 rounded-xl border border-dashed border-border bg-bg2/50 space-y-2 text-center">
                <span className="text-[10px] font-bold text-muted uppercase tracking-wider">
                  Dialog Max Width: {MODAL_SIZE_MAP[currentModalSize]}
                </span>
                <div className="w-full bg-bg border border-border rounded-lg p-2 text-xs text-text shadow-sm">
                  <span className="font-semibold">Batch Selection Dialog Sample</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
