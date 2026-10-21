// ─── Web / SSR Notifications Shim ─────────────────────────────────────────────
// Push & background notifications are unsupported in web/node environments.
// This clean shim avoids importing expo-notifications on web/SSR, permanently
// eliminating [expo-notifications] web deprecation warnings and side-effects.

export async function scheduleNotificationAsync(_request?: any): Promise<string> {
  return '';
}

export function setNotificationHandler(_handler: any): void {}

export function addNotificationReceivedListener(_listener: (notification: any) => void) {
  return {
    remove: () => {},
  };
}

export async function getPermissionsAsync(): Promise<{ status: 'granted' | 'undetermined' | 'denied' }> {
  return { status: 'denied' };
}

export async function requestPermissionsAsync(): Promise<{ status: 'granted' | 'undetermined' | 'denied' }> {
  return { status: 'denied' };
}

export async function getExpoPushTokenAsync(_options?: any): Promise<{ data: string }> {
  return { data: '' };
}

export const SchedulableTriggerInputTypes = {
  DATE: 'date' as const,
  TIME_INTERVAL: 'timeInterval' as const,
  DAILY: 'daily' as const,
  WEEKLY: 'weekly' as const,
  MONTHLY: 'monthly' as const,
  YEARLY: 'yearly' as const,
  CALENDAR: 'calendar' as const,
};

const NotificationsShim = {
  scheduleNotificationAsync,
  setNotificationHandler,
  addNotificationReceivedListener,
  getPermissionsAsync,
  requestPermissionsAsync,
  getExpoPushTokenAsync,
  SchedulableTriggerInputTypes,
};

export default NotificationsShim;
