import { useSyncExternalStore } from 'react';
import { apiClient } from './api';

export type UpdateState = 'idle' | 'downloading' | 'ready' | 'error';

export interface UpdateStatus {
  version: string | null;
  currentVersion: string;
  state: UpdateState;
  percent: number;
  downloadedMB: number;
  totalMB: number;
  changelog: string;
  downloadUrl?: string;
  updatePackageUrl?: string;
  lastCheckedAt?: string;
  lastError?: string;
  hasUpdate: boolean;
}

export interface RawUpdateFrame {
  latestVersion?: string | null;
  currentVersion?: string | null;
  hasUpdate?: boolean;
  readyToInstall?: boolean;
  downloading?: boolean;
  downloadProgress?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  downloadUrl?: string;
  updatePackageUrl?: string;
  changelog?: string;
  lastCheckedAt?: string;
  lastError?: string;
  error?: string;
  reason?: string;
}

const INITIAL_STATUS: UpdateStatus = {
  version: null,
  currentVersion: '1.0.0',
  state: 'idle',
  percent: 0,
  downloadedMB: 0,
  totalMB: 0,
  changelog: '',
  hasUpdate: false,
};

let store: UpdateStatus = INITIAL_STATUS;
const listeners = new Set<() => void>();
let isInitialized = false;
let isFetchingInitial = false;

function publish(next: UpdateStatus): void {
  store = next;
  listeners.forEach(l => l());
}

/** Compare two semver strings (e.g. "0.1.154" vs "0.1.132"). Returns > 0 if a > b, < 0 if a < b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/**
 * Normalizes backend update payload / SSE frames into unified UpdateStatus.
 * Handles field name mappings:
 *   latestVersion -> version
 *   downloadProgress -> percent
 *   downloadedBytes -> downloadedMB
 *   totalBytes -> totalMB
 */
export function normalizeUpdateFrame(frame: RawUpdateFrame, current: UpdateStatus): UpdateStatus {
  const rawVersion = frame.latestVersion !== undefined ? frame.latestVersion : current.version;
  const currentVersion = frame.currentVersion || current.currentVersion;

  // Semver verification: is rawVersion strictly newer than current running binary?
  const isTargetNewer = Boolean(rawVersion && currentVersion && compareVersions(rawVersion, currentVersion) > 0);

  // Never report a target version older than or equal to current running binary
  const version = (rawVersion && !isTargetNewer) ? currentVersion : rawVersion;
  const changelog = frame.changelog !== undefined ? (frame.changelog || '') : current.changelog;
  const downloadUrl = frame.downloadUrl !== undefined ? frame.downloadUrl : current.downloadUrl;
  const updatePackageUrl = frame.updatePackageUrl !== undefined ? frame.updatePackageUrl : current.updatePackageUrl;
  const lastCheckedAt = frame.lastCheckedAt !== undefined ? frame.lastCheckedAt : current.lastCheckedAt;

  const rawError = frame.lastError || frame.error;
  let lastError = current.lastError;
  if (rawError) {
    lastError = rawError;
  } else if (frame.readyToInstall || (frame.hasUpdate !== undefined && !rawError)) {
    lastError = undefined;
  }

  let percent = current.percent;
  if (typeof frame.downloadProgress === 'number') {
    percent = Math.max(0, Math.min(100, Math.round(frame.downloadProgress)));
  }

  let downloadedMB = current.downloadedMB;
  if (typeof frame.downloadedBytes === 'number') {
    downloadedMB = Math.round((frame.downloadedBytes / 1048576) * 10) / 10;
  }

  let totalMB = current.totalMB;
  if (typeof frame.totalBytes === 'number') {
    totalMB = Math.round((frame.totalBytes / 1048576) * 10) / 10;
  }

  // An update strictly requires a newer semver target and non-false hasUpdate flag
  const hasUpdate = Boolean(isTargetNewer && (frame.hasUpdate !== false));

  let state: UpdateState = current.state;

  if (rawError) {
    state = 'error';
  } else if (frame.readyToInstall && isTargetNewer) {
    state = 'ready';
    percent = 100;
  } else if (frame.downloading && hasUpdate) {
    state = 'downloading';
  } else if (hasUpdate && typeof frame.downloadProgress === 'number' && (current.state === 'downloading' || frame.downloadProgress > 0)) {
    state = 'downloading';
  } else if (!hasUpdate || frame.downloading === false || frame.readyToInstall === false) {
    if (current.state !== 'ready' || !isTargetNewer) {
      state = 'idle';
      percent = 0;
      downloadedMB = 0;
    }
  } else {
    state = 'idle';
    percent = 0;
    downloadedMB = 0;
  }

  return {
    version,
    currentVersion,
    state,
    percent,
    downloadedMB,
    totalMB,
    changelog,
    downloadUrl,
    updatePackageUrl,
    lastCheckedAt,
    lastError,
    hasUpdate,
  };
}

export function setUpdateStatus(frame: RawUpdateFrame): void {
  publish(normalizeUpdateFrame(frame, store));
}

export async function fetchUpdateStatus(): Promise<UpdateStatus> {
  if (isFetchingInitial) return store;
  isFetchingInitial = true;
  try {
    const res = await apiClient.get<RawUpdateFrame>('/license/update-status');
    if (res.data) {
      publish(normalizeUpdateFrame(res.data, store));
    }
  } catch {
    // Offline or network error - preserve existing store
  } finally {
    isFetchingInitial = false;
  }
  return store;
}

function ensureInitialized(): void {
  if (isInitialized) return;
  isInitialized = true;

  if (typeof window !== 'undefined') {
    const handleUpdateAvailable = (event: Event) => {
      const customEvent = event as CustomEvent<{ payload?: RawUpdateFrame } & RawUpdateFrame>;
      const payload = customEvent.detail?.payload ?? customEvent.detail ?? {};
      publish(normalizeUpdateFrame(payload, store));
    };

    const handleUpdateProgress = (event: Event) => {
      const customEvent = event as CustomEvent<{ payload?: RawUpdateFrame } & RawUpdateFrame>;
      const payload = customEvent.detail?.payload ?? customEvent.detail ?? {};
      publish(normalizeUpdateFrame(payload, store));
    };

    const handleUpdateCheckComplete = (event: Event) => {
      const customEvent = event as CustomEvent<{ payload?: RawUpdateFrame } & RawUpdateFrame>;
      const payload = customEvent.detail?.payload ?? customEvent.detail ?? {};
      publish(normalizeUpdateFrame(payload, store));
    };

    const handleSseConnected = () => {
      void fetchUpdateStatus();
    };

    window.addEventListener('sse-update-available', handleUpdateAvailable);
    window.addEventListener('sse-update-progress', handleUpdateProgress);
    window.addEventListener('sse-update-check-complete', handleUpdateCheckComplete);
    window.addEventListener('sse-connected', handleSseConnected);
  }

  void fetchUpdateStatus();
}

export function getUpdateStatus(): UpdateStatus {
  return store;
}

export function subscribeUpdateStatus(listener: () => void): () => void {
  listeners.add(listener);
  ensureInitialized();
  return () => {
    listeners.delete(listener);
  };
}

export function useUpdateStatus(): UpdateStatus {
  return useSyncExternalStore(subscribeUpdateStatus, getUpdateStatus, getUpdateStatus);
}
