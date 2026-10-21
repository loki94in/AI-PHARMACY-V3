import AsyncStorage from '@react-native-async-storage/async-storage';
import { request, getDeviceIdentity } from './client';
import { getOfflineSalesQueue, clearOfflineSalesQueue } from './sales';
import { getOfflinePurchasesQueue, clearOfflinePurchasesQueue } from './purchases';
import { getOfflineStockQueue, clearOfflineStockQueue, isAdminMode } from './admin';
import { getOfflineSpecialOrdersQueue, clearOfflineSpecialOrdersQueue, createSpecialOrder, getOfflineOrderStatusQueue } from './orders';
import { getOfflineRefillsQueue, clearOfflineRefillsQueue, createRefill } from './refills';
import { getOfflineCreditPaymentsQueue, clearOfflineCreditPaymentsQueue, payCreditBalance } from './credit';
import { replayPendingBillPhotos } from './scanBill';
import { getInventory } from './inventory';
import { syncGoogleAuthFromPc } from './gmail';

const ORDER_STATUS_QUEUE_KEY = 'offline_order_status_queue';

// ─── Offline Sync Engine ────────────────────────────────────────────────────
// Replays every offline queue to the PC and refreshes local caches.
// Triggered by NetInfo reconnect (instant) + the root layout safety-net poll.

export async function syncOfflineSalesAndRefresh(): Promise<{ syncedCount: number; warnings: string[] }> {
  const salesQueue = await getOfflineSalesQueue();
  const purchasesQueue = await getOfflinePurchasesQueue();
  const stockQueue = await getOfflineStockQueue();
  const warnings: string[] = [];
  let syncedCount = 0;

  const adminActive = await isAdminMode();

  // 1. Sync Sales
  if (salesQueue.length > 0) {
    try {
      // Batch-level device attribution (per-bill stamps inside payloads win)
      const identity = await getDeviceIdentity();
      const result = await request<{ success: boolean; count: number; warnings?: string[] }>('/sales/sync', {
        method: 'POST',
        body: JSON.stringify({
          sales: salesQueue,
          adminMode: adminActive,
          deviceName: identity.name,
          device_uuid: identity.uuid,
        }),
      });
      if (result.success) {
        await clearOfflineSalesQueue();
        syncedCount += result.count;
        if (result.warnings) warnings.push(...result.warnings);
      }
    } catch (e: any) {
      console.error('Failed to sync offline sales:', e);
      warnings.push(`Sales Sync failed: ${e.message}`);
    }
  }

  // 2. Sync Purchases
  if (purchasesQueue.length > 0) {
    try {
      const result = await request<{ success: boolean; count: number; warnings?: string[] }>('/purchases/sync', {
        method: 'POST',
        body: JSON.stringify({ purchases: purchasesQueue }),
      });
      if (result.success) {
        await clearOfflinePurchasesQueue();
        syncedCount += result.count;
        if (result.warnings) warnings.push(...result.warnings);
      }
    } catch (e: any) {
      console.error('Failed to sync offline purchases:', e);
      warnings.push(`Purchases Sync failed: ${e.message}`);
    }
  }

  // 3. Sync Stock Updates
  if (stockQueue.length > 0) {
    try {
      const result = await request<{ success: boolean; count: number }>('/inventory/sync', {
        method: 'POST',
        body: JSON.stringify({ updates: stockQueue }),
      });
      if (result.success) {
        await clearOfflineStockQueue();
        syncedCount += result.count;
      }
    } catch (e: any) {
      console.error('Failed to sync stock overrides:', e);
      warnings.push(`Stock Sync failed: ${e.message}`);
    }
  }

  // 4. Sync Special Orders
  const specialOrdersQueue = await getOfflineSpecialOrdersQueue();
  if (specialOrdersQueue.length > 0) {
    try {
      let syncedOrders = 0;
      for (const order of specialOrdersQueue) {
        await createSpecialOrder(order);
        syncedOrders++;
      }
      await clearOfflineSpecialOrdersQueue();
      syncedCount += syncedOrders;
    } catch (e: any) {
      console.error('Failed to sync offline special orders:', e);
      warnings.push(`Special Orders Sync failed: ${e.message}`);
    }
  }

  // 4b. Replay queued order status changes (e.g. offline Mark Ready → PC queues arrival WhatsApp)
  const statusQueue = await getOfflineOrderStatusQueue();
  for (const item of statusQueue) {
    try {
      await request(`/orders/${item.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: item.status }),
      });
      const remaining = (await getOfflineOrderStatusQueue()).filter(q => q.id !== item.id);
      await AsyncStorage.setItem(ORDER_STATUS_QUEUE_KEY, JSON.stringify(remaining));
      syncedCount++;
    } catch (e: any) {
      console.error(`Failed to sync order status for #${item.id}:`, e);
      warnings.push(`Order #${item.id} (${item.status}): ${e.message}`);
      break; // stop replaying on first failure to preserve order
    }
  }

  // 5. Sync Refills
  const refillsQueue = await getOfflineRefillsQueue();
  if (refillsQueue.length > 0) {
    try {
      let syncedRefills = 0;
      for (const refill of refillsQueue) {
        await createRefill(refill);
        syncedRefills++;
      }
      await clearOfflineRefillsQueue();
      syncedCount += syncedRefills;
    } catch (e: any) {
      console.error('Failed to sync offline refills:', e);
      warnings.push(`Refills Sync failed: ${e.message}`);
    }
  }

  // 6. Sync Credit Payments
  const creditQueue = await getOfflineCreditPaymentsQueue();
  if (creditQueue.length > 0) {
    try {
      let syncedPayments = 0;
      for (const payment of creditQueue) {
        await payCreditBalance(payment.customer_id, payment.amount, payment.customer_name);
        syncedPayments++;
      }
      await clearOfflineCreditPaymentsQueue();
      syncedCount += syncedPayments;
    } catch (e: any) {
      console.error('Failed to sync offline credit payments:', e);
      warnings.push(`Credit Payments Sync failed: ${e.message}`);
    }
  }

  // Update inventories
  try {
    await getInventory();
  } catch {}

  // Replay bill photos captured offline (upload → OCR → review draft)
  try {
    await replayPendingBillPhotos();
  } catch {}

  // Sync Google Credentials
  try {
    await syncGoogleAuthFromPc();
  } catch {}

  return { syncedCount, warnings };
}
