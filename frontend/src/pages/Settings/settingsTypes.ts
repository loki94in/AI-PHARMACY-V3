export type LocalApiError = { response?: { data?: { error?: string } }; message?: string };

export interface StorageLocation {
  id: number;
  name: string;
  code: string;
  type: string;
  description: string;
  is_default: number;
  is_active: number;
}

export interface RegisteredDevice {
  token: string;
  device_name: string;
  os: string;
  last_seen: string;
  is_online: number;
}

export interface PharmacyHolidayItem {
  id: number;
  store_id: number;
  holiday_date: string;
  holiday_name: string;
  is_closed: number;
  custom_window_start: string | null;
  custom_window_end: string | null;
  created_at: string;
}
