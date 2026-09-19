import { useState, useEffect } from 'react';
import { apiClient } from '../services/api';

// ponytail: module-level cache — same TTLs as backend (24h/12h)
type WaRegStatus = 'AVAILABLE' | 'NOT_AVAILABLE' | 'UNABLE_TO_VERIFY';
const cache = new Map<string, { status: WaRegStatus; expiresAt: number }>();

async function fetchWaStatus(digits10: string): Promise<WaRegStatus> {
  const cached = cache.get(digits10);
  if (cached && Date.now() < cached.expiresAt) return cached.status;

  try {
    const res = await apiClient.get('/messaging/check-phone', { params: { phone: digits10 } });
    const status: WaRegStatus = res.data?.status ?? 'UNABLE_TO_VERIFY';
    const ttl = status === 'AVAILABLE' ? 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
    cache.set(digits10, { status, expiresAt: Date.now() + ttl });
    return status;
  } catch {
    return 'UNABLE_TO_VERIFY';
  }
}

export type WaPhoneStatusResult = {
  waStatus: 'idle' | 'checking' | WaRegStatus;
  /** true only when confirmed NOT registered — use this to disable WA buttons */
  isNotOnWa: boolean;
  /** true when WA client offline / timed out — do NOT block buttons */
  isUnknown: boolean;
};

/**
 * Checks if `phone` (any format, extracts last 10 digits) is registered on WhatsApp.
 * Returns immediately from cache if fresh. Debounces network call by 300ms.
 * UNABLE_TO_VERIFY never disables buttons — WA might just be sleeping.
 */
export function useWaPhoneStatus(phone: string): WaPhoneStatusResult {
  const digits10 = (phone || '').replace(/\D/g, '').slice(-10);
  const isComplete = digits10.length === 10;

  const [waStatus, setWaStatus] = useState<'idle' | 'checking' | WaRegStatus>(() => {
    if (!isComplete) return 'idle';
    const hit = cache.get(digits10);
    if (hit && Date.now() < hit.expiresAt) return hit.status;
    return 'idle';
  });

  useEffect(() => {
    if (!isComplete) {
      setWaStatus('idle');
      return;
    }

    // Instant cache hit
    const hit = cache.get(digits10);
    if (hit && Date.now() < hit.expiresAt) {
      setWaStatus(hit.status);
      return;
    }

    setWaStatus('checking');
    const timer = setTimeout(async () => {
      const status = await fetchWaStatus(digits10);
      setWaStatus(status);
    }, 300);

    return () => clearTimeout(timer);
  }, [digits10, isComplete]);

  return {
    waStatus,
    isNotOnWa: waStatus === 'NOT_AVAILABLE',
    isUnknown: waStatus === 'UNABLE_TO_VERIFY',
  };
}
