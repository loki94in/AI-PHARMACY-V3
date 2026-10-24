import fs from 'fs';
import path from 'path';
import { getPuppeteer } from '../utils/lazyPuppeteer.js';
import { dbManager } from '../database/connection.js';
import { getAppDataDir } from '../config/index.js';
import {
  findChromePath,
  copyProfileFolder,
  getCommonHeadlessChromiumArgs,
  killOrphanChromeProcesses,
  cleanTempProfileFolders,
  cleanProfileLockFiles,
  trackHeadless,
  untrackHeadless,
  isShutdownInProgress
} from '../utils/chromeBrowser.js';
import { syncPharmarackOrders } from './pharmarackOrderSyncService.js';
import { toLocalSqlDateTime } from '../utils/localTime.js';

export interface CheckoutResultItem {
  storeId?: number;
  storeName: string;
  orderNo?: string;
  status: 'placed' | 'failed' | 'skipped';
  error?: string;
}

export interface CheckoutExecutionResult {
  ok: boolean;
  placedCount: number;
  failedCount: number;
  orders: CheckoutResultItem[];
  error?: string;
}

// Single-flight checkout mutex
let checkoutPromise: Promise<CheckoutExecutionResult> | null = null;

export function resolvePharmarackProfilePath(): string {
  const primary = path.resolve(getAppDataDir(), 'data', 'pharmarack_profile');
  if (fs.existsSync(primary)) return primary;

  const candidates = [
    path.resolve(process.cwd(), 'data', 'pharmarack_profile'),
    path.resolve(process.env.USERPROFILE || '', 'AppData', 'data', 'pharmarack_profile'),
    path.resolve(process.env.LOCALAPPDATA || '', 'AI Pharmacy OS', 'data', 'pharmarack_profile'),
    path.resolve(process.env.APPDATA || '', 'AI Pharmacy OS', 'data', 'pharmarack_profile')
  ];

  for (const cand of candidates) {
    if (cand && fs.existsSync(cand)) {
      console.log(`[PharmarackProfile] Found authenticated profile at candidate path: ${cand}`);
      try {
        fs.mkdirSync(path.dirname(primary), { recursive: true });
        copyProfileFolder(cand, primary, '[PharmarackProfileSync]').catch(() => {});
      } catch (_) {}
      return cand;
    }
  }

  return primary;
}

export class PharmarackCheckoutService {
  private static instance: PharmarackCheckoutService;

  private constructor() {}

  public static getInstance(): PharmarackCheckoutService {
    if (!PharmarackCheckoutService.instance) {
      PharmarackCheckoutService.instance = new PharmarackCheckoutService();
    }
    return PharmarackCheckoutService.instance;
  }

  /**
   * Verifies ambiguous checkout outcomes against fresh synced orders and placed orders for today.
   * If Pharmarack processed the cart but returned an alternate response shape or timed out,
   * this truthfully reclassifies orders that exist on Pharmarack's server.
   */
  private async verifyAmbiguousPlacement(
    db: any,
    todayIso: string,
    storesToPlace: Array<{ storeId: number; storeName: string }>,
    attemptStartMs: number,
    existingResults: CheckoutResultItem[],
    fallbackError?: string
  ): Promise<CheckoutResultItem[]> {
    try {
      console.log(`[PharmarackCheckout] Running post-checkout order verification for ${storesToPlace.length} store(s)...`);
      await syncPharmarackOrders(true);
      const syncedOrders: Array<{ order_no: string; store_name: string; store_id: number | null; first_seen_at: number }> = await db.all(
        `SELECT order_no, store_name, store_id, first_seen_at FROM pharmarack_synced_orders
         WHERE order_date = ? AND first_seen_at >= ?`,
        [todayIso, attemptStartMs]
      );

      const reclassified: CheckoutResultItem[] = [];
      const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

      for (const st of storesToPlace) {
        const existing = existingResults.find(r => r.storeId === st.storeId || norm(r.storeName) === norm(st.storeName));
        if (existing && existing.status === 'placed' && existing.orderNo) {
          reclassified.push(existing);
          continue;
        }

        const stNorm = norm(st.storeName);
        const matchedSync = syncedOrders.find(so => {
          if (st.storeId && so.store_id && Number(st.storeId) === Number(so.store_id)) return true;
          const soNorm = norm(so.store_name);
          return stNorm.length > 2 && soNorm.length > 2 && (stNorm.includes(soNorm) || soNorm.includes(stNorm));
        });

        if (matchedSync && matchedSync.order_no) {
          const placedCheck = await db.get(
            `SELECT id FROM pharmarack_placed_orders WHERE order_date = ? AND order_no = ? LIMIT 1`,
            [todayIso, matchedSync.order_no]
          );
          if (placedCheck) {
            console.log(`[PharmarackCheckout] Ambiguous placement verified: ${st.storeName} -> Order #${matchedSync.order_no}`);
            reclassified.push({
              storeId: st.storeId,
              storeName: st.storeName,
              status: 'placed',
              orderNo: String(matchedSync.order_no)
            });
            continue;
          }
        }

        reclassified.push(existing || {
          storeId: st.storeId,
          storeName: st.storeName,
          status: 'failed',
          error: fallbackError || 'Order placement unconfirmed'
        });
      }

      return reclassified;
    } catch (verifyErr: any) {
      console.warn('[PharmarackCheckout] Ambiguous placement verification warning:', verifyErr?.message || verifyErr);
      return existingResults;
    }
  }

  /**
   * Places official orders on https://pharmretail-api.pharmarack.com/cart/api/v1/SaveOrderCartForRetailerManager
   * using direct REST API authentication.
   * Eliminates headless browser, DOM button hunting, profile lock conflicts, and UI timeouts.
   */
  public async placeOrdersViaApi(targetStoreNames?: string[], targetStoreIds?: number[]): Promise<CheckoutExecutionResult> {
    if (isShutdownInProgress()) {
      return { ok: false, placedCount: 0, failedCount: 0, orders: [], error: 'Application shutdown in progress' };
    }

    let attemptStartMs = 0;
    let storesToPlace: Array<{ storeId: number; storeName: string; retailerId?: number; items: any[] }> = [];
    const results: CheckoutResultItem[] = [];
    try {
      const db = await dbManager.getConnection();
      const row = await db.get("SELECT value FROM app_settings WHERE key = 'pharmarack_session_token' LIMIT 1");
      const token = row?.value;

      if (!token || !token.trim()) {
        return {
          ok: false,
          placedCount: 0,
          failedCount: 0,
          orders: [],
          error: 'Pharmarack session token not found. Please log in via Settings.'
        };
      }

      // Decode user ID from JWT
      let userId = '';
      try {
        const payloadStr = Buffer.from(token.split('.')[1], 'base64').toString();
        const jwtPayload = JSON.parse(payloadStr);
        userId = jwtPayload.id || jwtPayload.UserId || jwtPayload.userId || jwtPayload.sub ? String(jwtPayload.id || jwtPayload.UserId || jwtPayload.userId || jwtPayload.sub) : '';
      } catch (_) {}

      // Fetch active cart details from Pharmarack API
      const cartUrl = 'https://pharmretail-api.pharmarack.com/cart/api/v1/GetUserCartDetails';
      const cartRes = await fetch(cartUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'devicetype': 'web',
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://retailers.pharmarack.com/',
          'Origin': 'https://retailers.pharmarack.com'
        },
        signal: AbortSignal.timeout(30000)
      });

      if (cartRes.status === 401 || cartRes.status === 403) {
        await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_session_status', 'expired')").catch(() => {});
        return {
          ok: false,
          placedCount: 0,
          failedCount: 0,
          orders: [],
          error: 'Pharmarack session expired. Please re-authenticate via Settings > External Integrations.'
        };
      }

      if (!cartRes.ok) {
        throw new Error(`Pharmarack GetUserCartDetails returned status ${cartRes.status}`);
      }

      const cartData: any = await cartRes.json().catch(() => null);
      let storeList: any[] = [];
      if (cartData) {
        if (Array.isArray(cartData)) storeList = cartData;
        else if (Array.isArray(cartData.IList)) storeList = cartData.IList;
        else if (Array.isArray(cartData.ilist)) storeList = cartData.ilist;
        else if (Array.isArray(cartData.data)) storeList = cartData.data;
        else if (Array.isArray(cartData.Data)) storeList = cartData.Data;
        else if (typeof cartData === 'object') {
          const targetObj = cartData.data || cartData.Data || cartData;
          const keysToTry = ['IList', 'ilist', 'StoreWiseCartDetails', 'storeWiseCartDetails', 'CartDetails', 'cartDetails', 'Stores', 'stores', 'Items', 'items'];
          for (const k of keysToTry) {
            if (Array.isArray(targetObj[k])) {
              storeList = targetObj[k];
              break;
            }
          }
        }
      }

      if (!storeList || storeList.length === 0) {
        return {
          ok: false,
          placedCount: 0,
          failedCount: 0,
          orders: [],
          error: 'Pharmarack cart is currently empty.'
        };
      }

      // Group cart items by store, correctly extracting nested items from store groupings
      const storeMap = new Map<number, { storeId: number; storeName: string; retailerId?: number; items: any[] }>();
      for (const entry of storeList) {
        const storeId = Number(entry.StoreId || entry.storeId || entry.Storeid || entry.StoreID || 0);
        const storeName = String(entry.StoreName || entry.storeName || entry.Store || 'Pharmarack Distributor').trim();
        const retailerId = Number(entry.RetailerId || entry.retailerId || 0);
        if (!storeId) continue;

        const rawItems = entry.lineItems || entry.LineItems || entry.CartItemList || entry.cartItemList || 
                         entry.items || entry.Items || entry.products || entry.Products || [];

        if (Array.isArray(rawItems) && rawItems.length > 0) {
          if (!storeMap.has(storeId)) {
            storeMap.set(storeId, { storeId, storeName, retailerId, items: [] });
          }
          storeMap.get(storeId)!.items.push(...rawItems);
        } else if (entry.ProductCode || entry.productCode || entry.ProductName || entry.productName) {
          if (!storeMap.has(storeId)) {
            storeMap.set(storeId, { storeId, storeName, retailerId, items: [] });
          }
          storeMap.get(storeId)!.items.push(entry);
        }
      }

      // Filter by targetStoreIds or targetStoreNames if provided
      storesToPlace = Array.from(storeMap.values());
      if (targetStoreIds && targetStoreIds.length > 0) {
        const idSet = new Set(targetStoreIds.map(Number));
        storesToPlace = storesToPlace.filter(st => idSet.has(st.storeId));
      } else if (targetStoreNames && targetStoreNames.length > 0) {
        const targetNorms = targetStoreNames.map(s => String(s).toLowerCase().replace(/[^a-z0-9]/g, ''));
        storesToPlace = storesToPlace.filter(st => {
          const norm = st.storeName.toLowerCase().replace(/[^a-z0-9]/g, '');
          return targetNorms.some(t => t.includes(norm) || norm.includes(t));
        });
      }

      if (storesToPlace.length === 0) {
        return {
          ok: false,
          placedCount: 0,
          failedCount: 0,
          orders: [],
          error: 'No matching cart distributors found to place.'
        };
      }

      console.log(`[PharmarackCheckout] Preparing direct REST order placement for ${storesToPlace.length} distributor(s)...`);

      // Construct payload according to SaveOrderCartForRetailerManager schema
      const orderPayload = storesToPlace.map(st => {
        const lineItems = st.items.map(it => {
          const rawPtr = Number(it.PTR ?? it.ptr ?? 0);
          const hiddenPtr = Number(it.HiddenPTR ?? it.hiddenPtr ?? 0);
          const netRate = Number(it.NetRate ?? it.netRate ?? 0);
          const effectivePtr = rawPtr > 0 ? rawPtr : (hiddenPtr > 0 ? hiddenPtr : (netRate > 0 ? netRate : 0));
          const qty = Number(it.Quantity ?? it.qty ?? it.quantity ?? 1);
          return {
            PTR: effectivePtr,
            ProductName: String(it.ProductName ?? it.productName ?? it.Name ?? it.name ?? '').trim(),
            ProductCode: String(it.ProductCode ?? it.productCode ?? '').trim(),
            Quantity: qty,
            Free: Number(it.Free ?? it.free ?? 0),
            Scheme: String(it.Scheme ?? it.scheme ?? ''),
            SchemeType: String(it.SchemeType ?? it.schemeType ?? ''),
            HiddenPTR: hiddenPtr > 0 ? hiddenPtr : effectivePtr,
            NetRate: netRate > 0 ? netRate : effectivePtr
          };
        }).filter(it => it.ProductCode.length > 0 && it.Quantity > 0);

        const storeAmount = lineItems.reduce((sum, it) => sum + (it.Quantity * it.PTR), 0);

        return {
          storeId: st.storeId,
          OrderDeliveryModeText: "Delivery",
          OrderRemarksText: "",
          DeliveryPerson: "",
          DeliveryPersonCode: "",
          OrderSource: "MOVP",
          SKipAndContinue: 1, // Crucial: skip unpriced/locked items automatically without UI popup blocking
          OrderPlacedBy: userId || String(st.retailerId || 0),
          Latitude: "",
          Longitude: "",
          BrowserName: "Web",
          Version: "PR2",
          OS: "Web",
          MacAddress: "en_IN",
          IpAddress: "",
          StoreWiseAmount: storeAmount,
          GSTAmount: 0,
          items: lineItems
        };
      }).filter(st => st.items.length > 0);

      if (orderPayload.length === 0) {
        return {
          ok: false,
          placedCount: 0,
          failedCount: 0,
          orders: [],
          error: 'No valid products with product codes found in selected cart distributor(s).'
        };
      }

      attemptStartMs = Date.now();
      const todayIso = toLocalSqlDateTime(new Date()).slice(0, 10);
      console.log(`[PharmarackCheckout] Sending SaveOrderCartForRetailerManager request to Pharmarack API for ${orderPayload.length} store(s)...`);
      const saveOrderUrl = 'https://pharmretail-api.pharmarack.com/cart/api/v1/SaveOrderCartForRetailerManager';
      const orderRes = await fetch(saveOrderUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'devicetype': 'web',
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://retailers.pharmarack.com/',
          'Origin': 'https://retailers.pharmarack.com'
        },
        body: JSON.stringify(orderPayload),
        signal: AbortSignal.timeout(30000)
      });

      if (!orderRes.ok) {
        const errText = await orderRes.text().catch(() => '');
        console.error(`[PharmarackCheckout] SaveOrderCartForRetailerManager failed with HTTP ${orderRes.status}:`, errText);
        return {
          ok: false,
          placedCount: 0,
          failedCount: storesToPlace.length,
          orders: storesToPlace.map(st => ({
            storeId: st.storeId,
            storeName: st.storeName,
            status: 'failed',
            error: `Pharmarack API rejected order (HTTP ${orderRes.status}): ${errText.slice(0, 150)}`
          })),
          error: `Pharmarack order failed: ${errText.slice(0, 150) || 'API error'}`
        };
      }

      const orderResData: any = await orderRes.json().catch(() => null);
      console.log('[PharmarackCheckout] SaveOrderCartForRetailerManager response:', JSON.stringify(orderResData).slice(0, 300));

      const displayOrders = orderResData?.data?.DisplayStoreOrder || orderResData?.DisplayStoreOrder || [];
      const isSuccessMsg = String(orderResData?.data?.Message || orderResData?.Message || '').toLowerCase() === 'success';

      if (Array.isArray(displayOrders) && displayOrders.length > 0) {
        for (const disp of displayOrders) {
          const matchedStore = storesToPlace.find(s => s.storeId === Number(disp.StoreId || disp.storeId));
          const sName = disp.StoreName || matchedStore?.storeName || 'Pharmarack Distributor';
          const ordNo = disp.OrderNo || disp.orderNo || disp.OrderId || '';
          const status = (disp.Status?.toLowerCase() === 'success' || Boolean(ordNo)) ? 'placed' : 'failed';

          results.push({
            storeId: Number(disp.StoreId || disp.storeId || matchedStore?.storeId),
            storeName: sName,
            orderNo: ordNo ? String(ordNo) : undefined,
            status,
            error: status === 'failed' ? (disp.Message || 'Order rejected by distributor') : undefined
          });
        }
      } else if (isSuccessMsg || orderResData?.code === 200 || orderResData?.StatusCode === 200) {
        for (const st of storesToPlace) {
          results.push({
            storeId: st.storeId,
            storeName: st.storeName,
            status: 'placed'
          });
        }
      }

      // Truthful verification: If response parsed to 0 results but HTTP request succeeded,
      // verify if orders were actually placed on Pharmarack before returning failure
      if (results.length === 0) {
        results.push(...await this.verifyAmbiguousPlacement(db, todayIso, storesToPlace, attemptStartMs, results));
      }

      const placedCount = results.filter(r => r.status === 'placed').length;
      const failedCount = results.filter(r => r.status === 'failed').length;
      const isOk = placedCount > 0;

      // Trigger immediate order sync to pull finalized Order IDs into SQLite
      syncPharmarackOrders().catch(e => console.warn('[PharmarackCheckout] Post-API sync warning:', e.message));

      return {
        ok: isOk,
        placedCount,
        failedCount,
        orders: results,
        error: isOk ? undefined : (orderResData?.message || orderResData?.data?.Message || 'Failed to confirm placed orders via Pharmarack API')
      };
    } catch (apiErr: any) {
      console.warn('[PharmarackCheckout] Direct REST API checkout error:', apiErr.message);

      // If attempt was dispatched, run verification before declaring failure
      if (storesToPlace.length > 0 && attemptStartMs > 0) {
        try {
          const todayIso = toLocalSqlDateTime(new Date()).slice(0, 10);
          const db = await dbManager.getConnection();
          const recovered = await this.verifyAmbiguousPlacement(db, todayIso, storesToPlace, attemptStartMs, [], apiErr.message);
          const placedCount = recovered.filter(r => r.status === 'placed').length;
          const failedCount = recovered.filter(r => r.status === 'failed').length;
          if (placedCount > 0) {
            console.log(`[PharmarackCheckout] Rescued ambiguous checkout error: verified ${placedCount} order(s) placed.`);
            return {
              ok: true,
              placedCount,
              failedCount,
              orders: recovered,
              error: failedCount > 0 ? 'Some orders placed, some failed' : undefined
            };
          }
        } catch (rescueErr: any) {
          console.warn('[PharmarackCheckout] Rescue verification error:', rescueErr?.message || rescueErr);
        }
      }

      return {
        ok: false,
        placedCount: 0,
        failedCount: storesToPlace.length || 1,
        orders: (storesToPlace.length > 0 ? storesToPlace : [{ storeId: 0, storeName: 'Unknown' }]).map(st => ({
          storeId: st.storeId,
          storeName: st.storeName,
          status: 'failed',
          error: apiErr.message || 'Direct REST order placement error'
        })),
        error: apiErr.message || 'Direct REST order placement error'
      };
    }
  }

  /**
   * Places official orders on https://retailers.pharmarack.com/cart using the authenticated session profile.
   * Single-flight execution prevents concurrent browser instances.
   */
  public async executeCartCheckout(targetStoreNames?: string[]): Promise<CheckoutExecutionResult> {
    if (checkoutPromise) {
      console.log('[PharmarackCheckout] Checkout already in flight. Awaiting existing run...');
      return checkoutPromise;
    }

    checkoutPromise = this.runCheckoutInternal(targetStoreNames).finally(() => {
      checkoutPromise = null;
    });

    return checkoutPromise;
  }

  private async runCheckoutInternal(targetStoreNames?: string[]): Promise<CheckoutExecutionResult> {
    if (isShutdownInProgress()) {
      return { ok: false, placedCount: 0, failedCount: 0, orders: [], error: 'Application shutdown in progress' };
    }

    const chromePath = findChromePath();
    if (!chromePath) {
      return { ok: false, placedCount: 0, failedCount: 0, orders: [], error: 'Google Chrome was not found on your system.' };
    }

    const mainProfilePath = resolvePharmarackProfilePath();
    if (!fs.existsSync(mainProfilePath)) {
      fs.mkdirSync(mainProfilePath, { recursive: true });
    }

    let browser: any = null;
    let headlessTrackId: string | null = null;
    let tempProfilePathToDelete = '';
    const puppeteer = await getPuppeteer();
    const results: CheckoutResultItem[] = [];

    try {
      console.log('[PharmarackCheckout] Preparing Chrome profile for automated cart checkout...');
      await killOrphanChromeProcesses('pharmarack_profile');
      cleanTempProfileFolders();

      try {
        cleanProfileLockFiles(mainProfilePath);
        browser = await puppeteer.launch({
          executablePath: chromePath,
          headless: true,
          userDataDir: mainProfilePath,
          args: getCommonHeadlessChromiumArgs([
            '--no-zygote',
            '--js-flags=--max-old-space-size=256',
            '--window-size=1920,1080',
            '--window-position=-10000,-10000'
          ])
        });
        headlessTrackId = trackHeadless(browser, 'pharmarack_checkout_main');
      } catch (launchErr: any) {
        if (isShutdownInProgress()) {
          return { ok: false, placedCount: 0, failedCount: 0, orders: [], error: 'Application shutting down' };
        }
        console.log('[PharmarackCheckout] Main profile locked, falling back to temp profile copy...', launchErr.message);
        const randomSuffix = Math.floor(Math.random() * 1000000);
        const tempProfilePath = path.resolve(getAppDataDir(), 'data', `pharmarack_profile_checkout_${Date.now()}_${randomSuffix}`);
        await copyProfileFolder(mainProfilePath, tempProfilePath, '[PharmarackCheckout]');
        cleanProfileLockFiles(tempProfilePath);

        browser = await puppeteer.launch({
          executablePath: chromePath,
          headless: true,
          userDataDir: tempProfilePath,
          args: getCommonHeadlessChromiumArgs([
            '--no-zygote',
            '--js-flags=--max-old-space-size=256',
            '--window-size=1920,1080',
            '--window-position=-10000,-10000'
          ])
        });
        headlessTrackId = trackHeadless(browser, 'pharmarack_checkout_temp');
        tempProfilePathToDelete = tempProfilePath;
      }

      const [page] = await browser.pages();
      // Standardize to desktop 1080p so the Angular SPA renders full desktop layout with primary Place Order button
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      page.setDefaultNavigationTimeout(35000);
      page.setDefaultTimeout(15000);

      // Captured order IDs from network API responses during checkout
      const networkOrderNos = new Set<string>();

      page.on('response', async (response: any) => {
        try {
          const url = response.url();
          if (url.includes('/order') || url.includes('/cart') || url.includes('Order') || url.includes('checkout') || url.includes('Checkout') || url.includes('retailer')) {
            const status = response.status();
            if (status >= 200 && status < 300) {
              const text = await response.text().catch(() => '');
              if (text) {
                const matches = text.match(/"(?:OrderNo|orderNo|OrderId|orderId|po_number|poNumber|OrderNumber)"\s*:\s*"?([A-Za-z0-9_-]+)"?/gi);
                if (matches) {
                  for (const m of matches) {
                    const cleanNo = m.replace(/"(?:OrderNo|orderNo|OrderId|orderId|po_number|poNumber|OrderNumber)"\s*:\s*"?/i, '').replace(/"?$/, '').trim();
                    if (cleanNo && cleanNo !== '0' && cleanNo.toLowerCase() !== 'null' && cleanNo.length >= 3) {
                      networkOrderNos.add(cleanNo);
                      console.log('[PharmarackCheckout] Captured official Order ID from network response:', cleanNo);
                    }
                  }
                }
              }
            }
          }
        } catch (_) {}
      });

      console.log('[PharmarackCheckout] Navigating to https://retailers.pharmarack.com/cart ...');
      await page.goto('https://retailers.pharmarack.com/cart', { waitUntil: 'domcontentloaded', timeout: 35000 });

      const currentUrl = page.url();
      if (currentUrl.includes('/login') || currentUrl.includes('/auth') || currentUrl.includes('/signin')) {
        console.warn('[PharmarackCheckout] Session expired: Redirected to login page.');
        const db = await dbManager.getConnection();
        await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_session_status', 'expired')").catch(() => {});
        return {
          ok: false,
          placedCount: 0,
          failedCount: 0,
          orders: [],
          error: 'Pharmarack session expired. Please re-authenticate via Settings > External Integrations.'
        };
      }

      // Wait up to 15s for dynamic Angular SPA to finish loading GetUserCartDetails & rendering cards
      console.log('[PharmarackCheckout] Waiting for Pharmarack cart page SPA hydration and network calls...');
      const hydrationStart = Date.now();
      let cartIsEmpty = false;

      while (Date.now() - hydrationStart < 15000) {
        const pageStatus = await page.evaluate(() => {
          const bodyText = (document.body?.innerText || '').toLowerCase();
          const isEmpty = bodyText.includes('cart is empty') || bodyText.includes('no item in cart') || bodyText.includes('no product found');
          const buttons = Array.from(document.querySelectorAll('button, [role="button"], a.btn, input[type="button"], input[type="submit"]'));
          const hasPlaceOrderBtn = buttons.some(b => {
            const txt = (b.textContent || (b as HTMLInputElement).value || '').trim().toLowerCase();
            return txt.includes('place order') || txt.includes('checkout') || txt.includes('order now') || txt.includes('proceed to buy');
          });
          const hasCards = document.querySelectorAll(
            '.distributor-card, .supplier-card, .store-card, .card, [class*="distributor"], [class*="supplier"], [class*="store"], .cart-item-group, .accordion-item, .panel, tbody tr'
          ).length > 0;

          return { isEmpty, hasPlaceOrderBtn, hasCards };
        }).catch(() => ({ isEmpty: false, hasPlaceOrderBtn: false, hasCards: false }));

        if (pageStatus.isEmpty) {
          cartIsEmpty = true;
          break;
        }

        if (pageStatus.hasPlaceOrderBtn && (Date.now() - hydrationStart >= 6000)) {
          break;
        }
        await new Promise(r => setTimeout(r, 1000));
      }

      const placedStores: string[] = [];
      const failedStores: { name: string; error: string }[] = [];
      const logs: string[] = [];
      let primaryClicked = false;

      if (!cartIsEmpty) {
        // Query candidate buttons via real Puppeteer handles for coordinate-level pointer clicks
        const candidateHandles = await page.$$('button, [role="button"], a.btn, input[type="button"], input[type="submit"], [class*="checkout"], [class*="place-order"]');
        logs.push(`Found ${candidateHandles.length} total interactive buttons on cart page`);

        for (const btnHandle of candidateHandles) {
          try {
            const btnInfo = await page.evaluate((el: HTMLElement) => {
              const text = (el.innerText || el.textContent || (el as HTMLInputElement).value || '').trim();
              const lower = text.toLowerCase();
              const isPlaceOrder = (
                lower.includes('place order') ||
                lower.includes('confirm order') ||
                lower.includes('checkout') ||
                lower.includes('order now') ||
                lower.includes('review & place') ||
                lower.includes('proceed to buy')
              );
              const style = window.getComputedStyle(el);
              const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
              const isDisabled = (el as any).disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled');

              // Find parent store name if inside a store section
              let storeName = 'Pharmarack Distributor';
              let curr: HTMLElement | null = el;
              for (let i = 0; i < 7; i++) {
                if (!curr) break;
                const headerEl = curr.querySelector('h1, h2, h3, h4, h5, .store-name, .distributor-name, [class*="store"], [class*="distributor"], [class*="supplier-name"]');
                if (headerEl && headerEl.textContent) {
                  const cand = headerEl.textContent.trim();
                  if (cand.length > 2 && !cand.toLowerCase().includes('cart') && !cand.toLowerCase().includes('order') && !cand.toLowerCase().includes('total')) {
                    storeName = cand;
                    break;
                  }
                }
                curr = curr.parentElement;
              }

              return { isPlaceOrder, isVisible, isDisabled, text, storeName };
            }, btnHandle);

            if (!btnInfo.isPlaceOrder || !btnInfo.isVisible || btnInfo.isDisabled) {
              continue;
            }

            logs.push(`Attempting real pointer click on Place Order button: "${btnInfo.text}" (store: ${btnInfo.storeName})`);

            // Scroll into view
            await btnHandle.scrollIntoViewIfNeeded().catch(() => {});
            await new Promise(r => setTimeout(r, 400));

            // Execute real OS mouse click on bounding box center
            const box = await btnHandle.boundingBox();
            if (box) {
              await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 60 });
            } else {
              await btnHandle.click({ delay: 60 });
            }

            // Also invoke DOM click as a secondary trigger guarantee for Angular Zone.js
            await page.evaluate((el: HTMLElement) => el.click(), btnHandle).catch(() => {});

            primaryClicked = true;
            placedStores.push(btnInfo.storeName);
            logs.push(`Successfully clicked Place Order button for: ${btnInfo.storeName}`);

            // Brief settling pause to allow Angular to process and spawn confirmation dialog if any
            await new Promise(r => setTimeout(r, 1200));

            // Check for confirmation dialogs
            for (let step = 0; step < 6; step++) {
              const confirmedModal = await page.evaluate(() => {
                const modalButtons = Array.from(document.querySelectorAll(
                  '.modal button, [role="dialog"] button, .swal2-confirm, .ant-modal-footer button, .confirm-btn, [class*="modal"] button, [class*="dialog"] button, .cdk-overlay-pane button'
                )) as HTMLElement[];

                for (const mBtn of modalButtons) {
                  const mText = (mBtn.innerText || mBtn.textContent || '').trim().toLowerCase();
                  if (mText.includes('confirm') || mText.includes('yes') || mText.includes('proceed') || mText.includes('place order') || mText.includes('ok')) {
                    mBtn.click();
                    return mText;
                  }
                }
                return null;
              }).catch(() => null);

              if (confirmedModal) {
                logs.push(`Confirmed modal dialog prompt with button: "${confirmedModal}"`);
                break;
              }
              await new Promise(r => setTimeout(r, 500));
            }

            // If this was a global cart checkout button, one click places the entire cart
            if (btnInfo.storeName === 'Pharmarack Distributor' || !targetStoreNames || targetStoreNames.length <= 1) {
              break;
            }
          } catch (clickErr: any) {
            logs.push(`Button click error: ${clickErr.message}`);
            failedStores.push({ name: 'Distributor Button', error: clickErr.message });
          }
        }
      }

      console.log('[PharmarackCheckout] Execution summary:', { logs, placedStores, primaryClicked, cartIsEmpty });

      // Wait 8-10s buffer for Pharmarack server to commit orders and emit Order IDs in network stream
      console.log('[PharmarackCheckout] Waiting for Pharmarack server to commit orders and sync Order IDs...');
      await new Promise(r => setTimeout(r, 8000));

      // Trigger order sync immediately to pull official Order IDs from Pharmarack backend
      console.log('[PharmarackCheckout] Triggering immediate Pharmarack order sync to fetch official Order IDs...');
      let syncRes = null;
      try {
        syncRes = await syncPharmarackOrders();
        console.log('[PharmarackCheckout] Order sync complete:', syncRes);
      } catch (sErr: any) {
        console.warn('[PharmarackCheckout] Order sync error post-checkout:', sErr.message);
      }

      // Check database for today's orders
      const today = toLocalSqlDateTime(new Date()).slice(0, 10);
      const db = await dbManager.getConnection();
      const syncedToday = await db.all(
        `SELECT order_no, store_name, order_amount FROM pharmarack_synced_orders WHERE order_date = ? ORDER BY first_seen_at DESC`,
        [today]
      ).catch(() => []);

      const capturedOrders = Array.from(networkOrderNos);
      if (syncedToday && syncedToday.length > 0) {
        syncedToday.forEach((s: any) => {
          if (s.order_no && !capturedOrders.includes(s.order_no)) {
            capturedOrders.push(s.order_no);
          }
        });
      }

      if (placedStores.length > 0) {
        placedStores.forEach((sName: string, idx: number) => {
          results.push({
            storeName: sName,
            orderNo: capturedOrders[idx] || undefined,
            status: 'placed'
          });
        });
      } else if (capturedOrders.length > 0) {
        capturedOrders.forEach((ordNo: string) => {
          results.push({
            storeName: 'Pharmarack Distributor',
            orderNo: ordNo,
            status: 'placed'
          });
        });
      } else if (primaryClicked) {
        results.push({
          storeName: targetStoreNames?.[0] || 'Pharmarack Distributor',
          status: 'placed'
        });
      }

      if (failedStores.length > 0) {
        failedStores.forEach((f: any) => {
          results.push({
            storeName: f.name,
            status: 'failed',
            error: f.error
          });
        });
      }

      const placedCount = results.filter(r => r.status === 'placed').length;
      const failedCount = results.filter(r => r.status === 'failed').length;
      const isOk = placedCount > 0 || primaryClicked || (syncedToday && syncedToday.length > 0);

      return {
        ok: isOk,
        placedCount: placedCount || (isOk ? (syncedToday.length || 1) : 0),
        failedCount,
        orders: results,
        error: isOk ? undefined : (cartIsEmpty ? 'Pharmarack cart is currently empty.' : 'No Place Order buttons could be confirmed on the cart page.')
      };
    } catch (err: any) {
      console.error('[PharmarackCheckout] Execution error:', err);
      return {
        ok: false,
        placedCount: 0,
        failedCount: 0,
        orders: results,
        error: err.message || 'Automated checkout failed'
      };
    } finally {
      if (headlessTrackId) {
        untrackHeadless(headlessTrackId);
      }
      if (browser) {
        try {
          await browser.close();
        } catch (_) {}
      }
      if (tempProfilePathToDelete) {
        try {
          await copyProfileFolder(tempProfilePathToDelete, mainProfilePath, '[PharmarackCheckout]');
          fs.rmSync(tempProfilePathToDelete, { recursive: true, force: true });
        } catch (_) {}
      }
    }
  }

  /**
   * Spawns an authenticated Chrome browser window directly to https://retailers.pharmarack.com/cart
   * for 1-click human-in-the-loop manual review or verification.
   */
  public async openAuthenticatedCartWindow(): Promise<{ ok: boolean; message: string }> {
    if (isShutdownInProgress()) {
      return { ok: false, message: 'Application shutdown in progress' };
    }
    const chromePath = findChromePath();
    if (!chromePath) {
      return { ok: false, message: 'Google Chrome was not found on your system.' };
    }

    const mainProfilePath = resolvePharmarackProfilePath();
    try {
      await killOrphanChromeProcesses('pharmarack_profile');
      if (!fs.existsSync(mainProfilePath)) fs.mkdirSync(mainProfilePath, { recursive: true });
      cleanProfileLockFiles(mainProfilePath);

      const { spawn: spawnProc } = await import('child_process');
      const chromeProc = spawnProc(chromePath, [
        `--user-data-dir=${mainProfilePath}`,
        '--start-maximized',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-sync',
        'https://retailers.pharmarack.com/cart'
      ], { detached: false, stdio: 'ignore', windowsHide: false });

      trackHeadless(chromeProc, 'pharmarack_cart_window');
      return { ok: true, message: 'Opening official Pharmarack cart window...' };
    } catch (err: any) {
      console.error('[PharmarackCheckout] Failed to open cart window:', err);
      return { ok: false, message: err.message || 'Failed to open Chrome window' };
    }
  }
}

export const pharmarackCheckoutService = PharmarackCheckoutService.getInstance();
