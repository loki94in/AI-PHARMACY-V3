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
