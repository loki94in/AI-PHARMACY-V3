/**
 * Helper for Pharmarack-linked (no-inventory) website orders:
 * 1. On-demand Pharmarack stock + highest-MRP check ONLY when patient adds to cart (zero browse-time calls).
 * 2. Closure-aware 20-24h ETA message (automatically detects Sunday weekly off, holidays, and market/shop closures).
 * 3. Adds confirmed ₹50-booked items to the Pharmarack Live Cart via saved medicine_distributor_links.
 *
 * Patient privacy: NEVER expose distributor name, purchase rate, or discount to patient-facing responses.
 */
import { dbManager } from '../database/connection.js';
import { eventService } from './eventService.js';
import { getMedicineLinks, type RefillCartPick } from './refillCartService.js';
import { isClosedDay, advanceToNextOpenDay } from '../utils/pharmacyCalendar.js';
import { marketClosureService } from './marketClosureService.js';
import { getShopTimingNow, buildShopTimingNote, formatDayLabel } from '../utils/closureNotice.js';

export interface PharmarackCartCheckResult {
  available: boolean;
  lowStock: boolean;
  mrp: number;
  message: string;
  /** Internal-only for backend Live Cart add; strip before sending to patient. */
  internalPick?: RefillCartPick | null;
}

function parseNumericStock(raw: unknown): number {
  const s = String(raw ?? '').trim();
  if (!s) return 0;
  const num = parseFloat(s.replace(/[^0-9.]/g, ''));
  return isNaN(num) ? 0 : num;
}

/**
 * Checks Pharmarack stock ONLY for a medicine's linked distributors (`medicine_distributor_links`)
 * against the patient's requested quantity. Never exposes distributor/rate/discount.
 */
export async function checkLinkedPharmarackStock(
  medicineId: number,
  requestedQty: number
): Promise<PharmarackCartCheckResult> {
  const db = await dbManager.getConnection();
  const med = await db.get(
    `SELECT m.id, m.name,
            COALESCE(
              (SELECT MAX(im.mrp) FROM inventory_master im WHERE im.medicine_id = m.id),
              m.mrp,
              0
            ) AS saved_mrp
     FROM medicines m WHERE m.id = ?`,
    [medicineId]
  );
  if (!med) {
    return { available: false, lowStock: false, mrp: 0, message: 'Medicine not found.' };
  }

  const savedMrp = Number(med.saved_mrp || 0);
  const links = (await getMedicineLinks(medicineId)).filter(
    l => l.mapped !== false && Number(l.storeId) > 0 && String(l.productCode || '').trim() !== ''
  );
  if (links.length === 0) {
    return { available: false, lowStock: true, mrp: savedMrp, message: 'Currently unavailable for online order.' };
  }

  const qty = Math.max(1, Number(requestedQty) || 1);
  const pr = await import('../routes/pharmarack.js');
  const outcome = await pr.performPharmarackSearch(String(med.name || ''), null, false);

  if (outcome.status !== 'ok' || !Array.isArray(outcome.items)) {
    return {
      available: false,
      lowStock: true,
      mrp: savedMrp,
      message: 'Live stock check is temporarily unavailable. Please try again shortly.'
    };
  }

  let highestMrp = savedMrp;
  let matchedPick: RefillCartPick | null = null;

  for (const link of links) {
    const hit = (outcome.items as any[]).find(
      i => Number(i.storeId) === Number(link.storeId) && String(i.productCode || '').trim() === String(link.productCode).trim()
    );
    if (!hit) continue;
    const hitMrp = Number(hit.mrp || 0);
    if (hitMrp > highestMrp) highestMrp = hitMrp;

    const inStock = pr.isItemInStock(hit.stock);
    const numericStock = parseNumericStock(hit.stock);
    if (inStock && (numericStock === 0 || numericStock >= qty)) {
      matchedPick = { ...link, mrp: hitMrp || link.mrp };
      break;
    }
  }

  if (matchedPick) {
    return {
      available: true,
      lowStock: false,
      mrp: highestMrp,
      message: 'Available for booking.',
      internalPick: matchedPick
    };
  }

  // Notify pharmacist in-app of low stock without exposing distributor details to patient
  try {
    eventService.broadcast('toast_alert', {
      type: 'warning',
      title: 'Low Stock on Linked Medicine',
      message: `${med.name} (requested qty: ${qty}) is low or out of stock across linked Pharmarack distributors.`
    });
  } catch (_) {}

  return {
    available: false,
    lowStock: true,
    mrp: highestMrp,
    message: `Stock is currently low for "${med.name}" (qty ${qty}). Our pharmacy has been notified.`
  };
}

/**
 * Builds the 20-24h arrival notice, automatically adjusting when Sunday weekly-off,
 * a marked market closure, or pharmacy closure falls in the arrival window.
 */
export async function buildClosureAwareEtaNote(dbInstance?: any, lang: string = 'en'): Promise<string> {
  const db = dbInstance || (await dbManager.getConnection());
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const tomorrowClosed = await isClosedDay(tomorrow, 1, db).catch(() => ({ isClosed: false, isWeeklyOff: false, reason: '' }));
  const marketCfg = await marketClosureService.getConfig(db).catch(() => null);

  let etaLine = 'We will notify you soon once it arrives in the pharmacy within the next 20–24 hours.';
  if (tomorrowClosed.isClosed || (marketCfg?.enabled && marketCfg.type === 'market_closed')) {
    const nextOpen = await advanceToNextOpenDay(tomorrow, { dbInstance: db, advanceAtLeastOneDay: false }).catch(() => null);
    const nextLabel = nextOpen ? formatDayLabel(nextOpen.targetDate) : 'the next working day';
    const reasonText = tomorrowClosed.isWeeklyOff
      ? 'Sunday market holiday'
      : (tomorrowClosed.reason || marketCfg?.reason || 'market closure');
    etaLine = `Note: Due to ${reasonText}, your medicine is expected to arrive on *${nextLabel}*. We will notify you as soon as it arrives in the pharmacy.`;
  }

  const timingNow = await getShopTimingNow(db).catch(() => null);
  const shopNote = buildShopTimingNote(timingNow, lang, 'booking');
  return `${etaLine}${shopNote}`;
}

/**
 * Adds a confirmed booked website item (no-inventory Pharmarack-linked) to the Pharmarack Live Cart.
 */
export async function addConfirmedWebsiteItemToLiveCart(
  medicineId: number,
  medicineName: string,
  qty: number
): Promise<{ added: boolean; error?: string }> {
  const check = await checkLinkedPharmarackStock(medicineId, qty);
  const links = check.internalPick ? [check.internalPick] : await getMedicineLinks(medicineId);
  const pick = links.find(l => l.mapped !== false && Number(l.storeId) > 0 && String(l.productCode || '').trim() !== '');
  if (!pick) {
    return { added: false, error: 'No valid Pharmarack distributor link found.' };
  }
  try {
    const pr = await import('../routes/pharmarack.js');
    const result = await pr.addItemsToPharmarackCart([
      {
        storeId: Number(pick.storeId),
        storeName: String(pick.storeName),
        productCode: String(pick.productCode),
        productId: pick.productId ?? undefined,
        productName: String(pick.productName || medicineName),
        qty: Math.max(1, Number(qty) || 1)
      }
    ]);
    if (result && (result as any).offline) {
      return { added: false, error: 'Pharmarack session is offline.' };
    }
    eventService.broadcast('refresh-pharmarack-cart', { source: 'website_booking', medicineId });
    return { added: true };
  } catch (err: any) {
    return { added: false, error: err?.message || 'Failed to add to Pharmarack Live Cart' };
  }
}
