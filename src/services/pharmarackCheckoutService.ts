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

    const mainProfilePath = path.resolve(getAppDataDir(), 'data', 'pharmarack_profile');
    if (!fs.existsSync(mainProfilePath)) {
      return { ok: false, placedCount: 0, failedCount: 0, orders: [], error: 'No active Pharmarack profile found. Please log in first.' };
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
            '--window-position=-10000,-10000'
          ])
        });
        headlessTrackId = trackHeadless(browser, 'pharmarack_checkout_temp');
        tempProfilePathToDelete = tempProfilePath;
      }

      const [page] = await browser.pages();
      page.setDefaultNavigationTimeout(30000);
      page.setDefaultTimeout(15000);

      // Captured order IDs from network API responses during checkout
      const networkOrderNos = new Set<string>();

      page.on('response', async (response: any) => {
        try {
          const url = response.url();
          if (url.includes('/order/') || url.includes('/cart/') || url.includes('Order')) {
            const status = response.status();
            if (status >= 200 && status < 300) {
              const text = await response.text().catch(() => '');
              if (text && text.includes('OrderNo')) {
                const matches = text.match(/"OrderNo"\s*:\s*"?([A-Za-z0-9_-]+)"?/g);
                if (matches) {
                  for (const m of matches) {
                    const cleanNo = m.replace(/"OrderNo"\s*:\s*"?/, '').replace(/"?$/, '').trim();
                    if (cleanNo) networkOrderNos.add(cleanNo);
                  }
                }
              }
            }
          }
        } catch (_) {}
      });

      console.log('[PharmarackCheckout] Navigating to https://retailers.pharmarack.com/cart ...');
      await page.goto('https://retailers.pharmarack.com/cart', { waitUntil: 'domcontentloaded', timeout: 25000 });

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

      // Wait a moment for dynamic SPA content to hydrate
      await new Promise(r => setTimeout(r, 2500));

      // Attempt to identify distributor cards and trigger official "Place Order" actions
      const checkoutExecution = await page.evaluate(async (targetNames: string[] | null) => {
        const logs: string[] = [];
        const placedStores: string[] = [];
        const failedStores: { name: string; error: string }[] = [];

        // 1. Sync distributor checkboxes on https://retailers.pharmarack.com/cart if targetNames provided
        if (targetNames && targetNames.length > 0) {
          try {
            const potentialSections = Array.from(document.querySelectorAll(
              '.distributor-card, .supplier-card, .store-card, .card, [class*="distributor"], [class*="supplier"], [class*="store"], .cart-item-group, .accordion-item, .panel'
            )) as HTMLElement[];

            for (const section of potentialSections) {
              const headerEl = section.querySelector('h1, h2, h3, h4, h5, .store-name, .distributor-name, [class*="store"], [class*="distributor"], [class*="supplier-name"]');
              if (!headerEl || !headerEl.textContent) continue;
              const cardName = headerEl.textContent.trim();
              if (cardName.length < 3 || cardName.toLowerCase().includes('cart') || cardName.toLowerCase().includes('total')) continue;

              const normCard = cardName.toLowerCase().trim();
              const shouldBeSelected = targetNames.some(t => {
                const normT = t.toLowerCase().trim();
                return normCard.includes(normT) || normT.includes(normCard);
              });

              // Locate checkbox associated with this distributor section
              const chk = section.querySelector('input[type="checkbox"], [role="checkbox"], .ant-checkbox-input, .mat-checkbox-input') as HTMLInputElement | null;
              if (chk) {
                const isChecked = chk.checked || chk.getAttribute('aria-checked') === 'true' || chk.closest('.ant-checkbox-checked') !== null || chk.closest('.mat-checkbox-checked') !== null;
                if (shouldBeSelected && !isChecked) {
                  chk.scrollIntoView({ behavior: 'instant', block: 'center' });
                  chk.click();
                  logs.push(`Checked distributor checkbox on Pharmarack: ${cardName}`);
                  await new Promise(r => setTimeout(r, 200));
                } else if (!shouldBeSelected && isChecked) {
                  chk.scrollIntoView({ behavior: 'instant', block: 'center' });
                  chk.click();
                  logs.push(`Unchecked distributor checkbox on Pharmarack: ${cardName}`);
                  await new Promise(r => setTimeout(r, 200));
                }
              }
            }
          } catch (syncErr: any) {
            logs.push(`Distributor checkbox sync warning: ${syncErr?.message || syncErr}`);
          }
        }

        // Search for all buttons on the cart page that indicate checkout/order placement
        const allButtons = Array.from(document.querySelectorAll('button, a[role="button"]')) as HTMLElement[];
        const placeOrderButtons = allButtons.filter(b => {
          const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
          return (
            txt.includes('place order') ||
            txt.includes('confirm order') ||
            txt.includes('checkout') ||
            txt.includes('order now')
          );
        });

        logs.push(`Found ${placeOrderButtons.length} potential place order button(s) on cart page.`);

        if (placeOrderButtons.length === 0) {
          // Check if cart is already empty or no items
          const bodyText = (document.body.innerText || '').toLowerCase();
          if (bodyText.includes('cart is empty') || bodyText.includes('no item') || bodyText.includes('no product')) {
            return { emptyCart: true, logs, placedStores, failedStores };
          }
          return { noButtons: true, logs, placedStores, failedStores };
        }

        for (const btn of placeOrderButtons) {
          try {
            // Find parent store name if possible
            let storeName = 'Distributor';
            let container: HTMLElement | null = btn;
            for (let i = 0; i < 6; i++) {
              if (!container) break;
              const headerEl = container.querySelector('h1, h2, h3, h4, h5, .store-name, .distributor-name, [class*="store"], [class*="distributor"]');
              if (headerEl && headerEl.textContent) {
                const cand = headerEl.textContent.trim();
                if (cand.length > 2 && !cand.toLowerCase().includes('cart') && !cand.toLowerCase().includes('order')) {
                  storeName = cand;
                  break;
                }
              }
              container = container.parentElement;
            }

            // If target store names filter provided, check match
            if (targetNames && targetNames.length > 0) {
              const normStore = storeName.toLowerCase().trim();
              const isMatch = targetNames.some(t => normStore.includes(t.toLowerCase().trim()) || t.toLowerCase().trim().includes(normStore));
              // If it's a store-specific button and doesn't match target, skip it
              if (storeName !== 'Distributor' && !isMatch) {
                logs.push(`Skipped non-target store Place Order button: ${storeName}`);
                continue;
              }
            }

            // Click the Place Order button
            btn.scrollIntoView({ behavior: 'instant', block: 'center' });
            btn.click();
            logs.push(`Clicked Place Order for store: ${storeName}`);

            // Brief delay to allow confirmation dialog to appear if any
            await new Promise(r => setTimeout(r, 800));

            // Check if confirmation modal appeared (e.g. "Yes", "Confirm", "Place Order" modal button)
            const modalButtons = Array.from(document.querySelectorAll('.modal button, [role="dialog"] button, .swal2-confirm, .ant-modal-footer button, .confirm-btn')) as HTMLElement[];
            for (const mBtn of modalButtons) {
              const mText = (mBtn.innerText || mBtn.textContent || '').trim().toLowerCase();
              if (mText.includes('confirm') || mText.includes('yes') || mText.includes('proceed') || mText.includes('place order')) {
                mBtn.click();
                logs.push(`Confirmed modal dialog for: ${storeName}`);
                break;
              }
            }

            placedStores.push(storeName);
            await new Promise(r => setTimeout(r, 1500));
          } catch (btnErr: any) {
            failedStores.push({ name: 'Unknown Store', error: btnErr.message || 'Button click failed' });
          }
        }

        return { success: true, logs, placedStores, failedStores };
      }, targetStoreNames || null);

      console.log('[PharmarackCheckout] DOM Execution summary:', checkoutExecution);

      // Wait a moment for network calls to finish and capture any Order IDs
      await new Promise(r => setTimeout(r, 3000));

      // Trigger order sync immediately to pull official Order IDs from Pharmarack backend
      console.log('[PharmarackCheckout] Triggering immediate Pharmarack order sync to fetch official Order IDs...');
      let syncRes = null;
      try {
        syncRes = await syncPharmarackOrders();
        console.log('[PharmarackCheckout] Order sync complete:', syncRes);
      } catch (sErr: any) {
        console.warn('[PharmarackCheckout] Order sync error post-checkout:', sErr.message);
      }

      // Map placed stores to results
      const placedNames = checkoutExecution.placedStores || [];
      const capturedOrders = Array.from(networkOrderNos);

      if (placedNames.length > 0) {
        placedNames.forEach((sName: string, idx: number) => {
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
      }

      if (checkoutExecution.failedStores) {
        checkoutExecution.failedStores.forEach((f: any) => {
          results.push({
            storeName: f.name,
            status: 'failed',
            error: f.error
          });
        });
      }

      const placedCount = results.filter(r => r.status === 'placed').length;
      const failedCount = results.filter(r => r.status === 'failed').length;

      return {
        ok: placedCount > 0 || (checkoutExecution.placedStores && checkoutExecution.placedStores.length > 0),
        placedCount,
        failedCount,
        orders: results
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

    const mainProfilePath = path.resolve(getAppDataDir(), 'data', 'pharmarack_profile');
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
