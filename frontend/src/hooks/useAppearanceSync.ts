import { useEffect } from 'react';
import { useSettingsQuery } from './useSettingsQuery';

export interface AppearancePreferences {
  themeMode: 'light' | 'dark' | 'system';
  fontSize: 'compact' | 'normal' | 'large' | 'huge' | 'touch';
  modalSize: 'compact' | 'normal' | 'wide' | 'spacious';
  tableDensity: 'compact' | 'normal' | 'relaxed';
  borderRadius: 'sharp' | 'standard' | 'curved';
  reducedMotion: boolean;
}

export const FONT_SIZE_MAP: Record<AppearancePreferences['fontSize'], string> = {
  compact: '13px',
  normal: '14px',
  large: '15px',
  huge: '16px',
  touch: '18px',
};

export const MODAL_SIZE_MAP: Record<AppearancePreferences['modalSize'], string> = {
  compact: '520px',
  normal: '640px',
  wide: '800px',
  spacious: '960px',
};

export const TABLE_DENSITY_MAP: Record<AppearancePreferences['tableDensity'], { py: string; px: string }> = {
  compact: { py: '0.25rem', px: '0.5rem' },
  normal: { py: '0.5rem', px: '0.75rem' },
  relaxed: { py: '0.75rem', px: '1rem' },
};

export const BORDER_RADIUS_MAP: Record<AppearancePreferences['borderRadius'], string> = {
  sharp: '0.5rem',
  standard: '1rem',
  curved: '1.25rem',
};

/**
 * Automates real-time application of theme, font scale, modal widths, and table density
 * to document root CSS variables without requiring a reload.
 */
export function useAppearanceSync() {
  const { data: settings } = useSettingsQuery();

  useEffect(() => {
    if (!settings || typeof window === 'undefined') return;

    const themeMode = (settings['app_theme_mode'] || 'light') as AppearancePreferences['themeMode'];
    const fontPreset = (settings['app_font_size'] || 'normal') as AppearancePreferences['fontSize'];
    const modalPreset = (settings['app_modal_size'] || 'normal') as AppearancePreferences['modalSize'];
    const densityPreset = (settings['app_table_density'] || 'normal') as AppearancePreferences['tableDensity'];
    const radiusPreset = (settings['app_border_radius'] || 'standard') as AppearancePreferences['borderRadius'];
    const reducedMotion = settings['app_reduced_motion'] === 'true';

    const root = document.documentElement;

    // 1. Theme application
    let isDark = false;
    if (themeMode === 'dark') {
      isDark = true;
    } else if (themeMode === 'system') {
      isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    if (isDark) {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }

    // 2. Font sizing
    const fontSize = FONT_SIZE_MAP[fontPreset] || FONT_SIZE_MAP.normal;
    root.style.setProperty('--app-font-size-base', fontSize);

    // 3. Modal & popup sizing
    const modalWidth = MODAL_SIZE_MAP[modalPreset] || MODAL_SIZE_MAP.normal;
    root.style.setProperty('--modal-max-width', modalWidth);

    // 4. Table Density
    const density = TABLE_DENSITY_MAP[densityPreset] || TABLE_DENSITY_MAP.normal;
    root.style.setProperty('--table-density-py', density.py);
    root.style.setProperty('--table-density-px', density.px);

    // 5. Border Radius
    const radius = BORDER_RADIUS_MAP[radiusPreset] || BORDER_RADIUS_MAP.standard;
    root.style.setProperty('--app-border-radius', radius);

    // 6. Reduced Motion
    if (reducedMotion) {
      root.classList.add('reduce-motion');
    } else {
      root.classList.remove('reduce-motion');
    }
  }, [settings]);
}
